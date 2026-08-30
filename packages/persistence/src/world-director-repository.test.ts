import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { campaignId, isoTimestamp, schemaVersion, snapshotId } from '@ember-tavern/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { applyMigrations } from './migrations.mjs';
import { SnapshotRepository } from './snapshot-repository.js';
import type { SqliteStatement, SqliteValue, TransactionalSqliteDatabase } from './sqlite-port.js';
import { WorldDirectorRepository } from './world-director-repository.js';

const directories: string[] = [];
const campaign = campaignId('campaign-director-repository');
const at = isoTimestamp('2026-08-24T14:00:00.000Z');

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('WorldDirectorRepository', () => {
  it('persists an explainable quiet proposal without changing world facts or Quest state', async () => {
    const database = await createDatabase();
    try {
      seed(database);
      const repository = new WorldDirectorRepository(adapt(database));
      const prepared = repository.prepare(campaign);
      expect(prepared).toMatchObject({
        pace: 'QUIET',
        pressureScore: 0,
        proposals: [{ kind: 'OPPORTUNITY', route: 'GENERATOR' }],
      });
      const before = factCounts(database);
      const run = repository.commit({
        id: 'director-run-quiet',
        campaignId: campaign,
        trigger: { kind: 'MANUAL', id: 'manual-quiet' },
        expectedContextDigest: prepared.contextDigest,
        occurredAt: at,
      });
      expect(run).toMatchObject({
        id: 'director-run-quiet',
        trigger: { kind: 'MANUAL', id: 'manual-quiet' },
        proposals: [{ rank: 1, kind: 'OPPORTUNITY' }],
      });
      expect(factCounts(database)).toEqual(before);
      expect(repository.history(campaign)).toEqual([run]);
      expect(
        repository.commit({
          id: 'director-run-quiet',
          campaignId: campaign,
          trigger: { kind: 'MANUAL', id: 'manual-quiet' },
          expectedContextDigest: prepared.contextDigest,
          occurredAt: at,
        }),
      ).toEqual(run);
    } finally {
      database.close();
    }
  });

  it('rejects stale context and trigger conflicts without partial audit rows', async () => {
    const database = await createDatabase();
    try {
      seed(database);
      const repository = new WorldDirectorRepository(adapt(database));
      const prepared = repository.prepare(campaign);
      database
        .prepare(
          `INSERT INTO world_clocks(id,campaign_id,name,current,max,stages_json,created_at,updated_at)
           VALUES('clock-new',?,'New pressure',0,4,'[]',?,?)`,
        )
        .run(campaign, at, at);
      expect(() =>
        repository.commit({
          id: 'director-run-stale',
          campaignId: campaign,
          trigger: { kind: 'MANUAL', id: 'manual-stale' },
          expectedContextDigest: prepared.contextDigest,
          occurredAt: at,
        }),
      ).toThrow('context changed');
      expect(database.prepare('SELECT COUNT(*) AS count FROM world_director_runs').get()).toEqual({
        count: 0,
      });

      const current = repository.prepare(campaign);
      repository.commit({
        id: 'director-run-current',
        campaignId: campaign,
        trigger: { kind: 'MANUAL', id: 'manual-current' },
        expectedContextDigest: current.contextDigest,
        occurredAt: at,
      });
      expect(() =>
        repository.commit({
          id: 'director-run-other',
          campaignId: campaign,
          trigger: { kind: 'MANUAL', id: 'manual-current' },
          expectedContextDigest: current.contextDigest,
          occurredAt: at,
        }),
      ).toThrow('reused with other input');
      expect(database.prepare('SELECT COUNT(*) AS count FROM world_director_runs').get()).toEqual({
        count: 1,
      });
    } finally {
      database.close();
    }
  });

  it('round-trips Director runs and ordered proposals through an internal snapshot', async () => {
    const database = await createDatabase();
    try {
      seed(database);
      const adapted = adapt(database);
      const repository = new WorldDirectorRepository(adapted);
      const prepared = repository.prepare(campaign);
      const first = repository.commit({
        id: 'director-run-snapshot',
        campaignId: campaign,
        trigger: { kind: 'MANUAL', id: 'manual-snapshot' },
        expectedContextDigest: prepared.contextDigest,
        occurredAt: at,
      });
      const snapshots = new SnapshotRepository(adapted);
      const snapshot = snapshotId('snapshot-director');
      snapshots.create({
        id: snapshot,
        campaignId: campaign,
        kind: 'MANUAL',
        reason: 'Verify Director audit restoration.',
        schemaVersion: schemaVersion(26),
        createdAt: at,
      });
      repository.commit({
        id: 'director-run-after-snapshot',
        campaignId: campaign,
        trigger: { kind: 'MANUAL', id: 'manual-after-snapshot' },
        expectedContextDigest: prepared.contextDigest,
        occurredAt: isoTimestamp('2026-08-24T14:01:00.000Z'),
      });

      snapshots.restore(snapshot);

      expect(repository.history(campaign)).toEqual([first]);
    } finally {
      database.close();
    }
  });
});

async function createDatabase(): Promise<DatabaseSync> {
  const directory = await mkdtemp(join(tmpdir(), 'ember-world-director-'));
  directories.push(directory);
  const database = new DatabaseSync(join(directory, 'director.sqlite'));
  await applyMigrations(database);
  return database;
}

function seed(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO campaigns(id,schema_version,state,created_at,updated_at)
    VALUES('${campaign}',1,'TAVERN','${at}','${at}');
    INSERT INTO world_constitutions(campaign_id,schema_version,revision,status,world_type,era,
      technology,magic,peoples_json,society,politics,economy,combat_scale,death_rules,
      career_rules,equipment_rules,npc_rules,trait_rules,taboos_json,created_at,updated_at,locked_at)
    VALUES('${campaign}',1,1,'LOCKED','Fantasy','Old','Iron','Rare','[]','Guilds','Council','Trade',
      'Local','Mortal','Open','Grounded','Persistent','Balanced','[]','${at}','${at}','${at}');
    INSERT INTO taverns(id,campaign_id,location_id,name,position,environment,special_rules_json,
      long_term_problem,changes_json,created_at,updated_at)
    VALUES('tavern-director','${campaign}','location-director','Ember Rest','Road','Warm','[]',
      'Storm','[]','${at}','${at}');
  `);
}

function factCounts(database: DatabaseSync) {
  return {
    worldFacts: database.prepare('SELECT COUNT(*) AS count FROM world_facts').get(),
    gameEvents: database.prepare('SELECT COUNT(*) AS count FROM game_events').get(),
    quests: database.prepare('SELECT COUNT(*) AS count FROM quests').get(),
    transitions: database.prepare('SELECT COUNT(*) AS count FROM quest_pool_transitions').get(),
  };
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
