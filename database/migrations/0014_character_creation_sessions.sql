CREATE TABLE character_creation_sessions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL UNIQUE
    REFERENCES campaigns (id) ON DELETE CASCADE,
  character_id TEXT NOT NULL UNIQUE,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  constitution_revision INTEGER NOT NULL CHECK (constitution_revision >= 1),
  mode TEXT NOT NULL CHECK (mode IN ('QUICK', 'ADVANCED')),
  status TEXT NOT NULL CHECK (
    status IN ('ACTIVE', 'READY_TO_CONFIRM', 'CANCELLED', 'CONFIRMED')
  ),
  concept_input TEXT,
  draft_json TEXT NOT NULL CHECK (
    json_valid(draft_json)
    AND json_type(draft_json) = 'object'
    AND length(draft_json) <= 262144
  ),
  locked_fields_json TEXT NOT NULL CHECK (
    json_valid(locked_fields_json)
    AND json_type(locked_fields_json) = 'array'
    AND length(locked_fields_json) <= 32768
  ),
  generation_record_id TEXT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT,
  confirmed_at TEXT,
  CHECK (json_extract(draft_json, '$.kind') = 'UNIVERSAL_CHARACTER_DRAFT'),
  CHECK (json_extract(draft_json, '$.schemaVersion') = schema_version),
  CHECK (json_extract(draft_json, '$.id') = character_id),
  CHECK (json_extract(draft_json, '$.campaignId') = campaign_id),
  CHECK (mode <> 'QUICK' OR concept_input IS NOT NULL),
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CHECK ((status = 'CONFIRMED') = (confirmed_at IS NOT NULL)),
  CHECK (status <> 'CONFIRMED' OR cancelled_at IS NULL)
);

CREATE INDEX idx_character_creation_sessions_status
  ON character_creation_sessions (status, updated_at);

CREATE TRIGGER character_creation_session_validate_insert
BEFORE INSERT ON character_creation_sessions
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM campaigns
      WHERE id = NEW.campaign_id AND state = 'CREATING_CHARACTER'
    ) THEN RAISE(ABORT, 'character creation requires the creating state')
    WHEN EXISTS (
      SELECT 1 FROM player_characters WHERE campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'character creation session cannot replace a formal character')
    WHEN NOT EXISTS (
      SELECT 1 FROM world_constitutions
      WHERE campaign_id = NEW.campaign_id
        AND revision = NEW.constitution_revision
        AND status = 'LOCKED'
    ) THEN RAISE(ABORT, 'character creation requires the locked constitution revision')
  END;
END;

CREATE TRIGGER character_creation_session_validate_update
BEFORE UPDATE ON character_creation_sessions
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.campaign_id <> OLD.campaign_id
      OR NEW.character_id <> OLD.character_id
      OR NEW.schema_version <> OLD.schema_version
      OR NEW.constitution_revision <> OLD.constitution_revision
      OR NEW.created_at <> OLD.created_at
      THEN RAISE(ABORT, 'character creation session identity is immutable')
    WHEN NEW.revision <> OLD.revision + 1
      THEN RAISE(ABORT, 'character creation session revision must advance by one')
    WHEN OLD.status = 'CONFIRMED'
      THEN RAISE(ABORT, 'confirmed character creation session is immutable')
    WHEN OLD.status = 'CANCELLED'
      AND NEW.status NOT IN ('ACTIVE', 'READY_TO_CONFIRM')
      THEN RAISE(ABORT, 'cancelled character creation session must resume before changing')
    WHEN NEW.status <> 'CONFIRMED'
      AND NOT EXISTS (
        SELECT 1 FROM campaigns
        WHERE id = NEW.campaign_id AND state = 'CREATING_CHARACTER'
      ) THEN RAISE(ABORT, 'active character creation requires the creating state')
    WHEN NOT EXISTS (
      SELECT 1 FROM world_constitutions
      WHERE campaign_id = NEW.campaign_id
        AND revision = NEW.constitution_revision
        AND status = 'LOCKED'
    ) THEN RAISE(ABORT, 'character creation requires the locked constitution revision')
  END;
END;

CREATE TRIGGER character_creation_session_delete_guard
BEFORE DELETE ON character_creation_sessions
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM campaigns WHERE id = OLD.campaign_id)
BEGIN
  SELECT RAISE(ABORT, 'character creation sessions are retained for recovery');
END;
