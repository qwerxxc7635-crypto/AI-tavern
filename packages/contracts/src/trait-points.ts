import {
  TraitBalanceError,
  TRAIT_BALANCE_POLICY_VERSION,
  createTraitEffectBalanceDeclaration,
  recommendedTraitPoints,
  traitBalanceScore,
  traitDimensionBreakdown,
  type TraitBalanceReport,
  type TraitBalanceSide,
  type TraitEffectBalanceDeclaration,
  type TraitEffectBalanceEvaluation,
  type TraitGenerationFeedback,
  type TraitSynergyReport,
  type TraitValidationIssue,
} from './trait-balance.js';

export const CHARACTER_TRAIT_TYPES = ['BUFF', 'DEBUFF', 'MIXED', 'NARRATIVE'] as const;
export type CharacterTraitType = (typeof CHARACTER_TRAIT_TYPES)[number];

export interface TraitPointProfile {
  readonly type: CharacterTraitType;
  readonly positiveEffect: string | null;
  readonly negativeEffect: string | null;
  readonly buffPoints: number;
  readonly debuffPoints: number;
  readonly positiveBalance?: TraitEffectBalanceDeclaration | null;
  readonly negativeBalance?: TraitEffectBalanceDeclaration | null;
}

export const NARRATIVE_TRAIT_POINT_PROFILE: TraitPointProfile = Object.freeze({
  type: 'NARRATIVE',
  positiveEffect: null,
  negativeEffect: null,
  buffPoints: 0,
  debuffPoints: 0,
});

export class TraitPointError extends Error {
  public readonly code: 'TRAIT_POINT_PROFILE_INVALID' | 'TRAIT_POINTS_UNBALANCED';

  public constructor(
    code: 'TRAIT_POINT_PROFILE_INVALID' | 'TRAIT_POINTS_UNBALANCED',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'TraitPointError';
    this.code = code;
  }
}

export function createTraitPointProfile(value: unknown): TraitPointProfile {
  if (value === undefined || value === null) return NARRATIVE_TRAIT_POINT_PROFILE;
  const record = requireRecord(value);
  const baseKeys = [
    'type',
    'positiveEffect',
    'negativeEffect',
    'buffPoints',
    'debuffPoints',
  ] as const;
  const hasPositiveBalance = Object.hasOwn(record, 'positiveBalance');
  const hasNegativeBalance = Object.hasOwn(record, 'negativeBalance');
  requireProfileKeys(record, baseKeys, ['positiveBalance', 'negativeBalance']);
  const type = requireType(record['type']);
  const positiveEffect = optionalEffect(record['positiveEffect'], 'positiveEffect');
  const negativeEffect = optionalEffect(record['negativeEffect'], 'negativeEffect');
  const buffPoints = integer(record['buffPoints'], 'buffPoints');
  const debuffPoints = integer(record['debuffPoints'], 'debuffPoints');
  const positiveBalance = hasPositiveBalance
    ? optionalBalance(record['positiveBalance'], 'positiveBalance')
    : undefined;
  const negativeBalance = hasNegativeBalance
    ? optionalBalance(record['negativeBalance'], 'negativeBalance')
    : undefined;

  switch (type) {
    case 'BUFF':
      if (
        positiveEffect === null ||
        negativeEffect !== null ||
        buffPoints < -5 ||
        buffPoints > -1 ||
        debuffPoints !== 0
      ) {
        invalid('Buff Trait requires one positive effect and -1 to -5 points');
      }
      if (negativeBalance !== undefined && negativeBalance !== null) {
        invalid('Buff Trait cannot declare negative balance dimensions');
      }
      break;
    case 'DEBUFF':
      if (
        positiveEffect !== null ||
        negativeEffect === null ||
        buffPoints !== 0 ||
        debuffPoints < 1 ||
        debuffPoints > 5
      ) {
        invalid('Debuff Trait requires one negative effect and +1 to +5 points');
      }
      if (positiveBalance !== undefined && positiveBalance !== null) {
        invalid('Debuff Trait cannot declare positive balance dimensions');
      }
      break;
    case 'MIXED':
      if (
        positiveEffect === null ||
        negativeEffect === null ||
        buffPoints < -5 ||
        buffPoints > -1 ||
        debuffPoints < 1 ||
        debuffPoints > 5
      ) {
        invalid('Mixed Trait requires separate positive and negative effects');
      }
      break;
    case 'NARRATIVE':
      if (
        positiveEffect !== null ||
        negativeEffect !== null ||
        buffPoints !== 0 ||
        debuffPoints !== 0
      ) {
        invalid('Narrative Trait cannot have rule effects or points');
      }
      if (
        (positiveBalance !== undefined && positiveBalance !== null) ||
        (negativeBalance !== undefined && negativeBalance !== null)
      ) {
        invalid('Narrative Trait cannot declare mechanical balance dimensions');
      }
      break;
  }
  const profile = { type, positiveEffect, negativeEffect, buffPoints, debuffPoints };
  return Object.freeze({
    ...profile,
    ...(hasPositiveBalance ? { positiveBalance: positiveBalance ?? null } : {}),
    ...(hasNegativeBalance ? { negativeBalance: negativeBalance ?? null } : {}),
  });
}

export function traitPointNet(value: unknown): number {
  const profile = createTraitPointProfile(value);
  return profile.buffPoints + profile.debuffPoints;
}

export function characterTraitPointNet(
  traits: readonly { readonly pointProfile?: TraitPointProfile | null }[],
): number {
  return traits.reduce((total, trait) => total + traitPointNet(trait.pointProfile), 0);
}

export function assertBalancedCharacterTraitPoints(
  traits: readonly { readonly pointProfile?: TraitPointProfile | null }[],
): void {
  const net = characterTraitPointNet(traits);
  if (net !== 0) {
    throw new TraitPointError(
      'TRAIT_POINTS_UNBALANCED',
      `Character Trait points must equal exactly zero; received ${net}`,
    );
  }
}

export function evaluateCharacterTraitBalance(
  traits: readonly {
    readonly id: string;
    readonly pointProfile?: TraitPointProfile | null;
  }[],
  worldRuleKey: string,
): TraitBalanceReport {
  requireWorldRuleKey(worldRuleKey);
  const evaluations: TraitEffectBalanceEvaluation[] = [];
  const issues: TraitValidationIssue[] = [];
  traits.forEach((trait, index) => {
    const profile = createTraitPointProfile(trait.pointProfile);
    if (profile.type === 'BUFF' || profile.type === 'MIXED') {
      evaluateEffect(
        trait.id,
        index,
        'POSITIVE',
        -profile.buffPoints,
        profile.positiveBalance,
        evaluations,
        issues,
      );
    }
    if (profile.type === 'DEBUFF' || profile.type === 'MIXED') {
      evaluateEffect(
        trait.id,
        index,
        'NEGATIVE',
        profile.debuffPoints,
        profile.negativeBalance,
        evaluations,
        issues,
      );
    }
  });
  return Object.freeze({
    kind: 'TRAIT_BALANCE_REPORT',
    policyVersion: TRAIT_BALANCE_POLICY_VERSION,
    worldRuleKey,
    evaluations: Object.freeze(evaluations),
    issues: Object.freeze(issues),
    valid: issues.length === 0,
  });
}

export function evaluateCharacterTraitSynergy(
  traits: readonly {
    readonly id: string;
    readonly pointProfile?: TraitPointProfile | null;
  }[],
  worldRuleKey: string,
): TraitSynergyReport {
  requireWorldRuleKey(worldRuleKey);
  const positive: EffectNode[] = [];
  const negative: EffectNode[] = [];
  traits.forEach((trait, index) => {
    const profile = createTraitPointProfile(trait.pointProfile);
    if (profile.positiveBalance !== undefined && profile.positiveBalance !== null) {
      positive.push(effectNode(trait.id, index, 'POSITIVE', profile.positiveBalance));
    }
    if (profile.negativeBalance !== undefined && profile.negativeBalance !== null) {
      negative.push(effectNode(trait.id, index, 'NEGATIVE', profile.negativeBalance));
    }
  });
  const issues: TraitValidationIssue[] = [];
  for (const benefit of positive) {
    for (const drawback of negative) {
      const neutralized = intersection(
        benefit.declaration.neutralizesTags,
        drawback.declaration.mechanicTags,
      );
      if (neutralized.length > 0) {
        issues.push(
          issue(
            'DRAWBACK_NEUTRALIZED',
            [benefit.traitId, drawback.traitId],
            [`${benefit.path}.neutralizesTags`, `${drawback.path}.mechanicTags`],
            `Positive effect neutralizes drawback tags: ${neutralized.join(', ')}`,
          ),
        );
      }
    }
    const granted = new Set(positive.flatMap(({ declaration }) => declaration.grantsTags));
    const bypassed = benefit.declaration.requiresTags.filter((tag) => granted.has(tag));
    const unconditionalTier = recommendedTraitPoints({
      ...benefit.declaration,
      condition: 'UNCONDITIONAL',
      requiresTags: [],
    });
    if (bypassed.length > 0 && unconditionalTier > recommendedTraitPoints(benefit.declaration)) {
      issues.push(
        issue(
          'CONDITION_BYPASS',
          [benefit.traitId],
          [`${benefit.path}.requiresTags`],
          `Positive condition is supplied by another positive effect: ${bypassed.join(', ')}`,
        ),
      );
    }
  }
  for (let left = 0; left < positive.length; left += 1) {
    for (let right = left + 1; right < positive.length; right += 1) {
      const first = positive[left];
      const second = positive[right];
      if (first === undefined || second === undefined) continue;
      if (
        intersection(first.declaration.grantsTags, second.declaration.requiresTags).length > 0 &&
        intersection(second.declaration.grantsTags, first.declaration.requiresTags).length > 0
      ) {
        issues.push(
          issue(
            'POSITIVE_FEEDBACK_LOOP',
            [first.traitId, second.traitId],
            [`${first.path}.grantsTags`, `${second.path}.grantsTags`],
            'Positive effects form a self-sustaining activation loop',
          ),
        );
      }
    }
  }
  return Object.freeze({
    kind: 'TRAIT_SYNERGY_REPORT',
    policyVersion: TRAIT_BALANCE_POLICY_VERSION,
    worldRuleKey,
    issues: Object.freeze(issues),
    valid: issues.length === 0,
  });
}

export function assertCharacterTraitBalanceAndSynergy(
  traits: readonly {
    readonly id: string;
    readonly pointProfile?: TraitPointProfile | null;
  }[],
  worldRuleKey: string,
): void {
  const balance = evaluateCharacterTraitBalance(traits, worldRuleKey);
  const synergy = evaluateCharacterTraitSynergy(traits, worldRuleKey);
  const issues = [...balance.issues, ...synergy.issues];
  if (issues.length > 0) {
    throw new TraitBalanceError(
      'TRAIT_BALANCE_REJECTED',
      `Character Trait balance rejected with ${issues.length} explainable issue(s)`,
      { issues },
    );
  }
}

export function buildTraitGenerationFeedback(
  balance: TraitBalanceReport,
  synergy: TraitSynergyReport,
): TraitGenerationFeedback {
  if (balance.worldRuleKey !== synergy.worldRuleKey) {
    throw new TraitBalanceError(
      'TRAIT_BALANCE_DECLARATION_INVALID',
      'Trait reports use different world rules',
    );
  }
  const issues = Object.freeze([...balance.issues, ...synergy.issues]);
  return Object.freeze({
    kind: 'TRAIT_GENERATION_FEEDBACK',
    policyVersion: TRAIT_BALANCE_POLICY_VERSION,
    worldRuleKey: balance.worldRuleKey,
    accepted: issues.length === 0,
    issues,
  });
}

interface EffectNode {
  readonly traitId: string;
  readonly side: TraitBalanceSide;
  readonly path: string;
  readonly declaration: TraitEffectBalanceDeclaration;
}

function evaluateEffect(
  traitId: string,
  index: number,
  side: TraitBalanceSide,
  assignedPoints: number,
  declaration: TraitEffectBalanceDeclaration | null | undefined,
  evaluations: TraitEffectBalanceEvaluation[],
  issues: TraitValidationIssue[],
): void {
  const path = `traits.${index}.pointProfile.${side === 'POSITIVE' ? 'positiveBalance' : 'negativeBalance'}`;
  if (declaration === undefined || declaration === null) {
    issues.push(
      issue(
        'BALANCE_DECLARATION_MISSING',
        [traitId],
        [path],
        `${side === 'POSITIVE' ? 'Positive' : 'Negative'} effect lacks ten-dimension evidence`,
      ),
    );
    return;
  }
  const recommendedPoints = recommendedTraitPoints(declaration);
  evaluations.push(
    Object.freeze({
      traitId,
      side,
      assignedPoints,
      recommendedPoints,
      totalScore: traitBalanceScore(declaration),
      dimensions: traitDimensionBreakdown(declaration),
    }),
  );
  if (assignedPoints !== recommendedPoints) {
    issues.push(
      issue(
        'POINT_TIER_MISMATCH',
        [traitId],
        [path],
        `${side === 'POSITIVE' ? 'Buff cost' : 'Debuff credit'} ${assignedPoints} must equal transparent tier ${recommendedPoints}`,
      ),
    );
  }
}

function effectNode(
  traitId: string,
  index: number,
  side: TraitBalanceSide,
  declaration: TraitEffectBalanceDeclaration,
): EffectNode {
  return Object.freeze({
    traitId,
    side,
    path: `traits.${index}.pointProfile.${side === 'POSITIVE' ? 'positiveBalance' : 'negativeBalance'}`,
    declaration,
  });
}

function issue(
  code: TraitValidationIssue['code'],
  traitIds: readonly string[],
  targetPaths: readonly string[],
  message: string,
): TraitValidationIssue {
  return Object.freeze({
    code,
    traitIds: Object.freeze([...new Set(traitIds)]),
    targetPaths: Object.freeze([...targetPaths]),
    message,
  });
}

function intersection(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightSet = new Set(right);
  return Object.freeze(left.filter((value) => rightSet.has(value)));
}

function optionalBalance(value: unknown, label: string): TraitEffectBalanceDeclaration | null {
  return value === null ? null : createTraitEffectBalanceDeclaration(value, label);
}

function requireWorldRuleKey(value: string): void {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > 256
  ) {
    throw new TraitBalanceError(
      'TRAIT_BALANCE_DECLARATION_INVALID',
      'Trait world rule key is invalid',
    );
  }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid('Trait point profile must be an object');
  }
  return value as Record<string, unknown>;
}

function requireProfileKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): void {
  const actual = Object.keys(record);
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    actual.some((key) => !allowed.has(key))
  ) {
    invalid('Trait point profile fields are invalid');
  }
}

function requireType(value: unknown): CharacterTraitType {
  if (!CHARACTER_TRAIT_TYPES.includes(value as CharacterTraitType)) {
    invalid('Trait point type is invalid');
  }
  return value as CharacterTraitType;
}

function optionalEffect(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > 4_000
  ) {
    invalid(`${label} must be null or bounded text without surrounding whitespace`);
  }
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) invalid(`${label} must be a safe integer`);
  return value as number;
}

function invalid(message: string): never {
  throw new TraitPointError('TRAIT_POINT_PROFILE_INVALID', message);
}
