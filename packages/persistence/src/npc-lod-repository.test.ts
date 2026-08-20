import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  campaignId,
  createCampaign,
  isoTimestamp,
  schemaVersion,
  type NpcLodProfile,
  type WorldConstitutionContent,
} from '@ember-tavern/contracts';
import { createNpcLodSeed, upgradeNpcLod } from '@ember-tavern/domain';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CampaignRepository,
  NpcLodRepository,
  PersistenceDataError,
  WorldConstitutionRepository,
  type SqliteStatement,
  type SqliteValue,
  type TransactionalSqliteDatabase,
} from './index.js';
import { applyMigrations } from './migrations.mjs';

const directories: string[] = [];
const campaign = campaignId('campaign-npc-lod-persistence');
const firstAt = isoTimestamp('2026-08-20T10:00:00.000Z');
const secondAt = isoTimestamp('2026-08-20T11:00:00.000Z');
const constitutionContent: WorldConstitutionContent = {
  worldType: 'Low fantasy port',
  era: 'Sail age',
  technology: 'Late medieval',
  magic: 'Magic leaves a warm trace.',
  peoples: ['Harbor folk'],
  society: 'Guild towns',
  politics: 'Harbor councils',
  economy: 'Coin and barter',
  combatScale: 'Small-scale',
  deathRules: 'Death is permanent.',
  careerRules: 'Careers are social roles.',
  equipmentRules: 'Equipment follows local craft.',
  npcRules: 'NPC knowledge is bounded.',
  traitRules: 'Traits require tradeoffs.',
  taboos: [],
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('NpcLodRepository', () => {
  it('persists a LOD0 seed and an atomic LOD1 upgrade across reopen', async () => {
    const { database, path } = await createDatabase();
    let active: DatabaseSync | null = database;
    try {
      const sqlite = adaptDatabase(database);
      const seed = seedWorldAndNpc(sqlite);
      const next = lodOne(seed, 'generation-lod-one');
      seedGeneration(sqlite, 'generation-lod-one', 'request-lod-one', 'upgrade-lod-one');
      const repository = new NpcLodRepository(sqlite);

      expect(
        repository.commitUpgrade({
          profile: next,
          expectedRevision: 1,
          transitionId: 'transition-lod-one',
          idempotencyKey: 'upgrade-lod-one',
          trigger: 'OBSERVED',
        }),
      ).toEqual(next);
      expect(repository.listTransitions(seed.id)).toEqual([
        expect.objectContaining({ fromLod: 0, toLod: 1, beforeRevision: 1, afterRevision: 2 }),
      ]);

      database.close();
      active = null;
      const reopened = new DatabaseSync(path);
      active = reopened;
      await applyMigrations(reopened);
      expect(new NpcLodRepository(adaptDatabase(reopened)).require(seed.id)).toEqual(next);
    } finally {
      active?.close();
    }
  });

  it('replays the same idempotency key and rejects stale concurrent upgrades', async () => {
    const { database } = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      const seed = seedWorldAndNpc(sqlite);
      const first = lodOne(seed, 'generation-first');
      const stale = lodOne(seed, 'generation-stale');
      seedGeneration(sqlite, 'generation-first', 'request-first', 'upgrade-first');
      seedGeneration(sqlite, 'generation-stale', 'request-stale', 'upgrade-stale');
      const repository = new NpcLodRepository(sqlite);
      const command = {
        profile: first,
        expectedRevision: 1,
        transitionId: 'transition-first',
        idempotencyKey: 'upgrade-first',
        trigger: 'OBSERVED' as const,
      };

      expect(repository.commitUpgrade(command)).toEqual(first);
      expect(repository.commitUpgrade(command)).toEqual(first);
      expect(() =>
        repository.commitUpgrade({
          profile: stale,
          expectedRevision: 1,
          transitionId: 'transition-stale',
          idempotencyKey: 'upgrade-stale',
          trigger: 'OBSERVED',
        }),
      ).toThrow(PersistenceDataError);
      expect(repository.listTransitions(seed.id)).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it('keeps the knowledge boundary active for low-detail NPC actors', async () => {
    const { database } = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      const seed = seedWorldAndNpc(sqlite);
      sqlite
        .prepare(
          `INSERT INTO world_truths
           (id,campaign_id,subject,predicate,object_json,authority,visibility,source_event_id,
            revision,created_at,updated_at)
           VALUES (?,?,?,?,?,'LOCAL_RULE','PUBLIC',NULL,1,?,?)`,
        )
        .run('fact-known', campaign, 'eastern marker', 'position', '"moved"', firstAt, firstAt);
      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO actor_knowledge
             (id,campaign_id,actor_type,actor_id,target_kind,truth_id,claim_id,
              knowledge_state,visibility,provenance_kind,provenance_source_id,
              provenance_event_id,learned_at,confidence,revision,updated_at)
             VALUES (?,?,?,?,?,?,NULL,'KNOWN','ACTOR_PRIVATE','LOCAL_RULE','test',NULL,?,1,1,?)`,
          )
          .run(
            'knowledge-known',
            campaign,
            'NPC',
            seed.id,
            'TRUTH',
            'fact-known',
            firstAt,
            firstAt,
          ),
      ).not.toThrow();
      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO actor_knowledge
             (id,campaign_id,actor_type,actor_id,target_kind,truth_id,claim_id,
              knowledge_state,visibility,provenance_kind,provenance_source_id,
              provenance_event_id,learned_at,confidence,revision,updated_at)
             VALUES (?,?,?,?,?,?,NULL,'KNOWN','ACTOR_PRIVATE','LOCAL_RULE','test',NULL,?,1,1,?)`,
          )
          .run(
            'knowledge-forged',
            campaign,
            'NPC',
            'npc-not-in-world',
            'TRUTH',
            'fact-known',
            firstAt,
            firstAt,
          ),
      ).toThrow(/knowledge actor is not an NPC/);
    } finally {
      database.close();
    }
  });
});

function seedWorldAndNpc(sqlite: TransactionalSqliteDatabase): NpcLodProfile {
  new CampaignRepository(sqlite).create(
    createCampaign({ id: campaign, schemaVersion: schemaVersion(1), now: firstAt }),
  );
  const constitutions = new WorldConstitutionRepository(sqlite);
  constitutions.saveDraft(campaign, constitutionContent, firstAt);
  const constitution = constitutions.lock(campaign, 1, firstAt);
  const seed = createNpcLodSeed({
    id: 'npc-background-persistence',
    campaignId: campaign,
    constitution,
    identityAnchor: 'anchor-background-persistence',
    populationRole: 'Harbor passerby',
    at: firstAt,
  });
  return new NpcLodRepository(sqlite).createSeed(seed);
}

function lodOne(current: NpcLodProfile, generationRecord: string): NpcLodProfile {
  return upgradeNpcLod({
    current,
    constitution: {
      campaignId: campaign,
      schemaVersion: schemaVersion(1),
      revision: 1,
      status: 'LOCKED',
      ...constitutionContent,
      createdAt: firstAt,
      updatedAt: firstAt,
      lockedAt: firstAt,
    },
    candidate: {
      npcId: current.id,
      lod: 1,
      identityAnchor: current.identityAnchor,
      populationRole: current.populationRole,
      name: 'Nera Fen',
      appearance: 'A rain-dark cloak.',
      currentBehavior: 'Studies the tide marks.',
      career: null,
      personality: null,
      goals: [],
      knowledgeFactIds: [],
      relationshipNpcIds: [],
      memoryIds: [],
      secretFactIds: [],
      questIds: [],
      itemIds: [],
      experienceEventIds: [],
      constitutionEvidence: current.constitutionEvidence,
    },
    trigger: 'OBSERVED',
    references: {
      knowledgeFactIds: [],
      relationshipNpcIds: [],
      memoryIds: [],
      secretFactIds: [],
      questIds: [],
      itemIds: [],
      experienceEventIds: [],
    },
    generationRecordId: generationRecord,
    at: secondAt,
  });
}

function seedGeneration(
  sqlite: TransactionalSqliteDatabase,
  generation: string,
  request: string,
  idempotencyKey: string,
): void {
  sqlite
    .prepare(
      `INSERT INTO pending_ai_requests
       (id,campaign_id,turn_id,idempotency_key,task,status,model_profile_id,input_json,
        context_json,attempt_count,last_error_json,created_at,updated_at)
       VALUES (?,?,NULL,?,'GENERATE_NPC_LOD','VALIDATING',NULL,'{}','{}',1,NULL,?,?)`,
    )
    .run(request, campaign, idempotencyKey, secondAt, secondAt);
  sqlite
    .prepare(
      `INSERT INTO generation_records
       (id,campaign_id,request_id,task,model_profile_id,prompt_version,request_json,
        raw_response_text,validated_output_json,validation_error_json,started_at,completed_at)
       VALUES (?,?,?,'GENERATE_NPC_LOD',NULL,1,'{}','{}','{}',NULL,?,?)`,
    )
    .run(generation, campaign, request, secondAt, secondAt);
}

async function createDatabase(): Promise<{ database: DatabaseSync; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'ember-npc-lod-'));
  directories.push(directory);
  const path = join(directory, 'test.sqlite');
  const database = new DatabaseSync(path);
  await applyMigrations(database);
  return { database, path };
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
