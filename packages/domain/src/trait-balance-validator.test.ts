import {
  DEFAULT_TRAIT_EFFECT_BALANCE_DECLARATION,
  characterTraitId,
  type CharacterTrait,
  type TraitEffectBalanceDeclaration,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import { TraitBalanceValidator, TraitSynergyValidator, traitGenerationFeedback } from './index.js';

const worlds = [
  { scope: 'cultivation', revision: 2 },
  { scope: 'investigation', revision: 2 },
  { scope: 'cyberpunk', revision: 2 },
] as const;

describe('TraitBalanceValidator and TraitSynergyValidator', () => {
  it.each(worlds)('accepts the fair baseline in $scope with repeatable audit', (world) => {
    const validator = new TraitBalanceValidator();
    const first = validator.assertValid(pair(), world);
    const second = validator.assertValid(pair(), world);
    expect(second).toEqual(first);
    expect(first.evaluations.map(({ recommendedPoints }) => recommendedPoints)).toEqual([1, 1]);
  });

  it('raises explainable issues instead of a black-box score', () => {
    const traits = pair();
    const first = traits[0];
    if (first?.pointProfile === undefined) throw new Error('fixture must include a point profile');
    const unfair: CharacterTrait = {
      ...first,
      pointProfile: { ...first.pointProfile, buffPoints: -5 },
    };
    const validator = new TraitBalanceValidator();
    const report = validator.validate([unfair], worlds[0]);
    expect(report.issues[0]).toMatchObject({
      code: 'POINT_TIER_MISMATCH',
      traitIds: [unfair.id],
    });
    expect(() => validator.assertValid([unfair], worlds[0])).toThrow(/explainable issue/);
  });

  it('keeps shared themes valid but rejects an explicit drawback cancellation', () => {
    const [benefit, drawback] = pair();
    if (
      benefit?.pointProfile?.positiveBalance === undefined ||
      benefit.pointProfile.positiveBalance === null ||
      drawback?.pointProfile?.negativeBalance === undefined ||
      drawback.pointProfile.negativeBalance === null
    ) {
      throw new Error('fixtures must include both balance declarations');
    }
    const sharedTheme: CharacterTrait = {
      ...benefit,
      pointProfile: {
        ...benefit.pointProfile,
        positiveBalance: {
          ...benefit.pointProfile.positiveBalance,
          mechanicTags: ['调查'],
        },
      },
    };
    expect(new TraitSynergyValidator().validate([sharedTheme, benefit], worlds[1]).valid).toBe(
      true,
    );

    const exploit: CharacterTrait = {
      ...benefit,
      pointProfile: {
        ...benefit.pointProfile,
        positiveBalance: {
          ...benefit.pointProfile.positiveBalance,
          neutralizesTags: [...drawback.pointProfile.negativeBalance.mechanicTags],
        },
      },
    };
    const feedback = traitGenerationFeedback([exploit, drawback], worlds[1]);
    expect(feedback).toMatchObject({ accepted: false, worldRuleKey: 'investigation@2' });
    expect(feedback.issues.map(({ code }) => code)).toContain('DRAWBACK_NEUTRALIZED');
  });
});

function pair(): readonly CharacterTrait[] {
  return [trait('benefit', 'BUFF', balance('线索')), trait('drawback', 'DEBUFF', balance('执念'))];
}

function trait(
  id: string,
  type: 'BUFF' | 'DEBUFF',
  declaration: TraitEffectBalanceDeclaration,
): CharacterTrait {
  const positive = type === 'BUFF';
  return {
    id: characterTraitId(`trait-${id}`),
    name: id,
    description: id,
    pointProfile: {
      type,
      positiveEffect: positive ? '发现隐藏线索。' : null,
      negativeEffect: positive ? null : '必须追查线索。',
      buffPoints: positive ? -1 : 0,
      debuffPoints: positive ? 0 : 1,
      positiveBalance: positive ? declaration : null,
      negativeBalance: positive ? null : declaration,
    },
  };
}

function balance(tag: string): TraitEffectBalanceDeclaration {
  return {
    ...DEFAULT_TRAIT_EFFECT_BALANCE_DECLARATION,
    mechanicTags: [tag],
    requiresTags: [`${tag}条件`],
  };
}
