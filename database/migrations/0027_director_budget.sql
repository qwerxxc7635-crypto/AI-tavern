CREATE TABLE director_budget_states (
  campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  game_day INTEGER NOT NULL CHECK(game_day>=0),
  game_time_minutes INTEGER NOT NULL CHECK(game_time_minutes>=0),
  daily_events_used INTEGER NOT NULL CHECK(daily_events_used BETWEEN 0 AND 4),
  urgent_events_used INTEGER NOT NULL CHECK(urgent_events_used BETWEEN 0 AND 2),
  npc_proactive_used INTEGER NOT NULL CHECK(npc_proactive_used BETWEEN 0 AND 2),
  background_changes_used INTEGER NOT NULL CHECK(background_changes_used BETWEEN 0 AND 3),
  revision INTEGER NOT NULL CHECK(revision>=1),
  updated_at TEXT NOT NULL
);

CREATE TABLE director_budget_admissions (
  run_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  admitted_at TEXT NOT NULL,
  FOREIGN KEY(run_id,campaign_id)
    REFERENCES world_director_runs(id,campaign_id) ON DELETE CASCADE
);

CREATE TABLE director_budget_entries (
  run_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  category TEXT NOT NULL CHECK(category IN (
    'MAINTENANCE','DAILY_EVENT','URGENT_EVENT','NPC_PROACTIVE','BACKGROUND_CHANGE'
  )),
  status TEXT NOT NULL CHECK(status IN ('APPROVED','DEFERRED','REJECTED')),
  requested_game_time INTEGER NOT NULL CHECK(requested_game_time>=0),
  eligible_game_time INTEGER NOT NULL CHECK(eligible_game_time>=requested_game_time),
  approved_game_time INTEGER CHECK(
    (status='APPROVED' AND approved_game_time IS NOT NULL)
    OR (status<>'APPROVED' AND approved_game_time IS NULL)
  ),
  reason TEXT NOT NULL CHECK(reason IN (
    'AVAILABLE','DAILY_LIMIT','URGENT_LIMIT','NPC_LIMIT','BACKGROUND_LIMIT',
    'ACTIVE_QUEST_LIMIT','COOLDOWN'
  )),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(run_id,ordinal),
  FOREIGN KEY(run_id,ordinal) REFERENCES world_director_proposals(run_id,ordinal) ON DELETE CASCADE,
  FOREIGN KEY(run_id,campaign_id) REFERENCES world_director_runs(id,campaign_id) ON DELETE CASCADE
);

CREATE INDEX idx_director_budget_pending
  ON director_budget_entries(campaign_id,status,eligible_game_time,requested_game_time,run_id,ordinal);

CREATE TABLE director_budget_cooldowns (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  cooldown_key TEXT NOT NULL,
  next_eligible_game_time INTEGER NOT NULL CHECK(next_eligible_game_time>=0),
  source_run_id TEXT NOT NULL,
  source_ordinal INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(campaign_id,cooldown_key),
  FOREIGN KEY(source_run_id,source_ordinal)
    REFERENCES director_budget_entries(run_id,ordinal) ON DELETE CASCADE
);

CREATE TABLE director_budget_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  evaluation_run_id TEXT NOT NULL,
  proposal_run_id TEXT NOT NULL,
  proposal_ordinal INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('APPROVED','DEFERRED')),
  reason TEXT NOT NULL CHECK(reason IN (
    'AVAILABLE','DAILY_LIMIT','URGENT_LIMIT','NPC_LIMIT','BACKGROUND_LIMIT',
    'ACTIVE_QUEST_LIMIT','COOLDOWN'
  )),
  game_day INTEGER NOT NULL CHECK(game_day>=0),
  game_time_minutes INTEGER NOT NULL CHECK(game_time_minutes>=0),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY(evaluation_run_id,campaign_id)
    REFERENCES world_director_runs(id,campaign_id) ON DELETE CASCADE,
  FOREIGN KEY(proposal_run_id,proposal_ordinal)
    REFERENCES director_budget_entries(run_id,ordinal) ON DELETE CASCADE
);

CREATE INDEX idx_director_budget_decision_history
  ON director_budget_decisions(campaign_id,id);

CREATE TRIGGER director_budget_decisions_append_only_update
BEFORE UPDATE ON director_budget_decisions
BEGIN SELECT RAISE(ABORT,'Director budget decisions are append-only'); END;

CREATE TRIGGER director_budget_decisions_append_only_delete
BEFORE DELETE ON director_budget_decisions
WHEN EXISTS(SELECT 1 FROM campaigns WHERE id=OLD.campaign_id)
  AND NOT EXISTS(SELECT 1 FROM quest_pool_restore_sessions WHERE campaign_id=OLD.campaign_id)
BEGIN SELECT RAISE(ABORT,'Director budget decisions are append-only'); END;
