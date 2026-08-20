import {
  campaignId,
  gameEventId,
  generationRecordId,
  isoTimestamp,
  itemId,
  npcId,
  npcMemoryId,
  questId,
  worldFactId,
  type CampaignId,
  type GameEventId,
  type GenerationRecordId,
  type IsoTimestamp,
  type ItemId,
  type NpcId,
  type NpcMemoryId,
  type QuestId,
  type WorldFactId,
} from './foundation.js';

export const NPC_LOD_LEVELS = [0, 1, 2, 3] as const;
export type NpcLodLevel = (typeof NPC_LOD_LEVELS)[number];

export const NPC_LOD_UPGRADE_TRIGGERS = ['OBSERVED', 'INTERACTED', 'RECURRING'] as const;
export type NpcLodUpgradeTrigger = (typeof NPC_LOD_UPGRADE_TRIGGERS)[number];

export interface NpcLodConstitutionEvidence {
  readonly npcRules: string;
  readonly society: string;
  readonly technology: string;
}

export interface NpcLodProfile {
  readonly kind: 'NPC_LOD_PROFILE';
  readonly schemaVersion: 1;
  readonly id: NpcId;
  readonly campaignId: CampaignId;
  readonly constitutionRevision: number;
  readonly lod: NpcLodLevel;
  readonly revision: number;
  readonly identityAnchor: string;
  readonly populationRole: string;
  readonly name: string | null;
  readonly appearance: string | null;
  readonly currentBehavior: string | null;
  readonly career: string | null;
  readonly personality: string | null;
  readonly goals: readonly string[];
  readonly knowledgeFactIds: readonly WorldFactId[];
  readonly relationshipNpcIds: readonly NpcId[];
  readonly memoryIds: readonly NpcMemoryId[];
  readonly secretFactIds: readonly WorldFactId[];
  readonly questIds: readonly QuestId[];
  readonly itemIds: readonly ItemId[];
  readonly experienceEventIds: readonly GameEventId[];
  readonly constitutionEvidence: NpcLodConstitutionEvidence;
  readonly generationRecordId: GenerationRecordId | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface NpcLodCandidate {
  readonly npcId: string;
  readonly lod: NpcLodLevel;
  readonly identityAnchor: string;
  readonly populationRole: string;
  readonly name: string | null;
  readonly appearance: string | null;
  readonly currentBehavior: string | null;
  readonly career: string | null;
  readonly personality: string | null;
  readonly goals: readonly string[];
  readonly knowledgeFactIds: readonly string[];
  readonly relationshipNpcIds: readonly string[];
  readonly memoryIds: readonly string[];
  readonly secretFactIds: readonly string[];
  readonly questIds: readonly string[];
  readonly itemIds: readonly string[];
  readonly experienceEventIds: readonly string[];
  readonly constitutionEvidence: NpcLodConstitutionEvidence;
}

export interface NpcLodTransition {
  readonly id: string;
  readonly campaignId: CampaignId;
  readonly npcId: NpcId;
  readonly fromLod: NpcLodLevel;
  readonly toLod: NpcLodLevel;
  readonly trigger: NpcLodUpgradeTrigger;
  readonly beforeRevision: number;
  readonly afterRevision: number;
  readonly generationRecordId: GenerationRecordId;
  readonly occurredAt: IsoTimestamp;
}

export class NpcLodContractError extends Error {
  public constructor(
    public readonly code: 'NPC_LOD_STRUCTURE_INVALID' | 'NPC_LOD_DUPLICATE',
    public readonly path: string,
    options?: ErrorOptions,
  ) {
    super('NPC LOD contract validation failed', options);
    this.name = 'NpcLodContractError';
  }
}

export function createNpcLodProfile(
  input: Omit<
    NpcLodProfile,
    'kind' | 'id' | 'campaignId' | 'generationRecordId' | 'createdAt' | 'updatedAt'
  > & {
    readonly id: string;
    readonly campaignId: string;
    readonly generationRecordId: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  },
): NpcLodProfile {
  if (input.schemaVersion !== 1) invalid('schemaVersion');
  if (!NPC_LOD_LEVELS.includes(input.lod)) invalid('lod');
  if (!Number.isSafeInteger(input.constitutionRevision) || input.constitutionRevision < 1) {
    invalid('constitutionRevision');
  }
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) invalid('revision');
  const profile = {
    ...input,
    kind: 'NPC_LOD_PROFILE' as const,
    id: npcId(input.id),
    campaignId: campaignId(input.campaignId),
    identityAnchor: text(input.identityAnchor, 'identityAnchor', 200),
    populationRole: text(input.populationRole, 'populationRole', 200),
    name: nullableText(input.name, 'name', 120),
    appearance: nullableText(input.appearance, 'appearance', 4_000),
    currentBehavior: nullableText(input.currentBehavior, 'currentBehavior', 4_000),
    career: nullableText(input.career, 'career', 1_000),
    personality: nullableText(input.personality, 'personality', 4_000),
    goals: textList(input.goals, 'goals', 16),
    knowledgeFactIds: idList(input.knowledgeFactIds, 'knowledgeFactIds', worldFactId),
    relationshipNpcIds: idList(input.relationshipNpcIds, 'relationshipNpcIds', npcId),
    memoryIds: idList(input.memoryIds, 'memoryIds', npcMemoryId),
    secretFactIds: idList(input.secretFactIds, 'secretFactIds', worldFactId),
    questIds: idList(input.questIds, 'questIds', questId),
    itemIds: idList(input.itemIds, 'itemIds', itemId),
    experienceEventIds: idList(input.experienceEventIds, 'experienceEventIds', gameEventId),
    constitutionEvidence: freezeEvidence(input.constitutionEvidence),
    generationRecordId:
      input.generationRecordId === null ? null : generationRecordId(input.generationRecordId),
    createdAt: isoTimestamp(input.createdAt),
    updatedAt: isoTimestamp(input.updatedAt),
  };
  validateLevelShape(profile);
  return Object.freeze(profile);
}

export function parseNpcLodProfile(value: unknown): NpcLodProfile {
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
        'lod',
        'revision',
        'identityAnchor',
        'populationRole',
        'name',
        'appearance',
        'currentBehavior',
        'career',
        'personality',
        'goals',
        'knowledgeFactIds',
        'relationshipNpcIds',
        'memoryIds',
        'secretFactIds',
        'questIds',
        'itemIds',
        'experienceEventIds',
        'constitutionEvidence',
        'generationRecordId',
        'createdAt',
        'updatedAt',
      ],
      'profile',
    );
    if (value['kind'] !== 'NPC_LOD_PROFILE') invalid('kind');
    return createNpcLodProfile(value as unknown as Parameters<typeof createNpcLodProfile>[0]);
  } catch (error) {
    if (error instanceof NpcLodContractError) throw error;
    throw new NpcLodContractError('NPC_LOD_STRUCTURE_INVALID', 'profile', { cause: error });
  }
}

function validateLevelShape(profile: NpcLodProfile): void {
  const lod1 = [profile.name, profile.appearance, profile.currentBehavior];
  const lod2 = [profile.career, profile.personality];
  const deep = [
    profile.memoryIds,
    profile.secretFactIds,
    profile.questIds,
    profile.itemIds,
    profile.experienceEventIds,
  ];
  if (profile.lod === 0 && (lod1.some((value) => value !== null) || lod2.some((v) => v !== null))) {
    invalid('lod0');
  }
  if (profile.lod === 0 && (profile.goals.length > 0 || hasReferences(profile))) invalid('lod0');
  if (profile.lod >= 1 && lod1.some((value) => value === null)) invalid('lod1');
  if (profile.lod < 2 && (lod2.some((value) => value !== null) || profile.goals.length > 0)) {
    invalid('lod2');
  }
  if (profile.lod >= 2 && (lod2.some((value) => value === null) || profile.goals.length === 0)) {
    invalid('lod2');
  }
  if (
    profile.lod < 2 &&
    (profile.knowledgeFactIds.length > 0 || profile.relationshipNpcIds.length > 0)
  ) {
    invalid('lod2');
  }
  if (profile.lod < 3 && deep.some((values) => values.length > 0)) invalid('lod3');
}

function hasReferences(profile: NpcLodProfile): boolean {
  return (
    profile.knowledgeFactIds.length > 0 ||
    profile.relationshipNpcIds.length > 0 ||
    profile.memoryIds.length > 0 ||
    profile.secretFactIds.length > 0 ||
    profile.questIds.length > 0 ||
    profile.itemIds.length > 0 ||
    profile.experienceEventIds.length > 0
  );
}

function freezeEvidence(value: NpcLodConstitutionEvidence): NpcLodConstitutionEvidence {
  if (!record(value)) invalid('constitutionEvidence');
  exactKeys(value, ['npcRules', 'society', 'technology'], 'constitutionEvidence');
  return Object.freeze({
    npcRules: text(value['npcRules'], 'constitutionEvidence.npcRules', 4_000),
    society: text(value['society'], 'constitutionEvidence.society', 4_000),
    technology: text(value['technology'], 'constitutionEvidence.technology', 4_000),
  });
}

function textList(values: readonly string[], path: string, maximum: number): readonly string[] {
  if (!Array.isArray(values) || values.length > maximum) invalid(path);
  const result = values.map((value, index) => text(value, `${path}[${index}]`, 1_000));
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
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('und');
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
  throw new NpcLodContractError('NPC_LOD_STRUCTURE_INVALID', path);
}

function duplicate(path: string): never {
  throw new NpcLodContractError('NPC_LOD_DUPLICATE', path);
}
