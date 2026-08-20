import { LocationInputSchema } from '@ember-tavern/ai-core';
import {
  campaignId,
  createDynamicLocationProfile,
  isoTimestamp,
  locationId,
  type DynamicLocationCandidate,
} from '@ember-tavern/contracts';
import { materializeDynamicLocations } from '@ember-tavern/domain';
import { describe, expect, it, vi } from 'vitest';

import {
  DynamicLocationService,
  type DynamicLocationGateway,
  type DynamicLocationSnapshot,
} from './dynamic-location-service.js';

const campaign = campaignId('campaign-location-service');
const now = isoTimestamp('2026-08-20T10:00:00.000Z');
const evidence = {
  technology: 'Late medieval',
  magic: 'Magic leaves a warm trace.',
  society: 'Guild towns',
  politics: 'Harbor councils',
};

describe('DynamicLocationService', () => {
  it('uses the structured Generator and coalesces the same explicit expansion intent', async () => {
    let graph = initialGraph();
    const gateway: DynamicLocationGateway = {
      load: vi.fn(async () => graph),
      generation: vi.fn(async () => generationSnapshot(graph)),
      commit: vi.fn(async ({ generation }) => {
        const output = generation.validatedOutput as {
          readonly locations: readonly DynamicLocationCandidate[];
        };
        const origin = graph.locations.find(({ id }) => id === 'location-city');
        if (origin === undefined) throw new Error('origin missing');
        const batch = materializeDynamicLocations({
          campaignId: campaign,
          constitution: constitution(),
          origin,
          expansionMode: 'CONNECTED',
          candidates: output.locations,
          existing: graph.locations,
          allowedFactionIds: ['faction-harbor'],
          generationRecordId: generation.generationRecordId,
          at: '2026-08-20T11:00:00.000Z',
        });
        graph = Object.freeze({
          ...graph,
          locations: Object.freeze([...graph.locations, ...batch.locations]),
          connections: Object.freeze(
            batch.connectionPairs.map(([first, second], index) => ({
              id: `edge-service-${index}`,
              campaignId: campaign,
              firstLocationId: locationId(first),
              secondLocationId: locationId(second),
              source: 'GENERATED' as const,
              generationRecordId: generation.generationRecordId as never,
              createdAt: now,
            })),
          ),
        });
        return graph;
      }),
      travel: vi.fn(),
    };
    const service = new DynamicLocationService(gateway, undefined, identity, travelIdentity);
    const [first, second] = await Promise.all([
      service.expand(campaign, 'location-city', 'CONNECTED', 1),
      service.expand(campaign, 'location-city', 'CONNECTED', 1),
    ]);

    expect(first).toEqual(second);
    expect(first.locations).toHaveLength(3);
    expect(first.locations[2]).toMatchObject({
      materialization: 'DETAILED',
      parentLocationId: 'location-region',
    });
    expect(gateway.generation).toHaveBeenCalledTimes(1);
    expect(gateway.commit).toHaveBeenCalledTimes(1);
  });

  it('sends movement as a local revisioned operation without invoking generation', async () => {
    const graph = initialGraph();
    const moved = Object.freeze({
      ...graph,
      state: Object.freeze({
        ...graph.state,
        currentLocationId: locationId('location-region'),
        revision: 2,
      }),
    });
    const gateway: DynamicLocationGateway = {
      load: vi.fn(),
      generation: vi.fn(),
      commit: vi.fn(),
      travel: vi.fn(async () => moved),
    };
    const service = new DynamicLocationService(gateway, undefined, identity, travelIdentity);
    await expect(service.travel(campaign, 'location-region', 1, 'FOOT')).resolves.toEqual(moved);
    expect(gateway.travel).toHaveBeenCalledWith({
      campaignId: campaign,
      targetLocationId: 'location-region',
      expectedRevision: 1,
      mode: 'FOOT',
      eventId: 'travel-service',
      operationId: 'travel-service:operation',
    });
    expect(gateway.generation).not.toHaveBeenCalled();
  });
});

function generationSnapshot(graph: DynamicLocationSnapshot) {
  const origin = graph.locations.find(({ id }) => id === 'location-city');
  if (origin === undefined) throw new Error('origin missing');
  return Object.freeze({
    graph,
    input: LocationInputSchema.parse({
      schemaVersion: 1,
      context: {
        worldId: campaign,
        constitutionRevision: 1,
        contextSummary: 'Materialize one connected place without generating a full map.',
      },
      expansionMode: 'CONNECTED',
      originLocation: {
        id: origin.id,
        name: origin.name,
        kind: origin.locationKind,
        parentLocationId: origin.parentLocationId,
        description: origin.description,
      },
      requestedCount: 1,
      existingLocationIds: graph.locations.map(({ id }) => id),
      existingLocationNames: graph.locations.map(({ name }) => name),
      allowedFactionIds: ['faction-harbor'],
      constitutionEvidence: evidence,
    }),
  });
}

function initialGraph(): DynamicLocationSnapshot {
  const root = profile('location-region', 'Ember Coast', 'REGION', null);
  const city = profile('location-city', 'Ash Harbor', 'CITY', root.id);
  return Object.freeze({
    state: Object.freeze({
      campaignId: campaign,
      currentLocationId: city.id,
      revision: 1,
      updatedAt: now,
    }),
    locations: Object.freeze([root, city]),
    connections: Object.freeze([
      {
        id: 'edge-initial',
        campaignId: campaign,
        firstLocationId: city.id,
        secondLocationId: root.id,
        source: 'INITIAL_HIERARCHY' as const,
        generationRecordId: null,
        createdAt: now,
      },
    ]),
    travelHistory: Object.freeze([]),
  });
}

function profile(
  id: string,
  name: string,
  kind: 'REGION' | 'CITY',
  parentLocationId: string | null,
) {
  return createDynamicLocationProfile({
    schemaVersion: 1,
    id,
    campaignId: campaign,
    constitutionRevision: 1,
    locationKind: kind,
    materialization: 'OUTLINE',
    name,
    description: `${name} description.`,
    parentLocationId,
    atmosphere: null,
    features: [],
    factionIds: ['faction-harbor'],
    currentSituation: null,
    constitutionEvidence: evidence,
    generationRecordId: null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
}

function constitution() {
  return {
    campaignId: campaign,
    schemaVersion: 1 as never,
    revision: 1,
    status: 'LOCKED' as const,
    worldType: 'Low fantasy',
    era: 'Late medieval',
    ...evidence,
    peoples: ['Harbor folk'],
    economy: 'Coin and barter',
    combatScale: 'Small-scale',
    deathRules: 'Death is permanent.',
    careerRules: 'Social roles.',
    equipmentRules: 'Local craft.',
    npcRules: 'Bounded knowledge.',
    traitRules: 'Tradeoffs.',
    taboos: [],
    createdAt: now,
    updatedAt: now,
    lockedAt: now,
  };
}

function identity() {
  return {
    requestId: 'request-location-service',
    generationRecordId: 'generation-location-service' as never,
    idempotencyKey: 'location:service' as never,
  };
}

function travelIdentity() {
  return { eventId: 'travel-service', operationId: 'travel-service:operation' };
}
