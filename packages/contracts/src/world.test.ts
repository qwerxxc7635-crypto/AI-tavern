import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  campaignId,
  claimId,
  factionId,
  isoTimestamp,
  isLockedWorldFact,
  locationId,
  npcId,
  schemaVersion,
  worldFactId,
  type FactionId,
  type LocationId,
  type WorldBible,
  type WorldFact,
  type WorldFactId,
} from './index.js';

const createdAt = isoTimestamp('2026-07-30T10:00:00.000Z');
const campaign = campaignId('campaign-1');
const guild = factionId('faction-guild');
const harbor = locationId('location-harbor');

const baseFact = {
  campaignId: campaign,
  locationId: harbor,
  factionIds: [guild],
  createdAt,
} as const;

describe('world contracts', () => {
  it('expresses a complete generated world bible', () => {
    const world: WorldBible = {
      campaignId: campaign,
      schemaVersion: schemaVersion(1),
      name: 'Cloudbound Isles',
      currentRegion: 'Ember Harbor',
      summary: 'Floating islands connected by living airships.',
      coreConflict: 'A weather engine is destabilizing the archipelago.',
      technologyLevel: 'Arcane age of sail',
      powerRules: ['Magic alters nearby weather.'],
      factions: [
        {
          id: guild,
          name: 'Skyfarers Guild',
          description: 'Pilots and navigators.',
          goals: ['Keep trade routes open.'],
          relations: [],
        },
      ],
      locations: [
        {
          id: harbor,
          name: 'Ember Harbor',
          description: 'A busy port suspended beneath a red cloud.',
          parentLocationId: null,
          factionIds: [guild],
        },
      ],
      narrativeStyle: 'Hopeful adventure',
      forbiddenElements: ['Graphic cruelty'],
      tavernReason: 'Neutral ground for sky crews.',
      storyHooks: ['The western beacon has gone dark.'],
      lockedFields: ['coreConflict', 'powerRules'],
      createdAt,
      updatedAt: createdAt,
    };

    expect(world.factions[0]?.id).toBe(guild);
    expect(world.lockedFields).toContain('powerRules');
  });

  it('keeps world entity identifiers distinct', () => {
    expectTypeOf<FactionId>().not.toEqualTypeOf<LocationId>();
    expectTypeOf<LocationId>().not.toEqualTypeOf<WorldFactId>();
  });

  it('expresses all five fact categories', () => {
    const facts: readonly WorldFact[] = [
      {
        ...baseFact,
        id: worldFactId('fact-rule'),
        kind: 'LOCKED_RULE',
        field: 'powerRules',
        statement: 'Magic changes local weather.',
      },
      {
        ...baseFact,
        id: worldFactId('fact-developing'),
        kind: 'DEVELOPING_FACT',
        supersedesFactId: null,
        statement: 'The western beacon is failing.',
      },
      {
        ...baseFact,
        id: worldFactId('fact-temporary'),
        kind: 'TEMPORARY_NARRATIVE',
        expiresAt: isoTimestamp('2026-07-31T10:00:00.000Z'),
        statement: 'A thunderstorm covers the harbor.',
      },
      {
        ...baseFact,
        id: worldFactId('fact-rumor'),
        kind: 'RUMOR',
        claimId: claimId('claim-rumor'),
        sourceNpcId: npcId('npc-courier'),
        sourceBasis: 'HEARSAY',
        confidence: 0.5,
        claimRevision: 1,
        veracity: 'UNKNOWN',
        statement: 'The guild caused the beacon failure.',
      },
      {
        ...baseFact,
        id: worldFactId('fact-belief'),
        kind: 'FALSE_BELIEF',
        believedByNpcIds: [npcId('npc-captain')],
        statement: 'The beacon cannot be repaired.',
      },
    ];

    expect(facts.map((fact) => fact.kind)).toEqual([
      'LOCKED_RULE',
      'DEVELOPING_FACT',
      'TEMPORARY_NARRATIVE',
      'RUMOR',
      'FALSE_BELIEF',
    ]);
    expect(facts.filter(isLockedWorldFact)).toHaveLength(1);
  });

  it('preserves an append-only developing fact chain', () => {
    const originalId = worldFactId('fact-beacon-failing');
    const changed: WorldFact = {
      ...baseFact,
      id: worldFactId('fact-beacon-destroyed'),
      kind: 'DEVELOPING_FACT',
      supersedesFactId: originalId,
      statement: 'The western beacon has been destroyed.',
    };

    expect(changed.kind).toBe('DEVELOPING_FACT');
    if (changed.kind === 'DEVELOPING_FACT') {
      expect(changed.supersedesFactId).toBe(originalId);
    }
  });
});
