import type { AiOperationId, CampaignId, EventLedgerId, IsoTimestamp } from './foundation.js';
import type { JsonValue } from './pending-ai-request.js';

export const LEDGER_EVENT_TYPES = [
  'CHARACTER_COMMITTED',
  'QUEST_COMMITTED',
  'TURN_COMMITTED',
  'DICE_COMMITTED',
  'SCENE_COMMITTED',
  'KNOWLEDGE_COMMITTED',
  'SNAPSHOT_CREATED',
  'RECOVERY_COMMITTED',
] as const;
export type LedgerEventType = (typeof LEDGER_EVENT_TYPES)[number];

export const LEDGER_AGGREGATE_TYPES = [
  'CHARACTER',
  'QUEST',
  'TURN',
  'DICE',
  'SCENE',
  'KNOWLEDGE',
  'SNAPSHOT',
  'RECOVERY',
] as const;
export type LedgerAggregateType = (typeof LEDGER_AGGREGATE_TYPES)[number];

export const LEDGER_SOURCES = ['LOCAL_RULE', 'USER_ACCEPTANCE', 'IMPORT', 'SYSTEM'] as const;
export type LedgerSource = (typeof LEDGER_SOURCES)[number];

export interface EventLedgerEntry {
  readonly id: EventLedgerId;
  readonly campaignId: CampaignId;
  readonly eventType: LedgerEventType;
  readonly operationId: AiOperationId;
  readonly aggregateType: LedgerAggregateType;
  readonly aggregateId: string;
  readonly revision: number;
  readonly payload: JsonValue;
  readonly payloadVersion: number;
  readonly source: LedgerSource;
  readonly occurredAt: IsoTimestamp;
}
