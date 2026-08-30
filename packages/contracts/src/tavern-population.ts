import {
  campaignId,
  isoTimestamp,
  locationId,
  npcId,
  tavernId,
  type CampaignId,
  type IsoTimestamp,
  type LocationId,
  type NpcId,
  type TavernId,
} from './foundation.js';
import { parseNpcLodProfile, type NpcLodProfile } from './npc-lod.js';

export const TAVERN_POPULATION_TRIGGERS = [
  'ENTERED',
  'TIME_ADVANCED',
  'EVENT_COMMITTED',
  'ADVENTURE_RETURNED',
  'MANUAL_REFRESH',
] as const;
export type TavernPopulationTrigger = (typeof TAVERN_POPULATION_TRIGGERS)[number];

export const TAVERN_POPULATION_SOURCE_KINDS = [
  'OWNER',
  'ESTABLISHED',
  'LOCATION',
  'CLOCK',
  'FACTION',
  'EVENT',
] as const;
export type TavernPopulationSourceKind = (typeof TAVERN_POPULATION_SOURCE_KINDS)[number];

export const TAVERN_POPULATION_PRESENCES = ['PRESENT', 'ABSENT'] as const;
export type TavernPopulationPresence = (typeof TAVERN_POPULATION_PRESENCES)[number];

export const TAVERN_OPPORTUNITY_KINDS = ['RUMOR', 'QUEST', 'FACTION', 'CLOCK', 'EVENT'] as const;
export type TavernOpportunityKind = (typeof TAVERN_OPPORTUNITY_KINDS)[number];

export interface TavernPopulationClockFactor {
  readonly id: string;
  readonly current: number;
  readonly max: number;
  readonly updatedAt: IsoTimestamp;
}

export interface TavernPopulationFactionFactor {
  readonly id: string;
  readonly revision: number;
  readonly currentAction: string;
  readonly playerRelation: string;
  readonly territoryLocationIds: readonly LocationId[];
}

export interface TavernPopulationContext {
  readonly campaignId: CampaignId;
  readonly tavernId: TavernId;
  readonly worldUpdatedAt: IsoTimestamp;
  readonly currentLocationId: LocationId;
  readonly locationRevision: number;
  readonly clocks: readonly TavernPopulationClockFactor[];
  readonly activeFactions: readonly TavernPopulationFactionFactor[];
  readonly recentEventIds: readonly string[];
  readonly historyNpcIds: readonly NpcId[];
}

export interface TavernPopulationMember {
  readonly npcId: NpcId;
  readonly sourceKind: TavernPopulationSourceKind;
  readonly sourceId: string;
  readonly populationRole: string;
  readonly presence: TavernPopulationPresence;
  readonly isImportant: boolean;
  readonly firstSeenAt: IsoTimestamp;
  readonly lastSeenAt: IsoTimestamp;
  readonly encounterCount: number;
  readonly profile: NpcLodProfile;
}

export interface TavernOpportunity {
  readonly id: string;
  readonly kind: TavernOpportunityKind;
  readonly sourceId: string;
  readonly title: string;
  readonly detail: string;
}

export interface TavernPopulationState {
  readonly campaignId: CampaignId;
  readonly tavernId: TavernId;
  readonly revision: number;
  readonly trigger: TavernPopulationTrigger;
  readonly context: TavernPopulationContext;
  readonly opportunities: readonly TavernOpportunity[];
  readonly emptyState: boolean;
  readonly projectedAt: IsoTimestamp;
}

export interface TavernPopulationCycle {
  readonly id: string;
  readonly operationId: string;
  readonly campaignId: CampaignId;
  readonly tavernId: TavernId;
  readonly trigger: TavernPopulationTrigger;
  readonly beforeRevision: number;
  readonly afterRevision: number;
  readonly context: TavernPopulationContext;
  readonly presentNpcIds: readonly NpcId[];
  readonly opportunityIds: readonly string[];
  readonly occurredAt: IsoTimestamp;
}

export interface TavernPopulationFocusEvent {
  readonly id: string;
  readonly operationId: string;
  readonly campaignId: CampaignId;
  readonly tavernId: TavernId;
  readonly npcId: NpcId;
  readonly beforeRevision: number;
  readonly afterRevision: number;
  readonly npcLod: number;
  readonly occurredAt: IsoTimestamp;
}

export interface TavernPopulationSnapshot {
  readonly state: TavernPopulationState | null;
  readonly members: readonly TavernPopulationMember[];
  readonly cycles: readonly TavernPopulationCycle[];
  readonly focusHistory: readonly TavernPopulationFocusEvent[];
}

export class TavernPopulationContractError extends Error {
  public constructor(
    public readonly code: 'TAVERN_POPULATION_STRUCTURE_INVALID' | 'TAVERN_POPULATION_DUPLICATE',
    public readonly path: string,
    options?: ErrorOptions,
  ) {
    super('Tavern population contract validation failed', options);
    this.name = 'TavernPopulationContractError';
  }
}

export function createTavernPopulationContext(input: {
  readonly campaignId: string;
  readonly tavernId: string;
  readonly worldUpdatedAt: string;
  readonly currentLocationId: string;
  readonly locationRevision: number;
  readonly clocks: readonly {
    readonly id: string;
    readonly current: number;
    readonly max: number;
    readonly updatedAt: string;
  }[];
  readonly activeFactions: readonly {
    readonly id: string;
    readonly revision: number;
    readonly currentAction: string;
    readonly playerRelation: string;
    readonly territoryLocationIds: readonly string[];
  }[];
  readonly recentEventIds: readonly string[];
  readonly historyNpcIds: readonly string[];
}): TavernPopulationContext {
  positiveInteger(input.locationRevision, 'locationRevision');
  const clocks = input.clocks.map((clock, index) => {
    exactKeys(clock, ['id', 'current', 'max', 'updatedAt'], `clocks[${index}]`);
    const current = nonnegativeInteger(clock.current, `clocks[${index}].current`);
    const max = positiveInteger(clock.max, `clocks[${index}].max`);
    if (current > max) invalid(`clocks[${index}]`);
    return Object.freeze({
      id: text(clock.id, `clocks[${index}].id`, 200),
      current,
      max,
      updatedAt: isoTimestamp(clock.updatedAt),
    });
  });
  const factions = input.activeFactions.map((faction, index) => {
    exactKeys(
      faction,
      ['id', 'revision', 'currentAction', 'playerRelation', 'territoryLocationIds'],
      `activeFactions[${index}]`,
    );
    return Object.freeze({
      id: text(faction.id, `activeFactions[${index}].id`, 200),
      revision: positiveInteger(faction.revision, `activeFactions[${index}].revision`),
      currentAction: text(faction.currentAction, `activeFactions[${index}].currentAction`, 4_000),
      playerRelation: text(faction.playerRelation, `activeFactions[${index}].playerRelation`, 40),
      territoryLocationIds: Object.freeze(
        uniqueIds(
          faction.territoryLocationIds,
          `activeFactions[${index}].territoryLocationIds`,
          locationId,
        ),
      ),
    });
  });
  uniqueBy(clocks, ({ id }) => id, 'clocks');
  uniqueBy(factions, ({ id }) => id, 'activeFactions');
  return Object.freeze({
    campaignId: campaignId(input.campaignId),
    tavernId: tavernId(input.tavernId),
    worldUpdatedAt: isoTimestamp(input.worldUpdatedAt),
    currentLocationId: locationId(input.currentLocationId),
    locationRevision: input.locationRevision,
    clocks: Object.freeze(clocks),
    activeFactions: Object.freeze(factions),
    recentEventIds: Object.freeze(uniqueText(input.recentEventIds, 'recentEventIds', 16, 200)),
    historyNpcIds: Object.freeze(uniqueIds(input.historyNpcIds, 'historyNpcIds', npcId)),
  });
}

export function createTavernPopulationMember(input: {
  readonly npcId: string;
  readonly sourceKind: TavernPopulationSourceKind;
  readonly sourceId: string;
  readonly populationRole: string;
  readonly presence: TavernPopulationPresence;
  readonly isImportant: boolean;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly encounterCount: number;
  readonly profile: NpcLodProfile;
}): TavernPopulationMember {
  if (!TAVERN_POPULATION_SOURCE_KINDS.includes(input.sourceKind)) invalid('sourceKind');
  if (!TAVERN_POPULATION_PRESENCES.includes(input.presence)) invalid('presence');
  if (typeof input.isImportant !== 'boolean') invalid('isImportant');
  const member = Object.freeze({
    npcId: npcId(input.npcId),
    sourceKind: input.sourceKind,
    sourceId: text(input.sourceId, 'sourceId', 200),
    populationRole: text(input.populationRole, 'populationRole', 200),
    presence: input.presence,
    isImportant: input.isImportant,
    firstSeenAt: isoTimestamp(input.firstSeenAt),
    lastSeenAt: isoTimestamp(input.lastSeenAt),
    encounterCount: nonnegativeInteger(input.encounterCount, 'encounterCount'),
    profile: parseNpcLodProfile(input.profile),
  });
  if (
    member.profile.id !== member.npcId ||
    member.profile.populationRole !== member.populationRole ||
    member.lastSeenAt < member.firstSeenAt
  ) {
    invalid('member');
  }
  return member;
}

export function createTavernOpportunity(input: TavernOpportunity): TavernOpportunity {
  if (!TAVERN_OPPORTUNITY_KINDS.includes(input.kind)) invalid('opportunity.kind');
  return Object.freeze({
    id: text(input.id, 'opportunity.id', 200),
    kind: input.kind,
    sourceId: text(input.sourceId, 'opportunity.sourceId', 200),
    title: text(input.title, 'opportunity.title', 200),
    detail: text(input.detail, 'opportunity.detail', 4_000),
  });
}

export function createTavernPopulationState(input: {
  readonly campaignId: string;
  readonly tavernId: string;
  readonly revision: number;
  readonly trigger: TavernPopulationTrigger;
  readonly context: TavernPopulationContext;
  readonly opportunities: readonly TavernOpportunity[];
  readonly emptyState: boolean;
  readonly projectedAt: string;
}): TavernPopulationState {
  if (!TAVERN_POPULATION_TRIGGERS.includes(input.trigger)) invalid('trigger');
  if (typeof input.emptyState !== 'boolean') invalid('emptyState');
  const state = Object.freeze({
    campaignId: campaignId(input.campaignId),
    tavernId: tavernId(input.tavernId),
    revision: positiveInteger(input.revision, 'revision'),
    trigger: input.trigger,
    context: createTavernPopulationContext(input.context),
    opportunities: Object.freeze(input.opportunities.map(createTavernOpportunity)),
    emptyState: input.emptyState,
    projectedAt: isoTimestamp(input.projectedAt),
  });
  uniqueBy(state.opportunities, ({ id }) => id, 'opportunities');
  if (state.context.campaignId !== state.campaignId || state.context.tavernId !== state.tavernId) {
    invalid('context');
  }
  return state;
}

export function createTavernPopulationCycle(input: {
  readonly id: string;
  readonly operationId: string;
  readonly campaignId: string;
  readonly tavernId: string;
  readonly trigger: TavernPopulationTrigger;
  readonly beforeRevision: number;
  readonly afterRevision: number;
  readonly context: TavernPopulationContext;
  readonly presentNpcIds: readonly string[];
  readonly opportunityIds: readonly string[];
  readonly occurredAt: string;
}): TavernPopulationCycle {
  if (!TAVERN_POPULATION_TRIGGERS.includes(input.trigger)) invalid('cycle.trigger');
  const beforeRevision = nonnegativeInteger(input.beforeRevision, 'cycle.beforeRevision');
  const afterRevision = positiveInteger(input.afterRevision, 'cycle.afterRevision');
  if (afterRevision !== beforeRevision + 1) invalid('cycle.revision');
  const context = createTavernPopulationContext(input.context);
  const cycle = Object.freeze({
    id: text(input.id, 'cycle.id', 200),
    operationId: text(input.operationId, 'cycle.operationId', 200),
    campaignId: campaignId(input.campaignId),
    tavernId: tavernId(input.tavernId),
    trigger: input.trigger,
    beforeRevision,
    afterRevision,
    context,
    presentNpcIds: Object.freeze(uniqueIds(input.presentNpcIds, 'cycle.presentNpcIds', npcId)),
    opportunityIds: Object.freeze(
      uniqueText(input.opportunityIds, 'cycle.opportunityIds', 64, 200),
    ),
    occurredAt: isoTimestamp(input.occurredAt),
  });
  if (context.campaignId !== cycle.campaignId || context.tavernId !== cycle.tavernId) {
    invalid('cycle.context');
  }
  return cycle;
}

export function createTavernPopulationFocusEvent(input: {
  readonly id: string;
  readonly operationId: string;
  readonly campaignId: string;
  readonly tavernId: string;
  readonly npcId: string;
  readonly beforeRevision: number;
  readonly afterRevision: number;
  readonly npcLod: number;
  readonly occurredAt: string;
}): TavernPopulationFocusEvent {
  const beforeRevision = positiveInteger(input.beforeRevision, 'focus.beforeRevision');
  const afterRevision = positiveInteger(input.afterRevision, 'focus.afterRevision');
  if (
    afterRevision !== beforeRevision + 1 ||
    !Number.isSafeInteger(input.npcLod) ||
    input.npcLod < 1 ||
    input.npcLod > 3
  ) {
    invalid('focus.revision');
  }
  return Object.freeze({
    id: text(input.id, 'focus.id', 200),
    operationId: text(input.operationId, 'focus.operationId', 200),
    campaignId: campaignId(input.campaignId),
    tavernId: tavernId(input.tavernId),
    npcId: npcId(input.npcId),
    beforeRevision,
    afterRevision,
    npcLod: input.npcLod,
    occurredAt: isoTimestamp(input.occurredAt),
  });
}

export function createTavernPopulationSnapshot(
  input: TavernPopulationSnapshot,
): TavernPopulationSnapshot {
  const state = input.state === null ? null : createTavernPopulationState(input.state);
  const members = Object.freeze(input.members.map(createTavernPopulationMember));
  const cycles = Object.freeze(input.cycles.map(createTavernPopulationCycle));
  const focusHistory = Object.freeze(input.focusHistory.map(createTavernPopulationFocusEvent));
  if (
    new Set(members.map(({ npcId: id }) => id)).size !== members.length ||
    (state !== null && members.some(({ profile }) => profile.campaignId !== state.campaignId))
  ) {
    invalid('snapshot');
  }
  return Object.freeze({ state, members, cycles, focusHistory });
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

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid(path);
  return value as number;
}

function nonnegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(path);
  return value as number;
}

function uniqueText(
  values: readonly string[],
  path: string,
  maximum: number,
  textMaximum: number,
): string[] {
  if (!Array.isArray(values) || values.length > maximum) invalid(path);
  const result = values.map((value, index) => text(value, `${path}[${index}]`, textMaximum));
  if (new Set(result).size !== result.length) duplicate(path);
  return result;
}

function uniqueIds<T>(values: readonly string[], path: string, factory: (value: string) => T): T[] {
  if (!Array.isArray(values) || values.length > 64) invalid(path);
  const result = values.map(factory);
  if (new Set(result).size !== result.length) duplicate(path);
  return result;
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string, path: string): void {
  if (new Set(values.map(key)).size !== values.length) duplicate(path);
}

function exactKeys(value: object, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    invalid(path);
  }
}

function invalid(path: string): never {
  throw new TavernPopulationContractError('TAVERN_POPULATION_STRUCTURE_INVALID', path);
}

function duplicate(path: string): never {
  throw new TavernPopulationContractError('TAVERN_POPULATION_DUPLICATE', path);
}
