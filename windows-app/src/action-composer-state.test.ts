import { describe, expect, it } from 'vitest';

import {
  ActionComposerStateError,
  initialActionComposerState,
  reduceActionComposer,
  validateComposerSuggestions,
  type ActionComposerEvent,
  type ActionComposerState,
} from './action-composer-state.js';

function apply(state: ActionComposerState, ...events: readonly ActionComposerEvent[]) {
  return events.reduce(reduceActionComposer, state);
}

function rejects(state: ActionComposerState, event: ActionComposerEvent, code: string) {
  try {
    reduceActionComposer(state, event);
    throw new Error('Expected transition to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ActionComposerStateError);
    expect((error as ActionComposerStateError).code).toBe(code);
  }
}

describe('Action Composer state machine', () => {
  it('normalizes free input and suggestions into the same submission contract', () => {
    const free = apply(
      initialActionComposerState(),
      { type: 'EDIT', value: '  检查门锁  ' },
      {
        type: 'SUBMIT',
        submissionId: 'free-1',
      },
    );
    const suggested = apply(
      initialActionComposerState(),
      { type: 'SELECT', suggestion: { id: 'inspect', text: '检查门锁' } },
      { type: 'SUBMIT', submissionId: 'suggested-1' },
    );
    expect(free.activeSubmission).toMatchObject({ text: '检查门锁', origin: 'FREEFORM' });
    expect(suggested.activeSubmission).toMatchObject({
      text: '检查门锁',
      origin: 'SUGGESTION',
      suggestionId: 'inspect',
    });
  });

  it('enforces 3-5 unique generated suggestions while allowing empty and legacy recovery', () => {
    const candidates = [
      { id: 'one', text: '观察门锁' },
      { id: 'two', text: '询问老板' },
      { id: 'three', text: '检查窗户' },
    ];
    expect(validateComposerSuggestions(candidates)).toHaveLength(3);
    expect(validateComposerSuggestions([])).toHaveLength(0);
    expect(validateComposerSuggestions(candidates.slice(0, 2), true)).toHaveLength(2);
    expect(() => validateComposerSuggestions(candidates.slice(0, 2))).toThrowError(
      expect.objectContaining({ code: 'SUGGESTION_COUNT_INVALID' }),
    );
    expect(() =>
      validateComposerSuggestions([...candidates, { id: 'four', text: '观察门锁' }]),
    ).toThrowError(expect.objectContaining({ code: 'SUGGESTION_TEXT_DUPLICATE' }));
  });

  it('blocks duplicate submit and ignores stale stream or completion events', () => {
    const submitting = apply(initialActionComposerState('前进'), {
      type: 'SUBMIT',
      submissionId: 'active',
    });
    rejects(submitting, { type: 'SUBMIT', submissionId: 'duplicate' }, 'SUBMISSION_BUSY');
    expect(
      reduceActionComposer(submitting, { type: 'STREAM_STARTED', submissionId: 'stale' }),
    ).toBe(submitting);
    expect(reduceActionComposer(submitting, { type: 'COMMIT', submissionId: 'stale' })).toBe(
      submitting,
    );
  });

  it('streams bounded content, cancels without losing draft, and ignores late chunks', () => {
    const streaming = apply(
      initialActionComposerState('开门'),
      { type: 'SUBMIT', submissionId: 'stream-1' },
      { type: 'STREAM_STARTED', submissionId: 'stream-1' },
      { type: 'STREAM_CHUNK', submissionId: 'stream-1', chunk: '门轴' },
    );
    expect(streaming).toMatchObject({ phase: 'STREAMING', draft: '开门', streamedText: '门轴' });
    const cancelled = reduceActionComposer(streaming, {
      type: 'CANCEL',
      submissionId: 'stream-1',
    });
    expect(cancelled).toMatchObject({ phase: 'EDITING', draft: '开门', streamedText: '' });
    expect(
      reduceActionComposer(cancelled, {
        type: 'STREAM_CHUNK',
        submissionId: 'stream-1',
        chunk: '迟到',
      }),
    ).toBe(cancelled);
  });

  it('retains the exact failed submission for deterministic retry', () => {
    const failed = apply(
      initialActionComposerState(),
      { type: 'SELECT', suggestion: { id: 'ask', text: '询问密道' } },
      { type: 'SUBMIT', submissionId: 'first' },
      { type: 'FAIL', submissionId: 'first', code: 'GENERATION_FAILED' },
    );
    expect(failed).toMatchObject({ phase: 'ERROR', draft: '询问密道' });
    const retried = reduceActionComposer(failed, { type: 'RETRY', submissionId: 'retry' });
    expect(retried.activeSubmission).toEqual({
      id: 'retry',
      text: '询问密道',
      origin: 'SUGGESTION',
      suggestionId: 'ask',
    });
  });

  it('restores drafts and pending submissions without resubmitting them', () => {
    const restoredDraft = reduceActionComposer(initialActionComposerState(), {
      type: 'RESTORE_DRAFT',
      value: '继续调查窗边痕迹',
    });
    expect(restoredDraft).toMatchObject({ phase: 'EDITING', draft: '继续调查窗边痕迹' });
    const recovering = reduceActionComposer(restoredDraft, {
      type: 'RESTORE_PENDING',
      submission: {
        id: 'persisted-1',
        text: '继续调查窗边痕迹',
        origin: 'FREEFORM',
        suggestionId: null,
      },
    });
    expect(recovering).toMatchObject({
      phase: 'RECOVERING',
      activeSubmission: { id: 'persisted-1' },
    });
    const committed = reduceActionComposer(recovering, {
      type: 'RECOVERY_COMMITTED',
      submissionId: 'persisted-1',
    });
    expect(committed).toMatchObject({ phase: 'EDITING', draft: '', activeSubmission: null });
  });

  it('rejects empty, oversized, control-character and invalid-origin actions', () => {
    rejects(
      initialActionComposerState(),
      { type: 'SUBMIT', submissionId: 'empty' },
      'ACTION_EMPTY',
    );
    rejects(
      initialActionComposerState(),
      { type: 'EDIT', value: 'x'.repeat(4_001) },
      'ACTION_INVALID',
    );
    rejects(initialActionComposerState(), { type: 'EDIT', value: 'bad\u0000' }, 'ACTION_INVALID');
    rejects(
      initialActionComposerState(),
      {
        type: 'RESTORE_PENDING',
        submission: {
          id: 'bad-origin',
          text: '前进',
          origin: 'FREEFORM',
          suggestionId: 'not-freeform',
        },
      },
      'SUBMISSION_ORIGIN_INVALID',
    );
    rejects(
      initialActionComposerState(),
      {
        type: 'RESTORE_PENDING',
        submission: {
          id: 'unknown-origin',
          text: '前进',
          origin: 'UNKNOWN' as 'FREEFORM',
          suggestionId: null,
        },
      },
      'SUBMISSION_ORIGIN_INVALID',
    );
  });
});
