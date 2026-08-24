CREATE TABLE prefetch_candidates (
  id TEXT PRIMARY KEY CHECK (
    length(id) BETWEEN 1 AND 256
    AND substr(id,1,1) GLOB '[A-Za-z0-9]'
    AND id NOT GLOB '*[^A-Za-z0-9:._-]*'
  ),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  director_run_id TEXT NOT NULL,
  lazy_intent_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('LOCATION_DETAILS','FACTION_DETAILS')),
  target_id TEXT NOT NULL CHECK(length(trim(target_id)) BETWEEN 1 AND 256),
  priority TEXT NOT NULL CHECK(priority IN ('P1','P2')),
  source_action_id TEXT,
  prediction_reason TEXT NOT NULL CHECK(prediction_reason IN (
    'DIRECTOR_APPROVED','BACKGROUND_CAPACITY'
  )),
  context_digest TEXT NOT NULL CHECK(
    length(context_digest)=64 AND context_digest NOT GLOB '*[^0-9a-f]*'
  ),
  state TEXT NOT NULL CHECK(state IN (
    'PREDICTED','RUNNING','READY','HIT','MISSED','INVALIDATED','CANCELLED','FAILED'
  )),
  active_execution_id TEXT,
  process_id TEXT,
  error_code TEXT CHECK(
    error_code IS NULL OR (
      length(error_code) BETWEEN 1 AND 120 AND error_code NOT GLOB '*[^A-Z0-9_]*'
    )
  ),
  revision INTEGER NOT NULL CHECK(revision>=1),
  predicted_at TEXT NOT NULL,
  started_at TEXT,
  ready_at TEXT,
  resolved_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(director_run_id,lazy_intent_key),
  UNIQUE(id,campaign_id),
  FOREIGN KEY(director_run_id,campaign_id)
    REFERENCES world_director_runs(id,campaign_id) ON DELETE CASCADE,
  FOREIGN KEY(lazy_intent_key,campaign_id)
    REFERENCES lazy_world_generation_plans(intent_key,campaign_id) ON DELETE CASCADE,
  CHECK(
    (priority='P1' AND source_action_id IS NOT NULL AND prediction_reason='DIRECTOR_APPROVED')
    OR (priority='P2' AND source_action_id IS NULL AND prediction_reason='BACKGROUND_CAPACITY')
  ),
  CHECK(
    (state='PREDICTED' AND active_execution_id IS NULL AND process_id IS NULL
      AND error_code IS NULL AND started_at IS NULL AND ready_at IS NULL AND resolved_at IS NULL)
    OR (state='RUNNING' AND active_execution_id IS NOT NULL AND process_id IS NOT NULL
      AND error_code IS NULL AND started_at IS NOT NULL AND ready_at IS NULL AND resolved_at IS NULL)
    OR (state='READY' AND active_execution_id IS NULL AND process_id IS NOT NULL
      AND error_code IS NULL AND started_at IS NOT NULL AND ready_at IS NOT NULL
      AND resolved_at IS NULL)
    OR (state='HIT' AND active_execution_id IS NULL AND process_id IS NOT NULL
      AND error_code IS NULL AND ready_at IS NOT NULL AND resolved_at IS NOT NULL)
    OR (state='MISSED' AND active_execution_id IS NULL AND error_code IS NULL
      AND resolved_at IS NOT NULL)
    OR (state IN ('INVALIDATED','CANCELLED') AND active_execution_id IS NULL
      AND error_code IS NULL AND resolved_at IS NOT NULL)
    OR (state='FAILED' AND active_execution_id IS NULL AND error_code IS NOT NULL
      AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX idx_prefetch_candidates_schedule
  ON prefetch_candidates(campaign_id,state,priority,predicted_at,id);

CREATE TABLE prefetch_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  candidate_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('LOCATION_DETAILS','FACTION_DETAILS')),
  target_id TEXT NOT NULL CHECK(length(trim(target_id)) BETWEEN 1 AND 256),
  priority TEXT CHECK(priority IS NULL OR priority IN ('P1','P2')),
  event TEXT NOT NULL CHECK(event IN (
    'PREDICTED','STARTED','READY','HIT','MISS','INVALIDATED','CANCELLED','FAILED'
  )),
  reason TEXT NOT NULL CHECK(reason IN (
    'DIRECTOR_APPROVED','BACKGROUND_CAPACITY','EXECUTION_STARTED','CANDIDATE_READY',
    'EXACT_MATCH','NOT_READY','NOT_PREDICTED','CONTEXT_CHANGED','SUPERSEDED',
    'PROCESS_RESTART','P0_PREEMPTED','USER_CANCELLED','QUEUE_REJECTED','EXECUTION_FAILED'
  )),
  queue_wait_ms INTEGER CHECK(queue_wait_ms IS NULL OR queue_wait_ms BETWEEN 0 AND 86400000),
  generation_ms INTEGER CHECK(generation_ms IS NULL OR generation_ms BETWEEN 0 AND 86400000),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY(candidate_id,campaign_id)
    REFERENCES prefetch_candidates(id,campaign_id) ON DELETE CASCADE,
  CHECK(
    (event='MISS' AND candidate_id IS NULL AND priority IS NULL)
    OR candidate_id IS NOT NULL
  )
);

CREATE INDEX idx_prefetch_events_metrics ON prefetch_events(campaign_id,event,id);

CREATE TRIGGER prefetch_candidate_validate_insert
BEFORE INSERT ON prefetch_candidates
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NOT EXISTS(
      SELECT 1 FROM quest_pool_restore_sessions WHERE campaign_id=NEW.campaign_id
    ) AND (NEW.state<>'PREDICTED' OR NEW.revision<>1)
      THEN RAISE(ABORT,'prefetch candidates must begin predicted at revision one')
    WHEN NOT EXISTS(
      SELECT 1 FROM world_director_runs run
      JOIN director_budget_admissions admission ON admission.run_id=run.id
      WHERE run.id=NEW.director_run_id AND run.campaign_id=NEW.campaign_id
        AND run.context_digest=NEW.context_digest
    ) THEN RAISE(ABORT,'prefetch requires an admitted Director run')
    WHEN NOT EXISTS(
      SELECT 1 FROM quest_pool_restore_sessions WHERE campaign_id=NEW.campaign_id
    ) AND NOT EXISTS(
      SELECT 1 FROM lazy_world_generation_plans plan
      WHERE plan.intent_key=NEW.lazy_intent_key AND plan.campaign_id=NEW.campaign_id
        AND plan.kind=NEW.kind AND plan.target_id=NEW.target_id
        AND plan.execution_mode='BACKGROUND_ELIGIBLE'
        AND (plan.state='PLANNED' OR (plan.state='FAILED' AND plan.retryable=1))
    ) THEN RAISE(ABORT,'prefetch target is not eligible')
    WHEN NOT EXISTS(
      SELECT 1 FROM quest_pool_restore_sessions WHERE campaign_id=NEW.campaign_id
    ) AND NEW.priority='P1' AND NOT EXISTS(
      SELECT 1 FROM world_director_proposals proposal
      JOIN director_budget_entries budget
        ON budget.run_id=proposal.run_id AND budget.ordinal=proposal.ordinal
      WHERE proposal.run_id=NEW.director_run_id
        AND proposal.campaign_id=NEW.campaign_id
        AND proposal.action_id=NEW.source_action_id
        AND budget.status='APPROVED'
        AND (
          (proposal.kind='FACTION_ACTION' AND proposal.actor_entity_id IS NOT NULL
            AND NEW.kind='FACTION_DETAILS' AND proposal.actor_entity_id=NEW.target_id)
          OR ((proposal.kind<>'FACTION_ACTION' OR proposal.actor_entity_id IS NULL) AND EXISTS(
            SELECT 1 FROM json_each(proposal.target_entity_ids_json) target
            WHERE target.type='text' AND target.value=NEW.target_id
          ))
        )
    ) THEN RAISE(ABORT,'P1 prefetch requires an approved Director action')
    WHEN NOT EXISTS(
      SELECT 1 FROM quest_pool_restore_sessions WHERE campaign_id=NEW.campaign_id
    ) AND NEW.priority='P2' AND (
      SELECT count(*) FROM prefetch_candidates
      WHERE director_run_id=NEW.director_run_id AND priority='P2'
    ) >= MAX(0,3-COALESCE((
      SELECT background_changes_used FROM director_budget_states
      WHERE campaign_id=NEW.campaign_id
    ),3)) THEN RAISE(ABORT,'P2 prefetch exceeds background capacity')
    WHEN NOT EXISTS(
      SELECT 1 FROM quest_pool_restore_sessions WHERE campaign_id=NEW.campaign_id
    ) AND (SELECT count(*) FROM prefetch_candidates WHERE director_run_id=NEW.director_run_id)>=4
      THEN RAISE(ABORT,'prefetch prediction exceeds candidate limit')
  END;
END;

CREATE TRIGGER prefetch_candidate_validate_update
BEFORE UPDATE ON prefetch_candidates
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.id<>OLD.id OR NEW.campaign_id<>OLD.campaign_id
      OR NEW.director_run_id<>OLD.director_run_id
      OR NEW.lazy_intent_key<>OLD.lazy_intent_key OR NEW.kind<>OLD.kind
      OR NEW.target_id<>OLD.target_id OR NEW.priority<>OLD.priority
      OR NEW.source_action_id IS NOT OLD.source_action_id
      OR NEW.prediction_reason<>OLD.prediction_reason
      OR NEW.context_digest<>OLD.context_digest OR NEW.predicted_at<>OLD.predicted_at
      THEN RAISE(ABORT,'prefetch candidate identity is immutable')
    WHEN NEW.revision<>OLD.revision+1
      THEN RAISE(ABORT,'prefetch revision must advance by one')
    WHEN OLD.state IN ('HIT','MISSED','INVALIDATED','CANCELLED','FAILED')
      THEN RAISE(ABORT,'terminal prefetch candidate is immutable')
    WHEN NOT (
      (OLD.state='PREDICTED' AND NEW.state IN ('RUNNING','MISSED','INVALIDATED','CANCELLED','FAILED'))
      OR (OLD.state='RUNNING' AND NEW.state IN ('READY','INVALIDATED','CANCELLED','FAILED'))
      OR (OLD.state='READY' AND NEW.state IN ('HIT','MISSED','INVALIDATED','CANCELLED'))
    ) THEN RAISE(ABORT,'prefetch transition is invalid')
  END;
END;

CREATE TRIGGER prefetch_candidate_delete_guard
BEFORE DELETE ON prefetch_candidates
WHEN EXISTS(SELECT 1 FROM campaigns WHERE id=OLD.campaign_id)
  AND NOT EXISTS(SELECT 1 FROM quest_pool_restore_sessions WHERE campaign_id=OLD.campaign_id)
BEGIN SELECT RAISE(ABORT,'prefetch candidates are retained for metrics'); END;

CREATE TRIGGER prefetch_events_append_only_update
BEFORE UPDATE ON prefetch_events
BEGIN SELECT RAISE(ABORT,'prefetch events are append-only'); END;

CREATE TRIGGER prefetch_events_append_only_delete
BEFORE DELETE ON prefetch_events
WHEN EXISTS(SELECT 1 FROM campaigns WHERE id=OLD.campaign_id)
  AND NOT EXISTS(SELECT 1 FROM quest_pool_restore_sessions WHERE campaign_id=OLD.campaign_id)
BEGIN SELECT RAISE(ABORT,'prefetch events are append-only'); END;
