CREATE TABLE character_extension_definitions (
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  namespace TEXT NOT NULL CHECK (
    length(namespace) BETWEEN 1 AND 64
    AND namespace = lower(namespace)
    AND namespace NOT GLOB '*[^a-z0-9.-]*'
  ),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  constitution_revision INTEGER NOT NULL CHECK (constitution_revision >= 1),
  definition_json TEXT NOT NULL CHECK (
    json_valid(definition_json)
    AND json_type(definition_json) = 'object'
    AND length(definition_json) <= 65536
  ),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, namespace),
  CHECK (json_extract(definition_json, '$.kind') = 'WORLD_CHARACTER_EXTENSION_DEFINITION'),
  CHECK (json_extract(definition_json, '$.schemaVersion') = schema_version),
  CHECK (json_extract(definition_json, '$.campaignId') = campaign_id),
  CHECK (json_extract(definition_json, '$.namespace') = namespace),
  CHECK (json_extract(definition_json, '$.constitutionRevision') = constitution_revision),
  CHECK (json_extract(definition_json, '$.revision') = revision)
);

CREATE INDEX idx_character_extension_definitions_constitution
  ON character_extension_definitions (campaign_id, constitution_revision, namespace);

CREATE TRIGGER character_extension_definition_validate_insert
BEFORE INSERT ON character_extension_definitions
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM world_constitutions
  WHERE campaign_id = NEW.campaign_id
    AND revision = NEW.constitution_revision
    AND status = 'LOCKED'
)
BEGIN
  SELECT RAISE(ABORT, 'character extension requires the locked world constitution revision');
END;

CREATE TRIGGER character_extension_definition_validate_update
BEFORE UPDATE ON character_extension_definitions
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.campaign_id <> OLD.campaign_id OR NEW.namespace <> OLD.namespace
      THEN RAISE(ABORT, 'character extension identity is immutable')
    WHEN NEW.revision <> OLD.revision + 1
      THEN RAISE(ABORT, 'character extension revision must advance by one')
    WHEN NOT EXISTS (
      SELECT 1 FROM world_constitutions
      WHERE campaign_id = NEW.campaign_id
        AND revision = NEW.constitution_revision
        AND status = 'LOCKED'
    ) THEN RAISE(ABORT, 'character extension requires the locked world constitution revision')
  END;
END;

CREATE TABLE universal_character_profiles (
  player_character_id TEXT PRIMARY KEY
    REFERENCES player_characters (id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL UNIQUE
    REFERENCES campaigns (id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  profile_json TEXT NOT NULL CHECK (
    json_valid(profile_json)
    AND json_type(profile_json) = 'object'
    AND length(profile_json) <= 262144
  ),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (json_extract(profile_json, '$.kind') = 'UNIVERSAL_CHARACTER_PROFILE'),
  CHECK (json_extract(profile_json, '$.schemaVersion') = schema_version),
  CHECK (json_extract(profile_json, '$.id') = player_character_id),
  CHECK (json_extract(profile_json, '$.campaignId') = campaign_id),
  CHECK (json_extract(profile_json, '$.revision') = revision),
  CHECK (json_extract(profile_json, '$.createdAt') = created_at),
  CHECK (json_extract(profile_json, '$.updatedAt') = updated_at),
  CHECK (json_type(profile_json, '$.extensions') = 'array')
);

CREATE INDEX idx_universal_character_profiles_campaign
  ON universal_character_profiles (campaign_id, player_character_id);

INSERT INTO universal_character_profiles (
  player_character_id, campaign_id, schema_version, profile_json,
  revision, created_at, updated_at
)
SELECT
  character.id,
  character.campaign_id,
  1,
  json_object(
    'kind', 'UNIVERSAL_CHARACTER_PROFILE',
    'schemaVersion', 1,
    'revision', 1,
    'id', character.id,
    'campaignId', character.campaign_id,
    'name', character.name,
    'nickname', NULL,
    'gender', character.gender,
    'age', character.age,
    'identity', character.concept,
    'ancestry', NULL,
    'birthplace', json_extract(character.background_json, '$.birthplace'),
    'socialClass', NULL,
    'faith', NULL,
    'appearance', '',
    'personality', '',
    'values', json('[]'),
    'goals', json_array(character.personal_goal),
    'fears', json('[]'),
    'secrets', CASE
      WHEN COALESCE(json_extract(character.background_json, '$.secret'), '') = '' THEN json('[]')
      ELSE json_array(json_extract(character.background_json, '$.secret')) END,
    'family', json('[]'),
    'education', json('[]'),
    'importantPeople', CASE
      WHEN COALESCE(json_extract(character.background_json, '$.importantPerson'), '') = '' THEN json('[]')
      ELSE json_array(json_extract(character.background_json, '$.importantPerson')) END,
    'enemies', json('[]'),
    'experiences', CASE
      WHEN COALESCE(json_extract(character.background_json, '$.formativeExperience'), '') = '' THEN json('[]')
      ELSE json_array(json_extract(character.background_json, '$.formativeExperience')) END,
    'concept', character.concept,
    'storyPreferences', json(character.story_preferences_json),
    'contentBoundaries', json(character.content_boundaries_json),
    'career', json_object(
      'id', NULL,
      'displayName', character.class_display_name,
      'legacyArchetype', character.class_archetype
    ),
    'attributes', json(character.attributes_json),
    'derivedAttributes', json('[]'),
    'skills', COALESCE(
      (SELECT json_group_array(json_extract(skill.value, '$.name'))
       FROM json_each(rule_state.skills_json) AS skill),
      json('[]')
    ),
    'proficiencies', json('[]'),
    'abilities', json('[]'),
    'languages', json('[]'),
    'wealth', COALESCE(rule_state.money, 0),
    'equipmentIds', json(character.initial_equipment_ids_json),
    'reputations', json('[]'),
    'relationships', json('[]'),
    'traits', json(character.traits_json),
    'statuses', COALESCE(
      (SELECT json_group_array(json_extract(status.value, '$.kind'))
       FROM json_each(rule_state.statuses_json) AS status),
      json('[]')
    ),
    'legacyBackground', json(character.background_json),
    'extensions', json('[]'),
    'createdAt', character.created_at,
    'updatedAt', character.updated_at
  ),
  1,
  character.created_at,
  character.updated_at
FROM player_characters AS character
LEFT JOIN character_rule_states AS rule_state
  ON rule_state.player_character_id = character.id;

CREATE TRIGGER universal_character_after_legacy_insert
AFTER INSERT ON player_characters
FOR EACH ROW
BEGIN
  INSERT INTO universal_character_profiles (
    player_character_id, campaign_id, schema_version, profile_json,
    revision, created_at, updated_at
  ) VALUES (
    NEW.id,
    NEW.campaign_id,
    1,
    json_object(
      'kind', 'UNIVERSAL_CHARACTER_PROFILE',
      'schemaVersion', 1,
      'revision', 1,
      'id', NEW.id,
      'campaignId', NEW.campaign_id,
      'name', NEW.name,
      'nickname', NULL,
      'gender', NEW.gender,
      'age', NEW.age,
      'identity', NEW.concept,
      'ancestry', NULL,
      'birthplace', json_extract(NEW.background_json, '$.birthplace'),
      'socialClass', NULL,
      'faith', NULL,
      'appearance', '',
      'personality', '',
      'values', json('[]'),
      'goals', json_array(NEW.personal_goal),
      'fears', json('[]'),
      'secrets', CASE
        WHEN COALESCE(json_extract(NEW.background_json, '$.secret'), '') = '' THEN json('[]')
        ELSE json_array(json_extract(NEW.background_json, '$.secret')) END,
      'family', json('[]'),
      'education', json('[]'),
      'importantPeople', CASE
        WHEN COALESCE(json_extract(NEW.background_json, '$.importantPerson'), '') = '' THEN json('[]')
        ELSE json_array(json_extract(NEW.background_json, '$.importantPerson')) END,
      'enemies', json('[]'),
      'experiences', CASE
        WHEN COALESCE(json_extract(NEW.background_json, '$.formativeExperience'), '') = '' THEN json('[]')
        ELSE json_array(json_extract(NEW.background_json, '$.formativeExperience')) END,
      'concept', NEW.concept,
      'storyPreferences', json(NEW.story_preferences_json),
      'contentBoundaries', json(NEW.content_boundaries_json),
      'career', json_object(
        'id', NULL,
        'displayName', NEW.class_display_name,
        'legacyArchetype', NEW.class_archetype
      ),
      'attributes', json(NEW.attributes_json),
      'derivedAttributes', json('[]'),
      'skills', json('[]'),
      'proficiencies', json('[]'),
      'abilities', json('[]'),
      'languages', json('[]'),
      'wealth', 0,
      'equipmentIds', json(NEW.initial_equipment_ids_json),
      'reputations', json('[]'),
      'relationships', json('[]'),
      'traits', json(NEW.traits_json),
      'statuses', json('[]'),
      'legacyBackground', json(NEW.background_json),
      'extensions', json('[]'),
      'createdAt', NEW.created_at,
      'updatedAt', NEW.updated_at
    ),
    1,
    NEW.created_at,
    NEW.updated_at
  );
END;

CREATE TRIGGER universal_character_profile_validate_update
BEFORE UPDATE ON universal_character_profiles
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.player_character_id <> OLD.player_character_id
      OR NEW.campaign_id <> OLD.campaign_id
      OR NEW.schema_version <> OLD.schema_version
      OR NEW.created_at <> OLD.created_at
      THEN RAISE(ABORT, 'universal character identity is immutable')
    WHEN NEW.revision <> OLD.revision + 1
      THEN RAISE(ABORT, 'universal character revision must advance by one')
  END;
END;

CREATE TRIGGER universal_character_sync_legacy_update
AFTER UPDATE OF
  name, gender, age, concept, story_preferences_json, content_boundaries_json,
  class_archetype, class_display_name, traits_json, personal_goal,
  background_json, initial_equipment_ids_json, updated_at
ON player_characters
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM universal_character_profiles
  WHERE player_character_id = NEW.id
    AND (
      json_extract(profile_json, '$.name') IS NOT NEW.name
      OR json_extract(profile_json, '$.gender') IS NOT NEW.gender
      OR json_extract(profile_json, '$.age') IS NOT NEW.age
      OR json_extract(profile_json, '$.concept') IS NOT NEW.concept
      OR json_extract(profile_json, '$.storyPreferences') IS NOT json(NEW.story_preferences_json)
      OR json_extract(profile_json, '$.contentBoundaries') IS NOT json(NEW.content_boundaries_json)
      OR json_extract(profile_json, '$.career.legacyArchetype') IS NOT NEW.class_archetype
      OR json_extract(profile_json, '$.career.displayName') IS NOT NEW.class_display_name
      OR json_extract(profile_json, '$.traits') IS NOT json(NEW.traits_json)
      OR json_extract(profile_json, '$.goals[0]') IS NOT NEW.personal_goal
      OR json_extract(profile_json, '$.legacyBackground') IS NOT json(NEW.background_json)
      OR json_extract(profile_json, '$.equipmentIds') IS NOT json(NEW.initial_equipment_ids_json)
      OR json_extract(profile_json, '$.updatedAt') IS NOT NEW.updated_at
    )
)
BEGIN
  UPDATE universal_character_profiles
  SET
    profile_json = json_set(
      profile_json,
      '$.revision', revision + 1,
      '$.name', NEW.name,
      '$.gender', NEW.gender,
      '$.age', NEW.age,
      '$.birthplace', json_extract(NEW.background_json, '$.birthplace'),
      '$.goals', json_array(NEW.personal_goal),
      '$.concept', NEW.concept,
      '$.storyPreferences', json(NEW.story_preferences_json),
      '$.contentBoundaries', json(NEW.content_boundaries_json),
      '$.career.displayName', NEW.class_display_name,
      '$.career.legacyArchetype', NEW.class_archetype,
      '$.equipmentIds', json(NEW.initial_equipment_ids_json),
      '$.traits', json(NEW.traits_json),
      '$.legacyBackground', json(NEW.background_json),
      '$.updatedAt', NEW.updated_at
    ),
    revision = revision + 1,
    updated_at = NEW.updated_at
  WHERE player_character_id = NEW.id;
END;

CREATE TRIGGER universal_character_sync_profile_update
AFTER UPDATE OF profile_json, revision, updated_at
ON universal_character_profiles
FOR EACH ROW
WHEN json_array_length(json_extract(NEW.profile_json, '$.traits')) = 2
  AND json_extract(NEW.profile_json, '$.career.legacyArchetype')
    IN ('WARRIOR', 'ROGUE', 'SCHOLAR', 'DIPLOMAT')
BEGIN
  UPDATE player_characters
  SET
    name = json_extract(NEW.profile_json, '$.name'),
    gender = json_extract(NEW.profile_json, '$.gender'),
    age = json_extract(NEW.profile_json, '$.age'),
    concept = json_extract(NEW.profile_json, '$.concept'),
    story_preferences_json = json_extract(NEW.profile_json, '$.storyPreferences'),
    content_boundaries_json = json_extract(NEW.profile_json, '$.contentBoundaries'),
    class_archetype = json_extract(NEW.profile_json, '$.career.legacyArchetype'),
    class_display_name = json_extract(NEW.profile_json, '$.career.displayName'),
    attributes_json = json_extract(NEW.profile_json, '$.attributes'),
    traits_json = json_extract(NEW.profile_json, '$.traits'),
    personal_goal = COALESCE(
      json_extract(NEW.profile_json, '$.goals[0]'),
      json_extract(NEW.profile_json, '$.concept')
    ),
    background_json = json_extract(NEW.profile_json, '$.legacyBackground'),
    initial_equipment_ids_json = json_extract(NEW.profile_json, '$.equipmentIds'),
    updated_at = NEW.updated_at
  WHERE id = NEW.player_character_id;
END;

CREATE TRIGGER universal_character_sync_rule_state_update
AFTER UPDATE OF skills_json, money, statuses_json, updated_at
ON character_rule_states
FOR EACH ROW
BEGIN
  UPDATE universal_character_profiles
  SET
    profile_json = json_set(
      profile_json,
      '$.revision', revision + 1,
      '$.skills', json(COALESCE(
        (SELECT json_group_array(json_extract(skill.value, '$.name'))
         FROM json_each(NEW.skills_json) AS skill),
        '[]'
      )),
      '$.wealth', NEW.money,
      '$.statuses', json(COALESCE(
        (SELECT json_group_array(json_extract(status.value, '$.kind'))
         FROM json_each(NEW.statuses_json) AS status),
        '[]'
      )),
      '$.updatedAt', NEW.updated_at
    ),
    revision = revision + 1,
    updated_at = NEW.updated_at
  WHERE player_character_id = NEW.player_character_id;
END;
