export const STANDARD_AI_ERROR_CODES = [
  'QUOTA_EXCEEDED',
  'AUTHENTICATION_FAILED',
  'RATE_LIMITED',
  'TIMEOUT',
  'MODEL_NOT_FOUND',
  'INVALID_OUTPUT',
  'NETWORK_FAILED',
  'UNKNOWN',
] as const;

export type StandardAIErrorCode = (typeof STANDARD_AI_ERROR_CODES)[number];

const RETRYABLE: Readonly<Record<StandardAIErrorCode, boolean>> = Object.freeze({
  QUOTA_EXCEEDED: false,
  AUTHENTICATION_FAILED: false,
  RATE_LIMITED: true,
  TIMEOUT: true,
  MODEL_NOT_FOUND: false,
  INVALID_OUTPUT: true,
  NETWORK_FAILED: true,
  UNKNOWN: false,
});

const LEGACY_CODES: Readonly<Record<string, StandardAIErrorCode>> = Object.freeze({
  AUTHENTICATION: 'AUTHENTICATION_FAILED',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  CREDENTIAL: 'AUTHENTICATION_FAILED',
  INVALID_JSON: 'INVALID_OUTPUT',
  INVALID_OUTPUT: 'INVALID_OUTPUT',
  INVALID_RESPONSE: 'INVALID_OUTPUT',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  MODEL_NOT_CONFIGURED: 'MODEL_NOT_FOUND',
  MODEL_SELECTION_DRIFT: 'MODEL_NOT_FOUND',
  MODEL_PROFILE_MISSING: 'MODEL_NOT_FOUND',
  NETWORK: 'NETWORK_FAILED',
  NETWORK_FAILED: 'NETWORK_FAILED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  NO_MODEL_CANDIDATE: 'MODEL_NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  REPETITION_DETECTED: 'INVALID_OUTPUT',
  SCHEMA_VALIDATION_FAILED: 'INVALID_OUTPUT',
  TIMEOUT: 'TIMEOUT',
});

export class StandardAIError extends Error {
  public readonly retryable: boolean;

  public constructor(
    public readonly code: StandardAIErrorCode,
    options?: ErrorOptions,
  ) {
    super(`AI operation failed: ${code}`, options);
    this.name = 'StandardAIError';
    this.retryable = RETRYABLE[code];
  }
}

export function standardizeAIError(
  error: unknown,
  fallback: StandardAIErrorCode = 'UNKNOWN',
): StandardAIError {
  if (error instanceof StandardAIError) return error;
  const code = readErrorCode(error);
  return new StandardAIError(code === null ? fallback : (LEGACY_CODES[code] ?? fallback), {
    cause: error,
  });
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
  const code = (error as Readonly<Record<string, unknown>>)['code'];
  return typeof code === 'string' ? code : null;
}
