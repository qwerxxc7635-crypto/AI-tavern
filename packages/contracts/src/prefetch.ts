import type { CampaignId, IsoTimestamp } from './foundation.js';
import type { LazyWorldGenerationKind } from './lazy-world-generation.js';

export const PREFETCH_PRIORITIES = ['P1', 'P2'] as const;
export type PrefetchPriority = (typeof PREFETCH_PRIORITIES)[number];

export const PREFETCH_STATES = [
  'PREDICTED',
  'RUNNING',
  'READY',
  'HIT',
  'MISSED',
  'INVALIDATED',
  'CANCELLED',
  'FAILED',
] as const;
export type PrefetchState = (typeof PREFETCH_STATES)[number];

export const PREFETCH_PREDICTION_REASONS = ['DIRECTOR_APPROVED', 'BACKGROUND_CAPACITY'] as const;
export type PrefetchPredictionReason = (typeof PREFETCH_PREDICTION_REASONS)[number];

export const PREFETCH_EVENT_KINDS = [
  'PREDICTED',
  'STARTED',
  'READY',
  'HIT',
  'MISS',
  'INVALIDATED',
  'CANCELLED',
  'FAILED',
] as const;
export type PrefetchEventKind = (typeof PREFETCH_EVENT_KINDS)[number];

export const PREFETCH_EVENT_REASONS = [
  'DIRECTOR_APPROVED',
  'BACKGROUND_CAPACITY',
  'EXECUTION_STARTED',
  'CANDIDATE_READY',
  'EXACT_MATCH',
  'NOT_READY',
  'NOT_PREDICTED',
  'CONTEXT_CHANGED',
  'SUPERSEDED',
  'PROCESS_RESTART',
  'P0_PREEMPTED',
  'USER_CANCELLED',
  'QUEUE_REJECTED',
  'EXECUTION_FAILED',
] as const;
export type PrefetchEventReason = (typeof PREFETCH_EVENT_REASONS)[number];

export interface PrefetchCandidateSeed {
  readonly id: string;
  readonly campaignId: CampaignId;
  readonly directorRunId: string;
  readonly lazyIntentKey: string;
  readonly kind: Extract<LazyWorldGenerationKind, 'LOCATION_DETAILS' | 'FACTION_DETAILS'>;
  readonly targetId: string;
  readonly priority: PrefetchPriority;
  readonly sourceActionId: string | null;
  readonly predictionReason: PrefetchPredictionReason;
  readonly contextDigest: string;
  readonly predictedAt: IsoTimestamp;
}

export interface PrefetchCandidate extends PrefetchCandidateSeed {
  readonly state: PrefetchState;
  readonly activeExecutionId: string | null;
  readonly processId: string | null;
  readonly errorCode: string | null;
  readonly revision: number;
  readonly startedAt: IsoTimestamp | null;
  readonly readyAt: IsoTimestamp | null;
  readonly resolvedAt: IsoTimestamp | null;
  readonly updatedAt: IsoTimestamp;
}

export interface PrefetchEvent {
  readonly id: number;
  readonly campaignId: CampaignId;
  readonly candidateId: string | null;
  readonly kind: PrefetchCandidateSeed['kind'];
  readonly targetId: string;
  readonly priority: PrefetchPriority | null;
  readonly event: PrefetchEventKind;
  readonly reason: PrefetchEventReason;
  readonly queueWaitMs: number | null;
  readonly generationMs: number | null;
  readonly occurredAt: IsoTimestamp;
}

export interface PrefetchMetrics {
  readonly campaignId: CampaignId;
  readonly predicted: number;
  readonly ready: number;
  readonly hits: number;
  readonly misses: number;
  readonly invalidated: number;
  readonly cancelled: number;
  readonly failed: number;
  readonly hitRatio: number | null;
  readonly averageQueueWaitMs: number | null;
  readonly averageGenerationMs: number | null;
}

export class PrefetchContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'PrefetchContractError';
  }
}
