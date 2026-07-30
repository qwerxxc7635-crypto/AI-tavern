CREATE TABLE provider_configs (
  id TEXT PRIMARY KEY,
  provider_type TEXT NOT NULL,
  preset_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  base_url TEXT,
  credential_ref TEXT,
  options_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(options_json)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (preset_key, display_name)
);

CREATE INDEX idx_provider_configs_enabled
  ON provider_configs (enabled, display_name);

CREATE TABLE model_profiles (
  id TEXT PRIMARY KEY,
  provider_config_id TEXT NOT NULL
    REFERENCES provider_configs (id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json)),
  task_options_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(task_options_json)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  capabilities_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider_config_id, model_name)
);

CREATE INDEX idx_model_profiles_enabled
  ON model_profiles (enabled, display_name);

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  state TEXT NOT NULL CHECK (
    state IN (
      'CREATING_WORLD',
      'REVIEWING_WORLD',
      'CREATING_CHARACTER',
      'GENERATING_TAVERN',
      'TAVERN',
      'ADVENTURE',
      'SETTLEMENT',
      'GENERATION_FAILED',
      'WAITING_FOR_MODEL',
      'RECOVERY_REQUIRED',
      'ARCHIVED'
    )
  ),
  resume_state TEXT CHECK (
    resume_state IS NULL
    OR resume_state IN (
      'CREATING_WORLD',
      'REVIEWING_WORLD',
      'CREATING_CHARACTER',
      'GENERATING_TAVERN',
      'TAVERN',
      'ADVENTURE',
      'SETTLEMENT'
    )
  ),
  default_model_profile_id TEXT
    REFERENCES model_profiles (id) ON DELETE SET NULL,
  fallback_model_profile_id TEXT
    REFERENCES model_profiles (id) ON DELETE SET NULL,
  task_model_overrides_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(task_model_overrides_json)),
  model_switch_policy TEXT NOT NULL DEFAULT 'ASK'
    CHECK (model_switch_policy IN ('ASK', 'SAME_PROVIDER', 'CROSS_PROVIDER', 'DISABLED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK (
    (
      state IN ('GENERATION_FAILED', 'WAITING_FOR_MODEL', 'RECOVERY_REQUIRED')
      AND resume_state IS NOT NULL
    )
    OR (
      state NOT IN ('GENERATION_FAILED', 'WAITING_FOR_MODEL', 'RECOVERY_REQUIRED')
      AND resume_state IS NULL
    )
  )
);

CREATE INDEX idx_campaigns_updated_at ON campaigns (updated_at DESC);
CREATE INDEX idx_campaigns_state ON campaigns (state);

CREATE TABLE world_bibles (
  campaign_id TEXT PRIMARY KEY
    REFERENCES campaigns (id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  name TEXT NOT NULL,
  current_region TEXT NOT NULL,
  summary TEXT NOT NULL,
  core_conflict TEXT NOT NULL,
  technology_level TEXT NOT NULL,
  power_rules_json TEXT NOT NULL CHECK (json_valid(power_rules_json)),
  factions_json TEXT NOT NULL CHECK (json_valid(factions_json)),
  locations_json TEXT NOT NULL CHECK (json_valid(locations_json)),
  narrative_style TEXT NOT NULL,
  forbidden_elements_json TEXT NOT NULL CHECK (json_valid(forbidden_elements_json)),
  tavern_reason TEXT NOT NULL,
  story_hooks_json TEXT NOT NULL CHECK (json_valid(story_hooks_json)),
  locked_fields_json TEXT NOT NULL CHECK (json_valid(locked_fields_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_world_bibles_updated_at ON world_bibles (updated_at);

CREATE TABLE world_facts (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL
    REFERENCES campaigns (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'LOCKED_RULE',
      'DEVELOPING_FACT',
      'TEMPORARY_NARRATIVE',
      'RUMOR',
      'FALSE_BELIEF'
    )
  ),
  statement TEXT NOT NULL,
  location_id TEXT,
  faction_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(faction_ids_json)),
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
  supersedes_fact_id TEXT
    REFERENCES world_facts (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_world_facts_campaign_kind
  ON world_facts (campaign_id, kind);
CREATE INDEX idx_world_facts_campaign_created
  ON world_facts (campaign_id, created_at);
CREATE INDEX idx_world_facts_supersedes
  ON world_facts (supersedes_fact_id);

CREATE TABLE player_characters (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL UNIQUE
    REFERENCES campaigns (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  gender TEXT,
  age INTEGER CHECK (age IS NULL OR age >= 0),
  concept TEXT NOT NULL,
  story_preferences_json TEXT NOT NULL CHECK (json_valid(story_preferences_json)),
  content_boundaries_json TEXT NOT NULL CHECK (json_valid(content_boundaries_json)),
  class_archetype TEXT NOT NULL
    CHECK (class_archetype IN ('WARRIOR', 'ROGUE', 'SCHOLAR', 'DIPLOMAT')),
  class_display_name TEXT NOT NULL,
  attributes_json TEXT NOT NULL CHECK (json_valid(attributes_json)),
  traits_json TEXT NOT NULL CHECK (json_valid(traits_json)),
  personal_goal TEXT NOT NULL,
  background_json TEXT NOT NULL CHECK (json_valid(background_json)),
  initial_equipment_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(initial_equipment_ids_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE taverns (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL
    REFERENCES campaigns (id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position TEXT NOT NULL,
  environment TEXT NOT NULL,
  special_rules_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(special_rules_json)),
  long_term_problem TEXT NOT NULL,
  owner_npc_id TEXT
    REFERENCES npcs (id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,
  changes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(changes_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_taverns_campaign ON taverns (campaign_id);
CREATE INDEX idx_taverns_owner ON taverns (owner_npc_id);

CREATE TABLE npcs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL
    REFERENCES campaigns (id) ON DELETE CASCADE,
  tavern_id TEXT NOT NULL
    REFERENCES taverns (id) ON DELETE CASCADE,
  residency TEXT NOT NULL
    CHECK (residency IN ('OWNER', 'RESIDENT', 'TEMPORARY_VISITOR')),
  name TEXT NOT NULL,
  identity TEXT NOT NULL,
  appearance TEXT NOT NULL,
  personality TEXT NOT NULL,
  goal TEXT NOT NULL,
  secret TEXT NOT NULL,
  speech_style TEXT NOT NULL,
  current_mood TEXT NOT NULL,
  current_status TEXT NOT NULL
    CHECK (current_status IN ('ACTIVE', 'ABSENT', 'LEFT', 'DECEASED')),
  visit_json TEXT CHECK (visit_json IS NULL OR json_valid(visit_json)),
  memories_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(memories_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_npcs_tavern_residency
  ON npcs (tavern_id, residency);
CREATE INDEX idx_npcs_campaign_status
  ON npcs (campaign_id, current_status);

CREATE TABLE npc_knowledge (
  npc_id TEXT PRIMARY KEY
    REFERENCES npcs (id) ON DELETE CASCADE,
  known_fact_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(known_fact_ids_json)),
  suspected_fact_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(suspected_fact_ids_json)),
  false_belief_fact_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(false_belief_fact_ids_json)),
  excluded_secret_fact_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(excluded_secret_fact_ids_json)),
  updated_at TEXT NOT NULL
);

CREATE TABLE npc_relationships (
  npc_id TEXT PRIMARY KEY
    REFERENCES npcs (id) ON DELETE CASCADE,
  player_character_id TEXT NOT NULL
    REFERENCES player_characters (id) ON DELETE CASCADE,
  trust INTEGER NOT NULL CHECK (trust BETWEEN -5 AND 5),
  closeness INTEGER NOT NULL CHECK (closeness BETWEEN -5 AND 5),
  awe INTEGER NOT NULL CHECK (awe BETWEEN -5 AND 5),
  obligation INTEGER NOT NULL CHECK (obligation BETWEEN -5 AND 5),
  updated_at TEXT NOT NULL,
  UNIQUE (npc_id, player_character_id)
);

CREATE INDEX idx_npc_relationships_character
  ON npc_relationships (player_character_id);

CREATE TABLE quests (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL
    REFERENCES campaigns (id) ON DELETE CASCADE,
  publisher_npc_id TEXT NOT NULL
    REFERENCES npcs (id) ON DELETE RESTRICT,
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  status TEXT NOT NULL
    CHECK (status IN ('AVAILABLE', 'ACCEPTED', 'ACTIVE', 'COMPLETED', 'FAILED', 'ABANDONED')),
  risk TEXT NOT NULL CHECK (risk IN ('LOW', 'MODERATE', 'HIGH', 'EXTREME')),
  recommended_attributes_json TEXT NOT NULL
    CHECK (json_valid(recommended_attributes_json)),
  expected_turns_min INTEGER NOT NULL CHECK (expected_turns_min >= 1),
  expected_turns_max INTEGER NOT NULL CHECK (expected_turns_max >= expected_turns_min),
  reward_tier TEXT NOT NULL
    CHECK (reward_tier IN ('BASIC', 'NOTABLE', 'RARE', 'LEGENDARY')),
  related_npc_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(related_npc_ids_json)),
  related_fact_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(related_fact_ids_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_quests_campaign_status ON quests (campaign_id, status);
CREATE INDEX idx_quests_publisher ON quests (publisher_npc_id);

CREATE TABLE adventures (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL
    REFERENCES campaigns (id) ON DELETE CASCADE,
  quest_id TEXT NOT NULL
    REFERENCES quests (id) ON DELETE RESTRICT,
  state TEXT NOT NULL
    CHECK (
      state IN (
        'PREPARING',
        'SCENE',
        'WAITING_FOR_PLAYER',
        'CHECK_REQUIRED',
        'RESOLVING',
        'ENDING',
        'SETTLED'
      )
    ),
  plan_json TEXT NOT NULL CHECK (json_valid(plan_json)),
  current_turn_number INTEGER NOT NULL DEFAULT 0 CHECK (current_turn_number >= 0),
  clues_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(clues_json)),
  ending_json TEXT CHECK (ending_json IS NULL OR json_valid(ending_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_adventures_campaign_state
  ON adventures (campaign_id, state);
CREATE INDEX idx_adventures_quest ON adventures (quest_id);
CREATE UNIQUE INDEX uq_adventures_one_active_per_campaign
  ON adventures (campaign_id)
  WHERE state <> 'SETTLED';

CREATE TABLE adventure_turns (
  id TEXT PRIMARY KEY,
  adventure_id TEXT NOT NULL
    REFERENCES adventures (id) ON DELETE CASCADE,
  turn_number INTEGER NOT NULL CHECK (turn_number >= 1),
  scene_text TEXT NOT NULL,
  speaker_npc_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(speaker_npc_ids_json)),
  suggested_actions_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(suggested_actions_json)),
  player_action_json TEXT
    CHECK (player_action_json IS NULL OR json_valid(player_action_json)),
  check_request_json TEXT
    CHECK (check_request_json IS NULL OR json_valid(check_request_json)),
  dice_result_json TEXT
    CHECK (dice_result_json IS NULL OR json_valid(dice_result_json)),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE (adventure_id, turn_number)
);

CREATE INDEX idx_adventure_turns_adventure_created
  ON adventure_turns (adventure_id, turn_number);

CREATE TABLE generation_records (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL
    REFERENCES campaigns (id) ON DELETE CASCADE,
  request_id TEXT NOT NULL UNIQUE,
  task TEXT NOT NULL,
  model_profile_id TEXT
    REFERENCES model_profiles (id) ON DELETE SET NULL,
  prompt_version INTEGER NOT NULL CHECK (prompt_version >= 1),
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  raw_response_text TEXT,
  validated_output_json TEXT
    CHECK (validated_output_json IS NULL OR json_valid(validated_output_json)),
  validation_error_json TEXT
    CHECK (validation_error_json IS NULL OR json_valid(validation_error_json)),
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX idx_generation_records_campaign_time
  ON generation_records (campaign_id, started_at);
CREATE INDEX idx_generation_records_task ON generation_records (task);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL
    REFERENCES campaigns (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('NPC', 'ADVENTURE', 'SYSTEM')),
  npc_id TEXT REFERENCES npcs (id) ON DELETE SET NULL,
  adventure_id TEXT REFERENCES adventures (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (kind = 'NPC' AND npc_id IS NOT NULL AND adventure_id IS NULL)
    OR (kind = 'ADVENTURE' AND adventure_id IS NOT NULL AND npc_id IS NULL)
    OR (kind = 'SYSTEM' AND npc_id IS NULL AND adventure_id IS NULL)
  )
);

CREATE INDEX idx_conversations_campaign_updated
  ON conversations (campaign_id, updated_at DESC);
CREATE INDEX idx_conversations_npc ON conversations (npc_id);
CREATE INDEX idx_conversations_adventure ON conversations (adventure_id);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL
    REFERENCES conversations (id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL CHECK (sequence_number >= 1),
  role TEXT NOT NULL CHECK (role IN ('PLAYER', 'NPC', 'NARRATOR', 'SYSTEM')),
  speaker_npc_id TEXT
    REFERENCES npcs (id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  generation_record_id TEXT
    REFERENCES generation_records (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE (conversation_id, sequence_number),
  CHECK (
    (role = 'NPC' AND speaker_npc_id IS NOT NULL)
    OR (role <> 'NPC' AND speaker_npc_id IS NULL)
  )
);

CREATE INDEX idx_messages_conversation_sequence
  ON messages (conversation_id, sequence_number);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL
    REFERENCES campaigns (id) ON DELETE CASCADE,
  owner_character_id TEXT
    REFERENCES player_characters (id) ON DELETE SET NULL,
  source_adventure_id TEXT
    REFERENCES adventures (id) ON DELETE SET NULL,
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  reward_tier TEXT NOT NULL
    CHECK (reward_tier IN ('BASIC', 'NOTABLE', 'RARE', 'LEGENDARY')),
  effect_json TEXT NOT NULL CHECK (json_valid(effect_json)),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_items_campaign_owner
  ON items (campaign_id, owner_character_id);
CREATE INDEX idx_items_source_adventure
  ON items (source_adventure_id);

CREATE TABLE world_clocks (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL
    REFERENCES campaigns (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  current INTEGER NOT NULL CHECK (current >= 0),
  max INTEGER NOT NULL CHECK (max >= 1 AND current <= max),
  stages_json TEXT NOT NULL CHECK (json_valid(stages_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_world_clocks_campaign ON world_clocks (campaign_id);

CREATE TABLE game_events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL
    REFERENCES campaigns (id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  type TEXT NOT NULL
    CHECK (
      type IN (
        'WORLD_CREATED',
        'CHARACTER_CREATED',
        'NPC_CREATED',
        'QUEST_ACCEPTED',
        'PLAYER_ACTION_SUBMITTED',
        'DICE_ROLLED',
        'FACT_DISCOVERED',
        'ITEM_ACQUIRED',
        'RELATIONSHIP_CHANGED',
        'WORLD_CLOCK_ADVANCED',
        'ADVENTURE_COMPLETED',
        'MODEL_SWITCHED'
      )
    ),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  occurred_at TEXT NOT NULL
);

CREATE INDEX idx_game_events_campaign_time
  ON game_events (campaign_id, occurred_at, id);
CREATE INDEX idx_game_events_campaign_type
  ON game_events (campaign_id, type);

CREATE TABLE pending_ai_requests (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL
    REFERENCES campaigns (id) ON DELETE CASCADE,
  turn_id TEXT
    REFERENCES adventure_turns (id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE,
  task TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (
      status IN (
        'CREATED',
        'CONTEXT_READY',
        'SENDING',
        'RECEIVED',
        'VALIDATING',
        'COMMITTED',
        'FAILED',
        'CANCELLED'
      )
    ),
  model_profile_id TEXT
    REFERENCES model_profiles (id) ON DELETE SET NULL,
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  context_json TEXT CHECK (context_json IS NULL OR json_valid(context_json)),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_json TEXT CHECK (last_error_json IS NULL OR json_valid(last_error_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_pending_requests_campaign_status
  ON pending_ai_requests (campaign_id, status);
CREATE INDEX idx_pending_requests_updated
  ON pending_ai_requests (updated_at);

CREATE TABLE save_snapshots (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL
    REFERENCES campaigns (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('AUTO', 'MANUAL', 'BACKUP', 'IMPORT')),
  reason TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  payload BLOB NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_save_snapshots_campaign_time
  ON save_snapshots (campaign_id, created_at DESC);
CREATE INDEX idx_save_snapshots_campaign_kind
  ON save_snapshots (campaign_id, kind, created_at DESC);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at TEXT NOT NULL
);
