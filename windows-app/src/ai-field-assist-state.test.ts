import { describe, expect, it } from 'vitest';

import {
  FieldAssistStateError,
  initialFieldAssistState,
  reduceFieldAssist,
  type FieldAssistEvent,
} from './ai-field-assist-state.js';

function transition(...events: readonly FieldAssistEvent[]) {
  return events.reduce(reduceFieldAssist, initialFieldAssistState('旧设定'));
}

function rejects(event: FieldAssistEvent, code: string, state = initialFieldAssistState('原文')) {
  try {
    reduceFieldAssist(state, event);
    throw new Error('Expected transition to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(FieldAssistStateError);
    expect((error as FieldAssistStateError).code).toBe(code);
  }
}

describe('AI field assist state machine', () => {
  it('keeps candidates provisional until explicit apply and supports undo', () => {
    const candidate = transition(
      { type: 'START', operation: 'OPTIONS', requestId: 'request-1' },
      { type: 'RESOLVE', requestId: 'request-1', candidates: ['新设定一', '新设定二'] },
      { type: 'SELECT', index: 1 },
    );
    expect(candidate).toMatchObject({ phase: 'CANDIDATE', value: '旧设定' });

    const applied = reduceFieldAssist(candidate, { type: 'APPLY' });
    expect(applied).toMatchObject({ phase: 'APPLIED', value: '新设定二', previousValue: '旧设定' });
    expect(reduceFieldAssist(applied, { type: 'UNDO' })).toMatchObject({
      phase: 'IDLE',
      value: '旧设定',
      previousValue: null,
    });
  });

  it('cancels active work and ignores late or stale responses', () => {
    const generating = transition({ type: 'START', operation: 'GENERATE', requestId: 'current' });
    const stale = reduceFieldAssist(generating, {
      type: 'RESOLVE',
      requestId: 'stale',
      candidates: ['不得采用'],
    });
    expect(stale).toBe(generating);
    const cancelled = reduceFieldAssist(stale, { type: 'CANCEL', requestId: 'current' });
    expect(cancelled).toMatchObject({ phase: 'IDLE', activeRequestId: null, value: '旧设定' });
    expect(
      reduceFieldAssist(cancelled, {
        type: 'RESOLVE',
        requestId: 'current',
        candidates: ['迟到结果'],
      }),
    ).toBe(cancelled);
  });

  it('rejects concurrent generation and edits while a request is active', () => {
    const busy = transition({ type: 'START', operation: 'IMPROVE', requestId: 'busy' });
    rejects({ type: 'START', operation: 'EXPAND', requestId: 'second' }, 'FIELD_BUSY', busy);
    rejects({ type: 'EDIT', value: '竞态编辑' }, 'FIELD_BUSY', busy);
  });

  it('supports retry after safe errors with a new request identity', () => {
    const failed = transition(
      { type: 'START', operation: 'SHORTEN', requestId: 'first' },
      { type: 'FAIL', requestId: 'first', code: 'GENERATION_TIMEOUT' },
    );
    expect(failed).toMatchObject({ phase: 'ERROR', lastOperation: 'SHORTEN' });
    if (failed.lastOperation === null) throw new Error('Expected retryable operation');
    const retried = reduceFieldAssist(failed, {
      type: 'START',
      operation: failed.lastOperation,
      requestId: 'retry',
    });
    expect(retried).toMatchObject({ phase: 'GENERATING', activeRequestId: 'retry' });
  });

  it('enforces soft and irreversible hard locks', () => {
    const soft = transition({ type: 'LOCK', hard: false });
    rejects({ type: 'START', operation: 'GENERATE', requestId: 'locked' }, 'FIELD_LOCKED', soft);
    expect(reduceFieldAssist(soft, { type: 'UNLOCK' }).phase).toBe('IDLE');

    const hard = initialFieldAssistState('已开局事实', true);
    rejects({ type: 'EDIT', value: '篡改事实' }, 'FIELD_LOCKED', hard);
    rejects({ type: 'UNLOCK' }, 'HARD_FACT_LOCKED', hard);
  });

  it.each([
    [[''], 'CANDIDATE_EMPTY'],
    [['相同', '相同'], 'CANDIDATE_DUPLICATE'],
    [[], 'CANDIDATE_COUNT_INVALID'],
    [['一', '二', '三', '四', '五', '六'], 'CANDIDATE_COUNT_INVALID'],
    [['含\u0000控制符'], 'FIELD_VALUE_INVALID'],
    [['字'.repeat(8_001)], 'FIELD_VALUE_INVALID'],
  ] as const)('rejects invalid candidate output %#', (candidates, code) => {
    const generating = transition({ type: 'START', operation: 'GENERATE', requestId: 'validate' });
    rejects({ type: 'RESOLVE', requestId: 'validate', candidates }, code, generating);
  });

  it('requires multiple distinct candidates for the options operation', () => {
    const generating = transition({ type: 'START', operation: 'OPTIONS', requestId: 'options' });
    rejects(
      { type: 'RESOLVE', requestId: 'options', candidates: ['只有一个'] },
      'CANDIDATE_COUNT_INVALID',
      generating,
    );
  });
});
