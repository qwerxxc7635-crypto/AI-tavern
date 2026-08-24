import { createHash } from 'node:crypto';

import {
  MEMORY_SOURCE_KINDS,
  SUMMARY_SCOPE_KINDS,
  campaignId,
  createHistoricalSummary,
  createWorldLoreEntry,
  generationRecordId,
  historicalSummaryId,
  isoTimestamp,
  worldLoreEntryId,
  type CampaignId,
  type HistoricalSummary,
  type KnowledgeActor,
  type MemorySourceKind,
  type MemorySourceSelector,
  type MemorySourceSnapshot,
  type WorldLoreEntry,
} from '@ember-tavern/contracts';

import { PersistenceDataError } from './campaign-repository.js';
import {
  requireEnum,
  requireNullableString,
  requireNumber,
  requireRecord,
  requireString,
} from './persistence-validation.js';
import type { TransactionalSqliteDatabase } from './sqlite-port.js';

const MAX_SUMMARIES = 256;
const MAX_WORLD_LORE_ENTRIES = 512;
const MAX_ARTIFACT_SOURCES = 128;

export type MemoryArtifactKind = 'SUMMARY' | 'LONG_TERM' | 'WORLD_LORE';
export type MemoryArtifactFreshnessReason = 'CURRENT' | 'SOURCE_DELETED' | 'SOURCE_UPDATED';

export interface MemoryArtifactFreshness {
  readonly status: 'CURRENT' | 'STALE';
  readonly reason: MemoryArtifactFreshnessReason;
  readonly source: MemorySourceSelector | null;
}

export class MemoryLayerRepository {
  public constructor(private readonly database: TransactionalSqliteDatabase) {}

  public captureSources(
    campaign: CampaignId,
    selectors: readonly MemorySourceSelector[],
    actor: KnowledgeActor | null = null,
  ): readonly MemorySourceSnapshot[] {
    requireSelectors(selectors);
    return Object.freeze(
      selectors.map((selector) => captureMemorySource(this.database, campaign, selector, actor)),
    );
  }

  public saveSummary(summary: HistoricalSummary, expectedRevision: number): HistoricalSummary {
    const canonical = createHistoricalSummary(summary);
    requireExpectedRevision(expectedRevision, canonical.revision, 'Summary');
    requireDigest(canonical.sources, canonical.sourceDigest);
    return this.inTransaction(() => {
      this.requireGenerationScope(canonical.campaignId, canonical.generationRecordId);
      const current = this.getSummary(canonical.id);
      requireArtifactRevision(current, canonical.campaignId, expectedRevision, 'Summary');
      this.assertSourcesCurrent(canonical.campaignId, canonical.sources, canonical.actor);
      if (current === null) this.insertSummary(canonical);
      else this.updateSummary(canonical);
      this.replaceSources('SUMMARY', canonical.id, canonical.campaignId, canonical.sources);
      return this.requireSummary(canonical.id);
    });
  }

  public getSummary(id: HistoricalSummary['id']): HistoricalSummary | null {
    const row = this.database.prepare('SELECT * FROM historical_summaries WHERE id = ?').get(id);
    return row === undefined ? null : this.mapSummary(row);
  }

  public requireSummary(id: HistoricalSummary['id']): HistoricalSummary {
    const summary = this.getSummary(id);
    if (summary === null) throw new PersistenceDataError(`Historical Summary not found: ${id}`);
    return summary;
  }

  public listSummaries(
    campaign: CampaignId,
    scopeKind?: HistoricalSummary['scopeKind'],
    scopeId?: string,
  ): readonly HistoricalSummary[] {
    if ((scopeKind === undefined) !== (scopeId === undefined)) {
      throw new PersistenceDataError('Summary scope kind and ID must be supplied together');
    }
    const rows =
      scopeKind === undefined
        ? this.database
            .prepare(
              `SELECT * FROM historical_summaries
               WHERE campaign_id = ? ORDER BY covered_to, id LIMIT ?`,
            )
            .all(campaign, MAX_SUMMARIES + 1)
        : this.database
            .prepare(
              `SELECT * FROM historical_summaries
               WHERE campaign_id = ? AND scope_kind = ? AND scope_id = ?
               ORDER BY covered_to, id LIMIT ?`,
            )
            .all(campaign, scopeKind, scopeId ?? '', MAX_SUMMARIES + 1);
    if (rows.length > MAX_SUMMARIES) {
      throw new PersistenceDataError('Historical Summary projection exceeds the resource limit');
    }
    return Object.freeze(rows.map((row) => this.mapSummary(row)));
  }

  public listCurrentSummaries(
    campaign: CampaignId,
    scopeKind?: HistoricalSummary['scopeKind'],
    scopeId?: string,
  ): readonly HistoricalSummary[] {
    return Object.freeze(
      this.listSummaries(campaign, scopeKind, scopeId).filter(
        ({ id }) => this.inspectSummary(id).status === 'CURRENT',
      ),
    );
  }

  public saveWorldLore(entry: WorldLoreEntry, expectedRevision: number): WorldLoreEntry {
    const canonical = createWorldLoreEntry(entry);
    requireExpectedRevision(expectedRevision, canonical.revision, 'World Lore');
    requireDigest(canonical.sources, canonical.sourceDigest);
    return this.inTransaction(() => {
      this.requireGenerationScope(canonical.campaignId, canonical.generationRecordId);
      const current = this.getWorldLore(canonical.id);
      requireArtifactRevision(current, canonical.campaignId, expectedRevision, 'World Lore');
      this.assertSourcesCurrent(canonical.campaignId, canonical.sources, null);
      if (current === null) this.insertWorldLore(canonical);
      else this.updateWorldLore(canonical);
      this.replaceSources('WORLD_LORE', canonical.id, canonical.campaignId, canonical.sources);
      return this.requireWorldLore(canonical.id);
    });
  }

  public getWorldLore(id: WorldLoreEntry['id']): WorldLoreEntry | null {
    const row = this.database.prepare('SELECT * FROM world_lore_entries WHERE id = ?').get(id);
    return row === undefined ? null : this.mapWorldLore(row);
  }

  public requireWorldLore(id: WorldLoreEntry['id']): WorldLoreEntry {
    const lore = this.getWorldLore(id);
    if (lore === null) throw new PersistenceDataError(`World Lore not found: ${id}`);
    return lore;
  }

  public listWorldLore(campaign: CampaignId): readonly WorldLoreEntry[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM world_lore_entries
           WHERE campaign_id = ? ORDER BY updated_at, id LIMIT ?`,
      )
      .all(campaign, MAX_WORLD_LORE_ENTRIES + 1);
    if (rows.length > MAX_WORLD_LORE_ENTRIES) {
      throw new PersistenceDataError('World Lore projection exceeds the resource limit');
    }
    return Object.freeze(rows.map((row) => this.mapWorldLore(row)));
  }

  public listCurrentWorldLore(campaign: CampaignId): readonly WorldLoreEntry[] {
    return Object.freeze(
      this.listWorldLore(campaign).filter(
        ({ id }) => this.inspectWorldLore(id).status === 'CURRENT',
      ),
    );
  }

  public inspectSummary(id: HistoricalSummary['id']): MemoryArtifactFreshness {
    const artifact = this.requireSummary(id);
    return this.inspectSources('SUMMARY', artifact.id, artifact.campaignId, artifact.actor);
  }

  public inspectWorldLore(id: WorldLoreEntry['id']): MemoryArtifactFreshness {
    const artifact = this.requireWorldLore(id);
    return this.inspectSources('WORLD_LORE', artifact.id, artifact.campaignId, null);
  }

  public inspectLongTermMemory(id: string): MemoryArtifactFreshness {
    const row = requireRecord(
      this.database.prepare('SELECT * FROM knowledge_memories WHERE id = ?').get(id),
      `Long-term Memory not found: ${id}`,
    );
    const campaign = campaignId(requireString(row['campaign_id'], 'memory.campaign_id'));
    const actor: KnowledgeActor = {
      type: requireEnum(
        ['NPC', 'PLAYER_CHARACTER'] as const,
        row['actor_type'],
        'memory.actor_type',
      ),
      id: requireString(row['actor_id'], 'memory.actor_id'),
    };
    return this.inspectSources('LONG_TERM', id, campaign, actor);
  }

  private inspectSources(
    artifactKind: MemoryArtifactKind,
    artifactId: string,
    campaign: CampaignId,
    actor: KnowledgeActor | null,
  ): MemoryArtifactFreshness {
    const sources = this.listArtifactSources(artifactKind, artifactId);
    if (sources.length === 0) {
      return Object.freeze({ status: 'STALE', reason: 'SOURCE_DELETED', source: null });
    }
    for (const source of sources) {
      let current: MemorySourceSnapshot;
      try {
        current = captureMemorySource(this.database, campaign, source, actor);
      } catch (error) {
        if (error instanceof SourceMissingError) {
          return Object.freeze({
            status: 'STALE',
            reason: 'SOURCE_DELETED',
            source: Object.freeze({ kind: source.kind, id: source.id }),
          });
        }
        throw error;
      }
      if (
        current.revision !== source.revision ||
        current.contentHash !== source.contentHash ||
        current.occurredAt !== source.occurredAt
      ) {
        return Object.freeze({
          status: 'STALE',
          reason: 'SOURCE_UPDATED',
          source: Object.freeze({ kind: source.kind, id: source.id }),
        });
      }
    }
    return Object.freeze({ status: 'CURRENT', reason: 'CURRENT', source: null });
  }

  private assertSourcesCurrent(
    campaign: CampaignId,
    sources: readonly MemorySourceSnapshot[],
    actor: KnowledgeActor | null,
  ): void {
    for (const source of sources) {
      const current = captureMemorySource(this.database, campaign, source, actor);
      if (
        current.revision !== source.revision ||
        current.contentHash !== source.contentHash ||
        current.occurredAt !== source.occurredAt
      ) {
        throw new PersistenceDataError(`Derived memory source drift: ${source.kind}:${source.id}`);
      }
    }
  }

  private listArtifactSources(
    artifactKind: MemoryArtifactKind,
    artifactId: string,
  ): readonly MemorySourceSnapshot[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM memory_artifact_sources
           WHERE artifact_kind = ? AND artifact_id = ? ORDER BY ordinal LIMIT ?`,
      )
      .all(artifactKind, artifactId, MAX_ARTIFACT_SOURCES + 1);
    if (rows.length > MAX_ARTIFACT_SOURCES) {
      throw new PersistenceDataError('Memory Artifact sources exceed the resource limit');
    }
    return Object.freeze(rows.map(mapSource));
  }

  private mapSummary(value: unknown): HistoricalSummary {
    const row = requireRecord(value, 'Historical Summary row');
    const actorType = requireNullableString(row['actor_type'], 'actor_type');
    const actorId = requireNullableString(row['actor_id'], 'actor_id');
    const generation = requireNullableString(row['generation_record_id'], 'generation_record_id');
    const summary = createHistoricalSummary({
      id: historicalSummaryId(requireString(row['id'], 'id')),
      campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
      scopeKind: requireEnum(SUMMARY_SCOPE_KINDS, row['scope_kind'], 'scope_kind'),
      scopeId: requireString(row['scope_id'], 'scope_id'),
      actor:
        actorType === null || actorId === null
          ? null
          : {
              type: requireEnum(['NPC', 'PLAYER_CHARACTER'] as const, actorType, 'actor_type'),
              id: actorId,
            },
      text: requireString(row['summary_text'], 'summary_text'),
      sources: this.listArtifactSources('SUMMARY', requireString(row['id'], 'id')),
      sourceDigest: requireString(row['source_digest'], 'source_digest'),
      coveredFrom: isoTimestamp(requireString(row['covered_from'], 'covered_from')),
      coveredTo: isoTimestamp(requireString(row['covered_to'], 'covered_to')),
      generationRecordId: generation === null ? null : generationRecordId(generation),
      revision: positiveInteger(row['revision'], 'revision'),
      createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
      updatedAt: isoTimestamp(requireString(row['updated_at'], 'updated_at')),
    });
    requireDigest(summary.sources, summary.sourceDigest);
    return summary;
  }

  private mapWorldLore(value: unknown): WorldLoreEntry {
    const row = requireRecord(value, 'World Lore row');
    const generation = requireNullableString(row['generation_record_id'], 'generation_record_id');
    const lore = createWorldLoreEntry({
      id: worldLoreEntryId(requireString(row['id'], 'id')),
      campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
      title: requireString(row['title'], 'title'),
      text: requireString(row['lore_text'], 'lore_text'),
      sources: this.listArtifactSources('WORLD_LORE', requireString(row['id'], 'id')),
      sourceDigest: requireString(row['source_digest'], 'source_digest'),
      generationRecordId: generation === null ? null : generationRecordId(generation),
      revision: positiveInteger(row['revision'], 'revision'),
      createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
      updatedAt: isoTimestamp(requireString(row['updated_at'], 'updated_at')),
    });
    requireDigest(lore.sources, lore.sourceDigest);
    return lore;
  }

  private insertSummary(summary: HistoricalSummary): void {
    this.database
      .prepare(
        `INSERT INTO historical_summaries (
           id,campaign_id,scope_kind,scope_id,actor_type,actor_id,summary_text,
           source_digest,covered_from,covered_to,generation_record_id,revision,created_at,updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        summary.id,
        summary.campaignId,
        summary.scopeKind,
        summary.scopeId,
        summary.actor?.type ?? null,
        summary.actor?.id ?? null,
        summary.text,
        summary.sourceDigest,
        summary.coveredFrom,
        summary.coveredTo,
        summary.generationRecordId,
        summary.revision,
        summary.createdAt,
        summary.updatedAt,
      );
  }

  private updateSummary(summary: HistoricalSummary): void {
    this.database
      .prepare(
        `UPDATE historical_summaries SET summary_text=?,source_digest=?,covered_from=?,covered_to=?,
           generation_record_id=?,revision=?,updated_at=? WHERE id=?`,
      )
      .run(
        summary.text,
        summary.sourceDigest,
        summary.coveredFrom,
        summary.coveredTo,
        summary.generationRecordId,
        summary.revision,
        summary.updatedAt,
        summary.id,
      );
  }

  private insertWorldLore(entry: WorldLoreEntry): void {
    this.database
      .prepare(
        `INSERT INTO world_lore_entries (
           id,campaign_id,title,lore_text,source_digest,generation_record_id,revision,created_at,updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        entry.id,
        entry.campaignId,
        entry.title,
        entry.text,
        entry.sourceDigest,
        entry.generationRecordId,
        entry.revision,
        entry.createdAt,
        entry.updatedAt,
      );
  }

  private updateWorldLore(entry: WorldLoreEntry): void {
    this.database
      .prepare(
        `UPDATE world_lore_entries SET title=?,lore_text=?,source_digest=?,generation_record_id=?,
           revision=?,updated_at=? WHERE id=?`,
      )
      .run(
        entry.title,
        entry.text,
        entry.sourceDigest,
        entry.generationRecordId,
        entry.revision,
        entry.updatedAt,
        entry.id,
      );
  }

  private replaceSources(
    artifactKind: MemoryArtifactKind,
    artifactId: string,
    campaign: CampaignId,
    sources: readonly MemorySourceSnapshot[],
  ): void {
    this.database
      .prepare('DELETE FROM memory_artifact_sources WHERE artifact_kind=? AND artifact_id=?')
      .run(artifactKind, artifactId);
    const insert = this.database.prepare(
      `INSERT INTO memory_artifact_sources (
         campaign_id,artifact_kind,artifact_id,ordinal,source_kind,source_id,
         source_revision,source_hash,source_occurred_at
       ) VALUES (?,?,?,?,?,?,?,?,?)`,
    );
    sources.forEach((source, ordinal) =>
      insert.run(
        campaign,
        artifactKind,
        artifactId,
        ordinal,
        source.kind,
        source.id,
        source.revision,
        source.contentHash,
        source.occurredAt,
      ),
    );
  }

  private requireGenerationScope(campaign: CampaignId, generation: string | null): void {
    if (generation === null) return;
    const row = this.database
      .prepare('SELECT campaign_id FROM generation_records WHERE id = ?')
      .get(generation);
    if (
      row === undefined ||
      requireString(requireRecord(row, 'Generation row')['campaign_id'], 'campaign_id') !== campaign
    ) {
      throw new PersistenceDataError('Derived memory generation belongs to another campaign');
    }
  }

  private inTransaction<T>(operation: () => T): T {
    this.database.exec('SAVEPOINT memory_layer_repository');
    try {
      const result = operation();
      this.database.exec('RELEASE SAVEPOINT memory_layer_repository');
      return result;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK TO SAVEPOINT memory_layer_repository');
        this.database.exec('RELEASE SAVEPOINT memory_layer_repository');
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Memory layer rollback failed', {
          cause: rollbackError,
        });
      }
      throw error;
    }
  }
}

export function memorySourceDigest(sources: readonly MemorySourceSnapshot[]): string {
  requireSelectors(sources);
  return createHash('sha256')
    .update(
      JSON.stringify(
        sources.map(({ kind, id, revision, contentHash, occurredAt }) => ({
          kind,
          id,
          revision,
          contentHash,
          occurredAt,
        })),
      ),
    )
    .digest('hex');
}

export function captureMemorySource(
  database: TransactionalSqliteDatabase,
  campaign: CampaignId,
  selector: MemorySourceSelector,
  actor: KnowledgeActor | null = null,
): MemorySourceSnapshot {
  if (!MEMORY_SOURCE_KINDS.includes(selector.kind)) {
    throw new PersistenceDataError('Memory source kind is invalid');
  }
  const loaded = loadSource(database, selector);
  if (loaded === null) throw new SourceMissingError(selector);
  if (loaded.campaignId !== campaign) {
    throw new PersistenceDataError('Memory source belongs to another campaign');
  }
  if (
    actor !== null &&
    loaded.actor !== null &&
    (loaded.actor.type !== actor.type || loaded.actor.id !== actor.id)
  ) {
    throw new PersistenceDataError('Memory source belongs to another actor');
  }
  return Object.freeze({
    kind: selector.kind,
    id: selector.id,
    revision: loaded.revision,
    contentHash: hashRow(loaded.row),
    occurredAt: isoTimestamp(loaded.occurredAt),
  });
}

interface LoadedSource {
  readonly row: Readonly<Record<string, unknown>>;
  readonly campaignId: string;
  readonly revision: number;
  readonly occurredAt: string;
  readonly actor: KnowledgeActor | null;
}

function loadSource(
  database: TransactionalSqliteDatabase,
  selector: MemorySourceSelector,
): LoadedSource | null {
  if (selector.kind === 'MESSAGE') {
    return loadedJoined(
      database
        .prepare(
          `SELECT messages.*, conversations.campaign_id AS source_campaign_id
           FROM messages JOIN conversations ON conversations.id=messages.conversation_id
           WHERE messages.id=?`,
        )
        .get(selector.id),
      'source_campaign_id',
      1,
      'created_at',
      null,
    );
  }
  if (selector.kind === 'ADVENTURE_TURN') {
    return loadedJoined(
      database
        .prepare(
          `SELECT adventure_turns.*, adventures.campaign_id AS source_campaign_id
           FROM adventure_turns JOIN adventures ON adventures.id=adventure_turns.adventure_id
           WHERE adventure_turns.id=?`,
        )
        .get(selector.id),
      'source_campaign_id',
      1,
      'created_at',
      null,
    );
  }
  const policy = SOURCE_POLICIES[selector.kind];
  const value = database.prepare(`SELECT * FROM ${policy.table} WHERE id=?`).get(selector.id);
  if (value === undefined) return null;
  const row = requireRecord(value, 'Memory source row');
  const actor =
    policy.actorColumns === null
      ? null
      : {
          type: requireEnum(
            ['NPC', 'PLAYER_CHARACTER'] as const,
            row[policy.actorColumns[0]],
            'source actor type',
          ),
          id: requireString(row[policy.actorColumns[1]], 'source actor id'),
        };
  return {
    row,
    campaignId: requireString(row['campaign_id'], 'source campaign_id'),
    revision:
      policy.revisionColumn === null
        ? 1
        : positiveInteger(row[policy.revisionColumn], 'source revision'),
    occurredAt: requireString(row[policy.timeColumn], 'source occurred_at'),
    actor,
  };
}

const SOURCE_POLICIES: Readonly<
  Record<
    Exclude<MemorySourceKind, 'MESSAGE' | 'ADVENTURE_TURN'>,
    {
      readonly table: string;
      readonly revisionColumn: string | null;
      readonly timeColumn: string;
      readonly actorColumns: readonly [string, string] | null;
    }
  >
> = Object.freeze({
  WORLD_TRUTH: {
    table: 'world_truths',
    revisionColumn: 'revision',
    timeColumn: 'updated_at',
    actorColumns: null,
  },
  CLAIM: {
    table: 'knowledge_claims',
    revisionColumn: 'revision',
    timeColumn: 'updated_at',
    actorColumns: null,
  },
  KNOWLEDGE: {
    table: 'actor_knowledge',
    revisionColumn: 'revision',
    timeColumn: 'updated_at',
    actorColumns: ['actor_type', 'actor_id'],
  },
  MEMORY: {
    table: 'knowledge_memories',
    revisionColumn: 'revision',
    timeColumn: 'created_at',
    actorColumns: ['actor_type', 'actor_id'],
  },
  WORLD_FACT: {
    table: 'world_facts',
    revisionColumn: null,
    timeColumn: 'created_at',
    actorColumns: null,
  },
  GAME_EVENT: {
    table: 'game_events',
    revisionColumn: 'schema_version',
    timeColumn: 'occurred_at',
    actorColumns: null,
  },
});

function loadedJoined(
  value: unknown,
  campaignColumn: string,
  revision: number,
  timeColumn: string,
  actor: KnowledgeActor | null,
): LoadedSource | null {
  if (value === undefined) return null;
  const row = requireRecord(value, 'Memory source row');
  return {
    row,
    campaignId: requireString(row[campaignColumn], campaignColumn),
    revision,
    occurredAt: requireString(row[timeColumn], timeColumn),
    actor,
  };
}

function mapSource(value: unknown): MemorySourceSnapshot {
  const row = requireRecord(value, 'Memory Artifact Source row');
  return Object.freeze({
    kind: requireEnum(MEMORY_SOURCE_KINDS, row['source_kind'], 'source_kind'),
    id: requireString(row['source_id'], 'source_id'),
    revision: positiveInteger(row['source_revision'], 'source_revision'),
    contentHash: requireString(row['source_hash'], 'source_hash'),
    occurredAt: isoTimestamp(requireString(row['source_occurred_at'], 'source_occurred_at')),
  });
}

function requireArtifactRevision(
  current: { readonly campaignId: CampaignId; readonly revision: number } | null,
  campaign: CampaignId,
  expected: number,
  label: string,
): void {
  if (current === null) {
    if (expected !== 0) throw new PersistenceDataError(`${label} expected revision drift`);
    return;
  }
  if (current.campaignId !== campaign) throw new PersistenceDataError(`${label} campaign mismatch`);
  if (current.revision !== expected) throw new PersistenceDataError(`${label} revision drift`);
}

function requireExpectedRevision(expected: number, next: number, label: string): void {
  if (!Number.isSafeInteger(expected) || expected < 0 || next !== expected + 1) {
    throw new PersistenceDataError(`${label} revision does not follow expected revision`);
  }
}

function requireDigest(sources: readonly MemorySourceSnapshot[], digest: string): void {
  if (memorySourceDigest(sources) !== digest) {
    throw new PersistenceDataError('Derived memory source digest does not match its snapshots');
  }
}

function requireSelectors(values: readonly MemorySourceSelector[]): void {
  if (values.length === 0 || values.length > 128) {
    throw new PersistenceDataError('Memory source selection must contain 1..128 entries');
  }
  const identities = new Set<string>();
  for (const value of values) {
    const identity = `${value.kind}:${value.id}`;
    if (value.id.length === 0 || value.id.trim() !== value.id || identities.has(identity)) {
      throw new PersistenceDataError('Memory source selection is invalid or duplicated');
    }
    identities.add(identity);
  }
}

function positiveInteger(value: unknown, label: string): number {
  const number = requireNumber(value, label);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new PersistenceDataError(`${label} must be a positive safe integer`);
  }
  return number;
}

function hashRow(row: Readonly<Record<string, unknown>>): string {
  const canonical = JSON.stringify(
    Object.fromEntries(Object.entries(row).sort(([left], [right]) => left.localeCompare(right))),
  );
  return createHash('sha256').update(canonical).digest('hex');
}

class SourceMissingError extends PersistenceDataError {
  public constructor(source: MemorySourceSelector) {
    super(`Memory source not found: ${source.kind}:${source.id}`);
    this.name = 'SourceMissingError';
  }
}
