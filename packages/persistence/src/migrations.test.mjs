import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { applyMigrations, migrationCount } from './migrations.mjs';

const coreTables = [
  'adventure_turns',
  'adventures',
  'app_settings',
  'campaigns',
  'conversations',
  'game_events',
  'generation_records',
  'items',
  'messages',
  'model_profiles',
  'npc_knowledge',
  'npc_relationships',
  'npcs',
  'pending_ai_requests',
  'player_characters',
  'provider_configs',
  'quests',
  'save_snapshots',
  'taverns',
  'world_bibles',
  'world_clocks',
  'world_facts',
];

async function withDatabase(run) {
  const directory = await mkdtemp(join(tmpdir(), 'ember-tavern-migration-'));
  const database = new DatabaseSync(join(directory, 'test.sqlite'));
  try {
    await run(database);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test('migrates a new database to the complete initial schema', async () => {
  await withDatabase(async (database) => {
    await applyMigrations(database);

    const tables = database
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
           AND name <> 'schema_migrations'
         ORDER BY name`,
      )
      .all()
      .map((row) => row.name);
    assert.deepEqual(tables, coreTables);
    assert.equal(database.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count,
      migrationCount,
    );
  });
});

test('skips an already applied migration on repeated startup', async () => {
  await withDatabase(async (database) => {
    await applyMigrations(database);
    const firstAppliedAt = database
      .prepare('SELECT applied_at FROM schema_migrations WHERE version = 1')
      .get().applied_at;

    await applyMigrations(database);

    const rows = database.prepare('SELECT version, name, applied_at FROM schema_migrations').all();
    assert.deepEqual(
      rows.map((row) => ({ ...row })),
      [{ version: 1, name: 'initial', applied_at: firstAppliedAt }],
    );
    assert.equal(
      database.prepare(`SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'`).get()
        .count,
      coreTables.length + 1,
    );
  });
});

test('enforces representative JSON, range, foreign-key, and secret-storage constraints', async () => {
  await withDatabase(async (database) => {
    await applyMigrations(database);
    const providerColumns = database.prepare('PRAGMA table_info(provider_configs)').all();
    assert.equal(
      providerColumns.some((column) => /api.?key|authorization|token/i.test(column.name)),
      false,
    );

    assert.throws(() =>
      database
        .prepare(
          `INSERT INTO provider_configs (
             id, provider_type, preset_key, display_name, options_json,
             enabled, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'provider-1',
          'OPENAI_COMPATIBLE',
          'custom',
          'Invalid JSON',
          '{',
          1,
          '2026-07-30T15:00:00.000Z',
          '2026-07-30T15:00:00.000Z',
        ),
    );

    database
      .prepare(
        `INSERT INTO campaigns (
           id, schema_version, state, task_model_overrides_json, model_switch_policy,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'campaign-1',
        1,
        'CREATING_WORLD',
        '{}',
        'ASK',
        '2026-07-30T15:00:00.000Z',
        '2026-07-30T15:00:00.000Z',
      );

    assert.throws(() =>
      database
        .prepare(
          `INSERT INTO world_clocks (
             id, campaign_id, name, current, max, stages_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'clock-1',
          'campaign-1',
          'Storm',
          7,
          6,
          '[]',
          '2026-07-30T15:00:00.000Z',
          '2026-07-30T15:00:00.000Z',
        ),
    );

    assert.throws(() =>
      database
        .prepare(
          `INSERT INTO items (
             id, campaign_id, content_json, reward_tier, effect_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'item-1',
          'missing-campaign',
          '{"name":"Token","description":"A token"}',
          'BASIC',
          '{"kind":"NONE"}',
          '2026-07-30T15:00:00.000Z',
        ),
    );
  });
});
