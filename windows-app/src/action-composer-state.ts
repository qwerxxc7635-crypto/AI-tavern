export type ActionComposerPhase =
  'EDITING' | 'SUBMITTING' | 'STREAMING' | 'ERROR' | 'RECOVERING' | 'DISABLED';

export type ActionOrigin = 'FREEFORM' | 'SUGGESTION';

export interface ComposerSuggestion {
  readonly id: string;
  readonly text: string;
}

export interface ActionSubmission {
  readonly id: string;
  readonly text: string;
  readonly origin: ActionOrigin;
  readonly suggestionId: string | null;
}

export interface ActionComposerState {
  readonly phase: ActionComposerPhase;
  readonly draft: string;
  readonly selectedSuggestionId: string | null;
  readonly activeSubmission: ActionSubmission | null;
  readonly lastSubmission: ActionSubmission | null;
  readonly streamedText: string;
  readonly errorCode: string | null;
  readonly revision: number;
}

export type ActionComposerEvent =
  | { readonly type: 'EDIT'; readonly value: string }
  | { readonly type: 'SELECT'; readonly suggestion: ComposerSuggestion }
  | { readonly type: 'SUBMIT'; readonly submissionId: string }
  | { readonly type: 'STREAM_STARTED'; readonly submissionId: string }
  | { readonly type: 'STREAM_CHUNK'; readonly submissionId: string; readonly chunk: string }
  | { readonly type: 'COMMIT'; readonly submissionId: string }
  | { readonly type: 'FAIL'; readonly submissionId: string; readonly code: string }
  | { readonly type: 'CANCEL'; readonly submissionId: string }
  | { readonly type: 'RETRY'; readonly submissionId: string }
  | { readonly type: 'RESTORE_DRAFT'; readonly value: string }
  | { readonly type: 'RESTORE_PENDING'; readonly submission: ActionSubmission }
  | { readonly type: 'RECOVERY_COMMITTED'; readonly submissionId: string }
  | { readonly type: 'RECOVERY_FAILED'; readonly submissionId: string; readonly code: string }
  | { readonly type: 'DISABLE' }
  | { readonly type: 'ENABLE' };

export function initialActionComposerState(draft = ''): ActionComposerState {
  return freeze({
    phase: 'EDITING',
    draft: validateDraft(draft),
    selectedSuggestionId: null,
    activeSubmission: null,
    lastSubmission: null,
    streamedText: '',
    errorCode: null,
    revision: 0,
  });
}

export function reduceActionComposer(
  state: ActionComposerState,
  event: ActionComposerEvent,
): ActionComposerState {
  switch (event.type) {
    case 'EDIT':
      assertEditable(state);
      return freeze({
        ...state,
        phase: 'EDITING',
        draft: validateDraft(event.value),
        selectedSuggestionId: null,
        errorCode: null,
        revision: state.revision + 1,
      });
    case 'SELECT':
      assertEditable(state);
      return freeze({
        ...state,
        phase: 'EDITING',
        draft: validateAction(event.suggestion.text),
        selectedSuggestionId: suggestionId(event.suggestion.id),
        errorCode: null,
        revision: state.revision + 1,
      });
    case 'SUBMIT': {
      assertEditable(state);
      if (state.activeSubmission !== null) throw new ActionComposerStateError('SUBMISSION_BUSY');
      const submission = submissionFromDraft(state, event.submissionId);
      return freeze({
        ...state,
        phase: 'SUBMITTING',
        activeSubmission: submission,
        lastSubmission: submission,
        streamedText: '',
        errorCode: null,
      });
    }
    case 'STREAM_STARTED':
      return matching(state, event.submissionId, 'SUBMITTING')
        ? freeze({ ...state, phase: 'STREAMING' })
        : state;
    case 'STREAM_CHUNK':
      if (!matching(state, event.submissionId, 'STREAMING')) return state;
      return freeze({
        ...state,
        streamedText: validateStream(`${state.streamedText}${event.chunk}`),
      });
    case 'COMMIT':
      if (!matchesActive(state, event.submissionId)) return state;
      return freeze({
        ...state,
        phase: 'EDITING',
        draft: '',
        selectedSuggestionId: null,
        activeSubmission: null,
        streamedText: '',
        errorCode: null,
        revision: state.revision + 1,
      });
    case 'FAIL':
      if (!matchesActive(state, event.submissionId)) return state;
      return freeze({
        ...state,
        phase: 'ERROR',
        activeSubmission: null,
        streamedText: '',
        errorCode: validateErrorCode(event.code),
      });
    case 'CANCEL':
      if (!matchesActive(state, event.submissionId)) return state;
      return freeze({
        ...state,
        phase: 'EDITING',
        activeSubmission: null,
        streamedText: '',
        errorCode: null,
      });
    case 'RETRY': {
      if (state.phase !== 'ERROR' || state.lastSubmission === null) {
        throw new ActionComposerStateError('RETRY_UNAVAILABLE');
      }
      const retried = freeze({ ...state.lastSubmission, id: submissionId(event.submissionId) });
      return freeze({
        ...state,
        phase: 'SUBMITTING',
        activeSubmission: retried,
        lastSubmission: retried,
        streamedText: '',
        errorCode: null,
      });
    }
    case 'RESTORE_DRAFT':
      if (state.activeSubmission !== null) throw new ActionComposerStateError('SUBMISSION_BUSY');
      return freeze({
        ...state,
        phase: 'EDITING',
        draft: validateDraft(event.value),
        selectedSuggestionId: null,
        errorCode: null,
        revision: state.revision + 1,
      });
    case 'RESTORE_PENDING': {
      if (state.activeSubmission !== null) throw new ActionComposerStateError('SUBMISSION_BUSY');
      const restored = validateSubmission(event.submission);
      return freeze({
        ...state,
        phase: 'RECOVERING',
        draft: restored.text,
        selectedSuggestionId: restored.suggestionId,
        activeSubmission: restored,
        lastSubmission: restored,
        streamedText: '',
        errorCode: null,
      });
    }
    case 'RECOVERY_COMMITTED':
      if (!matching(state, event.submissionId, 'RECOVERING')) return state;
      return freeze({
        ...state,
        phase: 'EDITING',
        draft: '',
        selectedSuggestionId: null,
        activeSubmission: null,
        errorCode: null,
        revision: state.revision + 1,
      });
    case 'RECOVERY_FAILED':
      if (!matching(state, event.submissionId, 'RECOVERING')) return state;
      return freeze({
        ...state,
        phase: 'ERROR',
        activeSubmission: null,
        errorCode: validateErrorCode(event.code),
      });
    case 'DISABLE':
      if (state.activeSubmission !== null) throw new ActionComposerStateError('SUBMISSION_BUSY');
      return freeze({ ...state, phase: 'DISABLED' });
    case 'ENABLE':
      if (state.phase !== 'DISABLED') return state;
      return freeze({ ...state, phase: 'EDITING' });
  }
}

export function validateComposerSuggestions(
  suggestions: readonly ComposerSuggestion[],
  allowLegacyRecovery = false,
): readonly ComposerSuggestion[] {
  if (suggestions.length === 0) return Object.freeze([]);
  const minimum = allowLegacyRecovery ? 1 : 3;
  if (suggestions.length < minimum || suggestions.length > 5) {
    throw new ActionComposerStateError('SUGGESTION_COUNT_INVALID');
  }
  const normalized = suggestions.map((suggestion) =>
    freeze({ id: suggestionId(suggestion.id), text: validateAction(suggestion.text) }),
  );
  if (new Set(normalized.map(({ id }) => id)).size !== normalized.length) {
    throw new ActionComposerStateError('SUGGESTION_ID_DUPLICATE');
  }
  if (
    new Set(normalized.map(({ text }) => text.toLocaleLowerCase('zh-CN'))).size !==
    normalized.length
  ) {
    throw new ActionComposerStateError('SUGGESTION_TEXT_DUPLICATE');
  }
  return Object.freeze(normalized);
}

export class ActionComposerStateError extends Error {
  public constructor(public readonly code: string) {
    super(`Action composer transition rejected: ${code}`);
    this.name = 'ActionComposerStateError';
  }
}

function submissionFromDraft(state: ActionComposerState, id: string): ActionSubmission {
  const text = validateAction(state.draft);
  return freeze({
    id: submissionId(id),
    text,
    origin: state.selectedSuggestionId === null ? 'FREEFORM' : 'SUGGESTION',
    suggestionId: state.selectedSuggestionId,
  });
}

function validateSubmission(value: ActionSubmission): ActionSubmission {
  if (value.origin !== 'FREEFORM' && value.origin !== 'SUGGESTION') {
    throw new ActionComposerStateError('SUBMISSION_ORIGIN_INVALID');
  }
  const suggestion = value.suggestionId === null ? null : suggestionId(value.suggestionId);
  if ((value.origin === 'FREEFORM') !== (suggestion === null)) {
    throw new ActionComposerStateError('SUBMISSION_ORIGIN_INVALID');
  }
  return freeze({
    id: submissionId(value.id),
    text: validateAction(value.text),
    origin: value.origin,
    suggestionId: suggestion,
  });
}

function assertEditable(state: ActionComposerState) {
  if (state.phase === 'DISABLED') throw new ActionComposerStateError('COMPOSER_DISABLED');
  if (
    state.activeSubmission !== null ||
    ['SUBMITTING', 'STREAMING', 'RECOVERING'].includes(state.phase)
  ) {
    throw new ActionComposerStateError('SUBMISSION_BUSY');
  }
}

function matching(state: ActionComposerState, id: string, phase: ActionComposerPhase) {
  return state.phase === phase && matchesActive(state, id);
}

function matchesActive(state: ActionComposerState, id: string) {
  return state.activeSubmission?.id === id;
}

function validateDraft(value: string) {
  if (typeof value !== 'string' || value.length > 4_000 || forbiddenControl(value)) {
    throw new ActionComposerStateError('ACTION_INVALID');
  }
  return value;
}

function validateAction(value: string) {
  const normalized = validateDraft(value).trim();
  if (normalized.length === 0) throw new ActionComposerStateError('ACTION_EMPTY');
  return normalized;
}

function validateStream(value: string) {
  if (value.length > 32_000 || forbiddenControl(value)) {
    throw new ActionComposerStateError('STREAM_INVALID');
  }
  return value;
}

function forbiddenControl(value: string) {
  return Array.from(value).some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point === 0 || (point < 32 && point !== 9 && point !== 10 && point !== 13);
  });
}

function suggestionId(value: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(value)) {
    throw new ActionComposerStateError('SUGGESTION_ID_INVALID');
  }
  return value;
}

function submissionId(value: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(value)) {
    throw new ActionComposerStateError('SUBMISSION_ID_INVALID');
  }
  return value;
}

function validateErrorCode(value: string) {
  if (!/^[A-Z0-9_]{2,64}$/.test(value)) throw new ActionComposerStateError('ERROR_CODE_INVALID');
  return value;
}

function freeze<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}
