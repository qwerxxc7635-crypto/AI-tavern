import { describe, expect, it } from 'vitest';

import {
  TavernPopulationContractError,
  createNpcLodProfile,
  createTavernOpportunity,
  createTavernPopulationContext,
  createTavernPopulationMember,
  createTavernPopulationState,
} from './index.js';

const now = '2026-08-24T10:00:00.000Z';

describe('tavern population contract', () => {
  it('captures world, location, time, faction, event and history factors', () => {
    const context = createTavernPopulationContext({
      campaignId: 'campaign-population',
      tavernId: 'tavern-ember',
      worldUpdatedAt: now,
      currentLocationId: 'location-harbor',
      locationRevision: 2,
      clocks: [{ id: 'clock-storm', current: 2, max: 6, updatedAt: now }],
      activeFactions: [
        {
          id: 'faction-lantern',
          revision: 3,
          currentAction: 'Guard the harbor road.',
          playerRelation: 'FRIENDLY',
          territoryLocationIds: ['location-harbor'],
        },
      ],
      recentEventIds: ['event-return'],
      historyNpcIds: ['npc-guide'],
    });
    const member = createTavernPopulationMember({
      npcId: 'npc-guide',
      sourceKind: 'LOCATION',
      sourceId: 'location-harbor',
      populationRole: 'Harbor guide',
      presence: 'PRESENT',
      isImportant: true,
      firstSeenAt: now,
      lastSeenAt: now,
      encounterCount: 2,
      profile: profile(1),
    });
    const opportunity = createTavernOpportunity({
      id: 'opportunity-faction-lantern',
      kind: 'FACTION',
      sourceId: 'faction-lantern',
      title: 'Lantern Guild',
      detail: 'Guard the harbor road.',
    });
    const state = createTavernPopulationState({
      campaignId: 'campaign-population',
      tavernId: 'tavern-ember',
      revision: 1,
      trigger: 'EVENT_COMMITTED',
      context,
      opportunities: [opportunity],
      emptyState: false,
      projectedAt: now,
    });
    expect(member.profile.lod).toBe(1);
    expect(state.context).toEqual(context);
    expect(state.opportunities).toEqual([opportunity]);
  });

  it('rejects duplicate factors and member/profile identity drift', () => {
    expect(() =>
      createTavernPopulationContext({
        campaignId: 'campaign-population',
        tavernId: 'tavern-ember',
        worldUpdatedAt: now,
        currentLocationId: 'location-harbor',
        locationRevision: 1,
        clocks: [
          { id: 'clock-storm', current: 0, max: 6, updatedAt: now },
          { id: 'clock-storm', current: 1, max: 6, updatedAt: now },
        ],
        activeFactions: [],
        recentEventIds: [],
        historyNpcIds: [],
      }),
    ).toThrow(TavernPopulationContractError);
    expect(() =>
      createTavernPopulationMember({
        npcId: 'npc-other',
        sourceKind: 'LOCATION',
        sourceId: 'location-harbor',
        populationRole: 'Harbor guide',
        presence: 'PRESENT',
        isImportant: false,
        firstSeenAt: now,
        lastSeenAt: now,
        encounterCount: 1,
        profile: profile(0),
      }),
    ).toThrow(TavernPopulationContractError);
  });
});

function profile(lod: 0 | 1) {
  return createNpcLodProfile({
    schemaVersion: 1,
    id: 'npc-guide',
    campaignId: 'campaign-population',
    constitutionRevision: 1,
    lod,
    revision: lod + 1,
    identityAnchor: 'population:tavern-ember:location:location-harbor',
    populationRole: 'Harbor guide',
    name: lod === 0 ? null : 'Iven',
    appearance: lod === 0 ? null : 'A weathered guide.',
    currentBehavior: lod === 0 ? null : 'Watching the door.',
    career: null,
    personality: null,
    goals: [],
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
    generationRecordId: lod === 0 ? null : 'generation-guide',
    createdAt: now,
    updatedAt: now,
  });
}
