export type ApiBindingPhase =
  'editing' | 'testing' | 'choosing_model' | 'saving' | 'saved' | 'failed';

export type ApiBindingFailureKind = 'timeout' | 'test_failed' | 'save_failed';

export interface ApiBindingState {
  readonly phase: ApiBindingPhase;
  readonly revision: number;
  readonly testedRevision: number | null;
  readonly activeOperationId: number | null;
  readonly failure: ApiBindingFailureKind | null;
}

export type ApiBindingEvent =
  | { readonly type: 'CONFIG_CHANGED' }
  | { readonly type: 'MODEL_CHOSEN' }
  | { readonly type: 'TEST_STARTED'; readonly operationId: number }
  | { readonly type: 'TEST_SUCCEEDED'; readonly operationId: number; readonly revision: number }
  | {
      readonly type: 'TEST_FAILED';
      readonly operationId: number;
      readonly revision: number;
      readonly failure: 'timeout' | 'test_failed';
    }
  | { readonly type: 'CANCELLED'; readonly operationId: number }
  | { readonly type: 'SAVE_STARTED'; readonly operationId: number }
  | { readonly type: 'SAVE_SUCCEEDED'; readonly operationId: number; readonly revision: number }
  | { readonly type: 'SAVE_FAILED'; readonly operationId: number; readonly revision: number };

export const INITIAL_API_BINDING_STATE: ApiBindingState = Object.freeze({
  phase: 'editing',
  revision: 0,
  testedRevision: null,
  activeOperationId: null,
  failure: null,
});

export function reduceApiBindingState(
  state: ApiBindingState,
  event: ApiBindingEvent,
): ApiBindingState {
  switch (event.type) {
    case 'CONFIG_CHANGED':
      return {
        phase: 'editing',
        revision: state.revision + 1,
        testedRevision: null,
        activeOperationId: null,
        failure: null,
      };
    case 'MODEL_CHOSEN':
      return state.testedRevision === state.revision
        ? { ...state, phase: 'choosing_model', activeOperationId: null, failure: null }
        : state;
    case 'TEST_STARTED':
      return {
        ...state,
        phase: 'testing',
        testedRevision: null,
        activeOperationId: event.operationId,
        failure: null,
      };
    case 'TEST_SUCCEEDED':
      if (!matchesActiveOperation(state, event.operationId, event.revision)) return state;
      return {
        ...state,
        phase: 'choosing_model',
        testedRevision: event.revision,
        activeOperationId: null,
        failure: null,
      };
    case 'TEST_FAILED':
      if (!matchesActiveOperation(state, event.operationId, event.revision)) return state;
      return {
        ...state,
        phase: 'failed',
        testedRevision: null,
        activeOperationId: null,
        failure: event.failure,
      };
    case 'CANCELLED':
      if (state.phase !== 'testing' || state.activeOperationId !== event.operationId) return state;
      return {
        phase: 'editing',
        revision: state.revision + 1,
        testedRevision: null,
        activeOperationId: null,
        failure: null,
      };
    case 'SAVE_STARTED':
      if (state.testedRevision !== state.revision) return state;
      return {
        ...state,
        phase: 'saving',
        activeOperationId: event.operationId,
        failure: null,
      };
    case 'SAVE_SUCCEEDED':
      if (!matchesActiveOperation(state, event.operationId, event.revision)) return state;
      return { ...state, phase: 'saved', activeOperationId: null, failure: null };
    case 'SAVE_FAILED':
      if (!matchesActiveOperation(state, event.operationId, event.revision)) return state;
      return { ...state, phase: 'failed', activeOperationId: null, failure: 'save_failed' };
  }
}

function matchesActiveOperation(
  state: ApiBindingState,
  operationId: number,
  revision: number,
): boolean {
  return state.activeOperationId === operationId && state.revision === revision;
}

export class ApiBindingTimeoutError extends Error {
  constructor() {
    super('API binding operation timed out');
    this.name = 'ApiBindingTimeoutError';
  }
}

export function withApiBindingTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new TypeError('API binding timeout must be a positive integer'));
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ApiBindingTimeoutError()), timeoutMs);
    void operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
