import type { CharacterAttributeName } from './character.js';
import type {
  CampaignId,
  ClaimId,
  IsoTimestamp,
  ItemId,
  NpcId,
  QuestId,
  RumorId,
  TavernId,
  WorldFactId,
} from './foundation.js';
import type { RumorSourceBasis } from './world.js';

export type RumorTruthStatus = 'TRUE' | 'PARTIAL' | 'FALSE' | 'UNKNOWN';

export interface RumorContent {
  readonly headline: string;
  readonly details: string;
}

export interface Rumor {
  readonly id: RumorId;
  readonly claimId: ClaimId;
  readonly campaignId: CampaignId;
  readonly tavernId: TavernId;
  readonly content: RumorContent;
  readonly sourceNpcId: NpcId;
  readonly sourceBasis: RumorSourceBasis;
  readonly confidence: number;
  readonly claimRevision: number;
  readonly relatedFactIds: readonly WorldFactId[];
  readonly veracity: RumorTruthStatus;
  readonly createdAt: IsoTimestamp;
  readonly expiresAt: IsoTimestamp | null;
}

export const QUEST_STATUSES = [
  'HIDDEN',
  'DISCOVERED',
  'AVAILABLE',
  'ACCEPTED',
  'ACTIVE',
  'BLOCKED',
  'UPDATED',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
  'ABANDONED',
] as const;
export type QuestStatus = (typeof QUEST_STATUSES)[number];

export const QUEST_TRANSITION_SOURCES = [
  'INITIALIZATION',
  'MIGRATION',
  'GENERATION',
  'PLAYER_INTERVENTION',
  'PLAYER',
  'LOCAL_RULE',
  'SYSTEM',
  'ADVENTURE',
  'FACTION',
  'LEGACY',
] as const;
export type QuestTransitionSource = (typeof QUEST_TRANSITION_SOURCES)[number];

export interface QuestPoolState {
  readonly questId: QuestId;
  readonly campaignId: CampaignId;
  readonly status: QuestStatus;
  readonly revision: number;
  readonly lastSource: QuestTransitionSource;
  readonly lastReason: string;
  readonly lastOperationId: string;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface QuestTransition {
  readonly operationId: string;
  readonly questId: QuestId;
  readonly campaignId: CampaignId;
  readonly fromStatus: QuestStatus | null;
  readonly toStatus: QuestStatus;
  readonly source: QuestTransitionSource;
  readonly reason: string;
  readonly beforeRevision: number;
  readonly afterRevision: number;
  readonly occurredAt: IsoTimestamp;
}

export type QuestRisk = 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME';
export type RewardTier = 'BASIC' | 'NOTABLE' | 'RARE' | 'LEGENDARY';

export interface QuestContent {
  readonly title: string;
  readonly summary: string;
  readonly objective: string;
  readonly failureCost: string;
}

export interface Quest {
  readonly id: QuestId;
  readonly campaignId: CampaignId;
  readonly publisherNpcId: NpcId;
  readonly content: QuestContent;
  readonly status: QuestStatus;
  readonly risk: QuestRisk;
  readonly recommendedAttributes: readonly CharacterAttributeName[];
  readonly expectedTurns: Readonly<{ min: number; max: number }>;
  readonly rewardTier: RewardTier;
  readonly relatedNpcIds: readonly NpcId[];
  readonly relatedFactIds: readonly WorldFactId[];
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface ItemContent {
  readonly name: string;
  readonly description: string;
}

export type ItemEffect =
  | { readonly kind: 'NONE' }
  | {
      readonly kind: 'CHECK_MODIFIER';
      readonly attribute: CharacterAttributeName;
      readonly modifier: number;
    }
  | { readonly kind: 'REROLL'; readonly uses: number }
  | {
      readonly kind: 'CONSUMABLE_RECOVERY';
      readonly resource: 'INJURY' | 'STRESS';
      readonly amount: number;
      readonly uses: number;
    };

export interface Item {
  readonly id: ItemId;
  readonly campaignId: CampaignId;
  readonly content: ItemContent;
  readonly rewardTier: RewardTier;
  readonly effect: ItemEffect;
  readonly createdAt: IsoTimestamp;
}
