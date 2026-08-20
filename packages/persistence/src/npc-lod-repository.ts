import {
  NPC_LOD_UPGRADE_TRIGGERS,
  campaignId,
  generationRecordId,
  isoTimestamp,
  npcId,
  parseNpcLodProfile,
  type CampaignId,
  type NpcId,
  type NpcLodProfile,
  type NpcLodTransition,
  type NpcLodUpgradeTrigger,
} from '@ember-tavern/contracts';

import { PersistenceDataError } from './campaign-repository.js';
import {
  parseJson,
  requireEnum,
  requireNumber,
  requireRecord,
  requireString,
} from './persistence-validation.js';
import type { TransactionalSqliteDatabase } from './sqlite-port.js';

export interface CommitNpcLodUpgrade {
  readonly profile: NpcLodProfile;
  readonly expectedRevision: number;
  readonly transitionId: string;
  readonly idempotencyKey: string;
  readonly trigger: NpcLodUpgradeTrigger;
}

export class NpcLodRepository {
  public constructor(private readonly database: TransactionalSqliteDatabase) {}

  public createSeed(profile: NpcLodProfile): NpcLodProfile {
    const canonical = parseNpcLodProfile(profile);
    if (canonical.lod !== 0 || canonical.revision !== 1 || canonical.generationRecordId !== null) {
      throw new PersistenceDataError('NPC LOD seed must start at LOD0 revision 1');
    }
    this.database.exec('BEGIN IMMEDIATE');
    try {
      requireConstitution(this.database, canonical);
      this.database
        .prepare(
          `INSERT INTO npc_lod_profiles (
             id, campaign_id, schema_version, constitution_revision, lod, revision,
             profile_json, generation_record_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(
          canonical.id,
          canonical.campaignId,
          canonical.schemaVersion,
          canonical.constitutionRevision,
          canonical.lod,
          canonical.revision,
          JSON.stringify(canonical),
          canonical.createdAt,
          canonical.updatedAt,
        );
      const saved = this.require(canonical.id);
      this.database.exec('COMMIT');
      return saved;
    } catch (error) {
      rollback(this.database, error, 'NPC LOD seed persistence failed');
    }
  }

  public get(id: NpcId): NpcLodProfile | null {
    const row = this.database.prepare('SELECT * FROM npc_lod_profiles WHERE id = ?').get(id);
    if (row === undefined) return null;
    const profile = mapProfile(row);
    requireConstitution(this.database, profile);
    return profile;
  }

  public require(id: NpcId): NpcLodProfile {
    const profile = this.get(id);
    if (profile === null) throw new PersistenceDataError(`NPC LOD profile not found: ${id}`);
    return profile;
  }

  public list(campaign: CampaignId): readonly NpcLodProfile[] {
    return Object.freeze(
      this.database
        .prepare(
          `SELECT * FROM npc_lod_profiles
           WHERE campaign_id = ?
           ORDER BY lod DESC, updated_at, id`,
        )
        .all(campaign)
        .map((row) => {
          const profile = mapProfile(row);
          requireConstitution(this.database, profile);
          return profile;
        }),
    );
  }

  public commitUpgrade(command: CommitNpcLodUpgrade): NpcLodProfile {
    const canonical = parseNpcLodProfile(command.profile);
    if (
      command.idempotencyKey.trim() !== command.idempotencyKey ||
      command.idempotencyKey.length === 0 ||
      command.transitionId.trim() !== command.transitionId ||
      command.transitionId.length === 0 ||
      !Number.isSafeInteger(command.expectedRevision) ||
      command.expectedRevision < 1 ||
      !NPC_LOD_UPGRADE_TRIGGERS.includes(command.trigger)
    ) {
      throw new PersistenceDataError('NPC LOD upgrade identity is invalid');
    }
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const replay = this.database
        .prepare(
          `SELECT npc_id, after_profile_json
           FROM npc_lod_transitions WHERE idempotency_key = ?`,
        )
        .get(command.idempotencyKey);
      if (replay !== undefined) {
        const row = requireRecord(replay, 'NPC LOD replay');
        const prior = parseNpcLodProfile(
          parseJson(row['after_profile_json'], 'after_profile_json'),
        );
        if (
          requireString(row['npc_id'], 'npc_id') !== canonical.id ||
          JSON.stringify(prior) !== JSON.stringify(canonical)
        ) {
          throw new PersistenceDataError('NPC LOD idempotency key conflicts with another upgrade');
        }
        this.database.exec('COMMIT');
        return prior;
      }
      const current = this.require(canonical.id);
      if (
        current.revision !== command.expectedRevision ||
        canonical.revision !== current.revision + 1 ||
        canonical.lod !== current.lod + 1 ||
        canonical.campaignId !== current.campaignId ||
        canonical.constitutionRevision !== current.constitutionRevision ||
        canonical.identityAnchor !== current.identityAnchor ||
        canonical.populationRole !== current.populationRole ||
        canonical.createdAt !== current.createdAt ||
        canonical.generationRecordId === null
      ) {
        throw new PersistenceDataError('NPC LOD upgrade does not follow the current revision');
      }
      requireConstitution(this.database, canonical);
      requireGeneration(this.database, canonical);
      requireReferences(this.database, canonical);
      const changed = this.database
        .prepare(
          `UPDATE npc_lod_profiles SET
             lod = ?, revision = ?, profile_json = ?, generation_record_id = ?, updated_at = ?
           WHERE id = ? AND campaign_id = ? AND revision = ? AND lod = ?`,
        )
        .run(
          canonical.lod,
          canonical.revision,
          JSON.stringify(canonical),
          canonical.generationRecordId,
          canonical.updatedAt,
          canonical.id,
          canonical.campaignId,
          command.expectedRevision,
          current.lod,
        ).changes;
      if (changed !== 1) throw new PersistenceDataError('NPC LOD revision drift');
      this.database
        .prepare(
          `INSERT INTO npc_lod_transitions (
             id, campaign_id, npc_id, idempotency_key, from_lod, to_lod, trigger,
             before_revision, after_revision, before_profile_json, after_profile_json,
             generation_record_id, occurred_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          command.transitionId,
          canonical.campaignId,
          canonical.id,
          command.idempotencyKey,
          current.lod,
          canonical.lod,
          command.trigger,
          current.revision,
          canonical.revision,
          JSON.stringify(current),
          JSON.stringify(canonical),
          canonical.generationRecordId,
          canonical.updatedAt,
        );
      const saved = this.require(canonical.id);
      this.database.exec('COMMIT');
      return saved;
    } catch (error) {
      rollback(this.database, error, 'NPC LOD upgrade persistence failed');
    }
  }

  public listTransitions(id: NpcId): readonly NpcLodTransition[] {
    return Object.freeze(
      this.database
        .prepare(
          `SELECT id,campaign_id,npc_id,from_lod,to_lod,trigger,before_revision,
                  after_revision,generation_record_id,occurred_at
           FROM npc_lod_transitions WHERE npc_id = ? ORDER BY occurred_at,id`,
        )
        .all(id)
        .map(mapTransition),
    );
  }
}

function mapProfile(value: unknown): NpcLodProfile {
  try {
    const row = requireRecord(value, 'NPC LOD row');
    const profile = parseNpcLodProfile(parseJson(row['profile_json'], 'profile_json'));
    const generation = row['generation_record_id'];
    if (
      profile.id !== requireString(row['id'], 'id') ||
      profile.campaignId !== requireString(row['campaign_id'], 'campaign_id') ||
      profile.schemaVersion !== requireNumber(row['schema_version'], 'schema_version') ||
      profile.constitutionRevision !==
        requireNumber(row['constitution_revision'], 'constitution_revision') ||
      profile.lod !== requireNumber(row['lod'], 'lod') ||
      profile.revision !== requireNumber(row['revision'], 'revision') ||
      profile.generationRecordId !== generation ||
      profile.createdAt !== requireString(row['created_at'], 'created_at') ||
      profile.updatedAt !== requireString(row['updated_at'], 'updated_at')
    ) {
      throw new PersistenceDataError('NPC LOD columns disagree with profile JSON');
    }
    return profile;
  } catch (error) {
    if (error instanceof PersistenceDataError) throw error;
    throw new PersistenceDataError('Persisted NPC LOD profile is invalid', { cause: error });
  }
}

function mapTransition(value: unknown): NpcLodTransition {
  const row = requireRecord(value, 'NPC LOD transition row');
  return Object.freeze({
    id: requireString(row['id'], 'id'),
    campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
    npcId: npcId(requireString(row['npc_id'], 'npc_id')),
    fromLod: requireNumber(row['from_lod'], 'from_lod') as NpcLodTransition['fromLod'],
    toLod: requireNumber(row['to_lod'], 'to_lod') as NpcLodTransition['toLod'],
    trigger: requireEnum(NPC_LOD_UPGRADE_TRIGGERS, row['trigger'], 'trigger'),
    beforeRevision: requireNumber(row['before_revision'], 'before_revision'),
    afterRevision: requireNumber(row['after_revision'], 'after_revision'),
    generationRecordId: generationRecordId(
      requireString(row['generation_record_id'], 'generation_record_id'),
    ),
    occurredAt: isoTimestamp(requireString(row['occurred_at'], 'occurred_at')),
  });
}

function requireConstitution(database: TransactionalSqliteDatabase, profile: NpcLodProfile): void {
  const row = database
    .prepare(
      `SELECT npc_rules,society,technology FROM world_constitutions
       WHERE campaign_id = ? AND revision = ? AND status = 'LOCKED'`,
    )
    .get(profile.campaignId, profile.constitutionRevision);
  if (row === undefined) {
    throw new PersistenceDataError('NPC LOD requires the locked Constitution revision');
  }
  const evidence = requireRecord(row, 'NPC LOD Constitution');
  if (
    profile.constitutionEvidence.npcRules !== requireString(evidence['npc_rules'], 'npc_rules') ||
    profile.constitutionEvidence.society !== requireString(evidence['society'], 'society') ||
    profile.constitutionEvidence.technology !== requireString(evidence['technology'], 'technology')
  ) {
    throw new PersistenceDataError('NPC LOD evidence disagrees with the locked Constitution');
  }
}

function requireGeneration(database: TransactionalSqliteDatabase, profile: NpcLodProfile): void {
  const row = database
    .prepare(
      `SELECT gr.task, pr.status
       FROM generation_records gr
       JOIN pending_ai_requests pr ON pr.id = gr.request_id
       WHERE gr.id = ? AND gr.campaign_id = ?`,
    )
    .get(profile.generationRecordId, profile.campaignId);
  if (row === undefined) throw new PersistenceDataError('NPC LOD generation record is missing');
  const generation = requireRecord(row, 'NPC LOD generation');
  if (
    requireString(generation['task'], 'task') !== 'GENERATE_NPC_LOD' ||
    !['VALIDATING', 'COMMITTED'].includes(requireString(generation['status'], 'status'))
  ) {
    throw new PersistenceDataError('NPC LOD generation record is not ready');
  }
}

function requireReferences(database: TransactionalSqliteDatabase, profile: NpcLodProfile): void {
  for (const id of [...profile.knowledgeFactIds, ...profile.secretFactIds]) {
    const row = database
      .prepare(
        `SELECT wt.visibility
         FROM actor_knowledge ak
         JOIN world_truths wt ON wt.id = ak.truth_id
         WHERE ak.campaign_id=? AND ak.actor_type='NPC' AND ak.actor_id=?
           AND ak.target_kind='TRUTH' AND ak.knowledge_state='KNOWN' AND ak.truth_id=?`,
      )
      .get(profile.campaignId, profile.id, id);
    if (row === undefined) throw new PersistenceDataError(`NPC LOD fact is unauthorized: ${id}`);
    if (
      profile.secretFactIds.includes(id) &&
      requireString(requireRecord(row, 'NPC LOD truth')['visibility'], 'visibility') !== 'SECRET'
    ) {
      throw new PersistenceDataError(`NPC LOD secret is not a secret Truth: ${id}`);
    }
  }
  for (const id of profile.relationshipNpcIds) {
    requireReference(
      database
        .prepare('SELECT 1 FROM npc_lod_profiles WHERE id=? AND campaign_id=?')
        .get(id, profile.campaignId),
      id,
    );
  }
  for (const id of profile.memoryIds) {
    requireReference(
      database
        .prepare(
          `SELECT 1 FROM knowledge_memories
           WHERE id=? AND campaign_id=? AND actor_type='NPC' AND actor_id=?`,
        )
        .get(id, profile.campaignId, profile.id),
      id,
    );
  }
  for (const id of profile.questIds) {
    requireReference(
      database
        .prepare('SELECT 1 FROM quests WHERE id=? AND campaign_id=?')
        .get(id, profile.campaignId),
      id,
    );
  }
  for (const id of profile.itemIds) {
    requireReference(
      database
        .prepare('SELECT 1 FROM items WHERE id=? AND campaign_id=?')
        .get(id, profile.campaignId),
      id,
    );
  }
  for (const id of profile.experienceEventIds) {
    requireReference(
      database
        .prepare('SELECT 1 FROM game_events WHERE id=? AND campaign_id=?')
        .get(id, profile.campaignId),
      id,
    );
  }
}

function requireReference(row: unknown, id: string): void {
  if (row === undefined) throw new PersistenceDataError(`NPC LOD reference is missing: ${id}`);
}

function rollback(database: TransactionalSqliteDatabase, error: unknown, message: string): never {
  try {
    database.exec('ROLLBACK');
  } catch (rollbackError) {
    throw new PersistenceDataError(`${message}; rollback also failed`, {
      cause: new AggregateError([error, rollbackError]),
    });
  }
  if (error instanceof PersistenceDataError) throw error;
  throw new PersistenceDataError(message, { cause: error });
}
