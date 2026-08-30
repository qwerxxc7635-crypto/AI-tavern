import {
  campaignId,
  createDynamicLocationProfile,
  isoTimestamp,
  schemaVersion,
  type DynamicLocationCandidate,
  type DynamicLocationProfile,
  type LocationConnection,
  type WorldConstitution,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import {
  DynamicLocationRuleError,
  materializeDynamicLocations,
  planLocationTravel,
  validateLocationTopology,
} from './index.js';

const constitution: WorldConstitution = {
  campaignId: campaignId('campaign-location-domain'),
  schemaVersion: schemaVersion(1),
  revision: 1,
  status: 'LOCKED',
  worldType: 'Low fantasy coast',
  era: 'Late medieval',
  technology: 'Late medieval',
  magic: 'Magic leaves a warm trace.',
  peoples: ['Harbor folk'],
  society: 'Guild towns',
  politics: 'Harbor councils',
  economy: 'Coin and barter',
  combatScale: 'Small-scale',
  deathRules: 'Death is permanent.',
  careerRules: 'Careers are social roles.',
  equipmentRules: 'Equipment follows local craft.',
  npcRules: 'NPC knowledge is bounded.',
  traitRules: 'Traits require tradeoffs.',
  taboos: [],
  createdAt: isoTimestamp('2026-08-20T09:00:00.000Z'),
  updatedAt: isoTimestamp('2026-08-20T09:00:00.000Z'),
  lockedAt: isoTimestamp('2026-08-20T09:00:00.000Z'),
};

const evidence = {
  technology: constitution.technology,
  magic: constitution.magic,
  society: constitution.society,
  politics: constitution.politics,
};

describe('dynamic location rules', () => {
  it('materializes only requested children and creates navigable hierarchy edges', () => {
    const origin = profile('location-city', 'Ash Harbor', null, 'CITY');
    const batch = materializeDynamicLocations({
      campaignId: constitution.campaignId,
      constitution,
      origin,
      expansionMode: 'CHILDREN',
      candidates: [candidate('location-market', 'Cinder Market', origin.id)],
      existing: [origin],
      allowedFactionIds: ['faction-lantern'],
      generationRecordId: 'generation-market',
      at: '2026-08-20T10:00:00.000Z',
    });
    expect(batch.locations).toHaveLength(1);
    expect(batch.locations[0]).toMatchObject({
      parentLocationId: origin.id,
      materialization: 'DETAILED',
    });
    expect(batch.connectionPairs).toEqual([['location-city', 'location-market']]);
  });

  it('materializes a connected peer so travel can leave the preset city', () => {
    const city = profile('location-city', 'Ash Harbor', null, 'CITY');
    const road = candidate('location-road', 'North Beacon Road', null);
    const batch = materializeDynamicLocations({
      campaignId: constitution.campaignId,
      constitution,
      origin: city,
      expansionMode: 'CONNECTED',
      candidates: [{ ...road, kind: 'REGION', connections: [city.id] }],
      existing: [city],
      allowedFactionIds: ['faction-lantern'],
      generationRecordId: 'generation-road',
      at: '2026-08-20T10:00:00.000Z',
    });
    const generated = batch.locations[0];
    if (generated === undefined) throw new Error('generated location missing');
    const connection: LocationConnection = {
      id: 'connection-city-road',
      campaignId: constitution.campaignId,
      firstLocationId: city.id,
      secondLocationId: generated.id,
      source: 'GENERATED',
      generationRecordId: generated.generationRecordId,
      createdAt: isoTimestamp('2026-08-20T10:00:00.000Z'),
    };
    const next = planLocationTravel({
      state: {
        campaignId: constitution.campaignId,
        currentLocationId: city.id,
        revision: 1,
        updatedAt: isoTimestamp('2026-08-20T09:00:00.000Z'),
      },
      targetLocationId: generated.id,
      mode: 'ROAD',
      locations: [city, ...batch.locations],
      connections: [connection],
      at: '2026-08-20T11:00:00.000Z',
    });
    expect(next).toMatchObject({ currentLocationId: 'location-road', revision: 2 });
  });

  it('rejects cycles, missing parents, duplicate identities, and unauthorized references', () => {
    const first = profile('location-first', 'First', 'location-second', 'REGION');
    const second = profile('location-second', 'Second', 'location-first', 'REGION');
    expect(() => validateLocationTopology([first, second])).toThrow(
      expect.objectContaining({ code: 'LOCATION_TOPOLOGY_INVALID' }),
    );
    expect(() =>
      validateLocationTopology([profile('location-orphan', 'Orphan', 'missing')]),
    ).toThrow(DynamicLocationRuleError);

    const origin = profile('location-city', 'Ash Harbor', null, 'CITY');
    expect(() =>
      materializeDynamicLocations({
        campaignId: constitution.campaignId,
        constitution,
        origin,
        expansionMode: 'CHILDREN',
        candidates: [
          {
            ...candidate('location-market', 'Cinder Market', origin.id),
            factionIds: ['faction-not-allowed'],
          },
        ],
        existing: [origin],
        allowedFactionIds: ['faction-lantern'],
        generationRecordId: 'generation-invalid',
        at: '2026-08-20T10:00:00.000Z',
      }),
    ).toThrow(expect.objectContaining({ code: 'LOCATION_REFERENCE_UNAUTHORIZED' }));
  });

  it('rejects non-adjacent travel without changing the stored revision', () => {
    const city = profile('location-city', 'Ash Harbor', null, 'CITY');
    const ruin = profile('location-ruin', 'Old Ruin', null, 'RUIN');
    expect(() =>
      planLocationTravel({
        state: {
          campaignId: constitution.campaignId,
          currentLocationId: city.id,
          revision: 4,
          updatedAt: isoTimestamp('2026-08-20T09:00:00.000Z'),
        },
        targetLocationId: ruin.id,
        mode: 'FOOT',
        locations: [city, ruin],
        connections: [],
        at: '2026-08-20T11:00:00.000Z',
      }),
    ).toThrow(expect.objectContaining({ code: 'LOCATION_TRAVEL_INVALID' }));
  });
});

function profile(
  id: string,
  name: string,
  parentLocationId: string | null,
  locationKind: DynamicLocationProfile['locationKind'] = 'SPECIAL',
): DynamicLocationProfile {
  return createDynamicLocationProfile({
    schemaVersion: 1,
    id,
    campaignId: constitution.campaignId,
    constitutionRevision: 1,
    locationKind,
    materialization: 'OUTLINE',
    name,
    description: `${name} is established in the initial world.`,
    parentLocationId,
    atmosphere: null,
    features: [],
    factionIds: [],
    currentSituation: null,
    constitutionEvidence: evidence,
    generationRecordId: null,
    revision: 1,
    createdAt: '2026-08-20T09:00:00.000Z',
    updatedAt: '2026-08-20T09:00:00.000Z',
  });
}

function candidate(
  id: string,
  name: string,
  parentLocationId: string | null,
): DynamicLocationCandidate {
  return {
    id,
    name,
    kind: 'DISTRICT',
    parentLocationId,
    description: `${name} lies along an old harbor route.`,
    atmosphere: 'Wind-worn and watchful.',
    features: ['A marked roadside shelter'],
    factionIds: ['faction-lantern'],
    connections: [],
    currentSituation: 'Travelers are adapting to a changed route.',
    constitutionEvidence: evidence,
  };
}
