import { createHash } from 'node:crypto';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  aiRequestId,
  campaignId,
  createCampaign,
  gameEventId,
  generationRecordId,
  isoTimestamp,
  modelProfileId,
  promptVersion,
  schemaVersion,
  worldFactId,
} from '@ember-tavern/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyMigrations } from './migrations.mjs';
import {
  CampaignRepository,
  GameEventRepository,
  GenerationRecordRepository,
  PersistenceDataError,
  exportCampaignSave,
} from './index.js';
import type { SqliteStatement, SqliteValue, TransactionalSqliteDatabase } from './sqlite-port.js';

const campaignKey = campaignId('campaign-export');
const at = isoTimestamp('2026-08-01T13:00:00.000Z');
const secret = 'TOP_SECRET_API_KEY_SHOULD_NOT_EXPORT';
let native: DatabaseSync;
let database: TransactionalSqliteDatabase;

beforeEach(async () => {
  native = new DatabaseSync(':memory:');
  await applyMigrations(native);
  database = adaptDatabase(native);
  seed(database);
});

describe('exportCampaignSave', () => {
  it('exports complete campaign content and audit files without device credentials', () => {
    const exported = exportCampaignSave(database, campaignKey, {
      createdAt: at,
      generatorVersion: '0.1.0',
    });
    const repeated = exportCampaignSave(database, campaignKey, {
      createdAt: at,
      generatorVersion: '0.1.0',
    });
    const entries = readStoredZip(exported.bytes);

    expect(exported.fileName).toBe('campaign-export.emtavern');
    expect(repeated.bytes).toEqual(exported.bytes);
    expect([...entries.keys()]).toEqual([
      'manifest.json',
      'campaign.json',
      'events.ndjson',
      'generations.json',
      'checksum.json',
    ]);
    const manifest = parseObject(requireText(entries, 'manifest.json'));
    const campaign = parseObject(requireText(entries, 'campaign.json'));
    const campaignRow = requireObject(campaign['campaign']);
    const tables = requireObject(campaign['tables']);
    const generations = parseObject(requireText(entries, 'generations.json'));
    const generationRows = requireArray(generations['records']);
    const generation = requireObject(generationRows[0]);
    const events = requireText(entries, 'events.ndjson').trim().split('\n');

    expect(manifest).toMatchObject({
      application: 'ember-tavern',
      campaignId: campaignKey,
      databaseSchemaVersion: 1,
      formatVersion: 1,
      files: {
        'campaign.json': { records: 1 },
        'events.ndjson': { records: 1 },
        'generations.json': { records: 1 },
      },
    });
    expect(campaignRow['default_model_profile_id']).toBeNull();
    expect(campaignRow['fallback_model_profile_id']).toBeNull();
    expect(campaignRow['task_model_overrides_json']).toBe('{}');
    expect(requireArray(tables['world_facts'])).toHaveLength(1);
    expect(Object.keys(tables)).toHaveLength(14);
    expect(events).toHaveLength(1);
    expect(parseObject(events[0] ?? '')).toMatchObject({
      id: gameEventId('event-export'),
      type: 'WORLD_CREATED',
    });
    expect(generation['model_profile_id']).toBeNull();
    expect(generation['validated_output_json']).toBe('{"name":"Ember Coast"}');

    const checksum = parseObject(requireText(entries, 'checksum.json'));
    const checksumFiles = requireObject(checksum['files']);
    for (const name of ['manifest.json', 'campaign.json', 'events.ndjson', 'generations.json']) {
      expect(checksumFiles[name]).toBe(sha256(requireBytes(entries, name)));
      expect(exported.checksums[name]).toBe(checksumFiles[name]);
    }
    const archiveText = new TextDecoder().decode(exported.bytes);
    expect(archiveText).not.toContain(secret);
    expect(archiveText).not.toContain('credential_ref');
    expect(archiveText).not.toContain('provider-secret');
    expect(native.prepare('SELECT COUNT(*) AS count FROM campaigns').get()).toEqual({ count: 1 });
  });

  it('rejects a forbidden secret field and rolls back the read transaction', () => {
    native
      .prepare('UPDATE generation_records SET request_json = ? WHERE id = ?')
      .run(`{"apiKey":"${secret}"}`, generationRecordId('generation-export'));

    expect(() =>
      exportCampaignSave(database, campaignKey, {
        createdAt: at,
        generatorVersion: '0.1.0',
      }),
    ).toThrow(PersistenceDataError);
    expect(native.prepare('SELECT id FROM campaigns WHERE id = ?').get(campaignKey)).toEqual({
      id: campaignKey,
    });
    expect(native.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('rejects a missing campaign without leaving the connection in a transaction', () => {
    expect(() =>
      exportCampaignSave(database, campaignId('campaign-missing'), {
        createdAt: at,
        generatorVersion: '0.1.0',
      }),
    ).toThrow('Campaign not found for export');
    expect(() => database.exec('BEGIN IMMEDIATE')).not.toThrow();
    database.exec('ROLLBACK');
  });
});

function seed(sqlite: TransactionalSqliteDatabase): void {
  sqlite
    .prepare(
      `INSERT INTO provider_configs (
         id, provider_type, preset_key, display_name, base_url, credential_ref,
         options_json, enabled, created_at, updated_at
       ) VALUES (?, 'LOCAL_OPENAI_COMPATIBLE', 'custom', 'Secret provider', NULL, ?, ?, 1, ?, ?)`,
    )
    .run('provider-secret', `credential:${secret}`, `{"apiKey":"${secret}"}`, at, at);
  sqlite
    .prepare(
      `INSERT INTO model_profiles (
         id, provider_config_id, model_name, display_name, capabilities_json,
         task_options_json, enabled, capabilities_checked_at, created_at, updated_at
       ) VALUES (?, 'provider-secret', 'model-export', 'Export model', ?, '{}', 1, ?, ?, ?)`,
    )
    .run(
      modelProfileId('model-profile-export'),
      JSON.stringify({
        text: true,
        streaming: false,
        systemMessages: true,
        jsonMode: true,
        jsonSchema: false,
        toolCalling: false,
        reasoning: false,
        contextWindowTokens: 16_000,
        costStatus: 'UNKNOWN',
      }),
      at,
      at,
      at,
    );
  const campaigns = new CampaignRepository(sqlite);
  campaigns.create(createCampaign({ id: campaignKey, schemaVersion: schemaVersion(1), now: at }));
  sqlite
    .prepare(
      `UPDATE campaigns
       SET default_model_profile_id = ?, fallback_model_profile_id = ?,
           task_model_overrides_json = ?
       WHERE id = ?`,
    )
    .run(
      modelProfileId('model-profile-export'),
      modelProfileId('model-profile-export'),
      JSON.stringify({ GENERATE_WORLD: modelProfileId('model-profile-export') }),
      campaignKey,
    );
  sqlite
    .prepare(
      `INSERT INTO world_facts (
         id, campaign_id, kind, statement, location_id, faction_ids_json,
         detail_json, supersedes_fact_id, created_at
       ) VALUES (?, ?, 'DEVELOPING_FACT', 'The beacon is lit.', NULL, '[]', '{}', NULL, ?)`,
    )
    .run(worldFactId('fact-export'), campaignKey, at);
  new GameEventRepository(sqlite).append({
    id: gameEventId('event-export'),
    campaignId: campaignKey,
    schemaVersion: schemaVersion(1),
    type: 'WORLD_CREATED',
    payload: { worldName: 'Ember Coast' },
    occurredAt: at,
  });
  const generations = new GenerationRecordRepository(sqlite);
  generations.create({
    id: generationRecordId('generation-export'),
    campaignId: campaignKey,
    requestId: aiRequestId('request-export'),
    task: 'GENERATE_WORLD',
    modelProfileId: modelProfileId('model-profile-export'),
    promptVersion: promptVersion(1),
    request: { modelName: 'model-export', maxOutputTokens: 1_000 },
    startedAt: at,
  });
  generations.complete(generationRecordId('generation-export'), {
    rawResponseText: '{"name":"Ember Coast"}',
    validatedOutput: { name: 'Ember Coast' },
    validationError: null,
    completedAt: at,
  });
  sqlite
    .prepare('INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)')
    .run('private-test-setting', `{"apiKey":"${secret}"}`, at);
}

function readStoredZip(bytes: Uint8Array): ReadonlyMap<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
    const signature = view.getUint32(0, true);
    if (signature === 0x02014b50) break;
    if (signature !== 0x04034b50) throw new Error('Invalid ZIP local header');
    const method = view.getUint16(8, true);
    const size = view.getUint32(18, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    if (method !== 0) throw new Error('Test parser only accepts stored ZIP entries');
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = new TextDecoder().decode(bytes.slice(nameStart, nameStart + nameLength));
    entries.set(name, bytes.slice(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  const endView = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 22);
  if (endView.getUint32(0, true) !== 0x06054b50 || endView.getUint16(10, true) !== entries.size) {
    throw new Error('Invalid ZIP end record');
  }
  return entries;
}

function requireBytes(entries: ReadonlyMap<string, Uint8Array>, name: string): Uint8Array {
  const value = entries.get(name);
  if (value === undefined) throw new Error(`Missing ZIP entry: ${name}`);
  return value;
}

function requireText(entries: ReadonlyMap<string, Uint8Array>, name: string): string {
  return new TextDecoder().decode(requireBytes(entries, name));
}

function parseObject(text: string): Record<string, unknown> {
  return requireObject(JSON.parse(text) as unknown);
}

function requireObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Expected an object');
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError('Expected an array');
  return value;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
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
