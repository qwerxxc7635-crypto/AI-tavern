import {
  CAMPAIGN_ACTIVE_STATES,
  CAMPAIGN_EXCEPTION_STATES,
  MODEL_SWITCH_POLICIES,
  campaignId,
  isoTimestamp,
  schemaVersion,
  transitionCampaign,
  type Campaign,
  type CampaignActiveState,
  type CampaignState,
  type IsoTimestamp,
  type ModelSwitchPolicy,
} from '@ember-tavern/contracts';

import type { SqliteDatabase, SqliteRunResult } from './sqlite-port.js';

const CAMPAIGN_STATES = [
  ...CAMPAIGN_ACTIVE_STATES,
  ...CAMPAIGN_EXCEPTION_STATES,
  'ARCHIVED',
] as const satisfies readonly CampaignState[];

interface CampaignRow {
  readonly id: string;
  readonly schema_version: number;
  readonly state: string;
  readonly resume_state: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export class CampaignNotFoundError extends Error {
  public constructor(id: string) {
    super(`Campaign not found: ${id}`);
    this.name = 'CampaignNotFoundError';
  }
}

export class PersistenceDataError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PersistenceDataError';
  }
}

export class CampaignRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public create(campaign: Campaign): void {
    this.database
      .prepare(
        `INSERT INTO campaigns (
           id, schema_version, state, resume_state, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        campaign.id,
        campaign.schemaVersion,
        campaign.state,
        campaign.resumeState,
        campaign.createdAt,
        campaign.updatedAt,
      );
  }

  public get(id: Campaign['id']): Campaign | null {
    const row = this.database
      .prepare(
        `SELECT id, schema_version, state, resume_state, created_at, updated_at
         FROM campaigns
         WHERE id = ?`,
      )
      .get(id);
    return row === undefined ? null : mapCampaign(row);
  }

  public getModelSwitchPolicy(id: Campaign['id']): ModelSwitchPolicy {
    const row = this.database
      .prepare('SELECT model_switch_policy FROM campaigns WHERE id = ?')
      .get(id);
    if (row === undefined) throw new CampaignNotFoundError(id);
    const value =
      typeof row === 'object' && row !== null
        ? (row as Record<string, unknown>)['model_switch_policy']
        : undefined;
    if (
      typeof value !== 'string' ||
      !(MODEL_SWITCH_POLICIES as readonly string[]).includes(value)
    ) {
      throw new PersistenceDataError(`Unknown model switch policy: ${String(value)}`);
    }
    return value as ModelSwitchPolicy;
  }

  public update(campaign: Campaign): void {
    const current = this.get(campaign.id);
    if (current === null) throw new CampaignNotFoundError(campaign.id);
    if (current.createdAt !== campaign.createdAt) {
      throw new PersistenceDataError('Campaign createdAt cannot be changed');
    }

    requireOneChange(
      this.database
        .prepare(
          `UPDATE campaigns
           SET schema_version = ?, state = ?, resume_state = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          campaign.schemaVersion,
          campaign.state,
          campaign.resumeState,
          campaign.updatedAt,
          campaign.id,
        ),
      campaign.id,
    );
  }

  public archive(id: Campaign['id'], at: IsoTimestamp): Campaign {
    const current = this.get(id);
    if (current === null) throw new CampaignNotFoundError(id);
    const archived = transitionCampaign(current, 'ARCHIVED', at);
    requireOneChange(
      this.database
        .prepare(
          `UPDATE campaigns
           SET state = 'ARCHIVED', resume_state = NULL, updated_at = ?, archived_at = ?
           WHERE id = ?`,
        )
        .run(at, at, id),
      id,
    );
    return archived;
  }

  public list(includeArchived = false): readonly Campaign[] {
    const rows = this.database
      .prepare(
        `SELECT id, schema_version, state, resume_state, created_at, updated_at
         FROM campaigns
         WHERE (? = 1 OR state <> 'ARCHIVED')
         ORDER BY updated_at DESC, id`,
      )
      .all(includeArchived ? 1 : 0);
    return Object.freeze(rows.map(mapCampaign));
  }
}

function mapCampaign(value: unknown): Campaign {
  try {
    const row = requireCampaignRow(value);
    return Object.freeze({
      id: campaignId(row.id),
      schemaVersion: schemaVersion(row.schema_version),
      state: requireCampaignState(row.state),
      resumeState: requireResumeState(row.resume_state),
      createdAt: isoTimestamp(row.created_at),
      updatedAt: isoTimestamp(row.updated_at),
    });
  } catch (error) {
    if (error instanceof PersistenceDataError) throw error;
    throw new PersistenceDataError('Persisted Campaign row is invalid', { cause: error });
  }
}

function requireCampaignRow(value: unknown): CampaignRow {
  if (typeof value !== 'object' || value === null) {
    throw new PersistenceDataError('Persisted Campaign row must be an object');
  }
  const row = value as Record<string, unknown>;
  return {
    id: requireString(row['id'], 'id'),
    schema_version: requireNumber(row['schema_version'], 'schema_version'),
    state: requireString(row['state'], 'state'),
    resume_state: requireNullableString(row['resume_state'], 'resume_state'),
    created_at: requireString(row['created_at'], 'created_at'),
    updated_at: requireString(row['updated_at'], 'updated_at'),
  };
}

function requireCampaignState(value: string): CampaignState {
  if (!(CAMPAIGN_STATES as readonly string[]).includes(value)) {
    throw new PersistenceDataError(`Unknown Campaign state: ${value}`);
  }
  return value as CampaignState;
}

function requireResumeState(value: string | null): CampaignActiveState | null {
  if (value === null) return null;
  if (!(CAMPAIGN_ACTIVE_STATES as readonly string[]).includes(value)) {
    throw new PersistenceDataError(`Invalid Campaign resume state: ${value}`);
  }
  return value as CampaignActiveState;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new PersistenceDataError(`Campaign ${field} must be text`);
  }
  return value;
}

function requireNullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requireString(value, field);
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number') {
    throw new PersistenceDataError(`Campaign ${field} must be a number`);
  }
  return value;
}

function requireOneChange(result: SqliteRunResult, id: string): void {
  if (result.changes !== 1 && result.changes !== 1n) {
    throw new CampaignNotFoundError(id);
  }
}
