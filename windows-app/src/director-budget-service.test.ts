import type { DirectorBudgetSnapshot, WorldDirectorRun } from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import {
  DirectorBudgetService,
  DirectorBudgetServiceError,
  type DirectorBudgetGateway,
  type DirectorScheduler,
} from './director-budget-service.js';

describe('DirectorBudgetService', () => {
  it('admits a committed Director run without placing player P0 work in the budget channel', async () => {
    const scheduler = new FakeScheduler();
    const gateway = new FakeGateway();
    const service = new DirectorBudgetService(scheduler, gateway);
    const result = await service.schedule(
      'campaign-budget-service',
      'PLAYER_ACTION',
      'event-player-p0',
    );
    expect(result.budget.entries[0]).toMatchObject({ status: 'APPROVED' });
    expect(gateway.command).toEqual({
      campaignId: 'campaign-budget-service',
      runId: 'run-service',
      occurredAt: '2026-08-24T16:00:00.000Z',
    });
  });

  it('preserves the cause when native admission fails', async () => {
    const service = new DirectorBudgetService(new FakeScheduler(), {
      async admit() {
        throw new Error('native failed');
      },
      async get() {
        return null;
      },
    });
    await expect(service.schedule('campaign-budget-service', 'MANUAL', 'manual')).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof DirectorBudgetServiceError &&
        error.code === 'BUDGET_ADMISSION_FAILED' &&
        error.cause instanceof Error,
    );
  });
});

class FakeScheduler implements DirectorScheduler {
  public async schedule(): Promise<WorldDirectorRun> {
    return run;
  }
}
class FakeGateway implements DirectorBudgetGateway {
  public command: Readonly<Record<string, unknown>> | null = null;
  public async admit(command: Readonly<Record<string, unknown>>): Promise<DirectorBudgetSnapshot> {
    this.command = command;
    return budget;
  }
  public async get(): Promise<DirectorBudgetSnapshot | null> {
    return budget;
  }
}
const run = {
  id: 'run-service',
  campaignId: 'campaign-budget-service',
  createdAt: '2026-08-24T16:00:00.000Z',
} as WorldDirectorRun;
const budget = {
  campaignId: 'campaign-budget-service',
  gameDay: 0,
  gameTimeMinutes: 0,
  activeQuestCount: 0,
  limits: {
    activeQuests: 4,
    dailyEvents: 4,
    urgentEvents: 2,
    npcProactive: 2,
    backgroundChanges: 3,
  },
  usage: { dailyEvents: 1, urgentEvents: 0, npcProactive: 0, backgroundChanges: 0 },
  revision: 1,
  entries: [
    {
      runId: 'run-service',
      ordinal: 1,
      actionId: 'action-1',
      kind: 'OPPORTUNITY',
      urgency: 'MEDIUM',
      cooldownKey: 'director:opportunity:location',
      category: 'DAILY_EVENT',
      status: 'APPROVED',
      requestedGameTime: 0,
      eligibleGameTime: 0,
      approvedGameTime: 0,
      reason: 'AVAILABLE',
    },
  ],
  updatedAt: '2026-08-24T16:00:00.000Z',
} as unknown as DirectorBudgetSnapshot;
