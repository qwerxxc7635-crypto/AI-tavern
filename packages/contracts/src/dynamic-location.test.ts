import { describe, expect, it } from 'vitest';

import {
  DynamicLocationContractError,
  createDynamicLocationProfile,
  parseDynamicLocationProfile,
  type LocationMaterializationLevel,
} from './index.js';

function location(materialization: LocationMaterializationLevel = 'DETAILED') {
  return createDynamicLocationProfile({
    schemaVersion: 1,
    id: 'location-cinder-market',
    campaignId: 'campaign-locations',
    constitutionRevision: 1,
    locationKind: 'DISTRICT',
    materialization,
    name: 'Cinder Market',
    description: 'A covered market beside the old seawall.',
    parentLocationId: 'location-ash-harbor',
    atmosphere: materialization === 'DETAILED' ? 'Salt-damp and crowded.' : null,
    features: materialization === 'DETAILED' ? ['Bell-marked exchange hall'] : [],
    factionIds: ['faction-lantern'],
    currentSituation:
      materialization === 'DETAILED' ? 'Merchants are withholding route charts.' : null,
    constitutionEvidence: {
      technology: 'Late medieval',
      magic: 'Magic leaves a warm trace.',
      society: 'Guild towns',
      politics: 'Harbor councils',
    },
    generationRecordId: materialization === 'DETAILED' ? 'generation-location' : null,
    revision: 1,
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
  });
}

describe('dynamic location contracts', () => {
  it.each(['OUTLINE', 'DETAILED'] as const)('round-trips a %s location', (level) => {
    const value = location(level);
    expect(parseDynamicLocationProfile(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(Object.isFrozen(value.features)).toBe(true);
  });

  it('requires detailed locations to carry atmosphere, features, and current situation', () => {
    expect(() => createDynamicLocationProfile({ ...location(), features: [] })).toThrow(
      expect.objectContaining({ path: 'materialization' }),
    );
    expect(() =>
      createDynamicLocationProfile({ ...location(), parentLocationId: location().id }),
    ).toThrow(expect.objectContaining({ path: 'parentLocationId' }));
  });

  it('rejects duplicate features and unknown persisted fields', () => {
    expect(() =>
      createDynamicLocationProfile({
        ...location(),
        features: ['Old bell', 'Ｏｌｄ　ｂｅｌｌ'],
      }),
    ).toThrow(expect.objectContaining({ code: 'LOCATION_DUPLICATE' }));
    expect(() => parseDynamicLocationProfile({ ...location(), gridCoordinate: [4, 9] })).toThrow(
      DynamicLocationContractError,
    );
  });
});
