import {
  createNpcLodProfile,
  createTavernPopulationContext,
  createTavernPopulationMember,
  createTavernPopulationSnapshot,
  createTavernPopulationState,
  type TavernPopulationSnapshot,
} from '@ember-tavern/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  TavernPopulationService,
  type TavernPopulationGateway,
  type TavernPopulationServiceError,
} from './tavern-population-service.js';

describe('TavernPopulationService', () => {
  it('coalesces a population refresh instead of regenerating the roster', async () => {
    const snapshot = populationSnapshot(0);
    const gateway = gatewayFor(snapshot);
    const service = new TavernPopulationService(gateway, { upgrade: vi.fn() }, identity);

    const [first, second] = await Promise.all([
      service.refresh('campaign-population-service', 'ENTERED'),
      service.refresh('campaign-population-service', 'ENTERED'),
    ]);

    expect(first).toEqual(second);
    expect(gateway.project).toHaveBeenCalledTimes(1);
  });

  it('promotes only the focused LOD0 identity before committing importance', async () => {
    const before = populationSnapshot(0);
    const after = createTavernPopulationSnapshot({
      ...before,
      state: createTavernPopulationState({ ...requireState(before), revision: 2 }),
      members: before.members.map((member) =>
        createTavernPopulationMember({
          ...member,
          isImportant: true,
          profile: createNpcLodProfile({
            ...member.profile,
            lod: 1,
            revision: 2,
            name: 'Nera Fen',
            appearance: 'A rain-dark cloak.',
            currentBehavior: 'Studies the tide marks.',
            generationRecordId: 'generation-population-focus',
          }),
        }),
      ),
    });
    const promoted = after.members[0];
    if (promoted === undefined) throw new Error('Promoted population member missing');
    const gateway = gatewayFor(before, after);
    const upgrade = vi.fn(async () => ({ profile: promoted.profile, input: null }));
    const service = new TavernPopulationService(gateway, { upgrade }, identity);

    const [first, second] = await Promise.all([
      service.focus('campaign-population-service', 'npc-population-service', 1),
      service.focus('campaign-population-service', 'npc-population-service', 1),
    ]);

    expect(first).toEqual(after);
    expect(second).toEqual(after);
    expect(upgrade).toHaveBeenCalledTimes(1);
    expect(gateway.focus).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed native snapshot', async () => {
    const gateway: TavernPopulationGateway = {
      load: vi.fn(async () => ({ members: [] }) as never),
      project: vi.fn(),
      focus: vi.fn(),
    };
    await expect(
      new TavernPopulationService(gateway).load('campaign-population-service'),
    ).rejects.toThrow(
      expect.objectContaining({
        code: 'SNAPSHOT_INVALID',
      } satisfies Partial<TavernPopulationServiceError>),
    );
  });
});

function gatewayFor(
  snapshot: TavernPopulationSnapshot,
  focused: TavernPopulationSnapshot = snapshot,
): TavernPopulationGateway {
  return {
    load: vi.fn(async () => snapshot),
    project: vi.fn(async () => snapshot),
    focus: vi.fn(async () => focused),
  };
}

function populationSnapshot(lod: 0 | 1): TavernPopulationSnapshot {
  const context = createTavernPopulationContext({
    campaignId: 'campaign-population-service',
    tavernId: 'tavern-population-service',
    worldUpdatedAt: '2026-08-24T10:00:00.000Z',
    currentLocationId: 'location-population-service',
    locationRevision: 1,
    clocks: [],
    activeFactions: [],
    recentEventIds: [],
    historyNpcIds: [],
  });
  const profile = createNpcLodProfile({
    schemaVersion: 1,
    id: 'npc-population-service',
    campaignId: 'campaign-population-service',
    constitutionRevision: 1,
    lod,
    revision: 1,
    identityAnchor: 'population:location:harbor',
    populationRole: 'Harbor traveler',
    name: lod === 0 ? null : 'Nera Fen',
    appearance: lod === 0 ? null : 'A rain-dark cloak.',
    currentBehavior: lod === 0 ? null : 'Studies the tide marks.',
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
      npcRules: 'NPC knowledge is bounded.',
      society: 'Guild towns',
      technology: 'Late medieval',
    },
    generationRecordId: lod === 0 ? null : 'generation-existing',
    createdAt: '2026-08-24T10:00:00.000Z',
    updatedAt: '2026-08-24T10:00:00.000Z',
  });
  const state = createTavernPopulationState({
    campaignId: context.campaignId,
    tavernId: context.tavernId,
    revision: 1,
    trigger: 'ENTERED',
    context,
    opportunities: [],
    emptyState: false,
    projectedAt: '2026-08-24T10:00:00.000Z',
  });
  return createTavernPopulationSnapshot({
    state,
    members: [
      createTavernPopulationMember({
        npcId: profile.id,
        sourceKind: 'LOCATION',
        sourceId: 'location-population-service',
        populationRole: profile.populationRole,
        presence: 'PRESENT',
        isImportant: false,
        firstSeenAt: '2026-08-24T10:00:00.000Z',
        lastSeenAt: '2026-08-24T10:00:00.000Z',
        encounterCount: 1,
        profile,
      }),
    ],
    cycles: [],
    focusHistory: [],
  });
}

function requireState(snapshot: TavernPopulationSnapshot) {
  if (snapshot.state === null) throw new Error('Population state missing');
  return snapshot.state;
}

function identity() {
  return { operationId: 'population-service-operation', recordId: 'population-service-record' };
}
