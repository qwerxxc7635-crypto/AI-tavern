export type AdventureTurnPhase =
  | 'draft'
  | 'submitted'
  | 'generating'
  | 'validating'
  | 'resolving'
  | 'committed'
  | 'narrating'
  | 'failed';

export type AdventureTurnFailure =
  'submission_failed' | 'generation_failed' | 'validation_failed' | 'resolution_failed';

export interface AdventureTurnState {
  readonly phase: AdventureTurnPhase;
  readonly revision: number;
  readonly activeOperationId: number | null;
  readonly failure: AdventureTurnFailure | null;
}

export type AdventureTurnEvent =
  | { readonly type: 'RESTORED'; readonly phase: 'draft' | 'submitted' | 'resolving' | 'narrating' }
  | { readonly type: 'DRAFT_CHANGED' }
  | { readonly type: 'SUBMITTED'; readonly operationId: number }
  | { readonly type: 'GENERATION_STARTED'; readonly operationId: number; readonly revision: number }
  | { readonly type: 'VALIDATION_STARTED'; readonly operationId: number; readonly revision: number }
  | { readonly type: 'RESOLUTION_STARTED'; readonly operationId: number; readonly revision: number }
  | { readonly type: 'COMMIT_SUCCEEDED'; readonly operationId: number; readonly revision: number }
  | { readonly type: 'NARRATION_STARTED'; readonly operationId: number; readonly revision: number }
  | { readonly type: 'FAILED'; readonly operationId: number; readonly revision: number };

export const INITIAL_ADVENTURE_TURN_STATE: AdventureTurnState = Object.freeze({
  phase: 'draft',
  revision: 0,
  activeOperationId: null,
  failure: null,
});

export function reduceAdventureTurnState(
  state: AdventureTurnState,
  event: AdventureTurnEvent,
): AdventureTurnState {
  switch (event.type) {
    case 'RESTORED':
      return { ...state, phase: event.phase, activeOperationId: null, failure: null };
    case 'DRAFT_CHANGED':
      return {
        phase: 'draft',
        revision: state.revision + 1,
        activeOperationId: null,
        failure: null,
      };
    case 'SUBMITTED':
      if (!['draft', 'narrating', 'failed'].includes(state.phase)) return state;
      return {
        ...state,
        phase: 'submitted',
        activeOperationId: event.operationId,
        failure: null,
      };
    case 'GENERATION_STARTED':
      return transition(state, event, 'submitted', 'generating');
    case 'VALIDATION_STARTED':
      return transition(state, event, 'generating', 'validating');
    case 'RESOLUTION_STARTED':
      return transition(state, event, 'validating', 'resolving');
    case 'COMMIT_SUCCEEDED':
      return transition(state, event, 'resolving', 'committed');
    case 'NARRATION_STARTED':
      if (!matches(state, event.operationId, event.revision) || state.phase !== 'committed') {
        return state;
      }
      return { ...state, phase: 'narrating', activeOperationId: null, failure: null };
    case 'FAILED':
      if (!matches(state, event.operationId, event.revision)) return state;
      return {
        ...state,
        phase: 'failed',
        activeOperationId: null,
        failure: failureForPhase(state.phase),
      };
  }
}

function transition(
  state: AdventureTurnState,
  event: { readonly operationId: number; readonly revision: number },
  from: AdventureTurnPhase,
  to: AdventureTurnPhase,
): AdventureTurnState {
  if (!matches(state, event.operationId, event.revision) || state.phase !== from) return state;
  return { ...state, phase: to };
}

function matches(state: AdventureTurnState, operationId: number, revision: number): boolean {
  return state.activeOperationId === operationId && state.revision === revision;
}

function failureForPhase(phase: AdventureTurnPhase): AdventureTurnFailure {
  switch (phase) {
    case 'submitted':
      return 'submission_failed';
    case 'generating':
      return 'generation_failed';
    case 'validating':
      return 'validation_failed';
    case 'resolving':
    case 'committed':
      return 'resolution_failed';
    default:
      return 'submission_failed';
  }
}
