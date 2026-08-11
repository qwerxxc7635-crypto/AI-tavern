import { describe, expect, it, vi } from 'vitest';

import {
  ApiBindingTimeoutError,
  INITIAL_API_BINDING_STATE,
  reduceApiBindingState,
  withApiBindingTimeout,
} from './api-binding-state-machine.js';

describe('API binding state machine', () => {
  it('moves through testing, model choice, saving and saved', () => {
    const testing = reduceApiBindingState(INITIAL_API_BINDING_STATE, {
      type: 'TEST_STARTED',
      operationId: 1,
    });
    const choosing = reduceApiBindingState(testing, {
      type: 'TEST_SUCCEEDED',
      operationId: 1,
      revision: 0,
    });
    const saving = reduceApiBindingState(choosing, { type: 'SAVE_STARTED', operationId: 2 });
    const saved = reduceApiBindingState(saving, {
      type: 'SAVE_SUCCEEDED',
      operationId: 2,
      revision: 0,
    });

    expect([testing.phase, choosing.phase, saving.phase, saved.phase]).toEqual([
      'testing',
      'choosing_model',
      'saving',
      'saved',
    ]);
  });

  it('times out into failed', async () => {
    vi.useFakeTimers();
    try {
      const pending = withApiBindingTimeout(new Promise<never>(() => {}), 10);
      const rejection = expect(pending).rejects.toBeInstanceOf(ApiBindingTimeoutError);
      await vi.advanceTimersByTimeAsync(10);
      await rejection;
      const testing = reduceApiBindingState(INITIAL_API_BINDING_STATE, {
        type: 'TEST_STARTED',
        operationId: 1,
      });
      expect(
        reduceApiBindingState(testing, {
          type: 'TEST_FAILED',
          operationId: 1,
          revision: 0,
          failure: 'timeout',
        }),
      ).toMatchObject({ phase: 'failed', failure: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels testing and ignores its late result', () => {
    const testing = reduceApiBindingState(INITIAL_API_BINDING_STATE, {
      type: 'TEST_STARTED',
      operationId: 1,
    });
    const cancelled = reduceApiBindingState(testing, { type: 'CANCELLED', operationId: 1 });
    const late = reduceApiBindingState(cancelled, {
      type: 'TEST_SUCCEEDED',
      operationId: 1,
      revision: 0,
    });
    expect(cancelled.phase).toBe('editing');
    expect(late).toBe(cancelled);
  });

  it('invalidates tested evidence when config or key is replaced', () => {
    const testing = reduceApiBindingState(INITIAL_API_BINDING_STATE, {
      type: 'TEST_STARTED',
      operationId: 1,
    });
    const choosing = reduceApiBindingState(testing, {
      type: 'TEST_SUCCEEDED',
      operationId: 1,
      revision: 0,
    });
    const configChanged = reduceApiBindingState(choosing, { type: 'CONFIG_CHANGED' });
    const keyReplaced = reduceApiBindingState(configChanged, { type: 'CONFIG_CHANGED' });
    expect(configChanged).toMatchObject({ phase: 'editing', testedRevision: null, revision: 1 });
    expect(keyReplaced).toMatchObject({ phase: 'editing', testedRevision: null, revision: 2 });
    expect(reduceApiBindingState(keyReplaced, { type: 'SAVE_STARTED', operationId: 2 })).toBe(
      keyReplaced,
    );
  });

  it('keeps tested evidence after save failure so the user can retry', () => {
    const testing = reduceApiBindingState(INITIAL_API_BINDING_STATE, {
      type: 'TEST_STARTED',
      operationId: 1,
    });
    const choosing = reduceApiBindingState(testing, {
      type: 'TEST_SUCCEEDED',
      operationId: 1,
      revision: 0,
    });
    const saving = reduceApiBindingState(choosing, { type: 'SAVE_STARTED', operationId: 2 });
    const failed = reduceApiBindingState(saving, {
      type: 'SAVE_FAILED',
      operationId: 2,
      revision: 0,
    });
    expect(failed).toMatchObject({ phase: 'failed', testedRevision: 0, failure: 'save_failed' });
    expect(reduceApiBindingState(failed, { type: 'SAVE_STARTED', operationId: 3 }).phase).toBe(
      'saving',
    );
  });
});
