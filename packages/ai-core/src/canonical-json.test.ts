import { describe, expect, it } from 'vitest';

import { canonicalJson } from './canonical-json.js';

describe('canonical JSON', () => {
  it('stabilizes keys, whitespace, enums, numbers, Unicode and newlines', () => {
    const first = {
      z: 3,
      text: 'line one\r\nline two\rline three',
      negativeZero: -0,
      enumValue: 'STABLE',
      array: ['second', 'first'],
      nested: { 'e\u0301': 'Cafe\u0301' },
    } as const;
    const second = {
      nested: { é: 'Café' },
      array: ['second', 'first'],
      enumValue: 'STABLE',
      negativeZero: 0,
      text: 'line one\nline two\nline three',
      z: 3,
    } as const;

    const expected =
      '{"array":["second","first"],"enumValue":"STABLE","negativeZero":0,"nested":{"é":"Café"},"text":"line one\\nline two\\nline three","z":3}';
    expect(canonicalJson(first)).toBe(expected);
    expect(canonicalJson(second)).toBe(expected);
    expect(new TextEncoder().encode(canonicalJson(first))).toEqual(
      new TextEncoder().encode(canonicalJson(second)),
    );
  });

  it('preserves semantic array order and rejects invalid or ambiguous JSON', () => {
    expect(canonicalJson(['a', 'b'])).toBe('["a","b"]');
    expect(canonicalJson(['b', 'a'])).toBe('["b","a"]');
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow('finite');
    expect(() => canonicalJson({ é: 1, 'e\u0301': 2 })).toThrow('Unicode-equivalent');
  });
});
