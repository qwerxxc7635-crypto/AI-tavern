import type { CampaignId, IsoTimestamp } from './foundation.js';
import type { JsonValue } from './pending-ai-request.js';

export const WORLD_DIRECTOR_ACTION_KINDS = [
  'WORLD_CHANGE',
  'NPC_ACTION',
  'FACTION_ACTION',
  'OPPORTUNITY',
  'FORESHADOW',
  'PRESSURE',
  'QUEST_UPDATE',
  'QUEST_EXPIRE',
] as const;
export type WorldDirectorActionKind = (typeof WORLD_DIRECTOR_ACTION_KINDS)[number];

export const WORLD_DIRECTOR_URGENCIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type WorldDirectorUrgency = (typeof WORLD_DIRECTOR_URGENCIES)[number];

export const WORLD_DIRECTOR_PACES = ['QUIET', 'BALANCED', 'PRESSURED', 'OVERLOADED'] as const;
export type WorldDirectorPace = (typeof WORLD_DIRECTOR_PACES)[number];

export const WORLD_DIRECTOR_ROUTES = ['RULES', 'GENERATOR', 'FACTION_RULES'] as const;
export type WorldDirectorRoute = (typeof WORLD_DIRECTOR_ROUTES)[number];

export const WORLD_DIRECTOR_TRIGGER_KINDS = [
  'MANUAL',
  'WORLD_EVENT',
  'PLAYER_ACTION',
  'QUEST_TRANSITION',
  'SETTLEMENT',
] as const;
export type WorldDirectorTriggerKind = (typeof WORLD_DIRECTOR_TRIGGER_KINDS)[number];

export const WORLD_DIRECTOR_SUPPRESSION_REASONS = [
  'OVERLOAD_GUARD',
  'ACTION_LIMIT',
  'NO_ELIGIBLE_TARGET',
] as const;
export type WorldDirectorSuppressionReason = (typeof WORLD_DIRECTOR_SUPPRESSION_REASONS)[number];

export interface WorldDirectorSignals {
  readonly openQuestCount: number;
  readonly activeQuestCount: number;
  readonly blockedQuestCount: number;
  readonly staleQuestIds: readonly string[];
  readonly urgentClockIds: readonly string[];
  readonly foreshadowClockIds: readonly string[];
  readonly hostileFactionIds: readonly string[];
  readonly recentFailureCount: number;
  readonly recentEventCount: number;
}

export interface WorldDirectorProposal {
  readonly id: string;
  readonly rank: number;
  readonly kind: WorldDirectorActionKind;
  readonly actorEntityId: string | null;
  readonly targetEntityIds: readonly string[];
  readonly rationale: string;
  readonly proposedEffects: readonly string[];
  readonly urgency: WorldDirectorUrgency;
  readonly cooldownKey: string;
  readonly route: WorldDirectorRoute;
}

export interface WorldDirectorSuppression {
  readonly kind: WorldDirectorActionKind;
  readonly targetEntityId: string | null;
  readonly reason: WorldDirectorSuppressionReason;
  readonly rationale: string;
}

export interface WorldDirectorPreparation {
  readonly campaignId: CampaignId;
  readonly campaignState: string;
  readonly contextDigest: string;
  readonly pace: WorldDirectorPace;
  readonly pressureScore: number;
  readonly signals: WorldDirectorSignals;
  readonly proposals: readonly WorldDirectorProposal[];
  readonly suppressed: readonly WorldDirectorSuppression[];
  readonly sourceSnapshot: JsonValue;
}

export interface WorldDirectorTrigger {
  readonly kind: WorldDirectorTriggerKind;
  readonly id: string;
}

export interface WorldDirectorRun extends WorldDirectorPreparation {
  readonly id: string;
  readonly trigger: WorldDirectorTrigger;
  readonly createdAt: IsoTimestamp;
}

export class WorldDirectorContractError extends Error {
  public constructor(
    public readonly code: 'DIRECTOR_INPUT_INVALID' | 'DIRECTOR_OUTPUT_INVALID',
    options?: ErrorOptions,
  ) {
    super('World Director contract validation failed', options);
    this.name = 'WorldDirectorContractError';
  }
}
