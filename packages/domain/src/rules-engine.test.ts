import {
  campaignId,
  checkRequestId,
  characterTraitId,
  isoTimestamp,
  itemId,
  npcId,
  playerCharacterId,
  questId,
  type CharacterRuleState,
  type Quest,
  type Item,
  type RulesCommand,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import {
  RulesEngineError,
  applyRulesCommand,
  checkModifierBreakdown,
  createCharacterRuleState,
  effectiveSkillValue,
  resolveCharacterD20Check,
  validateItemNumericEffect,
  validateCharacterRuleState,
} from './rules-engine.js';

const campaign = campaignId('campaign-rules');
const character = playerCharacterId('character-rules');
const ownedItem = itemId('item-owned');
const trait = characterTraitId('trait-steady');
const now = isoTimestamp('2026-08-14T00:00:00.000Z');
const later = isoTimestamp('2026-08-14T00:01:00.000Z');

describe('Rules Engine expansion', () => {
  it('creates a frozen, versioned state without mutating base attributes', () => {
    const state = initialState();
    expect(state).toMatchObject({
      schemaVersion: 1,
      campaignId: campaign,
      playerCharacterId: character,
      hitPoints: { current: 10, max: 10 },
      money: 0,
      gameTimeMinutes: 0,
      revision: 1,
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.baseAttributes)).toBe(true);
    expect(() =>
      validateCharacterRuleState({
        ...state,
        baseAttributes: { ...state.baseAttributes, physique: 5 },
      }),
    ).toThrow(RulesEngineError);
  });

  it('combines skill, HP, status, equipment, money, time, Trait and resource rules', () => {
    let state = initialState();
    state = run(state, system({ kind: 'DEFINE_SKILL', skill: { key: 'investigation', value: 3 } }));
    state = run(state, player({ kind: 'CHANGE_SKILL', skillKey: 'investigation', delta: 1 }));
    state = run(
      state,
      system({ kind: 'DEFINE_RESOURCE', resource: { key: 'stress', current: 2, max: 5 } }),
    );
    state = run(state, player({ kind: 'CHANGE_RESOURCE', resourceKey: 'stress', delta: 2 }));
    state = run(state, player({ kind: 'TAKE_DAMAGE', amount: 7 }));
    state = run(state, system({ kind: 'RECOVER_HP', amount: 2 }));
    state = run(
      state,
      system({
        kind: 'ADD_STATUS',
        status: {
          id: 'status-alert',
          kind: 'BUFF',
          label: 'Alert',
          attributeModifiers: { knowledge: 1 },
          expiresAtGameMinute: 30,
        },
      }),
    );
    state = run(
      state,
      system({
        kind: 'SET_TRAIT_MODIFIER',
        traitId: trait,
        target: { kind: 'ATTRIBUTE', key: 'knowledge' },
        modifier: 2,
      }),
    );
    state = run(
      state,
      system({
        kind: 'SET_TRAIT_MODIFIER',
        traitId: trait,
        target: { kind: 'SKILL', key: 'investigation' },
        modifier: 1,
      }),
    );
    state = run(state, player({ kind: 'CHANGE_MONEY', delta: 50 }));
    state = run(state, player({ kind: 'EQUIP_ITEM', itemId: ownedItem }));

    expect(state.skills).toEqual([{ key: 'investigation', value: 4 }]);
    expect(effectiveSkillValue(state, 'investigation')).toBe(5);
    expect(state.resources).toEqual([{ key: 'stress', current: 4, max: 5 }]);
    expect(state.hitPoints).toEqual({ current: 5, max: 10 });
    expect(state.money).toBe(50);
    expect(state.equippedItemIds).toEqual([ownedItem]);
    expect(checkModifierBreakdown(state, 'knowledge')).toEqual({
      attributeValue: 3,
      traitModifier: 2,
      statusModifier: 1,
    });

    state = run(state, system({ kind: 'ADVANCE_TIME', minutes: 30 }));
    expect(state.statuses).toEqual([]);
    state = run(state, player({ kind: 'UNEQUIP_ITEM', itemId: ownedItem }));
    state = run(state, system({ kind: 'REMOVE_TRAIT_MODIFIER', traitId: trait }));
    expect(state.equippedItemIds).toEqual([]);
    expect(state.traitModifiers).toEqual([]);
    expect(state.revision).toBe(15);
  });

  it('keeps Quest transitions inside the local reducer', () => {
    const available = quest('AVAILABLE');
    const command = player({
      kind: 'TRANSITION_QUEST',
      questId: available.id,
      status: 'ACCEPTED',
    });
    const result = applyRulesCommand(
      initialState(),
      command,
      { ownedItemIds: [], quests: [available] },
      later,
    );
    expect(result.questBefore?.status).toBe('AVAILABLE');
    expect(result.questAfter).toMatchObject({ status: 'ACCEPTED', updatedAt: later });
    expect(result.state.revision).toBe(2);

    expect(() =>
      applyRulesCommand(
        initialState(),
        player({ kind: 'TRANSITION_QUEST', questId: available.id, status: 'COMPLETED' }),
        { ownedItemIds: [], quests: [available] },
        later,
      ),
    ).toThrowError(expect.objectContaining({ code: 'ILLEGAL_QUEST_TRANSITION' }));
  });

  it('rejects AI authority and player-authored Trait/resource definitions', () => {
    const aiCommand = {
      ...player({ kind: 'CHANGE_MONEY', delta: 100 }),
      authority: 'AI',
    } as unknown as RulesCommand;
    expect(() => run(initialState(), aiCommand)).toThrowError(
      expect.objectContaining({ code: 'AUTHORITY_FORBIDDEN' }),
    );
    expect(() =>
      run(
        initialState(),
        player({
          kind: 'SET_TRAIT_MODIFIER',
          traitId: trait,
          target: { kind: 'ATTRIBUTE', key: 'agility' },
          modifier: 1,
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'AUTHORITY_FORBIDDEN' }));
    expect(() =>
      run(
        initialState(),
        player({ kind: 'DEFINE_RESOURCE', resource: { key: 'luck', current: 1, max: 3 } }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'AUTHORITY_FORBIDDEN' }));
  });

  it('rejects unknown command and nested fields at the runtime boundary', () => {
    expect(() =>
      run(initialState(), {
        ...player({ kind: 'CHANGE_MONEY', delta: 1 }),
        narrativeAmount: 999,
      } as unknown as RulesCommand),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_COMMAND' }));
    expect(() =>
      run(
        initialState(),
        system({
          kind: 'DEFINE_RESOURCE',
          resource: { key: 'luck', current: 1, max: 3, hiddenBonus: 99 } as never,
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_STATE' }));
  });

  it('rejects unknown ownership, targets, no-op commands and unsafe limits', () => {
    expect(() =>
      run(initialState(), player({ kind: 'EQUIP_ITEM', itemId: itemId('item-foreign') })),
    ).toThrowError(expect.objectContaining({ code: 'ITEM_NOT_OWNED' }));
    expect(() =>
      run(initialState(), player({ kind: 'CHANGE_SKILL', skillKey: 'unknown', delta: 1 })),
    ).toThrowError(expect.objectContaining({ code: 'UNKNOWN_TARGET' }));
    expect(() => run(initialState(), system({ kind: 'RECOVER_HP', amount: 1 }))).toThrowError(
      expect.objectContaining({ code: 'NO_STATE_CHANGE' }),
    );
    expect(() => run(initialState(), player({ kind: 'CHANGE_MONEY', delta: -1 }))).toThrowError(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    );
    expect(() =>
      run(initialState(), system({ kind: 'ADVANCE_TIME', minutes: 10_081 })),
    ).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }));
  });

  it('preserves HP bounds for a deterministic property matrix', () => {
    for (let current = 0; current <= 10; current += 1) {
      for (let amount = 1; amount <= 20; amount += 1) {
        const state = validateCharacterRuleState({
          ...initialState(),
          hitPoints: { current, max: 10 },
        });
        if (current > 0) {
          const damaged = run(state, player({ kind: 'TAKE_DAMAGE', amount }));
          expect(damaged.hitPoints.current).toBe(Math.max(0, current - amount));
        }
        if (current < 10) {
          const recovered = run(state, system({ kind: 'RECOVER_HP', amount }));
          expect(recovered.hitPoints.current).toBe(Math.min(10, current + amount));
        }
      }
    }
  });

  it('rejects a Trait modifier that would invalidate a current resource', () => {
    const state = run(
      initialState(),
      system({ kind: 'DEFINE_RESOURCE', resource: { key: 'resolve', current: 5, max: 5 } }),
    );
    expect(() =>
      run(
        state,
        system({
          kind: 'SET_TRAIT_MODIFIER',
          traitId: trait,
          target: { kind: 'RESOURCE', key: 'resolve' },
          modifier: -1,
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_STATE' }));
    expect(state.resources[0]?.current).toBe(5);
  });

  it('combines only equipped item, status and Trait modifiers with the trusted D20 source', () => {
    let state = run(initialState(), player({ kind: 'EQUIP_ITEM', itemId: ownedItem }));
    state = run(
      state,
      system({
        kind: 'ADD_STATUS',
        status: {
          id: 'status-focused',
          kind: 'BUFF',
          label: 'Focused',
          attributeModifiers: { knowledge: 1 },
          expiresAtGameMinute: null,
        },
      }),
    );
    state = run(
      state,
      system({
        kind: 'SET_TRAIT_MODIFIER',
        traitId: trait,
        target: { kind: 'ATTRIBUTE', key: 'knowledge' },
        modifier: 1,
      }),
    );
    const item: Item = {
      id: ownedItem,
      campaignId: campaign,
      content: { name: 'Lens', description: 'Clarifies clues.' },
      rewardTier: 'BASIC',
      effect: { kind: 'CHECK_MODIFIER', attribute: 'knowledge', modifier: 2 },
      createdAt: now,
    };
    expect(
      resolveCharacterD20Check(
        {
          state,
          checkRequestId: checkRequestId('check-rules'),
          attribute: 'knowledge',
          difficulty: 17,
          items: [item],
        },
        { nextD20: () => 10 },
      ),
    ).toMatchObject({
      d20: 10,
      attributeModifier: 3,
      equipmentModifier: 2,
      statusModifier: 2,
      total: 17,
      success: true,
    });
    expect(() =>
      resolveCharacterD20Check(
        {
          state,
          checkRequestId: checkRequestId('check-missing-item'),
          attribute: 'knowledge',
          difficulty: 17,
          items: [],
        },
        { nextD20: () => 10 },
      ),
    ).toThrowError(expect.objectContaining({ code: 'UNKNOWN_TARGET' }));
  });

  it('validates bounded equipment numbers without parsing narrative text', () => {
    expect(validateItemNumericEffect({ kind: 'NONE' })).toEqual({ kind: 'NONE' });
    expect(
      validateItemNumericEffect({ kind: 'CHECK_MODIFIER', attribute: 'agility', modifier: -5 }),
    ).toMatchObject({ modifier: -5 });
    expect(validateItemNumericEffect({ kind: 'REROLL', uses: 3 })).toMatchObject({ uses: 3 });
    expect(
      validateItemNumericEffect({
        kind: 'CONSUMABLE_RECOVERY',
        resource: 'STRESS',
        amount: 20,
        uses: 10,
      }),
    ).toMatchObject({ amount: 20, uses: 10 });
    expect(() =>
      validateItemNumericEffect({ kind: 'CHECK_MODIFIER', attribute: 'knowledge', modifier: 6 }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_STATE' }));
    expect(() => validateItemNumericEffect({ kind: 'REROLL', uses: 0 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATE' }),
    );
  });
});

function initialState(): CharacterRuleState {
  return createCharacterRuleState({
    campaignId: campaign,
    playerCharacterId: character,
    baseAttributes: { physique: 3, agility: 2, knowledge: 3, charisma: 2 },
    updatedAt: now,
  });
}

function run(state: CharacterRuleState, command: RulesCommand): CharacterRuleState {
  return applyRulesCommand(
    state,
    command,
    { ownedItemIds: [ownedItem], quests: [quest('AVAILABLE')] },
    later,
  ).state;
}

type CommandBody = RulesCommand extends infer Command
  ? Command extends RulesCommand
    ? Omit<Command, 'campaignId' | 'playerCharacterId' | 'authority'>
    : never
  : never;

function player(body: CommandBody): RulesCommand {
  return {
    ...body,
    campaignId: campaign,
    playerCharacterId: character,
    authority: 'PLAYER_ACTION',
  } as RulesCommand;
}

function system(body: CommandBody): RulesCommand {
  return {
    ...body,
    campaignId: campaign,
    playerCharacterId: character,
    authority: 'SYSTEM',
  } as RulesCommand;
}

function quest(status: Quest['status']): Quest {
  return {
    id: questId('quest-rules'),
    campaignId: campaign,
    publisherNpcId: npcId('npc-rules'),
    content: {
      title: 'Rules Quest',
      summary: 'A local rules test.',
      objective: 'Keep state deterministic.',
      failureCost: 'The test fails.',
    },
    status,
    risk: 'LOW',
    recommendedAttributes: ['knowledge'],
    expectedTurns: { min: 1, max: 2 },
    rewardTier: 'BASIC',
    relatedNpcIds: [],
    relatedFactIds: [],
    createdAt: now,
    updatedAt: now,
  };
}
