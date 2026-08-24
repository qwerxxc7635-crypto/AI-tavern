import {
  DynamicQuestSourceContractError,
  type DynamicQuestBudget,
  type DynamicQuestSourceContext,
  type QuestStatus,
} from '@ember-tavern/contracts';

export const DYNAMIC_QUEST_OPEN_LIMIT = 12;

export function dynamicQuestInitialStatus(source: DynamicQuestSourceContext): QuestStatus {
  validateDynamicQuestSource(source);
  if (source.visibility === 'HIDDEN') return 'HIDDEN';
  if (source.kind === 'PLAYER_ACTION' && source.playerIntervened) return 'ACTIVE';
  if (source.kind === 'DISCOVERY' || source.kind === 'CONSEQUENCE') return 'DISCOVERED';
  return 'AVAILABLE';
}

export function dynamicQuestBudget(currentOpenQuests: number): DynamicQuestBudget {
  if (!Number.isSafeInteger(currentOpenQuests) || currentOpenQuests < 0) {
    throw new DynamicQuestSourceContractError('BUDGET_EXCEEDED');
  }
  return Object.freeze({
    policyVersion: 1,
    openQuestLimit: DYNAMIC_QUEST_OPEN_LIMIT,
    currentOpenQuests,
    remainingSlots: Math.max(0, DYNAMIC_QUEST_OPEN_LIMIT - currentOpenQuests),
  });
}

export function assertDynamicQuestBudget(budget: DynamicQuestBudget): void {
  if (
    budget.policyVersion !== 1 ||
    budget.openQuestLimit !== DYNAMIC_QUEST_OPEN_LIMIT ||
    !Number.isSafeInteger(budget.currentOpenQuests) ||
    budget.currentOpenQuests < 0 ||
    budget.remainingSlots !== Math.max(0, budget.openQuestLimit - budget.currentOpenQuests) ||
    budget.remainingSlots < 1
  ) {
    throw new DynamicQuestSourceContractError('BUDGET_EXCEEDED');
  }
}

export function validateDynamicQuestSource(source: DynamicQuestSourceContext): void {
  canonical(source.occurrenceId, 200);
  canonical(source.entityId, 200);
  canonical(source.summary, 4_000);
  if (source.actorNpcId !== null) canonical(source.actorNpcId, 200);
  if (source.kind === 'PLAYER_ACTION' && !source.playerIntervened) invalid();
  if (source.kind !== 'PLAYER_ACTION' && source.playerIntervened) invalid();
  if (source.kind === 'NPC' && (source.entityKind !== 'NPC' || source.actorNpcId === null)) {
    invalid();
  }
  if (source.kind === 'FACTION' && source.entityKind !== 'FACTION') invalid();
  if (source.kind === 'WORLD_EVENT' && source.entityKind !== 'GAME_EVENT') invalid();
  if (source.kind === 'DISCOVERY' && source.entityKind !== 'WORLD_FACT') invalid();
  if (source.kind === 'PLAYER_ACTION' && source.entityKind !== 'PLAYER_ACTION') invalid();
  if (source.kind === 'CONSEQUENCE' && source.entityKind !== 'QUEST_GRAPH') invalid();
}

function canonical(value: string, max: number): void {
  if (value.length === 0 || value.length > max || value.trim() !== value) invalid();
}

function invalid(): never {
  throw new DynamicQuestSourceContractError('SOURCE_INVALID');
}
