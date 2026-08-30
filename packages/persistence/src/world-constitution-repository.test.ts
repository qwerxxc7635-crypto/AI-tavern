import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  campaignId,
  createCampaign,
  isoTimestamp,
  schemaVersion,
  type WorldConstitutionContent,
} from '@ember-tavern/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CampaignRepository,
  PersistenceDataError,
  WorldConstitutionRepository,
  type SqliteDatabase,
  type SqliteStatement,
  type SqliteValue,
} from './index.js';
import { applyMigrations } from './migrations.mjs';

const directories: string[] = [];
const firstAt = isoTimestamp('2026-08-14T00:00:00.000Z');
const secondAt = isoTimestamp('2026-08-14T00:01:00.000Z');
const lockedAt = isoTimestamp('2026-08-14T00:02:00.000Z');

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('WorldConstitutionRepository', () => {
  it.each([
    ['low-fantasy', lowFantasy],
    ['no-magic-investigation', investigation],
    ['cyberpunk', cyberpunk],
  ] as const)('saves and reloads a complete %s Constitution', async (suffix, content) => {
    const { database, path } = await createDatabase(`constitution-${suffix}`);
    const id = campaignId(`campaign-${suffix}`);
    const sqlite = adaptDatabase(database);
    new CampaignRepository(sqlite).create(
      createCampaign({ id, schemaVersion: schemaVersion(1), now: firstAt }),
    );
    expect(new WorldConstitutionRepository(sqlite).saveDraft(id, content, firstAt)).toEqual({
      campaignId: id,
      schemaVersion: 1,
      revision: 1,
      status: 'DRAFT',
      ...content,
      createdAt: firstAt,
      updatedAt: firstAt,
      lockedAt: null,
    });
    database.close();

    const reopened = new DatabaseSync(path);
    try {
      await applyMigrations(reopened);
      expect(new WorldConstitutionRepository(adaptDatabase(reopened)).get(id)).toMatchObject({
        revision: 1,
        status: 'DRAFT',
        ...content,
      });
      expect(
        reopened.prepare('SELECT name FROM schema_migrations WHERE version = 9').get(),
      ).toEqual({ name: 'world_constitutions' });
    } finally {
      reopened.close();
    }
  });

  it('increments revisions, locks the expected revision, and rejects every later mutation', async () => {
    const { database } = await createDatabase('constitution-lock');
    try {
      const id = campaignId('campaign-lock');
      const sqlite = adaptDatabase(database);
      new CampaignRepository(sqlite).create(
        createCampaign({ id, schemaVersion: schemaVersion(1), now: firstAt }),
      );
      const repository = new WorldConstitutionRepository(sqlite);
      repository.saveDraft(id, lowFantasy, firstAt);
      const revised = repository.saveDraft(id, { ...lowFantasy, era: 'Early iron age' }, secondAt);
      expect(revised).toMatchObject({ revision: 2, era: 'Early iron age' });
      expect(revised.createdAt).toBe(firstAt);
      expect(() => repository.lock(id, 1, lockedAt)).toThrow(PersistenceDataError);
      const locked = repository.lock(id, 2, lockedAt);
      expect(locked).toMatchObject({ revision: 2, status: 'LOCKED', lockedAt });
      expect(repository.requireRevision(id, 2)).toEqual(locked);
      expect(() => repository.saveDraft(id, cyberpunk, lockedAt)).toThrow(PersistenceDataError);
      expect(() =>
        database
          .prepare('UPDATE world_constitutions SET era = ? WHERE campaign_id = ?')
          .run('Mutated era', id),
      ).toThrow(/locked world constitution is immutable/);
    } finally {
      database.close();
    }
  });
});

const lowFantasy: WorldConstitutionContent = {
  worldType: 'Low fantasy frontier',
  era: 'Late medieval',
  technology: 'Hand tools, sail, and rare black powder',
  magic: 'Magic is subtle, costly, and leaves visible traces.',
  peoples: ['Humans', 'Riverfolk'],
  society: 'Small towns depend on guild and kin obligations.',
  politics: 'Local lords compete with free-city councils.',
  economy: 'Coin and barter coexist; long-distance trade is fragile.',
  combatScale: 'Personal and small-unit combat only.',
  deathRules: 'Ordinary wounds can kill; resurrection is impossible.',
  careerRules: 'Careers are learned social roles, not supernatural classes.',
  equipmentRules: 'Every item must be plausible for the technology level.',
  npcRules: 'NPC motives must follow material needs and known facts.',
  traitRules: 'Traits must include a benefit and a meaningful cost.',
  taboos: ['Graphic torture'],
};

const investigation: WorldConstitutionContent = {
  ...lowFantasy,
  worldType: 'Grounded occult investigation',
  era: '1920s',
  technology: 'Interwar urban technology',
  magic: 'No player-accessible magic exists.',
  peoples: ['Humans'],
  society: 'Public institutions conceal entrenched private networks.',
  combatScale: 'Violence is brief, dangerous, and consequential.',
  careerRules: 'Careers reflect ordinary education and employment.',
  taboos: ['Sexual violence'],
};

const cyberpunk: WorldConstitutionContent = {
  ...lowFantasy,
  worldType: 'Corporate cyberpunk megacity',
  era: 'Near future',
  technology: 'Ubiquitous networks, drones, and body augmentation',
  magic: 'Magic does not exist; extraordinary effects require technology.',
  peoples: ['Baseline humans', 'Augmented humans', 'Synthetic persons'],
  politics: 'Corporate sovereignty overlaps weakened civic government.',
  economy: 'Identity, access, and debt are programmable assets.',
  equipmentRules: 'Equipment requires a manufacturer, access tier, and power source.',
  taboos: ['Mind-control presented as consent'],
};

async function createDatabase(prefix: string): Promise<{ database: DatabaseSync; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), `${prefix}-`));
  directories.push(directory);
  const path = join(directory, 'test.sqlite');
  const database = new DatabaseSync(path);
  await applyMigrations(database);
  return { database, path };
}

function adaptDatabase(value: DatabaseSync): SqliteDatabase {
  return {
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
