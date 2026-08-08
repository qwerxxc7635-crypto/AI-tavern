import { createHash } from 'node:crypto';

import type { CampaignId, IsoTimestamp } from '@ember-tavern/contracts';

import { PersistenceDataError } from './campaign-repository.js';
import { currentSchemaVersion } from './migrations.mjs';
import type { TransactionalSqliteDatabase } from './sqlite-port.js';

type StoredScalar = string | number | null;
type StoredRow = Readonly<Record<string, StoredScalar>>;

const FORMAT_VERSION = 1;
// Device-only schema migrations (for example, credential cleanup bookkeeping)
// must not change the portable campaign archive contract.
const ARCHIVE_DATABASE_SCHEMA_VERSION = 1;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const ENTRY_NAMES = [
  'manifest.json',
  'campaign.json',
  'events.ndjson',
  'generations.json',
  'checksum.json',
] as const;
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

type CampaignTable =
  | 'world_bibles'
  | 'world_facts'
  | 'player_characters'
  | 'taverns'
  | 'npcs'
  | 'npc_knowledge'
  | 'npc_relationships'
  | 'quests'
  | 'adventures'
  | 'adventure_turns'
  | 'conversations'
  | 'messages'
  | 'items'
  | 'world_clocks';

const TABLE_QUERIES: Readonly<Record<CampaignTable, string>> = {
  world_bibles: 'SELECT * FROM world_bibles WHERE campaign_id = ? ORDER BY campaign_id',
  world_facts: 'SELECT * FROM world_facts WHERE campaign_id = ? ORDER BY id',
  player_characters: 'SELECT * FROM player_characters WHERE campaign_id = ? ORDER BY id',
  taverns: 'SELECT * FROM taverns WHERE campaign_id = ? ORDER BY id',
  npcs: 'SELECT * FROM npcs WHERE campaign_id = ? ORDER BY id',
  npc_knowledge: `SELECT npc_knowledge.* FROM npc_knowledge
    JOIN npcs ON npcs.id = npc_knowledge.npc_id
    WHERE npcs.campaign_id = ? ORDER BY npc_knowledge.npc_id`,
  npc_relationships: `SELECT npc_relationships.* FROM npc_relationships
    JOIN npcs ON npcs.id = npc_relationships.npc_id
    WHERE npcs.campaign_id = ? ORDER BY npc_relationships.npc_id`,
  quests: 'SELECT * FROM quests WHERE campaign_id = ? ORDER BY id',
  adventures: 'SELECT * FROM adventures WHERE campaign_id = ? ORDER BY id',
  adventure_turns: `SELECT adventure_turns.* FROM adventure_turns
    JOIN adventures ON adventures.id = adventure_turns.adventure_id
    WHERE adventures.campaign_id = ?
    ORDER BY adventure_turns.adventure_id, adventure_turns.turn_number, adventure_turns.id`,
  conversations: 'SELECT * FROM conversations WHERE campaign_id = ? ORDER BY id',
  messages: `SELECT messages.* FROM messages
    JOIN conversations ON conversations.id = messages.conversation_id
    WHERE conversations.campaign_id = ?
    ORDER BY messages.conversation_id, messages.sequence_number, messages.id`,
  items: 'SELECT * FROM items WHERE campaign_id = ? ORDER BY id',
  world_clocks: 'SELECT * FROM world_clocks WHERE campaign_id = ? ORDER BY id',
};

const JSON_COLUMNS: Readonly<Record<string, ReadonlySet<string>>> = {
  campaigns: new Set(['task_model_overrides_json']),
  world_bibles: new Set([
    'power_rules_json',
    'factions_json',
    'locations_json',
    'forbidden_elements_json',
    'story_hooks_json',
    'locked_fields_json',
  ]),
  world_facts: new Set(['faction_ids_json', 'detail_json']),
  player_characters: new Set([
    'story_preferences_json',
    'content_boundaries_json',
    'attributes_json',
    'traits_json',
    'background_json',
    'initial_equipment_ids_json',
  ]),
  taverns: new Set(['special_rules_json', 'changes_json']),
  npcs: new Set(['visit_json', 'memories_json']),
  npc_knowledge: new Set([
    'known_fact_ids_json',
    'suspected_fact_ids_json',
    'false_belief_fact_ids_json',
    'excluded_secret_fact_ids_json',
  ]),
  quests: new Set([
    'content_json',
    'recommended_attributes_json',
    'related_npc_ids_json',
    'related_fact_ids_json',
  ]),
  adventures: new Set(['plan_json', 'clues_json', 'ending_json']),
  adventure_turns: new Set([
    'speaker_npc_ids_json',
    'suggested_actions_json',
    'player_action_json',
    'check_request_json',
    'dice_result_json',
  ]),
  items: new Set(['content_json', 'effect_json']),
  world_clocks: new Set(['stages_json']),
  game_events: new Set(['payload_json']),
  generation_records: new Set(['request_json', 'validated_output_json', 'validation_error_json']),
};

export interface CampaignSaveExportOptions {
  readonly createdAt: IsoTimestamp;
  readonly generatorVersion: string;
}

export interface CampaignSaveManifest {
  readonly application: 'ember-tavern';
  readonly campaignId: string;
  readonly createdAt: string;
  readonly databaseSchemaVersion: number;
  readonly files: Readonly<{
    'campaign.json': Readonly<{ mediaType: 'application/json'; records: 1 }>;
    'events.ndjson': Readonly<{ mediaType: 'application/x-ndjson'; records: number }>;
    'generations.json': Readonly<{ mediaType: 'application/json'; records: number }>;
  }>;
  readonly formatVersion: 1;
  readonly generatorVersion: string;
}

export interface CampaignSaveExport {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly manifest: CampaignSaveManifest;
  readonly checksums: Readonly<Record<string, string>>;
}

export function exportCampaignSave(
  database: TransactionalSqliteDatabase,
  campaignId: CampaignId,
  options: CampaignSaveExportOptions,
): CampaignSaveExport {
  requireExportOptions(options);
  database.exec('BEGIN');
  let captured: CapturedSave;
  try {
    assertDatabaseReady(database);
    captured = captureSave(database, campaignId, options);
    database.exec('COMMIT');
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Save export and rollback both failed', {
        cause: rollbackError,
      });
    }
    throw error;
  }

  const encoded = encodeFiles(captured);
  const uncompressedSize = encoded.entries.reduce((total, entry) => total + entry.data.length, 0);
  if (uncompressedSize > MAX_ARCHIVE_BYTES) {
    throw new PersistenceDataError('Exported save exceeds the 256 MiB archive limit');
  }
  const bytes = encodeStoredZip(encoded.entries, options.createdAt);
  if (bytes.length > MAX_ARCHIVE_BYTES) {
    throw new PersistenceDataError('Exported save exceeds the 256 MiB archive limit');
  }
  return Object.freeze({
    fileName: `${safeFileStem(campaignId)}.emtavern`,
    bytes,
    manifest: captured.manifest,
    checksums: Object.freeze({ ...encoded.checksums }),
  });
}

interface CapturedSave {
  readonly manifest: CampaignSaveManifest;
  readonly campaignDocument: unknown;
  readonly eventRows: readonly StoredRow[];
  readonly generationDocument: unknown;
}

function captureSave(
  database: TransactionalSqliteDatabase,
  campaignId: CampaignId,
  options: CampaignSaveExportOptions,
): CapturedSave {
  const sourceCampaign = database.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (sourceCampaign === undefined) {
    throw new PersistenceDataError(`Campaign not found for export: ${campaignId}`);
  }
  const campaign = normalizeRow('campaigns', sourceCampaign);
  const tables = campaignTableRecord((table) =>
    Object.freeze(
      database
        .prepare(TABLE_QUERIES[table])
        .all(campaignId)
        .map((row) => normalizeRow(table, row)),
    ),
  );
  const eventRows = Object.freeze(
    database
      .prepare(`SELECT * FROM game_events WHERE campaign_id = ? ORDER BY occurred_at, id`)
      .all(campaignId)
      .map((row) => normalizeRow('game_events', row)),
  );
  const generationRows = Object.freeze(
    database
      .prepare(`SELECT * FROM generation_records WHERE campaign_id = ? ORDER BY started_at, id`)
      .all(campaignId)
      .map((row) => normalizeRow('generation_records', row)),
  );
  const normalizedCampaign = Object.freeze({
    ...campaign,
    default_model_profile_id: null,
    fallback_model_profile_id: null,
    task_model_overrides_json: '{}',
  });
  const normalizedGenerations = Object.freeze(
    generationRows.map((row) => Object.freeze({ ...row, model_profile_id: null })),
  );
  const manifest: CampaignSaveManifest = Object.freeze({
    application: 'ember-tavern',
    campaignId,
    createdAt: options.createdAt,
    databaseSchemaVersion: ARCHIVE_DATABASE_SCHEMA_VERSION,
    files: Object.freeze({
      'campaign.json': Object.freeze({ mediaType: 'application/json', records: 1 }),
      'events.ndjson': Object.freeze({
        mediaType: 'application/x-ndjson',
        records: eventRows.length,
      }),
      'generations.json': Object.freeze({
        mediaType: 'application/json',
        records: normalizedGenerations.length,
      }),
    }),
    formatVersion: FORMAT_VERSION,
    generatorVersion: options.generatorVersion,
  });
  return Object.freeze({
    manifest,
    campaignDocument: Object.freeze({
      campaign: normalizedCampaign,
      campaignId,
      databaseSchemaVersion: ARCHIVE_DATABASE_SCHEMA_VERSION,
      formatVersion: FORMAT_VERSION,
      tables,
    }),
    eventRows,
    generationDocument: Object.freeze({
      campaignId,
      databaseSchemaVersion: ARCHIVE_DATABASE_SCHEMA_VERSION,
      formatVersion: FORMAT_VERSION,
      records: normalizedGenerations,
    }),
  });
}

function encodeFiles(captured: CapturedSave): {
  readonly entries: readonly ZipEntry[];
  readonly checksums: Readonly<Record<string, string>>;
} {
  const encoder = new TextEncoder();
  const files = new Map<string, Uint8Array>([
    ['manifest.json', encoder.encode(`${canonicalJson(captured.manifest)}\n`)],
    ['campaign.json', encoder.encode(`${canonicalJson(captured.campaignDocument)}\n`)],
    [
      'events.ndjson',
      encoder.encode(
        captured.eventRows.length === 0
          ? ''
          : `${captured.eventRows.map(canonicalJson).join('\n')}\n`,
      ),
    ],
    ['generations.json', encoder.encode(`${canonicalJson(captured.generationDocument)}\n`)],
  ]);
  const checksums = Object.freeze(
    Object.fromEntries([...files].map(([name, bytes]) => [name, sha256(bytes)])),
  );
  const checksumDocument = {
    algorithm: 'SHA-256',
    files: checksums,
    formatVersion: FORMAT_VERSION,
  };
  files.set('checksum.json', encoder.encode(`${canonicalJson(checksumDocument)}\n`));
  return Object.freeze({
    entries: Object.freeze(
      ENTRY_NAMES.map((name) => {
        const data = files.get(name);
        if (data === undefined) throw new PersistenceDataError(`Missing export entry: ${name}`);
        return Object.freeze({ name, data });
      }),
    ),
    checksums,
  });
}

function assertDatabaseReady(database: TransactionalSqliteDatabase): void {
  const integrity = database.prepare('PRAGMA integrity_check').all();
  if (
    integrity.length !== 1 ||
    readRecord(integrity[0], 'integrity result')['integrity_check'] !== 'ok'
  ) {
    throw new PersistenceDataError('Database integrity check failed before save export');
  }
  if (database.prepare('PRAGMA foreign_key_check').all().length !== 0) {
    throw new PersistenceDataError('Database foreign-key check failed before save export');
  }
  const row = readRecord(
    database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get(),
    'schema version result',
  );
  if (row['version'] !== currentSchemaVersion) {
    throw new PersistenceDataError(
      `Database schema ${String(row['version'])} cannot be exported as ${currentSchemaVersion}`,
    );
  }
}

function normalizeRow(table: string, value: unknown): StoredRow {
  const source = readRecord(value, `${table} row`);
  const jsonColumns = JSON_COLUMNS[table] ?? new Set<string>();
  return Object.freeze(
    Object.fromEntries(
      Object.entries(source).map(([column, entry]) => {
        if (jsonColumns.has(column) && entry !== null) {
          if (typeof entry !== 'string') {
            throw new PersistenceDataError(`${table}.${column} must be JSON text`);
          }
          return [column, normalizeJsonText(entry, `${table}.${column}`)];
        }
        if (entry === null || typeof entry === 'string' || typeof entry === 'number') {
          if (typeof entry === 'number' && !Number.isFinite(entry)) {
            throw new PersistenceDataError(`${table}.${column} contains a non-finite number`);
          }
          if (table === 'generation_records' && column === 'raw_response_text') {
            scanJsonTextIfPresent(entry);
          }
          return [column, entry];
        }
        throw new PersistenceDataError(`${table}.${column} has an unsupported storage type`);
      }),
    ),
  );
}

function normalizeJsonText(text: string, label: string): string {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new PersistenceDataError(`${label} is not valid JSON`, { cause: error });
  }
  assertNoSecretKeys(value, label);
  return canonicalJson(value);
}

function scanJsonTextIfPresent(value: StoredScalar): void {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return;
  try {
    assertNoSecretKeys(JSON.parse(trimmed) as unknown, 'generation_records.raw_response_text');
  } catch (error) {
    if (error instanceof PersistenceDataError) throw error;
  }
}

function assertNoSecretKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretKeys(entry, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (isForbiddenSecretKey(key)) {
      throw new PersistenceDataError(`Save export contains forbidden secret field at ${path}`);
    }
    assertNoSecretKeys(entry, `${path}.${key}`);
  }
}

function isForbiddenSecretKey(key: string): boolean {
  const normalized = key.replaceAll(/[_-]/g, '').toLowerCase();
  return (
    normalized.includes('apikey') ||
    normalized === 'authorization' ||
    normalized === 'bearer' ||
    normalized.includes('accesstoken') ||
    normalized.includes('secretkey') ||
    normalized.includes('credentialref') ||
    normalized === 'cookie' ||
    normalized === 'password' ||
    normalized === 'token'
  );
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PersistenceDataError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireExportOptions(options: CampaignSaveExportOptions): void {
  if (options.generatorVersion.trim().length === 0 || options.generatorVersion.length > 100) {
    throw new PersistenceDataError('Save generatorVersion must be 1-100 characters');
  }
  const date = new Date(options.createdAt);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== options.createdAt) {
    throw new PersistenceDataError('Save createdAt must be canonical UTC RFC3339');
  }
}

function safeFileStem(campaignId: string): string {
  const withoutControls = [...campaignId]
    .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('');
  const stem = withoutControls.replaceAll(/[<>:"/\\|?*]/g, '_').replace(/[. ]+$/u, '');
  return stem.length === 0 ? 'campaign' : stem.slice(0, 120);
}

function campaignTableRecord(
  values: (table: CampaignTable) => readonly StoredRow[],
): Record<CampaignTable, readonly StoredRow[]> {
  return {
    world_bibles: values('world_bibles'),
    world_facts: values('world_facts'),
    player_characters: values('player_characters'),
    taverns: values('taverns'),
    npcs: values('npcs'),
    npc_knowledge: values('npc_knowledge'),
    npc_relationships: values('npc_relationships'),
    quests: values('quests'),
    adventures: values('adventures'),
    adventure_turns: values('adventure_turns'),
    conversations: values('conversations'),
    messages: values('messages'),
    items: values('items'),
    world_clocks: values('world_clocks'),
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new PersistenceDataError('Save contains non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(row[key])}`)
      .join(',')}}`;
  }
  throw new PersistenceDataError('Save contains unsupported JSON value');
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

function encodeStoredZip(entries: readonly ZipEntry[], createdAt: IsoTimestamp): Uint8Array {
  const nameEncoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  const { date, time } = dosDateTime(createdAt);
  for (const entry of entries) {
    const name = nameEncoder.encode(entry.name);
    const checksum = crc32(entry.data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, entry.data.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);
    localParts.push(local, entry.data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, entry.data.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length + entry.data.length;
  }
  const centralOffset = localOffset;
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  endView.setUint16(20, 0, true);
  return concatenate([...localParts, ...centralParts, end]);
}

function dosDateTime(value: IsoTimestamp): { readonly date: number; readonly time: number } {
  const parsed = new Date(value);
  const year = Math.min(2107, Math.max(1980, parsed.getUTCFullYear()));
  return {
    date: ((year - 1980) << 9) | ((parsed.getUTCMonth() + 1) << 5) | parsed.getUTCDate(),
    time:
      (parsed.getUTCHours() << 11) |
      (parsed.getUTCMinutes() << 5) |
      Math.floor(parsed.getUTCSeconds() / 2),
  };
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
