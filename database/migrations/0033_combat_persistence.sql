CREATE TABLE battle_records (
  combat_instance_id TEXT PRIMARY KEY CHECK (
    length(combat_instance_id) BETWEEN 1 AND 256
    AND substr(combat_instance_id,1,1) GLOB '[A-Za-z0-9]'
    AND combat_instance_id NOT GLOB '*[^A-Za-z0-9:._-]*'
  ),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  combat_schema_version INTEGER NOT NULL CHECK(combat_schema_version>=1),
  ruleset_version INTEGER NOT NULL CHECK(ruleset_version>=1),
  balance_version INTEGER NOT NULL CHECK(balance_version>=1),
  engine_version INTEGER NOT NULL CHECK(engine_version>=1),
  world_profile_version INTEGER NOT NULL CHECK(world_profile_version>=1),
  attribute_mapping_version INTEGER NOT NULL CHECK(attribute_mapping_version>=1),
  rng_contract_version INTEGER NOT NULL CHECK(rng_contract_version>=1),
  random_seed TEXT NOT NULL CHECK(
    length(random_seed)=32 AND random_seed NOT GLOB '*[^0-9a-f]*'
  ),
  initial_state_json TEXT NOT NULL CHECK(
    json_valid(initial_state_json) AND json_type(initial_state_json)='object'
  ),
  initial_state_hash TEXT NOT NULL CHECK(
    length(initial_state_hash)=64 AND initial_state_hash NOT GLOB '*[^0-9a-f]*'
  ),
  accepted_commands_json TEXT NOT NULL DEFAULT '[]' CHECK(
    json_valid(accepted_commands_json) AND json_type(accepted_commands_json)='array'
  ),
  events_json TEXT NOT NULL DEFAULT '[]' CHECK(
    json_valid(events_json) AND json_type(events_json)='array'
  ),
  event_digest TEXT NOT NULL CHECK(
    length(event_digest)=64 AND event_digest NOT GLOB '*[^0-9a-f]*'
  ),
  last_committed_sequence INTEGER NOT NULL CHECK(
    last_committed_sequence BETWEEN 0 AND 9007199254740991
  ),
  combat_result TEXT CHECK(combat_result IS NULL OR combat_result IN (
    'VICTORY','DEFEAT','ESCAPE','SCRIPTED_VICTORY','SCRIPTED_DEFEAT','ABORTED'
  )),
  result_commit_id TEXT UNIQUE CHECK(
    result_commit_id IS NULL OR (
      length(result_commit_id) BETWEEN 1 AND 256
      AND substr(result_commit_id,1,1) GLOB '[A-Za-z0-9]'
      AND result_commit_id NOT GLOB '*[^A-Za-z0-9:._-]*'
    )
  ),
  canonical_delta_hash TEXT CHECK(
    canonical_delta_hash IS NULL OR (
      length(canonical_delta_hash)=64
      AND canonical_delta_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  canonical_result_committed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(combat_instance_id,campaign_id),
  CHECK(
    (result_commit_id IS NULL AND canonical_delta_hash IS NULL
      AND canonical_result_committed_at IS NULL)
    OR (combat_result IS NOT NULL AND result_commit_id IS NOT NULL
      AND canonical_delta_hash IS NOT NULL)
  ),
  CHECK(canonical_result_committed_at IS NULL OR result_commit_id IS NOT NULL)
);

CREATE INDEX idx_battle_records_campaign_sequence
  ON battle_records(campaign_id,last_committed_sequence,combat_instance_id);
CREATE INDEX idx_battle_records_result_commit
  ON battle_records(result_commit_id) WHERE result_commit_id IS NOT NULL;

CREATE TABLE active_combat_saves (
  combat_instance_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  combat_schema_version INTEGER NOT NULL CHECK(combat_schema_version>=1),
  ruleset_version INTEGER NOT NULL CHECK(ruleset_version>=1),
  balance_version INTEGER NOT NULL CHECK(balance_version>=1),
  engine_version INTEGER NOT NULL CHECK(engine_version>=1),
  world_profile_version INTEGER NOT NULL CHECK(world_profile_version>=1),
  attribute_mapping_version INTEGER NOT NULL CHECK(attribute_mapping_version>=1),
  rng_contract_version INTEGER NOT NULL CHECK(rng_contract_version>=1),
  rng_streams_json TEXT NOT NULL CHECK(
    json_valid(rng_streams_json) AND json_type(rng_streams_json)='object'
  ),
  current_combat_state_json TEXT NOT NULL CHECK(
    json_valid(current_combat_state_json) AND json_type(current_combat_state_json)='object'
  ),
  checkpoint_hash TEXT NOT NULL CHECK(
    length(checkpoint_hash)=64 AND checkpoint_hash NOT GLOB '*[^0-9a-f]*'
  ),
  objective_runtime_state_json TEXT NOT NULL CHECK(
    json_valid(objective_runtime_state_json)
    AND json_type(objective_runtime_state_json)='object'
  ),
  reinforcement_runtime_state_json TEXT NOT NULL CHECK(
    json_valid(reinforcement_runtime_state_json)
    AND json_type(reinforcement_runtime_state_json)='object'
  ),
  event_scheduler_checkpoint_json TEXT CHECK(
    event_scheduler_checkpoint_json IS NULL OR (
      json_valid(event_scheduler_checkpoint_json)
      AND json_type(event_scheduler_checkpoint_json)='object'
    )
  ),
  loop_guard_contract_json TEXT NOT NULL CHECK(
    json_valid(loop_guard_contract_json) AND json_type(loop_guard_contract_json)='object'
  ),
  pending_reaction_snapshot_json TEXT CHECK(
    pending_reaction_snapshot_json IS NULL OR (
      json_valid(pending_reaction_snapshot_json)
      AND json_type(pending_reaction_snapshot_json)='object'
    )
  ),
  resolution_context_snapshot_json TEXT CHECK(
    resolution_context_snapshot_json IS NULL OR (
      json_valid(resolution_context_snapshot_json)
      AND json_type(resolution_context_snapshot_json)='object'
    )
  ),
  cost_snapshot_json TEXT NOT NULL CHECK(
    json_valid(cost_snapshot_json) AND json_type(cost_snapshot_json)='object'
  ),
  last_committed_sequence INTEGER NOT NULL CHECK(
    last_committed_sequence BETWEEN 0 AND 9007199254740991
  ),
  revision INTEGER NOT NULL CHECK(revision>=1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(combat_instance_id,campaign_id)
    REFERENCES battle_records(combat_instance_id,campaign_id) ON DELETE CASCADE,
  CHECK(
    pending_reaction_snapshot_json IS NULL
    OR (event_scheduler_checkpoint_json IS NOT NULL
      AND resolution_context_snapshot_json IS NOT NULL)
  )
);

CREATE INDEX idx_active_combat_saves_campaign
  ON active_combat_saves(campaign_id,updated_at,combat_instance_id);

CREATE TRIGGER battle_record_identity_immutable
BEFORE UPDATE ON battle_records
FOR EACH ROW
WHEN NEW.combat_instance_id<>OLD.combat_instance_id
  OR NEW.campaign_id<>OLD.campaign_id
  OR NEW.combat_schema_version<>OLD.combat_schema_version
  OR NEW.ruleset_version<>OLD.ruleset_version
  OR NEW.balance_version<>OLD.balance_version
  OR NEW.engine_version<>OLD.engine_version
  OR NEW.world_profile_version<>OLD.world_profile_version
  OR NEW.attribute_mapping_version<>OLD.attribute_mapping_version
  OR NEW.rng_contract_version<>OLD.rng_contract_version
  OR NEW.random_seed<>OLD.random_seed
  OR NEW.initial_state_json<>OLD.initial_state_json
  OR NEW.initial_state_hash<>OLD.initial_state_hash
  OR NEW.created_at<>OLD.created_at
BEGIN
  SELECT RAISE(ABORT,'battle record deterministic identity is immutable');
END;

CREATE TRIGGER active_combat_save_version_insert
BEFORE INSERT ON active_combat_saves
FOR EACH ROW
WHEN NOT EXISTS(
  SELECT 1 FROM battle_records record
  WHERE record.combat_instance_id=NEW.combat_instance_id
    AND record.campaign_id=NEW.campaign_id
    AND record.combat_schema_version=NEW.combat_schema_version
    AND record.ruleset_version=NEW.ruleset_version
    AND record.balance_version=NEW.balance_version
    AND record.engine_version=NEW.engine_version
    AND record.world_profile_version=NEW.world_profile_version
    AND record.attribute_mapping_version=NEW.attribute_mapping_version
    AND record.rng_contract_version=NEW.rng_contract_version
)
BEGIN
  SELECT RAISE(ABORT,'active combat versions must match battle record');
END;

CREATE TRIGGER active_combat_save_identity_update
BEFORE UPDATE ON active_combat_saves
FOR EACH ROW
WHEN NEW.combat_instance_id<>OLD.combat_instance_id
  OR NEW.campaign_id<>OLD.campaign_id
  OR NEW.combat_schema_version<>OLD.combat_schema_version
  OR NEW.ruleset_version<>OLD.ruleset_version
  OR NEW.balance_version<>OLD.balance_version
  OR NEW.engine_version<>OLD.engine_version
  OR NEW.world_profile_version<>OLD.world_profile_version
  OR NEW.attribute_mapping_version<>OLD.attribute_mapping_version
  OR NEW.rng_contract_version<>OLD.rng_contract_version
  OR NEW.created_at<>OLD.created_at
  OR NEW.revision<>OLD.revision+1
BEGIN
  SELECT RAISE(ABORT,'active combat identity is immutable and revision must advance by one');
END;
