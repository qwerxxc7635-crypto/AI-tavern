import type { WorldRandomReservation, WorldSeedAlgorithm } from '@ember-tavern/contracts';

const SEED_PATTERN = /^[0-9a-f]{32}$/u;
const STREAM_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/u;
const RESERVED_HARD_RANDOM_STREAM = /^(?:d20|dice)(?:[._-]|$)/u;
const UINT32_RANGE = 0x1_0000_0000;
const MAX_POSITION = Number.MAX_SAFE_INTEGER;

export class WorldSeedError extends Error {
  public constructor(
    public readonly code:
      | 'WORLD_SEED_INVALID'
      | 'WORLD_RANDOM_STREAM_INVALID'
      | 'WORLD_RANDOM_POSITION_INVALID'
      | 'WORLD_RANDOM_RESERVATION_EXHAUSTED'
      | 'WORLD_RANDOM_SAMPLE_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'WorldSeedError';
  }
}

export function assertWorldSeed(seed: string): void {
  if (!SEED_PATTERN.test(seed)) {
    throw new WorldSeedError('WORLD_SEED_INVALID', 'World Seed must be 128-bit lowercase hex');
  }
}

export function assertWorldRandomStreamId(streamId: string): void {
  if (!STREAM_PATTERN.test(streamId) || RESERVED_HARD_RANDOM_STREAM.test(streamId)) {
    throw new WorldSeedError(
      'WORLD_RANDOM_STREAM_INVALID',
      'World random stream ID is invalid or reserved for hard randomness',
    );
  }
}

export function deterministicWorldUint32(
  algorithm: WorldSeedAlgorithm,
  seed: string,
  streamId: string,
  position: number,
): number {
  if (algorithm !== 'EMBER_STREAM_V1') {
    throw new WorldSeedError('WORLD_SEED_INVALID', 'World Seed algorithm is unsupported');
  }
  assertWorldSeed(seed);
  assertWorldRandomStreamId(streamId);
  assertPosition(position);
  const input = `${seed}:${streamId}:${position}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}

export class DeterministicWorldRandom {
  private consumed = 0;

  public constructor(private readonly reservation: WorldRandomReservation) {
    assertWorldSeed(reservation.seed);
    assertWorldRandomStreamId(reservation.streamId);
    assertPosition(reservation.startPosition);
    if (
      !Number.isSafeInteger(reservation.count) ||
      reservation.count < 1 ||
      reservation.count > 4_096 ||
      reservation.startPosition > MAX_POSITION - reservation.count
    ) {
      throw new WorldSeedError(
        'WORLD_RANDOM_POSITION_INVALID',
        'World random reservation range is invalid',
      );
    }
  }

  public get remaining(): number {
    return this.reservation.count - this.consumed;
  }

  public nextUint32(): number {
    if (this.consumed >= this.reservation.count) {
      throw new WorldSeedError(
        'WORLD_RANDOM_RESERVATION_EXHAUSTED',
        'World random reservation is exhausted',
      );
    }
    const value = deterministicWorldUint32(
      this.reservation.algorithm,
      this.reservation.seed,
      this.reservation.streamId,
      this.reservation.startPosition + this.consumed,
    );
    this.consumed += 1;
    return value;
  }

  public nextUnit(): number {
    return this.nextUint32() / UINT32_RANGE;
  }

  public pick<T>(values: readonly T[]): T {
    const index = this.index(values.length);
    const value = values[index];
    if (value === undefined) {
      throw new WorldSeedError('WORLD_RANDOM_SAMPLE_INVALID', 'Sample candidate is missing');
    }
    return value;
  }

  public weightedPick<T>(values: readonly Readonly<{ value: T; weight: number }>[]): T {
    if (
      values.length < 1 ||
      values.length > 10_000 ||
      values.some(({ weight }) => !Number.isFinite(weight) || weight < 0)
    ) {
      throw new WorldSeedError('WORLD_RANDOM_SAMPLE_INVALID', 'Weighted sample is invalid');
    }
    const total = values.reduce((sum, { weight }) => sum + weight, 0);
    if (!Number.isFinite(total) || total <= 0) {
      throw new WorldSeedError('WORLD_RANDOM_SAMPLE_INVALID', 'Weighted sample has no weight');
    }
    const target = this.nextUnit() * total;
    let cursor = 0;
    for (const entry of values) {
      cursor += entry.weight;
      if (target < cursor) return entry.value;
    }
    const fallback = values.at(-1);
    if (fallback === undefined) {
      throw new WorldSeedError('WORLD_RANDOM_SAMPLE_INVALID', 'Weighted sample is empty');
    }
    return fallback.value;
  }

  public shuffle<T>(values: readonly T[]): readonly T[] {
    if (values.length > 4_097) {
      throw new WorldSeedError('WORLD_RANDOM_SAMPLE_INVALID', 'Shuffle candidate set is too large');
    }
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const target = this.index(index + 1);
      [result[index], result[target]] = [result[target] as T, result[index] as T];
    }
    return Object.freeze(result);
  }

  private index(length: number): number {
    if (!Number.isSafeInteger(length) || length < 1 || length > 1_000_000) {
      throw new WorldSeedError('WORLD_RANDOM_SAMPLE_INVALID', 'Sample size is invalid');
    }
    return Math.floor(this.nextUnit() * length);
  }
}

function assertPosition(position: number): void {
  if (!Number.isSafeInteger(position) || position < 0 || position > MAX_POSITION) {
    throw new WorldSeedError('WORLD_RANDOM_POSITION_INVALID', 'World random position is invalid');
  }
}
