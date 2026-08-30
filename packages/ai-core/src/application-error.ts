import { standardizeAIError, type StandardAIErrorCode } from './standard-ai-error.js';

export const APPLICATION_ERROR_KINDS = [
  'PROVIDER',
  'GENERATION',
  'VALIDATION',
  'PERSISTENCE',
  'RULE',
  'NETWORK',
] as const;

export type ApplicationErrorKind = (typeof APPLICATION_ERROR_KINDS)[number];

export const ERROR_ACTIONS = [
  'RETRY',
  'CANCEL',
  'USE_FALLBACK',
  'OPEN_SETTINGS',
  'DISMISS',
] as const;

export type ErrorAction = (typeof ERROR_ACTIONS)[number];
export type ErrorSurface = 'TOAST' | 'ERROR_STATE';

export interface ApplicationErrorContract {
  readonly kind: ApplicationErrorKind;
  readonly code: string;
  readonly retryable: boolean;
  readonly fallbackEligible: boolean;
  readonly actions: readonly ErrorAction[];
  readonly surface: ErrorSurface;
}

export class ApplicationError extends Error implements ApplicationErrorContract {
  public readonly actions: readonly ErrorAction[];

  public constructor(
    public readonly kind: ApplicationErrorKind,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly fallbackEligible: boolean,
    public readonly surface: ErrorSurface,
    options?: ErrorOptions,
  ) {
    super(`Application operation failed: ${kind}/${code}`, options);
    if (
      !/^[A-Z0-9_]{2,64}$/.test(code) ||
      (fallbackEligible && (!retryable || (kind !== 'PROVIDER' && kind !== 'NETWORK')))
    ) {
      throw new TypeError('Application error contract is invalid');
    }
    this.name = 'ApplicationError';
    this.actions = actionsFor(kind, code, retryable, fallbackEligible);
  }
}

export function classifyApplicationError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  const rawCode = readErrorCode(error);
  const code = canonicalCode(rawCode);
  const policy = policyFor(code);
  return new ApplicationError(
    policy.kind,
    code,
    policy.retryable,
    policy.fallbackEligible,
    policy.surface,
    { cause: error },
  );
}

function policyFor(code: string): Readonly<{
  kind: ApplicationErrorKind;
  retryable: boolean;
  fallbackEligible: boolean;
  surface: ErrorSurface;
}> {
  if (
    code === 'AUTHENTICATION_FAILED' ||
    code === 'QUOTA_EXCEEDED' ||
    code.startsWith('CREDENTIAL_') ||
    isModelCode(code)
  ) {
    return policy('PROVIDER', false, false, 'ERROR_STATE');
  }
  if (code === 'RATE_LIMITED' || code === 'PROVIDER_UNAVAILABLE') {
    return policy('PROVIDER', true, true, 'TOAST');
  }
  if (code === 'TIMEOUT' || code === 'NETWORK_FAILED') {
    return policy('NETWORK', true, true, 'TOAST');
  }
  if (isValidationCode(code)) {
    return policy('VALIDATION', true, false, 'ERROR_STATE');
  }
  if (isRuleCode(code)) {
    return policy('RULE', false, false, 'ERROR_STATE');
  }
  if (isPersistenceCode(code)) {
    const retryable = [
      'CONCURRENT_MODIFICATION',
      'APP_LOCK_UNAVAILABLE',
      'LOCAL_STORAGE_UNAVAILABLE',
    ].includes(code);
    return policy('PERSISTENCE', retryable, false, 'ERROR_STATE');
  }
  if (code === 'CANCELLED' || code === 'APP_INTERRUPTED') {
    return policy('GENERATION', true, false, 'TOAST');
  }
  return policy('GENERATION', false, false, 'ERROR_STATE');
}

function policy(
  kind: ApplicationErrorKind,
  retryable: boolean,
  fallbackEligible: boolean,
  surface: ErrorSurface,
) {
  return Object.freeze({ kind, retryable, fallbackEligible, surface });
}

function actionsFor(
  kind: ApplicationErrorKind,
  code: string,
  retryable: boolean,
  fallbackEligible: boolean,
): readonly ErrorAction[] {
  const actions: ErrorAction[] = [];
  if (retryable) actions.push('RETRY', 'CANCEL');
  if (fallbackEligible) actions.push('USE_FALLBACK');
  if (
    kind === 'PROVIDER' &&
    (code === 'AUTHENTICATION_FAILED' || code === 'QUOTA_EXCEEDED' || isModelCode(code))
  ) {
    actions.push('OPEN_SETTINGS');
  }
  if (kind === 'PROVIDER' && code.startsWith('CREDENTIAL_')) actions.push('OPEN_SETTINGS');
  if (kind === 'GENERATION' && code === 'UNKNOWN') actions.push('OPEN_SETTINGS');
  if (actions.length === 0) actions.push('DISMISS');
  return Object.freeze(actions);
}

function canonicalCode(rawCode: string | null): string {
  if (rawCode === null) return 'UNKNOWN';
  const standardized = standardizeAIError({ code: rawCode });
  if (standardized.code !== 'UNKNOWN' || rawCode === 'UNKNOWN') return standardized.code;
  return /^[A-Z0-9_]{2,64}$/.test(rawCode) ? rawCode : 'UNKNOWN';
}

function isModelCode(code: string): boolean {
  return [
    'MODEL_NOT_FOUND',
    'MODEL_NOT_CONFIGURED',
    'MODEL_PROFILE_MISSING',
    'NO_MODEL_CANDIDATE',
    'MODEL_SELECTION_DRIFT',
  ].includes(code);
}

function isValidationCode(code: string): boolean {
  return (
    code === 'FACT_CONFLICT' ||
    code === 'INVALID_OUTPUT' ||
    code === 'PROBE_STALE' ||
    code === 'REPETITION_DETECTED' ||
    code === 'AMBIGUOUS_JSON' ||
    code === 'RESPONSE_TRUNCATED' ||
    code === 'CONTENT_FILTERED' ||
    code === 'PROVIDER_RESPONSE_INCOMPLETE' ||
    code.startsWith('STREAM_') ||
    code.startsWith('SCHEMA_') ||
    code.endsWith('_OUTPUT_MISMATCH') ||
    code.endsWith('_ENVELOPE_INVALID')
  );
}

function isPersistenceCode(code: string): boolean {
  return (
    code.startsWith('CAMPAIGN_') ||
    code.startsWith('SAVE_') ||
    code === 'CONCURRENT_MODIFICATION' ||
    code === 'APP_LOCK_UNAVAILABLE' ||
    code === 'LOCAL_STORAGE_UNAVAILABLE'
  );
}

function isRuleCode(code: string): boolean {
  return (
    code.startsWith('DOMAIN_') ||
    code.startsWith('NETWORK_POLICY_') ||
    code.endsWith('_BUSINESS_RULE_INVALID') ||
    code === 'UNCONFIRMED_CANDIDATE' ||
    code === 'CAMPAIGN_STATE_INVALID' ||
    code === 'STALE_REVISION'
  );
}

function readErrorCode(error: unknown): string | null {
  if (typeof error === 'string') {
    try {
      return readErrorCode(JSON.parse(error) as unknown);
    } catch {
      return null;
    }
  }
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return null;
  const record = error as Readonly<Record<string, unknown>>;
  const code = record['code'];
  return typeof code === 'string' ? code : readErrorCode(record['cause']);
}

export function applicationErrorFromStandardCode(code: StandardAIErrorCode): ApplicationError {
  return classifyApplicationError({ code });
}
