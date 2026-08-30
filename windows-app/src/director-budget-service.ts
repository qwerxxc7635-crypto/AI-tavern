import { invoke } from '@tauri-apps/api/core';

import {
  DIRECTOR_BUDGET_CATEGORIES,
  DIRECTOR_BUDGET_REASONS,
  DIRECTOR_BUDGET_STATUSES,
  WORLD_DIRECTOR_ACTION_KINDS,
  WORLD_DIRECTOR_TRIGGER_KINDS,
  WORLD_DIRECTOR_URGENCIES,
  campaignId,
  isoTimestamp,
  type DirectorBudgetSnapshot,
  type WorldDirectorRun,
  type WorldDirectorTriggerKind,
} from '@ember-tavern/contracts';

import { worldDirectorService } from './world-director-service.js';

export interface DirectorScheduler {
  schedule(
    campaignIdValue: string,
    triggerKind: WorldDirectorTriggerKind,
    triggerId: string,
  ): Promise<WorldDirectorRun>;
}
export interface DirectorBudgetGateway {
  admit(command: Readonly<Record<string, unknown>>): Promise<DirectorBudgetSnapshot>;
  get(campaignIdValue: string): Promise<DirectorBudgetSnapshot | null>;
}
export interface ScheduledDirectorRun {
  readonly run: WorldDirectorRun;
  readonly budget: DirectorBudgetSnapshot;
}

export const tauriDirectorBudgetGateway: DirectorBudgetGateway = {
  async admit(command) {
    const expected = requireText(command['campaignId'], 'Budget campaign');
    return parseBudget(await invoke<unknown>('director_budget_admit', { command }), expected);
  },
  async get(campaignIdValue) {
    const value = await invoke<unknown>('director_budget_get', { campaignId: campaignIdValue });
    return value === null ? null : parseBudget(value, campaignIdValue);
  },
};

export class DirectorBudgetService {
  public constructor(
    private readonly director: DirectorScheduler = worldDirectorService,
    private readonly gateway: DirectorBudgetGateway = tauriDirectorBudgetGateway,
  ) {}

  public async schedule(
    campaignIdValue: string,
    triggerKind: WorldDirectorTriggerKind,
    triggerId: string,
  ): Promise<ScheduledDirectorRun> {
    campaignId(campaignIdValue);
    if (!WORLD_DIRECTOR_TRIGGER_KINDS.includes(triggerKind))
      throw new DirectorBudgetServiceError('TRIGGER_KIND_INVALID');
    let run: WorldDirectorRun;
    try {
      run = await this.director.schedule(campaignIdValue, triggerKind, triggerId);
    } catch (error) {
      throw new DirectorBudgetServiceError('DIRECTOR_SCHEDULE_FAILED', { cause: error });
    }
    try {
      const budget = await this.gateway.admit({
        campaignId: campaignIdValue,
        runId: run.id,
        occurredAt: run.createdAt,
      });
      return Object.freeze({ run, budget });
    } catch (error) {
      throw new DirectorBudgetServiceError('BUDGET_ADMISSION_FAILED', { cause: error });
    }
  }

  public async get(campaignIdValue: string): Promise<DirectorBudgetSnapshot | null> {
    campaignId(campaignIdValue);
    try {
      return await this.gateway.get(campaignIdValue);
    } catch (error) {
      throw new DirectorBudgetServiceError('BUDGET_READ_FAILED', { cause: error });
    }
  }
}

export const directorBudgetService = new DirectorBudgetService();

export class DirectorBudgetServiceError extends Error {
  public constructor(
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super('Director Budget operation failed', options);
    this.name = 'DirectorBudgetServiceError';
  }
}

function parseBudget(value: unknown, expectedCampaignId: string): DirectorBudgetSnapshot {
  const row = requireRecord(value, 'Director Budget');
  if (campaignId(requireText(row['campaignId'], 'Budget campaign')) !== expectedCampaignId)
    throw new TypeError('Director Budget belongs to another campaign');
  requireInteger(row['gameDay'], 'Budget day', 0);
  requireInteger(row['gameTimeMinutes'], 'Budget time', 0);
  requireInteger(row['activeQuestCount'], 'Budget active Quest count', 0);
  requireInteger(row['revision'], 'Budget revision', 1);
  isoTimestamp(requireText(row['updatedAt'], 'Budget updatedAt'));
  const limits = requireRecord(row['limits'], 'Budget limits');
  const usage = requireRecord(row['usage'], 'Budget usage');
  for (const key of [
    'activeQuests',
    'dailyEvents',
    'urgentEvents',
    'npcProactive',
    'backgroundChanges',
  ])
    requireInteger(limits[key], `Budget limit ${key}`, 0);
  for (const key of ['dailyEvents', 'urgentEvents', 'npcProactive', 'backgroundChanges'])
    requireInteger(usage[key], `Budget usage ${key}`, 0);
  if (!Array.isArray(row['entries'])) throw new TypeError('Budget entries are invalid');
  for (const valueEntry of row['entries']) {
    const entry = requireRecord(valueEntry, 'Budget entry');
    requireText(entry['runId'], 'Budget run');
    requireInteger(entry['ordinal'], 'Budget ordinal', 1);
    requireText(entry['actionId'], 'Budget action');
    requireEnum(WORLD_DIRECTOR_ACTION_KINDS, entry['kind'], 'Budget action kind');
    requireEnum(WORLD_DIRECTOR_URGENCIES, entry['urgency'], 'Budget urgency');
    requireText(entry['cooldownKey'], 'Budget cooldown');
    requireEnum(DIRECTOR_BUDGET_CATEGORIES, entry['category'], 'Budget category');
    requireEnum(DIRECTOR_BUDGET_STATUSES, entry['status'], 'Budget status');
    requireEnum(DIRECTOR_BUDGET_REASONS, entry['reason'], 'Budget reason');
    requireInteger(entry['requestedGameTime'], 'Budget requested time', 0);
    requireInteger(entry['eligibleGameTime'], 'Budget eligible time', 0);
    if (entry['approvedGameTime'] !== null)
      requireInteger(entry['approvedGameTime'], 'Budget approved time', 0);
  }
  return value as DirectorBudgetSnapshot;
}
function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${label} is invalid`);
  return value as Record<string, unknown>;
}
function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0)
    throw new TypeError(`${label} is invalid`);
  return value;
}
function requireInteger(value: unknown, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    throw new TypeError(`${label} is invalid`);
  return value as number;
}
function requireEnum<const T extends readonly string[]>(
  values: T,
  value: unknown,
  label: string,
): T[number] {
  if (typeof value !== 'string' || !values.includes(value))
    throw new TypeError(`${label} is invalid`);
  return value as T[number];
}
