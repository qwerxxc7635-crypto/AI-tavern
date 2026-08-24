import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { campaignId, isoTimestamp, schemaVersion, snapshotId } from '@ember-tavern/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { DirectorBudgetRepository } from './director-budget-repository.js';
import { applyMigrations } from './migrations.mjs';
import { SnapshotRepository } from './snapshot-repository.js';
import type { SqliteStatement, SqliteValue, TransactionalSqliteDatabase } from './sqlite-port.js';

const directories: string[] = [];
const campaign = campaignId('campaign-director-budget');
const at = isoTimestamp('2026-08-24T16:00:00.000Z');

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('DirectorBudgetRepository', () => {
  it('persists limits and cooldown deferrals, then recovers on the Rules game clock', async () => {
    const database = await createDatabase();
    try {
      seed(database);
      const repository = new DirectorBudgetRepository(adapt(database));
      for (let index = 1; index <= 5; index += 1) {
        insertRun(
          database,
          `run-day-${index}`,
          'FORESHADOW',
          `clock-${index}`,
          index === 5 ? 'LOW' : 'MEDIUM',
        );
        repository.admitRun({ campaignId: campaign, runId: `run-day-${index}`, occurredAt: at });
      }
      let snapshot = repository.get(campaign);
      expect(snapshot?.usage.dailyEvents).toBe(4);
      expect(snapshot?.entries.at(-1)).toMatchObject({
        status: 'DEFERRED',
        reason: 'DAILY_LIMIT',
        eligibleGameTime: 1_440,
      });

      database
        .prepare('UPDATE character_rule_states SET game_time_minutes=1440 WHERE campaign_id=?')
        .run(campaign);
      insertRun(database, 'run-next-day', 'FORESHADOW', 'clock-next', 'HIGH');
      snapshot = repository.admitRun({
        campaignId: campaign,
        runId: 'run-next-day',
        occurredAt: at,
      });
      expect(snapshot.gameDay).toBe(1);
      expect(snapshot.usage.dailyEvents).toBe(2);
      expect(snapshot.entries.find(({ runId }) => runId === 'run-day-5')).toMatchObject({
        status: 'APPROVED',
      });
      expect(snapshot.entries.find(({ runId }) => runId === 'run-next-day')).toMatchObject({
        status: 'APPROVED',
      });

      insertRun(database, 'run-cooldown', 'FORESHADOW', 'clock-next', 'HIGH');
      snapshot = repository.admitRun({
        campaignId: campaign,
        runId: 'run-cooldown',
        occurredAt: at,
      });
      expect(snapshot.entries.find(({ runId }) => runId === 'run-cooldown')).toMatchObject({
        status: 'DEFERRED',
        reason: 'COOLDOWN',
        eligibleGameTime: 1800,
      });
    } finally {
      database.close();
    }
  });

  it('round-trips budget state through save/restore', async () => {
    const database = await createDatabase();
    try {
      seed(database);
      const repository = new DirectorBudgetRepository(adapt(database));
      insertRun(database, 'run-opportunity', 'OPPORTUNITY', 'location-one', 'MEDIUM');
      const first = repository.admitRun({
        campaignId: campaign,
        runId: 'run-opportunity',
        occurredAt: at,
      });
      expect(first.entries[0]).toMatchObject({ status: 'APPROVED' });
      const snapshots = new SnapshotRepository(adapt(database));
      const id = snapshotId('snapshot-director-budget');
      snapshots.create({
        id,
        campaignId: campaign,
        kind: 'MANUAL',
        reason: 'Budget restore proof.',
        schemaVersion: schemaVersion(27),
        createdAt: at,
      });
      insertRun(database, 'run-after-snapshot', 'NPC_ACTION', 'npc-one', 'LOW');
      repository.admitRun({ campaignId: campaign, runId: 'run-after-snapshot', occurredAt: at });
      snapshots.restore(id);
      expect(repository.get(campaign)).toEqual(first);
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM director_budget_decisions').get(),
      ).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  it('defers new opportunities while the active Quest budget is full', async () => {
    const database = await createDatabase();
    try {
      seed(database);
      for (let index = 1; index <= 4; index += 1) insertActiveQuest(database, index);
      insertRun(database, 'run-active-limit', 'OPPORTUNITY', 'location-one', 'HIGH');
      const snapshot = new DirectorBudgetRepository(adapt(database)).admitRun({
        campaignId: campaign,
        runId: 'run-active-limit',
        occurredAt: at,
      });
      expect(snapshot.activeQuestCount).toBe(4);
      expect(snapshot.entries[0]).toMatchObject({
        status: 'DEFERRED',
        reason: 'ACTIVE_QUEST_LIMIT',
      });
    } finally {
      database.close();
    }
  });

  it('records empty Director runs idempotently without inventing content', async () => {
    const database = await createDatabase();
    try {
      seed(database);
      insertEmptyRun(database, 'run-empty');
      const repository = new DirectorBudgetRepository(adapt(database));
      const first = repository.admitRun({
        campaignId: campaign,
        runId: 'run-empty',
        occurredAt: at,
      });
      expect(first.entries).toEqual([]);
      expect(
        repository.admitRun({ campaignId: campaign, runId: 'run-empty', occurredAt: at }),
      ).toEqual(first);
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM director_budget_admissions').get(),
      ).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });
});

async function createDatabase(): Promise<DatabaseSync> {
  const directory = await mkdtemp(join(tmpdir(), 'ember-director-budget-'));
  directories.push(directory);
  const database = new DatabaseSync(join(directory, 'budget.sqlite'));
  await applyMigrations(database);
  return database;
}

function seed(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO campaigns(id,schema_version,state,created_at,updated_at)
    VALUES('${campaign}',1,'TAVERN','${at}','${at}');
    INSERT INTO player_characters(id,campaign_id,name,concept,story_preferences_json,
      content_boundaries_json,class_archetype,class_display_name,attributes_json,traits_json,
      personal_goal,background_json,created_at,updated_at)
    VALUES('character-budget','${campaign}','Mara','Wanderer','[]','[]','ROGUE','Rogue',
      '{"physique":2,"agility":3,"knowledge":2,"charisma":3}','[]','Find truth','{}','${at}','${at}');
    INSERT INTO taverns(id,campaign_id,location_id,name,position,environment,special_rules_json,
      long_term_problem,changes_json,created_at,updated_at)
    VALUES('tavern-budget','${campaign}','location-budget','Ember Rest','Road','Warm','[]','Storm','[]','${at}','${at}');
    INSERT INTO npcs(id,campaign_id,tavern_id,residency,name,identity,appearance,personality,goal,
      secret,speech_style,current_mood,current_status,memories_json,created_at,updated_at)
    VALUES('npc-budget','${campaign}','tavern-budget','RESIDENT','Ivo','Scout','Plain','Calm','Help',
      'None','Brief','Alert','ACTIVE','[]','${at}','${at}');
  `);
}

function insertActiveQuest(database: DatabaseSync, index: number): void {
  database
    .prepare(
      `INSERT INTO quests(id,campaign_id,publisher_npc_id,content_json,status,risk,
     recommended_attributes_json,expected_turns_min,expected_turns_max,reward_tier,
     related_npc_ids_json,related_fact_ids_json,created_at,updated_at)
     VALUES(?,?,'npc-budget','{"title":"Quest"}','ACTIVE','LOW','[]',1,2,'BASIC','[]','[]',?,?)`,
    )
    .run(`quest-active-${index}`, campaign, at, at);
}

function insertRun(
  database: DatabaseSync,
  id: string,
  kind: string,
  cooldownTarget: string,
  urgency: string,
): void {
  insertEmptyRun(database, id);
  database
    .prepare(
      `INSERT INTO world_director_proposals(run_id,campaign_id,ordinal,action_id,kind,actor_entity_id,
     target_entity_ids_json,rationale,proposed_effects_json,urgency,cooldown_key,route)
     VALUES(?,?,1,'action-1',?,NULL,'[]','Budget test','["Propose only"]',?,?,
       CASE WHEN ? IN ('QUEST_UPDATE','QUEST_EXPIRE') THEN 'RULES' ELSE 'GENERATOR' END)`,
    )
    .run(id, campaign, kind, urgency, `director:${kind.toLowerCase()}:${cooldownTarget}`, kind);
}

function insertEmptyRun(database: DatabaseSync, id: string): void {
  database
    .prepare(
      `INSERT INTO world_director_runs(id,campaign_id,trigger_kind,trigger_id,context_digest,pace,
     pressure_score,signals_json,suppressed_json,source_snapshot_json,created_at)
     VALUES(? ,?,'MANUAL',? ,?,'BALANCED',0,'{}','[]','{"campaignState":"TAVERN"}',?)`,
    )
    .run(id, campaign, `manual-${id}`, '0'.repeat(64), at);
}

function adapt(value: DatabaseSync): TransactionalSqliteDatabase {
  return {
    exec(sql) {
      value.exec(sql);
    },
    prepare(sql) {
      return adaptStatement(value.prepare(sql));
    },
  };
}
function adaptStatement(value: StatementSync): SqliteStatement {
  return {
    run(...parameters: readonly SqliteValue[]) {
      const result = value.run(...parameters);
      return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
    },
    get(...parameters: readonly SqliteValue[]) {
      return value.get(...parameters) as Record<string, SqliteValue> | undefined;
    },
    all(...parameters: readonly SqliteValue[]) {
      return value.all(...parameters) as Record<string, SqliteValue>[];
    },
  };
}
