import type {
  AdventureId,
  CampaignId,
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
}

export type NpcKnowledgeInput = NpcKnowledge;

export function createNpcKnowledge(input: NpcKnowledgeInput): NpcKnowledge {
  return Object.freeze({
    npcId: input.npcId,
    knownFactIds: Object.freeze([...input.knownFactIds]),
    suspectedFactIds: Object.freeze([...input.suspectedFactIds]),
    falseBeliefFactIds: Object.freeze([...input.falseBeliefFactIds]),
    excludedSecretFactIds: Object.freeze([...input.excludedSecretFactIds]),
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
