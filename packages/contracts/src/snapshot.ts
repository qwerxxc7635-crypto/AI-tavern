import type { CampaignId, IsoTimestamp, SchemaVersion, SnapshotId } from './foundation.js';

export const SNAPSHOT_KINDS = ['AUTO', 'MANUAL', 'BACKUP', 'IMPORT'] as const;
export type SnapshotKind = (typeof SNAPSHOT_KINDS)[number];

export interface SaveSnapshot {
  readonly id: SnapshotId;
  readonly campaignId: CampaignId;
  readonly kind: SnapshotKind;
  readonly reason: string;
  readonly schemaVersion: SchemaVersion;
  readonly checksumSha256: string;
  readonly createdAt: IsoTimestamp;
}
