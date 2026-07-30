import {
  CLASS_ARCHETYPES,
  campaignId,
  characterTraitId,
  createPlayerAttributes,
  isoTimestamp,
  itemId,
  playerCharacterId,
  type CharacterBackground,
  type CharacterTrait,
  type ContentBoundaries,
  type PlayerCharacter,
} from '@ember-tavern/contracts';

import { PersistenceDataError } from './campaign-repository.js';
import {
  parseJson,
  requireArray,
  requireBoolean,
  requireEnum,
  requireNullableString,
  requireNumber,
  requireRecord,
  requireString,
  requireStringArray,
} from './persistence-validation.js';
import type { SqliteDatabase, SqliteRunResult } from './sqlite-port.js';

export class PlayerCharacterRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public create(character: PlayerCharacter): void {
    this.database.prepare(characterInsertSql).run(...characterValues(character));
  }

  public get(id: PlayerCharacter['id']): PlayerCharacter | null {
    const row = this.database.prepare('SELECT * FROM player_characters WHERE id = ?').get(id);
    return row === undefined ? null : mapCharacter(row);
  }

  public update(character: PlayerCharacter): void {
    const current = this.get(character.id);
    if (current === null) throw new PlayerCharacterNotFoundError(character.id);
    if (current.campaignId !== character.campaignId || current.createdAt !== character.createdAt) {
      throw new PersistenceDataError('Character campaignId and createdAt cannot be changed');
    }
    requireOneCharacterChange(
      this.database
        .prepare(
          `UPDATE player_characters SET
             name = ?, gender = ?, age = ?, concept = ?, story_preferences_json = ?,
             content_boundaries_json = ?, class_archetype = ?, class_display_name = ?,
             attributes_json = ?, traits_json = ?, personal_goal = ?, background_json = ?,
             initial_equipment_ids_json = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          character.name,
          character.gender,
          character.age,
          character.concept,
          JSON.stringify(character.storyPreferences),
          JSON.stringify(character.contentBoundaries),
          character.classArchetype,
          character.classDisplayName,
          JSON.stringify(character.attributes),
          JSON.stringify(character.traits),
          character.personalGoal,
          JSON.stringify(character.background),
          JSON.stringify(character.initialEquipment.map(({ itemId: id }) => id)),
          character.updatedAt,
          character.id,
        ),
      character.id,
    );
  }
}

export class PlayerCharacterNotFoundError extends Error {
  public constructor(id: string) {
    super(`PlayerCharacter not found: ${id}`);
    this.name = 'PlayerCharacterNotFoundError';
  }
}

const characterInsertSql = `INSERT INTO player_characters (
  id, campaign_id, name, gender, age, concept, story_preferences_json,
  content_boundaries_json, class_archetype, class_display_name, attributes_json,
  traits_json, personal_goal, background_json, initial_equipment_ids_json,
  created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function characterValues(character: PlayerCharacter) {
  return [
    character.id,
    character.campaignId,
    character.name,
    character.gender,
    character.age,
    character.concept,
    JSON.stringify(character.storyPreferences),
    JSON.stringify(character.contentBoundaries),
    character.classArchetype,
    character.classDisplayName,
    JSON.stringify(character.attributes),
    JSON.stringify(character.traits),
    character.personalGoal,
    JSON.stringify(character.background),
    JSON.stringify(character.initialEquipment.map(({ itemId: id }) => id)),
    character.createdAt,
    character.updatedAt,
  ] as const;
}

function mapCharacter(value: unknown): PlayerCharacter {
  try {
    const row = requireRecord(value, 'PlayerCharacter row');
    const gender = requireNullableString(row['gender'], 'gender');
    const ageValue = row['age'];
    const age = ageValue === null ? null : requireNumber(ageValue, 'age');
    if (age !== null && (!Number.isSafeInteger(age) || age < 0)) {
      throw new PersistenceDataError('age must be a non-negative safe integer');
    }
    const attributes = requireRecord(
      parseJson(row['attributes_json'], 'attributes_json'),
      'attributes',
    );
    return Object.freeze({
      id: playerCharacterId(requireString(row['id'], 'id')),
      campaignId: campaignId(requireString(row['campaign_id'], 'campaign_id')),
      name: requireString(row['name'], 'name'),
      gender,
      age,
      concept: requireString(row['concept'], 'concept'),
      storyPreferences: requireStringArray(
        parseJson(row['story_preferences_json'], 'story_preferences_json'),
        'storyPreferences',
      ),
      contentBoundaries: parseContentBoundaries(
        parseJson(row['content_boundaries_json'], 'content_boundaries_json'),
      ),
      classArchetype: requireEnum(CLASS_ARCHETYPES, row['class_archetype'], 'class_archetype'),
      classDisplayName: requireString(row['class_display_name'], 'class_display_name'),
      attributes: createPlayerAttributes({
        physique: requireNumber(attributes['physique'], 'attributes.physique'),
        agility: requireNumber(attributes['agility'], 'attributes.agility'),
        knowledge: requireNumber(attributes['knowledge'], 'attributes.knowledge'),
        charisma: requireNumber(attributes['charisma'], 'attributes.charisma'),
      }),
      traits: parseTraits(parseJson(row['traits_json'], 'traits_json')),
      personalGoal: requireString(row['personal_goal'], 'personal_goal'),
      background: parseBackground(parseJson(row['background_json'], 'background_json')),
      initialEquipment: Object.freeze(
        requireArray(
          parseJson(row['initial_equipment_ids_json'], 'initial_equipment_ids_json'),
          'initialEquipment',
        ).map((id, index) =>
          Object.freeze({
            itemId: itemId(requireString(id, `initialEquipment[${index}]`)),
          }),
        ),
      ),
      createdAt: isoTimestamp(requireString(row['created_at'], 'created_at')),
      updatedAt: isoTimestamp(requireString(row['updated_at'], 'updated_at')),
    });
  } catch (error) {
    if (error instanceof PersistenceDataError) throw error;
    throw new PersistenceDataError('Persisted PlayerCharacter row is invalid', { cause: error });
  }
}

function parseContentBoundaries(value: unknown): ContentBoundaries {
  const row = requireRecord(value, 'contentBoundaries');
  return Object.freeze({
    allowHorror: requireBoolean(row['allowHorror'], 'contentBoundaries.allowHorror'),
    allowPermanentDeath: requireBoolean(
      row['allowPermanentDeath'],
      'contentBoundaries.allowPermanentDeath',
    ),
    allowRomance: requireBoolean(row['allowRomance'], 'contentBoundaries.allowRomance'),
    allowBetrayal: requireBoolean(row['allowBetrayal'], 'contentBoundaries.allowBetrayal'),
    excludedContent: requireStringArray(
      row['excludedContent'],
      'contentBoundaries.excludedContent',
    ),
  });
}

function parseTraits(value: unknown): readonly [CharacterTrait, CharacterTrait] {
  const values = requireArray(value, 'traits');
  if (values.length !== 2) {
    throw new PersistenceDataError('traits must contain exactly two entries');
  }
  return Object.freeze([parseTrait(values[0], 0), parseTrait(values[1], 1)]);
}

function parseTrait(value: unknown, index: number): CharacterTrait {
  const row = requireRecord(value, `traits[${index}]`);
  return Object.freeze({
    id: characterTraitId(requireString(row['id'], `traits[${index}].id`)),
    name: requireString(row['name'], `traits[${index}].name`),
    description: requireString(row['description'], `traits[${index}].description`),
  });
}

function parseBackground(value: unknown): CharacterBackground {
  const row = requireRecord(value, 'background');
  return Object.freeze({
    birthplace: requireString(row['birthplace'], 'background.birthplace'),
    formativeExperience: requireString(
      row['formativeExperience'],
      'background.formativeExperience',
    ),
    adventureMotivation: requireString(
      row['adventureMotivation'],
      'background.adventureMotivation',
    ),
    secret: requireString(row['secret'], 'background.secret'),
    importantPerson: requireString(row['importantPerson'], 'background.importantPerson'),
    tavernArrivalReason: requireString(
      row['tavernArrivalReason'],
      'background.tavernArrivalReason',
    ),
  });
}

function requireOneCharacterChange(result: SqliteRunResult, id: string): void {
  if (result.changes !== 1 && result.changes !== 1n) {
    throw new PlayerCharacterNotFoundError(id);
  }
}
