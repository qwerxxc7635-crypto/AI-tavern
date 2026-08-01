import { createHash } from 'node:crypto';

import {
  SNAPSHOT_KINDS,
  campaignId,
  isoTimestamp,
  schemaVersion,
  snapshotId,
  type CampaignId,
  type IsoTimestamp,
  type SaveSnapshot,
  type SchemaVersion,
  type SnapshotId,
  type SnapshotKind,
} from '@ember-tavern/contracts';

import { PersistenceDataError } from './campaign-repository.js';
import type { TransactionalSqliteDatabase } from './sqlite-port.js';

type StoredScalar = string | number | null;
type StoredRow = Readonly<Record<string, StoredScalar>>;

interface SnapshotPayload {
  readonly formatVersion: 1;
  readonly campaignId: string;
  readonly campaign: StoredRow;
  readonly tables: Readonly<Record<SnapshotTable, readonly StoredRow[]>>;
}

export interface CreateSnapshot {
  readonly id: SnapshotId;
  readonly campaignId: CampaignId;
  readonly kind: SnapshotKind;
  readonly reason: string;
  readonly schemaVersion: SchemaVersion;
  readonly createdAt: IsoTimestamp;
}

type SnapshotTable =
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
  | 'world_clocks'
  | 'game_events';

const TABLE_QUERIES: Readonly<Record<SnapshotTable, string>> = {
  world_bibles: 'SELECT * FROM world_bibles WHERE campaign_id = ? ORDER BY campaign_id',
  world_facts: 'SELECT * FROM world_facts WHERE campaign_id = ? ORDER BY id',
  player_characters: 'SELECT * FROM player_characters WHERE campaign_id = ? ORDER BY id',
  taverns: 'SELECT * FROM taverns WHERE campaign_id = ? ORDER BY id',
  npcs: 'SELECT * FROM npcs WHERE campaign_id = ? ORDER BY id',
  npc_knowledge: `SELECT npc_knowledge.*
    FROM npc_knowledge JOIN npcs ON npcs.id = npc_knowledge.npc_id
    WHERE npcs.campaign_id = ? ORDER BY npc_knowledge.npc_id`,
  npc_relationships: `SELECT npc_relationships.*
    FROM npc_relationships JOIN npcs ON npcs.id = npc_relationships.npc_id
    WHERE npcs.campaign_id = ? ORDER BY npc_relationships.npc_id`,
  quests: 'SELECT * FROM quests WHERE campaign_id = ? ORDER BY id',
  adventures: 'SELECT * FROM adventures WHERE campaign_id = ? ORDER BY id',
  adventure_turns: `SELECT adventure_turns.*
    FROM adventure_turns JOIN adventures ON adventures.id = adventure_turns.adventure_id
    WHERE adventures.campaign_id = ? ORDER BY adventure_turns.id`,
  conversations: 'SELECT * FROM conversations WHERE campaign_id = ? ORDER BY id',
  messages: `SELECT messages.*
    FROM messages JOIN conversations ON conversations.id = messages.conversation_id
    WHERE conversations.campaign_id = ? ORDER BY messages.id`,
  items: 'SELECT * FROM items WHERE campaign_id = ? ORDER BY id',
  world_clocks: 'SELECT * FROM world_clocks WHERE campaign_id = ? ORDER BY id',
  game_events: 'SELECT * FROM game_events WHERE campaign_id = ? ORDER BY id',
};

const INSERT_ORDER: readonly SnapshotTable[] = [
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
  'game_events',
];

export class SnapshotRepository {
  public constructor(private readonly database: TransactionalSqliteDatabase) {}

  public create(input: CreateSnapshot): SaveSnapshot {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const snapshot = this.createInCurrentTransaction(input);
      this.database.exec('COMMIT');
      return snapshot;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Snapshot create and rollback both failed',
          {
            cause: rollbackError,
          },
        );
      }
      throw error;
    }
  }

  public createInCurrentTransaction(input: CreateSnapshot): SaveSnapshot {
    requireReason(input.reason);
    const existing = this.get(input.id);
    if (existing !== null) {
      if (!sameSnapshotIdentity(existing, input)) {
        throw new PersistenceDataError(`Snapshot ID is already in use: ${input.id}`);
      }
      return existing;
    }
    const payload = this.capturePayload(input.campaignId);
    const bytes = new TextEncoder().encode(canonicalJson(payload));
    const checksum = sha256(bytes);
    this.database
      .prepare(
        `INSERT INTO save_snapshots (
           id, campaign_id, kind, reason, schema_version, payload, checksum_sha256, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.campaignId,
        input.kind,
        input.reason,
        input.schemaVersion,
        bytes,
        checksum,
        input.createdAt,
      );
    if (input.kind === 'AUTO') this.pruneAuto(input.campaignId);
    return Object.freeze({ ...input, checksumSha256: checksum });
  }

  public get(id: SnapshotId): SaveSnapshot | null {
    const row = this.database
      .prepare(
        `SELECT id, campaign_id, kind, reason, schema_version, checksum_sha256, created_at
         FROM save_snapshots WHERE id = ?`,
      )
      .get(id);
    return row === undefined ? null : mapSnapshot(row);
  }

  public findLatest(campaign: CampaignId, reason?: string): SaveSnapshot | null {
    const row =
      reason === undefined
        ? this.database
            .prepare(
              `SELECT id, campaign_id, kind, reason, schema_version, checksum_sha256, created_at
               FROM save_snapshots WHERE campaign_id = ?
               ORDER BY created_at DESC, rowid DESC LIMIT 1`,
            )
            .get(campaign)
        : this.database
            .prepare(
              `SELECT id, campaign_id, kind, reason, schema_version, checksum_sha256, created_at
               FROM save_snapshots WHERE campaign_id = ? AND reason = ?
               ORDER BY created_at DESC, rowid DESC LIMIT 1`,
            )
            .get(campaign, reason);
    return row === undefined ? null : mapSnapshot(row);
  }

  public findLatestAutoByReasonPrefix(
    campaign: CampaignId,
    reasonPrefix: string,
  ): SaveSnapshot | null {
    requireReason(reasonPrefix);
    const row = this.database
      .prepare(
        `SELECT id, campaign_id, kind, reason, schema_version, checksum_sha256, created_at
         FROM save_snapshots
         WHERE campaign_id = ? AND kind = 'AUTO'
           AND substr(reason, 1, length(?)) = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(campaign, reasonPrefix, reasonPrefix);
    return row === undefined ? null : mapSnapshot(row);
  }

  public list(campaign: CampaignId, kind?: SnapshotKind): readonly SaveSnapshot[] {
    const rows =
      kind === undefined
        ? this.database
            .prepare(
              `SELECT id, campaign_id, kind, reason, schema_version, checksum_sha256, created_at
               FROM save_snapshots WHERE campaign_id = ?
               ORDER BY created_at DESC, rowid DESC`,
            )
            .all(campaign)
        : this.database
            .prepare(
              `SELECT id, campaign_id, kind, reason, schema_version, checksum_sha256, created_at
               FROM save_snapshots WHERE campaign_id = ? AND kind = ?
               ORDER BY created_at DESC, rowid DESC`,
            )
            .all(campaign, kind);
    return Object.freeze(rows.map(mapSnapshot));
  }

  public restore(id: SnapshotId): SaveSnapshot {
    const row = requireRow(
      this.database.prepare('SELECT * FROM save_snapshots WHERE id = ?').get(id),
      `Snapshot not found: ${id}`,
    );
    const snapshot = mapSnapshot(row);
    const bytes = requireBytes(row['payload'], 'snapshot payload');
    const checksum = requireString(row['checksum_sha256'], 'checksum_sha256');
    if (sha256(bytes) !== checksum) {
      throw new PersistenceDataError(`Snapshot checksum mismatch: ${id}`);
    }
    const payload = parsePayload(new TextDecoder().decode(bytes));
    if (payload.campaignId !== snapshot.campaignId) {
      throw new PersistenceDataError(`Snapshot campaign mismatch: ${id}`);
    }
    const turnRequests = this.database
      .prepare(
        `SELECT * FROM pending_ai_requests
         WHERE campaign_id = ? AND turn_id IS NOT NULL
         ORDER BY id`,
      )
      .all(snapshot.campaignId)
      .map(toStoredRow);

    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.exec('PRAGMA defer_foreign_keys = ON');
      this.deleteCampaignState(snapshot.campaignId);
      this.restoreCampaign(payload.campaign);
      for (const table of INSERT_ORDER) {
        for (const stored of payload.tables[table]) this.insertRow(table, stored);
      }
      for (const request of turnRequests) this.restoreTurnRequest(request);
      this.database.exec('COMMIT');
      return snapshot;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Snapshot restore and rollback both failed',
          { cause: rollbackError },
        );
      }
      throw error;
    }
  }

  private capturePayload(campaign: CampaignId): SnapshotPayload {
    const campaignRow = requireRow(
      this.database.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaign),
      `Campaign not found for snapshot: ${campaign}`,
    );
    const tables = snapshotTableRecord((table) =>
      this.database.prepare(TABLE_QUERIES[table]).all(campaign).map(toStoredRow),
    );
    return { formatVersion: 1, campaignId: campaign, campaign: toStoredRow(campaignRow), tables };
  }

  private deleteCampaignState(campaign: CampaignId): void {
    const statements = [
      `DELETE FROM messages WHERE conversation_id IN
         (SELECT id FROM conversations WHERE campaign_id = ?)`,
      `DELETE FROM adventure_turns WHERE adventure_id IN
         (SELECT id FROM adventures WHERE campaign_id = ?)`,
      `DELETE FROM npc_relationships WHERE npc_id IN
         (SELECT id FROM npcs WHERE campaign_id = ?)`,
      `DELETE FROM npc_knowledge WHERE npc_id IN
         (SELECT id FROM npcs WHERE campaign_id = ?)`,
      'DELETE FROM game_events WHERE campaign_id = ?',
      'DELETE FROM world_clocks WHERE campaign_id = ?',
      'DELETE FROM items WHERE campaign_id = ?',
      'DELETE FROM conversations WHERE campaign_id = ?',
      'DELETE FROM adventures WHERE campaign_id = ?',
      'DELETE FROM quests WHERE campaign_id = ?',
      'DELETE FROM npcs WHERE campaign_id = ?',
      'DELETE FROM taverns WHERE campaign_id = ?',
      'DELETE FROM player_characters WHERE campaign_id = ?',
      'DELETE FROM world_facts WHERE campaign_id = ?',
      'DELETE FROM world_bibles WHERE campaign_id = ?',
    ];
    for (const sql of statements) this.database.prepare(sql).run(campaign);
  }

  private restoreCampaign(row: StoredRow): void {
    const id = requireString(row['id'], 'campaign.id');
    const entries = Object.entries(row).filter(([column]) => column !== 'id');
    this.database
      .prepare(
        `UPDATE campaigns SET ${entries
          .map(([column]) => `${sqlColumn(column)} = ?`)
          .join(', ')} WHERE id = ?`,
      )
      .run(...entries.map(([, value]) => value), id);
  }

  private insertRow(table: SnapshotTable, row: StoredRow): void {
    const entries = Object.entries(row);
    if (entries.length === 0) throw new PersistenceDataError(`Empty ${table} snapshot row`);
    this.database
      .prepare(
        `INSERT INTO ${table} (${entries.map(([column]) => sqlColumn(column)).join(', ')})
         VALUES (${entries.map(() => '?').join(', ')})`,
      )
      .run(...entries.map(([, value]) => value));
  }

  private restoreTurnRequest(row: StoredRow): void {
    const id = requireString(row['id'], 'pending request id');
    if (
      this.database.prepare('SELECT 1 FROM pending_ai_requests WHERE id = ?').get(id) !== undefined
    ) {
      return;
    }
    const turn = row['turn_id'];
    if (
      typeof turn !== 'string' ||
      this.database.prepare('SELECT 1 FROM adventure_turns WHERE id = ?').get(turn) === undefined
    ) {
      return;
    }
    const entries = Object.entries(row);
    this.database
      .prepare(
        `INSERT INTO pending_ai_requests (${entries
          .map(([column]) => sqlColumn(column))
          .join(', ')})
         VALUES (${entries.map(() => '?').join(', ')})`,
      )
      .run(...entries.map(([, value]) => value));
  }

  private pruneAuto(campaign: CampaignId): void {
    this.database
      .prepare(
        `DELETE FROM save_snapshots
         WHERE id IN (
           SELECT id FROM save_snapshots
           WHERE campaign_id = ? AND kind = 'AUTO'
           ORDER BY created_at DESC, rowid DESC
           LIMIT -1 OFFSET 10
         )`,
      )
      .run(campaign);
  }
}

function parsePayload(text: string): SnapshotPayload {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new PersistenceDataError('Snapshot payload is not valid JSON', { cause: error });
  }
  const root = requireRow(value, 'Snapshot payload must be an object');
  if (root['formatVersion'] !== 1) throw new PersistenceDataError('Unsupported snapshot format');
  const campaign = requireString(root['campaignId'], 'snapshot campaignId');
  const campaignRow = requireStoredRow(root['campaign'], 'snapshot campaign');
  const tableRoot = requireRow(root['tables'], 'Snapshot tables must be an object');
  const tables = snapshotTableRecord((table) => {
    const rows = tableRoot[table];
    if (!Array.isArray(rows)) throw new PersistenceDataError(`Snapshot table ${table} is invalid`);
    return rows.map((row) => requireStoredRow(row, `snapshot table ${table}`));
  });
  return { formatVersion: 1, campaignId: campaign, campaign: campaignRow, tables };
}

function toStoredRow(value: unknown): StoredRow {
  const row = requireRow(value, 'SQLite snapshot row must be an object');
  return Object.freeze(
    Object.fromEntries(
      Object.entries(row).map(([key, entry]) => {
        if (entry === null || typeof entry === 'string' || typeof entry === 'number') {
          return [key, entry];
        }
        throw new PersistenceDataError(`Snapshot column ${key} has unsupported storage type`);
      }),
    ),
  );
}

function requireStoredRow(value: unknown, label: string): StoredRow {
  return toStoredRow(requireRow(value, label));
}

function requireRow(value: unknown, message: string): Record<string, unknown> {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PersistenceDataError(message);
  }
  return value as Record<string, unknown>;
}

function requireBytes(value: unknown, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new PersistenceDataError(`${label} must be bytes`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new PersistenceDataError(`${label} must be text`);
  return value;
}

function requireReason(value: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new PersistenceDataError('Snapshot reason must be non-empty canonical text');
  }
}

function sameSnapshotIdentity(existing: SaveSnapshot, input: CreateSnapshot): boolean {
  return (
    existing.id === input.id &&
    existing.campaignId === input.campaignId &&
    existing.kind === input.kind &&
    existing.reason === input.reason &&
    existing.schemaVersion === input.schemaVersion &&
    existing.createdAt === input.createdAt
  );
}

function sqlColumn(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(value)) {
    throw new PersistenceDataError(`Snapshot column name is invalid: ${value}`);
  }
  return value;
}

function mapSnapshot(value: unknown): SaveSnapshot {
  const row = requireRow(value, 'Snapshot row must be an object');
  const kind = requireString(row['kind'], 'kind');
  if (!(SNAPSHOT_KINDS as readonly string[]).includes(kind)) {
    throw new PersistenceDataError(`Unknown snapshot kind: ${kind}`);
  }
  return Object.freeze({
    id: snapshotId(requireString(row['id'], 'id')),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    kind: kind as SnapshotKind,
    reason: requireString(row['reason'], 'reason'),
    schemaVersion: schemaVersion(requireNumber(row['schema_version'], 'schema_version')),
    checksumSha256: requireString(row['checksum_sha256'], 'checksum_sha256'),
    createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
  });
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number') throw new PersistenceDataError(`${label} must be a number`);
  return value;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new PersistenceDataError('Snapshot contains non-finite number');
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
  throw new PersistenceDataError('Snapshot contains unsupported JSON value');
}

function snapshotTableRecord(
  values: (table: SnapshotTable) => readonly StoredRow[],
): Record<SnapshotTable, readonly StoredRow[]> {
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
    game_events: values('game_events'),
  };
}
