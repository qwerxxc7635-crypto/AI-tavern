CREATE TABLE active_factions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  constitution_revision INTEGER NOT NULL CHECK (constitution_revision >= 1),
  materialization TEXT NOT NULL CHECK (materialization IN ('OUTLINE','ACTIVE')),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  profile_json TEXT NOT NULL CHECK (
    json_valid(profile_json) AND json_type(profile_json) = 'object'
    AND length(profile_json) <= 262144
  ),
  generation_record_id TEXT REFERENCES generation_records (id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, campaign_id),
  UNIQUE (campaign_id, name),
  CHECK (
    (materialization = 'OUTLINE' AND generation_record_id IS NULL)
    OR (materialization = 'ACTIVE' AND generation_record_id IS NOT NULL)
  ),
  CHECK (json_extract(profile_json, '$.kind') = 'ACTIVE_FACTION'),
  CHECK (json_extract(profile_json, '$.schemaVersion') = schema_version),
  CHECK (json_extract(profile_json, '$.id') = id),
  CHECK (json_extract(profile_json, '$.campaignId') = campaign_id),
  CHECK (json_extract(profile_json, '$.constitutionRevision') = constitution_revision),
  CHECK (json_extract(profile_json, '$.materialization') = materialization),
  CHECK (json_extract(profile_json, '$.name') = name),
  CHECK (json_extract(profile_json, '$.generationRecordId') IS generation_record_id),
  CHECK (json_extract(profile_json, '$.revision') = revision),
  CHECK (json_extract(profile_json, '$.createdAt') = created_at),
  CHECK (json_extract(profile_json, '$.updatedAt') = updated_at)
);

CREATE INDEX idx_active_factions_campaign_materialization
  ON active_factions (campaign_id, materialization, name, id);

CREATE TABLE faction_action_events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  faction_id TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('PLAYER','WORLD_EVENT','DIRECTOR')),
  action_kind TEXT NOT NULL CHECK (action_kind IN (
    'MOBILIZE','EXPAND_TERRITORY','DIPLOMACY','SUPPORT_QUEST','UNDERMINE_QUEST','RECOVER'
  )),
  summary TEXT NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 4000),
  cost INTEGER NOT NULL CHECK (cost BETWEEN 1 AND 6),
  budget_decision_id TEXT NOT NULL UNIQUE,
  budget_json TEXT NOT NULL CHECK (json_valid(budget_json) AND json_type(budget_json) = 'object'),
  proposal_json TEXT NOT NULL CHECK (json_valid(proposal_json) AND json_type(proposal_json) = 'object'),
  affected_before_json TEXT NOT NULL CHECK (json_valid(affected_before_json) AND json_type(affected_before_json) = 'array'),
  affected_after_json TEXT NOT NULL CHECK (json_valid(affected_after_json) AND json_type(affected_after_json) = 'array'),
  before_revision INTEGER NOT NULL CHECK (before_revision >= 1),
  after_revision INTEGER NOT NULL CHECK (after_revision = before_revision + 1),
  quest_id TEXT REFERENCES quests (id) ON DELETE RESTRICT,
  quest_before_status TEXT CHECK (quest_before_status IN ('AVAILABLE','ACCEPTED','ACTIVE','COMPLETED','FAILED','ABANDONED')),
  quest_after_status TEXT CHECK (quest_after_status IN ('AVAILABLE','ACCEPTED','ACTIVE','COMPLETED','FAILED','ABANDONED')),
  world_fact_id TEXT REFERENCES world_facts (id) ON DELETE RESTRICT,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (faction_id, campaign_id)
    REFERENCES active_factions (id, campaign_id) ON DELETE RESTRICT,
  CHECK (
    (quest_id IS NULL AND quest_before_status IS NULL AND quest_after_status IS NULL)
    OR (quest_id IS NOT NULL AND quest_before_status IS NOT NULL AND quest_after_status IS NOT NULL)
  )
);

CREATE INDEX idx_faction_action_history
  ON faction_action_events (campaign_id, faction_id, occurred_at, id);

CREATE TRIGGER active_faction_validate_insert
BEFORE INSERT ON active_factions
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM world_constitutions
      WHERE campaign_id=NEW.campaign_id
        AND revision=NEW.constitution_revision
        AND status='LOCKED'
    ) THEN RAISE(ABORT, 'active faction requires the locked constitution revision')
  END;
END;

CREATE TRIGGER active_faction_identity_guard
BEFORE UPDATE ON active_factions
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.campaign_id <> OLD.campaign_id
      OR NEW.schema_version <> OLD.schema_version
      OR NEW.constitution_revision <> OLD.constitution_revision
      OR NEW.name <> OLD.name
      OR NEW.created_at <> OLD.created_at
      THEN RAISE(ABORT, 'active faction identity is immutable')
    WHEN NEW.revision <> OLD.revision + 1
      THEN RAISE(ABORT, 'active faction revision must increase by one')
    WHEN OLD.materialization='ACTIVE' AND NEW.materialization<>'ACTIVE'
      THEN RAISE(ABORT, 'active faction cannot return to outline')
  END;
END;

CREATE TRIGGER active_faction_delete_guard
BEFORE DELETE ON active_factions
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM campaigns WHERE id=OLD.campaign_id)
BEGIN
  SELECT RAISE(ABORT, 'active factions are retained as world identity');
END;

CREATE TRIGGER faction_action_event_update_guard
BEFORE UPDATE ON faction_action_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'faction action history is append-only');
END;

CREATE TRIGGER faction_action_event_delete_guard
BEFORE DELETE ON faction_action_events
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM campaigns WHERE id=OLD.campaign_id)
BEGIN
  SELECT RAISE(ABORT, 'faction action history is append-only');
END;

-- Project established WorldBible factions without inventing active resources, leadership or actions.
INSERT INTO active_factions (
  id,campaign_id,schema_version,constitution_revision,materialization,name,profile_json,
  generation_record_id,revision,created_at,updated_at
)
SELECT
  json_extract(faction.value,'$.id'),bible.campaign_id,1,constitution.revision,'OUTLINE',
  json_extract(faction.value,'$.name'),
  json_object(
    'kind','ACTIVE_FACTION','schemaVersion',1,'id',json_extract(faction.value,'$.id'),
    'campaignId',bible.campaign_id,'constitutionRevision',constitution.revision,
    'materialization','OUTLINE','name',json_extract(faction.value,'$.name'),
    'description',json_extract(faction.value,'$.description'),
    'goal',json_extract(faction.value,'$.goals[0]'),
    'resources',json_array(),'leadership',json_array(),
    'enemyFactionIds',json(COALESCE((
      SELECT json_group_array(id) FROM (
        SELECT json_extract(relation.value,'$.factionId') AS id
        FROM json_each(faction.value,'$.relations') relation
        WHERE json_extract(relation.value,'$.disposition') IN ('HOSTILE','WAR')
        ORDER BY id
      )
    ),'[]')),
    'allyFactionIds',json(COALESCE((
      SELECT json_group_array(id) FROM (
        SELECT json_extract(relation.value,'$.factionId') AS id
        FROM json_each(faction.value,'$.relations') relation
        WHERE json_extract(relation.value,'$.disposition') IN ('ALLY','FRIENDLY')
        ORDER BY id
      )
    ),'[]')),
    'territoryLocationIds',json(COALESCE((
      SELECT json_group_array(id) FROM (
        SELECT json_extract(location.value,'$.id') AS id
        FROM json_each(bible.locations_json) location,
             json_each(location.value,'$.factionIds') owner
        WHERE owner.value=json_extract(faction.value,'$.id')
        ORDER BY id
      )
    ),'[]')),
    'currentAction',NULL,'playerRelation','UNKNOWN',
    'constitutionEvidence',json_object(
      'technology',constitution.technology,'society',constitution.society,
      'politics',constitution.politics,'economy',constitution.economy
    ),
    'generationRecordId',NULL,'revision',1,
    'createdAt',bible.created_at,'updatedAt',constitution.locked_at
  ),
  NULL,1,bible.created_at,constitution.locked_at
FROM world_bibles bible
JOIN world_constitutions constitution
  ON constitution.campaign_id=bible.campaign_id AND constitution.status='LOCKED'
JOIN json_each(bible.factions_json) faction;

CREATE TRIGGER project_active_factions_on_constitution_lock
AFTER UPDATE OF status ON world_constitutions
FOR EACH ROW
WHEN OLD.status='DRAFT' AND NEW.status='LOCKED'
BEGIN
  INSERT INTO active_factions (
    id,campaign_id,schema_version,constitution_revision,materialization,name,profile_json,
    generation_record_id,revision,created_at,updated_at
  )
  SELECT
    json_extract(faction.value,'$.id'),bible.campaign_id,1,NEW.revision,'OUTLINE',
    json_extract(faction.value,'$.name'),
    json_object(
      'kind','ACTIVE_FACTION','schemaVersion',1,'id',json_extract(faction.value,'$.id'),
      'campaignId',bible.campaign_id,'constitutionRevision',NEW.revision,
      'materialization','OUTLINE','name',json_extract(faction.value,'$.name'),
      'description',json_extract(faction.value,'$.description'),
      'goal',json_extract(faction.value,'$.goals[0]'),
      'resources',json_array(),'leadership',json_array(),
      'enemyFactionIds',json_array(),'allyFactionIds',json_array(),
      'territoryLocationIds',json(COALESCE((
        SELECT json_group_array(id) FROM (
          SELECT json_extract(location.value,'$.id') AS id
          FROM json_each(bible.locations_json) location,
               json_each(location.value,'$.factionIds') owner
          WHERE owner.value=json_extract(faction.value,'$.id')
          ORDER BY id
        )
      ),'[]')),
      'currentAction',NULL,'playerRelation','UNKNOWN',
      'constitutionEvidence',json_object(
        'technology',NEW.technology,'society',NEW.society,
        'politics',NEW.politics,'economy',NEW.economy
      ),
      'generationRecordId',NULL,'revision',1,
      'createdAt',bible.created_at,'updatedAt',NEW.locked_at
    ),
    NULL,1,bible.created_at,NEW.locked_at
  FROM world_bibles bible,json_each(bible.factions_json) faction
  WHERE bible.campaign_id=NEW.campaign_id;
END;
