import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  CURRENT_COMBAT_VERSION_SET,
  CombatRngContractError,
  CombatVersionContractError,
  assertSupportedCombatVersionSet,
  combatVersionIdentity,
  parseCombatRngSnapshot,
  parseCombatVersionSet,
} from './index.js';

const fixture = JSON.parse(
  readFileSync(new URL('./combat-version-contract.fixture.json', import.meta.url), 'utf8'),
) as unknown;
const rngFixture = JSON.parse(
  readFileSync(new URL('./combat-rng-contract.fixture.json', import.meta.url), 'utf8'),
) as unknown;

describe('Combat version contract', () => {
  it('matches the shared Rust wire fixture and stable debug identity', () => {
    const versions = parseCombatVersionSet(fixture);
    expect(versions).toEqual(CURRENT_COMBAT_VERSION_SET);
    expect(Object.isFrozen(versions)).toBe(true);
    assertSupportedCombatVersionSet(versions);
    expect(combatVersionIdentity(versions)).toBe(
      'combatSchemaVersion=1|rulesetVersion=1|balanceVersion=1|engineVersion=1|worldProfileVersion=1|attributeMappingVersion=1|rngContractVersion=1',
    );
  });

  it.each([
    ['zero', { ...CURRENT_COMBAT_VERSION_SET, engineVersion: 0 }],
    ['fractional', { ...CURRENT_COMBAT_VERSION_SET, balanceVersion: 1.5 }],
    ['missing', { ...CURRENT_COMBAT_VERSION_SET, rulesetVersion: undefined }],
    ['unknown', { ...CURRENT_COMBAT_VERSION_SET, buildTimeVersion: 1 }],
  ])('rejects a structurally invalid %s version set', (_label, value) => {
    expect(() => parseCombatVersionSet(value)).toThrow(CombatVersionContractError);
  });

  it('parses a future positive version and rejects it at the explicit compatibility gate', () => {
    const future = parseCombatVersionSet({
      ...CURRENT_COMBAT_VERSION_SET,
      attributeMappingVersion: 2,
    });
    expect(() => assertSupportedCombatVersionSet(future)).toThrow(
      expect.objectContaining({
        code: 'COMBAT_VERSION_UNSUPPORTED',
        path: 'attributeMappingVersion',
      }),
    );
  });
});

describe('Combat RNG snapshot wire contract', () => {
  it('parses and freezes the shared Rust checkpoint fixture', () => {
    const snapshot = parseCombatRngSnapshot(rngFixture);
    expect(snapshot.streams.map((stream) => stream.channelId)).toEqual([
      'initiative',
      'resolution',
      'utilityTieBreak',
    ]);
    expect(snapshot.streams.map((stream) => stream.stateHex)).toEqual([
      'a5f73a890ba2500a',
      'f72cf555e20d6795',
      'f59d20119ff704a0',
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.streams)).toBe(true);
  });

  it.each([
    [
      'missing streams',
      () => ({
        ...(structuredClone(rngFixture) as Record<string, unknown>),
        streams: [],
      }),
    ],
    [
      'wrong channel order',
      () => {
        const value = structuredClone(rngFixture) as { streams: unknown[] };
        value.streams.reverse();
        return value;
      },
    ],
    [
      'uppercase state',
      () => {
        const value = structuredClone(rngFixture) as { streams: Array<{ stateHex: string }> };
        const first = value.streams[0];
        if (first === undefined) throw new Error('fixture stream is missing');
        first.stateHex = 'A5F73A890BA2500A';
        return value;
      },
    ],
    [
      'unsafe cursor',
      () => {
        const value = structuredClone(rngFixture) as { streams: Array<{ cursor: number }> };
        const resolution = value.streams[1];
        if (resolution === undefined) throw new Error('fixture stream is missing');
        resolution.cursor = Number.MAX_SAFE_INTEGER + 1;
        return value;
      },
    ],
    ['unknown field', () => ({ ...(rngFixture as object), previewCursor: 0 })],
  ])('rejects %s', (_label, build) => {
    expect(() => parseCombatRngSnapshot(build())).toThrow(CombatRngContractError);
  });
});
