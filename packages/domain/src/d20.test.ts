import { checkRequestId, type CheckDifficulty } from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import { D20RuleError, resolveD20Check, type D20RandomSource } from './index.js';

const fixed = (value: number): D20RandomSource => ({ nextD20: () => value });
const checkId = checkRequestId('check-1');

describe('D20 rule engine', () => {
  it.each([8, 11, 14, 17] satisfies readonly CheckDifficulty[])(
    'succeeds exactly at difficulty %s',
    (difficulty) => {
      const result = resolveD20Check(
        {
          checkRequestId: checkId,
          attributeValue: 5,
          equipmentModifier: 0,
          statusModifier: 0,
          difficulty,
        },
        fixed(difficulty - 5),
      );
      expect(result.total).toBe(difficulty);
      expect(result.success).toBe(true);
    },
  );

  it('fails one point below the difficulty', () => {
    const result = resolveD20Check(
      {
        checkRequestId: checkId,
        attributeValue: 2,
        equipmentModifier: 0,
        statusModifier: 0,
        difficulty: 14,
      },
      fixed(11),
    );
    expect(result).toMatchObject({ total: 13, success: false });
  });

  it('applies equipment and status modifiers without changing the die result', () => {
    const result = resolveD20Check(
      {
        checkRequestId: checkId,
        attributeValue: 3,
        equipmentModifier: 2,
        statusModifier: -1,
        difficulty: 14,
      },
      fixed(10),
    );
    expect(result).toMatchObject({
      raw: 10,
      modifier: 4,
      dc: 14,
      result: 'SUCCESS',
      d20: 10,
      attributeModifier: 3,
      equipmentModifier: 2,
      statusModifier: -1,
      total: 14,
      success: true,
    });
  });

  it.each([1, 20])('accepts die boundary %s', (roll) => {
    expect(
      resolveD20Check(
        {
          checkRequestId: checkId,
          attributeValue: 1,
          equipmentModifier: 0,
          statusModifier: 0,
          difficulty: 8,
        },
        fixed(roll),
      ).d20,
    ).toBe(roll);
  });

  it.each([0, 21, 1.5, Number.NaN])('rejects invalid die result %s', (roll) => {
    expect(() =>
      resolveD20Check(
        {
          checkRequestId: checkId,
          attributeValue: 1,
          equipmentModifier: 0,
          statusModifier: 0,
          difficulty: 8,
        },
        fixed(roll),
      ),
    ).toThrow(D20RuleError);
  });

  it('rejects invalid attributes and modifiers', () => {
    expect(() =>
      resolveD20Check(
        {
          checkRequestId: checkId,
          attributeValue: 0,
          equipmentModifier: 0,
          statusModifier: 0,
          difficulty: 8,
        },
        fixed(10),
      ),
    ).toThrow(D20RuleError);
    expect(() =>
      resolveD20Check(
        {
          checkRequestId: checkId,
          attributeValue: 2,
          equipmentModifier: 0.5,
          statusModifier: 0,
          difficulty: 8,
        },
        fixed(10),
      ),
    ).toThrow(D20RuleError);
  });

  it.each([0, 6, 1.5, Number.NaN])('rejects invalid attribute value %s', (attributeValue) => {
    expect(() =>
      resolveD20Check(
        {
          checkRequestId: checkId,
          attributeValue,
          equipmentModifier: 0,
          statusModifier: 0,
          difficulty: 8,
        },
        fixed(10),
      ),
    ).toThrow(D20RuleError);
  });

  it.each([
    ['equipmentModifier', Number.POSITIVE_INFINITY, 0],
    ['statusModifier', 0, Number.NaN],
    ['statusModifier', 0, 0.5],
  ] as const)('rejects unsafe %s', (_label, equipmentModifier, statusModifier) => {
    expect(() =>
      resolveD20Check(
        {
          checkRequestId: checkId,
          attributeValue: 1,
          equipmentModifier,
          statusModifier,
          difficulty: 8,
        },
        fixed(10),
      ),
    ).toThrow(D20RuleError);
  });

  it('rejects a difficulty outside the closed ruleset', () => {
    expect(() =>
      resolveD20Check(
        {
          checkRequestId: checkId,
          attributeValue: 1,
          equipmentModifier: 0,
          statusModifier: 0,
          difficulty: 9 as CheckDifficulty,
        },
        fixed(10),
      ),
    ).toThrow(/difficulty must be one of/u);
  });

  it('rejects a total that exceeds the safe integer range', () => {
    expect(() =>
      resolveD20Check(
        {
          checkRequestId: checkId,
          attributeValue: 5,
          equipmentModifier: Number.MAX_SAFE_INTEGER - 5,
          statusModifier: 0,
          difficulty: 8,
        },
        fixed(20),
      ),
    ).toThrow(/total must be a safe integer/u);
  });

  it('returns an immutable auditable result', () => {
    const result = resolveD20Check(
      {
        checkRequestId: checkId,
        attributeValue: 3,
        equipmentModifier: 1,
        statusModifier: 0,
        difficulty: 11,
      },
      fixed(7),
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).toMatchObject({
      checkRequestId: checkId,
      raw: 7,
      modifier: 4,
      d20: 7,
      total: 11,
      dc: 11,
      result: 'SUCCESS',
      success: true,
    });
  });
});
