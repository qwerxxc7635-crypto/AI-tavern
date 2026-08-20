export const FIELD_ASSIST_OPERATIONS = [
  'GENERATE',
  'IMPROVE',
  'OPTIONS',
  'EXPAND',
  'SHORTEN',
] as const;

export type FieldAssistOperation = (typeof FIELD_ASSIST_OPERATIONS)[number];
export type FieldAssistPhase = 'IDLE' | 'GENERATING' | 'CANDIDATE' | 'APPLIED' | 'ERROR' | 'LOCKED';

export interface FieldAssistState {
  readonly phase: FieldAssistPhase;
  readonly value: string;
  readonly candidates: readonly string[];
  readonly selectedCandidate: number | null;
  readonly previousValue: string | null;
  readonly activeRequestId: string | null;
  readonly lastOperation: FieldAssistOperation | null;
  readonly errorCode: string | null;
  readonly locked: boolean;
  readonly hardLocked: boolean;
}

export type FieldAssistEvent =
  | { readonly type: 'SYNC'; readonly value: string }
  | { readonly type: 'EDIT'; readonly value: string }
  | { readonly type: 'START'; readonly operation: FieldAssistOperation; readonly requestId: string }
  | { readonly type: 'RESOLVE'; readonly requestId: string; readonly candidates: readonly string[] }
  | { readonly type: 'FAIL'; readonly requestId: string; readonly code: string }
  | { readonly type: 'CANCEL'; readonly requestId: string }
  | { readonly type: 'SELECT'; readonly index: number }
  | { readonly type: 'APPLY' }
  | { readonly type: 'UNDO' }
  | { readonly type: 'LOCK'; readonly hard: boolean }
  | { readonly type: 'UNLOCK' };

export function initialFieldAssistState(value: string, hardLocked = false): FieldAssistState {
  const normalized = validateDraft(value);
  return Object.freeze({
    phase: hardLocked ? 'LOCKED' : 'IDLE',
    value: normalized,
    candidates: Object.freeze([]),
    selectedCandidate: null,
    previousValue: null,
    activeRequestId: null,
    lastOperation: null,
    errorCode: null,
    locked: hardLocked,
    hardLocked,
  });
}

export function reduceFieldAssist(
  state: FieldAssistState,
  event: FieldAssistEvent,
): FieldAssistState {
  switch (event.type) {
    case 'SYNC':
      if (event.value === state.value) return state;
      return next(state, {
        phase: state.locked ? 'LOCKED' : 'IDLE',
        value: validateDraft(event.value),
        candidates: [],
        selectedCandidate: null,
        previousValue: null,
        activeRequestId: null,
        errorCode: null,
      });
    case 'EDIT':
      assertEditable(state);
      if (state.activeRequestId !== null) throw new FieldAssistStateError('FIELD_BUSY');
      return next(state, {
        phase: 'IDLE',
        value: validateDraft(event.value),
        candidates: [],
        selectedCandidate: null,
        previousValue: null,
        errorCode: null,
      });
    case 'START':
      assertEditable(state);
      if (state.activeRequestId !== null) throw new FieldAssistStateError('FIELD_BUSY');
      if (!FIELD_ASSIST_OPERATIONS.includes(event.operation)) {
        throw new FieldAssistStateError('OPERATION_INVALID');
      }
      return next(state, {
        phase: 'GENERATING',
        activeRequestId: requestId(event.requestId),
        lastOperation: event.operation,
        candidates: [],
        selectedCandidate: null,
        errorCode: null,
      });
    case 'RESOLVE':
      if (event.requestId !== state.activeRequestId) return state;
      return next(state, {
        phase: 'CANDIDATE',
        candidates: validateCandidates(event.candidates, state.lastOperation),
        selectedCandidate: 0,
        activeRequestId: null,
        errorCode: null,
      });
    case 'FAIL':
      if (event.requestId !== state.activeRequestId) return state;
      return next(state, {
        phase: 'ERROR',
        activeRequestId: null,
        errorCode: errorCode(event.code),
      });
    case 'CANCEL':
      if (event.requestId !== state.activeRequestId) return state;
      return next(state, {
        phase: 'IDLE',
        activeRequestId: null,
        candidates: [],
        selectedCandidate: null,
        errorCode: null,
      });
    case 'SELECT':
      if (state.phase !== 'CANDIDATE' || state.candidates[event.index] === undefined) {
        throw new FieldAssistStateError('CANDIDATE_SELECTION_INVALID');
      }
      return next(state, { selectedCandidate: event.index });
    case 'APPLY': {
      assertEditable(state);
      const candidate =
        state.selectedCandidate === null ? undefined : state.candidates[state.selectedCandidate];
      if (state.phase !== 'CANDIDATE' || candidate === undefined) {
        throw new FieldAssistStateError('CANDIDATE_MISSING');
      }
      return next(state, {
        phase: 'APPLIED',
        value: candidate,
        previousValue: state.value,
        candidates: [],
        selectedCandidate: null,
      });
    }
    case 'UNDO':
      assertEditable(state);
      if (state.phase !== 'APPLIED' || state.previousValue === null) {
        throw new FieldAssistStateError('UNDO_UNAVAILABLE');
      }
      return next(state, { phase: 'IDLE', value: state.previousValue, previousValue: null });
    case 'LOCK':
      if (state.activeRequestId !== null) throw new FieldAssistStateError('FIELD_BUSY');
      return next(state, {
        phase: 'LOCKED',
        locked: true,
        hardLocked: state.hardLocked || event.hard,
        candidates: [],
        selectedCandidate: null,
        previousValue: null,
      });
    case 'UNLOCK':
      if (state.hardLocked) throw new FieldAssistStateError('HARD_FACT_LOCKED');
      return next(state, { phase: 'IDLE', locked: false });
  }
}

export class FieldAssistStateError extends Error {
  public constructor(public readonly code: string) {
    super(`Field assist transition rejected: ${code}`);
    this.name = 'FieldAssistStateError';
  }
}

function assertEditable(state: FieldAssistState) {
  if (state.locked || state.hardLocked) throw new FieldAssistStateError('FIELD_LOCKED');
}

function validateDraft(value: string): string {
  if (typeof value !== 'string' || value.length > 8_000 || containsForbiddenControl(value)) {
    throw new FieldAssistStateError('FIELD_VALUE_INVALID');
  }
  return value;
}

function validateCandidates(
  candidates: readonly string[],
  operation: FieldAssistOperation | null,
): readonly string[] {
  const minimum = operation === 'OPTIONS' ? 2 : 1;
  if (candidates.length < minimum || candidates.length > 5) {
    throw new FieldAssistStateError('CANDIDATE_COUNT_INVALID');
  }
  const normalized = candidates.map((candidate) => validateCandidate(candidate));
  if (new Set(normalized).size !== normalized.length) {
    throw new FieldAssistStateError('CANDIDATE_DUPLICATE');
  }
  return Object.freeze(normalized);
}

function validateCandidate(value: string): string {
  const trimmed = validateDraft(value).trim();
  if (trimmed.length === 0) throw new FieldAssistStateError('CANDIDATE_EMPTY');
  return trimmed;
}

function containsForbiddenControl(value: string) {
  return Array.from(value).some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point === 0 || (point < 32 && point !== 9 && point !== 10 && point !== 13);
  });
}

function requestId(value: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(value)) {
    throw new FieldAssistStateError('REQUEST_ID_INVALID');
  }
  return value;
}

function errorCode(value: string) {
  if (!/^[A-Z0-9_]{2,64}$/.test(value)) throw new FieldAssistStateError('ERROR_CODE_INVALID');
  return value;
}

function next(state: FieldAssistState, patch: Partial<FieldAssistState>): FieldAssistState {
  return Object.freeze({ ...state, ...patch });
}
