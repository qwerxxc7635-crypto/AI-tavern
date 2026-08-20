import {
  campaignId,
  factionId,
  generationRecordId,
  isoTimestamp,
  locationId,
  questId,
  type CampaignId,
  type FactionId,
  type GenerationRecordId,
  type IsoTimestamp,
  type LocationId,
  type QuestId,
} from './foundation.js';
import { QUEST_STATUSES, type QuestStatus } from './quest.js';

export const FACTION_MATERIALIZATION_LEVELS = ['OUTLINE', 'ACTIVE'] as const;
export type FactionMaterializationLevel = (typeof FACTION_MATERIALIZATION_LEVELS)[number];

export const PLAYER_FACTION_RELATIONS = [
  'HOSTILE',
  'WARY',
  'NEUTRAL',
  'FRIENDLY',
  'ALLIED',
  'UNKNOWN',
] as const;
export type PlayerFactionRelation = (typeof PLAYER_FACTION_RELATIONS)[number];

export const FACTION_ACTION_KINDS = [
  'MOBILIZE',
  'EXPAND_TERRITORY',
  'DIPLOMACY',
  'SUPPORT_QUEST',
  'UNDERMINE_QUEST',
  'RECOVER',
] as const;
export type FactionActionKind = (typeof FACTION_ACTION_KINDS)[number];

export const FACTION_ACTION_SOURCES = ['PLAYER', 'WORLD_EVENT', 'DIRECTOR'] as const;
export type FactionActionSource = (typeof FACTION_ACTION_SOURCES)[number];

export interface FactionConstitutionEvidence {
  readonly technology: string;
  readonly society: string;
  readonly politics: string;
  readonly economy: string;
}

export interface ActiveFactionProfile {
  readonly kind: 'ACTIVE_FACTION';
  readonly schemaVersion: 1;
  readonly id: FactionId;
  readonly campaignId: CampaignId;
  readonly constitutionRevision: number;
  readonly materialization: FactionMaterializationLevel;
  readonly name: string;
  readonly description: string;
  readonly goal: string;
  readonly resources: readonly string[];
  readonly leadership: readonly string[];
  readonly enemyFactionIds: readonly FactionId[];
  readonly allyFactionIds: readonly FactionId[];
  readonly territoryLocationIds: readonly LocationId[];
  readonly currentAction: string | null;
  readonly playerRelation: PlayerFactionRelation;
  readonly constitutionEvidence: FactionConstitutionEvidence;
  readonly generationRecordId: GenerationRecordId | null;
  readonly revision: number;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface ActiveFactionCandidate {
  readonly id: string;
  readonly name: string;
  readonly goal: string;
  readonly resources: readonly string[];
  readonly leadership: readonly string[];
  readonly enemyFactionIds: readonly string[];
  readonly allyFactionIds: readonly string[];
  readonly territoryLocationIds: readonly string[];
  readonly currentAction: string;
  readonly playerRelation: PlayerFactionRelation;
  readonly constitutionEvidence: FactionConstitutionEvidence;
}

export type FactionActionConsequence =
  | { readonly kind: 'RESOURCE_ADD'; readonly resource: string }
  | { readonly kind: 'RESOURCE_REMOVE'; readonly resource: string }
  | { readonly kind: 'TERRITORY_ADD'; readonly locationId: LocationId }
  | { readonly kind: 'TERRITORY_REMOVE'; readonly locationId: LocationId }
  | {
      readonly kind: 'RELATION_SET';
      readonly factionId: FactionId;
      readonly relation: 'ALLY' | 'ENEMY' | 'NEUTRAL';
    }
  | { readonly kind: 'PLAYER_RELATION_SET'; readonly relation: PlayerFactionRelation }
  | { readonly kind: 'QUEST_STATUS_SET'; readonly questId: QuestId; readonly status: QuestStatus }
  | {
      readonly kind: 'WORLD_FACT';
      readonly statement: string;
      readonly locationId: LocationId | null;
    };

export interface FactionActionProposal {
  readonly id: string;
  readonly factionId: FactionId;
  readonly kind: FactionActionKind;
  readonly source: FactionActionSource;
  readonly summary: string;
  readonly requiredResources: readonly string[];
  readonly targetFactionId: FactionId | null;
  readonly targetLocationId: LocationId | null;
  readonly targetQuestId: QuestId | null;
  readonly consequences: readonly FactionActionConsequence[];
}

export interface FactionActionBudget {
  readonly decisionId: string;
  readonly actionPoints: number;
  readonly questChanges: number;
  readonly worldFacts: number;
}

export interface FactionActionEvent {
  readonly id: string;
  readonly campaignId: CampaignId;
  readonly factionId: FactionId;
  readonly source: FactionActionSource;
  readonly actionKind: FactionActionKind;
  readonly summary: string;
  readonly cost: number;
  readonly budgetDecisionId: string;
  readonly beforeRevision: number;
  readonly afterRevision: number;
  readonly proposal: FactionActionProposal;
  readonly occurredAt: IsoTimestamp;
}

export class ActiveFactionContractError extends Error {
  public constructor(
    public readonly code: 'FACTION_STRUCTURE_INVALID' | 'FACTION_DUPLICATE',
    public readonly path: string,
    options?: ErrorOptions,
  ) {
    super('Active faction contract validation failed', options);
    this.name = 'ActiveFactionContractError';
  }
}

export function createActiveFactionProfile(
  input: Omit<
    ActiveFactionProfile,
    | 'kind'
    | 'id'
    | 'campaignId'
    | 'enemyFactionIds'
    | 'allyFactionIds'
    | 'territoryLocationIds'
    | 'generationRecordId'
    | 'createdAt'
    | 'updatedAt'
  > & {
    readonly id: string;
    readonly campaignId: string;
    readonly enemyFactionIds: readonly string[];
    readonly allyFactionIds: readonly string[];
    readonly territoryLocationIds: readonly string[];
    readonly generationRecordId: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  },
): ActiveFactionProfile {
  if (input.schemaVersion !== 1) invalid('schemaVersion');
  if (!FACTION_MATERIALIZATION_LEVELS.includes(input.materialization)) invalid('materialization');
  if (!PLAYER_FACTION_RELATIONS.includes(input.playerRelation)) invalid('playerRelation');
  if (!Number.isSafeInteger(input.constitutionRevision) || input.constitutionRevision < 1) {
    invalid('constitutionRevision');
  }
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) invalid('revision');
  const profile = {
    ...input,
    kind: 'ACTIVE_FACTION' as const,
    id: factionId(input.id),
    campaignId: campaignId(input.campaignId),
    name: text(input.name, 'name', 120),
    description: text(input.description, 'description', 4_000),
    goal: text(input.goal, 'goal', 4_000),
    resources: textList(input.resources, 'resources', 24),
    leadership: textList(input.leadership, 'leadership', 24),
    enemyFactionIds: idList(input.enemyFactionIds, 'enemyFactionIds', factionId),
    allyFactionIds: idList(input.allyFactionIds, 'allyFactionIds', factionId),
    territoryLocationIds: idList(input.territoryLocationIds, 'territoryLocationIds', locationId),
    currentAction:
      input.currentAction === null ? null : text(input.currentAction, 'currentAction', 4_000),
    constitutionEvidence: evidence(input.constitutionEvidence),
    generationRecordId:
      input.generationRecordId === null ? null : generationRecordId(input.generationRecordId),
    createdAt: isoTimestamp(input.createdAt),
    updatedAt: isoTimestamp(input.updatedAt),
  };
  if (
    profile.enemyFactionIds.includes(profile.id) ||
    profile.allyFactionIds.includes(profile.id) ||
    profile.enemyFactionIds.some((id) => profile.allyFactionIds.includes(id))
  ) {
    invalid('relations');
  }
  if (
    profile.materialization === 'ACTIVE' &&
    (profile.resources.length === 0 ||
      profile.leadership.length === 0 ||
      profile.currentAction === null ||
      profile.generationRecordId === null)
  ) {
    invalid('materialization');
  }
  if (profile.materialization === 'OUTLINE' && profile.generationRecordId !== null) {
    invalid('generationRecordId');
  }
  return Object.freeze(profile);
}

export function parseActiveFactionProfile(value: unknown): ActiveFactionProfile {
  try {
    if (!record(value)) invalid('profile');
    exactKeys(
      value,
      [
        'kind',
        'schemaVersion',
        'id',
        'campaignId',
        'constitutionRevision',
        'materialization',
        'name',
        'description',
        'goal',
        'resources',
        'leadership',
        'enemyFactionIds',
        'allyFactionIds',
        'territoryLocationIds',
        'currentAction',
        'playerRelation',
        'constitutionEvidence',
        'generationRecordId',
        'revision',
        'createdAt',
        'updatedAt',
      ],
      'profile',
    );
    if (value['kind'] !== 'ACTIVE_FACTION') invalid('kind');
    return createActiveFactionProfile(
      value as unknown as Parameters<typeof createActiveFactionProfile>[0],
    );
  } catch (error) {
    if (error instanceof ActiveFactionContractError) throw error;
    throw new ActiveFactionContractError('FACTION_STRUCTURE_INVALID', 'profile', { cause: error });
  }
}

export function factionActionProposal(input: {
  readonly id: string;
  readonly factionId: string;
  readonly kind: FactionActionKind;
  readonly source: FactionActionSource;
  readonly summary: string;
  readonly requiredResources: readonly string[];
  readonly targetFactionId: string | null;
  readonly targetLocationId: string | null;
  readonly targetQuestId: string | null;
  readonly consequences: readonly FactionActionConsequence[];
}): FactionActionProposal {
  if (
    !FACTION_ACTION_KINDS.includes(input.kind) ||
    !FACTION_ACTION_SOURCES.includes(input.source)
  ) {
    invalid('action');
  }
  if (
    !Array.isArray(input.consequences) ||
    input.consequences.length === 0 ||
    input.consequences.length > 8
  ) {
    invalid('consequences');
  }
  return Object.freeze({
    ...input,
    id: text(input.id, 'id', 128),
    factionId: factionId(input.factionId),
    summary: text(input.summary, 'summary', 4_000),
    requiredResources: textList(input.requiredResources, 'requiredResources', 8),
    targetFactionId: input.targetFactionId === null ? null : factionId(input.targetFactionId),
    targetLocationId: input.targetLocationId === null ? null : locationId(input.targetLocationId),
    targetQuestId: input.targetQuestId === null ? null : questId(input.targetQuestId),
    consequences: Object.freeze(
      input.consequences.map((value, index) => canonicalConsequence(value, index)),
    ),
  });
}

function canonicalConsequence(
  value: FactionActionConsequence,
  index: number,
): FactionActionConsequence {
  if (!record(value) || typeof value['kind'] !== 'string') invalid(`consequences[${index}]`);
  const path = `consequences[${index}]`;
  switch (value.kind) {
    case 'RESOURCE_ADD':
    case 'RESOURCE_REMOVE':
      exactKeys(value, ['kind', 'resource'], path);
      return Object.freeze({
        kind: value.kind,
        resource: text(value.resource, `${path}.resource`, 200),
      });
    case 'TERRITORY_ADD':
    case 'TERRITORY_REMOVE':
      exactKeys(value, ['kind', 'locationId'], path);
      return Object.freeze({ kind: value.kind, locationId: locationId(value.locationId) });
    case 'RELATION_SET':
      exactKeys(value, ['kind', 'factionId', 'relation'], path);
      if (!['ALLY', 'ENEMY', 'NEUTRAL'].includes(value.relation)) invalid(`${path}.relation`);
      return Object.freeze({
        kind: value.kind,
        factionId: factionId(value.factionId),
        relation: value.relation,
      });
    case 'PLAYER_RELATION_SET':
      exactKeys(value, ['kind', 'relation'], path);
      if (!PLAYER_FACTION_RELATIONS.includes(value.relation)) invalid(`${path}.relation`);
      return Object.freeze({ kind: value.kind, relation: value.relation });
    case 'QUEST_STATUS_SET':
      exactKeys(value, ['kind', 'questId', 'status'], path);
      if (!QUEST_STATUSES.includes(value.status)) invalid(`${path}.status`);
      return Object.freeze({
        kind: value.kind,
        questId: questId(value.questId),
        status: value.status,
      });
    case 'WORLD_FACT':
      exactKeys(value, ['kind', 'statement', 'locationId'], path);
      return Object.freeze({
        kind: value.kind,
        statement: text(value.statement, `${path}.statement`, 4_000),
        locationId: value.locationId === null ? null : locationId(value.locationId),
      });
    default:
      invalid(path);
  }
}

function evidence(value: FactionConstitutionEvidence): FactionConstitutionEvidence {
  if (!record(value)) invalid('constitutionEvidence');
  exactKeys(value, ['technology', 'society', 'politics', 'economy'], 'constitutionEvidence');
  return Object.freeze({
    technology: text(value['technology'], 'constitutionEvidence.technology', 4_000),
    society: text(value['society'], 'constitutionEvidence.society', 4_000),
    politics: text(value['politics'], 'constitutionEvidence.politics', 4_000),
    economy: text(value['economy'], 'constitutionEvidence.economy', 4_000),
  });
}

function textList(values: readonly string[], path: string, maximum: number): readonly string[] {
  if (!Array.isArray(values) || values.length > maximum) invalid(path);
  const result = values.map((value, index) => text(value, `${path}[${index}]`, 200));
  if (new Set(result.map(normalize)).size !== result.length) duplicate(path);
  return Object.freeze(result);
}

function idList<T>(
  values: readonly string[],
  path: string,
  brand: (value: string) => T,
): readonly T[] {
  if (!Array.isArray(values) || values.length > 64) invalid(path);
  const result = values.map(brand);
  if (new Set(result).size !== result.length) duplicate(path);
  return Object.freeze(result);
}

function text(value: unknown, path: string, maximum: number): string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length === 0 ||
    [...value].length > maximum
  ) {
    invalid(path);
  }
  return value;
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid(path);
  }
}

function invalid(path: string): never {
  throw new ActiveFactionContractError('FACTION_STRUCTURE_INVALID', path);
}

function duplicate(path: string): never {
  throw new ActiveFactionContractError('FACTION_DUPLICATE', path);
}
