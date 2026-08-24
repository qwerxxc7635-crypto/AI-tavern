import type { CampaignId, IsoTimestamp } from './foundation.js';
import type { WorldDirectorActionKind, WorldDirectorUrgency } from './world-director.js';

export const DIRECTOR_BUDGET_CATEGORIES = [
  'MAINTENANCE',
  'DAILY_EVENT',
  'URGENT_EVENT',
  'NPC_PROACTIVE',
  'BACKGROUND_CHANGE',
] as const;
export type DirectorBudgetCategory = (typeof DIRECTOR_BUDGET_CATEGORIES)[number];
export const DIRECTOR_BUDGET_STATUSES = ['APPROVED', 'DEFERRED', 'REJECTED'] as const;
export type DirectorBudgetStatus = (typeof DIRECTOR_BUDGET_STATUSES)[number];
export const DIRECTOR_BUDGET_REASONS = [
  'AVAILABLE',
  'DAILY_LIMIT',
  'URGENT_LIMIT',
  'NPC_LIMIT',
  'BACKGROUND_LIMIT',
  'ACTIVE_QUEST_LIMIT',
  'COOLDOWN',
] as const;
export type DirectorBudgetReason = (typeof DIRECTOR_BUDGET_REASONS)[number];

export interface DirectorBudgetUsage {
  readonly dailyEvents: number;
  readonly urgentEvents: number;
  readonly npcProactive: number;
  readonly backgroundChanges: number;
}
export interface DirectorBudgetEntry {
  readonly runId: string;
  readonly ordinal: number;
  readonly actionId: string;
  readonly kind: WorldDirectorActionKind;
  readonly urgency: WorldDirectorUrgency;
  readonly cooldownKey: string;
  readonly category: DirectorBudgetCategory;
  readonly status: DirectorBudgetStatus;
  readonly requestedGameTime: number;
  readonly eligibleGameTime: number;
  readonly approvedGameTime: number | null;
  readonly reason: DirectorBudgetReason;
}
export interface DirectorBudgetSnapshot {
  readonly campaignId: CampaignId;
  readonly gameDay: number;
  readonly gameTimeMinutes: number;
  readonly activeQuestCount: number;
  readonly limits: DirectorBudgetUsage & { readonly activeQuests: number };
  readonly usage: DirectorBudgetUsage;
  readonly revision: number;
  readonly entries: readonly DirectorBudgetEntry[];
  readonly updatedAt: IsoTimestamp;
}
export class DirectorBudgetContractError extends Error {
  public constructor(
    public readonly code: 'DIRECTOR_BUDGET_INPUT_INVALID' | 'DIRECTOR_BUDGET_CONFLICT',
    options?: ErrorOptions,
  ) {
    super('Director Budget contract validation failed', options);
    this.name = 'DirectorBudgetContractError';
  }
}
