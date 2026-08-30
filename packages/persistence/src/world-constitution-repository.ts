import {
  WORLD_CONSTITUTION_STATUSES,
  campaignId,
  isoTimestamp,
  schemaVersion,
  type CampaignId,
  type IsoTimestamp,
  type WorldConstitution,
  type WorldConstitutionContent,
} from '@ember-tavern/contracts';

import { PersistenceDataError } from './campaign-repository.js';
import {
  parseJson,
  requireEnum,
  requireNullableString,
  requireNumber,
  requireRecord,
  requireString,
  requireStringArray,
} from './persistence-validation.js';
import type { SqliteDatabase } from './sqlite-port.js';

export class WorldConstitutionRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public get(id: CampaignId): WorldConstitution | null {
    const row = this.database
      .prepare('SELECT * FROM world_constitutions WHERE campaign_id = ?')
      .get(id);
    return row === undefined ? null : mapConstitution(row);
  }

  public saveDraft(
    id: CampaignId,
    content: WorldConstitutionContent,
    at: IsoTimestamp,
  ): WorldConstitution {
    validateContent(content);
    const current = this.get(id);
    if (current?.status === 'LOCKED') {
      throw new PersistenceDataError('Locked WorldConstitution cannot be revised');
    }
    const revision = (current?.revision ?? 0) + 1;
    this.database
      .prepare(
        `INSERT INTO world_constitutions (
           campaign_id, schema_version, revision, status, world_type, era, technology,
           magic, peoples_json, society, politics, economy, combat_scale, death_rules,
           career_rules, equipment_rules, npc_rules, trait_rules, taboos_json,
           created_at, updated_at, locked_at
         ) VALUES (?, 1, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(campaign_id) DO UPDATE SET
           revision = excluded.revision, world_type = excluded.world_type, era = excluded.era,
           technology = excluded.technology, magic = excluded.magic,
           peoples_json = excluded.peoples_json, society = excluded.society,
           politics = excluded.politics, economy = excluded.economy,
           combat_scale = excluded.combat_scale, death_rules = excluded.death_rules,
           career_rules = excluded.career_rules, equipment_rules = excluded.equipment_rules,
           npc_rules = excluded.npc_rules, trait_rules = excluded.trait_rules,
           taboos_json = excluded.taboos_json, updated_at = excluded.updated_at`,
      )
      .run(
        id,
        revision,
        content.worldType,
        content.era,
        content.technology,
        content.magic,
        JSON.stringify(content.peoples),
        content.society,
        content.politics,
        content.economy,
        content.combatScale,
        content.deathRules,
        content.careerRules,
        content.equipmentRules,
        content.npcRules,
        content.traitRules,
        JSON.stringify(content.taboos),
        current?.createdAt ?? at,
        at,
      );
    return this.require(id);
  }

  public lock(id: CampaignId, expectedRevision: number, at: IsoTimestamp): WorldConstitution {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new PersistenceDataError('WorldConstitution expected revision is invalid');
    }
    const changed = this.database
      .prepare(
        `UPDATE world_constitutions
         SET status = 'LOCKED', locked_at = ?, updated_at = ?
         WHERE campaign_id = ? AND revision = ? AND status = 'DRAFT'`,
      )
      .run(at, at, id, expectedRevision).changes;
    if (changed !== 1) {
      throw new PersistenceDataError('WorldConstitution revision cannot be locked');
    }
    return this.require(id);
  }

  public requireRevision(
    id: CampaignId,
    expectedRevision: number,
    requireLocked = true,
  ): WorldConstitution {
    const value = this.require(id);
    if (value.revision !== expectedRevision || (requireLocked && value.status !== 'LOCKED')) {
      throw new PersistenceDataError('WorldConstitution revision mismatch');
    }
    return value;
  }

  private require(id: CampaignId): WorldConstitution {
    const value = this.get(id);
    if (value === null) throw new PersistenceDataError('WorldConstitution does not exist');
    return value;
  }
}

function mapConstitution(value: unknown): WorldConstitution {
  try {
    const row = requireRecord(value, 'WorldConstitution row');
    const lockedAt = requireNullableString(row['locked_at'], 'locked_at');
    const result = Object.freeze({
      campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
      schemaVersion: schemaVersion(requireNumber(row['schema_version'], 'schema_version')),
      revision: requireNumber(row['revision'], 'revision'),
      status: requireEnum(WORLD_CONSTITUTION_STATUSES, row['status'], 'status'),
      worldType: requireString(row['world_type'], 'world_type'),
      era: requireString(row['era'], 'era'),
      technology: requireString(row['technology'], 'technology'),
      magic: requireString(row['magic'], 'magic'),
      peoples: requireStringArray(parseJson(row['peoples_json'], 'peoples_json'), 'peoples'),
      society: requireString(row['society'], 'society'),
      politics: requireString(row['politics'], 'politics'),
      economy: requireString(row['economy'], 'economy'),
      combatScale: requireString(row['combat_scale'], 'combat_scale'),
      deathRules: requireString(row['death_rules'], 'death_rules'),
      careerRules: requireString(row['career_rules'], 'career_rules'),
      equipmentRules: requireString(row['equipment_rules'], 'equipment_rules'),
      npcRules: requireString(row['npc_rules'], 'npc_rules'),
      traitRules: requireString(row['trait_rules'], 'trait_rules'),
      taboos: requireStringArray(parseJson(row['taboos_json'], 'taboos_json'), 'taboos'),
      createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
      updatedAt: isoTimestamp(requireString(row['updated_at'], 'updated_at')),
      lockedAt: lockedAt === null ? null : isoTimestamp(lockedAt),
    }) satisfies WorldConstitution;
    validateConstitution(result);
    return result;
  } catch (error) {
    if (error instanceof PersistenceDataError) throw error;
    throw new PersistenceDataError('Persisted WorldConstitution row is invalid', { cause: error });
  }
}

function validateConstitution(value: WorldConstitution): void {
  validateContent(value);
  if (
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    (value.status === 'DRAFT' && value.lockedAt !== null) ||
    (value.status === 'LOCKED' && value.lockedAt === null) ||
    value.updatedAt < value.createdAt ||
    (value.lockedAt !== null && value.lockedAt < value.createdAt)
  ) {
    throw new PersistenceDataError('WorldConstitution metadata is invalid');
  }
}

function validateContent(value: WorldConstitutionContent): void {
  for (const text of [
    value.worldType,
    value.era,
    value.technology,
    value.magic,
    value.society,
    value.politics,
    value.economy,
    value.combatScale,
    value.deathRules,
    value.careerRules,
    value.equipmentRules,
    value.npcRules,
    value.traitRules,
  ]) {
    if (text.trim().length === 0 || text.length > 4_000) {
      throw new PersistenceDataError('WorldConstitution text is invalid');
    }
  }
  for (const values of [value.peoples, value.taboos]) {
    if (
      values.length > 24 ||
      values.some((entry) => entry.trim().length === 0 || entry.length > 200)
    ) {
      throw new PersistenceDataError('WorldConstitution list is invalid');
    }
  }
}
