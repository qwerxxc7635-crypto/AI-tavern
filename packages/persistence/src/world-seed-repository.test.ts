import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  campaignId,
  createCampaign,
  isoTimestamp,
  schemaVersion,
  type WorldSeed,
} from '@ember-tavern/contracts';
import { DeterministicWorldRandom } from '@ember-tavern/domain';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CampaignRepository,
  PersistenceDataError,
  WorldSeedRepository,
  type SqliteDatabase,
  type SqliteStatement,
  type SqliteValue,
} from './index.js';
import { applyMigrations } from './migrations.mjs';

const directories: string[] = [];
const id = campaignId('campaign-world-seed');
const firstAt = isoTimestamp('2026-08-14T03:00:00.000Z');
const secondAt = isoTimestamp('2026-08-14T03:01:00.000Z');
const seed: WorldSeed = {
  campaignId: id,
  schemaVersion: schemaVersion(1),
  algorithm: 'EMBER_STREAM_V1',
  seed: '00112233445566778899aabbccddeeff',
  createdAt: firstAt,
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('WorldSeedRepository', () => {
  it('persists one immutable Seed and resumes stream cursors after database reopen', async () => {
    const { database, path } = await createDatabase();
    const sqlite = adaptDatabase(database);
    createCampaignRow(sqlite);
    const repository = new WorldSeedRepository(sqlite);
    repository.create(seed);
    expect(repository.get(id)).toEqual(seed);
    const first = repository.reserve(id, 'map.layout', 3, firstAt);
    expect(first).toMatchObject({ startPosition: 0, count: 3 });
    const values = new DeterministicWorldRandom(first);
    expect([values.nextUint32(), values.nextUint32(), values.nextUint32()]).toEqual([
      177_449_918, 1_128_257_515, 3_186_434_774,
    ]);
    database.close();

    const reopened = new DatabaseSync(path);
    try {
      await applyMigrations(reopened);
      const restored = new WorldSeedRepository(adaptDatabase(reopened));
      expect(restored.get(id)).toEqual(seed);
      expect(restored.reserve(id, 'map.layout', 2, secondAt)).toMatchObject({
        startPosition: 3,
        count: 2,
      });
      expect(restored.getCursor(id, 'map.layout')).toMatchObject({
        position: 5,
        createdAt: firstAt,
        updatedAt: secondAt,
      });
    } finally {
      reopened.close();
    }
  });

  it('keeps stream cursors isolated and rejects hard-random stream names', async () => {
    const { database } = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      createCampaignRow(sqlite);
      const repository = new WorldSeedRepository(sqlite);
      repository.create(seed);
      repository.reserve(id, 'event.sample', 4, firstAt);
      repository.reserve(id, 'map.layout', 2, firstAt);
      expect(repository.getCursor(id, 'event.sample')?.position).toBe(4);
      expect(repository.getCursor(id, 'map.layout')?.position).toBe(2);
      expect(() => repository.reserve(id, 'd20', 1, secondAt)).toThrow();
      expect(() => repository.reserve(id, 'dice.check', 1, secondAt)).toThrow();
    } finally {
      database.close();
    }
  });

  it('rejects Seed mutation at the database boundary and invalid reservations', async () => {
    const { database } = await createDatabase();
    try {
      const sqlite = adaptDatabase(database);
      createCampaignRow(sqlite);
      const repository = new WorldSeedRepository(sqlite);
      repository.create(seed);
      expect(() => repository.create(seed)).toThrow();
      expect(() => repository.reserve(id, 'event.sample', 0, firstAt)).toThrow(
        PersistenceDataError,
      );
      expect(() =>
        database
          .prepare(
            `INSERT INTO world_random_streams (
               campaign_id, stream_id, position, created_at, updated_at
             ) VALUES (?, 'd20', 1, ?, ?)`,
          )
          .run(id, firstAt, firstAt),
      ).toThrow();
      expect(() =>
        database
          .prepare('UPDATE world_seeds SET seed = ? WHERE campaign_id = ?')
          .run('ffeeddccbbaa99887766554433221100', id),
      ).toThrow(/world seed is immutable/);
    } finally {
      database.close();
    }
  });
});

async function createDatabase(): Promise<{ database: DatabaseSync; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'ember-world-seed-'));
  directories.push(directory);
  const path = join(directory, 'test.sqlite');
  const database = new DatabaseSync(path);
  await applyMigrations(database);
  return { database, path };
}

function createCampaignRow(sqlite: SqliteDatabase): void {
  new CampaignRepository(sqlite).create(
    createCampaign({ id, schemaVersion: schemaVersion(1), now: firstAt }),
  );
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
