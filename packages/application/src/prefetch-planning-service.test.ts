import {
  campaignId,
  isoTimestamp,
  type DirectorBudgetSnapshot,
  type LazyWorldGenerationPlan,
  type PrefetchCandidate,
  type PrefetchCandidateSeed,
  type WorldDirectorRun,
} from '@ember-tavern/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  PrefetchPlanningService,
  type PrefetchPlanSource,
  type PrefetchScheduler,
} from './prefetch-planning-service.js';

const campaign = campaignId('campaign-prefetch-planning');
const at = isoTimestamp('2026-08-24T10:00:00.000Z');

describe('PrefetchPlanningService', () => {
  it('keeps prefetch behind unfinished P0 work', () => {
    const scheduler = fakeScheduler();
    const service = createService(
      [plan('INITIAL_CAREER_POOL', 'career', 'P0', 'PLANNED'), locationPlan()],
      scheduler,
    );

    expect(service.plan({ run: directorRun(), budget: budget(), predictedAt: at })).toEqual([]);
    expect(scheduler.prioritizeP0).toHaveBeenCalledWith(campaign);
    expect(scheduler.schedule).not.toHaveBeenCalled();
  });

  it('supersedes older predictions and schedules the bounded domain result', () => {
    const scheduler = fakeScheduler();
    const service = createService(
      [plan('INITIAL_CAREER_POOL', 'career', 'P0', 'SUCCEEDED'), locationPlan()],
      scheduler,
    );

    const result = service.plan({ run: directorRun(), budget: budget(), predictedAt: at });

    expect(scheduler.invalidate).toHaveBeenCalledWith(campaign, 'SUPERSEDED', 'director-run');
    expect(scheduler.schedule).toHaveBeenCalledTimes(1);
    expect(scheduler.schedule.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        id: 'prefetch:director-run:1',
        lazyIntentKey: 'lazy-location',
        priority: 'P1',
        targetId: 'location-harbor',
      }),
    ]);
    expect(result).toHaveLength(1);
  });

  it('invalidates process-memory work on restart without rescheduling it', () => {
    const scheduler = fakeScheduler();
    const service = createService([], scheduler);

    service.recoverAfterProcessRestart(campaign);

    expect(scheduler.invalidate).toHaveBeenCalledWith(campaign, 'PROCESS_RESTART');
    expect(scheduler.schedule).not.toHaveBeenCalled();
  });
});

function createService(plans: readonly LazyWorldGenerationPlan[], scheduler: FakeScheduler) {
  const source: PrefetchPlanSource = { list: () => plans };
  return new PrefetchPlanningService(source, scheduler, {
    create(run, ordinal) {
      return `prefetch:${run.id}:${ordinal}`;
    },
  });
}

type FakeScheduler = PrefetchScheduler & {
  readonly schedule: ReturnType<typeof vi.fn<PrefetchScheduler['schedule']>>;
  readonly invalidate: ReturnType<typeof vi.fn<PrefetchScheduler['invalidate']>>;
  readonly prioritizeP0: ReturnType<typeof vi.fn<PrefetchScheduler['prioritizeP0']>>;
};

function fakeScheduler(): FakeScheduler {
  return {
    schedule: vi.fn((seeds: readonly PrefetchCandidateSeed[]) =>
      seeds.map((seed): PrefetchCandidate => ({
        ...seed,
        state: 'PREDICTED',
        activeExecutionId: null,
        processId: null,
        errorCode: null,
        revision: 1,
        startedAt: null,
        readyAt: null,
        resolvedAt: null,
        updatedAt: seed.predictedAt,
      })),
    ),
    invalidate: vi.fn(),
    prioritizeP0: vi.fn(),
  };
}

function locationPlan(): LazyWorldGenerationPlan {
  return plan('LOCATION_DETAILS', 'location-harbor', 'P2', 'PLANNED');
}

function plan(
  kind: LazyWorldGenerationPlan['kind'],
  targetId: string,
  priority: LazyWorldGenerationPlan['priority'],
  state: LazyWorldGenerationPlan['state'],
): LazyWorldGenerationPlan {
  return {
    intentKey: kind === 'LOCATION_DETAILS' ? 'lazy-location' : `lazy-${targetId}`,
    campaignId: campaign,
    kind,
    targetId,
    dependsOnIntentKey: null,
    executionMode: priority === 'P0' ? 'ON_DEMAND' : 'BACKGROUND_ELIGIBLE',
    priority,
    state,
    attemptCount: state === 'SUCCEEDED' ? 1 : 0,
    activeRunId: null,
    artifactRef: state === 'SUCCEEDED' ? `${kind}:${targetId}` : null,
    lastErrorCode: null,
    retryable: false,
    revision: state === 'SUCCEEDED' ? 2 : 1,
    createdAt: at,
    startedAt: state === 'SUCCEEDED' ? at : null,
    completedAt: state === 'SUCCEEDED' ? at : null,
    updatedAt: at,
  };
}

function directorRun(): WorldDirectorRun {
  return {
    id: 'director-run',
    campaignId: campaign,
    campaignState: 'TAVERN',
    trigger: { kind: 'PLAYER_ACTION', id: 'turn-1' },
    contextDigest: 'a'.repeat(64),
    pace: 'BALANCED',
    pressureScore: 2,
    signals: {
      openQuestCount: 0,
      activeQuestCount: 0,
      blockedQuestCount: 0,
      staleQuestIds: [],
      urgentClockIds: [],
      foreshadowClockIds: [],
      hostileFactionIds: [],
      recentFailureCount: 0,
      recentEventCount: 1,
    },
    proposals: [
      {
        id: 'proposal-location',
        rank: 1,
        kind: 'WORLD_CHANGE',
        urgency: 'MEDIUM',
        actorEntityId: null,
        targetEntityIds: ['location-harbor'],
        cooldownKey: 'location:harbor',
        rationale: 'A storm approaches the harbor.',
        proposedEffects: ['Prepare the nearby route.'],
        route: 'GENERATOR',
      },
    ],
    suppressed: [],
    sourceSnapshot: { currentLocationId: 'location-harbor' },
    createdAt: at,
  };
}

function budget(): DirectorBudgetSnapshot {
  return {
    campaignId: campaign,
    gameDay: 1,
    gameTimeMinutes: 60,
    activeQuestCount: 0,
    limits: {
      activeQuests: 3,
      dailyEvents: 4,
      urgentEvents: 2,
      npcProactive: 3,
      backgroundChanges: 2,
    },
    usage: { dailyEvents: 1, urgentEvents: 0, npcProactive: 0, backgroundChanges: 1 },
    entries: [
      {
        runId: 'director-run',
        ordinal: 1,
        actionId: 'proposal-location',
        kind: 'WORLD_CHANGE',
        urgency: 'MEDIUM',
        cooldownKey: 'location:harbor',
        category: 'BACKGROUND_CHANGE',
        status: 'APPROVED',
        reason: 'AVAILABLE',
        requestedGameTime: 60,
        eligibleGameTime: 60,
        approvedGameTime: 60,
      },
    ],
    revision: 1,
    updatedAt: at,
  };
}
