export type CharacterAIPhase =
  'idle' | 'generating' | 'validating' | 'preview' | 'editing' | 'confirming' | 'committed';

export type CharacterAIFailure = 'generation_failed' | 'validation_failed' | 'confirm_failed';

export interface CharacterAIState {
  readonly phase: CharacterAIPhase;
  readonly revision: number;
  readonly activeOperationId: number | null;
  readonly failure: CharacterAIFailure | null;
}

export type CharacterAIEvent =
  | { readonly type: 'RESTORED'; readonly phase: 'idle' | 'preview' | 'committed' }
  | { readonly type: 'DRAFT_CHANGED' }
  | { readonly type: 'PREVIEW_EDITED' }
  | { readonly type: 'GENERATION_STARTED'; readonly operationId: number }
  | { readonly type: 'VALIDATION_STARTED'; readonly operationId: number; readonly revision: number }
  | { readonly type: 'PREVIEW_READY'; readonly operationId: number; readonly revision: number }
  | {
      readonly type: 'GENERATION_FAILED';
      readonly operationId: number;
      readonly revision: number;
      readonly failure: 'generation_failed' | 'validation_failed';
    }
  | { readonly type: 'CONFIRM_STARTED'; readonly operationId: number }
  | { readonly type: 'CONFIRM_SUCCEEDED'; readonly operationId: number; readonly revision: number }
  | { readonly type: 'CONFIRM_FAILED'; readonly operationId: number; readonly revision: number };

export const INITIAL_CHARACTER_AI_STATE: CharacterAIState = Object.freeze({
  phase: 'idle',
  revision: 0,
  activeOperationId: null,
  failure: null,
});

export function reduceCharacterAIState(
  state: CharacterAIState,
  event: CharacterAIEvent,
): CharacterAIState {
  switch (event.type) {
    case 'RESTORED':
      return { ...state, phase: event.phase, activeOperationId: null, failure: null };
    case 'DRAFT_CHANGED':
    case 'PREVIEW_EDITED':
      return {
        phase: 'editing',
        revision: state.revision + 1,
        activeOperationId: null,
        failure: null,
      };
    case 'GENERATION_STARTED':
      if (!['idle', 'editing', 'preview'].includes(state.phase)) return state;
      return { ...state, phase: 'generating', activeOperationId: event.operationId, failure: null };
    case 'VALIDATION_STARTED':
      if (!matches(state, event.operationId, event.revision) || state.phase !== 'generating') {
        return state;
      }
      return { ...state, phase: 'validating' };
    case 'PREVIEW_READY':
      if (!matches(state, event.operationId, event.revision) || state.phase !== 'validating') {
        return state;
      }
      return { ...state, phase: 'preview', activeOperationId: null, failure: null };
    case 'GENERATION_FAILED':
      if (!matches(state, event.operationId, event.revision)) return state;
      return { ...state, phase: 'editing', activeOperationId: null, failure: event.failure };
    case 'CONFIRM_STARTED':
      if (!['preview', 'editing'].includes(state.phase)) return state;
      return { ...state, phase: 'confirming', activeOperationId: event.operationId, failure: null };
    case 'CONFIRM_SUCCEEDED':
      if (!matches(state, event.operationId, event.revision) || state.phase !== 'confirming') {
        return state;
      }
      return { ...state, phase: 'committed', activeOperationId: null, failure: null };
    case 'CONFIRM_FAILED':
      if (!matches(state, event.operationId, event.revision) || state.phase !== 'confirming') {
        return state;
      }
      return { ...state, phase: 'editing', activeOperationId: null, failure: 'confirm_failed' };
  }
}

function matches(state: CharacterAIState, operationId: number, revision: number): boolean {
  return state.activeOperationId === operationId && state.revision === revision;
}
