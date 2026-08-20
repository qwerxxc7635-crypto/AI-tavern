export const CHARACTER_TRAIT_TYPES = ['BUFF', 'DEBUFF', 'MIXED', 'NARRATIVE'] as const;
export type CharacterTraitType = (typeof CHARACTER_TRAIT_TYPES)[number];

export interface TraitPointProfile {
  readonly type: CharacterTraitType;
  readonly positiveEffect: string | null;
  readonly negativeEffect: string | null;
  readonly buffPoints: number;
  readonly debuffPoints: number;
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
  requireExactKeys(record, [
    'type',
    'positiveEffect',
    'negativeEffect',
    'buffPoints',
    'debuffPoints',
  ]);
  const type = requireType(record['type']);
  const positiveEffect = optionalEffect(record['positiveEffect'], 'positiveEffect');
  const negativeEffect = optionalEffect(record['negativeEffect'], 'negativeEffect');
  const buffPoints = integer(record['buffPoints'], 'buffPoints');
  const debuffPoints = integer(record['debuffPoints'], 'debuffPoints');

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
      break;
  }
  return Object.freeze({ type, positiveEffect, negativeEffect, buffPoints, debuffPoints });
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

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid('Trait point profile must be an object');
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(record).sort();
  const canonical = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(canonical)) {
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
