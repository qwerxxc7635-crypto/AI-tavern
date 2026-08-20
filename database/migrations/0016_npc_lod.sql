CREATE TABLE npc_lod_profiles (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  constitution_revision INTEGER NOT NULL CHECK (constitution_revision >= 1),
  lod INTEGER NOT NULL CHECK (lod BETWEEN 0 AND 3),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  profile_json TEXT NOT NULL CHECK (
    json_valid(profile_json)
    AND json_type(profile_json) = 'object'
    AND length(profile_json) <= 262144
  ),
  generation_record_id TEXT REFERENCES generation_records (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (json_extract(profile_json, '$.kind') = 'NPC_LOD_PROFILE'),
  CHECK (json_extract(profile_json, '$.schemaVersion') = schema_version),
  CHECK (json_extract(profile_json, '$.id') = id),
  CHECK (json_extract(profile_json, '$.campaignId') = campaign_id),
  CHECK (json_extract(profile_json, '$.constitutionRevision') = constitution_revision),
  CHECK (json_extract(profile_json, '$.lod') = lod),
  CHECK (json_extract(profile_json, '$.revision') = revision),
  CHECK (json_extract(profile_json, '$.generationRecordId') IS generation_record_id),
  CHECK (json_extract(profile_json, '$.createdAt') = created_at),
  CHECK (json_extract(profile_json, '$.updatedAt') = updated_at)
);

CREATE INDEX idx_npc_lod_campaign_level
  ON npc_lod_profiles (campaign_id, lod, updated_at, id);

CREATE TABLE npc_lod_transitions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  npc_id TEXT NOT NULL REFERENCES npc_lod_profiles (id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  from_lod INTEGER NOT NULL CHECK (from_lod BETWEEN 0 AND 2),
  to_lod INTEGER NOT NULL CHECK (to_lod = from_lod + 1),
  trigger TEXT NOT NULL CHECK (trigger IN ('OBSERVED', 'INTERACTED', 'RECURRING')),
  before_revision INTEGER NOT NULL CHECK (before_revision >= 1),
  after_revision INTEGER NOT NULL CHECK (after_revision = before_revision + 1),
  before_profile_json TEXT NOT NULL CHECK (
    json_valid(before_profile_json) AND json_type(before_profile_json) = 'object'
  ),
  after_profile_json TEXT NOT NULL CHECK (
    json_valid(after_profile_json) AND json_type(after_profile_json) = 'object'
  ),
  generation_record_id TEXT NOT NULL UNIQUE
    REFERENCES generation_records (id) ON DELETE RESTRICT,
  occurred_at TEXT NOT NULL,
  CHECK (json_extract(before_profile_json, '$.id') = npc_id),
  CHECK (json_extract(after_profile_json, '$.id') = npc_id),
  CHECK (json_extract(before_profile_json, '$.lod') = from_lod),
  CHECK (json_extract(after_profile_json, '$.lod') = to_lod),
  CHECK (json_extract(before_profile_json, '$.revision') = before_revision),
  CHECK (json_extract(after_profile_json, '$.revision') = after_revision)
);

CREATE INDEX idx_npc_lod_transition_history
  ON npc_lod_transitions (campaign_id, npc_id, occurred_at, id);

CREATE TRIGGER npc_lod_validate_insert
BEFORE INSERT ON npc_lod_profiles
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM world_constitutions
      WHERE campaign_id = NEW.campaign_id
        AND revision = NEW.constitution_revision
        AND status = 'LOCKED'
    ) THEN RAISE(ABORT, 'NPC LOD requires the locked constitution revision')
  END;
END;

CREATE TRIGGER npc_lod_validate_update
BEFORE UPDATE ON npc_lod_profiles
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.campaign_id <> OLD.campaign_id
      OR NEW.schema_version <> OLD.schema_version
      OR NEW.constitution_revision <> OLD.constitution_revision
      OR NEW.created_at <> OLD.created_at
      OR json_extract(NEW.profile_json, '$.identityAnchor')
        <> json_extract(OLD.profile_json, '$.identityAnchor')
      OR json_extract(NEW.profile_json, '$.populationRole')
        <> json_extract(OLD.profile_json, '$.populationRole')
      THEN RAISE(ABORT, 'NPC LOD identity is immutable')
    WHEN NEW.lod <> OLD.lod + 1
      OR NEW.revision <> OLD.revision + 1
      THEN RAISE(ABORT, 'NPC LOD must upgrade one level and one revision')
    WHEN NEW.generation_record_id IS NULL
      THEN RAISE(ABORT, 'NPC LOD upgrade requires generation provenance')
  END;
END;

CREATE TRIGGER npc_lod_delete_guard
BEFORE DELETE ON npc_lod_profiles
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM campaigns WHERE id = OLD.campaign_id)
BEGIN
  SELECT RAISE(ABORT, 'NPC LOD profiles are retained as world identity');
END;

INSERT INTO npc_lod_profiles (
  id, campaign_id, schema_version, constitution_revision, lod, revision,
  profile_json, generation_record_id, created_at, updated_at
)
SELECT
  n.id,
  n.campaign_id,
  1,
  c.revision,
  3,
  1,
  json_object(
    'kind', 'NPC_LOD_PROFILE',
    'schemaVersion', 1,
    'id', n.id,
    'campaignId', n.campaign_id,
    'constitutionRevision', c.revision,
    'lod', 3,
    'revision', 1,
    'identityAnchor', 'legacy:' || n.id,
    'populationRole', n.identity,
    'name', n.name,
    'appearance', n.appearance,
    'currentBehavior', n.current_mood,
    'career', n.identity,
    'personality', n.personality,
    'goals', json_array(n.goal),
    'knowledgeFactIds', json(COALESCE((
      SELECT json_group_array(ak.truth_id)
      FROM actor_knowledge ak
      WHERE ak.campaign_id = n.campaign_id
        AND ak.actor_type = 'NPC'
        AND ak.actor_id = n.id
        AND ak.target_kind = 'TRUTH'
        AND ak.knowledge_state = 'KNOWN'
        AND ak.knowledge_state = 'KNOWN'
    ), '[]')),
    'relationshipNpcIds', json_array(),
    'memoryIds', json(COALESCE((
      SELECT json_group_array(km.id)
      FROM knowledge_memories km
      WHERE km.campaign_id = n.campaign_id
        AND km.actor_type = 'NPC'
        AND km.actor_id = n.id
    ), '[]')),
    'secretFactIds', json(COALESCE((
      SELECT json_group_array(ak.truth_id)
      FROM actor_knowledge ak
      JOIN world_truths wt ON wt.id = ak.truth_id
      WHERE ak.campaign_id = n.campaign_id
        AND ak.actor_type = 'NPC'
        AND ak.actor_id = n.id
        AND ak.target_kind = 'TRUTH'
        AND ak.knowledge_state = 'KNOWN'
        AND wt.visibility = 'SECRET'
    ), '[]')),
    'questIds', json(COALESCE((
      SELECT json_group_array(q.id)
      FROM quests q
      WHERE q.campaign_id = n.campaign_id
        AND (q.publisher_npc_id = n.id OR EXISTS (
          SELECT 1 FROM json_each(q.related_npc_ids_json) WHERE value = n.id
        ))
    ), '[]')),
    'itemIds', json_array(),
    'experienceEventIds', json_array(),
    'constitutionEvidence', json_object(
      'npcRules', c.npc_rules,
      'society', c.society,
      'technology', c.technology
    ),
    'generationRecordId', NULL,
    'createdAt', n.created_at,
    'updatedAt', n.updated_at
  ),
  NULL,
  n.created_at,
  n.updated_at
FROM npcs n
JOIN world_constitutions c
  ON c.campaign_id = n.campaign_id AND c.status = 'LOCKED';

-- Established tavern flows create fully detailed NPCs. Project those atomically as
-- LOD3 without replacing or weakening the existing NPC contract.
CREATE TRIGGER npc_lod_project_detailed_npc
AFTER INSERT ON npcs
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM world_constitutions
  WHERE campaign_id = NEW.campaign_id AND status = 'LOCKED'
)
AND NOT EXISTS (SELECT 1 FROM npc_lod_profiles WHERE id = NEW.id)
BEGIN
  INSERT INTO npc_lod_profiles (
    id, campaign_id, schema_version, constitution_revision, lod, revision,
    profile_json, generation_record_id, created_at, updated_at
  )
  SELECT
    NEW.id, NEW.campaign_id, 1, c.revision, 3, 1,
    json_object(
      'kind', 'NPC_LOD_PROFILE',
      'schemaVersion', 1,
      'id', NEW.id,
      'campaignId', NEW.campaign_id,
      'constitutionRevision', c.revision,
      'lod', 3,
      'revision', 1,
      'identityAnchor', 'legacy:' || NEW.id,
      'populationRole', NEW.identity,
      'name', NEW.name,
      'appearance', NEW.appearance,
      'currentBehavior', NEW.current_mood,
      'career', NEW.identity,
      'personality', NEW.personality,
      'goals', json_array(NEW.goal),
      'knowledgeFactIds', json_array(),
      'relationshipNpcIds', json_array(),
      'memoryIds', json_array(),
      'secretFactIds', json_array(),
      'questIds', json_array(),
      'itemIds', json_array(),
      'experienceEventIds', json_array(),
      'constitutionEvidence', json_object(
        'npcRules', c.npc_rules,
        'society', c.society,
        'technology', c.technology
      ),
      'generationRecordId', NULL,
      'createdAt', NEW.created_at,
      'updatedAt', NEW.updated_at
    ),
    NULL, NEW.created_at, NEW.updated_at
  FROM world_constitutions c
  WHERE c.campaign_id = NEW.campaign_id AND c.status = 'LOCKED';
END;

DROP TRIGGER actor_knowledge_validate_insert;
CREATE TRIGGER actor_knowledge_validate_insert
BEFORE INSERT ON actor_knowledge
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.actor_type = 'NPC' AND NOT EXISTS (
      SELECT 1 FROM npcs WHERE id = NEW.actor_id AND campaign_id = NEW.campaign_id
      UNION ALL
      SELECT 1 FROM npc_lod_profiles
      WHERE id = NEW.actor_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'knowledge actor is not an NPC in this campaign')
    WHEN NEW.actor_type = 'PLAYER_CHARACTER' AND NOT EXISTS (
      SELECT 1 FROM player_characters WHERE id = NEW.actor_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'knowledge actor is not a player character in this campaign')
    WHEN NEW.target_kind = 'TRUTH' AND NOT EXISTS (
      SELECT 1 FROM world_truths WHERE id = NEW.truth_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'knowledge truth is not in this campaign')
    WHEN NEW.target_kind = 'CLAIM' AND NOT EXISTS (
      SELECT 1 FROM knowledge_claims WHERE id = NEW.claim_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'knowledge claim is not in this campaign')
    WHEN NEW.provenance_event_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM game_events
      WHERE id = NEW.provenance_event_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'knowledge provenance event is not in this campaign')
  END;
END;

DROP TRIGGER knowledge_memory_validate_actor;
CREATE TRIGGER knowledge_memory_validate_actor
BEFORE INSERT ON knowledge_memories
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.actor_type = 'NPC' AND NOT EXISTS (
      SELECT 1 FROM npcs WHERE id = NEW.actor_id AND campaign_id = NEW.campaign_id
      UNION ALL
      SELECT 1 FROM npc_lod_profiles
      WHERE id = NEW.actor_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'memory actor is not an NPC in this campaign')
    WHEN NEW.actor_type = 'PLAYER_CHARACTER' AND NOT EXISTS (
      SELECT 1 FROM player_characters WHERE id = NEW.actor_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'memory actor is not a player character in this campaign')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.source_knowledge_ids_json) AS source
      WHERE NOT EXISTS (
        SELECT 1 FROM actor_knowledge AS knowledge
        WHERE knowledge.id = source.value
          AND knowledge.campaign_id = NEW.campaign_id
          AND knowledge.actor_type = NEW.actor_type
          AND knowledge.actor_id = NEW.actor_id
      )
    ) THEN RAISE(ABORT, 'memory source knowledge belongs to another actor')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.source_event_ids_json) AS source
      WHERE NOT EXISTS (
        SELECT 1 FROM game_events
        WHERE id = source.value AND campaign_id = NEW.campaign_id
      )
    ) THEN RAISE(ABORT, 'memory source event is not in this campaign')
  END;
END;

DROP TRIGGER knowledge_claim_validate_source_insert;
CREATE TRIGGER knowledge_claim_validate_source_insert
BEFORE INSERT ON knowledge_claims
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.source_kind = 'TRUTH' AND NOT EXISTS (
      SELECT 1 FROM world_truths
      WHERE id = NEW.source_truth_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'claim source truth is not in this campaign')
    WHEN NEW.source_kind = 'EVENT' AND NOT EXISTS (
      SELECT 1 FROM game_events
      WHERE id = NEW.source_event_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'claim source event is not in this campaign')
    WHEN NEW.source_kind = 'ACTOR' AND NEW.source_actor_type = 'NPC' AND NOT EXISTS (
      SELECT 1 FROM npcs WHERE id = NEW.source_actor_id AND campaign_id = NEW.campaign_id
      UNION ALL
      SELECT 1 FROM npc_lod_profiles
      WHERE id = NEW.source_actor_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'claim source NPC is not in this campaign')
    WHEN NEW.source_kind = 'ACTOR' AND NEW.source_actor_type = 'PLAYER_CHARACTER'
      AND NOT EXISTS (
        SELECT 1 FROM player_characters
        WHERE id = NEW.source_actor_id AND campaign_id = NEW.campaign_id
      ) THEN RAISE(ABORT, 'claim source player is not in this campaign')
  END;
END;

DROP TRIGGER knowledge_claim_validate_source_update;
CREATE TRIGGER knowledge_claim_validate_source_update
BEFORE UPDATE ON knowledge_claims
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.source_kind = 'TRUTH' AND NOT EXISTS (
      SELECT 1 FROM world_truths
      WHERE id = NEW.source_truth_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'claim source truth is not in this campaign')
    WHEN NEW.source_kind = 'EVENT' AND NOT EXISTS (
      SELECT 1 FROM game_events
      WHERE id = NEW.source_event_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'claim source event is not in this campaign')
    WHEN NEW.source_kind = 'ACTOR' AND NEW.source_actor_type = 'NPC' AND NOT EXISTS (
      SELECT 1 FROM npcs WHERE id = NEW.source_actor_id AND campaign_id = NEW.campaign_id
      UNION ALL
      SELECT 1 FROM npc_lod_profiles
      WHERE id = NEW.source_actor_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'claim source NPC is not in this campaign')
    WHEN NEW.source_kind = 'ACTOR' AND NEW.source_actor_type = 'PLAYER_CHARACTER'
      AND NOT EXISTS (
        SELECT 1 FROM player_characters
        WHERE id = NEW.source_actor_id AND campaign_id = NEW.campaign_id
      ) THEN RAISE(ABORT, 'claim source player is not in this campaign')
  END;
END;
