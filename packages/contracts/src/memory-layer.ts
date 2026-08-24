import type {
  CampaignId,
  GenerationRecordId,
  HistoricalSummaryId,
  IsoTimestamp,
  WorldLoreEntryId,
} from './foundation.js';
import type { KnowledgeActor } from './knowledge.js';

export const MEMORY_LAYER_KINDS = [
  'STRUCTURED_FACT',
  'RECENT',
  'SUMMARY',
  'LONG_TERM',
  'WORLD_LORE',
] as const;
export type MemoryLayerKind = (typeof MEMORY_LAYER_KINDS)[number];

export const MEMORY_SOURCE_KINDS = [
  'WORLD_TRUTH',
  'CLAIM',
  'KNOWLEDGE',
  'MEMORY',
  'WORLD_FACT',
  'GAME_EVENT',
  'MESSAGE',
  'ADVENTURE_TURN',
] as const;
export type MemorySourceKind = (typeof MEMORY_SOURCE_KINDS)[number];

export interface MemorySourceSelector {
  readonly kind: MemorySourceKind;
  readonly id: string;
}

export interface MemorySourceSnapshot extends MemorySourceSelector {
  readonly revision: number;
  readonly contentHash: string;
  readonly occurredAt: IsoTimestamp;
}

export const SUMMARY_SCOPE_KINDS = ['CAMPAIGN', 'ACTOR', 'ADVENTURE', 'CONVERSATION'] as const;
export type SummaryScopeKind = (typeof SUMMARY_SCOPE_KINDS)[number];

export interface HistoricalSummary {
  readonly kind: 'SUMMARY';
  readonly id: HistoricalSummaryId;
  readonly campaignId: CampaignId;
  readonly scopeKind: SummaryScopeKind;
  readonly scopeId: string;
  readonly actor: KnowledgeActor | null;
  readonly text: string;
  readonly sources: readonly MemorySourceSnapshot[];
  readonly sourceDigest: string;
  readonly coveredFrom: IsoTimestamp;
  readonly coveredTo: IsoTimestamp;
  readonly generationRecordId: GenerationRecordId | null;
  readonly revision: number;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface WorldLoreEntry {
  readonly kind: 'WORLD_LORE';
  readonly id: WorldLoreEntryId;
  readonly campaignId: CampaignId;
  readonly title: string;
  readonly text: string;
  readonly sources: readonly MemorySourceSnapshot[];
  readonly sourceDigest: string;
  readonly generationRecordId: GenerationRecordId | null;
  readonly revision: number;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export class MemoryLayerContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MemoryLayerContractError';
  }
}

export function createHistoricalSummary(input: Omit<HistoricalSummary, 'kind'>): HistoricalSummary {
  requireEnum(SUMMARY_SCOPE_KINDS, input.scopeKind, 'Summary scope kind');
  const actor = validateScopeActor(input.scopeKind, input.actor);
  const sources = validateSources(input.sources);
  const coveredFrom = requireTimestamp(input.coveredFrom, 'Summary coveredFrom');
  const coveredTo = requireTimestamp(input.coveredTo, 'Summary coveredTo');
  if (coveredFrom > coveredTo) {
    throw new MemoryLayerContractError('Summary coverage must be chronological');
  }
  const createdAt = requireTimestamp(input.createdAt, 'Summary createdAt');
  const updatedAt = requireTimestamp(input.updatedAt, 'Summary updatedAt');
  if (coveredTo > updatedAt || createdAt > updatedAt) {
    throw new MemoryLayerContractError('Summary timestamps are not chronological');
  }
  return Object.freeze({
    ...input,
    kind: 'SUMMARY',
    scopeId: requireText(input.scopeId, 'Summary scopeId', 256),
    actor,
    text: requireText(input.text, 'Summary text', 8_000),
    sources,
    sourceDigest: requireHash(input.sourceDigest, 'Summary sourceDigest'),
    coveredFrom,
    coveredTo,
    revision: requireRevision(input.revision),
    createdAt,
    updatedAt,
  });
}

export function createWorldLoreEntry(input: Omit<WorldLoreEntry, 'kind'>): WorldLoreEntry {
  const createdAt = requireTimestamp(input.createdAt, 'World Lore createdAt');
  const updatedAt = requireTimestamp(input.updatedAt, 'World Lore updatedAt');
  if (createdAt > updatedAt) {
    throw new MemoryLayerContractError('World Lore timestamps are not chronological');
  }
  return Object.freeze({
    ...input,
    kind: 'WORLD_LORE',
    title: requireText(input.title, 'World Lore title', 256),
    text: requireText(input.text, 'World Lore text', 8_000),
    sources: validateSources(input.sources),
    sourceDigest: requireHash(input.sourceDigest, 'World Lore sourceDigest'),
    revision: requireRevision(input.revision),
    createdAt,
    updatedAt,
  });
}

function validateScopeActor(
  scope: SummaryScopeKind,
  actor: KnowledgeActor | null,
): KnowledgeActor | null {
  if ((scope === 'ACTOR') !== (actor !== null)) {
    throw new MemoryLayerContractError('Only ACTOR summaries may carry an actor identity');
  }
  if (actor === null) return null;
  requireEnum(['NPC', 'PLAYER_CHARACTER'] as const, actor.type, 'Summary actor type');
  return Object.freeze({ ...actor, id: requireText(actor.id, 'Summary actor id', 256) });
}

function validateSources(values: readonly MemorySourceSnapshot[]): readonly MemorySourceSnapshot[] {
  if (values.length === 0 || values.length > 128) {
    throw new MemoryLayerContractError('Derived memory requires 1..128 source snapshots');
  }
  const identities = new Set<string>();
  return Object.freeze(
    values.map((source) => {
      requireEnum(MEMORY_SOURCE_KINDS, source.kind, 'Memory source kind');
      const id = requireText(source.id, 'Memory source id', 256);
      const identity = `${source.kind}:${id}`;
      if (identities.has(identity)) {
        throw new MemoryLayerContractError('Memory source identities must be unique');
      }
      identities.add(identity);
      return Object.freeze({
        ...source,
        id,
        revision: requireRevision(source.revision),
        contentHash: requireHash(source.contentHash, 'Memory source contentHash'),
        occurredAt: requireTimestamp(source.occurredAt, 'Memory source occurredAt'),
      });
    }),
  );
}

function requireText(value: string, label: string, max: number): string {
  if (value.length === 0 || value.trim() !== value || value.length > max) {
    throw new MemoryLayerContractError(`${label} is invalid`);
  }
  return value;
}

function requireRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new MemoryLayerContractError('Memory revision must be a positive safe integer');
  }
  return value;
}

function requireHash(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new MemoryLayerContractError(`${label} is invalid`);
  return value;
}

function requireTimestamp(value: IsoTimestamp, label: string): IsoTimestamp {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new MemoryLayerContractError(`${label} must be a canonical ISO timestamp`);
  }
  return value;
}

function requireEnum<const Values extends readonly string[]>(
  values: Values,
  value: Values[number],
  label: string,
): void {
  if (!(values as readonly unknown[]).includes(value)) {
    throw new MemoryLayerContractError(`${label} is invalid`);
  }
}
