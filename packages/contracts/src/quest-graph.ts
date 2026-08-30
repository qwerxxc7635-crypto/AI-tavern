import type { CampaignId, IsoTimestamp, QuestId } from './foundation.js';
import type { QuestStatus } from './quest.js';

export const QUEST_GRAPH_EDGE_KINDS = ['PREREQUISITE', 'CONSEQUENCE'] as const;
export type QuestGraphEdgeKind = (typeof QUEST_GRAPH_EDGE_KINDS)[number];

export const QUEST_GRAPH_SOURCE_KINDS = [
  'QUEST',
  'WORLD_FACT',
  'NPC',
  'FACTION',
  'LOCATION',
] as const;
export type QuestGraphSourceKind = (typeof QUEST_GRAPH_SOURCE_KINDS)[number];

export const QUEST_GRAPH_PREDICATES = [
  'STATUS_EQUALS',
  'EXISTS',
  'MATERIALIZATION_EQUALS',
  'PLAYER_RELATION_EQUALS',
] as const;
export type QuestGraphPredicate = (typeof QUEST_GRAPH_PREDICATES)[number];

export const QUEST_GRAPH_TRIGGER_KINDS = [
  'GRAPH_CHANGED',
  'QUEST_TRANSITION',
  'WORLD_FACT_CHANGE',
  'NPC_CHANGE',
  'FACTION_CHANGE',
  'LOCATION_CHANGE',
  'MANUAL_REEVALUATION',
] as const;
export type QuestGraphTriggerKind = (typeof QUEST_GRAPH_TRIGGER_KINDS)[number];

export interface QuestGraphEdge {
  readonly id: string;
  readonly campaignId: CampaignId;
  readonly kind: QuestGraphEdgeKind;
  readonly sourceKind: QuestGraphSourceKind;
  readonly sourceId: string;
  readonly predicate: QuestGraphPredicate;
  readonly expectedValue: string;
  readonly targetQuestId: QuestId;
  readonly satisfiedStatus: QuestStatus;
  readonly unsatisfiedStatus: QuestStatus | null;
  readonly priority: number;
  readonly createdAt: IsoTimestamp;
}

export interface QuestGraphStatusChange {
  readonly questId: QuestId;
  readonly fromStatus: QuestStatus;
  readonly toStatus: QuestStatus;
  readonly edgeIds: readonly string[];
}

export interface QuestGraphEvaluation {
  readonly operationId: string;
  readonly campaignId: CampaignId;
  readonly graphRevision: number;
  readonly triggerKind: QuestGraphTriggerKind;
  readonly triggerId: string;
  readonly evaluatedEdgeIds: readonly string[];
  readonly changes: readonly QuestGraphStatusChange[];
  readonly occurredAt: IsoTimestamp;
}

export interface QuestGraphSnapshot {
  readonly campaignId: CampaignId;
  readonly revision: number;
  readonly edges: readonly QuestGraphEdge[];
  readonly evaluations: readonly QuestGraphEvaluation[];
  readonly updatedAt: IsoTimestamp;
}

export type QuestGraphEntityState =
  | { readonly kind: 'QUEST'; readonly id: string; readonly status: QuestStatus }
  | { readonly kind: 'WORLD_FACT'; readonly id: string }
  | { readonly kind: 'NPC'; readonly id: string; readonly status: string }
  | {
      readonly kind: 'FACTION';
      readonly id: string;
      readonly materialization: 'OUTLINE' | 'ACTIVE';
      readonly playerRelation: 'HOSTILE' | 'WARY' | 'NEUTRAL' | 'FRIENDLY' | 'ALLIED' | 'UNKNOWN';
    }
  | {
      readonly kind: 'LOCATION';
      readonly id: string;
      readonly materialization: 'OUTLINE' | 'DETAILED';
    };

export class QuestGraphContractError extends Error {
  public readonly code = 'EDGE_INVALID' as const;
  public readonly path: string;

  public constructor(path: string, options?: ErrorOptions) {
    super('Quest graph edge is invalid', options);
    this.name = 'QuestGraphContractError';
    this.path = path;
  }
}
