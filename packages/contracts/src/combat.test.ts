import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  CURRENT_COMBAT_VERSION_SET,
  CombatVersionContractError,
  assertSupportedCombatVersionSet,
  combatVersionIdentity,
  parseCombatVersionSet,
} from './index.js';

const fixture = JSON.parse(
  readFileSync(new URL('./combat-version-contract.fixture.json', import.meta.url), 'utf8'),
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
