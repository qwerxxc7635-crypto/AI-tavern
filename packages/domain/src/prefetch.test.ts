import {
  campaignId,
  isoTimestamp,
  type DirectorBudgetSnapshot,
  type LazyWorldGenerationPlan,
  type WorldDirectorRun,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import { predictPrefetch } from './prefetch.js';

const campaign = campaignId('campaign-prefetch');
const at = isoTimestamp('2026-08-24T13:00:00.000Z');

describe('predictPrefetch', () => {
  it('promotes approved Director targets to P1 and bounds P2 by remaining capacity', () => {
    const result = predictPrefetch({
      run: run(),
      budget: budget({ backgroundChanges: 1 }),
      plans: [
        plan('LOCATION_DETAILS', 'location-current'),
        plan('LOCATION_DETAILS', 'location-other'),
        plan('FACTION_DETAILS', 'faction-hostile'),
      ],
      predictedAt: at,
      createCandidateId: (ordinal) => `prefetch-${ordinal}`,
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: 'prefetch-1',
        kind: 'FACTION_DETAILS',
        targetId: 'faction-hostile',
        priority: 'P1',
        sourceActionId: 'director-action-1',
      }),
      expect.objectContaining({
        id: 'prefetch-2',
        kind: 'LOCATION_DETAILS',
        targetId: 'location-current',
        priority: 'P2',
        sourceActionId: null,
      }),
      expect.objectContaining({
        id: 'prefetch-3',
        kind: 'LOCATION_DETAILS',
        targetId: 'location-other',
        priority: 'P2',
      }),
    ]);
  });

  it('does not promote deferred actions or expose Director source details', () => {
    const source = run();
    const result = predictPrefetch({
      run: source,
      budget: budget({ backgroundChanges: 2 }, 'DEFERRED'),
      plans: [plan('FACTION_DETAILS', 'faction-hostile')],
      predictedAt: at,
      createCandidateId: () => 'prefetch-private',
    });

    expect(result[0]).toMatchObject({ priority: 'P2', sourceActionId: null });
    expect(JSON.stringify(result)).not.toContain('privateKnowledge');
    expect(JSON.stringify(result)).not.toContain('quest-hidden');
  });

  it('rejects mixed campaigns and stale budget snapshots', () => {
    expect(() =>
      predictPrefetch({
        run: run(),
        budget: { ...budget({ backgroundChanges: 0 }), campaignId: campaignId('other') },
        plans: [],
        predictedAt: at,
        createCandidateId: () => 'candidate',
      }),
    ).toThrow('different campaigns');
    expect(() =>
      predictPrefetch({
        run: run(),
        budget: {
          ...budget({ backgroundChanges: 0 }),
          updatedAt: isoTimestamp('2026-08-24T12:59:59.000Z'),
        },
        plans: [],
        predictedAt: at,
        createCandidateId: () => 'candidate',
      }),
    ).toThrow('requires Director Budget admission');
  });
});

function run(): WorldDirectorRun {
  return {
    id: 'director-run-prefetch',
    campaignId: campaign,
    campaignState: 'TAVERN',
    trigger: { kind: 'PLAYER_ACTION', id: 'event-prefetch' },
    contextDigest: 'a'.repeat(64),
    pace: 'BALANCED',
    pressureScore: 4,
    signals: {
      openQuestCount: 1,
      activeQuestCount: 1,
      blockedQuestCount: 0,
      staleQuestIds: [],
      urgentClockIds: [],
      foreshadowClockIds: [],
      hostileFactionIds: ['faction-hostile'],
      recentFailureCount: 0,
      recentEventCount: 1,
    },
    proposals: [
      {
        id: 'director-action-1',
        rank: 1,
        kind: 'FACTION_ACTION',
        actorEntityId: 'faction-hostile',
        targetEntityIds: [],
        rationale: 'The faction is active.',
        proposedEffects: ['Prepare an action candidate.'],
        urgency: 'MEDIUM',
        cooldownKey: 'director:faction:faction-hostile',
        route: 'FACTION_RULES',
      },
    ],
    suppressed: [],
    sourceSnapshot: {
      campaignId: campaign,
      currentLocationId: 'location-current',
      hiddenQuestId: 'quest-hidden',
      privateKnowledge: 'must never enter a prefetch candidate',
    },
    createdAt: at,
  };
}

function budget(
  usage: { readonly backgroundChanges: number },
  status: 'APPROVED' | 'DEFERRED' = 'APPROVED',
): DirectorBudgetSnapshot {
  return {
    campaignId: campaign,
    gameDay: 0,
    gameTimeMinutes: 60,
    activeQuestCount: 1,
    limits: {
      activeQuests: 4,
      dailyEvents: 4,
      urgentEvents: 2,
      npcProactive: 2,
      backgroundChanges: 3,
    },
    usage: {
      dailyEvents: 0,
      urgentEvents: 0,
      npcProactive: 0,
      backgroundChanges: usage.backgroundChanges,
    },
    revision: 1,
    entries: [
      {
        runId: 'director-run-prefetch',
        ordinal: 1,
        actionId: 'director-action-1',
        kind: 'FACTION_ACTION',
        urgency: 'MEDIUM',
        cooldownKey: 'director:faction:faction-hostile',
        category: 'BACKGROUND_CHANGE',
        status,
        requestedGameTime: 60,
        eligibleGameTime: 60,
        approvedGameTime: status === 'APPROVED' ? 60 : null,
        reason: status === 'APPROVED' ? 'AVAILABLE' : 'BACKGROUND_LIMIT',
      },
    ],
    updatedAt: at,
  };
}

function plan(
  kind: 'LOCATION_DETAILS' | 'FACTION_DETAILS',
  targetId: string,
): LazyWorldGenerationPlan {
  return {
    intentKey: `lazy:${campaign}:${kind.toLowerCase()}:${targetId}`,
    campaignId: campaign,
    kind,
    targetId,
    executionMode: 'BACKGROUND_ELIGIBLE',
    priority: 'P2',
    state: 'PLANNED',
    dependsOnIntentKey: null,
    attemptCount: 0,
    activeRunId: null,
    artifactRef: null,
    lastErrorCode: null,
    retryable: false,
    revision: 1,
    createdAt: at,
    startedAt: null,
    completedAt: null,
    updatedAt: at,
  };
}
