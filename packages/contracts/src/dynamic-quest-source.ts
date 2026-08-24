import type {
  CampaignId,
  GenerationRecordId,
  IsoTimestamp,
  NpcId,
  QuestId,
  WorldFactId,
} from './foundation.js';
import type { JsonValue } from './pending-ai-request.js';
import type { QuestStatus } from './quest.js';

export const DYNAMIC_QUEST_SOURCE_KINDS = [
  'NPC',
  'FACTION',
  'WORLD_EVENT',
  'DISCOVERY',
  'PLAYER_ACTION',
  'CONSEQUENCE',
] as const;
export type DynamicQuestSourceKind = (typeof DYNAMIC_QUEST_SOURCE_KINDS)[number];

export const DYNAMIC_QUEST_VISIBILITIES = ['PLAYER_VISIBLE', 'HIDDEN'] as const;
export type DynamicQuestVisibility = (typeof DYNAMIC_QUEST_VISIBILITIES)[number];

export const DYNAMIC_QUEST_ENTITY_KINDS = [
  'NPC',
  'FACTION',
  'GAME_EVENT',
  'WORLD_FACT',
  'PLAYER_ACTION',
  'QUEST_GRAPH',
] as const;
export type DynamicQuestEntityKind = (typeof DYNAMIC_QUEST_ENTITY_KINDS)[number];

export interface DynamicQuestSourceContext {
  readonly kind: DynamicQuestSourceKind;
  readonly occurrenceId: string;
  readonly entityKind: DynamicQuestEntityKind;
  readonly entityId: string;
  readonly summary: string;
  readonly actorNpcId: NpcId | null;
  readonly visibility: DynamicQuestVisibility;
  readonly playerIntervened: boolean;
}

export interface DynamicQuestRelevantFact {
  readonly id: WorldFactId;
  readonly statement: string;
}

export interface DynamicQuestBudget {
  readonly policyVersion: 1;
  readonly openQuestLimit: number;
  readonly currentOpenQuests: number;
  readonly remainingSlots: number;
}

export interface DynamicQuestConstitutionContext {
  readonly revision: number;
  readonly technology: string;
  readonly magic: string;
  readonly society: string;
  readonly politics: string;
  readonly economy: string;
  readonly taboos: readonly string[];
}

export interface DynamicQuestPreparation {
  readonly campaignId: CampaignId;
  readonly source: DynamicQuestSourceContext;
  readonly publisherNpcId: NpcId;
  readonly relevantFacts: readonly DynamicQuestRelevantFact[];
  readonly constitution: DynamicQuestConstitutionContext;
  readonly budget: DynamicQuestBudget;
  readonly initialStatus: QuestStatus;
  readonly contextDigest: string;
  readonly existingQuestId: QuestId | null;
  readonly input: JsonValue;
}

export interface DynamicQuestProvenance {
  readonly questId: QuestId;
  readonly campaignId: CampaignId;
  readonly source: DynamicQuestSourceContext;
  readonly relevantFactIds: readonly WorldFactId[];
  readonly contextDigest: string;
  readonly generationRecordId: GenerationRecordId;
  readonly budget: DynamicQuestBudget;
  readonly createdAt: IsoTimestamp;
}

export class DynamicQuestSourceContractError extends Error {
  public readonly code:
    'SOURCE_INVALID' | 'BUDGET_EXCEEDED' | 'DUPLICATE_SOURCE' | 'REFERENCE_INVALID';

  public constructor(code: DynamicQuestSourceContractError['code'], options?: ErrorOptions) {
    super('Dynamic quest source is invalid', options);
    this.name = 'DynamicQuestSourceContractError';
    this.code = code;
  }
}
