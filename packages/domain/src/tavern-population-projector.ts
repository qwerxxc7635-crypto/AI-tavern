import {
  TAVERN_POPULATION_SOURCE_KINDS,
  TAVERN_POPULATION_TRIGGERS,
  createTavernPopulationMember,
  createTavernPopulationState,
  isoTimestamp,
  type NpcLodProfile,
  type TavernOpportunity,
  type TavernPopulationContext,
  type TavernPopulationMember,
  type TavernPopulationState,
  type TavernPopulationTrigger,
  type TavernPopulationSourceKind,
} from '@ember-tavern/contracts';

export interface TavernPopulationCandidate {
  readonly profile: NpcLodProfile;
  readonly sourceKind: TavernPopulationSourceKind;
  readonly sourceId: string;
  readonly populationRole: string;
}

export interface ProjectTavernPopulationInput {
  readonly currentState: TavernPopulationState | null;
  readonly currentMembers: readonly TavernPopulationMember[];
  readonly context: TavernPopulationContext;
  readonly candidates: readonly TavernPopulationCandidate[];
  readonly opportunities: readonly TavernOpportunity[];
  readonly trigger: TavernPopulationTrigger;
  readonly at: string;
}

export interface TavernPopulationProjectionPlan {
  readonly changed: boolean;
  readonly state: TavernPopulationState;
  readonly members: readonly TavernPopulationMember[];
}

export interface FocusTavernPopulationInput {
  readonly state: TavernPopulationState;
  readonly members: readonly TavernPopulationMember[];
  readonly npcProfile: NpcLodProfile;
  readonly expectedRevision: number;
  readonly at: string;
}

export class TavernPopulationRuleError extends Error {
  public constructor(
    public readonly code:
      | 'TAVERN_POPULATION_CONTEXT_INVALID'
      | 'TAVERN_POPULATION_REFERENCE_INVALID'
      | 'TAVERN_POPULATION_IDENTITY_DRIFT'
      | 'TAVERN_POPULATION_REVISION_DRIFT'
      | 'TAVERN_POPULATION_FOCUS_INVALID',
    public readonly paths: readonly string[],
  ) {
    super('Tavern population rule validation failed');
    this.name = 'TavernPopulationRuleError';
  }
}

export function projectTavernPopulation(
  input: ProjectTavernPopulationInput,
): TavernPopulationProjectionPlan {
  if (!TAVERN_POPULATION_TRIGGERS.includes(input.trigger)) {
    fail('TAVERN_POPULATION_CONTEXT_INVALID', ['trigger']);
  }
  const at = isoTimestamp(input.at);
  validateCurrent(input.currentState, input.currentMembers, input.context);
  validateCandidates(input.candidates, input.context);

  const canonicalOpportunities = input.opportunities.map((opportunity) =>
    Object.freeze({ ...opportunity }),
  );
  if (
    new Set(canonicalOpportunities.map(({ id }) => id)).size !== canonicalOpportunities.length ||
    canonicalOpportunities.some(({ sourceId }) => sourceId.length === 0)
  ) {
    fail('TAVERN_POPULATION_REFERENCE_INVALID', ['opportunities']);
  }
  if (
    input.currentState !== null &&
    JSON.stringify(input.currentState.context) === JSON.stringify(input.context) &&
    JSON.stringify(input.currentState.opportunities) === JSON.stringify(canonicalOpportunities)
  ) {
    return Object.freeze({
      changed: false,
      state: input.currentState,
      members: Object.freeze([...input.currentMembers]),
    });
  }

  const currentByNpc = new Map(input.currentMembers.map((member) => [member.npcId, member]));
  const currentBySource = new Map(
    input.currentMembers.map((member) => [`${member.sourceKind}:${member.sourceId}`, member]),
  );
  const next = new Map<string, TavernPopulationMember>();
  const selected = new Set<string>();
  for (const candidate of input.candidates) {
    const sourceKey = `${candidate.sourceKind}:${candidate.sourceId}`;
    const priorSource = currentBySource.get(sourceKey);
    const priorNpc = currentByNpc.get(candidate.profile.id);
    if (
      (priorSource !== undefined && priorSource.npcId !== candidate.profile.id) ||
      (priorNpc !== undefined &&
        (priorNpc.sourceKind !== candidate.sourceKind || priorNpc.sourceId !== candidate.sourceId))
    ) {
      fail('TAVERN_POPULATION_IDENTITY_DRIFT', [sourceKey]);
    }
    selected.add(candidate.profile.id);
    next.set(
      candidate.profile.id,
      createTavernPopulationMember({
        npcId: candidate.profile.id,
        sourceKind: candidate.sourceKind,
        sourceId: candidate.sourceId,
        populationRole: candidate.populationRole,
        presence: 'PRESENT',
        isImportant: priorNpc?.isImportant ?? false,
        firstSeenAt: priorNpc?.firstSeenAt ?? at,
        lastSeenAt: at,
        encounterCount: (priorNpc?.encounterCount ?? 0) + 1,
        profile: candidate.profile,
      }),
    );
  }

  const historical = new Set(input.context.historyNpcIds);
  for (const prior of input.currentMembers) {
    if (selected.has(prior.npcId)) continue;
    const present = prior.isImportant || historical.has(prior.npcId);
    next.set(
      prior.npcId,
      createTavernPopulationMember({
        ...prior,
        presence: present ? 'PRESENT' : 'ABSENT',
        lastSeenAt: present ? at : prior.lastSeenAt,
        encounterCount: present ? prior.encounterCount + 1 : prior.encounterCount,
      }),
    );
  }

  const members = Object.freeze(
    [...next.values()].sort((left, right) => {
      const presence = left.presence === right.presence ? 0 : left.presence === 'PRESENT' ? -1 : 1;
      return (
        presence ||
        sourceOrder(left.sourceKind) - sourceOrder(right.sourceKind) ||
        left.npcId.localeCompare(right.npcId)
      );
    }),
  );
  const emptyState =
    !members.some(({ presence, sourceKind }) => presence === 'PRESENT' && sourceKind !== 'OWNER') &&
    canonicalOpportunities.length === 0;
  const state = createTavernPopulationState({
    campaignId: input.context.campaignId,
    tavernId: input.context.tavernId,
    revision: (input.currentState?.revision ?? 0) + 1,
    trigger: input.trigger,
    context: input.context,
    opportunities: canonicalOpportunities,
    emptyState,
    projectedAt: at,
  });
  return Object.freeze({ changed: true, state, members });
}

export function focusTavernPopulation(
  input: FocusTavernPopulationInput,
): TavernPopulationProjectionPlan {
  if (input.state.revision !== input.expectedRevision) {
    fail('TAVERN_POPULATION_REVISION_DRIFT', ['expectedRevision']);
  }
  const member = input.members.find(({ npcId: id }) => id === input.npcProfile.id);
  if (
    member === undefined ||
    member.presence !== 'PRESENT' ||
    input.npcProfile.campaignId !== input.state.campaignId ||
    input.npcProfile.lod < 1 ||
    input.npcProfile.identityAnchor !== member.profile.identityAnchor ||
    input.npcProfile.populationRole !== member.populationRole ||
    input.npcProfile.revision < member.profile.revision
  ) {
    fail('TAVERN_POPULATION_FOCUS_INVALID', ['npcProfile']);
  }
  const at = isoTimestamp(input.at);
  const members = Object.freeze(
    input.members.map((value) =>
      value.npcId === member.npcId
        ? createTavernPopulationMember({
            ...value,
            isImportant: true,
            lastSeenAt: at,
            encounterCount: value.encounterCount + 1,
            profile: input.npcProfile,
          })
        : value,
    ),
  );
  return Object.freeze({
    changed: true,
    state: createTavernPopulationState({
      ...input.state,
      revision: input.state.revision + 1,
    }),
    members,
  });
}

function validateCurrent(
  state: TavernPopulationState | null,
  members: readonly TavernPopulationMember[],
  context: TavernPopulationContext,
): void {
  if (
    (state !== null &&
      (state.campaignId !== context.campaignId || state.tavernId !== context.tavernId)) ||
    new Set(members.map(({ npcId: id }) => id)).size !== members.length ||
    new Set(members.map(({ sourceKind, sourceId }) => `${sourceKind}:${sourceId}`)).size !==
      members.length ||
    members.some(({ profile }) => profile.campaignId !== context.campaignId)
  ) {
    fail('TAVERN_POPULATION_CONTEXT_INVALID', ['current']);
  }
}

function validateCandidates(
  candidates: readonly TavernPopulationCandidate[],
  context: TavernPopulationContext,
): void {
  const ids = new Set<string>();
  const sources = new Set<string>();
  for (const [index, candidate] of candidates.entries()) {
    const source = `${candidate.sourceKind}:${candidate.sourceId}`;
    if (
      !TAVERN_POPULATION_SOURCE_KINDS.includes(candidate.sourceKind) ||
      candidate.profile.campaignId !== context.campaignId ||
      candidate.profile.populationRole !== candidate.populationRole ||
      candidate.sourceId.trim() !== candidate.sourceId ||
      candidate.sourceId.length === 0 ||
      ids.has(candidate.profile.id) ||
      sources.has(source)
    ) {
      fail('TAVERN_POPULATION_REFERENCE_INVALID', [`candidates[${index}]`]);
    }
    ids.add(candidate.profile.id);
    sources.add(source);
  }
}

function sourceOrder(value: TavernPopulationSourceKind): number {
  return TAVERN_POPULATION_SOURCE_KINDS.indexOf(value);
}

function fail(code: TavernPopulationRuleError['code'], paths: readonly string[]): never {
  throw new TavernPopulationRuleError(code, Object.freeze([...paths]));
}
