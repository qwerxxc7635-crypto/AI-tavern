import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  adventureId,
  campaignId,
  characterTraitId,
  factionId,
  compatibleEnum,
  isoTimestamp,
  itemId,
  locationId,
  npcId,
  npcMemoryId,
  playerCharacterId,
  promptVersion,
  questId,
  schemaVersion,
  tavernChangeId,
  tavernId,
  timestampFromDate,
  turnId,
  worldFactId,
  type CampaignId,
  type NpcId,
} from './index.js';

describe('opaque identifiers', () => {
  it('creates each supported identifier without changing its value', () => {
    expect(campaignId('campaign-1')).toBe('campaign-1');
    expect(npcId('npc-1')).toBe('npc-1');
    expect(questId('quest-1')).toBe('quest-1');
    expect(adventureId('adventure-1')).toBe('adventure-1');
    expect(turnId('turn-1')).toBe('turn-1');
    expect(factionId('faction-1')).toBe('faction-1');
    expect(locationId('location-1')).toBe('location-1');
    expect(worldFactId('fact-1')).toBe('fact-1');
    expect(playerCharacterId('character-1')).toBe('character-1');
    expect(characterTraitId('trait-1')).toBe('trait-1');
    expect(itemId('item-1')).toBe('item-1');
    expect(tavernId('tavern-1')).toBe('tavern-1');
    expect(tavernChangeId('change-1')).toBe('change-1');
    expect(npcMemoryId('memory-1')).toBe('memory-1');
  });

  it.each(['', ' ', ' campaign-1', 'campaign-1 '])('rejects non-canonical ID %j', (value) => {
    expect(() => campaignId(value)).toThrow(TypeError);
  });

  it('keeps entity ID types distinct at compile time', () => {
    expectTypeOf<CampaignId>().not.toEqualTypeOf<NpcId>();
  });
});

describe('timestamps and versions', () => {
  it('accepts only canonical UTC timestamps', () => {
    const expected = '2026-07-30T14:30:00.000Z';
    expect(isoTimestamp(expected)).toBe(expected);
    expect(timestampFromDate(new Date(expected))).toBe(expected);
    expect(() => isoTimestamp('2026-07-30T14:30:00Z')).toThrow(TypeError);
    expect(() => isoTimestamp('not-a-date')).toThrow(TypeError);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid version %s',
    (value) => {
      expect(() => schemaVersion(value)).toThrow(TypeError);
      expect(() => promptVersion(value)).toThrow(TypeError);
    },
  );

  it('accepts positive safe integer versions', () => {
    expect(schemaVersion(1)).toBe(1);
    expect(promptVersion(2)).toBe(2);
  });
});

describe('forward-compatible enums', () => {
  const values = ['active', 'archived'] as const;

  it('returns a typed known value', () => {
    expect(compatibleEnum(values, 'active')).toEqual({ kind: 'known', value: 'active' });
  });

  it('preserves an unknown raw value for forward compatibility', () => {
    expect(compatibleEnum(values, 'future-state')).toEqual({
      kind: 'unknown',
      raw: 'future-state',
    });
  });
});
