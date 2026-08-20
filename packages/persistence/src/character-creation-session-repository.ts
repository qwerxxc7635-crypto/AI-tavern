import {
  campaignId,
  createUniversalCharacterProfile,
  isoTimestamp,
  markCharacterCreationConfirmed,
  materializeUniversalCharacterProfile,
  playerCharacterId,
  parseUniversalCharacterDraft,
  projectUniversalCharacterToV02,
  restoreCharacterCreationSession,
  type CharacterCreationSession,
  type UniversalCharacterProfile,
} from '@ember-tavern/contracts';

import { PersistenceDataError } from './campaign-repository.js';
import type { TransactionalSqliteDatabase } from './sqlite-port.js';
import { UniversalCharacterRepository } from './universal-character-repository.js';

export interface CharacterCreationConfirmation {
  readonly session: CharacterCreationSession;
  readonly character: UniversalCharacterProfile;
}

export class CharacterCreationSessionRepository {
  private readonly universalCharacters: UniversalCharacterRepository;

  public constructor(private readonly database: TransactionalSqliteDatabase) {
    this.universalCharacters = new UniversalCharacterRepository(database);
  }

  public create(session: CharacterCreationSession): CharacterCreationSession {
    if (session.revision !== 1) {
      throw new PersistenceDataError('New character creation session must start at revision 1');
    }
    return this.inTransaction(() => {
      if (this.getByCampaign(session.campaignId) !== null) {
        throw new PersistenceDataError('Character creation session already exists');
      }
      const definitions = this.universalCharacters.listExtensionDefinitions(session.campaignId);
      const canonical = restoreCharacterCreationSession(session, definitions);
      this.database
        .prepare(
          `INSERT INTO character_creation_sessions (
             id, campaign_id, character_id, schema_version, constitution_revision,
             mode, status, concept_input, draft_json, locked_fields_json,
             generation_record_id, revision, created_at, updated_at,
             cancelled_at, confirmed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(...sessionValues(canonical));
      return this.requireByCampaign(canonical.campaignId);
    });
  }

  public getByCampaign(
    campaign: CharacterCreationSession['campaignId'],
  ): CharacterCreationSession | null {
    const row = this.database
      .prepare('SELECT * FROM character_creation_sessions WHERE campaign_id = ?')
      .get(campaign);
    if (row === undefined) return null;
    const definitions = this.universalCharacters.listExtensionDefinitions(campaign);
    return mapSessionRow(row, definitions);
  }

  public requireByCampaign(
    campaign: CharacterCreationSession['campaignId'],
  ): CharacterCreationSession {
    const session = this.getByCampaign(campaign);
    if (session === null) {
      throw new PersistenceDataError(`Character creation session not found: ${campaign}`);
    }
    return session;
  }

  public save(
    session: CharacterCreationSession,
    expectedRevision: number,
  ): CharacterCreationSession {
    requireExpectedRevision(expectedRevision);
    if (session.revision !== expectedRevision + 1) {
      throw new PersistenceDataError('Character creation session revision does not advance by one');
    }
    return this.inTransaction(() => {
      const current = this.requireByCampaign(session.campaignId);
      if (current.revision !== expectedRevision || current.id !== session.id) {
        throw new PersistenceDataError('Character creation session revision drift');
      }
      const definitions = this.universalCharacters.listExtensionDefinitions(session.campaignId);
      const canonical = restoreCharacterCreationSession(session, definitions);
      const result = this.database
        .prepare(
          `UPDATE character_creation_sessions SET
             mode = ?, status = ?, concept_input = ?, draft_json = ?,
             locked_fields_json = ?, generation_record_id = ?, revision = ?,
             updated_at = ?, cancelled_at = ?, confirmed_at = ?
           WHERE id = ? AND campaign_id = ? AND revision = ?`,
        )
        .run(
          canonical.mode,
          canonical.status,
          canonical.conceptInput,
          JSON.stringify(canonical.draft),
          JSON.stringify(canonical.lockedFields),
          canonical.generationRecordId,
          canonical.revision,
          canonical.updatedAt,
          canonical.cancelledAt,
          canonical.confirmedAt,
          canonical.id,
          canonical.campaignId,
          expectedRevision,
        );
      if (result.changes !== 1) {
        throw new PersistenceDataError('Character creation session revision drift');
      }
      return this.requireByCampaign(canonical.campaignId);
    });
  }

  public confirm(
    campaign: CharacterCreationSession['campaignId'],
    expectedRevision: number,
    confirmedAt: CharacterCreationSession['updatedAt'],
  ): CharacterCreationConfirmation {
    requireExpectedRevision(expectedRevision);
    return this.inTransaction(() => {
      const session = this.requireByCampaign(campaign);
      if (session.status === 'CONFIRMED') {
        if (expectedRevision !== session.revision && expectedRevision + 1 !== session.revision) {
          throw new PersistenceDataError('Character creation session revision drift');
        }
        return { session, character: this.universalCharacters.requireProfile(session.characterId) };
      }
      if (session.revision !== expectedRevision) {
        throw new PersistenceDataError('Character creation session revision drift');
      }
      const definitions = this.universalCharacters.listExtensionDefinitions(campaign);
      const initialProfile = materializeUniversalCharacterProfile(
        session,
        definitions,
        confirmedAt,
      );
      const legacy = projectForInsert(initialProfile);
      const campaignRow = this.database
        .prepare('SELECT state FROM campaigns WHERE id = ?')
        .get(campaign);
      if (
        campaignRow === undefined ||
        requireString(requireRecord(campaignRow, 'campaign')['state'], 'campaign.state') !==
          'CREATING_CHARACTER'
      ) {
        throw new PersistenceDataError('Campaign is not creating a character');
      }
      if (session.mode === 'QUICK') this.requireQuickGeneration(session);
      this.database
        .prepare(
          `INSERT INTO player_characters (
             id, campaign_id, name, gender, age, concept,
             story_preferences_json, content_boundaries_json,
             class_archetype, class_display_name, attributes_json, traits_json,
             personal_goal, background_json, initial_equipment_ids_json,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          legacy.id,
          legacy.campaignId,
          legacy.name,
          legacy.gender,
          legacy.age,
          legacy.concept,
          JSON.stringify(legacy.storyPreferences),
          JSON.stringify(legacy.contentBoundaries),
          legacy.classArchetype,
          legacy.classDisplayName,
          JSON.stringify(legacy.attributes),
          JSON.stringify(legacy.traits),
          legacy.personalGoal,
          JSON.stringify(legacy.background),
          JSON.stringify(legacy.initialEquipment.map(({ itemId }) => itemId)),
          legacy.createdAt,
          legacy.updatedAt,
        );
      const storedProfile = createStoredProfile(initialProfile);
      const profileUpdate = this.database
        .prepare(
          `UPDATE universal_character_profiles
           SET profile_json = ?, revision = ?, updated_at = ?
           WHERE player_character_id = ? AND revision = 1`,
        )
        .run(
          JSON.stringify(storedProfile),
          storedProfile.revision,
          storedProfile.updatedAt,
          storedProfile.id,
        );
      if (profileUpdate.changes !== 1) {
        throw new PersistenceDataError('Universal character confirmation projection failed');
      }
      const confirmed = markCharacterCreationConfirmed(session, definitions, confirmedAt);
      const sessionUpdate = this.database
        .prepare(
          `UPDATE character_creation_sessions SET
             status = ?, revision = ?, updated_at = ?, confirmed_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(
          confirmed.status,
          confirmed.revision,
          confirmed.updatedAt,
          confirmed.confirmedAt,
          confirmed.id,
          expectedRevision,
        );
      if (sessionUpdate.changes !== 1) {
        throw new PersistenceDataError('Character creation session revision drift');
      }
      const campaignUpdate = this.database
        .prepare(
          `UPDATE campaigns SET state = 'GENERATING_TAVERN', resume_state = NULL, updated_at = ?
           WHERE id = ? AND state = 'CREATING_CHARACTER'`,
        )
        .run(confirmedAt, campaign);
      if (campaignUpdate.changes !== 1) {
        throw new PersistenceDataError('Campaign character confirmation failed');
      }
      return {
        session: this.requireByCampaign(campaign),
        character: this.universalCharacters.requireProfile(session.characterId),
      };
    });
  }

  private requireQuickGeneration(session: CharacterCreationSession): void {
    if (session.generationRecordId === null) {
      throw new PersistenceDataError('Quick character confirmation requires generation provenance');
    }
    const row = this.database
      .prepare(
        `SELECT task, validated_output_json, validation_error_json
         FROM generation_records WHERE id = ? AND campaign_id = ?`,
      )
      .get(session.generationRecordId, session.campaignId);
    if (row === undefined) {
      throw new PersistenceDataError('Quick character generation record is missing');
    }
    const record = requireRecord(row, 'generation record');
    if (
      requireString(record['task'], 'generation task') !== 'GENERATE_QUICK_CHARACTER' ||
      record['validated_output_json'] === null ||
      record['validation_error_json'] !== null
    ) {
      throw new PersistenceDataError('Quick character generation record is not validated');
    }
  }

  private inTransaction<Value>(run: () => Value): Value {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const value = run();
      this.database.exec('COMMIT');
      return value;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch (rollbackError) {
        throw new PersistenceDataError('Character creation transaction and rollback both failed', {
          cause: new AggregateError([error, rollbackError]),
        });
      }
      if (error instanceof PersistenceDataError) throw error;
      throw new PersistenceDataError('Character creation transaction failed', { cause: error });
    }
  }
}

function sessionValues(session: CharacterCreationSession) {
  return [
    session.id,
    session.campaignId,
    session.characterId,
    session.schemaVersion,
    session.constitutionRevision,
    session.mode,
    session.status,
    session.conceptInput,
    JSON.stringify(session.draft),
    JSON.stringify(session.lockedFields),
    session.generationRecordId,
    session.revision,
    session.createdAt,
    session.updatedAt,
    session.cancelledAt,
    session.confirmedAt,
  ] as const;
}

function mapSessionRow(
  value: unknown,
  definitions: Parameters<typeof restoreCharacterCreationSession>[1],
): CharacterCreationSession {
  const row = requireRecord(value, 'character creation session');
  const draftValue = parseJson(row['draft_json'], 'draft_json');
  const draft = parseUniversalCharacterDraft(draftValue);
  const lockedFields = requireArray(
    parseJson(row['locked_fields_json'], 'locked_fields_json'),
    'locked_fields_json',
  ).map((entry, index) => requireString(entry, `locked_fields_json[${index}]`));
  return restoreCharacterCreationSession(
    {
      schemaVersion: requireNumber(row['schema_version'], 'schema_version') as 1,
      id: requireString(row['id'], 'id'),
      campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
      characterId: playerCharacterId(requireString(row['character_id'], 'character_id')),
      constitutionRevision: requireNumber(row['constitution_revision'], 'constitution_revision'),
      mode: requireString(row['mode'], 'mode') as CharacterCreationSession['mode'],
      status: requireString(row['status'], 'status') as CharacterCreationSession['status'],
      conceptInput: requireNullableString(row['concept_input'], 'concept_input'),
      draft,
      lockedFields,
      generationRecordId: requireNullableString(
        row['generation_record_id'],
        'generation_record_id',
      ) as CharacterCreationSession['generationRecordId'],
      revision: requireNumber(row['revision'], 'revision'),
      createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
      updatedAt: isoTimestamp(requireString(row['updated_at'], 'updated_at')),
      cancelledAt:
        row['cancelled_at'] === null
          ? null
          : isoTimestamp(requireString(row['cancelled_at'], 'cancelled_at')),
      confirmedAt:
        row['confirmed_at'] === null
          ? null
          : isoTimestamp(requireString(row['confirmed_at'], 'confirmed_at')),
    },
    definitions,
  );
}

function createStoredProfile(profile: UniversalCharacterProfile): UniversalCharacterProfile {
  return createUniversalCharacterProfile({ ...profile, revision: 2 });
}

function projectForInsert(profile: UniversalCharacterProfile) {
  try {
    return projectUniversalCharacterToV02(profile);
  } catch (error) {
    throw new PersistenceDataError('Character cannot enter the V0.2 compatibility surface', {
      cause: error,
    });
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PersistenceDataError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new PersistenceDataError(`${label} must be an array`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new PersistenceDataError(`${label} must be text`);
  return value;
}

function requireNullableString(value: unknown, label: string): string | null {
  return value === null ? null : requireString(value, label);
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PersistenceDataError(`${label} must be a finite number`);
  }
  return value;
}

function parseJson(value: unknown, label: string): unknown {
  try {
    return JSON.parse(requireString(value, label)) as unknown;
  } catch (error) {
    throw new PersistenceDataError(`${label} is not valid JSON`, { cause: error });
  }
}

function requireExpectedRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new PersistenceDataError('Expected session revision must be a positive integer');
  }
}
