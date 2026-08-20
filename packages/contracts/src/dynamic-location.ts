import {
  campaignId,
  factionId,
  generationRecordId,
  isoTimestamp,
  locationId,
  type CampaignId,
  type FactionId,
  type GenerationRecordId,
  type IsoTimestamp,
  type LocationId,
} from './foundation.js';

export const DYNAMIC_LOCATION_KINDS = [
  'REGION',
  'COUNTRY',
  'CITY',
  'VILLAGE',
  'DISTRICT',
  'TAVERN',
  'SHOP',
  'RUIN',
  'DUNGEON',
  'SPECIAL',
] as const;
export type DynamicLocationKind = (typeof DYNAMIC_LOCATION_KINDS)[number];

export const LOCATION_MATERIALIZATION_LEVELS = ['OUTLINE', 'DETAILED'] as const;
export type LocationMaterializationLevel = (typeof LOCATION_MATERIALIZATION_LEVELS)[number];

export const LOCATION_EXPANSION_MODES = ['CHILDREN', 'CONNECTED'] as const;
export type LocationExpansionMode = (typeof LOCATION_EXPANSION_MODES)[number];

export const LOCATION_TRAVEL_MODES = ['FOOT', 'ROAD', 'WATER', 'MOUNT', 'SPECIAL'] as const;
export type LocationTravelMode = (typeof LOCATION_TRAVEL_MODES)[number];

export interface LocationConstitutionEvidence {
  readonly technology: string;
  readonly magic: string;
  readonly society: string;
  readonly politics: string;
}

export interface DynamicLocationProfile {
  readonly kind: 'DYNAMIC_LOCATION';
  readonly schemaVersion: 1;
  readonly id: LocationId;
  readonly campaignId: CampaignId;
  readonly constitutionRevision: number;
  readonly locationKind: DynamicLocationKind;
  readonly materialization: LocationMaterializationLevel;
  readonly name: string;
  readonly description: string;
  readonly parentLocationId: LocationId | null;
  readonly atmosphere: string | null;
  readonly features: readonly string[];
  readonly factionIds: readonly FactionId[];
  readonly currentSituation: string | null;
  readonly constitutionEvidence: LocationConstitutionEvidence;
  readonly generationRecordId: GenerationRecordId | null;
  readonly revision: number;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface DynamicLocationCandidate {
  readonly id: string;
  readonly name: string;
  readonly kind: DynamicLocationKind;
  readonly parentLocationId: string | null;
  readonly description: string;
  readonly atmosphere: string;
  readonly features: readonly string[];
  readonly factionIds: readonly string[];
  readonly connections: readonly string[];
  readonly currentSituation: string;
  readonly constitutionEvidence: LocationConstitutionEvidence;
}

export interface LocationConnection {
  readonly id: string;
  readonly campaignId: CampaignId;
  readonly firstLocationId: LocationId;
  readonly secondLocationId: LocationId;
  readonly source: 'INITIAL_HIERARCHY' | 'GENERATED';
  readonly generationRecordId: GenerationRecordId | null;
  readonly createdAt: IsoTimestamp;
}

export interface CampaignLocationState {
  readonly campaignId: CampaignId;
  readonly currentLocationId: LocationId;
  readonly revision: number;
  readonly updatedAt: IsoTimestamp;
}

export interface LocationTravelEvent {
  readonly id: string;
  readonly campaignId: CampaignId;
  readonly fromLocationId: LocationId;
  readonly toLocationId: LocationId;
  readonly mode: LocationTravelMode;
  readonly beforeRevision: number;
  readonly afterRevision: number;
  readonly occurredAt: IsoTimestamp;
}

export class DynamicLocationContractError extends Error {
  public constructor(
    public readonly code: 'LOCATION_STRUCTURE_INVALID' | 'LOCATION_DUPLICATE',
    public readonly path: string,
    options?: ErrorOptions,
  ) {
    super('Dynamic location contract validation failed', options);
    this.name = 'DynamicLocationContractError';
  }
}

export function createDynamicLocationProfile(
  input: Omit<
    DynamicLocationProfile,
    | 'kind'
    | 'id'
    | 'campaignId'
    | 'parentLocationId'
    | 'factionIds'
    | 'generationRecordId'
    | 'createdAt'
    | 'updatedAt'
  > & {
    readonly id: string;
    readonly campaignId: string;
    readonly parentLocationId: string | null;
    readonly factionIds: readonly string[];
    readonly generationRecordId: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  },
): DynamicLocationProfile {
  if (input.schemaVersion !== 1) invalid('schemaVersion');
  if (!DYNAMIC_LOCATION_KINDS.includes(input.locationKind)) invalid('locationKind');
  if (!LOCATION_MATERIALIZATION_LEVELS.includes(input.materialization)) {
    invalid('materialization');
  }
  if (!Number.isSafeInteger(input.constitutionRevision) || input.constitutionRevision < 1) {
    invalid('constitutionRevision');
  }
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) invalid('revision');
  const profile = {
    ...input,
    kind: 'DYNAMIC_LOCATION' as const,
    id: locationId(input.id),
    campaignId: campaignId(input.campaignId),
    name: text(input.name, 'name', 120),
    description: text(input.description, 'description', 4_000),
    parentLocationId: input.parentLocationId === null ? null : locationId(input.parentLocationId),
    atmosphere: nullableText(input.atmosphere, 'atmosphere', 4_000),
    features: textList(input.features, 'features', 24),
    factionIds: idList(input.factionIds, 'factionIds', factionId),
    currentSituation: nullableText(input.currentSituation, 'currentSituation', 4_000),
    constitutionEvidence: freezeEvidence(input.constitutionEvidence),
    generationRecordId:
      input.generationRecordId === null ? null : generationRecordId(input.generationRecordId),
    createdAt: isoTimestamp(input.createdAt),
    updatedAt: isoTimestamp(input.updatedAt),
  };
  if (profile.parentLocationId === profile.id) invalid('parentLocationId');
  if (
    profile.materialization === 'DETAILED' &&
    (profile.atmosphere === null ||
      profile.currentSituation === null ||
      profile.features.length === 0)
  ) {
    invalid('materialization');
  }
  return Object.freeze(profile);
}

export function parseDynamicLocationProfile(value: unknown): DynamicLocationProfile {
  try {
    if (!record(value)) invalid('profile');
    exactKeys(
      value,
      [
        'kind',
        'schemaVersion',
        'id',
        'campaignId',
        'constitutionRevision',
        'locationKind',
        'materialization',
        'name',
        'description',
        'parentLocationId',
        'atmosphere',
        'features',
        'factionIds',
        'currentSituation',
        'constitutionEvidence',
        'generationRecordId',
        'revision',
        'createdAt',
        'updatedAt',
      ],
      'profile',
    );
    if (value['kind'] !== 'DYNAMIC_LOCATION') invalid('kind');
    return createDynamicLocationProfile(
      value as unknown as Parameters<typeof createDynamicLocationProfile>[0],
    );
  } catch (error) {
    if (error instanceof DynamicLocationContractError) throw error;
    throw new DynamicLocationContractError('LOCATION_STRUCTURE_INVALID', 'profile', {
      cause: error,
    });
  }
}

export function locationConstitutionEvidence(
  source: LocationConstitutionEvidence,
): LocationConstitutionEvidence {
  return freezeEvidence(source);
}

function freezeEvidence(value: LocationConstitutionEvidence): LocationConstitutionEvidence {
  if (!record(value)) invalid('constitutionEvidence');
  exactKeys(value, ['technology', 'magic', 'society', 'politics'], 'constitutionEvidence');
  return Object.freeze({
    technology: text(value['technology'], 'constitutionEvidence.technology', 4_000),
    magic: text(value['magic'], 'constitutionEvidence.magic', 4_000),
    society: text(value['society'], 'constitutionEvidence.society', 4_000),
    politics: text(value['politics'], 'constitutionEvidence.politics', 4_000),
  });
}

function textList(values: readonly string[], path: string, maximum: number): readonly string[] {
  if (!Array.isArray(values) || values.length > maximum) invalid(path);
  const result = values.map((value, index) => text(value, `${path}[${index}]`, 200));
  if (new Set(result.map(normalize)).size !== result.length) duplicate(path);
  return Object.freeze(result);
}

function idList<T>(
  values: readonly string[],
  path: string,
  brand: (value: string) => T,
): readonly T[] {
  if (!Array.isArray(values) || values.length > 64) invalid(path);
  const result = values.map((value) => brand(value));
  if (new Set(result).size !== result.length) duplicate(path);
  return Object.freeze(result);
}

function nullableText(value: string | null, path: string, maximum: number): string | null {
  return value === null ? null : text(value, path, maximum);
}

function text(value: unknown, path: string, maximum: number): string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length === 0 ||
    [...value].length > maximum
  ) {
    invalid(path);
  }
  return value;
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid(path);
  }
}

function invalid(path: string): never {
  throw new DynamicLocationContractError('LOCATION_STRUCTURE_INVALID', path);
}

function duplicate(path: string): never {
  throw new DynamicLocationContractError('LOCATION_DUPLICATE', path);
}
