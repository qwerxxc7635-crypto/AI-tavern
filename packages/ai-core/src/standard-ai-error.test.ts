import { describe, expect, it } from 'vitest';

import { StandardAIError, standardizeAIError } from './standard-ai-error.js';

describe('standard AI errors', () => {
  it.each([
    ['QUOTA_EXCEEDED', 'QUOTA_EXCEEDED', false],
    ['AUTHENTICATION', 'AUTHENTICATION_FAILED', false],
    ['RATE_LIMITED', 'RATE_LIMITED', true],
    ['TIMEOUT', 'TIMEOUT', true],
    ['MODEL_NOT_FOUND', 'MODEL_NOT_FOUND', false],
    ['INVALID_JSON', 'INVALID_OUTPUT', true],
    ['SCHEMA_VALIDATION_FAILED', 'INVALID_OUTPUT', true],
    ['NETWORK', 'NETWORK_FAILED', true],
  ] as const)('maps %s to %s', (source, expected, retryable) => {
    expect(standardizeAIError({ code: source })).toMatchObject({
      code: expected,
      retryable,
    });
  });

  it('preserves a standardized error and uses an explicit safe fallback', () => {
    const existing = new StandardAIError('TIMEOUT');
    expect(standardizeAIError(existing)).toBe(existing);
    expect(standardizeAIError(new Error('secret provider detail'), 'NETWORK_FAILED')).toMatchObject(
      {
        code: 'NETWORK_FAILED',
        retryable: true,
        message: 'AI operation failed: NETWORK_FAILED',
      },
    );
  });

  it('reads a safe code from Tauri command errors serialized as JSON text', () => {
    expect(standardizeAIError('{"code":"AUTHENTICATION_FAILED","message":"safe"}')).toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
  });
});
