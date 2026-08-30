CREATE TABLE world_director_runs (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) BETWEEN 1 AND 200),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN (
    'MANUAL','WORLD_EVENT','PLAYER_ACTION','QUEST_TRANSITION','SETTLEMENT'
  )),
  trigger_id TEXT NOT NULL CHECK (length(trim(trigger_id)) BETWEEN 1 AND 200),
  context_digest TEXT NOT NULL CHECK (length(context_digest)=64),
  pace TEXT NOT NULL CHECK (pace IN ('QUIET','BALANCED','PRESSURED','OVERLOADED')),
  pressure_score INTEGER NOT NULL CHECK (pressure_score BETWEEN 0 AND 99),
  signals_json TEXT NOT NULL CHECK (
    json_valid(signals_json) AND json_type(signals_json)='object'
  ),
  suppressed_json TEXT NOT NULL CHECK (
    json_valid(suppressed_json) AND json_type(suppressed_json)='array'
  ),
  source_snapshot_json TEXT NOT NULL CHECK (
    json_valid(source_snapshot_json) AND json_type(source_snapshot_json)='object'
  ),
  created_at TEXT NOT NULL,
  UNIQUE(campaign_id,trigger_kind,trigger_id),
  UNIQUE(id,campaign_id)
);

CREATE INDEX idx_world_director_run_history
  ON world_director_runs(campaign_id,created_at,id);

CREATE TABLE world_director_proposals (
  run_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 8),
  action_id TEXT NOT NULL CHECK (length(trim(action_id)) BETWEEN 1 AND 128),
  kind TEXT NOT NULL CHECK (kind IN (
    'WORLD_CHANGE','NPC_ACTION','FACTION_ACTION','OPPORTUNITY','FORESHADOW','PRESSURE',
    'QUEST_UPDATE','QUEST_EXPIRE'
  )),
  actor_entity_id TEXT CHECK (
    actor_entity_id IS NULL OR length(trim(actor_entity_id)) BETWEEN 1 AND 200
  ),
  target_entity_ids_json TEXT NOT NULL CHECK (
    json_valid(target_entity_ids_json) AND json_type(target_entity_ids_json)='array'
      AND json_array_length(target_entity_ids_json)<=64
  ),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 4000),
  proposed_effects_json TEXT NOT NULL CHECK (
    json_valid(proposed_effects_json) AND json_type(proposed_effects_json)='array'
      AND json_array_length(proposed_effects_json) BETWEEN 1 AND 24
  ),
  urgency TEXT NOT NULL CHECK (urgency IN ('LOW','MEDIUM','HIGH')),
  cooldown_key TEXT NOT NULL CHECK (length(trim(cooldown_key)) BETWEEN 1 AND 128),
  route TEXT NOT NULL CHECK (route IN ('RULES','GENERATOR','FACTION_RULES')),
  PRIMARY KEY(run_id,ordinal),
  UNIQUE(run_id,action_id),
  FOREIGN KEY(run_id,campaign_id)
    REFERENCES world_director_runs(id,campaign_id) ON DELETE CASCADE
);

CREATE INDEX idx_world_director_proposal_schedule
  ON world_director_proposals(campaign_id,run_id,ordinal);

CREATE TRIGGER world_director_run_reference_guard
BEFORE INSERT ON world_director_runs
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM campaigns
      WHERE id=NEW.campaign_id AND state IN ('TAVERN','ADVENTURE','SETTLEMENT')
    ) THEN RAISE(ABORT,'World Director requires an active gameplay campaign')
    WHEN NEW.trigger_kind='WORLD_EVENT' AND NOT EXISTS (
      SELECT 1 FROM game_events WHERE id=NEW.trigger_id AND campaign_id=NEW.campaign_id
    ) THEN RAISE(ABORT,'World Director event trigger is invalid')
    WHEN NEW.trigger_kind='PLAYER_ACTION' AND NOT EXISTS (
      SELECT 1 FROM game_events
      WHERE id=NEW.trigger_id AND campaign_id=NEW.campaign_id
        AND type='PLAYER_ACTION_SUBMITTED'
    ) THEN RAISE(ABORT,'World Director player trigger is invalid')
    WHEN NEW.trigger_kind='QUEST_TRANSITION' AND NOT EXISTS (
      SELECT 1 FROM quest_pool_transitions
      WHERE operation_id=NEW.trigger_id AND campaign_id=NEW.campaign_id
    ) THEN RAISE(ABORT,'World Director Quest trigger is invalid')
    WHEN NEW.trigger_kind='SETTLEMENT' AND NOT EXISTS (
      SELECT 1 FROM game_events
      WHERE id=NEW.trigger_id AND campaign_id=NEW.campaign_id
        AND type='ADVENTURE_COMPLETED'
    ) THEN RAISE(ABORT,'World Director settlement trigger is invalid')
  END;
END;

CREATE TRIGGER world_director_run_update_guard
BEFORE UPDATE ON world_director_runs
BEGIN
  SELECT RAISE(ABORT,'World Director run history is append-only');
END;

CREATE TRIGGER world_director_run_delete_guard
BEFORE DELETE ON world_director_runs
WHEN EXISTS (SELECT 1 FROM campaigns WHERE id=OLD.campaign_id)
  AND NOT EXISTS (
    SELECT 1 FROM quest_pool_restore_sessions WHERE campaign_id=OLD.campaign_id
  )
BEGIN
  SELECT RAISE(ABORT,'World Director run history is append-only');
END;

CREATE TRIGGER world_director_proposal_reference_guard
BEFORE INSERT ON world_director_proposals
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM world_director_runs
    WHERE id=NEW.run_id AND campaign_id=NEW.campaign_id
  ) THEN RAISE(ABORT,'World Director proposal run is invalid') END;
END;

CREATE TRIGGER world_director_proposal_update_guard
BEFORE UPDATE ON world_director_proposals
BEGIN
  SELECT RAISE(ABORT,'World Director proposals are append-only');
END;

CREATE TRIGGER world_director_proposal_delete_guard
BEFORE DELETE ON world_director_proposals
WHEN EXISTS (SELECT 1 FROM campaigns WHERE id=OLD.campaign_id)
  AND NOT EXISTS (
    SELECT 1 FROM quest_pool_restore_sessions WHERE campaign_id=OLD.campaign_id
  )
BEGIN
  SELECT RAISE(ABORT,'World Director proposals are append-only');
END;
