import {
  LOCATION_TRAVEL_MODES,
  campaignId,
  isoTimestamp,
  locationId,
  parseDynamicLocationProfile,
  type CampaignId,
  type CampaignLocationState,
  type DynamicLocationProfile,
  type LocationConnection,
  type LocationTravelEvent,
  type LocationTravelMode,
} from '@ember-tavern/contracts';
import { planLocationTravel, validateLocationTopology } from '@ember-tavern/domain';

import { PersistenceDataError } from './campaign-repository.js';
import {
  parseJson,
  requireEnum,
  requireNumber,
  requireRecord,
  requireString,
} from './persistence-validation.js';
import type { TransactionalSqliteDatabase } from './sqlite-port.js';

export interface DynamicLocationSnapshot {
  readonly state: CampaignLocationState;
  readonly locations: readonly DynamicLocationProfile[];
  readonly connections: readonly LocationConnection[];
  readonly travelHistory: readonly LocationTravelEvent[];
}

export interface CommitLocationMaterialization {
  readonly campaignId: CampaignId;
  readonly locations: readonly DynamicLocationProfile[];
  readonly connectionPairs: readonly (readonly [string, string])[];
  readonly generationRecordId: string;
  readonly at: string;
}

export interface CommitLocationTravel {
  readonly eventId: string;
  readonly operationId: string;
  readonly campaignId: CampaignId;
  readonly targetLocationId: string;
  readonly expectedRevision: number;
  readonly mode: LocationTravelMode;
  readonly at: string;
}

export class DynamicLocationRepository {
  public constructor(private readonly database: TransactionalSqliteDatabase) {}

  public snapshot(campaign: CampaignId): DynamicLocationSnapshot {
    const locations = Object.freeze(
      this.database
        .prepare(
          `SELECT * FROM dynamic_locations WHERE campaign_id = ?
           ORDER BY parent_location_id IS NOT NULL,parent_location_id,name,id`,
        )
        .all(campaign)
        .map(mapLocation),
    );
    if (locations.length === 0) {
      throw new PersistenceDataError(`Dynamic locations not found: ${campaign}`);
    }
    const authority = locationAuthority(this.database, campaign);
    if (
      locations.some(
        (profile) =>
          profile.constitutionRevision !== authority.revision ||
          JSON.stringify(profile.constitutionEvidence) !== JSON.stringify(authority.evidence) ||
          profile.factionIds.some((id) => !authority.factionIds.has(id)),
      )
    ) {
      throw new PersistenceDataError('Dynamic location authority is invalid');
    }
    validateLocationTopology(locations);
    const state = mapState(
      this.database
        .prepare('SELECT * FROM campaign_location_states WHERE campaign_id = ?')
        .get(campaign),
    );
    const connections = Object.freeze(
      this.database
        .prepare(
          `SELECT * FROM location_connections WHERE campaign_id = ?
           ORDER BY first_location_id,second_location_id,id`,
        )
        .all(campaign)
        .map(mapConnection),
    );
    const travelHistory = Object.freeze(
      this.database
        .prepare(
          `SELECT * FROM location_travel_events WHERE campaign_id = ?
           ORDER BY occurred_at,id`,
        )
        .all(campaign)
        .map(mapTravel),
    );
    return Object.freeze({ state, locations, connections, travelHistory });
  }

  public commitMaterialization(command: CommitLocationMaterialization): DynamicLocationSnapshot {
    if (command.locations.length === 0) {
      throw new PersistenceDataError('Dynamic location materialization is empty');
    }
    const profiles = command.locations.map(parseDynamicLocationProfile);
    const at = isoTimestamp(command.at);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const replay = this.database
        .prepare(
          `SELECT campaign_id,profile_json FROM dynamic_locations
           WHERE generation_record_id = ? ORDER BY id`,
        )
        .all(command.generationRecordId);
      if (replay.length > 0) {
        const prior = replay.map((value) => {
          const row = requireRecord(value, 'location replay');
          if (requireString(row['campaign_id'], 'campaign_id') !== command.campaignId) {
            throw new PersistenceDataError('Location generation belongs to another campaign');
          }
          return parseDynamicLocationProfile(parseJson(row['profile_json'], 'profile_json'));
        });
        const canonicalPrior = [...prior].sort((left, right) => left.id.localeCompare(right.id));
        const canonicalCommand = [...profiles].sort((left, right) =>
          left.id.localeCompare(right.id),
        );
        const priorPairs = this.database
          .prepare(
            `SELECT first_location_id,second_location_id FROM location_connections
             WHERE generation_record_id=? ORDER BY first_location_id,second_location_id`,
          )
          .all(command.generationRecordId)
          .map((value) => {
            const row = requireRecord(value, 'location connection replay');
            return [
              requireString(row['first_location_id'], 'first_location_id'),
              requireString(row['second_location_id'], 'second_location_id'),
            ] as const;
          });
        if (
          JSON.stringify(canonicalPrior) !== JSON.stringify(canonicalCommand) ||
          JSON.stringify(priorPairs) !== JSON.stringify(canonicalPairs(command.connectionPairs))
        ) {
          throw new PersistenceDataError('Location generation replay conflicts with prior data');
        }
        const saved = this.snapshot(command.campaignId);
        this.database.exec('COMMIT');
        return saved;
      }
      requireGeneration(this.database, command.campaignId, command.generationRecordId);
      const current = this.snapshot(command.campaignId);
      const authority = locationAuthority(this.database, command.campaignId);
      const normalizedNames = new Set(current.locations.map(({ name }) => normalize(name)));
      for (const profile of profiles) {
        if (
          profile.campaignId !== command.campaignId ||
          profile.materialization !== 'DETAILED' ||
          profile.generationRecordId !== command.generationRecordId ||
          profile.revision !== 1 ||
          profile.constitutionRevision !== authority.revision ||
          JSON.stringify(profile.constitutionEvidence) !== JSON.stringify(authority.evidence) ||
          profile.factionIds.some((id) => !authority.factionIds.has(id)) ||
          !normalizedNames.add(normalize(profile.name))
        ) {
          throw new PersistenceDataError('Generated location profile identity is invalid');
        }
        this.database
          .prepare(
            `INSERT INTO dynamic_locations
             (id,campaign_id,schema_version,constitution_revision,location_kind,materialization,
              name,parent_location_id,profile_json,generation_record_id,revision,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            profile.id,
            profile.campaignId,
            profile.schemaVersion,
            profile.constitutionRevision,
            profile.locationKind,
            profile.materialization,
            profile.name,
            profile.parentLocationId,
            JSON.stringify(profile),
            profile.generationRecordId,
            profile.revision,
            profile.createdAt,
            profile.updatedAt,
          );
      }
      validateLocationTopology([...current.locations, ...profiles]);
      const allowedIds = new Set([...current.locations, ...profiles].map(({ id }) => id));
      for (const [leftValue, rightValue] of command.connectionPairs) {
        const left = locationId(leftValue);
        const right = locationId(rightValue);
        if (left === right || !allowedIds.has(left) || !allowedIds.has(right)) {
          throw new PersistenceDataError('Generated location connection is invalid');
        }
        const [first, second] = left < right ? [left, right] : [right, left];
        this.database
          .prepare(
            `INSERT INTO location_connections
             (id,campaign_id,first_location_id,second_location_id,source,generation_record_id,created_at)
             VALUES (?,?,?,?, 'GENERATED',?,?)`,
          )
          .run(
            `location-edge:${first}:${second}`,
            command.campaignId,
            first,
            second,
            command.generationRecordId,
            at,
          );
      }
      const saved = this.snapshot(command.campaignId);
      this.database.exec('COMMIT');
      return saved;
    } catch (error) {
      rollback(this.database, error, 'Dynamic location materialization failed');
    }
  }

  public travel(command: CommitLocationTravel): DynamicLocationSnapshot {
    const occurredAt = isoTimestamp(command.at);
    if (
      command.eventId.trim() !== command.eventId ||
      command.eventId.length === 0 ||
      command.operationId.trim() !== command.operationId ||
      command.operationId.length === 0 ||
      !Number.isSafeInteger(command.expectedRevision) ||
      command.expectedRevision < 1 ||
      !LOCATION_TRAVEL_MODES.includes(command.mode)
    ) {
      throw new PersistenceDataError('Location travel identity is invalid');
    }
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const replay = this.database
        .prepare(
          `SELECT campaign_id,to_location_id,before_revision,mode
           FROM location_travel_events WHERE operation_id = ?`,
        )
        .get(command.operationId);
      if (replay !== undefined) {
        const row = requireRecord(replay, 'location travel replay');
        if (
          requireString(row['campaign_id'], 'campaign_id') !== command.campaignId ||
          requireString(row['to_location_id'], 'to_location_id') !== command.targetLocationId ||
          requireNumber(row['before_revision'], 'before_revision') !== command.expectedRevision ||
          requireString(row['mode'], 'mode') !== command.mode
        ) {
          throw new PersistenceDataError('Location travel operation conflicts with prior use');
        }
        const saved = this.snapshot(command.campaignId);
        this.database.exec('COMMIT');
        return saved;
      }
      const current = this.snapshot(command.campaignId);
      if (current.state.revision !== command.expectedRevision) {
        throw new PersistenceDataError('Location travel revision drift');
      }
      const next = planLocationTravel({
        state: current.state,
        targetLocationId: command.targetLocationId,
        mode: command.mode,
        locations: current.locations,
        connections: current.connections,
        at: occurredAt,
      });
      this.database
        .prepare(
          `INSERT INTO location_travel_events
           (id,campaign_id,operation_id,from_location_id,to_location_id,mode,
            before_revision,after_revision,occurred_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          command.eventId,
          command.campaignId,
          command.operationId,
          current.state.currentLocationId,
          next.currentLocationId,
          command.mode,
          current.state.revision,
          next.revision,
          next.updatedAt,
        );
      const changed = this.database
        .prepare(
          `UPDATE campaign_location_states SET current_location_id=?,revision=?,updated_at=?
           WHERE campaign_id=? AND revision=?`,
        )
        .run(
          next.currentLocationId,
          next.revision,
          next.updatedAt,
          command.campaignId,
          command.expectedRevision,
        ).changes;
      if (changed !== 1) throw new PersistenceDataError('Location travel revision drift');
      const saved = this.snapshot(command.campaignId);
      this.database.exec('COMMIT');
      return saved;
    } catch (error) {
      rollback(this.database, error, 'Dynamic location travel failed');
    }
  }
}

function locationAuthority(database: TransactionalSqliteDatabase, campaign: CampaignId) {
  const constitution = requireRecord(
    database
      .prepare(
        `SELECT revision,technology,magic,society,politics FROM world_constitutions
         WHERE campaign_id=? AND status='LOCKED'`,
      )
      .get(campaign),
    'location constitution',
  );
  const bible = requireRecord(
    database.prepare(`SELECT factions_json FROM world_bibles WHERE campaign_id=?`).get(campaign),
    'location world bible',
  );
  const factions = parseJson(bible['factions_json'], 'factions_json');
  if (!Array.isArray(factions)) throw new PersistenceDataError('Location factions are invalid');
  const factionIds = new Set(
    factions.map((value) => {
      const record = requireRecord(value, 'location faction');
      return requireString(record['id'], 'faction.id');
    }),
  );
  return Object.freeze({
    revision: requireNumber(constitution['revision'], 'revision'),
    evidence: Object.freeze({
      technology: requireString(constitution['technology'], 'technology'),
      magic: requireString(constitution['magic'], 'magic'),
      society: requireString(constitution['society'], 'society'),
      politics: requireString(constitution['politics'], 'politics'),
    }),
    factionIds,
  });
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function canonicalPairs(
  pairs: readonly (readonly [string, string])[],
): readonly (readonly [string, string])[] {
  return [...pairs]
    .map(([left, right]) => (left < right ? ([left, right] as const) : ([right, left] as const)))
    .sort(([leftFirst, leftSecond], [rightFirst, rightSecond]) =>
      leftFirst === rightFirst
        ? leftSecond.localeCompare(rightSecond)
        : leftFirst.localeCompare(rightFirst),
    );
}

function mapLocation(value: unknown): DynamicLocationProfile {
  const row = requireRecord(value, 'dynamic location row');
  const profile = parseDynamicLocationProfile(parseJson(row['profile_json'], 'profile_json'));
  const generation = row['generation_record_id'];
  if (
    profile.id !== requireString(row['id'], 'id') ||
    profile.campaignId !== requireString(row['campaign_id'], 'campaign_id') ||
    profile.schemaVersion !== requireNumber(row['schema_version'], 'schema_version') ||
    profile.constitutionRevision !==
      requireNumber(row['constitution_revision'], 'constitution_revision') ||
    profile.locationKind !== requireString(row['location_kind'], 'location_kind') ||
    profile.materialization !== requireString(row['materialization'], 'materialization') ||
    profile.name !== requireString(row['name'], 'name') ||
    profile.parentLocationId !== row['parent_location_id'] ||
    profile.generationRecordId !== generation ||
    profile.revision !== requireNumber(row['revision'], 'revision') ||
    profile.createdAt !== requireString(row['created_at'], 'created_at') ||
    profile.updatedAt !== requireString(row['updated_at'], 'updated_at')
  ) {
    throw new PersistenceDataError('Dynamic location columns disagree with profile JSON');
  }
  return profile;
}

function mapState(value: unknown): CampaignLocationState {
  const row = requireRecord(value, 'campaign location state');
  return Object.freeze({
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    currentLocationId: locationId(requireString(row['current_location_id'], 'current_location_id')),
    revision: requireNumber(row['revision'], 'revision'),
    updatedAt: isoTimestamp(requireString(row['updated_at'], 'updated_at')),
  });
}

function mapConnection(value: unknown): LocationConnection {
  const row = requireRecord(value, 'location connection');
  const generation = row['generation_record_id'];
  return Object.freeze({
    id: requireString(row['id'], 'id'),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    firstLocationId: locationId(requireString(row['first_location_id'], 'first_location_id')),
    secondLocationId: locationId(requireString(row['second_location_id'], 'second_location_id')),
    source: requireEnum(['INITIAL_HIERARCHY', 'GENERATED'] as const, row['source'], 'source'),
    generationRecordId:
      generation === null
        ? null
        : (requireString(
            generation,
            'generation_record_id',
          ) as LocationConnection['generationRecordId']),
    createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
  });
}

function mapTravel(value: unknown): LocationTravelEvent {
  const row = requireRecord(value, 'location travel event');
  return Object.freeze({
    id: requireString(row['id'], 'id'),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    fromLocationId: locationId(requireString(row['from_location_id'], 'from_location_id')),
    toLocationId: locationId(requireString(row['to_location_id'], 'to_location_id')),
    mode: requireEnum(LOCATION_TRAVEL_MODES, row['mode'], 'mode'),
    beforeRevision: requireNumber(row['before_revision'], 'before_revision'),
    afterRevision: requireNumber(row['after_revision'], 'after_revision'),
    occurredAt: isoTimestamp(requireString(row['occurred_at'], 'occurred_at')),
  });
}

function requireGeneration(
  database: TransactionalSqliteDatabase,
  campaign: CampaignId,
  generation: string,
): void {
  const row = database
    .prepare(`SELECT campaign_id,task FROM generation_records WHERE id = ?`)
    .get(generation);
  if (row === undefined) throw new PersistenceDataError('Location generation record not found');
  const record = requireRecord(row, 'location generation record');
  if (
    requireString(record['campaign_id'], 'campaign_id') !== campaign ||
    requireString(record['task'], 'task') !== 'GENERATE_LOCATIONS'
  ) {
    throw new PersistenceDataError('Location generation record is invalid');
  }
}

function rollback(database: TransactionalSqliteDatabase, error: unknown, message: string): never {
  try {
    database.exec('ROLLBACK');
  } catch (rollbackError) {
    throw new PersistenceDataError(message, { cause: new AggregateError([error, rollbackError]) });
  }
  if (error instanceof PersistenceDataError) throw error;
  throw new PersistenceDataError(message, { cause: error });
}
