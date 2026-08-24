import {
  createNpcLodProfile,
  createTavernOpportunity,
  createTavernPopulationContext,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import {
  TavernPopulationRuleError,
  focusTavernPopulation,
  projectTavernPopulation,
} from './index.js';

const now = '2026-08-24T10:00:00.000Z';
const later = '2026-08-24T11:00:00.000Z';

describe('tavern population projector', () => {
  it('projects factor candidates, preserves identities and exposes an owner-only empty state', () => {
    const owner = candidate('npc-owner', 'OWNER', 'npc-owner', 'Innkeeper', 3);
    const first = projectTavernPopulation({
      currentState: null,
      currentMembers: [],
      context: context(),
      candidates: [owner, candidate('npc-guide', 'LOCATION', 'location-harbor', 'Harbor guide', 0)],
      opportunities: [opportunity()],
      trigger: 'ENTERED',
      at: now,
    });
    expect(first.changed).toBe(true);
    expect(first.state.emptyState).toBe(false);
    expect(first.members.map(({ npcId }) => npcId)).toEqual(['npc-owner', 'npc-guide']);

    const noOp = projectTavernPopulation({
      currentState: first.state,
      currentMembers: first.members,
      context: context(),
      candidates: [owner, candidate('npc-guide', 'LOCATION', 'location-harbor', 'Harbor guide', 0)],
      opportunities: [opportunity()],
      trigger: 'MANUAL_REFRESH',
      at: later,
    });
    expect(noOp.changed).toBe(false);

    const empty = projectTavernPopulation({
      currentState: null,
      currentMembers: [],
      context: context({ recentEventIds: [] }),
      candidates: [owner],
      opportunities: [],
      trigger: 'ENTERED',
      at: now,
    });
    expect(empty.state.emptyState).toBe(true);
  });

  it('changes with time/event context and retains a focused promoted identity', () => {
    const initial = projectTavernPopulation({
      currentState: null,
      currentMembers: [],
      context: context(),
      candidates: [candidate('npc-guide', 'LOCATION', 'location-harbor', 'Harbor guide', 0)],
      opportunities: [],
      trigger: 'ENTERED',
      at: now,
    });
    const focused = focusTavernPopulation({
      state: initial.state,
      members: initial.members,
      npcProfile: profile('npc-guide', 'Harbor guide', 1),
      expectedRevision: 1,
      at: later,
    });
    expect(focused.members[0]).toMatchObject({ isImportant: true, encounterCount: 2 });

    const changed = projectTavernPopulation({
      currentState: focused.state,
      currentMembers: focused.members,
      context: context({
        clockCurrent: 2,
        recentEventIds: ['event-return', 'event-storm'],
      }),
      candidates: [candidate('npc-watcher', 'CLOCK', 'clock-storm', 'Storm watcher', 0)],
      opportunities: [],
      trigger: 'TIME_ADVANCED',
      at: later,
    });
    expect(changed.state.revision).toBe(3);
    expect(changed.members.find(({ npcId }) => npcId === 'npc-guide')).toMatchObject({
      presence: 'PRESENT',
      isImportant: true,
      profile: { lod: 1 },
    });
    expect(changed.members.find(({ npcId }) => npcId === 'npc-watcher')?.presence).toBe('PRESENT');
  });

  it('rejects focus before LOD promotion and source identity replacement', () => {
    const initial = projectTavernPopulation({
      currentState: null,
      currentMembers: [],
      context: context(),
      candidates: [candidate('npc-guide', 'LOCATION', 'location-harbor', 'Harbor guide', 0)],
      opportunities: [],
      trigger: 'ENTERED',
      at: now,
    });
    expect(() =>
      focusTavernPopulation({
        state: initial.state,
        members: initial.members,
        npcProfile: profile('npc-guide', 'Harbor guide', 0),
        expectedRevision: 1,
        at: later,
      }),
    ).toThrow(TavernPopulationRuleError);
    expect(() =>
      projectTavernPopulation({
        currentState: initial.state,
        currentMembers: initial.members,
        context: context({ recentEventIds: ['event-other'] }),
        candidates: [
          candidate('npc-replacement', 'LOCATION', 'location-harbor', 'Harbor guide', 0),
        ],
        opportunities: [],
        trigger: 'EVENT_COMMITTED',
        at: later,
      }),
    ).toThrow(TavernPopulationRuleError);
  });
});

function context(
  options: Readonly<{
    clockCurrent?: number;
    recentEventIds?: readonly string[];
  }> = {},
) {
  return createTavernPopulationContext({
    campaignId: 'campaign-population',
    tavernId: 'tavern-ember',
    worldUpdatedAt: now,
    currentLocationId: 'location-harbor',
    locationRevision: 1,
    clocks: [
      {
        id: 'clock-storm',
        current: options.clockCurrent ?? 1,
        max: 6,
        updatedAt: options.clockCurrent === undefined ? now : later,
      },
    ],
    activeFactions: [],
    recentEventIds: options.recentEventIds ?? ['event-return'],
    historyNpcIds: ['npc-guide'],
  });
}

function candidate(
  id: string,
  sourceKind: 'OWNER' | 'LOCATION' | 'CLOCK',
  sourceId: string,
  role: string,
  lod: 0 | 3,
) {
  return { profile: profile(id, role, lod), sourceKind, sourceId, populationRole: role } as const;
}

function profile(id: string, role: string, lod: 0 | 1 | 3) {
  const shallow = lod === 0;
  const detailed = lod === 3;
  return createNpcLodProfile({
    schemaVersion: 1,
    id,
    campaignId: 'campaign-population',
    constitutionRevision: 1,
    lod,
    revision: lod === 0 ? 1 : 2,
    identityAnchor: `population:${id}`,
    populationRole: role,
    name: shallow ? null : `${role} name`,
    appearance: shallow ? null : `${role} appearance`,
    currentBehavior: shallow ? null : `${role} behavior`,
    career: detailed ? role : null,
    personality: detailed ? `${role} personality` : null,
    goals: detailed ? [`${role} goal`] : [],
    knowledgeFactIds: [],
    relationshipNpcIds: [],
    memoryIds: [],
    secretFactIds: [],
    questIds: [],
    itemIds: [],
    experienceEventIds: [],
    constitutionEvidence: {
      npcRules: 'Knowledge is bounded.',
      society: 'Guild towns.',
      technology: 'Late medieval.',
    },
    generationRecordId: shallow ? null : 'generation-population',
    createdAt: now,
    updatedAt: lod === 0 ? now : later,
  });
}

function opportunity() {
  return createTavernOpportunity({
    id: 'opportunity-event-return',
    kind: 'EVENT',
    sourceId: 'event-return',
    title: 'Returned adventurers',
    detail: 'A recent return changes the common room.',
  });
}
