import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
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
  snapshotId,
  transitionCampaign,
  worldFactId,
} from '@ember-tavern/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyMigrations } from './migrations.mjs';
import {
  CampaignRepository,
  GameEventRepository,
  GenerationRecordRepository,
  PersistenceDataError,
  SnapshotRepository,
  exportCampaignSave,
  importCampaignSave,
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

afterEach(() => {
  native.close();
});

describe('exportCampaignSave', () => {
  it('emits the current TypeScript archive for the interop gate when requested', () => {
    const output = process.env['EMBER_TS_ARCHIVE_OUTPUT'];
    if (output === undefined) return;
    const exported = exportCampaignSave(database, campaignKey, {
      createdAt: at,
      generatorVersion: '0.1.0',
    });
    writeFileSync(output, exported.bytes);
  });

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

  it('rejects secret material in request, response and diagnostic values', () => {
    for (const [column, value] of [
      ['request_json', '{"message":"provider returned sk-or-v1-1234567890abcdef"}'],
      ['raw_response_text', 'Provider echoed Authorization: Bearer abcdefghijklmnop'],
      ['validation_error_json', '{"message":"API key: abcdefghijklmnop"}'],
    ] as const) {
      native
        .prepare(
          `UPDATE generation_records
           SET request_json = '{}', raw_response_text = NULL, validation_error_json = NULL
           WHERE id = ?`,
        )
        .run(generationRecordId('generation-export'));
      native
        .prepare(`UPDATE generation_records SET ${column} = ? WHERE id = ?`)
        .run(value, generationRecordId('generation-export'));
      expect(() =>
        exportCampaignSave(database, campaignKey, {
          createdAt: at,
          generatorVersion: '0.1.0',
        }),
      ).toThrow(/secret/u);
    }
  });

  it('rejects a known test secret in an ordinary narrative field', () => {
    native
      .prepare('UPDATE world_facts SET statement = ? WHERE id = ?')
      .run('TOP_SECRET_API_KEY_SHOULD_NOT_EXPORT', worldFactId('fact-export'));
    expect(() =>
      exportCampaignSave(database, campaignKey, {
        createdAt: at,
        generatorVersion: '0.1.0',
      }),
    ).toThrow(/secret/u);
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

describe('importCampaignSave', () => {
  it('imports the current Rust archive during the interop gate when provided', async () => {
    const input = process.env['EMBER_RUST_ARCHIVE_INPUT'];
    if (input === undefined) return;
    const imported = await importCampaignSave(database, new Uint8Array(readFileSync(input)), {
      mode: 'CREATE',
      importedAt: isoTimestamp('2026-08-02T01:00:00.000Z'),
      snapshotId: snapshotId('snapshot-current-rust-interop'),
    });
    expect(imported.campaign.id).toBe(campaignId('campaign-transfer'));
    expect(
      native.prepare('SELECT statement FROM world_facts WHERE id = ?').get('fact-transfer'),
    ).toEqual({ statement: 'The bell is ringing.' });
  });

  it('imports the Rust v1 fixture without device state', async () => {
    const archive = new Uint8Array(
      readFileSync(new URL('../test-fixtures/rust-export-v1.emtavern', import.meta.url)),
    );
    const imported = await importCampaignSave(database, archive, {
      mode: 'CREATE',
      importedAt: isoTimestamp('2026-08-01T13:00:30.000Z'),
      snapshotId: snapshotId('snapshot-rust-interop'),
    });

    expect(imported.campaign).toMatchObject({
      id: campaignId('campaign-transfer'),
      state: 'CREATING_WORLD',
    });
    expect(
      native.prepare('SELECT statement FROM world_facts WHERE id = ?').get('fact-transfer'),
    ).toEqual({ statement: 'The bell is ringing.' });
    expect(
      native
        .prepare('SELECT COUNT(*) AS count FROM provider_configs WHERE id <> ?')
        .get('provider-secret'),
    ).toEqual({ count: 0 });
    expect(imported.snapshot).toMatchObject({
      campaignId: campaignId('campaign-transfer'),
      kind: 'IMPORT',
    });
  });

  it('restores a deleted campaign, creates an IMPORT snapshot and can continue play', async () => {
    const exported = exportCampaignSave(database, campaignKey, {
      createdAt: at,
      generatorVersion: '0.1.0',
    });
    native.prepare('DELETE FROM campaigns WHERE id = ?').run(campaignKey);
    expect(new CampaignRepository(database).get(campaignKey)).toBeNull();

    const importedAt = isoTimestamp('2026-08-01T13:01:00.000Z');
    const imported = await importCampaignSave(database, exported.bytes, {
      mode: 'CREATE',
      importedAt,
      snapshotId: snapshotId('snapshot-import-create'),
    });

    expect(imported.campaign).toMatchObject({ id: campaignKey, state: 'CREATING_WORLD' });
    expect(imported.importedEventCount).toBe(1);
    expect(imported.importedGenerationCount).toBe(1);
    expect(imported.snapshot).toMatchObject({
      campaignId: campaignKey,
      kind: 'IMPORT',
      reason: `IMPORT:${importedAt}`,
      schemaVersion: 1,
    });
    expect(new SnapshotRepository(database).get(snapshotId('snapshot-import-create'))).toEqual(
      imported.snapshot,
    );
    expect(
      native.prepare('SELECT statement FROM world_facts WHERE id = ?').get('fact-export'),
    ).toEqual({ statement: 'The beacon is lit.' });
    expect(
      native
        .prepare('SELECT model_profile_id FROM generation_records WHERE id = ?')
        .get('generation-export'),
    ).toEqual({ model_profile_id: null });
    expect(
      native
        .prepare('SELECT default_model_profile_id FROM campaigns WHERE id = ?')
        .get(campaignKey),
    ).toEqual({ default_model_profile_id: null });

    const continued = transitionCampaign(
      imported.campaign,
      'REVIEWING_WORLD',
      isoTimestamp('2026-08-01T13:02:00.000Z'),
    );
    new CampaignRepository(database).update(continued);
    expect(new CampaignRepository(database).get(campaignKey)?.state).toBe('REVIEWING_WORLD');
  });

  it('requires a completed backup callback before replacing an existing campaign', async () => {
    const exported = exportCampaignSave(database, campaignKey, {
      createdAt: at,
      generatorVersion: '0.1.0',
    });
    native
      .prepare('UPDATE world_facts SET statement = ? WHERE id = ?')
      .run('Locally changed.', worldFactId('fact-export'));

    await expect(
      importCampaignSave(database, exported.bytes, {
        mode: 'OVERWRITE',
        importedAt: isoTimestamp('2026-08-01T13:03:00.000Z'),
        snapshotId: snapshotId('snapshot-import-no-backup'),
      }),
    ).rejects.toThrow('requires a completed backup callback');
    expect(
      native.prepare('SELECT statement FROM world_facts WHERE id = ?').get('fact-export'),
    ).toEqual({ statement: 'Locally changed.' });

    await expect(
      importCampaignSave(database, exported.bytes, {
        mode: 'OVERWRITE',
        importedAt: isoTimestamp('2026-08-01T13:03:30.000Z'),
        snapshotId: snapshotId('snapshot-import-backup-failed'),
        prepareOverwriteBackup: () => {
          throw new Error('simulated backup failure');
        },
      }),
    ).rejects.toThrow('simulated backup failure');
    expect(
      native.prepare('SELECT statement FROM world_facts WHERE id = ?').get('fact-export'),
    ).toEqual({ statement: 'Locally changed.' });

    let backups = 0;
    const imported = await importCampaignSave(database, exported.bytes, {
      mode: 'OVERWRITE',
      importedAt: isoTimestamp('2026-08-01T13:04:00.000Z'),
      snapshotId: snapshotId('snapshot-import-overwrite'),
      prepareOverwriteBackup: () => {
        backups += 1;
      },
    });
    expect(backups).toBe(1);
    expect(imported.snapshot.kind).toBe('IMPORT');
    expect(
      native.prepare('SELECT statement FROM world_facts WHERE id = ?').get('fact-export'),
    ).toEqual({ statement: 'The beacon is lit.' });
  });

  it('rejects corrupted archive bytes before creating campaign state', async () => {
    const exported = exportCampaignSave(database, campaignKey, {
      createdAt: at,
      generatorVersion: '0.1.0',
    });
    const corrupted = exported.bytes.slice();
    const needle = new TextEncoder().encode('The beacon is lit.');
    const offset = findBytes(corrupted, needle);
    if (offset < 0) throw new Error('Expected test text in exported ZIP');
    corrupted[offset] = (corrupted[offset] ?? 0) ^ 1;
    native.prepare('DELETE FROM campaigns WHERE id = ?').run(campaignKey);

    await expect(
      importCampaignSave(database, corrupted, {
        mode: 'CREATE',
        importedAt: isoTimestamp('2026-08-01T13:05:00.000Z'),
        snapshotId: snapshotId('snapshot-import-corrupt'),
      }),
    ).rejects.toThrow(PersistenceDataError);
    expect(new CampaignRepository(database).get(campaignKey)).toBeNull();
    expect(native.prepare('SELECT COUNT(*) AS count FROM save_snapshots').get()).toEqual({
      count: 0,
    });
  });

  it('rejects a ZIP entry whose declared expansion exceeds the ratio budget', async () => {
    const exported = exportCampaignSave(database, campaignKey, {
      createdAt: at,
      generatorVersion: '0.1.0',
    });
    const bomb = exported.bytes.slice();
    const central = findCentralEntry(bomb, 'campaign.json');
    const compressedSize = central.getUint32(20, true);
    central.setUint32(24, compressedSize * 101, true);

    await expect(
      importCampaignSave(database, bomb, {
        mode: 'OVERWRITE',
        importedAt: isoTimestamp('2026-08-01T13:05:30.000Z'),
        snapshotId: snapshotId('snapshot-import-ratio-bomb'),
        prepareOverwriteBackup: () => undefined,
      }),
    ).rejects.toThrow(/compression ratio/u);
  });

  it('rolls back all rows when repository-level domain validation fails', async () => {
    native
      .prepare('UPDATE world_facts SET faction_ids_json = ? WHERE id = ?')
      .run('{}', worldFactId('fact-export'));
    const exported = exportCampaignSave(database, campaignKey, {
      createdAt: at,
      generatorVersion: '0.1.0',
    });
    native.prepare('DELETE FROM campaigns WHERE id = ?').run(campaignKey);

    await expect(
      importCampaignSave(database, exported.bytes, {
        mode: 'CREATE',
        importedAt: isoTimestamp('2026-08-01T13:06:00.000Z'),
        snapshotId: snapshotId('snapshot-import-invalid-domain'),
      }),
    ).rejects.toThrow(PersistenceDataError);
    expect(new CampaignRepository(database).get(campaignKey)).toBeNull();
    expect(native.prepare('SELECT COUNT(*) AS count FROM world_facts').get()).toEqual({ count: 0 });
    expect(native.prepare('SELECT COUNT(*) AS count FROM save_snapshots').get()).toEqual({
      count: 0,
    });
    expect(native.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
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

function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

function findCentralEntry(bytes: Uint8Array, expectedName: string): DataView {
  const end = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 22, 22);
  let offset = end.getUint32(16, true);
  const count = end.getUint16(10, true);
  for (let index = 0; index < count; index += 1) {
    const central = new DataView(bytes.buffer, bytes.byteOffset + offset, 46);
    if (central.getUint32(0, true) !== 0x02014b50) throw new Error('Invalid central header');
    const nameLength = central.getUint16(28, true);
    const extraLength = central.getUint16(30, true);
    const commentLength = central.getUint16(32, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    if (name === expectedName) return central;
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`Missing central entry: ${expectedName}`);
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
