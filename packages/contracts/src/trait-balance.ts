export const TRAIT_FREQUENCIES = ['RARE', 'OCCASIONAL', 'COMMON', 'CONSTANT'] as const;
export const TRAIT_ENVIRONMENT_SCOPES = ['SINGLE_SCENE', 'LIMITED', 'BROAD', 'UNIVERSAL'] as const;
export const TRAIT_IMPACT_LEVELS = ['NONE', 'MINOR', 'MAJOR', 'DOMINANT'] as const;
export const TRAIT_PERMANENCE_LEVELS = ['MOMENTARY', 'SCENE', 'PERSISTENT', 'PERMANENT'] as const;
export const TRAIT_AVOIDABILITY_LEVELS = ['EASY', 'COSTLY', 'HARD', 'IMPOSSIBLE'] as const;
export const TRAIT_EFFECT_RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'UNIQUE'] as const;
export const TRAIT_CONDITION_SCOPES = ['STRICT', 'SPECIFIC', 'BROAD', 'UNCONDITIONAL'] as const;
export const TRAIT_BALANCE_DIMENSIONS = [
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
] as const;
export const TRAIT_BALANCE_POLICY_VERSION = 1 as const;

export type TraitFrequency = (typeof TRAIT_FREQUENCIES)[number];
export type TraitEnvironmentScope = (typeof TRAIT_ENVIRONMENT_SCOPES)[number];
export type TraitImpactLevel = (typeof TRAIT_IMPACT_LEVELS)[number];
export type TraitPermanence = (typeof TRAIT_PERMANENCE_LEVELS)[number];
export type TraitAvoidability = (typeof TRAIT_AVOIDABILITY_LEVELS)[number];
export type TraitEffectRarity = (typeof TRAIT_EFFECT_RARITIES)[number];
export type TraitConditionScope = (typeof TRAIT_CONDITION_SCOPES)[number];
export type TraitBalanceDimension = (typeof TRAIT_BALANCE_DIMENSIONS)[number];
export type TraitBalanceSide = 'POSITIVE' | 'NEGATIVE';

export interface TraitEffectBalanceDeclaration {
  readonly frequency: TraitFrequency;
  readonly environment: TraitEnvironmentScope;
  readonly combat: TraitImpactLevel;
  readonly social: TraitImpactLevel;
  readonly narrative: TraitImpactLevel;
  readonly economy: TraitImpactLevel;
  readonly permanence: TraitPermanence;
  readonly avoidability: TraitAvoidability;
  readonly rarity: TraitEffectRarity;
  readonly condition: TraitConditionScope;
  readonly mechanicTags: readonly string[];
  readonly grantsTags: readonly string[];
  readonly requiresTags: readonly string[];
  readonly neutralizesTags: readonly string[];
}

export const DEFAULT_TRAIT_EFFECT_BALANCE_DECLARATION: TraitEffectBalanceDeclaration =
  createTraitEffectBalanceDeclaration({
    frequency: 'RARE',
    environment: 'SINGLE_SCENE',
    combat: 'MINOR',
    social: 'NONE',
    narrative: 'NONE',
    economy: 'NONE',
    permanence: 'MOMENTARY',
    avoidability: 'EASY',
    rarity: 'COMMON',
    condition: 'STRICT',
    mechanicTags: ['通用'],
    grantsTags: [],
    requiresTags: ['特定条件'],
    neutralizesTags: [],
  });

export interface TraitDimensionBreakdown {
  readonly frequency: number;
  readonly environment: number;
  readonly combat: number;
  readonly social: number;
  readonly narrative: number;
  readonly economy: number;
  readonly permanence: number;
  readonly avoidability: number;
  readonly rarity: number;
  readonly condition: number;
}

export interface TraitEffectBalanceEvaluation {
  readonly traitId: string;
  readonly side: TraitBalanceSide;
  readonly assignedPoints: number;
  readonly recommendedPoints: number;
  readonly totalScore: number;
  readonly dimensions: TraitDimensionBreakdown;
}

export interface TraitValidationIssue {
  readonly code:
    | 'BALANCE_DECLARATION_MISSING'
    | 'POINT_TIER_MISMATCH'
    | 'DRAWBACK_NEUTRALIZED'
    | 'CONDITION_BYPASS'
    | 'POSITIVE_FEEDBACK_LOOP';
  readonly traitIds: readonly string[];
  readonly targetPaths: readonly string[];
  readonly message: string;
}

export interface TraitBalanceReport {
  readonly kind: 'TRAIT_BALANCE_REPORT';
  readonly policyVersion: 1;
  readonly worldRuleKey: string;
  readonly evaluations: readonly TraitEffectBalanceEvaluation[];
  readonly issues: readonly TraitValidationIssue[];
  readonly valid: boolean;
}

export interface TraitSynergyReport {
  readonly kind: 'TRAIT_SYNERGY_REPORT';
  readonly policyVersion: 1;
  readonly worldRuleKey: string;
  readonly issues: readonly TraitValidationIssue[];
  readonly valid: boolean;
}

export interface TraitGenerationFeedback {
  readonly kind: 'TRAIT_GENERATION_FEEDBACK';
  readonly policyVersion: 1;
  readonly worldRuleKey: string;
  readonly accepted: boolean;
  readonly issues: readonly TraitValidationIssue[];
}

export class TraitBalanceError extends Error {
  public readonly code: 'TRAIT_BALANCE_DECLARATION_INVALID' | 'TRAIT_BALANCE_REJECTED';
  public readonly issues: readonly TraitValidationIssue[];

  public constructor(
    code: 'TRAIT_BALANCE_DECLARATION_INVALID' | 'TRAIT_BALANCE_REJECTED',
    message: string,
    options?: ErrorOptions & { readonly issues?: readonly TraitValidationIssue[] },
  ) {
    super(message, options);
    this.name = 'TraitBalanceError';
    this.code = code;
    this.issues = Object.freeze([...(options?.issues ?? [])]);
  }
}

export function createTraitEffectBalanceDeclaration(
  value: unknown,
  label = 'Trait effect balance declaration',
): TraitEffectBalanceDeclaration {
  const record = requireRecord(value, label);
  requireExactKeys(
    record,
    [
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
      'mechanicTags',
      'grantsTags',
      'requiresTags',
      'neutralizesTags',
    ],
    label,
  );
  const declaration = {
    frequency: member(record['frequency'], TRAIT_FREQUENCIES, `${label}.frequency`),
    environment: member(record['environment'], TRAIT_ENVIRONMENT_SCOPES, `${label}.environment`),
    combat: member(record['combat'], TRAIT_IMPACT_LEVELS, `${label}.combat`),
    social: member(record['social'], TRAIT_IMPACT_LEVELS, `${label}.social`),
    narrative: member(record['narrative'], TRAIT_IMPACT_LEVELS, `${label}.narrative`),
    economy: member(record['economy'], TRAIT_IMPACT_LEVELS, `${label}.economy`),
    permanence: member(record['permanence'], TRAIT_PERMANENCE_LEVELS, `${label}.permanence`),
    avoidability: member(
      record['avoidability'],
      TRAIT_AVOIDABILITY_LEVELS,
      `${label}.avoidability`,
    ),
    rarity: member(record['rarity'], TRAIT_EFFECT_RARITIES, `${label}.rarity`),
    condition: member(record['condition'], TRAIT_CONDITION_SCOPES, `${label}.condition`),
    mechanicTags: tags(record['mechanicTags'], `${label}.mechanicTags`, false),
    grantsTags: tags(record['grantsTags'], `${label}.grantsTags`, true),
    requiresTags: tags(record['requiresTags'], `${label}.requiresTags`, true),
    neutralizesTags: tags(record['neutralizesTags'], `${label}.neutralizesTags`, true),
  } satisfies TraitEffectBalanceDeclaration;
  if (
    declaration.combat === 'NONE' &&
    declaration.social === 'NONE' &&
    declaration.narrative === 'NONE' &&
    declaration.economy === 'NONE'
  ) {
    invalid(`${label} must affect at least one play domain`);
  }
  if ((declaration.condition === 'UNCONDITIONAL') !== (declaration.requiresTags.length === 0)) {
    invalid(`${label} condition and requiresTags disagree`);
  }
  return Object.freeze(declaration);
}

export function traitDimensionBreakdown(
  declaration: TraitEffectBalanceDeclaration,
): TraitDimensionBreakdown {
  const canonical = createTraitEffectBalanceDeclaration(declaration);
  return Object.freeze({
    frequency: TRAIT_FREQUENCIES.indexOf(canonical.frequency),
    environment: TRAIT_ENVIRONMENT_SCOPES.indexOf(canonical.environment),
    combat: TRAIT_IMPACT_LEVELS.indexOf(canonical.combat),
    social: TRAIT_IMPACT_LEVELS.indexOf(canonical.social),
    narrative: TRAIT_IMPACT_LEVELS.indexOf(canonical.narrative),
    economy: TRAIT_IMPACT_LEVELS.indexOf(canonical.economy),
    permanence: TRAIT_PERMANENCE_LEVELS.indexOf(canonical.permanence),
    avoidability: TRAIT_AVOIDABILITY_LEVELS.indexOf(canonical.avoidability),
    rarity: TRAIT_EFFECT_RARITIES.indexOf(canonical.rarity),
    condition: TRAIT_CONDITION_SCOPES.indexOf(canonical.condition),
  });
}

export function recommendedTraitPoints(declaration: TraitEffectBalanceDeclaration): number {
  const dimensions = traitDimensionBreakdown(declaration);
  const total = TRAIT_BALANCE_DIMENSIONS.reduce((sum, dimension) => sum + dimensions[dimension], 0);
  return Math.min(5, Math.floor(total / 6) + 1);
}

export function traitBalanceScore(declaration: TraitEffectBalanceDeclaration): number {
  const dimensions = traitDimensionBreakdown(declaration);
  return TRAIT_BALANCE_DIMENSIONS.reduce((sum, dimension) => sum + dimensions[dimension], 0);
}

export function createTraitWorldRuleKey(scope: string, revision: number): string {
  if (
    scope.trim() !== scope ||
    scope.length === 0 ||
    scope.length > 240 ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  ) {
    invalid('Trait world rule identity is invalid');
  }
  return `${scope}@${revision}`;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(record).sort();
  const canonical = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(canonical)) {
    invalid(`${label} fields are invalid`);
  }
}

function member<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string,
): Values[number] {
  if (!values.includes(value as Values[number])) invalid(`${label} is invalid`);
  return value as Values[number];
}

function tags(value: unknown, label: string, allowEmpty: boolean): readonly string[] {
  if (!Array.isArray(value) || value.length > 8 || (!allowEmpty && value.length === 0)) {
    invalid(`${label} must contain ${allowEmpty ? 'zero to eight' : 'one to eight'} tags`);
  }
  const result = value.map((entry) => {
    if (
      typeof entry !== 'string' ||
      entry.trim() !== entry ||
      entry.length === 0 ||
      [...entry].length > 48 ||
      !/^[\p{L}\p{N}_-]+$/u.test(entry)
    ) {
      invalid(`${label} contains an invalid tag`);
    }
    return entry;
  });
  if (new Set(result).size !== result.length) invalid(`${label} contains duplicate tags`);
  return Object.freeze(
    [...result].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

function invalid(message: string): never {
  throw new TraitBalanceError('TRAIT_BALANCE_DECLARATION_INVALID', message);
}
