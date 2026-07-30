import type {
  AdventureId,
  CampaignId,
  ConversationId,
  GenerationRecordId,
  IsoTimestamp,
  MessageId,
  NpcId,
} from './foundation.js';

export type ConversationKind = 'NPC' | 'ADVENTURE' | 'SYSTEM';

export interface Conversation {
  readonly id: ConversationId;
  readonly campaignId: CampaignId;
  readonly kind: ConversationKind;
  readonly npcId: NpcId | null;
  readonly adventureId: AdventureId | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export type MessageRole = 'PLAYER' | 'NPC' | 'NARRATOR' | 'SYSTEM';

export interface Message {
  readonly id: MessageId;
  readonly conversationId: ConversationId;
  readonly sequenceNumber: number;
  readonly role: MessageRole;
  readonly speakerNpcId: NpcId | null;
  readonly content: string;
  readonly generationRecordId: GenerationRecordId | null;
  readonly createdAt: IsoTimestamp;
}
