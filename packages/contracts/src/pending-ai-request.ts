import type {
  AiRequestId,
  CampaignId,
  IdempotencyKey,
  IsoTimestamp,
  ModelProfileId,
  TurnId,
} from './foundation.js';

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export const AI_REQUEST_STATUSES = [
  'CREATED',
  'CONTEXT_READY',
  'SENDING',
  'RECEIVED',
  'VALIDATING',
  'COMMITTED',
  'FAILED',
  'CANCELLED',
] as const;

export type AiRequestStatus = (typeof AI_REQUEST_STATUSES)[number];

export interface AiRequestError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface PendingAiRequest {
  readonly id: AiRequestId;
  readonly campaignId: CampaignId;
  readonly turnId: TurnId | null;
  readonly idempotencyKey: IdempotencyKey;
  readonly task: string;
  readonly status: AiRequestStatus;
  readonly modelProfileId: ModelProfileId | null;
  readonly input: JsonValue;
  readonly context: JsonValue | null;
  readonly attemptCount: number;
  readonly lastError: AiRequestError | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}
