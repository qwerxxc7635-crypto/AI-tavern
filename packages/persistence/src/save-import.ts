import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

import {
  adventureId,
  campaignId,
  conversationId,
  gameEventId,
  generationRecordId,
  itemId,
  npcId,
  playerCharacterId,
  questId,
  schemaVersion,
  tavernId,
  worldClockId,
  type Campaign,
  type CampaignId,
  type IsoTimestamp,
  type SaveSnapshot,
  type SnapshotId,
} from '@ember-tavern/contracts';

import { CampaignRepository, PersistenceDataError } from './campaign-repository.js';
import {
  ConversationRepository,
  ItemRepository,
  WorldClockRepository,
} from './conversation-item-clock-repository.js';
import { GameEventRepository } from './game-event-repository.js';
import { GenerationRecordRepository } from './generation-record-repository.js';
import { PlayerCharacterRepository } from './player-character-repository.js';
import { AdventureRepository, QuestRepository } from './quest-adventure-repository.js';
import { SnapshotRepository } from './snapshot-repository.js';
import {
  MAX_ARCHIVE_BYTES,
  MAX_EVENT_RECORDS,
  MAX_GENERATION_RECORDS,
  MAX_JSON_ARRAY_LENGTH,
  MAX_TABLE_RECORDS,
  MAX_TOTAL_RECORDS,
  addExpandedBytes,
  archiveEntrySizeLimit,
  validateArchiveEntryResources,
  validateJsonTextResources,
  validateJsonValueResources,
  validateRecordCount,
} from './save-resource-limits.js';
import type { SqliteValue, TransactionalSqliteDatabase } from './sqlite-port.js';
import { NpcRepository, TavernRepository } from './tavern-npc-repository.js';
import { WorldRepository } from './world-repository.js';

type StoredScalar = string | number | null;
type StoredRow = Readonly<Record<string, StoredScalar>>;
type ImportMode = 'CREATE' | 'OVERWRITE';

const FORMAT_VERSION = 1;
const ARCHIVE_DATABASE_SCHEMA_VERSION = 1;
const ENTRY_NAMES = [
  'manifest.json',
  'campaign.json',
  'events.ndjson',
  'generations.json',
  'checksum.json',
] as const;
const ENTRY_NAME_SET = new Set<string>(ENTRY_NAMES);
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

const CAMPAIGN_TABLES = [
  'world_bibles',
  'world_facts',
  'player_characters',
  'taverns',
  'npcs',
  'npc_knowledge',
  'npc_relationships',
  'quests',
  'adventures',
  'adventure_turns',
  'conversations',
  'messages',
  'items',
  'world_clocks',
] as const satisfies readonly CampaignTable[];

const INSERT_ORDER = [
  'world_bibles',
  'world_facts',
  'player_characters',
  'taverns',
  'npcs',
  'npc_knowledge',
  'npc_relationships',
  'quests',
  'adventures',
  'adventure_turns',
  'conversations',
  'messages',
  'items',
  'world_clocks',
] as const satisfies readonly CampaignTable[];

export interface CampaignSaveImportOptions {
  readonly mode: ImportMode;
  readonly importedAt: IsoTimestamp;
  readonly snapshotId: SnapshotId;
  readonly prepareOverwriteBackup?: (() => void | Promise<void>) | undefined;
}

export interface CampaignSaveImportResult {
  readonly campaign: Campaign;
  readonly snapshot: SaveSnapshot;
  readonly importedEventCount: number;
  readonly importedGenerationCount: number;
}

export async function importCampaignSave(
  database: TransactionalSqliteDatabase,
  archive: Uint8Array,
  options: CampaignSaveImportOptions,
): Promise<CampaignSaveImportResult> {
  requireImportOptions(options);
  const parsed = parseArchive(archive);
  const existing = new CampaignRepository(database).get(parsed.campaignId);
  if (options.mode === 'CREATE' && existing !== null) {
    throw new PersistenceDataError(`Campaign already exists: ${parsed.campaignId}`);
  }
  if (options.mode === 'OVERWRITE') {
    if (existing === null) {
      throw new PersistenceDataError(`Campaign does not exist for overwrite: ${parsed.campaignId}`);
    }
    if (options.prepareOverwriteBackup === undefined) {
      throw new PersistenceDataError('Overwrite import requires a completed backup callback');
    }
    await options.prepareOverwriteBackup();
  }

  database.exec('BEGIN IMMEDIATE');
  try {
    const current = new CampaignRepository(database).get(parsed.campaignId);
    if (options.mode === 'CREATE' && current !== null) {
      throw new PersistenceDataError(`Campaign already exists: ${parsed.campaignId}`);
    }
    if (options.mode === 'OVERWRITE' && current === null) {
      throw new PersistenceDataError(`Campaign disappeared before overwrite: ${parsed.campaignId}`);
    }
    database.exec('PRAGMA defer_foreign_keys = ON');
    if (options.mode === 'OVERWRITE') {
      database.prepare('DELETE FROM campaigns WHERE id = ?').run(parsed.campaignId);
    }
    insertRow(database, 'campaigns', parsed.campaign);
    for (const row of parsed.generations) insertRow(database, 'generation_records', row);
    for (const table of INSERT_ORDER) {
      for (const row of parsed.tables[table]) insertRow(database, table, row);
    }
    for (const row of parsed.events) insertRow(database, 'game_events', row);
    assertForeignKeys(database);
    validateImportedDomain(database, parsed);
    const snapshot = new SnapshotRepository(database).createInCurrentTransaction({
      id: options.snapshotId,
      campaignId: parsed.campaignId,
      kind: 'IMPORT',
      reason: `IMPORT:${options.importedAt}`,
      schemaVersion: schemaVersion(
        requirePositiveInteger(parsed.campaign['schema_version'], 'campaign.schema_version'),
      ),
      createdAt: options.importedAt,
    });
    assertForeignKeys(database);
    const campaign = new CampaignRepository(database).get(parsed.campaignId);
    if (campaign === null)
      throw new PersistenceDataError('Imported campaign could not be reloaded');
    database.exec('COMMIT');
    return Object.freeze({
      campaign,
      snapshot,
      importedEventCount: parsed.events.length,
      importedGenerationCount: parsed.generations.length,
    });
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Save import and rollback both failed', {
        cause: rollbackError,
      });
    }
    throw error;
  }
}

interface ParsedArchive {
  readonly campaignId: CampaignId;
  readonly databaseSchemaVersion: number;
  readonly campaign: StoredRow;
  readonly tables: Readonly<Record<CampaignTable, readonly StoredRow[]>>;
  readonly events: readonly StoredRow[];
  readonly generations: readonly StoredRow[];
}

function parseArchive(archive: Uint8Array): ParsedArchive {
  const zip = readZipArchive(archive);
  const checksum = parseCanonicalDocument(
    decodeUtf8(zip.read('checksum.json'), 'checksum.json'),
    'checksum.json',
  );
  const expectedChecksums = validateChecksumDocument(checksum);
  const readVerified = (name: keyof typeof expectedChecksums): Uint8Array => {
    const bytes = zip.read(name);
    if (sha256(bytes) !== expectedChecksums[name]) {
      throw new PersistenceDataError(`Save checksum mismatch: ${name}`);
    }
    return bytes;
  };
  const manifest = parseCanonicalDocument(
    decodeUtf8(readVerified('manifest.json'), 'manifest.json'),
    'manifest.json',
  );
  const campaignIdValue = requireString(manifest['campaignId'], 'manifest.campaignId');
  const importedCampaignId = campaignId(campaignIdValue);
  requireExactKeys(
    manifest,
    [
      'application',
      'campaignId',
      'createdAt',
      'databaseSchemaVersion',
      'files',
      'formatVersion',
      'generatorVersion',
    ],
    'manifest.json',
  );
  if (manifest['application'] !== 'ember-tavern' || manifest['formatVersion'] !== FORMAT_VERSION) {
    throw new PersistenceDataError('Unsupported save manifest');
  }
  requireCanonicalTimestamp(manifest['createdAt'], 'manifest.createdAt');
  const generatorVersion = requireString(manifest['generatorVersion'], 'manifest.generatorVersion');
  if (generatorVersion.trim() !== generatorVersion || generatorVersion.length > 100) {
    throw new PersistenceDataError('manifest.generatorVersion must be 1-100 canonical characters');
  }
  const databaseVersion = requirePositiveInteger(
    manifest['databaseSchemaVersion'],
    'manifest.databaseSchemaVersion',
  );
  if (databaseVersion !== ARCHIVE_DATABASE_SCHEMA_VERSION) {
    throw new PersistenceDataError(
      databaseVersion > ARCHIVE_DATABASE_SCHEMA_VERSION
        ? `Save schema ${databaseVersion} is newer than supported schema ${ARCHIVE_DATABASE_SCHEMA_VERSION}`
        : `Save schema ${databaseVersion} requires an unavailable migration`,
    );
  }
  const campaignDocument = parseCanonicalDocument(
    decodeUtf8(readVerified('campaign.json'), 'campaign.json'),
    'campaign.json',
  );
  const generationDocument = parseCanonicalDocument(
    decodeUtf8(readVerified('generations.json'), 'generations.json'),
    'generations.json',
  );
  requireEnvelope(campaignDocument, importedCampaignId, databaseVersion, 'campaign.json');
  requireEnvelope(generationDocument, importedCampaignId, databaseVersion, 'generations.json');
  requireExactKeys(
    campaignDocument,
    ['campaign', 'campaignId', 'databaseSchemaVersion', 'formatVersion', 'tables'],
    'campaign.json',
  );
  requireExactKeys(
    generationDocument,
    ['campaignId', 'databaseSchemaVersion', 'formatVersion', 'records'],
    'generations.json',
  );
  const campaign = parseStoredRow(campaignDocument['campaign'], 'campaigns');
  if (
    campaign['id'] !== importedCampaignId ||
    campaign['default_model_profile_id'] !== null ||
    campaign['fallback_model_profile_id'] !== null ||
    campaign['task_model_overrides_json'] !== '{}'
  ) {
    throw new PersistenceDataError('Campaign archive model bindings are not portable');
  }
  const tableRoot = requireRecord(campaignDocument['tables'], 'campaign.tables');
  requireExactKeys(tableRoot, [...CAMPAIGN_TABLES], 'campaign.tables');
  const tables = campaignTableRecord((table) =>
    Object.freeze(
      requireRecordArray(tableRoot[table], `campaign.tables.${table}`, MAX_TABLE_RECORDS).map(
        (row) => parseStoredRow(row, table),
      ),
    ),
  );
  const tableRecordCount = Object.values(tables).reduce((total, rows) => total + rows.length, 0);
  const generations = Object.freeze(
    requireRecordArray(
      generationDocument['records'],
      'generations.records',
      MAX_GENERATION_RECORDS,
    ).map((row) => {
      const parsed = parseStoredRow(row, 'generation_records');
      if (parsed['campaign_id'] !== importedCampaignId || parsed['model_profile_id'] !== null) {
        throw new PersistenceDataError('Generation archive scope or model binding is invalid');
      }
      return parsed;
    }),
  );
  const events = parseEvents(
    decodeUtf8(readVerified('events.ndjson'), 'events.ndjson'),
    importedCampaignId,
  );
  if (1 + tableRecordCount + generations.length + events.length > MAX_TOTAL_RECORDS) {
    throw new PersistenceDataError('Save archive exceeds the total record limit');
  }
  validateManifestCounts(manifest, events.length, generations.length);
  return Object.freeze({
    campaignId: importedCampaignId,
    databaseSchemaVersion: databaseVersion,
    campaign,
    tables,
    events,
    generations,
  });
}

function validateChecksumDocument(checksum: Record<string, unknown>): Readonly<{
  'campaign.json': string;
  'events.ndjson': string;
  'generations.json': string;
  'manifest.json': string;
}> {
  requireExactKeys(checksum, ['algorithm', 'files', 'formatVersion'], 'checksum.json');
  if (checksum['algorithm'] !== 'SHA-256' || checksum['formatVersion'] !== FORMAT_VERSION) {
    throw new PersistenceDataError('Unsupported checksum manifest');
  }
  const files = requireRecord(checksum['files'], 'checksum.files');
  const hashedNames = ['campaign.json', 'events.ndjson', 'generations.json', 'manifest.json'];
  requireExactKeys(files, hashedNames, 'checksum.files');
  const result = Object.fromEntries(
    hashedNames.map((name) => {
      const expected = requireString(files[name], `checksum.files.${name}`);
      if (!/^[0-9a-f]{64}$/u.test(expected)) {
        throw new PersistenceDataError(`Save checksum is invalid: ${name}`);
      }
      return [name, expected];
    }),
  );
  return Object.freeze(result) as Readonly<{
    'campaign.json': string;
    'events.ndjson': string;
    'generations.json': string;
    'manifest.json': string;
  }>;
}

function validateManifestCounts(
  manifest: Record<string, unknown>,
  eventCount: number,
  generationCount: number,
): void {
  const files = requireRecord(manifest['files'], 'manifest.files');
  requireExactKeys(files, ['campaign.json', 'events.ndjson', 'generations.json'], 'manifest.files');
  const expected = {
    'campaign.json': ['application/json', 1],
    'events.ndjson': ['application/x-ndjson', eventCount],
    'generations.json': ['application/json', generationCount],
  } as const;
  for (const [name, [mediaType, records]] of Object.entries(expected)) {
    const entry = requireRecord(files[name], `manifest.files.${name}`);
    requireExactKeys(entry, ['mediaType', 'records'], `manifest.files.${name}`);
    if (entry['mediaType'] !== mediaType || entry['records'] !== records) {
      throw new PersistenceDataError(`Manifest count or media type mismatch: ${name}`);
    }
  }
}

function requireEnvelope(
  document: Record<string, unknown>,
  expectedCampaignId: CampaignId,
  databaseVersion: number,
  label: string,
): void {
  if (
    document['campaignId'] !== expectedCampaignId ||
    document['databaseSchemaVersion'] !== databaseVersion ||
    document['formatVersion'] !== FORMAT_VERSION
  ) {
    throw new PersistenceDataError(`${label} envelope does not match manifest`);
  }
}

function parseEvents(text: string, expectedCampaignId: CampaignId): readonly StoredRow[] {
  if (text.length === 0) return Object.freeze([]);
  if (!text.endsWith('\n')) throw new PersistenceDataError('events.ndjson must end with LF');
  const lines = text.slice(0, -1).split('\n');
  validateRecordCount('events.ndjson', lines.length, MAX_EVENT_RECORDS);
  return Object.freeze(
    lines.map((line, index) => {
      if (line.length === 0) throw new PersistenceDataError('events.ndjson contains an empty line');
      const value = parseJson(line, `events.ndjson line ${index + 1}`);
      if (canonicalJson(value) !== line) {
        throw new PersistenceDataError(`events.ndjson line ${index + 1} is not canonical JSON`);
      }
      const row = parseStoredRow(value, 'game_events');
      if (row['campaign_id'] !== expectedCampaignId) {
        throw new PersistenceDataError('Event belongs to another campaign');
      }
      return row;
    }),
  );
}

function insertRow(database: TransactionalSqliteDatabase, table: string, row: StoredRow): void {
  const allowed = tableColumns(database, table);
  const keys = Object.keys(row).sort();
  if (keys.length !== allowed.length || keys.some((key, index) => key !== allowed[index])) {
    throw new PersistenceDataError(`Save row does not match current table schema: ${table}`);
  }
  const columns = allowed.map(quoteIdentifier).join(', ');
  const placeholders = allowed.map(() => '?').join(', ');
  database
    .prepare(`INSERT INTO ${quoteIdentifier(table)} (${columns}) VALUES (${placeholders})`)
    .run(...allowed.map((column) => row[column] as SqliteValue));
}

function tableColumns(database: TransactionalSqliteDatabase, table: string): readonly string[] {
  const rows = database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
  if (rows.length === 0) throw new PersistenceDataError(`Unknown import table: ${table}`);
  return Object.freeze(
    rows
      .map((row) => requireString(requireRecord(row, 'table_info row')['name'], 'column name'))
      .sort(),
  );
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function validateImportedDomain(
  database: TransactionalSqliteDatabase,
  parsed: ParsedArchive,
): void {
  const campaign = new CampaignRepository(database);
  if (campaign.get(parsed.campaignId) === null)
    throw new PersistenceDataError('Campaign is invalid');
  campaign.getModelSwitchPolicy(parsed.campaignId);
  const worlds = new WorldRepository(database);
  if (parsed.tables.world_bibles.length > 0 && worlds.getBible(parsed.campaignId) === null) {
    throw new PersistenceDataError('World bible is invalid');
  }
  worlds.listFacts(parsed.campaignId);
  const characters = new PlayerCharacterRepository(database);
  parsed.tables.player_characters.forEach((row) =>
    requireReloaded(
      characters.get(playerCharacterId(requireString(row['id'], 'character id'))),
      'character',
    ),
  );
  const taverns = new TavernRepository(database);
  parsed.tables.taverns.forEach((row) =>
    requireReloaded(taverns.get(tavernId(requireString(row['id'], 'tavern id'))), 'tavern'),
  );
  const npcs = new NpcRepository(database);
  parsed.tables.npcs.forEach((row) => {
    const id = npcId(requireString(row['id'], 'npc id'));
    requireReloaded(npcs.get(id), 'NPC');
    npcs.listMemories(id);
  });
  parsed.tables.npc_knowledge.forEach((row) =>
    requireReloaded(
      npcs.getKnowledge(npcId(requireString(row['npc_id'], 'knowledge npc id'))),
      'NPC knowledge',
    ),
  );
  parsed.tables.npc_relationships.forEach((row) =>
    requireReloaded(
      npcs.getRelationship(npcId(requireString(row['npc_id'], 'relationship npc id'))),
      'NPC relationship',
    ),
  );
  const quests = new QuestRepository(database);
  parsed.tables.quests.forEach((row) =>
    requireReloaded(quests.get(questId(requireString(row['id'], 'quest id'))), 'quest'),
  );
  const adventures = new AdventureRepository(database);
  parsed.tables.adventures.forEach((row) => {
    const id = adventureId(requireString(row['id'], 'adventure id'));
    requireReloaded(adventures.get(id), 'adventure');
    adventures.getClues(id);
    adventures.getEnding(id);
    adventures.listTurns(id);
  });
  const conversations = new ConversationRepository(database);
  parsed.tables.conversations.forEach((row) => {
    const id = conversationId(requireString(row['id'], 'conversation id'));
    requireReloaded(conversations.get(id), 'conversation');
    conversations.listMessages(id);
  });
  const items = new ItemRepository(database);
  parsed.tables.items.forEach((row) =>
    requireReloaded(items.get(itemId(requireString(row['id'], 'item id'))), 'item'),
  );
  const clocks = new WorldClockRepository(database);
  parsed.tables.world_clocks.forEach((row) =>
    requireReloaded(clocks.get(worldClockId(requireString(row['id'], 'clock id'))), 'world clock'),
  );
  const events = new GameEventRepository(database);
  parsed.events.forEach((row) =>
    requireReloaded(events.get(gameEventId(requireString(row['id'], 'event id'))), 'event'),
  );
  const generations = new GenerationRecordRepository(database);
  parsed.generations.forEach((row) =>
    requireReloaded(
      generations.get(generationRecordId(requireString(row['id'], 'generation id'))),
      'generation record',
    ),
  );
}

function requireReloaded(value: unknown, label: string): void {
  if (value === null) throw new PersistenceDataError(`Imported ${label} could not be reloaded`);
}

function assertForeignKeys(database: TransactionalSqliteDatabase): void {
  if (database.prepare('PRAGMA foreign_key_check').all().length !== 0) {
    throw new PersistenceDataError('Imported save violates foreign keys');
  }
}

function parseStoredRow(value: unknown, label: string): StoredRow {
  const record = requireRecord(value, `${label} row`);
  return Object.freeze(
    Object.fromEntries(
      Object.entries(record).map(([key, entry]) => {
        if (entry !== null && typeof entry !== 'string' && typeof entry !== 'number') {
          throw new PersistenceDataError(`${label}.${key} is not a SQLite scalar`);
        }
        if (typeof entry === 'number' && !Number.isFinite(entry)) {
          throw new PersistenceDataError(`${label}.${key} is not finite`);
        }
        if (key.endsWith('_json') && entry !== null) {
          if (typeof entry !== 'string')
            throw new PersistenceDataError(`${label}.${key} is not JSON text`);
          const decoded = parseJson(entry, `${label}.${key}`);
          if (canonicalJson(decoded) !== entry) {
            throw new PersistenceDataError(`${label}.${key} is not canonical JSON text`);
          }
          assertNoSecretKeys(decoded, `${label}.${key}`);
        }
        if (label === 'generation_records' && key === 'raw_response_text') {
          scanJsonTextIfPresent(entry);
        }
        return [key, entry];
      }),
    ),
  );
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

function parseCanonicalDocument(text: string, label: string): Record<string, unknown> {
  if (!text.endsWith('\n')) throw new PersistenceDataError(`${label} must end with LF`);
  const withoutLf = text.slice(0, -1);
  const value = parseJson(withoutLf, label);
  if (canonicalJson(value) !== withoutLf) {
    throw new PersistenceDataError(`${label} is not canonical JSON`);
  }
  return requireRecord(value, label);
}

function parseJson(text: string, label: string): unknown {
  validateJsonTextResources(text, label);
  try {
    const value = JSON.parse(text) as unknown;
    validateJsonValueResources(value, label);
    return value;
  } catch (error) {
    throw new PersistenceDataError(`${label} is not valid JSON`, { cause: error });
  }
}

function assertNoSecretKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretKeys(entry, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.replaceAll(/[_-]/g, '').toLowerCase();
    if (
      normalized.includes('apikey') ||
      normalized === 'authorization' ||
      normalized === 'bearer' ||
      normalized.includes('accesstoken') ||
      normalized.includes('secretkey') ||
      normalized.includes('credentialref') ||
      normalized === 'cookie' ||
      normalized === 'password' ||
      normalized === 'token'
    ) {
      throw new PersistenceDataError(`Imported save contains a forbidden secret field at ${path}`);
    }
    assertNoSecretKeys(entry, `${path}.${key}`);
  }
}

interface ZipEntryDescriptor {
  readonly compressed: Uint8Array;
  readonly expectedCrc: number;
  readonly method: number;
  readonly name: string;
  readonly uncompressedSize: number;
}

interface BoundedZipArchive {
  read(name: string): Uint8Array;
}

function readZipArchive(archive: Uint8Array): BoundedZipArchive {
  if (archive.length > MAX_ARCHIVE_BYTES || archive.length < 22) {
    throw new PersistenceDataError('Save archive size is invalid');
  }
  const endOffset = archive.length - 22;
  const end = viewAt(archive, endOffset, 22, 'ZIP end record');
  if (
    end.getUint32(0, true) !== 0x06054b50 ||
    end.getUint16(4, true) !== 0 ||
    end.getUint16(6, true) !== 0 ||
    end.getUint16(8, true) !== end.getUint16(10, true) ||
    end.getUint16(20, true) !== 0
  ) {
    throw new PersistenceDataError('Save ZIP end record is invalid');
  }
  const entryCount = end.getUint16(10, true);
  const centralSize = end.getUint32(12, true);
  const centralOffset = end.getUint32(16, true);
  if (
    entryCount !== ENTRY_NAMES.length ||
    centralOffset + centralSize !== endOffset ||
    centralOffset > archive.length
  ) {
    throw new PersistenceDataError('Save ZIP central directory is invalid');
  }
  const entries = new Map<string, ZipEntryDescriptor>();
  let offset = centralOffset;
  let uncompressedTotal = 0;
  for (let index = 0; index < entryCount; index += 1) {
    const central = viewAt(archive, offset, 46, 'ZIP central header');
    if (central.getUint32(0, true) !== 0x02014b50) {
      throw new PersistenceDataError('Save ZIP central header is invalid');
    }
    const flags = central.getUint16(8, true);
    const method = central.getUint16(10, true);
    const expectedCrc = central.getUint32(16, true);
    const compressedSize = central.getUint32(20, true);
    const uncompressedSize = central.getUint32(24, true);
    const nameLength = central.getUint16(28, true);
    const extraLength = central.getUint16(30, true);
    const commentLength = central.getUint16(32, true);
    const localOffset = central.getUint32(42, true);
    const creatorSystem = central.getUint16(4, true) >>> 8;
    const unixMode = central.getUint32(38, true) >>> 16;
    if (
      (flags & ~0x0808) !== 0 ||
      (method !== 0 && method !== 8) ||
      central.getUint16(34, true) !== 0 ||
      (creatorSystem === 3 && (unixMode & 0xf000) === 0xa000)
    ) {
      throw new PersistenceDataError('Save ZIP uses unsupported encryption, flags or compression');
    }
    const nameStart = offset + 46;
    viewAt(archive, nameStart, nameLength + extraLength + commentLength, 'ZIP central entry');
    const name = decodeUtf8(archive.slice(nameStart, nameStart + nameLength), 'ZIP entry name');
    validateEntryName(name, entries);
    validateArchiveEntryResources(name, compressedSize, uncompressedSize);
    offset = nameStart + nameLength + extraLength + commentLength;
    uncompressedTotal = addExpandedBytes(uncompressedTotal, uncompressedSize);
    const local = viewAt(archive, localOffset, 30, 'ZIP local header');
    if (
      local.getUint32(0, true) !== 0x04034b50 ||
      local.getUint16(6, true) !== flags ||
      local.getUint16(8, true) !== method
    ) {
      throw new PersistenceDataError('Save ZIP local header does not match central directory');
    }
    const localNameLength = local.getUint16(26, true);
    const localExtraLength = local.getUint16(28, true);
    const localNameStart = localOffset + 30;
    viewAt(archive, localNameStart, localNameLength + localExtraLength, 'ZIP local entry header');
    const localName = decodeUtf8(
      archive.slice(localNameStart, localNameStart + localNameLength),
      'ZIP local entry name',
    );
    if (localName !== name) throw new PersistenceDataError('Save ZIP entry names do not match');
    const dataStart = localNameStart + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralOffset) throw new PersistenceDataError('Save ZIP entry range is invalid');
    const compressed = archive.subarray(dataStart, dataEnd);
    entries.set(
      name,
      Object.freeze({
        compressed,
        expectedCrc,
        method,
        name,
        uncompressedSize,
      }),
    );
  }
  if (offset !== endOffset || entries.size !== ENTRY_NAMES.length) {
    throw new PersistenceDataError('Save ZIP has missing or duplicate entries');
  }
  return Object.freeze({
    read(name: string): Uint8Array {
      const entry = entries.get(name);
      if (entry === undefined) throw new PersistenceDataError(`Missing save entry: ${name}`);
      let data: Uint8Array;
      try {
        data =
          entry.method === 0
            ? entry.compressed
            : new Uint8Array(
                inflateRawSync(entry.compressed, {
                  maxOutputLength: Math.min(
                    entry.uncompressedSize + 1,
                    (archiveEntrySizeLimit(entry.name) ?? 0) + 1,
                  ),
                }),
              );
      } catch (error) {
        throw new PersistenceDataError(`Save ZIP entry cannot be decompressed: ${entry.name}`, {
          cause: error,
        });
      }
      if (data.length !== entry.uncompressedSize || crc32(data) !== entry.expectedCrc) {
        throw new PersistenceDataError(`Save ZIP CRC or size mismatch: ${entry.name}`);
      }
      return data;
    },
  });
}

function validateEntryName(name: string, entries: ReadonlyMap<string, unknown>): void {
  if (
    !ENTRY_NAME_SET.has(name) ||
    entries.has(name) ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..') ||
    name.includes('\u0000')
  ) {
    throw new PersistenceDataError(`Unsafe or unexpected save ZIP entry: ${name}`);
  }
}

function viewAt(bytes: Uint8Array, offset: number, length: number, label: string): DataView {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > bytes.length) {
    throw new PersistenceDataError(`${label} is outside the archive`);
  }
  return new DataView(bytes.buffer, bytes.byteOffset + offset, length);
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) throw new PersistenceDataError(`${label} contains a BOM`);
    return text;
  } catch (error) {
    if (error instanceof PersistenceDataError) throw error;
    throw new PersistenceDataError(`${label} is not valid UTF-8`, { cause: error });
  }
}

function requireImportOptions(options: CampaignSaveImportOptions): void {
  requireCanonicalTimestamp(options.importedAt, 'Import time');
}

function requireCanonicalTimestamp(value: unknown, label: string): string {
  const text = requireString(value, label);
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== text) {
    throw new PersistenceDataError(`${label} must be canonical UTC RFC3339`);
  }
  return text;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PersistenceDataError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new PersistenceDataError(`${label} must be an array`);
  if (value.length > MAX_JSON_ARRAY_LENGTH) {
    throw new PersistenceDataError(`${label} exceeds the JSON array limit`);
  }
  return value;
}

function requireRecordArray(value: unknown, label: string, limit: number): readonly unknown[] {
  const records = requireArray(value, label);
  validateRecordCount(label, records.length, limit);
  return records;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PersistenceDataError(`${label} must be a non-empty string`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new PersistenceDataError(`${label} must be a positive safe integer`);
  }
  return value;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new PersistenceDataError(`${label} has missing or unknown fields`);
  }
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
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  throw new PersistenceDataError('Save contains unsupported JSON value');
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
