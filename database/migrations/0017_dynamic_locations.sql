CREATE TABLE dynamic_locations (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  constitution_revision INTEGER NOT NULL CHECK (constitution_revision >= 1),
  location_kind TEXT NOT NULL CHECK (location_kind IN (
    'REGION','COUNTRY','CITY','VILLAGE','DISTRICT','TAVERN','SHOP','RUIN','DUNGEON','SPECIAL'
  )),
  materialization TEXT NOT NULL CHECK (materialization IN ('OUTLINE','DETAILED')),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  parent_location_id TEXT,
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
  FOREIGN KEY (parent_location_id, campaign_id)
    REFERENCES dynamic_locations (id, campaign_id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (parent_location_id IS NULL OR parent_location_id <> id),
  CHECK (json_extract(profile_json, '$.kind') = 'DYNAMIC_LOCATION'),
  CHECK (json_extract(profile_json, '$.schemaVersion') = schema_version),
  CHECK (json_extract(profile_json, '$.id') = id),
  CHECK (json_extract(profile_json, '$.campaignId') = campaign_id),
  CHECK (json_extract(profile_json, '$.constitutionRevision') = constitution_revision),
  CHECK (json_extract(profile_json, '$.locationKind') = location_kind),
  CHECK (json_extract(profile_json, '$.materialization') = materialization),
  CHECK (json_extract(profile_json, '$.name') = name),
  CHECK (json_extract(profile_json, '$.parentLocationId') IS parent_location_id),
  CHECK (json_extract(profile_json, '$.generationRecordId') IS generation_record_id),
  CHECK (json_extract(profile_json, '$.revision') = revision),
  CHECK (json_extract(profile_json, '$.createdAt') = created_at),
  CHECK (json_extract(profile_json, '$.updatedAt') = updated_at)
);

CREATE INDEX idx_dynamic_locations_campaign_parent
  ON dynamic_locations (campaign_id, parent_location_id, name, id);
CREATE INDEX idx_dynamic_locations_campaign_kind
  ON dynamic_locations (campaign_id, location_kind, materialization, id);

CREATE TABLE location_connections (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  first_location_id TEXT NOT NULL,
  second_location_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('INITIAL_HIERARCHY','GENERATED')),
  generation_record_id TEXT REFERENCES generation_records (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (first_location_id, campaign_id)
    REFERENCES dynamic_locations (id, campaign_id) ON DELETE CASCADE,
  FOREIGN KEY (second_location_id, campaign_id)
    REFERENCES dynamic_locations (id, campaign_id) ON DELETE CASCADE,
  CHECK (first_location_id < second_location_id),
  CHECK (
    (source = 'INITIAL_HIERARCHY' AND generation_record_id IS NULL)
    OR (source = 'GENERATED' AND generation_record_id IS NOT NULL)
  ),
  UNIQUE (campaign_id, first_location_id, second_location_id)
);

CREATE INDEX idx_location_connections_first
  ON location_connections (campaign_id, first_location_id, second_location_id);
CREATE INDEX idx_location_connections_second
  ON location_connections (campaign_id, second_location_id, first_location_id);

CREATE TABLE campaign_location_states (
  campaign_id TEXT PRIMARY KEY REFERENCES campaigns (id) ON DELETE CASCADE,
  current_location_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (current_location_id, campaign_id)
    REFERENCES dynamic_locations (id, campaign_id) ON DELETE RESTRICT
);

CREATE TABLE location_travel_events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL UNIQUE,
  from_location_id TEXT NOT NULL,
  to_location_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('FOOT','ROAD','WATER','MOUNT','SPECIAL')),
  before_revision INTEGER NOT NULL CHECK (before_revision >= 1),
  after_revision INTEGER NOT NULL CHECK (after_revision = before_revision + 1),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (from_location_id, campaign_id)
    REFERENCES dynamic_locations (id, campaign_id) ON DELETE RESTRICT,
  FOREIGN KEY (to_location_id, campaign_id)
    REFERENCES dynamic_locations (id, campaign_id) ON DELETE RESTRICT,
  CHECK (from_location_id <> to_location_id)
);

CREATE INDEX idx_location_travel_history
  ON location_travel_events (campaign_id, occurred_at, id);

CREATE TRIGGER dynamic_location_validate_insert
BEFORE INSERT ON dynamic_locations
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM world_constitutions
      WHERE campaign_id = NEW.campaign_id
        AND revision = NEW.constitution_revision
        AND status = 'LOCKED'
    ) THEN RAISE(ABORT, 'dynamic location requires the locked constitution revision')
  END;
END;

CREATE TRIGGER dynamic_location_cycle_guard
AFTER INSERT ON dynamic_locations
FOR EACH ROW
WHEN NEW.parent_location_id IS NOT NULL
BEGIN
  WITH RECURSIVE ancestors(id, depth) AS (
    SELECT NEW.parent_location_id, 1
    UNION ALL
    SELECT parent.parent_location_id, ancestors.depth + 1
    FROM dynamic_locations parent
    JOIN ancestors ON parent.id = ancestors.id
    WHERE parent.parent_location_id IS NOT NULL AND ancestors.depth <= 8
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id)
      THEN RAISE(ABORT, 'dynamic location hierarchy contains a cycle')
    WHEN EXISTS (SELECT 1 FROM ancestors WHERE depth > 8)
      THEN RAISE(ABORT, 'dynamic location hierarchy exceeds maximum depth')
  END;
END;

CREATE TRIGGER dynamic_location_identity_guard
BEFORE UPDATE ON dynamic_locations
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.campaign_id <> OLD.campaign_id
      OR NEW.schema_version <> OLD.schema_version
      OR NEW.constitution_revision <> OLD.constitution_revision
      OR NEW.location_kind <> OLD.location_kind
      OR NEW.name <> OLD.name
      OR NEW.parent_location_id IS NOT OLD.parent_location_id
      OR NEW.created_at <> OLD.created_at
      THEN RAISE(ABORT, 'dynamic location identity is immutable')
    WHEN NEW.revision <> OLD.revision + 1
      THEN RAISE(ABORT, 'dynamic location revision must increase by one')
  END;
END;

CREATE TRIGGER dynamic_location_delete_guard
BEFORE DELETE ON dynamic_locations
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM campaigns WHERE id = OLD.campaign_id)
BEGIN
  SELECT RAISE(ABORT, 'dynamic locations are retained as world facts');
END;

CREATE TRIGGER campaign_location_state_guard
BEFORE UPDATE ON campaign_location_states
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.campaign_id <> OLD.campaign_id
      OR NEW.revision <> OLD.revision + 1
      THEN RAISE(ABORT, 'campaign location state revision is invalid')
  END;
END;

-- Backfill already locked worlds as OUTLINE nodes. No additional map content is invented.
INSERT INTO dynamic_locations (
  id,campaign_id,schema_version,constitution_revision,location_kind,materialization,
  name,parent_location_id,profile_json,generation_record_id,revision,created_at,updated_at
)
SELECT
  json_extract(location.value,'$.id'),bible.campaign_id,1,constitution.revision,
  CASE WHEN json_extract(location.value,'$.parentLocationId') IS NULL THEN 'REGION' ELSE 'SPECIAL' END,
  'OUTLINE',json_extract(location.value,'$.name'),json_extract(location.value,'$.parentLocationId'),
  json_object(
    'kind','DYNAMIC_LOCATION','schemaVersion',1,'id',json_extract(location.value,'$.id'),
    'campaignId',bible.campaign_id,'constitutionRevision',constitution.revision,
    'locationKind',CASE WHEN json_extract(location.value,'$.parentLocationId') IS NULL THEN 'REGION' ELSE 'SPECIAL' END,
    'materialization','OUTLINE','name',json_extract(location.value,'$.name'),
    'description',json_extract(location.value,'$.description'),
    'parentLocationId',json_extract(location.value,'$.parentLocationId'),
    'atmosphere',NULL,'features',json_array(),
    'factionIds',json(json_extract(location.value,'$.factionIds')),
    'currentSituation',NULL,
    'constitutionEvidence',json_object(
      'technology',constitution.technology,'magic',constitution.magic,
      'society',constitution.society,'politics',constitution.politics
    ),
    'generationRecordId',NULL,'revision',1,
    'createdAt',bible.created_at,'updatedAt',constitution.locked_at
  ),
  NULL,1,bible.created_at,constitution.locked_at
FROM world_bibles bible
JOIN world_constitutions constitution
  ON constitution.campaign_id=bible.campaign_id AND constitution.status='LOCKED'
JOIN json_each(bible.locations_json) location;

INSERT INTO location_connections (
  id,campaign_id,first_location_id,second_location_id,source,generation_record_id,created_at
)
SELECT
  'location-edge:' ||
    CASE WHEN child.id < child.parent_location_id THEN child.id ELSE child.parent_location_id END || ':' ||
    CASE WHEN child.id < child.parent_location_id THEN child.parent_location_id ELSE child.id END,
  child.campaign_id,
  CASE WHEN child.id < child.parent_location_id THEN child.id ELSE child.parent_location_id END,
  CASE WHEN child.id < child.parent_location_id THEN child.parent_location_id ELSE child.id END,
  'INITIAL_HIERARCHY',NULL,child.created_at
FROM dynamic_locations child
WHERE child.parent_location_id IS NOT NULL;

INSERT INTO campaign_location_states (campaign_id,current_location_id,revision,updated_at)
SELECT bible.campaign_id,
  COALESCE(
    (SELECT id FROM dynamic_locations WHERE campaign_id=bible.campaign_id AND name=bible.current_region LIMIT 1),
    (SELECT id FROM dynamic_locations WHERE campaign_id=bible.campaign_id
     ORDER BY parent_location_id IS NOT NULL,name,id LIMIT 1)
  ),
  1,constitution.locked_at
FROM world_bibles bible
JOIN world_constitutions constitution
  ON constitution.campaign_id=bible.campaign_id AND constitution.status='LOCKED'
WHERE EXISTS (SELECT 1 FROM dynamic_locations WHERE campaign_id=bible.campaign_id);

-- New worlds are projected only when their Constitution becomes immutable.
CREATE TRIGGER project_dynamic_locations_on_constitution_lock
AFTER UPDATE OF status ON world_constitutions
FOR EACH ROW
WHEN OLD.status='DRAFT' AND NEW.status='LOCKED'
BEGIN
  INSERT INTO dynamic_locations (
    id,campaign_id,schema_version,constitution_revision,location_kind,materialization,
    name,parent_location_id,profile_json,generation_record_id,revision,created_at,updated_at
  )
  SELECT
    json_extract(location.value,'$.id'),NEW.campaign_id,1,NEW.revision,
    CASE WHEN json_extract(location.value,'$.parentLocationId') IS NULL THEN 'REGION' ELSE 'SPECIAL' END,
    'OUTLINE',json_extract(location.value,'$.name'),json_extract(location.value,'$.parentLocationId'),
    json_object(
      'kind','DYNAMIC_LOCATION','schemaVersion',1,'id',json_extract(location.value,'$.id'),
      'campaignId',NEW.campaign_id,'constitutionRevision',NEW.revision,
      'locationKind',CASE WHEN json_extract(location.value,'$.parentLocationId') IS NULL THEN 'REGION' ELSE 'SPECIAL' END,
      'materialization','OUTLINE','name',json_extract(location.value,'$.name'),
      'description',json_extract(location.value,'$.description'),
      'parentLocationId',json_extract(location.value,'$.parentLocationId'),
      'atmosphere',NULL,'features',json_array(),
      'factionIds',json(json_extract(location.value,'$.factionIds')),
      'currentSituation',NULL,
      'constitutionEvidence',json_object(
        'technology',NEW.technology,'magic',NEW.magic,'society',NEW.society,'politics',NEW.politics
      ),
      'generationRecordId',NULL,'revision',1,
      'createdAt',bible.created_at,'updatedAt',NEW.locked_at
    ),
    NULL,1,bible.created_at,NEW.locked_at
  FROM world_bibles bible, json_each(bible.locations_json) location
  WHERE bible.campaign_id=NEW.campaign_id;

  INSERT INTO location_connections (
    id,campaign_id,first_location_id,second_location_id,source,generation_record_id,created_at
  )
  SELECT
    'location-edge:' ||
      CASE WHEN child.id < child.parent_location_id THEN child.id ELSE child.parent_location_id END || ':' ||
      CASE WHEN child.id < child.parent_location_id THEN child.parent_location_id ELSE child.id END,
    child.campaign_id,
    CASE WHEN child.id < child.parent_location_id THEN child.id ELSE child.parent_location_id END,
    CASE WHEN child.id < child.parent_location_id THEN child.parent_location_id ELSE child.id END,
    'INITIAL_HIERARCHY',NULL,child.created_at
  FROM dynamic_locations child
  WHERE child.campaign_id=NEW.campaign_id AND child.parent_location_id IS NOT NULL;

  INSERT INTO campaign_location_states (campaign_id,current_location_id,revision,updated_at)
  SELECT bible.campaign_id,
    COALESCE(
      (SELECT id FROM dynamic_locations WHERE campaign_id=bible.campaign_id AND name=bible.current_region LIMIT 1),
      (SELECT id FROM dynamic_locations WHERE campaign_id=bible.campaign_id
       ORDER BY parent_location_id IS NOT NULL,name,id LIMIT 1)
    ),
    1,NEW.locked_at
  FROM world_bibles bible
  WHERE bible.campaign_id=NEW.campaign_id
    AND EXISTS (SELECT 1 FROM dynamic_locations WHERE campaign_id=NEW.campaign_id);
END;
