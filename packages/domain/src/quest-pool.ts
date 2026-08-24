import type { QuestStatus, QuestTransitionSource } from '@ember-tavern/contracts';

import { RULE_QUEST_TRANSITIONS } from './rules-engine.js';

export const QUEST_TERMINAL_STATUSES = [
  'COMPLETED',
  'FAILED',
  'EXPIRED',
  'ABANDONED',
] as const satisfies readonly QuestStatus[];
const TERMINAL_STATUS_SET = new Set<QuestStatus>(QUEST_TERMINAL_STATUSES);
const PLAYER_INTERVENTION_FROM = new Set<QuestStatus>([
  'DISCOVERED',
  'AVAILABLE',
  'ACCEPTED',
  'UPDATED',
]);

export class QuestPoolRuleError extends Error {
  public readonly code: 'ILLEGAL_TRANSITION' | 'SOURCE_FORBIDDEN' | 'TERMINAL_IMMUTABLE';

  public constructor(code: QuestPoolRuleError['code']) {
    super('Quest pool transition is not allowed');
    this.name = 'QuestPoolRuleError';
    this.code = code;
  }
}

export function assertQuestPoolTransition(
  before: QuestStatus,
  after: QuestStatus,
  source: QuestTransitionSource,
): void {
  if (TERMINAL_STATUS_SET.has(before)) {
    throw new QuestPoolRuleError('TERMINAL_IMMUTABLE');
  }
  if (!RULE_QUEST_TRANSITIONS[before].includes(after)) {
    throw new QuestPoolRuleError('ILLEGAL_TRANSITION');
  }
  if (source === 'PLAYER_INTERVENTION') {
    if (after !== 'ACTIVE' || !PLAYER_INTERVENTION_FROM.has(before)) {
      throw new QuestPoolRuleError('SOURCE_FORBIDDEN');
    }
  }
  if (source === 'PLAYER') {
    if (after !== 'ABANDONED' || before === 'HIDDEN') {
      throw new QuestPoolRuleError('SOURCE_FORBIDDEN');
    }
  }
  if (source === 'INITIALIZATION' || source === 'MIGRATION' || source === 'GENERATION') {
    throw new QuestPoolRuleError('SOURCE_FORBIDDEN');
  }
}
