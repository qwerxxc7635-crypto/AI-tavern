import { describe, expect, it } from 'vitest';

import { npcId, type DynamicQuestSourceContext } from '@ember-tavern/contracts';

import {
  assertDynamicQuestBudget,
  dynamicQuestBudget,
  dynamicQuestInitialStatus,
} from './dynamic-quest-source.js';

describe('dynamic Quest source policy', () => {
  it('derives visibility and intervention status locally', () => {
    expect(dynamicQuestInitialStatus(source('NPC'))).toBe('AVAILABLE');
    expect(dynamicQuestInitialStatus(source('DISCOVERY'))).toBe('DISCOVERED');
    expect(dynamicQuestInitialStatus(source('PLAYER_ACTION'))).toBe('ACTIVE');
    expect(dynamicQuestInitialStatus({ ...source('CONSEQUENCE'), visibility: 'HIDDEN' })).toBe(
      'HIDDEN',
    );
  });

  it('rejects exhausted or forged adapter budgets', () => {
    expect(() => assertDynamicQuestBudget(dynamicQuestBudget(11))).not.toThrow();
    expect(() => assertDynamicQuestBudget(dynamicQuestBudget(12))).toThrow(
      expect.objectContaining({ code: 'BUDGET_EXCEEDED' }),
    );
    expect(() =>
      assertDynamicQuestBudget({
        policyVersion: 1,
        openQuestLimit: 12,
        currentOpenQuests: 3,
        remainingSlots: 12,
      }),
    ).toThrow(expect.objectContaining({ code: 'BUDGET_EXCEEDED' }));
  });
});

function source(kind: DynamicQuestSourceContext['kind']): DynamicQuestSourceContext {
  const entityKinds = {
    NPC: 'NPC',
    FACTION: 'FACTION',
    WORLD_EVENT: 'GAME_EVENT',
    DISCOVERY: 'WORLD_FACT',
    PLAYER_ACTION: 'PLAYER_ACTION',
    CONSEQUENCE: 'QUEST_GRAPH',
  } as const;
  return {
    kind,
    occurrenceId: 'occurrence',
    entityKind: entityKinds[kind],
    entityId: 'entity',
    summary: 'A durable source occurrence.',
    actorNpcId: kind === 'NPC' ? npcId('npc-source') : null,
    visibility: 'PLAYER_VISIBLE',
    playerIntervened: kind === 'PLAYER_ACTION',
  };
}
