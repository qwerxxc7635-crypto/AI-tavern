import { describe, expect, it } from 'vitest';

import {
  INITIAL_ADVENTURE_TURN_STATE,
  reduceAdventureTurnState,
  type AdventureTurnEvent,
  type AdventureTurnState,
} from './adventure-turn-state-machine.js';

describe('adventure turn state machine', () => {
  it('follows every required turn phase in order', () => {
    const events: readonly AdventureTurnEvent[] = [
      { type: 'SUBMITTED', operationId: 1 },
      { type: 'GENERATION_STARTED', operationId: 1, revision: 0 },
      { type: 'VALIDATION_STARTED', operationId: 1, revision: 0 },
      { type: 'RESOLUTION_STARTED', operationId: 1, revision: 0 },
      { type: 'COMMIT_SUCCEEDED', operationId: 1, revision: 0 },
      { type: 'NARRATION_STARTED', operationId: 1, revision: 0 },
    ];
    const phases: string[] = [];
    events.reduce<AdventureTurnState>((state, event) => {
      const next = reduceAdventureTurnState(state, event);
      phases.push(next.phase);
      return next;
    }, INITIAL_ADVENTURE_TURN_STATE);
    expect(phases).toEqual([
      'submitted',
      'generating',
      'validating',
      'resolving',
      'committed',
      'narrating',
    ]);
  });

  it('records phase-specific failures and permits a new explicit retry', () => {
    const submitted = reduceAdventureTurnState(INITIAL_ADVENTURE_TURN_STATE, {
      type: 'SUBMITTED',
      operationId: 1,
    });
    const generating = reduceAdventureTurnState(submitted, {
      type: 'GENERATION_STARTED',
      operationId: 1,
      revision: 0,
    });
    const failed = reduceAdventureTurnState(generating, {
      type: 'FAILED',
      operationId: 1,
      revision: 0,
    });
    expect(failed).toMatchObject({ phase: 'failed', failure: 'generation_failed' });
    expect(reduceAdventureTurnState(failed, { type: 'SUBMITTED', operationId: 2 })).toMatchObject({
      phase: 'submitted',
      activeOperationId: 2,
      failure: null,
    });
  });

  it.each([
    ['submitted', [], 'submission_failed'],
    ['generating', ['GENERATION_STARTED'], 'generation_failed'],
    ['validating', ['GENERATION_STARTED', 'VALIDATION_STARTED'], 'validation_failed'],
    [
      'resolving',
      ['GENERATION_STARTED', 'VALIDATION_STARTED', 'RESOLUTION_STARTED'],
      'resolution_failed',
    ],
  ] as const)('maps a %s failure to an explicit recovery reason', (_phase, steps, failure) => {
    let state = reduceAdventureTurnState(INITIAL_ADVENTURE_TURN_STATE, {
      type: 'SUBMITTED',
      operationId: 7,
    });
    for (const type of steps) {
      state = reduceAdventureTurnState(state, { type, operationId: 7, revision: 0 });
    }
    expect(
      reduceAdventureTurnState(state, { type: 'FAILED', operationId: 7, revision: 0 }),
    ).toMatchObject({ phase: 'failed', failure });
  });

  it('rejects out-of-order and stale operation events', () => {
    const submitted = reduceAdventureTurnState(INITIAL_ADVENTURE_TURN_STATE, {
      type: 'SUBMITTED',
      operationId: 1,
    });
    expect(
      reduceAdventureTurnState(submitted, {
        type: 'VALIDATION_STARTED',
        operationId: 1,
        revision: 0,
      }),
    ).toBe(submitted);
    const edited = reduceAdventureTurnState(submitted, { type: 'DRAFT_CHANGED' });
    expect(
      reduceAdventureTurnState(edited, {
        type: 'GENERATION_STARTED',
        operationId: 1,
        revision: 0,
      }),
    ).toBe(edited);
  });

  it('restores only durable recovery checkpoints', () => {
    expect(
      reduceAdventureTurnState(INITIAL_ADVENTURE_TURN_STATE, {
        type: 'RESTORED',
        phase: 'submitted',
      }),
    ).toMatchObject({ phase: 'submitted', activeOperationId: null });
    expect(
      reduceAdventureTurnState(INITIAL_ADVENTURE_TURN_STATE, {
        type: 'RESTORED',
        phase: 'narrating',
      }),
    ).toMatchObject({ phase: 'narrating', failure: null });
  });
});
