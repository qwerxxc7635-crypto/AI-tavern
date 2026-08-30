import {
  createNpcLodProfile,
  gameEventId,
  itemId,
  npcId,
  npcMemoryId,
  questId,
  worldFactId,
  type NpcLodCandidate,
  type NpcLodLevel,
  type NpcLodProfile,
  type NpcLodUpgradeTrigger,
  type WorldConstitution,
} from '@ember-tavern/contracts';

const EXPECTED_TRIGGER: Readonly<Record<0 | 1 | 2, NpcLodUpgradeTrigger>> = {
  0: 'OBSERVED',
  1: 'INTERACTED',
  2: 'RECURRING',
};

export interface CreateNpcLodSeedInput {
  readonly id: string;
  readonly campaignId: string;
  readonly constitution: WorldConstitution;
  readonly identityAnchor: string;
  readonly populationRole: string;
  readonly at: string;
}

export interface NpcLodReferenceAuthority {
  readonly knowledgeFactIds: readonly string[];
  readonly relationshipNpcIds: readonly string[];
  readonly memoryIds: readonly string[];
  readonly secretFactIds: readonly string[];
  readonly questIds: readonly string[];
  readonly itemIds: readonly string[];
  readonly experienceEventIds: readonly string[];
}

export interface UpgradeNpcLodInput {
  readonly current: NpcLodProfile;
  readonly constitution: WorldConstitution;
  readonly candidate: NpcLodCandidate;
  readonly trigger: NpcLodUpgradeTrigger;
  readonly references: NpcLodReferenceAuthority;
  readonly generationRecordId: string;
  readonly at: string;
}

export class NpcLodRuleError extends Error {
  public constructor(
    public readonly code:
      | 'NPC_LOD_TRANSITION_INVALID'
      | 'NPC_LOD_IDENTITY_DRIFT'
      | 'NPC_LOD_CONSTITUTION_MISMATCH'
      | 'NPC_LOD_REFERENCE_UNAUTHORIZED',
    public readonly paths: readonly string[],
    options?: ErrorOptions,
  ) {
    super('NPC LOD rule validation failed', options);
    this.name = 'NpcLodRuleError';
  }
}

export function createNpcLodSeed(input: CreateNpcLodSeedInput): NpcLodProfile {
  requireConstitution(input.constitution, input.campaignId);
  return createNpcLodProfile({
    schemaVersion: 1,
    id: input.id,
    campaignId: input.campaignId,
    constitutionRevision: input.constitution.revision,
    lod: 0,
    revision: 1,
    identityAnchor: input.identityAnchor,
    populationRole: input.populationRole,
    name: null,
    appearance: null,
    currentBehavior: null,
    career: null,
    personality: null,
    goals: [],
    knowledgeFactIds: [],
    relationshipNpcIds: [],
    memoryIds: [],
    secretFactIds: [],
    questIds: [],
    itemIds: [],
    experienceEventIds: [],
    constitutionEvidence: evidence(input.constitution),
    generationRecordId: null,
    createdAt: input.at,
    updatedAt: input.at,
  });
}

export function upgradeNpcLod(input: UpgradeNpcLodInput): NpcLodProfile {
  const { current, candidate } = input;
  requireConstitution(input.constitution, current.campaignId);
  if (
    current.constitutionRevision !== input.constitution.revision ||
    !sameEvidence(current.constitutionEvidence, evidence(input.constitution)) ||
    !sameEvidence(candidate.constitutionEvidence, evidence(input.constitution))
  ) {
    fail('NPC_LOD_CONSTITUTION_MISMATCH', ['constitutionRevision', 'constitutionEvidence']);
  }
  if (current.lod === 3 || candidate.lod !== current.lod + 1) {
    fail('NPC_LOD_TRANSITION_INVALID', ['lod']);
  }
  const from = current.lod as 0 | 1 | 2;
  if (input.trigger !== EXPECTED_TRIGGER[from]) {
    fail('NPC_LOD_TRANSITION_INVALID', ['trigger']);
  }
  if (
    candidate.npcId !== current.id ||
    candidate.identityAnchor !== current.identityAnchor ||
    candidate.populationRole !== current.populationRole
  ) {
    fail('NPC_LOD_IDENTITY_DRIFT', ['npcId', 'identityAnchor', 'populationRole']);
  }
  preserveText(current, candidate);
  preserveLists(current, candidate);
  authorizeReferences(candidate, input.references);
  return createNpcLodProfile({
    schemaVersion: 1,
    id: current.id,
    campaignId: current.campaignId,
    constitutionRevision: current.constitutionRevision,
    lod: candidate.lod,
    revision: current.revision + 1,
    identityAnchor: current.identityAnchor,
    populationRole: current.populationRole,
    name: candidate.name,
    appearance: candidate.appearance,
    currentBehavior: candidate.currentBehavior,
    career: candidate.career,
    personality: candidate.personality,
    goals: candidate.goals,
    knowledgeFactIds: candidate.knowledgeFactIds.map(worldFactId),
    relationshipNpcIds: candidate.relationshipNpcIds.map(npcId),
    memoryIds: candidate.memoryIds.map(npcMemoryId),
    secretFactIds: candidate.secretFactIds.map(worldFactId),
    questIds: candidate.questIds.map(questId),
    itemIds: candidate.itemIds.map(itemId),
    experienceEventIds: candidate.experienceEventIds.map(gameEventId),
    constitutionEvidence: candidate.constitutionEvidence,
    generationRecordId: input.generationRecordId,
    createdAt: current.createdAt,
    updatedAt: input.at,
  });
}

export function requiredNpcLodTrigger(from: Exclude<NpcLodLevel, 3>): NpcLodUpgradeTrigger {
  return EXPECTED_TRIGGER[from];
}

function preserveText(current: NpcLodProfile, candidate: NpcLodCandidate): void {
  for (const key of ['name', 'appearance', 'currentBehavior', 'career', 'personality'] as const) {
    const prior = current[key];
    if (prior !== null && candidate[key] !== prior) {
      fail('NPC_LOD_IDENTITY_DRIFT', [key]);
    }
  }
}

function preserveLists(current: NpcLodProfile, candidate: NpcLodCandidate): void {
  for (const key of [
    'goals',
    'knowledgeFactIds',
    'relationshipNpcIds',
    'memoryIds',
    'secretFactIds',
    'questIds',
    'itemIds',
    'experienceEventIds',
  ] as const) {
    const next = new Set(candidate[key]);
    if (current[key].some((value) => !next.has(value))) {
      fail('NPC_LOD_IDENTITY_DRIFT', [key]);
    }
  }
}

function authorizeReferences(
  candidate: NpcLodCandidate,
  authority: NpcLodReferenceAuthority,
): void {
  for (const key of [
    'knowledgeFactIds',
    'relationshipNpcIds',
    'memoryIds',
    'secretFactIds',
    'questIds',
    'itemIds',
    'experienceEventIds',
  ] as const) {
    const allowed = new Set(authority[key]);
    if (candidate[key].some((value) => !allowed.has(value))) {
      fail('NPC_LOD_REFERENCE_UNAUTHORIZED', [key]);
    }
  }
}

function requireConstitution(constitution: WorldConstitution, campaignId: string): void {
  if (constitution.status !== 'LOCKED' || constitution.campaignId !== campaignId) {
    fail('NPC_LOD_CONSTITUTION_MISMATCH', ['campaignId', 'status']);
  }
}

function evidence(constitution: WorldConstitution) {
  return Object.freeze({
    npcRules: constitution.npcRules,
    society: constitution.society,
    technology: constitution.technology,
  });
}

function sameEvidence(
  left: NpcLodProfile['constitutionEvidence'],
  right: NpcLodProfile['constitutionEvidence'],
): boolean {
  return (
    left.npcRules === right.npcRules &&
    left.society === right.society &&
    left.technology === right.technology
  );
}

function fail(code: NpcLodRuleError['code'], paths: readonly string[]): never {
  throw new NpcLodRuleError(code, Object.freeze([...paths]));
}
