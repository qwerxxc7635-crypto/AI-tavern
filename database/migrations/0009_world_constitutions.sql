CREATE TABLE world_constitutions (
  campaign_id TEXT PRIMARY KEY
    REFERENCES campaigns (id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'LOCKED')),
  world_type TEXT NOT NULL,
  era TEXT NOT NULL,
  technology TEXT NOT NULL,
  magic TEXT NOT NULL,
  peoples_json TEXT NOT NULL CHECK (json_valid(peoples_json)),
  society TEXT NOT NULL,
  politics TEXT NOT NULL,
  economy TEXT NOT NULL,
  combat_scale TEXT NOT NULL,
  death_rules TEXT NOT NULL,
  career_rules TEXT NOT NULL,
  equipment_rules TEXT NOT NULL,
  npc_rules TEXT NOT NULL,
  trait_rules TEXT NOT NULL,
  taboos_json TEXT NOT NULL CHECK (json_valid(taboos_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  locked_at TEXT,
  CHECK (
    (status = 'DRAFT' AND locked_at IS NULL)
    OR (status = 'LOCKED' AND locked_at IS NOT NULL)
  )
);

CREATE INDEX idx_world_constitutions_status
  ON world_constitutions (status, updated_at);

CREATE TRIGGER world_constitutions_locked_immutable
BEFORE UPDATE ON world_constitutions
WHEN OLD.status = 'LOCKED'
BEGIN
  SELECT RAISE(ABORT, 'locked world constitution is immutable');
END;
