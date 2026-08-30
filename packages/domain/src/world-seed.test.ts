import { campaignId, checkRequestId, type WorldRandomReservation } from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import {
  DeterministicWorldRandom,
  WorldSeedError,
  deterministicWorldUint32,
  resolveD20Check,
} from './index.js';

const seed = '00112233445566778899aabbccddeeff';

describe('deterministic world random streams', () => {
  it('repeats the shared algorithm vector and sampling results from the same Seed/state', () => {
    expect(deterministicWorldUint32('EMBER_STREAM_V1', seed, 'map.layout', 0)).toBe(177_449_918);
    const first = new DeterministicWorldRandom(reservation('map.layout', 0, 8));
    const second = new DeterministicWorldRandom(reservation('map.layout', 0, 8));
    const sample = (random: DeterministicWorldRandom) => ({
      raw: random.nextUint32(),
      pick: random.pick(['harbor', 'forest', 'ruins']),
      weighted: random.weightedPick([
        { value: 'quiet', weight: 3 },
        { value: 'danger', weight: 1 },
      ]),
      shuffled: random.shuffle(['north', 'east', 'south', 'west']),
    });
    expect(sample(first)).toEqual(sample(second));
    expect(first.remaining).toBe(2);
  });

  it('isolates named streams even when another stream advances', () => {
    const baseline = new DeterministicWorldRandom(reservation('event.sample', 0, 3));
    const expected = [baseline.nextUint32(), baseline.nextUint32(), baseline.nextUint32()];
    const unrelated = new DeterministicWorldRandom(reservation('map.layout', 0, 3));
    unrelated.nextUint32();
    unrelated.nextUint32();
    unrelated.nextUint32();
    const replay = new DeterministicWorldRandom(reservation('event.sample', 0, 3));
    expect([replay.nextUint32(), replay.nextUint32(), replay.nextUint32()]).toEqual(expected);
  });

  it('enforces bounded reservations, inputs, and exhaustion', () => {
    const random = new DeterministicWorldRandom(reservation('npc.appearance', 0, 1));
    random.nextUint32();
    expect(() => random.nextUint32()).toThrow(
      expect.objectContaining({ code: 'WORLD_RANDOM_RESERVATION_EXHAUSTED' }),
    );
    expect(() => new DeterministicWorldRandom(reservation('d20', 0, 1))).toThrow(WorldSeedError);
    expect(() => random.pick([])).toThrow(WorldSeedError);
    expect(() =>
      new DeterministicWorldRandom(reservation('event.sample', 0, 1)).weightedPick([
        { value: 'invalid', weight: 0 },
      ]),
    ).toThrow(WorldSeedError);
  });

  it('cannot influence the independent trusted D20 source', () => {
    const programRandom = new DeterministicWorldRandom(reservation('event.sample', 0, 2));
    programRandom.nextUint32();
    programRandom.nextUint32();
    expect(
      resolveD20Check(
        {
          checkRequestId: checkRequestId('check-seed-independent'),
          attributeValue: 2,
          equipmentModifier: 0,
          statusModifier: 0,
          difficulty: 11,
        },
        { nextD20: () => 9 },
      ),
    ).toMatchObject({ raw: 9, total: 11, result: 'SUCCESS' });
  });
});

function reservation(
  streamId: string,
  startPosition: number,
  count: number,
): WorldRandomReservation {
  return {
    campaignId: campaignId('campaign-seed'),
    algorithm: 'EMBER_STREAM_V1',
    seed,
    streamId,
    startPosition,
    count,
  };
}
