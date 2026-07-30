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
});
