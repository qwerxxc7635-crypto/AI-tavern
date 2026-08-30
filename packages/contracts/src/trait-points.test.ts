import { describe, expect, it } from 'vitest';

import {
  NARRATIVE_TRAIT_POINT_PROFILE,
  assertBalancedCharacterTraitPoints,
  characterTraitPointNet,
  createTraitPointProfile,
  traitPointNet,
} from './index.js';

describe('Trait Point System', () => {
  it.each([
    [
      'BUFF',
      {
        type: 'BUFF',
        positiveEffect: '在黑暗中看清道路。',
        negativeEffect: null,
        buffPoints: -3,
        debuffPoints: 0,
      },
      -3,
    ],
    [
      'DEBUFF',
      {
        type: 'DEBUFF',
        positiveEffect: null,
        negativeEffect: '无法拒绝求助。',
        buffPoints: 0,
        debuffPoints: 3,
      },
      3,
    ],
    [
      'MIXED',
      {
        type: 'MIXED',
        positiveEffect: '能辨认远古符号。',
        negativeEffect: '阅读符号会留下魔法痕迹。',
        buffPoints: -4,
        debuffPoints: 2,
      },
      -2,
    ],
    ['NARRATIVE', NARRATIVE_TRAIT_POINT_PROFILE, 0],
  ] as const)('validates %s and derives its local net', (_type, profile, net) => {
    expect(createTraitPointProfile(profile)).toEqual(profile);
    expect(traitPointNet(profile)).toBe(net);
  });

  it('accepts both -5/+5 boundaries and rejects zero, sign, effect and extra-field bypasses', () => {
    expect(
      traitPointNet({
        type: 'MIXED',
        positiveEffect: '优势',
        negativeEffect: '限制',
        buffPoints: -5,
        debuffPoints: 5,
      }),
    ).toBe(0);
    for (const profile of [
      {
        type: 'BUFF',
        positiveEffect: '优势',
        negativeEffect: null,
        buffPoints: 0,
        debuffPoints: 0,
      },
      {
        type: 'DEBUFF',
        positiveEffect: null,
        negativeEffect: '限制',
        buffPoints: 0,
        debuffPoints: -1,
      },
      {
        type: 'MIXED',
        positiveEffect: '优势',
        negativeEffect: null,
        buffPoints: -1,
        debuffPoints: 1,
      },
      { ...NARRATIVE_TRAIT_POINT_PROFILE, hiddenScore: 5 },
    ]) {
      expect(() => createTraitPointProfile(profile)).toThrow(/Trait point|Trait|fields/);
    }
  });

  it('treats missing legacy profiles and the empty collection as strict zero', () => {
    expect(createTraitPointProfile(undefined)).toEqual(NARRATIVE_TRAIT_POINT_PROFILE);
    expect(characterTraitPointNet([])).toBe(0);
    expect(() => assertBalancedCharacterTraitPoints([])).not.toThrow();
    expect(() =>
      assertBalancedCharacterTraitPoints([
        {
          pointProfile: {
            type: 'BUFF',
            positiveEffect: '优势',
            negativeEffect: null,
            buffPoints: -1,
            debuffPoints: 0,
          },
        },
      ]),
    ).toThrow(/exactly zero/);
  });

  it('balances independent Traits and survives canonical JSON serialization', () => {
    const traits = [
      {
        pointProfile: createTraitPointProfile({
          type: 'BUFF',
          positiveEffect: '识破谎言。',
          negativeEffect: null,
          buffPoints: -2,
          debuffPoints: 0,
        }),
      },
      {
        pointProfile: createTraitPointProfile({
          type: 'DEBUFF',
          positiveEffect: null,
          negativeEffect: '无法容忍公开的谎言。',
          buffPoints: 0,
          debuffPoints: 2,
        }),
      },
    ];
    const serialized = JSON.parse(JSON.stringify(traits)) as typeof traits;

    expect(characterTraitPointNet(serialized)).toBe(0);
    expect(() => assertBalancedCharacterTraitPoints(serialized)).not.toThrow();
    expect(serialized).toEqual(traits);
  });
});
