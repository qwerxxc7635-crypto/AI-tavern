import {
  CHARACTER_EXTENSION_FIELD_TYPES,
  UniversalCharacterError,
  campaignId,
  characterTraitId,
  createTraitPointProfile,
  createUniversalCharacterProfile,
  createWorldCharacterExtensionDefinition,
  isoTimestamp,
  itemId,
  playerCharacterId,
  projectUniversalCharacterToV02,
  validateCharacterExtensionValues,
  type CharacterBackground,
  type CharacterExtensionFieldDefinition,
  type CharacterExtensionValueSet,
  type CharacterRelationshipSummary,
  type CharacterReputation,
  type ClassArchetype,
  type ContentBoundaries,
  type JsonValue,
  type NamedCharacterValue,
  type PlayerCharacter,
  type UniversalCharacterCareer,
  type UniversalCharacterProfile,
  type WorldCharacterExtensionDefinition,
} from '@ember-tavern/contracts';

import { PersistenceDataError } from './campaign-repository.js';
import {
  parseJson,
  requireArray,
  requireBoolean,
  requireNullableString,
  requireNumber,
  requireRecord,
  requireString,
  requireStringArray,
} from './persistence-validation.js';
import type { TransactionalSqliteDatabase } from './sqlite-port.js';

export class UniversalCharacterRepository {
  public constructor(private readonly database: TransactionalSqliteDatabase) {}

  public saveExtensionDefinition(
    definition: WorldCharacterExtensionDefinition,
    expectedRevision: number,
  ): WorldCharacterExtensionDefinition {
    const canonical = createWorldCharacterExtensionDefinition(definition);
    requireExpectedRevision(expectedRevision);
    if (canonical.revision !== expectedRevision + 1) {
      throw new PersistenceDataError(
        'Character extension revision does not follow expected revision',
      );
    }
    return this.inTransaction(() => {
      const current = this.getExtensionDefinition(canonical.campaignId, canonical.namespace);
      requireScopedRevision(current, canonical.campaignId, expectedRevision, 'Character extension');
      if (current === null) {
        this.database
          .prepare(
            `INSERT INTO character_extension_definitions (
             campaign_id, namespace, schema_version, constitution_revision,
             definition_json, revision, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            canonical.campaignId,
            canonical.namespace,
            canonical.schemaVersion,
            canonical.constitutionRevision,
            JSON.stringify(canonical),
            canonical.revision,
            canonical.createdAt,
            canonical.updatedAt,
          );
      } else {
        if (current.createdAt !== canonical.createdAt) {
          throw new PersistenceDataError('Character extension createdAt is immutable');
        }
        this.database
          .prepare(
            `UPDATE character_extension_definitions SET
             schema_version = ?, constitution_revision = ?, definition_json = ?,
             revision = ?, updated_at = ?
           WHERE campaign_id = ? AND namespace = ?`,
          )
          .run(
            canonical.schemaVersion,
            canonical.constitutionRevision,
            JSON.stringify(canonical),
            canonical.revision,
            canonical.updatedAt,
            canonical.campaignId,
            canonical.namespace,
          );
      }
      return this.requireExtensionDefinition(canonical.campaignId, canonical.namespace);
    });
  }

  public getExtensionDefinition(
    campaign: UniversalCharacterProfile['campaignId'],
    namespace: string,
  ): WorldCharacterExtensionDefinition | null {
    const row = this.database
      .prepare(
        `SELECT * FROM character_extension_definitions
       WHERE campaign_id = ? AND namespace = ?`,
      )
      .get(campaign, namespace);
    return row === undefined ? null : mapExtensionDefinitionRow(row);
  }

  public requireExtensionDefinition(
    campaign: UniversalCharacterProfile['campaignId'],
    namespace: string,
  ): WorldCharacterExtensionDefinition {
    const definition = this.getExtensionDefinition(campaign, namespace);
    if (definition === null) {
      throw new PersistenceDataError(`Character extension not found: ${namespace}`);
    }
    return definition;
  }

  public listExtensionDefinitions(
    campaign: UniversalCharacterProfile['campaignId'],
  ): readonly WorldCharacterExtensionDefinition[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM character_extension_definitions
       WHERE campaign_id = ? ORDER BY namespace LIMIT 17`,
      )
      .all(campaign);
    if (rows.length > 16) throw new PersistenceDataError('Character extensions exceed the limit');
    return Object.freeze(rows.map(mapExtensionDefinitionRow));
  }

  public saveProfile(
    profile: UniversalCharacterProfile,
    expectedRevision: number,
  ): UniversalCharacterProfile {
    const canonical = createUniversalCharacterProfile(profile);
    requireExpectedRevision(expectedRevision);
    if (canonical.revision !== expectedRevision + 1) {
      throw new PersistenceDataError(
        'Universal character revision does not follow expected revision',
      );
    }
    return this.inTransaction(() => {
      const definitions = this.listExtensionDefinitions(canonical.campaignId);
      validateCharacterExtensionValues(canonical, definitions);
      const character = this.database
        .prepare('SELECT campaign_id FROM player_characters WHERE id = ?')
        .get(canonical.id);
      if (
        character === undefined ||
        requireString(requireRecord(character, 'character')['campaign_id'], 'campaign_id') !==
          canonical.campaignId
      ) {
        throw new PersistenceDataError(
          'Universal character has no V0.2 character in this campaign',
        );
      }
      const current = this.getProfile(canonical.id);
      requireScopedRevision(current, canonical.campaignId, expectedRevision, 'Universal character');
      if (current !== null) {
        if (current.createdAt !== canonical.createdAt) {
          throw new PersistenceDataError('Universal character createdAt is immutable');
        }
        if (JSON.stringify(current.attributes) !== JSON.stringify(canonical.attributes)) {
          throw new PersistenceDataError('Universal character base attributes are immutable');
        }
      }
      this.requireRulesProjection(canonical);
      if (current === null) {
        this.database
          .prepare(
            `INSERT INTO universal_character_profiles (
             player_character_id, campaign_id, schema_version, profile_json,
             revision, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            canonical.id,
            canonical.campaignId,
            canonical.schemaVersion,
            JSON.stringify(canonical),
            canonical.revision,
            canonical.createdAt,
            canonical.updatedAt,
          );
      } else {
        this.database
          .prepare(
            `UPDATE universal_character_profiles SET
             profile_json = ?, revision = ?, updated_at = ?
           WHERE player_character_id = ?`,
          )
          .run(JSON.stringify(canonical), canonical.revision, canonical.updatedAt, canonical.id);
      }
      return this.requireProfile(canonical.id);
    });
  }

  public getProfile(id: UniversalCharacterProfile['id']): UniversalCharacterProfile | null {
    const row = this.database
      .prepare('SELECT * FROM universal_character_profiles WHERE player_character_id = ?')
      .get(id);
    if (row === undefined) return null;
    const profile = mapProfileRow(row);
    validateCharacterExtensionValues(profile, this.listExtensionDefinitions(profile.campaignId));
    return profile;
  }

  public requireProfile(id: UniversalCharacterProfile['id']): UniversalCharacterProfile {
    const profile = this.getProfile(id);
    if (profile === null) throw new PersistenceDataError(`Universal character not found: ${id}`);
    return profile;
  }

  public projectV02(id: UniversalCharacterProfile['id']): PlayerCharacter {
    return projectUniversalCharacterToV02(this.requireProfile(id));
  }

  private requireRulesProjection(profile: UniversalCharacterProfile): void {
    const value = this.database
      .prepare(
        `SELECT base_attributes_json, skills_json, money, statuses_json
         FROM character_rule_states WHERE player_character_id = ? AND campaign_id = ?`,
      )
      .get(profile.id, profile.campaignId);
    if (value === undefined) {
      throw new PersistenceDataError('Universal character requires a Rules Engine state');
    }
    const row = requireRecord(value, 'Character rules projection');
    const attributes = parseJson(row['base_attributes_json'], 'base_attributes_json');
    const skills = requireArray(parseJson(row['skills_json'], 'skills_json'), 'skills_json').map(
      (entry, index) =>
        requireString(
          requireRecord(entry, `skills_json[${index}]`)['name'],
          `skills_json[${index}].name`,
        ),
    );
    const statuses = requireArray(
      parseJson(row['statuses_json'], 'statuses_json'),
      'statuses_json',
    ).map((entry, index) =>
      requireString(
        requireRecord(entry, `statuses_json[${index}]`)['kind'],
        `statuses_json[${index}].kind`,
      ),
    );
    if (
      JSON.stringify(profile.attributes) !== JSON.stringify(attributes) ||
      JSON.stringify(profile.skills) !== JSON.stringify(skills) ||
      profile.wealth !== requireNumber(row['money'], 'money') ||
      JSON.stringify(profile.statuses) !== JSON.stringify(statuses)
    ) {
      throw new PersistenceDataError(
        'Universal character numeric fields must match the Rules Engine projection',
      );
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
        throw new PersistenceDataError('Universal character transaction and rollback both failed', {
          cause: new AggregateError([error, rollbackError]),
        });
      }
      if (error instanceof PersistenceDataError) throw error;
      if (error instanceof UniversalCharacterError) {
        throw new PersistenceDataError(error.message, { cause: error });
      }
      throw new PersistenceDataError('Universal character transaction failed', { cause: error });
    }
  }
}

function mapExtensionDefinitionRow(value: unknown): WorldCharacterExtensionDefinition {
  const row = requireRecord(value, 'Character extension row');
  const definition = mapExtensionDefinition(parseJson(row['definition_json'], 'definition_json'));
  if (
    definition.campaignId !== requireString(row['campaign_id'], 'campaign_id') ||
    definition.namespace !== requireString(row['namespace'], 'namespace') ||
    definition.schemaVersion !== requireNumber(row['schema_version'], 'schema_version') ||
    definition.constitutionRevision !==
      requireNumber(row['constitution_revision'], 'constitution_revision') ||
    definition.revision !== requireNumber(row['revision'], 'revision') ||
    definition.createdAt !== requireString(row['created_at'], 'created_at') ||
    definition.updatedAt !== requireString(row['updated_at'], 'updated_at')
  ) {
    throw new PersistenceDataError('Character extension columns disagree with definition JSON');
  }
  return definition;
}

function mapExtensionDefinition(value: unknown): WorldCharacterExtensionDefinition {
  const row = requireRecord(value, 'Character extension definition');
  return createWorldCharacterExtensionDefinition({
    schemaVersion: requireNumber(row['schemaVersion'], 'schemaVersion') as 1,
    campaignId: campaignId(requireString(row['campaignId'], 'campaignId')),
    namespace: requireString(row['namespace'], 'namespace'),
    displayName: requireString(row['displayName'], 'displayName'),
    constitutionRevision: requireNumber(row['constitutionRevision'], 'constitutionRevision'),
    fields: requireArray(row['fields'], 'fields').map(mapExtensionField),
    revision: requireNumber(row['revision'], 'revision'),
    createdAt: isoTimestamp(requireString(row['createdAt'], 'createdAt')),
    updatedAt: isoTimestamp(requireString(row['updatedAt'], 'updatedAt')),
  });
}

function mapExtensionField(value: unknown, index: number): CharacterExtensionFieldDefinition {
  const row = requireRecord(value, `fields[${index}]`);
  const type = requireString(row['type'], `fields[${index}].type`);
  if (
    !CHARACTER_EXTENSION_FIELD_TYPES.includes(type as CharacterExtensionFieldDefinition['type'])
  ) {
    throw new PersistenceDataError(`fields[${index}].type is unsupported`);
  }
  const base = {
    key: requireString(row['key'], `fields[${index}].key`),
    label: requireString(row['label'], `fields[${index}].label`),
    required: requireBoolean(row['required'], `fields[${index}].required`),
  };
  if (type === 'TEXT')
    return { ...base, type, maxLength: requireNumber(row['maxLength'], 'maxLength') };
  if (type === 'INTEGER' || type === 'NUMBER')
    return {
      ...base,
      type,
      minimum: requireNumber(row['minimum'], 'minimum'),
      maximum: requireNumber(row['maximum'], 'maximum'),
    };
  if (type === 'BOOLEAN') return { ...base, type };
  if (type === 'ENUM')
    return { ...base, type, options: requireStringArray(row['options'], 'options') };
  return {
    ...base,
    type: 'TEXT_LIST',
    maxItems: requireNumber(row['maxItems'], 'maxItems'),
    itemMaxLength: requireNumber(row['itemMaxLength'], 'itemMaxLength'),
  };
}

function mapProfileRow(value: unknown): UniversalCharacterProfile {
  const row = requireRecord(value, 'Universal character row');
  const profile = mapProfile(parseJson(row['profile_json'], 'profile_json'));
  if (
    profile.id !== requireString(row['player_character_id'], 'player_character_id') ||
    profile.campaignId !== requireString(row['campaign_id'], 'campaign_id') ||
    profile.schemaVersion !== requireNumber(row['schema_version'], 'schema_version') ||
    profile.revision !== requireNumber(row['revision'], 'revision') ||
    profile.createdAt !== requireString(row['created_at'], 'created_at') ||
    profile.updatedAt !== requireString(row['updated_at'], 'updated_at')
  ) {
    throw new PersistenceDataError('Universal character columns disagree with profile JSON');
  }
  return profile;
}

function mapProfile(value: unknown): UniversalCharacterProfile {
  const row = requireRecord(value, 'Universal character profile');
  const contentBoundaries = mapContentBoundaries(row['contentBoundaries']);
  return createUniversalCharacterProfile({
    schemaVersion: requireNumber(row['schemaVersion'], 'schemaVersion') as 1,
    revision: requireNumber(row['revision'], 'revision'),
    id: playerCharacterId(requireString(row['id'], 'id')),
    campaignId: campaignId(requireString(row['campaignId'], 'campaignId')),
    name: requireString(row['name'], 'name'),
    nickname: requireNullableString(row['nickname'], 'nickname'),
    gender: requireNullableString(row['gender'], 'gender'),
    age: nullableNumber(row['age'], 'age'),
    identity: requireString(row['identity'], 'identity'),
    ancestry: requireNullableString(row['ancestry'], 'ancestry'),
    birthplace: requireNullableString(row['birthplace'], 'birthplace'),
    socialClass: requireNullableString(row['socialClass'], 'socialClass'),
    faith: requireNullableString(row['faith'], 'faith'),
    appearance: requireString(row['appearance'], 'appearance'),
    personality: requireString(row['personality'], 'personality'),
    values: requireStringArray(row['values'], 'values'),
    goals: requireStringArray(row['goals'], 'goals'),
    fears: requireStringArray(row['fears'], 'fears'),
    secrets: requireStringArray(row['secrets'], 'secrets'),
    family: requireStringArray(row['family'], 'family'),
    education: requireStringArray(row['education'], 'education'),
    importantPeople: requireStringArray(row['importantPeople'], 'importantPeople'),
    enemies: requireStringArray(row['enemies'], 'enemies'),
    experiences: requireStringArray(row['experiences'], 'experiences'),
    concept: requireString(row['concept'], 'concept'),
    storyPreferences: requireStringArray(row['storyPreferences'], 'storyPreferences'),
    contentBoundaries,
    career: mapCareer(row['career']),
    attributes: mapAttributes(row['attributes']),
    derivedAttributes: mapNamedValues(row['derivedAttributes'], 'derivedAttributes'),
    skills: requireStringArray(row['skills'], 'skills'),
    proficiencies: requireStringArray(row['proficiencies'], 'proficiencies'),
    abilities: requireStringArray(row['abilities'], 'abilities'),
    languages: requireStringArray(row['languages'], 'languages'),
    wealth: requireNumber(row['wealth'], 'wealth'),
    equipmentIds: requireStringArray(row['equipmentIds'], 'equipmentIds').map(itemId),
    reputations: mapReputations(row['reputations']),
    relationships: mapRelationships(row['relationships']),
    traits: mapTraits(row['traits']),
    statuses: requireStringArray(row['statuses'], 'statuses'),
    legacyBackground: mapBackground(row['legacyBackground']),
    extensions: mapExtensions(row['extensions']),
    createdAt: isoTimestamp(requireString(row['createdAt'], 'createdAt')),
    updatedAt: isoTimestamp(requireString(row['updatedAt'], 'updatedAt')),
  });
}

function mapContentBoundaries(value: unknown): ContentBoundaries {
  const row = requireRecord(value, 'contentBoundaries');
  return {
    allowHorror: requireBoolean(row['allowHorror'], 'allowHorror'),
    allowPermanentDeath: requireBoolean(row['allowPermanentDeath'], 'allowPermanentDeath'),
    allowRomance: requireBoolean(row['allowRomance'], 'allowRomance'),
    allowBetrayal: requireBoolean(row['allowBetrayal'], 'allowBetrayal'),
    excludedContent: requireStringArray(row['excludedContent'], 'excludedContent'),
  };
}

function mapCareer(value: unknown): UniversalCharacterCareer {
  const row = requireRecord(value, 'career');
  return {
    id: requireNullableString(row['id'], 'career.id'),
    displayName: requireString(row['displayName'], 'career.displayName'),
    legacyArchetype: requireNullableString(
      row['legacyArchetype'],
      'career.legacyArchetype',
    ) as ClassArchetype | null,
  };
}

function mapAttributes(value: unknown) {
  const row = requireRecord(value, 'attributes');
  return {
    physique: requireNumber(row['physique'], 'attributes.physique'),
    agility: requireNumber(row['agility'], 'attributes.agility'),
    knowledge: requireNumber(row['knowledge'], 'attributes.knowledge'),
    charisma: requireNumber(row['charisma'], 'attributes.charisma'),
  };
}

function mapNamedValues(value: unknown, label: string): readonly NamedCharacterValue[] {
  return requireArray(value, label).map((entry, index) => {
    const row = requireRecord(entry, `${label}[${index}]`);
    return {
      key: requireString(row['key'], `${label}[${index}].key`),
      value: requireNumber(row['value'], `${label}[${index}].value`),
    };
  });
}

function mapReputations(value: unknown): readonly CharacterReputation[] {
  return requireArray(value, 'reputations').map((entry, index) => {
    const row = requireRecord(entry, `reputations[${index}]`);
    return {
      entityId: requireString(row['entityId'], 'entityId'),
      score: requireNumber(row['score'], 'score'),
      summary: requireString(row['summary'], 'summary'),
    };
  });
}

function mapRelationships(value: unknown): readonly CharacterRelationshipSummary[] {
  return requireArray(value, 'relationships').map((entry, index) => {
    const row = requireRecord(entry, `relationships[${index}]`);
    return {
      entityId: requireString(row['entityId'], 'entityId'),
      kind: requireString(row['kind'], 'kind'),
      summary: requireString(row['summary'], 'summary'),
    };
  });
}

function mapTraits(value: unknown) {
  return requireArray(value, 'traits').map((entry, index) => {
    const row = requireRecord(entry, `traits[${index}]`);
    return {
      id: characterTraitId(requireString(row['id'], 'trait.id')),
      name: requireString(row['name'], 'trait.name'),
      description: requireString(row['description'], 'trait.description'),
      pointProfile: createTraitPointProfile(row['pointProfile']),
    };
  });
}

function mapBackground(value: unknown): CharacterBackground {
  const row = requireRecord(value, 'legacyBackground');
  return {
    birthplace: requireString(row['birthplace'], 'birthplace'),
    formativeExperience: requireString(row['formativeExperience'], 'formativeExperience'),
    adventureMotivation: requireString(row['adventureMotivation'], 'adventureMotivation'),
    secret: requireString(row['secret'], 'secret'),
    importantPerson: requireString(row['importantPerson'], 'importantPerson'),
    tavernArrivalReason: requireString(row['tavernArrivalReason'], 'tavernArrivalReason'),
  };
}

function mapExtensions(value: unknown): readonly CharacterExtensionValueSet[] {
  return requireArray(value, 'extensions').map((entry, index) => {
    const row = requireRecord(entry, `extensions[${index}]`);
    const values = requireRecord(row['values'], `extensions[${index}].values`);
    return {
      namespace: requireString(row['namespace'], 'namespace'),
      schemaVersion: requireNumber(row['schemaVersion'], 'schemaVersion') as 1,
      values: Object.freeze(
        Object.fromEntries(
          Object.entries(values).map(([key, item]) => [
            key,
            mapJson(item, `extensions[${index}].${key}`),
          ]),
        ),
      ),
    };
  });
}

function mapJson(value: unknown, label: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value))
    return Object.freeze(value.map((entry, index) => mapJson(entry, `${label}[${index}]`)));
  if (typeof value === 'object')
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, mapJson(entry, `${label}.${key}`)]),
      ),
    );
  throw new PersistenceDataError(`${label} is not JSON`);
}

function nullableNumber(value: unknown, label: string): number | null {
  return value === null ? null : requireNumber(value, label);
}

function requireExpectedRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new PersistenceDataError('Expected revision must be a non-negative safe integer');
}

function requireScopedRevision(
  current: {
    readonly campaignId: UniversalCharacterProfile['campaignId'];
    readonly revision: number;
  } | null,
  campaign: UniversalCharacterProfile['campaignId'],
  expectedRevision: number,
  label: string,
): void {
  if (current === null) {
    if (expectedRevision !== 0) throw new PersistenceDataError(`${label} revision drift`);
    return;
  }
  if (current.campaignId !== campaign) throw new PersistenceDataError(`${label} campaign mismatch`);
  if (current.revision !== expectedRevision)
    throw new PersistenceDataError(`${label} revision drift`);
}
