import {
  FACTION_ACTION_KINDS,
  FACTION_ACTION_SOURCES,
  PLAYER_FACTION_RELATIONS,
  createActiveFactionProfile,
  factionId,
  isoTimestamp,
  type ActiveFactionCandidate,
  type ActiveFactionProfile,
  type FactionActionBudget,
  type FactionActionConsequence,
  type FactionActionProposal,
  type FactionConstitutionEvidence,
  type LocationId,
  type Quest,
  type WorldConstitution,
} from '@ember-tavern/contracts';

import { RULE_QUEST_TRANSITIONS } from './rules-engine.js';

export const MAX_FACTION_ACTION_POINTS = 6;

const CONSEQUENCE_COST: Readonly<Record<FactionActionConsequence['kind'], number>> = {
  RESOURCE_ADD: 1,
  RESOURCE_REMOVE: 1,
  TERRITORY_ADD: 2,
  TERRITORY_REMOVE: 2,
  RELATION_SET: 2,
  PLAYER_RELATION_SET: 1,
  QUEST_STATUS_SET: 3,
  WORLD_FACT: 2,
};

export interface ActivateFactionsInput {
  readonly campaignId: string;
  readonly constitution: WorldConstitution;
  readonly existing: readonly ActiveFactionProfile[];
  readonly requestedFactionIds: readonly string[];
  readonly candidates: readonly ActiveFactionCandidate[];
  readonly allowedLocationIds: readonly string[];
  readonly generationRecordId: string;
  readonly at: string;
}

export interface FactionWorldFactDraft {
  readonly statement: string;
  readonly locationId: LocationId | null;
}

export interface ApplyFactionActionInput {
  readonly campaignId: string;
  readonly constitution: WorldConstitution;
  readonly factions: readonly ActiveFactionProfile[];
  readonly locationIds: readonly string[];
  readonly quests: readonly Quest[];
  readonly proposal: FactionActionProposal;
  readonly budget: FactionActionBudget;
  readonly at: string;
}

export interface FactionActionPlan {
  readonly factions: readonly ActiveFactionProfile[];
  readonly quests: readonly Quest[];
  readonly worldFacts: readonly FactionWorldFactDraft[];
  readonly cost: number;
}

export class ActiveFactionRuleError extends Error {
  public constructor(
    public readonly code:
      | 'FACTION_CONSTITUTION_MISMATCH'
      | 'FACTION_REFERENCE_INVALID'
      | 'FACTION_RELATION_INVALID'
      | 'FACTION_ACTION_ILLEGAL'
      | 'FACTION_BUDGET_EXCEEDED'
      | 'FACTION_DUPLICATE',
    public readonly paths: readonly string[],
    options?: ErrorOptions,
  ) {
    super('Active faction rule validation failed', options);
    this.name = 'ActiveFactionRuleError';
  }
}

export function activateFactions(input: ActivateFactionsInput): readonly ActiveFactionProfile[] {
  requireConstitution(input.constitution, input.campaignId);
  if (
    input.requestedFactionIds.length === 0 ||
    input.requestedFactionIds.length > 16 ||
    new Set(input.requestedFactionIds).size !== input.requestedFactionIds.length ||
    input.candidates.length !== input.requestedFactionIds.length
  ) {
    fail('FACTION_REFERENCE_INVALID', ['requestedFactionIds']);
  }
  const existing = new Map(input.existing.map((profile) => [profile.id, profile]));
  if (
    existing.size !== input.existing.length ||
    input.existing.some(
      (profile) =>
        profile.campaignId !== input.campaignId ||
        profile.constitutionRevision !== input.constitution.revision ||
        !sameEvidence(profile.constitutionEvidence, constitutionEvidence(input.constitution)),
    )
  ) {
    fail('FACTION_CONSTITUTION_MISMATCH', ['existing']);
  }
  const requested = new Set(input.requestedFactionIds);
  const allowedLocations = new Set(input.allowedLocationIds);
  const candidates = new Map<string, ActiveFactionCandidate>();
  for (const [index, candidate] of input.candidates.entries()) {
    const current = existing.get(factionId(candidate.id));
    if (
      current === undefined ||
      current.materialization !== 'OUTLINE' ||
      !requested.has(candidate.id) ||
      candidates.has(candidate.id) ||
      candidate.name !== current.name ||
      candidate.goal !== current.goal ||
      candidate.playerRelation !== current.playerRelation ||
      candidate.resources.length === 0 ||
      candidate.leadership.length === 0 ||
      candidate.currentAction.length === 0 ||
      !sameEvidence(candidate.constitutionEvidence, current.constitutionEvidence)
    ) {
      fail('FACTION_REFERENCE_INVALID', [`candidates[${index}]`]);
    }
    const enemy = new Set(candidate.enemyFactionIds);
    const ally = new Set(candidate.allyFactionIds);
    if (
      enemy.has(candidate.id) ||
      ally.has(candidate.id) ||
      [...enemy].some((id) => ally.has(id)) ||
      [...enemy, ...ally].some((id) => !existing.has(factionId(id))) ||
      candidate.territoryLocationIds.some((id) => !allowedLocations.has(id)) ||
      current.territoryLocationIds.some((id) => !candidate.territoryLocationIds.includes(id)) ||
      current.enemyFactionIds.some((id) => !candidate.enemyFactionIds.includes(id)) ||
      current.allyFactionIds.some((id) => !candidate.allyFactionIds.includes(id))
    ) {
      fail('FACTION_REFERENCE_INVALID', [`candidates[${index}].references`]);
    }
    candidates.set(candidate.id, candidate);
  }
  for (const candidate of candidates.values()) {
    const current = existing.get(factionId(candidate.id));
    if (current === undefined) fail('FACTION_REFERENCE_INVALID', [candidate.id]);
    for (const enemy of candidate.enemyFactionIds) {
      const counterpart = candidates.get(enemy);
      if (
        (counterpart !== undefined && !counterpart.enemyFactionIds.includes(candidate.id)) ||
        (counterpart === undefined && !current.enemyFactionIds.includes(factionId(enemy)))
      ) {
        fail('FACTION_RELATION_INVALID', [candidate.id, 'enemyFactionIds']);
      }
    }
    for (const ally of candidate.allyFactionIds) {
      const counterpart = candidates.get(ally);
      if (
        (counterpart !== undefined && !counterpart.allyFactionIds.includes(candidate.id)) ||
        (counterpart === undefined && !current.allyFactionIds.includes(factionId(ally)))
      ) {
        fail('FACTION_RELATION_INVALID', [candidate.id, 'allyFactionIds']);
      }
    }
  }
  const at = isoTimestamp(input.at);
  return Object.freeze(
    input.candidates.map((candidate) => {
      const current = existing.get(factionId(candidate.id));
      if (current === undefined) fail('FACTION_REFERENCE_INVALID', [candidate.id]);
      return createActiveFactionProfile({
        ...current,
        materialization: 'ACTIVE',
        resources: candidate.resources,
        leadership: candidate.leadership,
        enemyFactionIds: candidate.enemyFactionIds,
        allyFactionIds: candidate.allyFactionIds,
        territoryLocationIds: candidate.territoryLocationIds,
        currentAction: candidate.currentAction,
        playerRelation: candidate.playerRelation,
        constitutionEvidence: candidate.constitutionEvidence,
        generationRecordId: input.generationRecordId,
        revision: current.revision + 1,
        updatedAt: at,
      });
    }),
  );
}

export function applyFactionAction(input: ApplyFactionActionInput): FactionActionPlan {
  requireConstitution(input.constitution, input.campaignId);
  validateBudget(input.budget);
  if (
    !FACTION_ACTION_KINDS.includes(input.proposal.kind) ||
    !FACTION_ACTION_SOURCES.includes(input.proposal.source) ||
    input.proposal.consequences.length === 0 ||
    input.proposal.consequences.length > 8
  ) {
    fail('FACTION_ACTION_ILLEGAL', ['proposal']);
  }
  if (
    input.proposal.consequences.some(
      (consequence) => !Object.hasOwn(CONSEQUENCE_COST, consequence.kind),
    )
  ) {
    fail('FACTION_ACTION_ILLEGAL', ['consequences']);
  }
  const factions = new Map(input.factions.map((profile) => [profile.id, profile]));
  const actor = factions.get(input.proposal.factionId);
  if (
    actor === undefined ||
    actor.materialization !== 'ACTIVE' ||
    actor.campaignId !== input.campaignId ||
    input.factions.some(
      (profile) =>
        profile.campaignId !== input.campaignId ||
        profile.constitutionRevision !== input.constitution.revision ||
        !sameEvidence(profile.constitutionEvidence, constitutionEvidence(input.constitution)),
    )
  ) {
    fail('FACTION_CONSTITUTION_MISMATCH', ['factionId']);
  }
  const resources = new Set(actor.resources.map(normalize));
  if (input.proposal.requiredResources.some((resource) => !resources.has(normalize(resource)))) {
    fail('FACTION_ACTION_ILLEGAL', ['requiredResources']);
  }
  const cost = input.proposal.consequences.reduce(
    (total, consequence) => total + CONSEQUENCE_COST[consequence.kind],
    0,
  );
  const questChanges = input.proposal.consequences.filter(
    ({ kind }) => kind === 'QUEST_STATUS_SET',
  ).length;
  const worldFacts = input.proposal.consequences.filter(({ kind }) => kind === 'WORLD_FACT').length;
  if (
    cost > MAX_FACTION_ACTION_POINTS ||
    cost > input.budget.actionPoints ||
    questChanges > input.budget.questChanges ||
    worldFacts > input.budget.worldFacts
  ) {
    fail('FACTION_BUDGET_EXCEEDED', ['budget']);
  }
  const locations = new Set(input.locationIds);
  const quests = new Map(
    input.quests
      .filter(({ campaignId }) => campaignId === input.campaignId)
      .map((quest) => [quest.id, quest]),
  );
  const mutable = new Map<
    string,
    {
      resources: string[];
      enemyFactionIds: string[];
      allyFactionIds: string[];
      territoryLocationIds: string[];
      currentAction: string | null;
      playerRelation: ActiveFactionProfile['playerRelation'];
    }
  >();
  const state = (profile: ActiveFactionProfile) => {
    const prior = mutable.get(profile.id);
    if (prior !== undefined) return prior;
    const next = {
      resources: [...profile.resources],
      enemyFactionIds: [...profile.enemyFactionIds],
      allyFactionIds: [...profile.allyFactionIds],
      territoryLocationIds: [...profile.territoryLocationIds],
      currentAction: profile.currentAction,
      playerRelation: profile.playerRelation,
    };
    mutable.set(profile.id, next);
    return next;
  };
  const actorState = state(actor);
  actorState.currentAction = input.proposal.summary;
  const nextQuests = new Map(quests);
  const factDrafts: FactionWorldFactDraft[] = [];
  for (const [index, consequence] of input.proposal.consequences.entries()) {
    applyConsequence({
      consequence,
      index,
      actor,
      actorState,
      factions,
      state,
      locations,
      quests: nextQuests,
      facts: factDrafts,
      proposal: input.proposal,
      at: isoTimestamp(input.at),
    });
  }
  validateActionShape(input.proposal);
  const changed = new Set(mutable.keys());
  const at = isoTimestamp(input.at);
  const nextFactions = input.factions.map((profile) => {
    const update = mutable.get(profile.id);
    if (update === undefined) return profile;
    return createActiveFactionProfile({
      ...profile,
      ...update,
      revision: profile.revision + 1,
      updatedAt: at,
    });
  });
  if (changed.size === 0) fail('FACTION_ACTION_ILLEGAL', ['consequences']);
  return Object.freeze({
    factions: Object.freeze(nextFactions),
    quests: Object.freeze([...nextQuests.values()]),
    worldFacts: Object.freeze(factDrafts),
    cost,
  });
}

interface ConsequenceContext {
  readonly consequence: FactionActionConsequence;
  readonly index: number;
  readonly actor: ActiveFactionProfile;
  readonly actorState: {
    resources: string[];
    enemyFactionIds: string[];
    allyFactionIds: string[];
    territoryLocationIds: string[];
    currentAction: string | null;
    playerRelation: ActiveFactionProfile['playerRelation'];
  };
  readonly factions: ReadonlyMap<string, ActiveFactionProfile>;
  readonly state: (profile: ActiveFactionProfile) => ConsequenceContext['actorState'];
  readonly locations: ReadonlySet<string>;
  readonly quests: Map<string, Quest>;
  readonly facts: FactionWorldFactDraft[];
  readonly proposal: FactionActionProposal;
  readonly at: ReturnType<typeof isoTimestamp>;
}

function applyConsequence(context: ConsequenceContext): void {
  const { consequence, actorState, index } = context;
  switch (consequence.kind) {
    case 'RESOURCE_ADD':
      addText(actorState.resources, consequence.resource, index);
      break;
    case 'RESOURCE_REMOVE':
      removeText(actorState.resources, consequence.resource, index);
      break;
    case 'TERRITORY_ADD':
      if (!context.locations.has(consequence.locationId)) reference(index);
      addId(actorState.territoryLocationIds, consequence.locationId, index);
      break;
    case 'TERRITORY_REMOVE':
      if (!context.locations.has(consequence.locationId)) reference(index);
      removeId(actorState.territoryLocationIds, consequence.locationId, index);
      break;
    case 'RELATION_SET': {
      const target = context.factions.get(consequence.factionId);
      if (target === undefined || target.id === context.actor.id) reference(index);
      const targetState = context.state(target);
      if (relationOf(actorState, target.id) === consequence.relation) noChange(index);
      setRelation(actorState, target.id, consequence.relation);
      setRelation(targetState, context.actor.id, consequence.relation);
      break;
    }
    case 'PLAYER_RELATION_SET':
      if (!PLAYER_FACTION_RELATIONS.includes(consequence.relation)) reference(index);
      if (actorState.playerRelation === consequence.relation) noChange(index);
      actorState.playerRelation = consequence.relation;
      break;
    case 'QUEST_STATUS_SET': {
      const quest = context.quests.get(consequence.questId);
      if (
        quest === undefined ||
        !RULE_QUEST_TRANSITIONS[quest.status].includes(consequence.status)
      ) {
        reference(index);
      }
      context.quests.set(
        quest.id,
        Object.freeze({ ...quest, status: consequence.status, updatedAt: context.at }),
      );
      break;
    }
    case 'WORLD_FACT':
      if (consequence.locationId !== null && !context.locations.has(consequence.locationId)) {
        reference(index);
      }
      context.facts.push(
        Object.freeze({ statement: consequence.statement, locationId: consequence.locationId }),
      );
      break;
  }
}

function validateActionShape(proposal: FactionActionProposal): void {
  const has = (kind: FactionActionConsequence['kind']) =>
    proposal.consequences.some((consequence) => consequence.kind === kind);
  switch (proposal.kind) {
    case 'EXPAND_TERRITORY':
      if (
        proposal.targetLocationId === null ||
        (!has('TERRITORY_ADD') && !has('TERRITORY_REMOVE')) ||
        proposal.consequences.some(
          (consequence) =>
            (consequence.kind === 'TERRITORY_ADD' || consequence.kind === 'TERRITORY_REMOVE') &&
            consequence.locationId !== proposal.targetLocationId,
        )
      ) {
        fail('FACTION_ACTION_ILLEGAL', ['targetLocationId']);
      }
      break;
    case 'DIPLOMACY':
      if (
        proposal.targetFactionId === null ||
        !has('RELATION_SET') ||
        proposal.consequences.some(
          (consequence) =>
            consequence.kind === 'RELATION_SET' &&
            consequence.factionId !== proposal.targetFactionId,
        )
      ) {
        fail('FACTION_ACTION_ILLEGAL', ['targetFactionId']);
      }
      break;
    case 'SUPPORT_QUEST':
      if (
        proposal.targetQuestId === null ||
        !proposal.consequences.some(
          (consequence) =>
            consequence.kind === 'QUEST_STATUS_SET' && consequence.status === 'COMPLETED',
        ) ||
        proposal.consequences.some(
          (consequence) =>
            consequence.kind === 'QUEST_STATUS_SET' &&
            consequence.questId !== proposal.targetQuestId,
        )
      ) {
        fail('FACTION_ACTION_ILLEGAL', ['targetQuestId']);
      }
      break;
    case 'UNDERMINE_QUEST':
      if (
        proposal.targetQuestId === null ||
        !proposal.consequences.some(
          (consequence) =>
            consequence.kind === 'QUEST_STATUS_SET' && consequence.status === 'FAILED',
        ) ||
        proposal.consequences.some(
          (consequence) =>
            consequence.kind === 'QUEST_STATUS_SET' &&
            consequence.questId !== proposal.targetQuestId,
        )
      ) {
        fail('FACTION_ACTION_ILLEGAL', ['targetQuestId']);
      }
      break;
    case 'MOBILIZE':
    case 'RECOVER':
      break;
  }
}

function validateBudget(budget: FactionActionBudget): void {
  if (
    budget.decisionId.trim() !== budget.decisionId ||
    budget.decisionId.length === 0 ||
    budget.decisionId.length > 128 ||
    !Number.isSafeInteger(budget.actionPoints) ||
    budget.actionPoints < 0 ||
    budget.actionPoints > MAX_FACTION_ACTION_POINTS ||
    !Number.isSafeInteger(budget.questChanges) ||
    budget.questChanges < 0 ||
    budget.questChanges > 1 ||
    !Number.isSafeInteger(budget.worldFacts) ||
    budget.worldFacts < 0 ||
    budget.worldFacts > 1
  ) {
    fail('FACTION_BUDGET_EXCEEDED', ['budget']);
  }
}

function setRelation(
  state: Pick<ConsequenceContext['actorState'], 'enemyFactionIds' | 'allyFactionIds'>,
  target: string,
  relation: 'ALLY' | 'ENEMY' | 'NEUTRAL',
): void {
  state.enemyFactionIds = state.enemyFactionIds.filter((id) => id !== target);
  state.allyFactionIds = state.allyFactionIds.filter((id) => id !== target);
  if (relation === 'ALLY') state.allyFactionIds.push(target);
  if (relation === 'ENEMY') state.enemyFactionIds.push(target);
}

function relationOf(
  state: Pick<ConsequenceContext['actorState'], 'enemyFactionIds' | 'allyFactionIds'>,
  target: string,
): 'ALLY' | 'ENEMY' | 'NEUTRAL' {
  if (state.allyFactionIds.includes(target)) return 'ALLY';
  if (state.enemyFactionIds.includes(target)) return 'ENEMY';
  return 'NEUTRAL';
}

function addText(values: string[], value: string, index: number): void {
  if (values.some((candidate) => normalize(candidate) === normalize(value))) noChange(index);
  values.push(value);
}

function removeText(values: string[], value: string, index: number): void {
  const found = values.findIndex((candidate) => normalize(candidate) === normalize(value));
  if (found < 0) noChange(index);
  values.splice(found, 1);
}

function addId(values: string[], value: string, index: number): void {
  if (values.includes(value)) noChange(index);
  values.push(value);
}

function removeId(values: string[], value: string, index: number): void {
  const found = values.indexOf(value);
  if (found < 0) noChange(index);
  values.splice(found, 1);
}

function requireConstitution(constitution: WorldConstitution, campaign: string): void {
  if (constitution.status !== 'LOCKED' || constitution.campaignId !== campaign) {
    fail('FACTION_CONSTITUTION_MISMATCH', ['constitution']);
  }
}

function constitutionEvidence(constitution: WorldConstitution): FactionConstitutionEvidence {
  return Object.freeze({
    technology: constitution.technology,
    society: constitution.society,
    politics: constitution.politics,
    economy: constitution.economy,
  });
}

function sameEvidence(
  left: FactionConstitutionEvidence,
  right: FactionConstitutionEvidence,
): boolean {
  return (
    left.technology === right.technology &&
    left.society === right.society &&
    left.politics === right.politics &&
    left.economy === right.economy
  );
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function reference(index: number): never {
  fail('FACTION_REFERENCE_INVALID', [`consequences[${index}]`]);
}

function noChange(index: number): never {
  fail('FACTION_ACTION_ILLEGAL', [`consequences[${index}]`]);
}

function fail(code: ActiveFactionRuleError['code'], paths: readonly string[]): never {
  throw new ActiveFactionRuleError(code, Object.freeze([...paths]));
}
