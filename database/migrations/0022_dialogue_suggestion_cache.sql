CREATE TABLE dialogue_suggestion_cache (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('NPC_DIALOGUE','TAVERN_SCENE')),
  scope_id TEXT NOT NULL CHECK (length(trim(scope_id)) BETWEEN 1 AND 200),
  context_digest TEXT NOT NULL CHECK (
    length(context_digest)=64 AND context_digest NOT GLOB '*[^0-9a-f]*'
  ),
  suggestions_json TEXT NOT NULL CHECK (
    json_valid(suggestions_json) AND json_type(suggestions_json)='array'
      AND json_array_length(suggestions_json) BETWEEN 3 AND 5
  ),
  generation_record_id TEXT NOT NULL UNIQUE
    REFERENCES generation_records(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE(campaign_id,scope_kind,scope_id,context_digest)
);

CREATE INDEX idx_dialogue_suggestion_scope
  ON dialogue_suggestion_cache(campaign_id,scope_kind,scope_id,created_at,id);

CREATE TRIGGER dialogue_suggestion_cache_insert_guard
BEFORE INSERT ON dialogue_suggestion_cache FOR EACH ROW BEGIN
  SELECT CASE
    WHEN NEW.scope_kind='NPC_DIALOGUE' AND NOT EXISTS (
      SELECT 1 FROM npc_lod_profiles
      WHERE id=NEW.scope_id AND campaign_id=NEW.campaign_id AND lod>=1
    ) THEN RAISE(ABORT,'dialogue suggestion NPC scope is invalid')
    WHEN NEW.scope_kind='TAVERN_SCENE' AND NOT EXISTS (
      SELECT 1 FROM tavern_scenes
      WHERE id=NEW.scope_id AND campaign_id=NEW.campaign_id AND status='ACTIVE'
    ) THEN RAISE(ABORT,'dialogue suggestion Scene scope is invalid')
  END;
END;

CREATE TRIGGER dialogue_suggestion_cache_update_guard
BEFORE UPDATE ON dialogue_suggestion_cache FOR EACH ROW BEGIN
  SELECT RAISE(ABORT,'dialogue suggestion cache entries are immutable');
END;

CREATE TRIGGER dialogue_suggestion_cache_delete_guard
BEFORE DELETE ON dialogue_suggestion_cache FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM campaigns WHERE id=OLD.campaign_id)
BEGIN SELECT RAISE(ABORT,'dialogue suggestion cache entries are retained'); END;
