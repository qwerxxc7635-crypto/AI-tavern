import { describe, expect, it } from 'vitest';

import { parseD20HardResult } from './d20-hard-result.js';

const valid = {
  raw: 10,
  modifier: 4,
  total: 14,
  dc: 14,
  result: 'SUCCESS',
  naturalRoll: 10,
  attributeModifier: 3,
  attributeValue: 3,
  equipmentModifier: 2,
  statusModifier: -1,
  difficulty: 14,
  success: true,
};

describe('D20 hard-result parser', () => {
  it('accepts a complete result only when raw + modifier equals total and total determines result', () => {
    expect(parseD20HardResult(valid)).toEqual({
      raw: 10,
      modifier: 4,
      total: 14,
      dc: 14,
      result: 'SUCCESS',
      attributeModifier: 3,
      equipmentModifier: 2,
      statusModifier: -1,
    });
  });

  it.each([
    { ...valid, raw: 11 },
    { ...valid, modifier: 5 },
    { ...valid, total: 13 },
    { ...valid, dc: 11 },
    { ...valid, result: 'FAILURE' },
    { ...valid, success: false },
  ])('rejects a contradictory stored or transported result', (value) => {
    expect(() => parseD20HardResult(value)).toThrow(TypeError);
  });

  it('reads the legacy aliases while producing one canonical projection', () => {
    expect(
      parseD20HardResult({
        naturalRoll: 9,
        attributeValue: 2,
        equipmentModifier: 0,
        statusModifier: 0,
        total: 11,
        difficulty: 14,
        success: false,
      }),
    ).toMatchObject({ raw: 9, modifier: 2, total: 11, dc: 14, result: 'FAILURE' });
  });
});
