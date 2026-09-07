import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CacheMetricsRepository,
  PersistenceDataError,
  type SqliteStatement,
  type SqliteValue,
  type TransactionalSqliteDatabase,
} from './index.js';
import { applyMigrations } from './migrations.mjs';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('CacheMetricsRepository', () => {
  it('records bounded aggregate metrics without storing a prompt', async () => {
    const { database, repository } = await setup();
    try {
      const saved = repository.record({
        taskType: 'COMBAT_CONTENT_GENERATION',
        promptCacheHitTokens: 750,
        promptCacheMissTokens: 250,
        prefixHash: 'a'.repeat(64),
        recordedAt: '2026-08-08T08:00:00.000Z',
      });
      expect(saved.hitRatio).toBe(0.75);
      expect(repository.list()).toEqual([saved]);

      const row = database
        .prepare(`SELECT key, value_json FROM app_settings WHERE key = 'deepseek_cache_metrics_v1'`)
        .get() as { key: string; value_json: string };
      expect(row.key).toBe('deepseek_cache_metrics_v1');
      expect(row.value_json).toContain('COMBAT_CONTENT_GENERATION');
      expect(row.value_json).not.toMatch(/messages|prompt text|system contract|player input/i);
      expect(Object.keys(JSON.parse(row.value_json)[0])).toEqual([
        'taskType',
        'promptCacheHitTokens',
        'promptCacheMissTokens',
        'hitRatio',
        'prefixHash',
        'recordedAt',
      ]);
    } finally {
      database.close();
    }
  });

  it('rejects invalid provider metrics and corrupted unknown fields', async () => {
    const { database, repository } = await setup();
    try {
      expect(() =>
        repository.record({
          taskType: 'UNKNOWN_TASK',
          promptCacheHitTokens: -1,
          promptCacheMissTokens: 0,
          prefixHash: 'not-a-hash',
          recordedAt: 'not-a-time',
        }),
      ).toThrow(PersistenceDataError);
      database
        .prepare(
          `INSERT INTO app_settings (key, value_json, updated_at)
           VALUES ('deepseek_cache_metrics_v1', ?, '2026-08-08T08:00:00.000Z')`,
        )
        .run(
          JSON.stringify([
            {
              taskType: 'GENERATE_WORLD',
              promptCacheHitTokens: 1,
              promptCacheMissTokens: 0,
              hitRatio: 1,
              prefixHash: 'b'.repeat(64),
              recordedAt: '2026-08-08T08:00:00.000Z',
              fullPrompt: 'must not be accepted',
            },
          ]),
        );
      expect(() => repository.list()).toThrow('unknown field');
    } finally {
      database.close();
    }
  });

  it('retains only the latest 200 Provider observations', async () => {
    const { database, repository } = await setup();
    try {
      for (let index = 0; index < 205; index += 1) {
        repository.record({
          taskType: 'GENERATE_DIALOGUE_SUGGESTIONS',
          promptCacheHitTokens: index,
          promptCacheMissTokens: 1,
          prefixHash: index.toString(16).padStart(64, '0'),
          recordedAt: new Date(Date.UTC(2026, 7, 8, 8, 0, index)).toISOString(),
        });
      }
      const metrics = repository.list();
      expect(metrics).toHaveLength(200);
      expect(metrics[0]?.promptCacheHitTokens).toBe(5);
      expect(metrics.at(-1)?.promptCacheHitTokens).toBe(204);
    } finally {
      database.close();
    }
  });
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'ember-cache-metrics-'));
  directories.push(directory);
  const database = new DatabaseSync(join(directory, 'metrics.sqlite'));
  await applyMigrations(database);
  return {
    database,
    repository: new CacheMetricsRepository(adaptDatabase(database)),
  };
}

function adaptDatabase(database: DatabaseSync): TransactionalSqliteDatabase {
  return {
    exec(sql) {
      database.exec(sql);
    },
    prepare(sql): SqliteStatement {
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
