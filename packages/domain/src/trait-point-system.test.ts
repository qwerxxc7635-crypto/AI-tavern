import {
  NARRATIVE_TRAIT_POINT_PROFILE,
  characterTraitId,
  type TraitPointProfile,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import { confirmCharacterTraitPoints, evaluateCharacterTraitPoints } from './index.js';

describe('local Trait Point rules', () => {
  it('returns an auditable breakdown and strict total without trusting stored net values', () => {
    const traits = [
      trait('buff', {
        type: 'BUFF',
        positiveEffect: '能在黑暗中看清道路。',
        negativeEffect: null,
        buffPoints: -3,
        debuffPoints: 0,
      }),
      trait('debuff', {
        type: 'DEBUFF',
        positiveEffect: null,
        negativeEffect: '无法拒绝眼前的求助。',
        buffPoints: 0,
        debuffPoints: 3,
      }),
    ];
    expect(confirmCharacterTraitPoints(traits)).toEqual({
      kind: 'TRAIT_POINT_EVALUATION',
      breakdown: [
        {
          traitId: 'trait-buff',
          type: 'BUFF',
          buffPoints: -3,
          debuffPoints: 0,
          netPoints: -3,
        },
        {
          traitId: 'trait-debuff',
          type: 'DEBUFF',
          buffPoints: 0,
          debuffPoints: 3,
          netPoints: 3,
        },
      ],
      netPoints: 0,
      balanced: true,
    });
  });

  it('accepts empty and Narrative sets, but confirmation rejects non-zero evaluation', () => {
    expect(confirmCharacterTraitPoints([])).toMatchObject({ netPoints: 0, balanced: true });
    expect(
      confirmCharacterTraitPoints([trait('story', NARRATIVE_TRAIT_POINT_PROFILE)]),
    ).toMatchObject({ netPoints: 0, balanced: true });
    const unbalanced = [
      trait('buff', {
        type: 'BUFF',
        positiveEffect: '优势',
        negativeEffect: null,
        buffPoints: -5,
        debuffPoints: 0,
      }),
    ];
    expect(evaluateCharacterTraitPoints(unbalanced)).toMatchObject({
      netPoints: -5,
      balanced: false,
    });
    expect(() => confirmCharacterTraitPoints(unbalanced)).toThrow(/exactly zero/);
  });
});

function trait(suffix: string, pointProfile: TraitPointProfile) {
  return { id: characterTraitId(`trait-${suffix}`), pointProfile };
}
