import type { IsoTimestamp } from './foundation.js';

export const NPC_TIMELINE_SCOPE_KINDS = ['NPC_DIALOGUE', 'TAVERN_SCENE'] as const;
export type NpcTimelineScopeKind = (typeof NPC_TIMELINE_SCOPE_KINDS)[number];

export const NPC_TIMELINE_STATUSES = [
  'PENDING',
  'FAILED_RETRYABLE',
  'FAILED_FINAL',
  'COMMITTED',
  'CANCELLED',
] as const;
export type NpcTimelineStatus = (typeof NPC_TIMELINE_STATUSES)[number];

export const NPC_TIMELINE_ATTEMPT_STATUSES = ['STARTED', 'FAILED', 'COMMITTED'] as const;
export type NpcTimelineAttemptStatus = (typeof NPC_TIMELINE_ATTEMPT_STATUSES)[number];

export interface NpcTimelineAttempt {
  readonly id: string;
  readonly sequence: number;
  readonly requestIds: readonly string[];
  readonly generationRecordIds: readonly string[];
  readonly idempotencyKeys: readonly string[];
  readonly status: NpcTimelineAttemptStatus;
  readonly errorKind: string | null;
  readonly errorCode: string | null;
  readonly retryable: boolean | null;
  readonly startedAt: IsoTimestamp;
  readonly completedAt: IsoTimestamp | null;
}

export interface NpcTimelineOperation {
  readonly id: string;
  readonly operationId: string;
  readonly campaignId: string;
  readonly scopeKind: NpcTimelineScopeKind;
  readonly scopeId: string;
  readonly playerIntent: string;
  readonly addressedNpcId: string | null;
  readonly hardResultKey: string | null;
  readonly status: NpcTimelineStatus;
  readonly committedRefId: string | null;
  readonly attempts: readonly NpcTimelineAttempt[];
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}
