import { locationId, questId } from './foundation.js';
import type {
  CampaignId,
  IsoTimestamp,
  LocationId,
  QuestId,
  WorldLoreEntryId,
} from './foundation.js';
import type { WorldLoreEntry } from './memory-layer.js';

export const RETRIEVAL_ENTITY_KINDS = [
  'NPC',
  'PLAYER_CHARACTER',
  'FACTION',
  'ITEM',
  'WORLD_FACT',
] as const;
export type RetrievalEntityKind = (typeof RETRIEVAL_ENTITY_KINDS)[number];

export interface RetrievalEntityRef {
  readonly kind: RetrievalEntityKind;
  readonly id: string;
}

export const LORE_MATCH_MODES = ['ANY', 'ALL'] as const;
export type LoreMatchMode = (typeof LORE_MATCH_MODES)[number];

export interface WorldLoreRetrievalRule {
  readonly loreEntryId: WorldLoreEntryId;
  readonly campaignId: CampaignId;
  readonly keywords: readonly string[];
  readonly entityRefs: readonly RetrievalEntityRef[];
  readonly locationIds: readonly LocationId[];
  readonly questIds: readonly QuestId[];
  readonly alwaysActive: boolean;
  readonly matchMode: LoreMatchMode;
  readonly priority: number;
  readonly tokenBudget: number;
  readonly enabled: boolean;
  readonly revision: number;
  readonly updatedAt: IsoTimestamp;
}

export interface WorldInfoRetrievalQuery {
  readonly campaignId: CampaignId;
  readonly text: string;
  readonly entityRefs: readonly RetrievalEntityRef[];
  readonly locationIds: readonly LocationId[];
  readonly questIds: readonly QuestId[];
  readonly minimumScore: number;
  readonly maxTokens: number;
}

export interface WorldInfoRetrievalCandidate {
  readonly lore: WorldLoreEntry;
  readonly rule: WorldLoreRetrievalRule | null;
  readonly current: boolean;
}

export interface WorldInfoRetrievalCorpus {
  readonly campaignId: CampaignId;
  readonly candidates: readonly WorldInfoRetrievalCandidate[];
}

export interface WorldInfoCandidateSource {
  loadWorldInfoCorpus(
    query: WorldInfoRetrievalQuery,
  ): WorldInfoRetrievalCorpus | Promise<WorldInfoRetrievalCorpus>;
}

export const WORLD_INFO_TRIGGER_KINDS = [
  'ALWAYS',
  'KEYWORD',
  'ENTITY',
  'LOCATION',
  'QUEST',
] as const;
export type WorldInfoTriggerKind = (typeof WORLD_INFO_TRIGGER_KINDS)[number];

export interface WorldInfoTriggerMatch {
  readonly kind: WorldInfoTriggerKind;
  readonly value: string;
  readonly weight: number;
}

export const WORLD_INFO_RETRIEVAL_REASONS = [
  'SELECTED',
  'STALE_SOURCE',
  'NOT_CONFIGURED',
  'DISABLED',
  'NO_TRIGGER_MATCH',
  'BELOW_THRESHOLD',
  'ENTRY_BUDGET',
  'TOTAL_BUDGET',
] as const;
export type WorldInfoRetrievalReason = (typeof WORLD_INFO_RETRIEVAL_REASONS)[number];

export interface WorldInfoRetrievalManifestEntry {
  readonly loreEntryId: WorldLoreEntryId;
  readonly loreRevision: number;
  readonly ruleRevision: number | null;
  readonly priority: number | null;
  readonly score: number;
  readonly estimatedTokens: number;
  readonly matches: readonly WorldInfoTriggerMatch[];
  readonly included: boolean;
  readonly reason: WorldInfoRetrievalReason;
}

export interface WorldInfoRetrievalSelection {
  readonly loreEntryId: WorldLoreEntryId;
  readonly title: string;
  readonly text: string;
  readonly revision: number;
  readonly score: number;
  readonly priority: number;
  readonly matches: readonly WorldInfoTriggerMatch[];
}

export interface WorldInfoRetrievalResult {
  readonly selections: readonly WorldInfoRetrievalSelection[];
  readonly manifest: readonly WorldInfoRetrievalManifestEntry[];
  readonly estimatedTokens: number;
}

export class WorldInfoRetrievalContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'WorldInfoRetrievalContractError';
  }
}

export function createWorldLoreRetrievalRule(
  input: WorldLoreRetrievalRule,
): WorldLoreRetrievalRule {
  const keywords = textList(input.keywords, 'Lore keywords', 32, 64, true);
  const entityRefs = refs(input.entityRefs, 'Lore entity refs');
  const locationIds = Object.freeze(
    idList(input.locationIds, 'Lore location IDs', 32).map(locationId),
  );
  const questIds = Object.freeze(idList(input.questIds, 'Lore Quest IDs', 32).map(questId));
  if (
    !input.alwaysActive &&
    keywords.length === 0 &&
    entityRefs.length === 0 &&
    locationIds.length === 0 &&
    questIds.length === 0
  ) {
    throw new WorldInfoRetrievalContractError('Lore retrieval rule requires a trigger');
  }
  if (!LORE_MATCH_MODES.includes(input.matchMode)) {
    throw new WorldInfoRetrievalContractError('Lore match mode is invalid');
  }
  return Object.freeze({
    ...input,
    keywords,
    entityRefs,
    locationIds,
    questIds,
    priority: integer(input.priority, 'Lore priority', 0, 1_000),
    tokenBudget: integer(input.tokenBudget, 'Lore token budget', 1, 4_000),
    revision: integer(input.revision, 'Lore rule revision', 1, Number.MAX_SAFE_INTEGER),
    updatedAt: timestamp(input.updatedAt, 'Lore rule updatedAt'),
  });
}

export function createWorldInfoRetrievalQuery(
  input: WorldInfoRetrievalQuery,
): WorldInfoRetrievalQuery {
  if (!Number.isFinite(input.minimumScore) || input.minimumScore < 0 || input.minimumScore > 1) {
    throw new WorldInfoRetrievalContractError('Retrieval minimum score must be between 0 and 1');
  }
  return Object.freeze({
    ...input,
    text: canonicalText(input.text, 'Retrieval text', 8_000, false),
    entityRefs: refs(input.entityRefs, 'Retrieval entity refs'),
    locationIds: Object.freeze(
      idList(input.locationIds, 'Retrieval location IDs', 32).map(locationId),
    ),
    questIds: Object.freeze(idList(input.questIds, 'Retrieval Quest IDs', 32).map(questId)),
    maxTokens: integer(input.maxTokens, 'Retrieval token budget', 1, 16_000),
  });
}

function refs(values: readonly RetrievalEntityRef[], label: string): readonly RetrievalEntityRef[] {
  if (values.length > 64) throw new WorldInfoRetrievalContractError(`${label} exceed the limit`);
  const identities = new Set<string>();
  return Object.freeze(
    values.map((value) => {
      if (!RETRIEVAL_ENTITY_KINDS.includes(value.kind)) {
        throw new WorldInfoRetrievalContractError(`${label} contain an invalid kind`);
      }
      const id = canonicalText(value.id, `${label} ID`, 256, true);
      const identity = `${value.kind}:${id}`;
      if (identities.has(identity)) {
        throw new WorldInfoRetrievalContractError(`${label} must be unique`);
      }
      identities.add(identity);
      return Object.freeze({ kind: value.kind, id });
    }),
  );
}

function idList(values: readonly string[], label: string, max: number): readonly string[] {
  return textList(values, label, max, 256, true);
}

function textList(
  values: readonly string[],
  label: string,
  maxItems: number,
  maxLength: number,
  requireNonEmpty: boolean,
): readonly string[] {
  if (values.length > maxItems) {
    throw new WorldInfoRetrievalContractError(`${label} exceed the limit`);
  }
  const normalized = values.map((value) => canonicalText(value, label, maxLength, requireNonEmpty));
  if (new Set(normalized.map((value) => value.toLowerCase())).size !== normalized.length) {
    throw new WorldInfoRetrievalContractError(`${label} must be unique`);
  }
  return Object.freeze(normalized);
}

function canonicalText(
  value: string,
  label: string,
  maxLength: number,
  requireNonEmpty: boolean,
): string {
  if (
    value.trim() !== value ||
    value.normalize('NFC') !== value ||
    value.length > maxLength ||
    (requireNonEmpty && value.length === 0)
  ) {
    throw new WorldInfoRetrievalContractError(`${label} is invalid`);
  }
  return value;
}

function integer(value: number, label: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new WorldInfoRetrievalContractError(`${label} is invalid`);
  }
  return value;
}

function timestamp(value: IsoTimestamp, label: string): IsoTimestamp {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new WorldInfoRetrievalContractError(`${label} must be a canonical ISO timestamp`);
  }
  return value;
}
