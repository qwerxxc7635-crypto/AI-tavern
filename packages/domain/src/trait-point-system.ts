import {
  assertBalancedCharacterTraitPoints,
  createTraitPointProfile,
  type CharacterTraitId,
  type CharacterTraitType,
  type TraitPointProfile,
} from '@ember-tavern/contracts';

export interface TraitPointBreakdown {
  readonly traitId: CharacterTraitId;
  readonly type: CharacterTraitType;
  readonly buffPoints: number;
  readonly debuffPoints: number;
  readonly netPoints: number;
}

export interface TraitPointEvaluation {
  readonly kind: 'TRAIT_POINT_EVALUATION';
  readonly breakdown: readonly TraitPointBreakdown[];
  readonly netPoints: number;
  readonly balanced: boolean;
}

export function evaluateCharacterTraitPoints(
  traits: readonly {
    readonly id: CharacterTraitId;
    readonly pointProfile?: TraitPointProfile | null;
  }[],
): TraitPointEvaluation {
  const breakdown = traits.map(({ id, pointProfile }) => {
    const profile = createTraitPointProfile(pointProfile);
    return Object.freeze({
      traitId: id,
      type: profile.type,
      buffPoints: profile.buffPoints,
      debuffPoints: profile.debuffPoints,
      netPoints: profile.buffPoints + profile.debuffPoints,
    });
  });
  const netPoints = breakdown.reduce((total, value) => total + value.netPoints, 0);
  return Object.freeze({
    kind: 'TRAIT_POINT_EVALUATION',
    breakdown: Object.freeze(breakdown),
    netPoints,
    balanced: netPoints === 0,
  });
}

export function confirmCharacterTraitPoints(
  traits: readonly {
    readonly id: CharacterTraitId;
    readonly pointProfile?: TraitPointProfile | null;
  }[],
): TraitPointEvaluation {
  const evaluation = evaluateCharacterTraitPoints(traits);
  assertBalancedCharacterTraitPoints(traits);
  return evaluation;
}
