import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  APPLICATION_ERROR_KINDS,
  ApplicationError,
  classifyApplicationError,
} from './application-error.js';

describe('application error architecture', () => {
  it('exposes exactly the six stable product error kinds', () => {
    expect(APPLICATION_ERROR_KINDS).toEqual([
      'PROVIDER',
      'GENERATION',
      'VALIDATION',
      'PERSISTENCE',
      'RULE',
      'NETWORK',
    ]);
  });

  it.each([
    ['AUTHENTICATION_FAILED', 'PROVIDER', false, false, ['OPEN_SETTINGS'], 'ERROR_STATE'],
    ['RATE_LIMITED', 'PROVIDER', true, true, ['RETRY', 'CANCEL', 'USE_FALLBACK'], 'TOAST'],
    ['TIMEOUT', 'NETWORK', true, true, ['RETRY', 'CANCEL', 'USE_FALLBACK'], 'TOAST'],
    ['INVALID_OUTPUT', 'VALIDATION', true, false, ['RETRY', 'CANCEL'], 'ERROR_STATE'],
    ['LOCAL_STORAGE_UNAVAILABLE', 'PERSISTENCE', true, false, ['RETRY', 'CANCEL'], 'ERROR_STATE'],
    ['DOMAIN_RULE_REJECTED', 'RULE', false, false, ['DISMISS'], 'ERROR_STATE'],
    ['UNKNOWN', 'GENERATION', false, false, ['OPEN_SETTINGS'], 'ERROR_STATE'],
  ] as const)(
    'maps %s to a stable contract',
    (code, kind, retryable, fallbackEligible, actions, surface) => {
      expect(classifyApplicationError({ code })).toMatchObject({
        code,
        kind,
        retryable,
        fallbackEligible,
        actions,
        surface,
      });
    },
  );

  it('preserves an existing contract and never exposes a raw upstream message', () => {
    const existing = new ApplicationError('NETWORK', 'NETWORK_FAILED', true, true, 'TOAST');
    expect(classifyApplicationError(existing)).toBe(existing);
    const classified = classifyApplicationError(new Error('secret upstream response'));
    expect(classified).toMatchObject({ kind: 'GENERATION', code: 'UNKNOWN' });
    expect(classified.message).not.toContain('secret upstream response');
    expect(
      classifyApplicationError(new Error('wrapper', { cause: { code: 'DOMAIN_RULE_REJECTED' } })),
    ).toMatchObject({ kind: 'RULE', code: 'DOMAIN_RULE_REJECTED' });
  });

  it('matches the shared TypeScript and Rust contract fixture', () => {
    const fixtures = JSON.parse(
      readFileSync(new URL('./application-error-contract.fixture.json', import.meta.url), 'utf8'),
    ) as readonly Readonly<{
      code: string;
      kind: string;
      retryable: boolean;
      fallbackEligible: boolean;
      surface: string;
      actions: readonly string[];
    }>[];
    for (const fixture of fixtures) {
      expect(classifyApplicationError({ code: fixture.code })).toMatchObject(fixture);
    }
  });

  it('rejects forged fallback eligibility outside transient provider or network errors', () => {
    expect(
      () => new ApplicationError('RULE', 'DOMAIN_RULE_REJECTED', true, true, 'ERROR_STATE'),
    ).toThrow('Application error contract is invalid');
    expect(() => new ApplicationError('NETWORK', 'NETWORK_FAILED', false, true, 'TOAST')).toThrow(
      'Application error contract is invalid',
    );
  });
});
