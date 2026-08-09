import { describe, expect, it } from 'vitest';

import { parseStoredDiceResult } from './dice-result-validation.js';

const legacy = {
  checkRequestId: 'check-one',
  d20: 10,
  attributeModifier: 3,
  equipmentModifier: 2,
  statusModifier: -1,
  total: 14,
  difficulty: 14,
  success: true,
};

describe('stored D20 validation', () => {
  it('upgrades a consistent legacy result to the canonical hard-logic projection', () => {
    expect(parseStoredDiceResult(legacy)).toMatchObject({
      raw: 10,
      modifier: 4,
      total: 14,
      dc: 14,
      result: 'SUCCESS',
    });
  });

  it.each([
    { ...legacy, raw: 11 },
    { ...legacy, modifier: 5 },
    { ...legacy, total: 13 },
    { ...legacy, dc: 11 },
    { ...legacy, result: 'FAILURE' },
    { ...legacy, success: false },
  ])('rejects contradictory persisted dice facts', (result) => {
    expect(() => parseStoredDiceResult(result)).toThrow(/D20|inconsistent/u);
  });
});
