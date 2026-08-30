import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { campaignId, isoTimestamp, questId } from '@ember-tavern/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  QuestPoolRepository,
  type SqliteStatement,
  type SqliteValue,
  type TransactionalSqliteDatabase,
} from './index.js';
import { applyMigrations } from './migrations.mjs';

const directories: string[] = [];
const campaign = campaignId('campaign-quest-pool');
const at = isoTimestamp('2026-08-24T10:00:00.000Z');

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('QuestPoolRepository', () => {
  it('keeps multiple active quests, appends transitions and survives reopen', async () => {
    const { database, path } = await createDatabase();
    seed(database);
    const repository = new QuestPoolRepository(adaptDatabase(database));
    const first = repository.transition(command('quest-one', 1, 'ACTIVE', 'intervene-one'));
    const second = repository.transition(command('quest-two', 1, 'ACTIVE', 'intervene-two'));
    expect(first).toMatchObject({ status: 'ACTIVE', revision: 2 });
    expect(second).toMatchObject({ status: 'ACTIVE', revision: 2 });
    expect(repository.list(campaign).filter(({ status }) => status === 'ACTIVE')).toHaveLength(2);
    expect(repository.transition(command('quest-one', 1, 'ACTIVE', 'intervene-one'))).toEqual(
      first,
    );
    expect(repository.transitions(questId('quest-one'))).toHaveLength(2);

    database.close();
    const reopened = new DatabaseSync(path);
    try {
      await applyMigrations(reopened);
      const restored = new QuestPoolRepository(adaptDatabase(reopened));
      expect(restored.get(questId('quest-one'))).toEqual(first);
      expect(restored.list(campaign).filter(({ status }) => status === 'ACTIVE')).toHaveLength(2);
    } finally {
      reopened.close();
    }
  });

  it('keeps failed expired and abandoned quests terminal and rejects stale revisions', async () => {
    const { database } = await createDatabase();
    try {
      seed(database);
      const repository = new QuestPoolRepository(adaptDatabase(database));
      repository.transition(command('quest-one', 1, 'ACTIVE', 'active-one'));
      const failed = repository.transition({
        ...command('quest-one', 2, 'FAILED', 'failed-one'),
        source: 'SYSTEM',
        reason: 'The opportunity failed in the world.',
      });
      expect(failed.status).toBe('FAILED');
      expect(repository.transition(command('quest-one', 1, 'ACTIVE', 'active-one'))).toEqual(
        failed,
      );
      expect(() =>
        repository.transition({
          ...command('quest-one', 3, 'ACTIVE', 'rewrite-failed'),
          source: 'SYSTEM',
        }),
      ).toThrow();
      expect(() => repository.transition(command('quest-two', 99, 'ACTIVE', 'stale'))).toThrow();
      expect(repository.get(questId('quest-one'))).toEqual(failed);
    } finally {
      database.close();
    }
  });
});

function command(
  quest: string,
  expectedRevision: number,
  toStatus: 'ACTIVE' | 'FAILED',
  operationId: string,
) {
  return {
    operationId,
    campaignId: campaign,
    questId: questId(quest),
    expectedRevision,
    toStatus,
    source: 'PLAYER_INTERVENTION' as const,
    reason: 'The player materially intervened in the opportunity.',
    occurredAt: at,
  };
}

async function createDatabase() {
  const directory = await mkdtemp(join(tmpdir(), 'ember-quest-pool-'));
  directories.push(directory);
  const path = join(directory, 'quest.sqlite');
  const database = new DatabaseSync(path);
  await applyMigrations(database);
  return { database, path };
}

function seed(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO campaigns(id,schema_version,state,created_at,updated_at)
    VALUES('campaign-quest-pool',1,'TAVERN','${at}','${at}');
    INSERT INTO taverns(
      id,campaign_id,location_id,name,position,environment,special_rules_json,
      long_term_problem,changes_json,created_at,updated_at
    ) VALUES('tavern-quest-pool','campaign-quest-pool','location-one','Ember','Road','Warm',
      '[]','Storm','[]','${at}','${at}');
    INSERT INTO npcs(
      id,campaign_id,tavern_id,residency,name,identity,appearance,personality,goal,secret,
      speech_style,current_mood,current_status,memories_json,created_at,updated_at
    ) VALUES('npc-quest-pool','campaign-quest-pool','tavern-quest-pool','OWNER','Keeper',
      'Innkeeper','Coat','Steady','Protect','Hidden','Brief','Calm','ACTIVE','[]','${at}','${at}');
    INSERT INTO quests(
      id,campaign_id,publisher_npc_id,content_json,status,risk,recommended_attributes_json,
      expected_turns_min,expected_turns_max,reward_tier,related_npc_ids_json,
      related_fact_ids_json,created_at,updated_at
    ) VALUES
      ('quest-one','campaign-quest-pool','npc-quest-pool',
       '{"title":"One","summary":"One","objective":"One","failureCost":"One"}',
       'AVAILABLE','LOW','["knowledge"]',8,12,'BASIC','[]','[]','${at}','${at}'),
      ('quest-two','campaign-quest-pool','npc-quest-pool',
       '{"title":"Two","summary":"Two","objective":"Two","failureCost":"Two"}',
       'AVAILABLE','LOW','["agility"]',8,12,'BASIC','[]','[]','${at}','${at}');
  `);
}

function adaptDatabase(database: DatabaseSync): TransactionalSqliteDatabase {
  return {
    exec(sql) {
      database.exec(sql);
    },
    prepare(sql) {
      return adaptStatement(database.prepare(sql));
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
