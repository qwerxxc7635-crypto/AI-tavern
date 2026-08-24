CREATE TABLE lazy_world_generation_plans (
  intent_key TEXT PRIMARY KEY CHECK (
    length(intent_key) BETWEEN 1 AND 256
    AND substr(intent_key,1,1) GLOB '[A-Za-z0-9]'
    AND intent_key NOT GLOB '*[^A-Za-z0-9:._-]*'
  ),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN (
    'INITIAL_CAREER_POOL','TAVERN','TAVERN_ROSTER','LOCATION_DETAILS','FACTION_DETAILS'
  )),
  target_id TEXT NOT NULL CHECK(length(trim(target_id)) BETWEEN 1 AND 256),
  execution_mode TEXT NOT NULL CHECK(execution_mode IN ('ON_DEMAND','BACKGROUND_ELIGIBLE')),
  priority TEXT NOT NULL CHECK(priority IN ('P0','P1','P2')),
  state TEXT NOT NULL CHECK(state IN ('PLANNED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
  depends_on_intent_key TEXT REFERENCES lazy_world_generation_plans(intent_key) ON DELETE CASCADE,
  attempt_count INTEGER NOT NULL CHECK(attempt_count BETWEEN 0 AND 1000),
  active_run_id TEXT CHECK(
    active_run_id IS NULL OR (
      length(active_run_id) BETWEEN 1 AND 256
      AND substr(active_run_id,1,1) GLOB '[A-Za-z0-9]'
      AND active_run_id NOT GLOB '*[^A-Za-z0-9:._-]*'
    )
  ),
  artifact_ref TEXT CHECK(artifact_ref IS NULL OR length(trim(artifact_ref)) BETWEEN 1 AND 256),
  last_error_code TEXT CHECK(
    last_error_code IS NULL OR (
      length(last_error_code) BETWEEN 1 AND 120
      AND last_error_code NOT GLOB '*[^A-Z0-9_]*'
    )
  ),
  retryable INTEGER NOT NULL CHECK(retryable IN (0,1)),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(campaign_id,kind,target_id),
  UNIQUE(intent_key,campaign_id),
  CHECK(depends_on_intent_key IS NULL OR depends_on_intent_key<>intent_key),
  CHECK(updated_at>=created_at),
  CHECK(started_at IS NULL OR started_at>=created_at),
  CHECK(completed_at IS NULL OR completed_at>=created_at),
  CHECK(
    (state='PLANNED' AND attempt_count=0 AND active_run_id IS NULL AND artifact_ref IS NULL
      AND last_error_code IS NULL AND retryable=0 AND started_at IS NULL AND completed_at IS NULL)
    OR (state='RUNNING' AND attempt_count>=1 AND active_run_id IS NOT NULL AND artifact_ref IS NULL
      AND last_error_code IS NULL AND retryable=0 AND started_at IS NOT NULL AND completed_at IS NULL)
    OR (state='SUCCEEDED' AND active_run_id IS NULL AND artifact_ref IS NOT NULL
      AND last_error_code IS NULL AND retryable=0 AND completed_at IS NOT NULL)
    OR (state='FAILED' AND active_run_id IS NULL AND artifact_ref IS NULL
      AND last_error_code IS NOT NULL AND completed_at IS NOT NULL)
    OR (state='CANCELLED' AND active_run_id IS NULL AND artifact_ref IS NULL
      AND last_error_code='CANCELLED' AND retryable=1 AND completed_at IS NOT NULL)
  )
);

CREATE INDEX idx_lazy_world_generation_queue
  ON lazy_world_generation_plans(campaign_id,state,priority,execution_mode,created_at,intent_key);

CREATE TABLE lazy_world_generation_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  intent_key TEXT NOT NULL,
  from_state TEXT CHECK(from_state IS NULL OR from_state IN (
    'PLANNED','RUNNING','SUCCEEDED','FAILED','CANCELLED'
  )),
  to_state TEXT NOT NULL CHECK(to_state IN (
    'PLANNED','RUNNING','SUCCEEDED','FAILED','CANCELLED'
  )),
  reason TEXT NOT NULL CHECK(reason IN (
    'CORE_BOOTSTRAP','CLAIMED','ARTIFACT_COMMITTED','EXECUTION_FAILED',
    'CANCELLED','INTERRUPTED','RECONCILED'
  )),
  run_id TEXT,
  before_revision INTEGER NOT NULL CHECK(before_revision>=0),
  after_revision INTEGER NOT NULL CHECK(after_revision=before_revision+1),
  error_code TEXT,
  retryable INTEGER NOT NULL CHECK(retryable IN (0,1)),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY(intent_key,campaign_id)
    REFERENCES lazy_world_generation_plans(intent_key,campaign_id) ON DELETE CASCADE,
  CHECK(
    (to_state='FAILED' AND error_code IS NOT NULL)
    OR (to_state='CANCELLED' AND error_code='CANCELLED')
    OR (to_state NOT IN ('FAILED','CANCELLED') AND error_code IS NULL)
  )
);

CREATE INDEX idx_lazy_world_generation_history
  ON lazy_world_generation_transitions(campaign_id,intent_key,id);

CREATE TRIGGER lazy_world_generation_plan_validate_insert
BEFORE INSERT ON lazy_world_generation_plans
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NOT EXISTS(
        SELECT 1 FROM quest_pool_restore_sessions WHERE campaign_id=NEW.campaign_id
      ) AND (NEW.state<>'PLANNED' OR NEW.revision<>1)
      THEN RAISE(ABORT,'lazy generation plans must begin planned at revision one')
    WHEN NOT EXISTS(SELECT 1 FROM world_bibles WHERE campaign_id=NEW.campaign_id)
      OR NOT EXISTS(SELECT 1 FROM world_seeds WHERE campaign_id=NEW.campaign_id)
      OR NOT EXISTS(
        SELECT 1 FROM world_constitutions
        WHERE campaign_id=NEW.campaign_id AND status='LOCKED'
      ) THEN RAISE(ABORT,'lazy generation plan requires a locked seeded core world')
    WHEN NEW.kind IN ('INITIAL_CAREER_POOL','TAVERN','TAVERN_ROSTER')
      AND NEW.target_id<>NEW.campaign_id
      THEN RAISE(ABORT,'lazy global target must be its campaign')
    WHEN NEW.kind='LOCATION_DETAILS' AND NOT EXISTS(
      SELECT 1 FROM dynamic_locations
      WHERE id=NEW.target_id AND campaign_id=NEW.campaign_id
    ) THEN RAISE(ABORT,'lazy location target is outside the campaign')
    WHEN NEW.kind='FACTION_DETAILS' AND NOT EXISTS(
      SELECT 1 FROM active_factions
      WHERE id=NEW.target_id AND campaign_id=NEW.campaign_id
    ) THEN RAISE(ABORT,'lazy faction target is outside the campaign')
    WHEN NEW.depends_on_intent_key IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM lazy_world_generation_plans
      WHERE intent_key=NEW.depends_on_intent_key AND campaign_id=NEW.campaign_id
    ) THEN RAISE(ABORT,'lazy generation dependency is outside the campaign')
  END;
END;

CREATE TRIGGER lazy_world_generation_plan_validate_update
BEFORE UPDATE ON lazy_world_generation_plans
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.intent_key<>OLD.intent_key OR NEW.campaign_id<>OLD.campaign_id
      OR NEW.kind<>OLD.kind OR NEW.target_id<>OLD.target_id
      OR NEW.execution_mode<>OLD.execution_mode OR NEW.priority<>OLD.priority
      OR NEW.depends_on_intent_key IS NOT OLD.depends_on_intent_key
      OR NEW.created_at<>OLD.created_at
      THEN RAISE(ABORT,'lazy generation plan identity is immutable')
    WHEN NEW.revision<>OLD.revision+1
      THEN RAISE(ABORT,'lazy generation revision must advance by one')
    WHEN OLD.state='SUCCEEDED'
      THEN RAISE(ABORT,'succeeded lazy generation is immutable')
    WHEN NOT (
      (OLD.state='PLANNED' AND NEW.state IN ('RUNNING','CANCELLED','SUCCEEDED'))
      OR (OLD.state='RUNNING' AND NEW.state IN ('SUCCEEDED','FAILED','CANCELLED'))
      OR (OLD.state='FAILED' AND NEW.state IN ('RUNNING','SUCCEEDED','CANCELLED'))
      OR (OLD.state='CANCELLED' AND NEW.state IN ('RUNNING','SUCCEEDED'))
    ) THEN RAISE(ABORT,'lazy generation transition is invalid')
    WHEN NEW.state='RUNNING' AND NEW.attempt_count<>OLD.attempt_count+1
      THEN RAISE(ABORT,'lazy generation attempt must advance on claim')
    WHEN NEW.state<>'RUNNING' AND NEW.attempt_count<>OLD.attempt_count
      THEN RAISE(ABORT,'lazy generation attempt changed outside claim')
  END;
END;

CREATE TRIGGER lazy_world_generation_plan_validate_success
BEFORE UPDATE OF state ON lazy_world_generation_plans
FOR EACH ROW WHEN NEW.state='SUCCEEDED'
BEGIN
  SELECT CASE
    WHEN NEW.kind='INITIAL_CAREER_POOL' AND NOT EXISTS(
      SELECT 1 FROM career_pools
      WHERE campaign_id=NEW.campaign_id AND NEW.artifact_ref=NEW.campaign_id
    ) THEN RAISE(ABORT,'lazy career plan requires a committed career pool')
    WHEN NEW.kind='TAVERN' AND NOT EXISTS(
      SELECT 1 FROM taverns
      WHERE id=NEW.artifact_ref AND campaign_id=NEW.campaign_id
    ) THEN RAISE(ABORT,'lazy tavern plan requires a committed tavern')
    WHEN NEW.kind='TAVERN_ROSTER' AND NOT EXISTS(
      SELECT 1 FROM taverns tavern
      WHERE tavern.id=NEW.artifact_ref AND tavern.campaign_id=NEW.campaign_id
        AND (SELECT count(*) FROM npcs WHERE tavern_id=tavern.id)>=4
        AND (SELECT count(*) FROM world_facts
             WHERE campaign_id=NEW.campaign_id AND kind='RUMOR')>=3
        AND (SELECT count(*) FROM world_clocks WHERE campaign_id=NEW.campaign_id)>=2
    ) THEN RAISE(ABORT,'lazy roster plan requires committed tavern content')
    WHEN NEW.kind='LOCATION_DETAILS' AND NOT EXISTS(
      SELECT 1 FROM dynamic_locations artifact
      WHERE artifact.id=NEW.artifact_ref AND artifact.campaign_id=NEW.campaign_id
        AND artifact.materialization='DETAILED'
        AND (
          artifact.parent_location_id=NEW.target_id
          OR EXISTS(
            SELECT 1 FROM location_connections edge
            WHERE edge.campaign_id=NEW.campaign_id
              AND ((edge.first_location_id=NEW.target_id AND edge.second_location_id=artifact.id)
                OR (edge.second_location_id=NEW.target_id AND edge.first_location_id=artifact.id))
          )
        )
    ) THEN RAISE(ABORT,'lazy location plan requires a detailed location expansion')
    WHEN NEW.kind='FACTION_DETAILS' AND NOT EXISTS(
      SELECT 1 FROM active_factions
      WHERE id=NEW.target_id AND id=NEW.artifact_ref
        AND campaign_id=NEW.campaign_id AND materialization='ACTIVE'
    ) THEN RAISE(ABORT,'lazy faction plan requires an active faction')
  END;
END;

CREATE TRIGGER lazy_world_generation_transitions_append_only_update
BEFORE UPDATE ON lazy_world_generation_transitions
BEGIN SELECT RAISE(ABORT,'lazy generation transitions are append-only'); END;

CREATE TRIGGER lazy_world_generation_transitions_append_only_delete
BEFORE DELETE ON lazy_world_generation_transitions
WHEN EXISTS(SELECT 1 FROM campaigns WHERE id=OLD.campaign_id)
  AND NOT EXISTS(SELECT 1 FROM quest_pool_restore_sessions WHERE campaign_id=OLD.campaign_id)
BEGIN SELECT RAISE(ABORT,'lazy generation transitions are append-only'); END;
