import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRAIT_EFFECT_BALANCE_DECLARATION,
  assertCharacterTraitBalanceAndSynergy,
  buildTraitGenerationFeedback,
  createTraitPointProfile,
  createTraitWorldRuleKey,
  evaluateCharacterTraitBalance,
  evaluateCharacterTraitSynergy,
  recommendedTraitPoints,
  traitBalanceScore,
  type CharacterTrait,
  type TraitEffectBalanceDeclaration,
} from './index.js';

const worldRules = createTraitWorldRuleKey('cultivation', 3);

describe('Trait balance and synergy contracts', () => {
  it('audits all ten dimensions and accepts a fair strict-zero pair', () => {
    const traits = balancedPair();
    const report = evaluateCharacterTraitBalance(traits, worldRules);

    expect(report).toMatchObject({ valid: true, issues: [] });
    expect(report.evaluations).toHaveLength(2);
    expect(Object.keys(report.evaluations[0]?.dimensions ?? {})).toEqual([
      'frequency',
      'environment',
      'combat',
      'social',
      'narrative',
      'economy',
      'permanence',
      'avoidability',
      'rarity',
      'condition',
    ]);
    expect(() => assertCharacterTraitBalanceAndSynergy(traits, worldRules)).not.toThrow();
  });

  it('rejects an underpriced effect with an exact tier and path explanation', () => {
    const expensive = declaration({
      frequency: 'CONSTANT',
      environment: 'UNIVERSAL',
      combat: 'DOMINANT',
      social: 'DOMINANT',
      narrative: 'DOMINANT',
      economy: 'DOMINANT',
      permanence: 'PERMANENT',
      avoidability: 'IMPOSSIBLE',
      rarity: 'UNIQUE',
      condition: 'UNCONDITIONAL',
      requiresTags: [],
    });
    expect(traitBalanceScore(expensive)).toBe(30);
    expect(recommendedTraitPoints(expensive)).toBe(5);
    const report = evaluateCharacterTraitBalance([buff('underpriced', -1, expensive)], worldRules);
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'POINT_TIER_MISMATCH',
        targetPaths: ['traits.0.pointProfile.positiveBalance'],
        message: expect.stringContaining('must equal transparent tier 5'),
      }),
    ]);
  });

  it('keeps legacy mechanical data readable but requires evidence before confirmation', () => {
    const legacy = {
      id: 'legacy-buff',
      pointProfile: {
        type: 'BUFF' as const,
        positiveEffect: '旧存档优势',
        negativeEffect: null,
        buffPoints: -1,
        debuffPoints: 0,
      },
    };
    expect(evaluateCharacterTraitBalance([legacy], worldRules).issues).toEqual([
      expect.objectContaining({ code: 'BALANCE_DECLARATION_MISSING' }),
    ]);
    expect(() => assertCharacterTraitBalanceAndSynergy([legacy], worldRules)).toThrow(
      /explainable issue/,
    );
  });

  it('rejects malformed dimensions, empty impact and condition metadata disagreement', () => {
    for (const malformed of [
      { ...DEFAULT_TRAIT_EFFECT_BALANCE_DECLARATION, futureDimension: 'hidden' },
      {
        ...DEFAULT_TRAIT_EFFECT_BALANCE_DECLARATION,
        combat: 'NONE',
        social: 'NONE',
        narrative: 'NONE',
        economy: 'NONE',
      },
      {
        ...DEFAULT_TRAIT_EFFECT_BALANCE_DECLARATION,
        condition: 'UNCONDITIONAL',
        requiresTags: ['仍有条件'],
      },
    ]) {
      expect(() => recommendedTraitPoints(malformed as TraitEffectBalanceDeclaration)).toThrow(
        /Trait|condition|fields|domain/,
      );
    }
  });

  it('matches Native optional-field and Unicode tag boundaries', () => {
    const profile = createTraitPointProfile({
      type: 'BUFF',
      positiveEffect: '优势',
      negativeEffect: null,
      buffPoints: -1,
      debuffPoints: 0,
      positiveBalance: DEFAULT_TRAIT_EFFECT_BALANCE_DECLARATION,
    });
    expect(profile.positiveBalance).toEqual(DEFAULT_TRAIT_EFFECT_BALANCE_DECLARATION);
    expect(profile.negativeBalance).toBeUndefined();

    const astralLetter = '𐐀';
    expect(recommendedTraitPoints(declaration({ mechanicTags: [astralLetter.repeat(48)] }))).toBe(
      1,
    );
    expect(() =>
      recommendedTraitPoints(declaration({ mechanicTags: [astralLetter.repeat(49)] })),
    ).toThrow(/invalid tag/);
  });

  it('makes conditional, permanent and environment changes visible in deterministic tiers', () => {
    const conditional = declaration({ condition: 'STRICT', requiresTags: ['月蚀'] });
    const broadCondition = declaration({ condition: 'UNCONDITIONAL', requiresTags: [] });
    const permanent = declaration({
      permanence: 'PERMANENT',
      narrative: 'DOMINANT',
      social: 'MAJOR',
    });
    const universal = declaration({
      environment: 'UNIVERSAL',
      frequency: 'COMMON',
      social: 'MINOR',
    });

    expect(recommendedTraitPoints(conditional)).toBe(1);
    expect(recommendedTraitPoints(broadCondition)).toBe(1);
    expect(traitBalanceScore(broadCondition)).toBeGreaterThan(traitBalanceScore(conditional));
    expect(recommendedTraitPoints(permanent)).toBe(2);
    expect(recommendedTraitPoints(universal)).toBe(2);
  });

  it('rejects neutralized drawbacks, bypassed conditions and a positive feedback loop', () => {
    const drawback = debuff(
      'drawback',
      1,
      declaration({ mechanicTags: ['失控'], requiresTags: ['压力'] }),
    );
    const neutralizer = buff(
      'neutralizer',
      -1,
      declaration({
        frequency: 'CONSTANT',
        social: 'MINOR',
        neutralizesTags: ['失控'],
        grantsTags: ['专注'],
        requiresTags: ['怒火'],
      }),
    );
    const loop = buff(
      'loop',
      -1,
      declaration({
        frequency: 'CONSTANT',
        social: 'MINOR',
        grantsTags: ['怒火'],
        requiresTags: ['专注'],
      }),
    );
    const report = evaluateCharacterTraitSynergy([drawback, neutralizer, loop], worldRules);

    expect(report.valid).toBe(false);
    expect(new Set(report.issues.map(({ code }) => code))).toEqual(
      new Set(['DRAWBACK_NEUTRALIZED', 'CONDITION_BYPASS', 'POSITIVE_FEEDBACK_LOOP']),
    );
    expect(
      buildTraitGenerationFeedback(
        evaluateCharacterTraitBalance([drawback, neutralizer, loop], worldRules),
        report,
      ),
    ).toMatchObject({ accepted: false, worldRuleKey: worldRules });
  });

  it('allows ordinary overlap and narrative/empty baselines without false positives', () => {
    const shared = declaration({ mechanicTags: ['调查'] });
    const overlapping = [buff('observer', -1, shared), buff('scholar', -1, shared)];
    expect(evaluateCharacterTraitSynergy(overlapping, worldRules)).toMatchObject({ valid: true });
    const harmlessConditionChain = [
      buff('grant', -1, declaration({ grantsTags: ['专注'] })),
      buff('require', -1, declaration({ requiresTags: ['专注'] })),
    ];
    expect(evaluateCharacterTraitSynergy(harmlessConditionChain, worldRules)).toMatchObject({
      valid: true,
    });
    expect(evaluateCharacterTraitBalance([], worldRules)).toMatchObject({ valid: true });
    expect(
      evaluateCharacterTraitBalance(
        [
          {
            id: 'narrative',
          },
        ],
        worldRules,
      ),
    ).toMatchObject({ valid: true });
  });

  it.each(['cultivation', 'investigation', 'cyberpunk'])(
    'repeats the same auditable result for the %s world rules',
    (world) => {
      const key = createTraitWorldRuleKey(world, 7);
      const first = evaluateCharacterTraitBalance(balancedPair(), key);
      const second = evaluateCharacterTraitBalance(
        JSON.parse(JSON.stringify(balancedPair())) as readonly CharacterTrait[],
        key,
      );
      expect(second).toEqual(first);
      expect(second.worldRuleKey).toBe(`${world}@7`);
    },
  );
});

function balancedPair(): readonly CharacterTrait[] {
  return [
    buff('sight', -1, declaration({ mechanicTags: ['侦察'], requiresTags: ['昏暗'] })),
    debuff('impulse', 1, declaration({ mechanicTags: ['冲动'], requiresTags: ['求助'] })),
  ];
}

function buff(
  id: string,
  points: -1 | -2 | -3 | -4 | -5,
  positiveBalance: TraitEffectBalanceDeclaration,
): CharacterTrait {
  return {
    id: `trait-${id}` as CharacterTrait['id'],
    name: id,
    description: id,
    pointProfile: {
      type: 'BUFF',
      positiveEffect: '正面效果',
      negativeEffect: null,
      buffPoints: points,
      debuffPoints: 0,
      positiveBalance,
      negativeBalance: null,
    },
  };
}

function debuff(
  id: string,
  points: 1 | 2 | 3 | 4 | 5,
  negativeBalance: TraitEffectBalanceDeclaration,
): CharacterTrait {
  return {
    id: `trait-${id}` as CharacterTrait['id'],
    name: id,
    description: id,
    pointProfile: {
      type: 'DEBUFF',
      positiveEffect: null,
      negativeEffect: '负面效果',
      buffPoints: 0,
      debuffPoints: points,
      positiveBalance: null,
      negativeBalance,
    },
  };
}

function declaration(patch: Partial<TraitEffectBalanceDeclaration>): TraitEffectBalanceDeclaration {
  return {
    ...DEFAULT_TRAIT_EFFECT_BALANCE_DECLARATION,
    ...patch,
  };
}
