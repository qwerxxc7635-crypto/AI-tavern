import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  AttributeAllocationError,
  campaignId,
  characterTraitId,
  createPlayerAttributes,
  isoTimestamp,
  itemId,
  playerCharacterId,
  type ItemId,
  type PlayerCharacter,
  type PlayerCharacterId,
} from './index.js';

describe('player attribute allocation', () => {
  it('accepts the base four points plus six allocated points', () => {
    expect(createPlayerAttributes({ physique: 5, agility: 2, knowledge: 2, charisma: 1 })).toEqual({
      physique: 5,
      agility: 2,
      knowledge: 2,
      charisma: 1,
    });
  });

  it.each([
    { physique: 0, agility: 3, knowledge: 3, charisma: 4 },
    { physique: 6, agility: 1, knowledge: 1, charisma: 2 },
    { physique: 2.5, agility: 2.5, knowledge: 2, charisma: 3 },
  ])('rejects an attribute outside the integer range 1..5: $physique', (attributes) => {
    expect(() => createPlayerAttributes(attributes)).toThrow(AttributeAllocationError);
  });

  it.each([
    { physique: 1, agility: 1, knowledge: 1, charisma: 1 },
    { physique: 5, agility: 5, knowledge: 5, charisma: 5 },
  ])('rejects a total other than ten points', (attributes) => {
    expect(() => createPlayerAttributes(attributes)).toThrow(AttributeAllocationError);
  });

  it('returns an immutable allocation', () => {
    expect(
      Object.isFrozen(
        createPlayerAttributes({ physique: 4, agility: 2, knowledge: 2, charisma: 2 }),
      ),
    ).toBe(true);
  });
});

describe('player character protocol', () => {
  it('expresses character identity, preferences, background, traits and equipment references', () => {
    const now = isoTimestamp('2026-07-30T10:00:00.000Z');
    const character: PlayerCharacter = {
      id: playerCharacterId('character-1'),
      campaignId: campaignId('campaign-1'),
      name: 'Mira Vale',
      gender: null,
      age: 27,
      concept: 'A weather scholar seeking a missing mentor.',
      storyPreferences: ['Exploration', 'Found family'],
      contentBoundaries: {
        allowHorror: true,
        allowPermanentDeath: false,
        allowRomance: true,
        allowBetrayal: true,
        excludedContent: ['Graphic cruelty'],
      },
      classArchetype: 'SCHOLAR',
      classDisplayName: 'Storm Archivist',
      attributes: createPlayerAttributes({ physique: 1, agility: 2, knowledge: 5, charisma: 2 }),
      traits: [
        {
          id: characterTraitId('trait-observant'),
          name: 'Storm Reader',
          description: 'Recognizes subtle changes in the weather.',
        },
        {
          id: characterTraitId('trait-stubborn'),
          name: 'Unyielding Curiosity',
          description: 'Keeps investigating when caution would be easier.',
        },
      ],
      personalGoal: 'Find the mentor and repair the western beacon.',
      background: {
        birthplace: 'Ember Harbor',
        formativeExperience: 'Survived a sudden skyquake.',
        adventureMotivation: 'Prevent another island from falling.',
        secret: 'The mentor left behind a forbidden chart.',
        importantPerson: 'Professor Aven',
        tavernArrivalReason: 'Following the chart to neutral ground.',
      },
      initialEquipment: [{ itemId: itemId('item-weather-compass') }],
      createdAt: now,
      updatedAt: now,
    };

    expect(character.classArchetype).toBe('SCHOLAR');
    expect(character.classDisplayName).toBe('Storm Archivist');
    expect(character.traits).toHaveLength(2);
  });

  it('keeps character and item identifiers distinct', () => {
    expectTypeOf<PlayerCharacterId>().not.toEqualTypeOf<ItemId>();
  });
});
