export type NpcTimelineErrorKind =
  'PROVIDER' | 'GENERATION' | 'VALIDATION' | 'PERSISTENCE' | 'RULE' | 'NETWORK';

const RETRYABLE_PROVIDER = new Set(['RATE_LIMITED', 'PROVIDER_UNAVAILABLE']);
const RETRYABLE_NETWORK = new Set(['TIMEOUT', 'NETWORK_FAILED']);
const RETRYABLE_VALIDATION = new Set([
  'INVALID_OUTPUT',
  'REPETITION_DETECTED',
  'SCHEMA_VALIDATION_FAILED',
]);

export interface NpcTimelineFailure {
  readonly kind: NpcTimelineErrorKind;
  readonly code: string;
  readonly retryable: boolean;
}

export function npcTimelineFailure(kind: NpcTimelineErrorKind, code: string): NpcTimelineFailure {
  if (!/^[A-Z0-9_]{2,64}$/.test(code)) {
    throw new TypeError('Timeline failure code is invalid');
  }
  const retryable =
    code === 'APP_INTERRUPTED' ||
    code === 'CANCELLED' ||
    code === 'FACT_CONFLICT' ||
    (kind === 'PROVIDER' && RETRYABLE_PROVIDER.has(code)) ||
    (kind === 'NETWORK' && RETRYABLE_NETWORK.has(code)) ||
    (kind === 'VALIDATION' && (RETRYABLE_VALIDATION.has(code) || code.startsWith('SCHEMA_')));
  const streamRetryable = kind === 'VALIDATION' && code.startsWith('STREAM_');
  return Object.freeze({ kind, code, retryable: retryable || streamRetryable });
}
