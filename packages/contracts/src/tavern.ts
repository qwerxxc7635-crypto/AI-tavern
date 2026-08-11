import type {
  AdventureId,
  CampaignId,
  GameEventId,
  IsoTimestamp,
  LocationId,
  NpcId,
  NpcMemoryId,
  PlayerCharacterId,
  TavernChangeId,
  TavernId,
  TurnId,
  WorldFactId,
} from './foundation.js';

export interface Tavern {
  readonly id: TavernId;
  readonly campaignId: CampaignId;
  readonly locationId: LocationId;
  readonly name: string;
  readonly position: string;
  readonly environment: string;
  readonly specialRules: readonly string[];
  readonly longTermProblem: string;
  readonly ownerNpcId: NpcId;
  readonly residentNpcIds: readonly NpcId[];
  readonly visitorNpcIds: readonly NpcId[];
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export type TavernChangeKind = 'TROPHY' | 'MENU' | 'DAMAGE' | 'DECORATION' | 'LAYOUT' | 'OTHER';

export interface TavernChange {
  readonly id: TavernChangeId;
  readonly tavernId: TavernId;
  readonly kind: TavernChangeKind;
  readonly description: string;
  readonly sourceAdventureId: AdventureId | null;
  readonly occurredAt: IsoTimestamp;
}

export type NpcResidency = 'OWNER' | 'RESIDENT' | 'TEMPORARY_VISITOR';
export type NpcStatus = 'ACTIVE' | 'ABSENT' | 'LEFT' | 'DECEASED';

export interface NpcProfile {
  readonly id: NpcId;
  readonly campaignId: CampaignId;
  readonly tavernId: TavernId;
  readonly residency: NpcResidency;
  readonly name: string;
  readonly identity: string;
  readonly appearance: string;
  readonly personality: string;
  readonly goal: string;
  readonly secret: string;
  readonly speechStyle: string;
  readonly currentMood: string;
  readonly currentStatus: NpcStatus;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface NpcKnowledge {
  readonly npcId: NpcId;
  readonly knownFactIds: readonly WorldFactId[];
  readonly suspectedFactIds: readonly WorldFactId[];
  readonly falseBeliefFactIds: readonly WorldFactId[];
  readonly excludedSecretFactIds: readonly WorldFactId[];
  readonly provenance: readonly NpcKnowledgeProvenance[];
}

export const NPC_KNOWLEDGE_STATES = ['KNOWN', 'SUSPECTED', 'BELIEVED'] as const;
export type NpcKnowledgeState = (typeof NPC_KNOWLEDGE_STATES)[number];

export const NPC_KNOWLEDGE_SOURCES = [
  'LOCAL_RULE',
  'OBSERVATION',
  'COMMUNICATION',
  'INFERENCE',
  'IMPORT',
] as const;
export type NpcKnowledgeSource = (typeof NPC_KNOWLEDGE_SOURCES)[number];

export interface NpcKnowledgeProvenance {
  readonly factId: WorldFactId;
  readonly state: NpcKnowledgeState;
  readonly source: NpcKnowledgeSource;
  readonly eventId: GameEventId | null;
  readonly learnedAt: IsoTimestamp;
  readonly confidence: number;
}

export type NpcKnowledgeInput = NpcKnowledge;

export class NpcKnowledgeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'NpcKnowledgeError';
  }
}

export function createNpcKnowledge(input: NpcKnowledgeInput): NpcKnowledge {
  const stateByFact = new Map<WorldFactId, NpcKnowledgeState>();
  const addFacts = (ids: readonly WorldFactId[], state: NpcKnowledgeState) => {
    for (const id of ids) {
      if (stateByFact.has(id))
        throw new NpcKnowledgeError(`Knowledge fact has multiple states: ${id}`);
      stateByFact.set(id, state);
    }
  };
  addFacts(input.knownFactIds, 'KNOWN');
  addFacts(input.suspectedFactIds, 'SUSPECTED');
  addFacts(input.falseBeliefFactIds, 'BELIEVED');
  const excluded = new Set(input.excludedSecretFactIds);
  if (excluded.size !== input.excludedSecretFactIds.length) {
    throw new NpcKnowledgeError('Excluded secret facts must be unique');
  }
  for (const id of excluded) {
    if (stateByFact.has(id))
      throw new NpcKnowledgeError(`Excluded secret cannot be active knowledge: ${id}`);
  }
  const provenanceByFact = new Map<WorldFactId, NpcKnowledgeProvenance>();
  for (const entry of input.provenance) {
    if (provenanceByFact.has(entry.factId)) {
      throw new NpcKnowledgeError(`Knowledge provenance is duplicated: ${entry.factId}`);
    }
    if (stateByFact.get(entry.factId) !== entry.state) {
      throw new NpcKnowledgeError(
        `Knowledge provenance state does not match fact: ${entry.factId}`,
      );
    }
    if (!NPC_KNOWLEDGE_SOURCES.includes(entry.source)) {
      throw new NpcKnowledgeError(`Unknown knowledge source: ${entry.source}`);
    }
    if (!Number.isFinite(entry.confidence) || entry.confidence < 0 || entry.confidence > 1) {
      throw new NpcKnowledgeError(`Knowledge confidence must be from 0 to 1: ${entry.factId}`);
    }
    if (Number.isNaN(Date.parse(entry.learnedAt))) {
      throw new NpcKnowledgeError(`Knowledge learnedAt must be an ISO timestamp: ${entry.factId}`);
    }
    if (
      (entry.source === 'OBSERVATION' ||
        entry.source === 'COMMUNICATION' ||
        entry.source === 'INFERENCE') &&
      entry.eventId === null
    ) {
      throw new NpcKnowledgeError(`Knowledge source requires an event: ${entry.factId}`);
    }
    provenanceByFact.set(entry.factId, entry);
  }
  if (provenanceByFact.size !== stateByFact.size) {
    throw new NpcKnowledgeError(
      'Every active knowledge fact requires exactly one provenance entry',
    );
  }
  return Object.freeze({
    npcId: input.npcId,
    knownFactIds: Object.freeze([...input.knownFactIds]),
    suspectedFactIds: Object.freeze([...input.suspectedFactIds]),
    falseBeliefFactIds: Object.freeze([...input.falseBeliefFactIds]),
    excludedSecretFactIds: Object.freeze([...input.excludedSecretFactIds]),
    provenance: Object.freeze(input.provenance.map((entry) => Object.freeze({ ...entry }))),
  });
}

export interface NpcRelationship {
  readonly npcId: NpcId;
  readonly playerCharacterId: PlayerCharacterId;
  readonly trust: number;
  readonly closeness: number;
  readonly awe: number;
  readonly obligation: number;
}

export type NpcRelationshipInput = NpcRelationship;

export class RelationshipValueError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'RelationshipValueError';
  }
}

const RELATIONSHIP_DIMENSIONS = ['trust', 'closeness', 'awe', 'obligation'] as const;

export function createNpcRelationship(input: NpcRelationshipInput): NpcRelationship {
  for (const dimension of RELATIONSHIP_DIMENSIONS) {
    const value = input[dimension];
    if (!Number.isInteger(value) || value < -5 || value > 5) {
      throw new RelationshipValueError(`${dimension} must be an integer from -5 to 5`);
    }
  }
  return Object.freeze({ ...input });
}

export interface NpcMemory {
  readonly id: NpcMemoryId;
  readonly npcId: NpcId;
  readonly summary: string;
  readonly sourceTurnIds: readonly TurnId[];
  readonly createdAt: IsoTimestamp;
}

export interface TemporaryVisitor {
  readonly npcId: NpcId;
  readonly tavernId: TavernId;
  readonly visitReason: string;
  readonly arrivedAt: IsoTimestamp;
  readonly plannedDepartureAt: IsoTimestamp | null;
}
