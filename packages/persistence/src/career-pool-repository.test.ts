import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  appendCareerPool,
  campaignId,
  careerEvidenceFor,
  careerId,
  createCampaign,
  createCareerDefinition,
  createCareerPool,
  generationRecordId,
  isoTimestamp,
  schemaVersion,
  type CareerDefinition,
  type WorldConstitutionContent,
} from '@ember-tavern/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CampaignRepository,
  CareerPoolRepository,
  PersistenceDataError,
  WorldConstitutionRepository,
  type SqliteStatement,
  type SqliteValue,
  type TransactionalSqliteDatabase,
} from './index.js';
import { applyMigrations } from './migrations.mjs';

const directories: string[] = [];
const campaign = campaignId('campaign-career-pool');
const firstAt = isoTimestamp('2026-08-20T08:00:00.000Z');
const secondAt = isoTimestamp('2026-08-20T09:00:00.000Z');
const constitution: WorldConstitutionContent = {
  worldType: 'Low fantasy port',
  era: 'Sail age',
  technology: 'Black powder is rare',
  magic: 'Magic requires costly rites',
  peoples: ['Harbor folk'],
  society: 'Merchant guilds govern public life',
  politics: 'A harbor council rules',
  economy: 'Trade and shipbuilding',
  combatScale: 'Personal',
  deathRules: 'Death is permanent',
  careerRules: 'Careers arise from licensed guilds and civic duties',
  equipmentRules: 'Equipment uses period materials',
  npcRules: 'Knowledge follows lived experience',
  traitRules: 'Benefits require drawbacks',
  taboos: [],
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('CareerPoolRepository', () => {
  it('saves, appends, and reloads a world-scoped pool after reopen', async () => {
    const { database, path } = await createDatabase();
    let active: DatabaseSync | null = database;
    try {
      const sqlite = adaptDatabase(database);
      seedLockedWorld(sqlite);
      const repository = new CareerPoolRepository(sqlite);
      const initial = pool([career('career-pilot', 'Shoal Pilot', 'INITIAL_GENERATION')]);
      expect(repository.save(initial, 0)).toEqual(initial);
      const updated = appendCareerPool(
        initial,
        [career('career-keeper', 'Lantern Keeper', 'RUNTIME_DISCOVERY')],
        secondAt,
      );
      repository.save(updated, 1);
      database.close();
      active = null;

      const reopened = new DatabaseSync(path);
      active = reopened;
      await applyMigrations(reopened);
      expect(new CareerPoolRepository(adaptDatabase(reopened)).require(campaign)).toEqual(updated);
    } finally {
      active?.close();
    }
  });

  it('rejects revision drift, forged columns, deletion, and unlocked worlds', async () => {
    const { database } = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      seedLockedWorld(sqlite);
      const repository = new CareerPoolRepository(sqlite);
      const initial = pool([career('career-pilot', 'Shoal Pilot', 'INITIAL_GENERATION')]);
      repository.save(initial, 0);
      expect(() => repository.save({ ...initial, revision: 2, updatedAt: secondAt }, 0)).toThrow(
        PersistenceDataError,
      );
      expect(() => database.prepare('DELETE FROM career_pools').run()).toThrow(
        /career pools are retained/,
      );
      expect(() =>
        database.prepare('UPDATE career_pools SET constitution_revision = 2, revision = 2').run(),
      ).toThrow(/identity is immutable/);
      database
        .prepare(
          `UPDATE career_pools
           SET pool_json = json_set(
             pool_json,
             '$.revision',
             2,
             '$.updatedAt',
             ?,
             '$.careers[0].constitutionEvidence.technology',
             'Orbital lasers'
           ),
           revision = 2,
           updated_at = ?`,
        )
        .run(secondAt, secondAt);
      expect(() => repository.require(campaign)).toThrow(
        /evidence disagrees with the locked Constitution/,
      );

      const other = campaignId('campaign-unlocked');
      new CampaignRepository(sqlite).create(
        createCampaign({ id: other, schemaVersion: schemaVersion(1), now: firstAt }),
      );
      new WorldConstitutionRepository(sqlite).saveDraft(other, constitution, firstAt);
      const invalid = createCareerPool({
        ...initial,
        campaignId: other,
        careers: initial.careers.map((value) => ({ ...value, campaignId: other })),
      });
      expect(() => repository.save(invalid, 0)).toThrow(
        /requires the locked Constitution revision/,
      );
    } finally {
      database.close();
    }
  });

  it('rejects normalized duplicate names before SQLite writes', async () => {
    const { database } = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      seedLockedWorld(sqlite);
      expect(() =>
        pool([
          career('career-pilot', 'Shoal Pilot', 'INITIAL_GENERATION'),
          career('career-pilot-copy', 'Ｓｈｏａｌ　Ｐｉｌｏｔ', 'INITIAL_GENERATION'),
        ]),
      ).toThrow(expect.objectContaining({ code: 'CAREER_DUPLICATE' }));
      expect(new CareerPoolRepository(sqlite).get(campaign)).toBeNull();
    } finally {
      database.close();
    }
  });
});

function career(idValue: string, name: string, source: CareerDefinition['source']) {
  return createCareerDefinition({
    schemaVersion: 1,
    id: careerId(idValue),
    campaignId: campaign,
    constitutionRevision: 1,
    name,
    rarity: source === 'INITIAL_GENERATION' ? 'COMMON' : 'UNCOMMON',
    role: 'Keeps a necessary harbor route operating',
    skills: ['Navigation'],
    equipmentTags: ['Charts'],
    socialPosition: 'Licensed guild worker',
    relationshipHooks: ['Answers to the harbor master'],
    risks: ['Accused when a ship is lost'],
    requirements: ['Guild sponsorship'],
    constitutionEvidence: careerEvidenceFor(constitution),
    legacyArchetype: 'SCHOLAR',
    source,
    generationRecordId: generationRecordId(`generation-${idValue}`),
    createdAt: firstAt,
  });
}

function pool(careers: readonly CareerDefinition[]) {
  return createCareerPool({
    schemaVersion: 1,
    campaignId: campaign,
    constitutionRevision: 1,
    careers,
    revision: 1,
    createdAt: firstAt,
    updatedAt: firstAt,
  });
}

async function createDatabase(): Promise<{ database: DatabaseSync; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'ember-career-pool-'));
  directories.push(directory);
  const path = join(directory, 'test.sqlite');
  const database = new DatabaseSync(path);
  await applyMigrations(database);
  return { database, path };
}

function seedLockedWorld(sqlite: TransactionalSqliteDatabase): void {
  new CampaignRepository(sqlite).create(
    createCampaign({ id: campaign, schemaVersion: schemaVersion(1), now: firstAt }),
  );
  const repository = new WorldConstitutionRepository(sqlite);
  repository.saveDraft(campaign, constitution, firstAt);
  repository.lock(campaign, 1, firstAt);
}

function adaptDatabase(value: DatabaseSync): TransactionalSqliteDatabase {
  return {
    exec(sql) {
      value.exec(sql);
    },
    prepare(sql): SqliteStatement {
      return adaptStatement(value.prepare(sql));
    },
  };
}

function adaptStatement(statement: StatementSync): SqliteStatement {
  return {
    run(...values: SqliteValue[]) {
      return statement.run(...values);
    },
    get(...values: SqliteValue[]) {
      return statement.get(...values);
    },
    all(...values: SqliteValue[]) {
      return statement.all(...values);
    },
  };
}
