import type { CampaignId, IsoTimestamp } from './foundation.js';
import type { WorldBible, WorldConstitution } from './world.js';

export const LAZY_WORLD_GENERATION_KINDS = [
  'INITIAL_CAREER_POOL',
  'TAVERN',
  'TAVERN_ROSTER',
  'LOCATION_DETAILS',
  'FACTION_DETAILS',
] as const;
export type LazyWorldGenerationKind = (typeof LAZY_WORLD_GENERATION_KINDS)[number];

export const LAZY_WORLD_EXECUTION_MODES = ['ON_DEMAND', 'BACKGROUND_ELIGIBLE'] as const;
export type LazyWorldExecutionMode = (typeof LAZY_WORLD_EXECUTION_MODES)[number];

export const LAZY_WORLD_GENERATION_PRIORITIES = ['P0', 'P1', 'P2'] as const;
export type LazyWorldGenerationPriority = (typeof LAZY_WORLD_GENERATION_PRIORITIES)[number];

export const LAZY_WORLD_GENERATION_STATES = [
  'PLANNED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;
export type LazyWorldGenerationState = (typeof LAZY_WORLD_GENERATION_STATES)[number];

export const LAZY_WORLD_TRANSITION_REASONS = [
  'CORE_BOOTSTRAP',
  'CLAIMED',
  'ARTIFACT_COMMITTED',
  'EXECUTION_FAILED',
  'CANCELLED',
  'INTERRUPTED',
  'RECONCILED',
] as const;
export type LazyWorldTransitionReason = (typeof LAZY_WORLD_TRANSITION_REASONS)[number];

export interface LazyWorldGenerationPlanSeed {
  readonly intentKey: string;
  readonly campaignId: CampaignId;
  readonly kind: LazyWorldGenerationKind;
  readonly targetId: string;
  readonly executionMode: LazyWorldExecutionMode;
  readonly priority: LazyWorldGenerationPriority;
  readonly dependsOnIntentKey: string | null;
  readonly createdAt: IsoTimestamp;
}

export interface LazyWorldGenerationPlan extends LazyWorldGenerationPlanSeed {
  readonly state: LazyWorldGenerationState;
  readonly attemptCount: number;
  readonly activeRunId: string | null;
  readonly artifactRef: string | null;
  readonly lastErrorCode: string | null;
  readonly retryable: boolean;
  readonly revision: number;
  readonly startedAt: IsoTimestamp | null;
  readonly completedAt: IsoTimestamp | null;
  readonly updatedAt: IsoTimestamp;
}

export interface LazyWorldGenerationTransition {
  readonly id: number;
  readonly campaignId: CampaignId;
  readonly intentKey: string;
  readonly fromState: LazyWorldGenerationState | null;
  readonly toState: LazyWorldGenerationState;
  readonly reason: LazyWorldTransitionReason;
  readonly runId: string | null;
  readonly beforeRevision: number;
  readonly afterRevision: number;
  readonly errorCode: string | null;
  readonly retryable: boolean;
  readonly occurredAt: IsoTimestamp;
}

export interface CoreWorldGenerationPlanInput {
  readonly world: WorldBible;
  readonly constitution: WorldConstitution;
  readonly hasWorldSeed: boolean;
  readonly plannedAt: IsoTimestamp;
}

export class LazyWorldGenerationContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'LazyWorldGenerationContractError';
  }
}

export function createLazyWorldGenerationPlanSeed(
  input: LazyWorldGenerationPlanSeed,
): LazyWorldGenerationPlanSeed {
  const intentKey = identity(input.intentKey, 'Lazy generation intent key');
  const targetId = identity(input.targetId, 'Lazy generation target');
  const dependency =
    input.dependsOnIntentKey === null
      ? null
      : identity(input.dependsOnIntentKey, 'Lazy generation dependency');
  if (dependency === intentKey) {
    throw new LazyWorldGenerationContractError('Lazy generation plan cannot depend on itself');
  }
  if (!LAZY_WORLD_GENERATION_KINDS.includes(input.kind)) {
    throw new LazyWorldGenerationContractError('Lazy generation kind is invalid');
  }
  if (!LAZY_WORLD_EXECUTION_MODES.includes(input.executionMode)) {
    throw new LazyWorldGenerationContractError('Lazy generation execution mode is invalid');
  }
  if (!LAZY_WORLD_GENERATION_PRIORITIES.includes(input.priority)) {
    throw new LazyWorldGenerationContractError('Lazy generation priority is invalid');
  }
  canonicalTimestamp(input.createdAt, 'Lazy generation createdAt');
  return Object.freeze({ ...input, intentKey, targetId, dependsOnIntentKey: dependency });
}

export function lazyWorldIntentKey(
  campaignId: CampaignId,
  kind: LazyWorldGenerationKind,
  targetId: string,
): string {
  const value = `lazy:${campaignId}:${kind.toLowerCase()}:${targetId}`;
  return identity(value, 'Lazy generation intent key');
}

function identity(value: string, label: string): string {
  if (
    value.length < 1 ||
    value.length > 256 ||
    value.trim() !== value ||
    !/^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/u.test(value)
  ) {
    throw new LazyWorldGenerationContractError(`${label} is invalid`);
  }
  return value;
}

function canonicalTimestamp(value: IsoTimestamp, label: string): void {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new LazyWorldGenerationContractError(`${label} is invalid`);
  }
}
