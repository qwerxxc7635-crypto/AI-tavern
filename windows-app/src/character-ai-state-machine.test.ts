import { describe, expect, it } from 'vitest';

import {
  INITIAL_CHARACTER_AI_STATE,
  reduceCharacterAIState,
} from './character-ai-state-machine.js';

describe('character AI state machine', () => {
  it('follows the required generation, validation, preview, edit, confirm and commit phases', () => {
    const generating = reduceCharacterAIState(INITIAL_CHARACTER_AI_STATE, {
      type: 'GENERATION_STARTED',
      operationId: 1,
    });
    const validating = reduceCharacterAIState(generating, {
      type: 'VALIDATION_STARTED',
      operationId: 1,
      revision: 0,
    });
    const preview = reduceCharacterAIState(validating, {
      type: 'PREVIEW_READY',
      operationId: 1,
      revision: 0,
    });
    const editing = reduceCharacterAIState(preview, { type: 'PREVIEW_EDITED' });
    const confirming = reduceCharacterAIState(editing, {
      type: 'CONFIRM_STARTED',
      operationId: 2,
    });
    const committed = reduceCharacterAIState(confirming, {
      type: 'CONFIRM_SUCCEEDED',
      operationId: 2,
      revision: 1,
    });
    expect([
      generating.phase,
      validating.phase,
      preview.phase,
      editing.phase,
      confirming.phase,
      committed.phase,
    ]).toEqual(['generating', 'validating', 'preview', 'editing', 'confirming', 'committed']);
  });

  it('invalidates active work after edits and rejects late results', () => {
    const generating = reduceCharacterAIState(INITIAL_CHARACTER_AI_STATE, {
      type: 'GENERATION_STARTED',
      operationId: 1,
    });
    const edited = reduceCharacterAIState(generating, { type: 'DRAFT_CHANGED' });
    expect(
      reduceCharacterAIState(edited, {
        type: 'VALIDATION_STARTED',
        operationId: 1,
        revision: 0,
      }),
    ).toBe(edited);
    expect(edited).toMatchObject({ phase: 'editing', revision: 1, activeOperationId: null });
  });

  it('returns failures to editing while retaining an explicit retry reason', () => {
    const generating = reduceCharacterAIState(INITIAL_CHARACTER_AI_STATE, {
      type: 'GENERATION_STARTED',
      operationId: 1,
    });
    expect(
      reduceCharacterAIState(generating, {
        type: 'GENERATION_FAILED',
        operationId: 1,
        revision: 0,
        failure: 'generation_failed',
      }),
    ).toMatchObject({ phase: 'editing', failure: 'generation_failed' });
  });
});
