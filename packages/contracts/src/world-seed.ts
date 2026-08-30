import type { CampaignId, IsoTimestamp, SchemaVersion } from './foundation.js';

export const WORLD_SEED_ALGORITHMS = ['EMBER_STREAM_V1'] as const;
export type WorldSeedAlgorithm = (typeof WORLD_SEED_ALGORITHMS)[number];

export interface WorldSeed {
  readonly campaignId: CampaignId;
  readonly schemaVersion: SchemaVersion;
  readonly algorithm: WorldSeedAlgorithm;
  readonly seed: string;
  readonly createdAt: IsoTimestamp;
}

export interface WorldRandomCursor {
  readonly campaignId: CampaignId;
  readonly streamId: string;
  readonly position: number;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface WorldRandomReservation {
  readonly campaignId: CampaignId;
  readonly algorithm: WorldSeedAlgorithm;
  readonly seed: string;
  readonly streamId: string;
  readonly startPosition: number;
  readonly count: number;
}
