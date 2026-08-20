import { CLASS_ARCHETYPES, type ClassArchetype } from './character.js';
import {
  campaignId,
  careerId,
  generationRecordId,
  isoTimestamp,
  type CampaignId,
  type CareerId,
  type GenerationRecordId,
  type IsoTimestamp,
} from './foundation.js';
import type { WorldConstitutionContent } from './world.js';

export const CAREER_RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'SPECIAL'] as const;
export type CareerRarity = (typeof CAREER_RARITIES)[number];

export const CAREER_SOURCES = [
  'INITIAL_GENERATION',
  'RUNTIME_DISCOVERY',
  'LEGACY_MAPPING',
] as const;
export type CareerSource = (typeof CAREER_SOURCES)[number];

export interface CareerConstitutionEvidence {
  readonly careerRules: string;
  readonly society: string;
  readonly technology: string;
  readonly economy: string;
}

export interface CareerDefinition {
  readonly kind: 'CAREER_DEFINITION';
  readonly schemaVersion: 1;
  readonly id: CareerId;
  readonly campaignId: CampaignId;
  readonly constitutionRevision: number;
  readonly name: string;
  readonly rarity: CareerRarity;
  readonly role: string;
  readonly skills: readonly string[];
  readonly equipmentTags: readonly string[];
  readonly socialPosition: string;
  readonly relationshipHooks: readonly string[];
  readonly risks: readonly string[];
  readonly requirements: readonly string[];
  readonly constitutionEvidence: CareerConstitutionEvidence;
  readonly legacyArchetype: ClassArchetype;
  readonly source: CareerSource;
  readonly generationRecordId: GenerationRecordId | null;
  readonly createdAt: IsoTimestamp;
}

export interface CareerPool {
  readonly kind: 'CAREER_POOL';
  readonly schemaVersion: 1;
  readonly campaignId: CampaignId;
  readonly constitutionRevision: number;
  readonly careers: readonly CareerDefinition[];
  readonly revision: number;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface CareerCandidate {
  readonly id: string;
  readonly name: string;
  readonly rarity: CareerRarity;
  readonly role: string;
  readonly skills: readonly string[];
  readonly equipmentTags: readonly string[];
  readonly socialPosition: string;
  readonly relationshipHooks: readonly string[];
  readonly risks: readonly string[];
  readonly requirements: readonly string[];
  readonly constitutionEvidence: CareerConstitutionEvidence;
  readonly legacyArchetype: ClassArchetype;
}

export class CareerContractError extends Error {
  public constructor(
    public readonly code: 'CAREER_STRUCTURE_INVALID' | 'CAREER_POOL_INVALID' | 'CAREER_DUPLICATE',
    public readonly path: string,
    options?: ErrorOptions,
  ) {
    super('Career contract validation failed', options);
    this.name = 'CareerContractError';
  }
}

export function createCareerDefinition(
  input: Omit<
    CareerDefinition,
    'kind' | 'id' | 'campaignId' | 'generationRecordId' | 'createdAt'
  > & {
    readonly id: string;
    readonly campaignId: string;
    readonly generationRecordId: string | null;
    readonly createdAt: string;
  },
): CareerDefinition {
  if (input.schemaVersion !== 1) invalid('schemaVersion');
  const id = careerId(input.id);
  const campaign = campaignId(input.campaignId);
  requirePositiveInteger(input.constitutionRevision, 'constitutionRevision');
  if (!CAREER_RARITIES.includes(input.rarity)) invalid('rarity');
  if (!CLASS_ARCHETYPES.includes(input.legacyArchetype)) invalid('legacyArchetype');
  if (!CAREER_SOURCES.includes(input.source)) invalid('source');
  const generation =
    input.generationRecordId === null ? null : generationRecordId(input.generationRecordId);
  if (input.source === 'LEGACY_MAPPING' && generation !== null) invalid('generationRecordId');
  if (input.source !== 'LEGACY_MAPPING' && generation === null) invalid('generationRecordId');
  return Object.freeze({
    ...input,
    kind: 'CAREER_DEFINITION',
    id,
    campaignId: campaign,
    name: requireText(input.name, 'name', 120),
    role: requireText(input.role, 'role', 4_000),
    skills: freezeList(input.skills, 'skills', 24, true),
    equipmentTags: freezeList(input.equipmentTags, 'equipmentTags', 24, false),
    socialPosition: requireText(input.socialPosition, 'socialPosition', 4_000),
    relationshipHooks: freezeList(input.relationshipHooks, 'relationshipHooks', 24, true),
    risks: freezeList(input.risks, 'risks', 24, true),
    requirements: freezeList(input.requirements, 'requirements', 24, true),
    constitutionEvidence: freezeEvidence(input.constitutionEvidence),
    generationRecordId: generation,
    createdAt: isoTimestamp(input.createdAt),
  });
}

export function createCareerPool(input: Omit<CareerPool, 'kind'>): CareerPool {
  if (input.schemaVersion !== 1) poolInvalid('schemaVersion');
  requirePositiveInteger(input.constitutionRevision, 'constitutionRevision', true);
  requirePositiveInteger(input.revision, 'revision', true);
  const campaign = campaignId(input.campaignId);
  const careers = input.careers.map((career, index) => {
    const canonical = createCareerDefinition(career);
    if (
      canonical.campaignId !== campaign ||
      canonical.constitutionRevision !== input.constitutionRevision
    ) {
      poolInvalid(`careers[${index}].constitutionRevision`);
    }
    return canonical;
  });
  if (careers.length === 0 || careers.length > 64) poolInvalid('careers');
  requireUnique(
    careers.map(({ id }) => id),
    'careers.id',
  );
  requireUnique(
    careers.map(({ name }) => normalizeCareerName(name)),
    'careers.name',
  );
  const createdAt = isoTimestamp(input.createdAt);
  const updatedAt = isoTimestamp(input.updatedAt);
  if (updatedAt < createdAt) poolInvalid('updatedAt');
  return Object.freeze({
    ...input,
    kind: 'CAREER_POOL',
    campaignId: campaign,
    careers: Object.freeze(careers),
    createdAt,
    updatedAt,
  });
}

export function appendCareerPool(
  pool: CareerPool,
  additions: readonly CareerDefinition[],
  updatedAt: IsoTimestamp,
): CareerPool {
  if (additions.length === 0) poolInvalid('additions');
  return createCareerPool({
    ...pool,
    careers: [...pool.careers, ...additions],
    revision: pool.revision + 1,
    updatedAt,
  });
}

export function parseCareerPool(value: unknown): CareerPool {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) poolInvalid('pool');
    const row = value as Record<string, unknown>;
    if (!Array.isArray(row['careers'])) poolInvalid('careers');
    return createCareerPool({
      schemaVersion: row['schemaVersion'] as 1,
      campaignId: row['campaignId'] as CampaignId,
      constitutionRevision: row['constitutionRevision'] as number,
      careers: row['careers'] as readonly CareerDefinition[],
      revision: row['revision'] as number,
      createdAt: row['createdAt'] as IsoTimestamp,
      updatedAt: row['updatedAt'] as IsoTimestamp,
    });
  } catch (error) {
    if (error instanceof CareerContractError) throw error;
    throw new CareerContractError('CAREER_POOL_INVALID', 'pool', { cause: error });
  }
}

export function careerEvidenceFor(
  constitution: WorldConstitutionContent,
): CareerConstitutionEvidence {
  return Object.freeze({
    careerRules: constitution.careerRules,
    society: constitution.society,
    technology: constitution.technology,
    economy: constitution.economy,
  });
}

export function normalizeCareerName(value: string): string {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      if (codePoint === 0x3000) return ' ';
      if (codePoint !== undefined && codePoint >= 0xff01 && codePoint <= 0xff5e) {
        return String.fromCodePoint(codePoint - 0xfee0);
      }
      return character;
    })
    .join('')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase();
}

function freezeEvidence(value: CareerConstitutionEvidence): CareerConstitutionEvidence {
  return Object.freeze({
    careerRules: requireText(value.careerRules, 'constitutionEvidence.careerRules', 4_000),
    society: requireText(value.society, 'constitutionEvidence.society', 4_000),
    technology: requireText(value.technology, 'constitutionEvidence.technology', 4_000),
    economy: requireText(value.economy, 'constitutionEvidence.economy', 4_000),
  });
}

function freezeList(
  values: readonly string[],
  path: string,
  maxItems: number,
  required: boolean,
): readonly string[] {
  if (!Array.isArray(values) || values.length > maxItems || (required && values.length === 0)) {
    invalid(path);
  }
  const result = values.map((value, index) => requireText(value, `${path}[${index}]`, 200));
  requireUnique(result.map(normalizeCareerName), path);
  return Object.freeze(result);
}

function requireText(value: string, path: string, maxLength: number): string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length === 0 ||
    [...value].length > maxLength
  ) {
    invalid(path);
  }
  return value;
}

function requirePositiveInteger(value: number, path: string, pool = false): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    if (pool) poolInvalid(path);
    invalid(path);
  }
}

function requireUnique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) {
    throw new CareerContractError('CAREER_DUPLICATE', path);
  }
}

function invalid(path: string): never {
  throw new CareerContractError('CAREER_STRUCTURE_INVALID', path);
}

function poolInvalid(path: string): never {
  throw new CareerContractError('CAREER_POOL_INVALID', path);
}
