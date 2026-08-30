import {
  campaignId,
  factionId,
  isoTimestamp,
  locationId,
  schemaVersion,
  type WorldBible,
  type WorldConstitution,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import {
  LazyWorldGenerationPlanningError,
  buildCoreWorldGenerationPlan,
} from './lazy-world-generation.js';

const campaign = campaignId('campaign-lazy-plan');
const at = isoTimestamp('2026-08-24T12:00:00.000Z');

describe('buildCoreWorldGenerationPlan', () => {
  it('plans only bounded outlines and on-demand entry slices', () => {
    const plans = buildCoreWorldGenerationPlan({
      world: world(),
      constitution: constitution(),
      hasWorldSeed: true,
      plannedAt: at,
    });
    expect(plans.map(({ kind }) => kind)).toEqual([
      'INITIAL_CAREER_POOL',
      'TAVERN',
      'TAVERN_ROSTER',
      'LOCATION_DETAILS',
      'LOCATION_DETAILS',
      'FACTION_DETAILS',
    ]);
    expect(plans.filter(({ executionMode }) => executionMode === 'ON_DEMAND')).toHaveLength(3);
    expect(
      plans.filter(({ executionMode }) => executionMode === 'BACKGROUND_ELIGIBLE'),
    ).toHaveLength(3);
    expect(plans.find(({ kind }) => kind === 'TAVERN_ROSTER')?.dependsOnIntentKey).toContain(
      ':tavern:',
    );
    expect(new Set(plans.map(({ intentKey }) => intentKey)).size).toBe(plans.length);
  });

  it('requires a locked constitution and durable World Seed', () => {
    expect(() =>
      buildCoreWorldGenerationPlan({
        world: world(),
        constitution: { ...constitution(), status: 'DRAFT', lockedAt: null },
        hasWorldSeed: true,
        plannedAt: at,
      }),
    ).toThrow(LazyWorldGenerationPlanningError);
    expect(() =>
      buildCoreWorldGenerationPlan({
        world: world(),
        constitution: constitution(),
        hasWorldSeed: false,
        plannedAt: at,
      }),
    ).toThrow(LazyWorldGenerationPlanningError);
  });
});

function world(): WorldBible {
  return Object.freeze({
    campaignId: campaign,
    schemaVersion: schemaVersion(1),
    name: 'Ash Coast',
    currentRegion: 'Harbor',
    summary: 'A storm coast.',
    coreConflict: 'The beacon dims.',
    technologyLevel: 'Iron age',
    powerRules: ['Oaths bind flame.'],
    factions: [
      {
        id: factionId('faction-guild'),
        name: 'Guild',
        description: 'Harbor guild.',
        goals: ['Keep trade moving.'],
        relations: [],
      },
    ],
    locations: [
      {
        id: locationId('location-harbor'),
        name: 'Harbor',
        description: 'A storm harbor.',
        parentLocationId: null,
        factionIds: [factionId('faction-guild')],
      },
      {
        id: locationId('location-beacon'),
        name: 'Beacon',
        description: 'An old beacon.',
        parentLocationId: locationId('location-harbor'),
        factionIds: [],
      },
    ],
    narrativeStyle: 'Grounded mystery.',
    forbiddenElements: [],
    tavernReason: 'Shelter from the storm.',
    storyHooks: ['Relight the beacon.'],
    lockedFields: [],
    createdAt: at,
    updatedAt: at,
  });
}

function constitution(): WorldConstitution {
  return Object.freeze({
    campaignId: campaign,
    schemaVersion: schemaVersion(1),
    revision: 1,
    status: 'LOCKED',
    worldType: 'Dark fantasy',
    era: 'Age of storms',
    technology: 'Iron age',
    magic: 'Oath flame',
    peoples: ['Coastfolk'],
    society: 'Guild towns',
    politics: 'Council',
    economy: 'Sea trade',
    combatScale: 'Personal',
    deathRules: 'Mortal',
    careerRules: 'World grounded',
    equipmentRules: 'Semantic',
    npcRules: 'Persistent',
    traitRules: 'Narrative',
    taboos: [],
    createdAt: at,
    updatedAt: at,
    lockedAt: at,
  });
}
