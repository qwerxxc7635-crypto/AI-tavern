import { describe, expect, it } from 'vitest';

import {
  AdventureTransitionError,
  actionOptionId,
  adventureId,
  checkRequestId,
  clueId,
  isoTimestamp,
  transitionAdventureState,
  turnId,
  type AdventurePlan,
  type AdventureState,
  type AdventureTurn,
  type DiceResult,
} from './index.js';

describe('adventure state machine', () => {
  it('accepts the full path with a required check', () => {
    const path: AdventureState[] = [
      'SCENE',
      'WAITING_FOR_PLAYER',
      'CHECK_REQUIRED',
      'RESOLVING',
      'SCENE',
      'ENDING',
      'SETTLED',
    ];
    expect(path.reduce(transitionAdventureState, 'PREPARING')).toBe('SETTLED');
  });

  it('accepts a turn that does not require a check', () => {
    expect(transitionAdventureState('WAITING_FOR_PLAYER', 'RESOLVING')).toBe('RESOLVING');
  });

  it('allows a scene or resolution to enter an ending', () => {
    expect(transitionAdventureState('SCENE', 'ENDING')).toBe('ENDING');
    expect(transitionAdventureState('RESOLVING', 'ENDING')).toBe('ENDING');
  });

  it.each([
    ['PREPARING', 'WAITING_FOR_PLAYER'],
    ['WAITING_FOR_PLAYER', 'SCENE'],
    ['CHECK_REQUIRED', 'SCENE'],
    ['SETTLED', 'SCENE'],
  ] as const)('rejects illegal transition %s -> %s', (current, next) => {
    expect(() => transitionAdventureState(current, next)).toThrow(AdventureTransitionError);
  });
});

describe('adventure protocol', () => {
  it('expresses a hidden 8-12 turn plan with core clues and multiple endings', () => {
    const plan: AdventurePlan = {
      adventureId: adventureId('adventure-1'),
      objective: 'Restore the western beacon.',
      risk: 'HIGH',
      expectedTurns: { min: 8, max: 12 },
      coreScenes: ['Approach', 'Wreckage', 'Engine chamber'],
      necessaryClueIds: [clueId('clue-1'), clueId('clue-2'), clueId('clue-3')],
      majorObstacles: ['Storm front', 'Saboteur'],
      possibleEndings: ['Beacon restored', 'Beacon abandoned'],
      failureCost: 'The trade clock advances.',
    };
    expect(plan.necessaryClueIds).toHaveLength(3);
    expect(plan.possibleEndings.length).toBeGreaterThanOrEqual(2);
  });

  it('records action, check and locally supplied dice result in one turn', () => {
    const checkId = checkRequestId('check-1');
    const result: DiceResult = {
      checkRequestId: checkId,
      d20: 12,
      attributeModifier: 3,
      equipmentModifier: 1,
      statusModifier: 0,
      total: 16,
      difficulty: 14,
      success: true,
    };
    const turn: AdventureTurn = {
      id: turnId('turn-1'),
      adventureId: adventureId('adventure-1'),
      turnNumber: 1,
      sceneText: 'The beacon door is jammed by warped brass.',
      speakerNpcIds: [],
      suggestedActions: [
        {
          kind: 'SUGGESTED',
          optionId: actionOptionId('option-inspect'),
          text: 'Inspect the hinges',
        },
      ],
      playerAction: { kind: 'FREEFORM', text: 'Use the compass to find a safe seam.' },
      checkRequest: {
        id: checkId,
        turnId: turnId('turn-1'),
        attribute: 'knowledge',
        difficulty: 14,
        reason: 'Understand the damaged mechanism',
      },
      diceResult: result,
      createdAt: isoTimestamp('2026-07-30T10:00:00.000Z'),
      resolvedAt: isoTimestamp('2026-07-30T10:01:00.000Z'),
    };
    expect(turn.diceResult).toBe(result);
    expect(turn.checkRequest?.difficulty).toBe(14);
  });
});
