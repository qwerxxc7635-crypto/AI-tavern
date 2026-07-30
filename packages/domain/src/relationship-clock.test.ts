import {
  campaignId,
  createNpcRelationship,
  npcId,
  playerCharacterId,
  worldClockId,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import {
  DomainPatchError,
  advanceWorldClock,
  applyRelationshipPatch,
  type WorldClock,
} from './index.js';

const relationship = createNpcRelationship({
  npcId: npcId('npc-1'),
  playerCharacterId: playerCharacterId('character-1'),
  trust: 0,
  closeness: 0,
  awe: 0,
  obligation: 0,
});

const clock = (current: number): WorldClock => ({
  id: worldClockId('clock-storm'),
  campaignId: campaignId('campaign-1'),
  name: 'Storm front',
  current,
  max: 6,
  stages: [
    { at: 2, title: 'Trade routes become dangerous' },
    { at: 4, title: 'The harbor closes' },
    { at: 6, title: 'The storm reaches the tavern' },
  ],
});

describe('relationship patches', () => {
  it('applies multiple legal per-turn changes immutably', () => {
    const result = applyRelationshipPatch(relationship, { trust: 1, awe: -1 });
    expect(result).toMatchObject({ trust: 1, awe: -1, closeness: 0, obligation: 0 });
    expect(relationship).toMatchObject({ trust: 0, awe: 0 });
  });

  it.each([-2, 2, 0.5])('rejects per-turn delta %s', (delta) => {
    expect(() => applyRelationshipPatch(relationship, { trust: delta })).toThrow(DomainPatchError);
    expect(relationship.trust).toBe(0);
  });

  it('rejects a result outside -5..5 without partially applying other dimensions', () => {
    const boundary = createNpcRelationship({ ...relationship, trust: 5 });
    expect(() => applyRelationshipPatch(boundary, { closeness: 1, trust: 1 })).toThrow(
      DomainPatchError,
    );
    expect(boundary).toMatchObject({ trust: 5, closeness: 0 });
  });

  it('rejects an empty patch', () => {
    expect(() => applyRelationshipPatch(relationship, {})).toThrow(DomainPatchError);
  });
});

describe('world clock rules', () => {
  it('advances one step and returns a newly crossed stage', () => {
    const result = advanceWorldClock(clock(1), 1);
    expect(result.clock.current).toBe(2);
    expect(result.triggeredStages).toEqual([{ at: 2, title: 'Trade routes become dangerous' }]);
  });

  it('advances without a trigger between thresholds', () => {
    expect(advanceWorldClock(clock(2), 1).triggeredStages).toEqual([]);
  });

  it.each([-1, 0, 2, 1.5])('rejects advance amount %s', (amount) => {
    expect(() => advanceWorldClock(clock(2), amount)).toThrow(DomainPatchError);
  });

  it('rejects advancing a completed clock', () => {
    expect(() => advanceWorldClock(clock(6), 1)).toThrow(DomainPatchError);
  });

  it.each([
    { ...clock(0), current: -1 },
    { ...clock(0), current: 7 },
    { ...clock(0), max: 0 },
    { ...clock(0), stages: [{ at: 7, title: 'Invalid' }] },
    {
      ...clock(0),
      stages: [
        { at: 2, title: 'A' },
        { at: 2, title: 'B' },
      ],
    },
  ])('rejects an invalid clock without writing', (invalid) => {
    expect(() => advanceWorldClock(invalid, 1)).toThrow(DomainPatchError);
  });
});
