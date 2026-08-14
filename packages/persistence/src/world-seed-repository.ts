import {
  WORLD_SEED_ALGORITHMS,
  campaignId,
  isoTimestamp,
  schemaVersion,
  type CampaignId,
  type IsoTimestamp,
  type WorldRandomCursor,
  type WorldRandomReservation,
  type WorldSeed,
} from '@ember-tavern/contracts';
import { assertWorldRandomStreamId, assertWorldSeed } from '@ember-tavern/domain';

import { PersistenceDataError } from './campaign-repository.js';
import {
  requireEnum,
  requireNumber,
  requireRecord,
  requireString,
} from './persistence-validation.js';
import type { SqliteDatabase } from './sqlite-port.js';

const MAX_POSITION = Number.MAX_SAFE_INTEGER;
const MAX_RESERVATION = 4_096;

export class WorldSeedRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public create(value: WorldSeed): void {
    validateSeedRecord(value);
    this.database
      .prepare(
        `INSERT INTO world_seeds (
           campaign_id, schema_version, algorithm, seed, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(value.campaignId, value.schemaVersion, value.algorithm, value.seed, value.createdAt);
  }

  public get(id: CampaignId): WorldSeed | null {
    const row = this.database.prepare('SELECT * FROM world_seeds WHERE campaign_id = ?').get(id);
    return row === undefined ? null : mapSeed(row);
  }

  public getCursor(id: CampaignId, streamId: string): WorldRandomCursor | null {
    validateStreamId(streamId);
    const row = this.database
      .prepare(
        `SELECT campaign_id, stream_id, position, created_at, updated_at
         FROM world_random_streams WHERE campaign_id = ? AND stream_id = ?`,
      )
      .get(id, streamId);
    return row === undefined ? null : mapCursor(row);
  }

  public reserve(
    id: CampaignId,
    streamId: string,
    count: number,
    at: IsoTimestamp,
  ): WorldRandomReservation {
    validateStreamId(streamId);
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_RESERVATION) {
      throw new PersistenceDataError('World random reservation count is invalid');
    }
    const seed = this.get(id);
    if (seed === null) throw new PersistenceDataError('World Seed does not exist');
    const row = this.database
      .prepare(
        `INSERT INTO world_random_streams (
           campaign_id, stream_id, position, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(campaign_id, stream_id) DO UPDATE SET
           position = world_random_streams.position + excluded.position,
           updated_at = excluded.updated_at
         WHERE world_random_streams.position <= ?
         RETURNING position`,
      )
      .get(id, streamId, count, at, at, MAX_POSITION - count);
    if (row === undefined) {
      throw new PersistenceDataError('World random stream position is exhausted');
    }
    const endPosition = requireNumber(
      requireRecord(row, 'reservation row')['position'],
      'position',
    );
    if (!Number.isSafeInteger(endPosition) || endPosition < count || endPosition > MAX_POSITION) {
      throw new PersistenceDataError('World random stream position is invalid');
    }
    return Object.freeze({
      campaignId: id,
      algorithm: seed.algorithm,
      seed: seed.seed,
      streamId,
      startPosition: endPosition - count,
      count,
    });
  }
}

function mapSeed(value: unknown): WorldSeed {
  try {
    const row = requireRecord(value, 'World Seed row');
    const result = Object.freeze({
      campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
      schemaVersion: schemaVersion(requireNumber(row['schema_version'], 'schema_version')),
      algorithm: requireEnum(WORLD_SEED_ALGORITHMS, row['algorithm'], 'algorithm'),
      seed: requireString(row['seed'], 'seed'),
      createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
    }) satisfies WorldSeed;
    validateSeedRecord(result);
    return result;
  } catch (error) {
    if (error instanceof PersistenceDataError) throw error;
    throw new PersistenceDataError('Persisted World Seed is invalid', { cause: error });
  }
}

function mapCursor(value: unknown): WorldRandomCursor {
  try {
    const row = requireRecord(value, 'World random cursor row');
    const result = Object.freeze({
      campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
      streamId: requireString(row['stream_id'], 'stream_id'),
      position: requireNumber(row['position'], 'position'),
      createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
      updatedAt: isoTimestamp(requireString(row['updated_at'], 'updated_at')),
    }) satisfies WorldRandomCursor;
    assertWorldRandomStreamId(result.streamId);
    if (!Number.isSafeInteger(result.position) || result.position < 0) {
      throw new PersistenceDataError('World random cursor position is invalid');
    }
    return result;
  } catch (error) {
    if (error instanceof PersistenceDataError) throw error;
    throw new PersistenceDataError('Persisted World random cursor is invalid', { cause: error });
  }
}

function validateSeedRecord(value: WorldSeed): void {
  if (value.schemaVersion !== 1 || value.algorithm !== 'EMBER_STREAM_V1') {
    throw new PersistenceDataError('World Seed metadata is invalid');
  }
  try {
    assertWorldSeed(value.seed);
  } catch (error) {
    throw new PersistenceDataError('World Seed value is invalid', { cause: error });
  }
}

function validateStreamId(value: string): void {
  try {
    assertWorldRandomStreamId(value);
  } catch (error) {
    throw new PersistenceDataError('World random stream ID is invalid', { cause: error });
  }
}
