CREATE TABLE career_pools (
  campaign_id TEXT PRIMARY KEY
    REFERENCES campaigns (id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  constitution_revision INTEGER NOT NULL CHECK (constitution_revision >= 1),
  pool_json TEXT NOT NULL CHECK (
    json_valid(pool_json)
    AND json_type(pool_json) = 'object'
    AND length(pool_json) <= 524288
  ),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (json_extract(pool_json, '$.kind') = 'CAREER_POOL'),
  CHECK (json_extract(pool_json, '$.schemaVersion') = schema_version),
  CHECK (json_extract(pool_json, '$.campaignId') = campaign_id),
  CHECK (json_extract(pool_json, '$.constitutionRevision') = constitution_revision),
  CHECK (json_extract(pool_json, '$.revision') = revision)
);

CREATE TRIGGER career_pool_validate_insert
BEFORE INSERT ON career_pools
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM world_constitutions
      WHERE campaign_id = NEW.campaign_id
        AND revision = NEW.constitution_revision
        AND status = 'LOCKED'
    ) THEN RAISE(ABORT, 'career pool requires the locked constitution revision')
  END;
END;

CREATE TRIGGER career_pool_validate_update
BEFORE UPDATE ON career_pools
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.campaign_id <> OLD.campaign_id
      OR NEW.schema_version <> OLD.schema_version
      OR NEW.constitution_revision <> OLD.constitution_revision
      OR NEW.created_at <> OLD.created_at
      THEN RAISE(ABORT, 'career pool identity is immutable')
    WHEN NEW.revision <> OLD.revision + 1
      THEN RAISE(ABORT, 'career pool revision must advance by one')
    WHEN NOT EXISTS (
      SELECT 1 FROM world_constitutions
      WHERE campaign_id = NEW.campaign_id
        AND revision = NEW.constitution_revision
        AND status = 'LOCKED'
    ) THEN RAISE(ABORT, 'career pool requires the locked constitution revision')
  END;
END;

CREATE TRIGGER career_pool_delete_guard
BEFORE DELETE ON career_pools
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM campaigns WHERE id = OLD.campaign_id)
BEGIN
  SELECT RAISE(ABORT, 'career pools are retained as world facts');
END;
