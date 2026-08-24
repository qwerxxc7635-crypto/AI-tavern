CREATE TABLE historical_summaries (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  scope_kind TEXT NOT NULL CHECK (
    scope_kind IN ('CAMPAIGN', 'ACTOR', 'ADVENTURE', 'CONVERSATION')
  ),
  scope_id TEXT NOT NULL CHECK (length(trim(scope_id)) BETWEEN 1 AND 256),
  actor_type TEXT CHECK (actor_type IN ('NPC', 'PLAYER_CHARACTER')),
  actor_id TEXT,
  summary_text TEXT NOT NULL CHECK (length(trim(summary_text)) BETWEEN 1 AND 8000),
  source_digest TEXT NOT NULL CHECK (
    length(source_digest) = 64 AND source_digest NOT GLOB '*[^a-f0-9]*'
  ),
  covered_from TEXT NOT NULL,
  covered_to TEXT NOT NULL,
  generation_record_id TEXT REFERENCES generation_records (id) ON DELETE SET NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (covered_from <= covered_to),
  CHECK (
    (scope_kind = 'ACTOR' AND actor_type IS NOT NULL AND length(trim(actor_id)) > 0)
    OR (scope_kind <> 'ACTOR' AND actor_type IS NULL AND actor_id IS NULL)
  ),
  UNIQUE (campaign_id, scope_kind, scope_id, revision)
);

CREATE INDEX idx_historical_summaries_scope
  ON historical_summaries (campaign_id, scope_kind, scope_id, updated_at, id);

CREATE TABLE world_lore_entries (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 256),
  lore_text TEXT NOT NULL CHECK (length(trim(lore_text)) BETWEEN 1 AND 8000),
  source_digest TEXT NOT NULL CHECK (
    length(source_digest) = 64 AND source_digest NOT GLOB '*[^a-f0-9]*'
  ),
  generation_record_id TEXT REFERENCES generation_records (id) ON DELETE SET NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_world_lore_entries_campaign
  ON world_lore_entries (campaign_id, updated_at, id);

CREATE TABLE memory_artifact_sources (
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  artifact_kind TEXT NOT NULL CHECK (
    artifact_kind IN ('SUMMARY', 'LONG_TERM', 'WORLD_LORE')
  ),
  artifact_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 127),
  source_kind TEXT NOT NULL CHECK (
    source_kind IN (
      'WORLD_TRUTH', 'CLAIM', 'KNOWLEDGE', 'MEMORY',
      'WORLD_FACT', 'GAME_EVENT', 'MESSAGE', 'ADVENTURE_TURN'
    )
  ),
  source_id TEXT NOT NULL CHECK (length(trim(source_id)) BETWEEN 1 AND 256),
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  source_hash TEXT NOT NULL CHECK (
    length(source_hash) = 64 AND source_hash NOT GLOB '*[^a-f0-9]*'
  ),
  source_occurred_at TEXT NOT NULL,
  PRIMARY KEY (artifact_kind, artifact_id, ordinal),
  UNIQUE (artifact_kind, artifact_id, source_kind, source_id)
);

CREATE INDEX idx_memory_artifact_sources_campaign
  ON memory_artifact_sources (campaign_id, artifact_kind, artifact_id, ordinal);

CREATE TRIGGER historical_summary_validate_actor_insert
BEFORE INSERT ON historical_summaries
FOR EACH ROW WHEN NEW.scope_kind = 'ACTOR'
BEGIN
  SELECT CASE
    WHEN NEW.actor_type = 'NPC' AND NOT EXISTS (
      SELECT 1 FROM npcs WHERE id = NEW.actor_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'summary actor is not an NPC in this campaign')
    WHEN NEW.actor_type = 'PLAYER_CHARACTER' AND NOT EXISTS (
      SELECT 1 FROM player_characters
      WHERE id = NEW.actor_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'summary actor is not a player character in this campaign')
  END;
END;

CREATE TRIGGER historical_summary_validate_update
BEFORE UPDATE ON historical_summaries
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id OR NEW.campaign_id <> OLD.campaign_id
      OR NEW.scope_kind <> OLD.scope_kind OR NEW.scope_id <> OLD.scope_id
      OR NEW.actor_type IS NOT OLD.actor_type OR NEW.actor_id IS NOT OLD.actor_id
      THEN RAISE(ABORT, 'summary identity and scope are immutable')
    WHEN NEW.revision <> OLD.revision + 1
      THEN RAISE(ABORT, 'summary revision must advance by one')
  END;
END;

CREATE TRIGGER world_lore_validate_update
BEFORE UPDATE ON world_lore_entries
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id OR NEW.campaign_id <> OLD.campaign_id
      THEN RAISE(ABORT, 'world lore identity and scope are immutable')
    WHEN NEW.revision <> OLD.revision + 1
      THEN RAISE(ABORT, 'world lore revision must advance by one')
  END;
END;

CREATE TRIGGER memory_artifact_source_validate_insert
BEFORE INSERT ON memory_artifact_sources
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.artifact_kind = 'SUMMARY' AND NOT EXISTS (
      SELECT 1 FROM historical_summaries
      WHERE id = NEW.artifact_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'summary source parent is missing')
    WHEN NEW.artifact_kind = 'LONG_TERM' AND NOT EXISTS (
      SELECT 1 FROM knowledge_memories
      WHERE id = NEW.artifact_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'long-term memory source parent is missing')
    WHEN NEW.artifact_kind = 'WORLD_LORE' AND NOT EXISTS (
      SELECT 1 FROM world_lore_entries
      WHERE id = NEW.artifact_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'world lore source parent is missing')
  END;
END;

CREATE TRIGGER historical_summary_delete_sources
AFTER DELETE ON historical_summaries
FOR EACH ROW
BEGIN
  DELETE FROM memory_artifact_sources
  WHERE artifact_kind = 'SUMMARY' AND artifact_id = OLD.id;
END;

CREATE TRIGGER knowledge_memory_delete_sources
AFTER DELETE ON knowledge_memories
FOR EACH ROW
BEGIN
  DELETE FROM memory_artifact_sources
  WHERE artifact_kind = 'LONG_TERM' AND artifact_id = OLD.id;
END;

CREATE TRIGGER world_lore_delete_sources
AFTER DELETE ON world_lore_entries
FOR EACH ROW
BEGIN
  DELETE FROM memory_artifact_sources
  WHERE artifact_kind = 'WORLD_LORE' AND artifact_id = OLD.id;
END;
