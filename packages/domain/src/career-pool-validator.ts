import {
  CAREER_RARITIES,
  careerEvidenceFor,
  createCareerDefinition,
  createCareerPool,
  normalizeCareerName,
  type CampaignId,
  type CareerCandidate,
  type CareerDefinition,
  type CareerPool,
  type CareerRarity,
  type CareerSource,
  type GenerationRecordId,
  type IsoTimestamp,
  type WorldConstitution,
} from '@ember-tavern/contracts';

import { assertConstitutionBinding } from './world-constitution-validator.js';

export interface CareerGenerationPolicy {
  readonly mode: 'INITIAL' | 'RUNTIME_DISCOVERY';
  readonly requestedRarities: readonly CareerRarity[];
}

export class CareerPoolRuleError extends Error {
  public constructor(
    public readonly code:
      | 'CAREER_COUNT_MISMATCH'
      | 'CAREER_RARITY_MISMATCH'
      | 'CAREER_CONSTITUTION_MISMATCH'
      | 'CAREER_DUPLICATE'
      | 'CAREER_POOL_REQUIRED'
      | 'CAREER_REFERENCE_INVALID',
    public readonly paths: readonly string[],
    options?: ErrorOptions,
  ) {
    super('Career pool rules rejected the proposal', options);
    this.name = 'CareerPoolRuleError';
  }
}

export function createInitialCareerPool(input: {
  readonly constitution: WorldConstitution;
  readonly candidates: readonly CareerCandidate[];
  readonly policy: CareerGenerationPolicy;
  readonly generationRecordId: GenerationRecordId;
  readonly at: IsoTimestamp;
}): CareerPool {
  if (input.policy.mode !== 'INITIAL') {
    throw new CareerPoolRuleError('CAREER_POOL_REQUIRED', ['policy.mode']);
  }
  const careers = validateCareerCandidates({
    constitution: input.constitution,
    existing: [],
    candidates: input.candidates,
    policy: input.policy,
    generationRecordId: input.generationRecordId,
    source: 'INITIAL_GENERATION',
    at: input.at,
  });
  return createCareerPool({
    schemaVersion: 1,
    campaignId: input.constitution.campaignId,
    constitutionRevision: input.constitution.revision,
    careers,
    revision: 1,
    createdAt: input.at,
    updatedAt: input.at,
  });
}

export function createRuntimeCareers(input: {
  readonly constitution: WorldConstitution;
  readonly pool: CareerPool;
  readonly candidates: readonly CareerCandidate[];
  readonly policy: CareerGenerationPolicy;
  readonly generationRecordId: GenerationRecordId;
  readonly at: IsoTimestamp;
}): readonly CareerDefinition[] {
  if (input.policy.mode !== 'RUNTIME_DISCOVERY') {
    throw new CareerPoolRuleError('CAREER_POOL_REQUIRED', ['policy.mode']);
  }
  assertConstitutionBinding(input.constitution, input.pool);
  return validateCareerCandidates({
    constitution: input.constitution,
    existing: input.pool.careers,
    candidates: input.candidates,
    policy: input.policy,
    generationRecordId: input.generationRecordId,
    source: 'RUNTIME_DISCOVERY',
    at: input.at,
  });
}

export function requireCareerFromPool(
  pool: CareerPool | null,
  careerReference: {
    readonly id: string | null;
    readonly displayName: string;
    readonly legacyArchetype?: string | null;
  },
): CareerDefinition {
  if (pool === null) throw new CareerPoolRuleError('CAREER_POOL_REQUIRED', ['career']);
  const career = pool.careers.find(({ id }) => id === careerReference.id);
  if (
    career === undefined ||
    career.name !== careerReference.displayName ||
    (careerReference.legacyArchetype !== undefined &&
      career.legacyArchetype !== careerReference.legacyArchetype)
  ) {
    throw new CareerPoolRuleError('CAREER_REFERENCE_INVALID', ['career.id', 'career.displayName']);
  }
  return career;
}

function validateCareerCandidates(input: {
  readonly constitution: WorldConstitution;
  readonly existing: readonly CareerDefinition[];
  readonly candidates: readonly CareerCandidate[];
  readonly policy: CareerGenerationPolicy;
  readonly generationRecordId: GenerationRecordId;
  readonly source: CareerSource;
  readonly at: IsoTimestamp;
}): readonly CareerDefinition[] {
  assertConstitutionBinding(input.constitution, {
    campaignId: input.constitution.campaignId,
    constitutionRevision: input.constitution.revision,
  });
  if (
    input.candidates.length !== input.policy.requestedRarities.length ||
    input.candidates.length === 0
  ) {
    throw new CareerPoolRuleError('CAREER_COUNT_MISMATCH', ['careers']);
  }
  const actualRarities = rarityCounts(input.candidates.map(({ rarity }) => rarity));
  const expectedRarities = rarityCounts(input.policy.requestedRarities);
  if (CAREER_RARITIES.some((rarity) => actualRarities[rarity] !== expectedRarities[rarity])) {
    throw new CareerPoolRuleError('CAREER_RARITY_MISMATCH', ['careers.rarity']);
  }
  const expectedEvidence = careerEvidenceFor(input.constitution);
  const evidencePaths = input.candidates.flatMap((candidate, index) =>
    Object.entries(expectedEvidence)
      .filter(
        ([key, expected]) =>
          candidate.constitutionEvidence[key as keyof typeof expectedEvidence] !== expected,
      )
      .map(([key]) => `careers[${index}].constitutionEvidence.${key}`),
  );
  if (evidencePaths.length > 0) {
    throw new CareerPoolRuleError('CAREER_CONSTITUTION_MISMATCH', Object.freeze(evidencePaths));
  }
  const existingIds = new Set<string>(input.existing.map(({ id }) => id));
  const existingNames = new Set(input.existing.map(({ name }) => normalizeCareerName(name)));
  const proposedIds = new Set<string>();
  const proposedNames = new Set<string>();
  for (const [index, candidate] of input.candidates.entries()) {
    const normalizedName = normalizeCareerName(candidate.name);
    if (
      existingIds.has(candidate.id) ||
      existingNames.has(normalizedName) ||
      proposedIds.has(candidate.id) ||
      proposedNames.has(normalizedName)
    ) {
      throw new CareerPoolRuleError('CAREER_DUPLICATE', [
        `careers[${index}].id`,
        `careers[${index}].name`,
      ]);
    }
    proposedIds.add(candidate.id);
    proposedNames.add(normalizedName);
  }
  return Object.freeze(
    input.candidates.map((candidate) =>
      createCareerDefinition({
        ...candidate,
        schemaVersion: 1,
        campaignId: input.constitution.campaignId,
        constitutionRevision: input.constitution.revision,
        source: input.source,
        generationRecordId: input.generationRecordId,
        createdAt: input.at,
      }),
    ),
  );
}

function rarityCounts(values: readonly CareerRarity[]): Record<CareerRarity, number> {
  const counts: Record<CareerRarity, number> = {
    COMMON: 0,
    UNCOMMON: 0,
    RARE: 0,
    SPECIAL: 0,
  };
  for (const value of values) counts[value] += 1;
  return counts;
}

export function careerPoolCampaign(pool: CareerPool): CampaignId {
  return pool.campaignId;
}
