CREATE TABLE character_rule_states (
  player_character_id TEXT PRIMARY KEY
    REFERENCES player_characters (id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL UNIQUE
    REFERENCES campaigns (id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  base_attributes_json TEXT NOT NULL CHECK (json_valid(base_attributes_json)),
  skills_json TEXT NOT NULL CHECK (json_valid(skills_json)),
  hp_current INTEGER NOT NULL CHECK (hp_current >= 0),
  hp_max INTEGER NOT NULL CHECK (hp_max BETWEEN 1 AND 999 AND hp_current <= hp_max),
  statuses_json TEXT NOT NULL CHECK (json_valid(statuses_json)),
  equipped_item_ids_json TEXT NOT NULL CHECK (json_valid(equipped_item_ids_json)),
  money INTEGER NOT NULL CHECK (money BETWEEN 0 AND 1000000000),
  game_time_minutes INTEGER NOT NULL CHECK (
    game_time_minutes BETWEEN 0 AND 9007199254740000
  ),
  trait_modifiers_json TEXT NOT NULL CHECK (json_valid(trait_modifiers_json)),
  resources_json TEXT NOT NULL CHECK (json_valid(resources_json)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_character_rule_states_campaign
  ON character_rule_states (campaign_id);

INSERT INTO character_rule_states (
  player_character_id, campaign_id, schema_version, base_attributes_json,
  skills_json, hp_current, hp_max, statuses_json, equipped_item_ids_json,
  money, game_time_minutes, trait_modifiers_json, resources_json, revision, updated_at
)
SELECT
  id, campaign_id, 1, attributes_json,
  '[]', 10, 10, '[]', '[]',
  0, 0, '[]', '[]', 1, updated_at
FROM player_characters;

CREATE TRIGGER character_rule_state_after_character_insert
AFTER INSERT ON player_characters
FOR EACH ROW
BEGIN
  INSERT INTO character_rule_states (
    player_character_id, campaign_id, schema_version, base_attributes_json,
    skills_json, hp_current, hp_max, statuses_json, equipped_item_ids_json,
    money, game_time_minutes, trait_modifiers_json, resources_json, revision, updated_at
  ) VALUES (
    NEW.id, NEW.campaign_id, 1, NEW.attributes_json,
    '[]', 10, 10, '[]', '[]',
    0, 0, '[]', '[]', 1, NEW.updated_at
  );
END;

CREATE TRIGGER character_rule_state_base_attributes_immutable
BEFORE UPDATE OF base_attributes_json ON character_rule_states
FOR EACH ROW
WHEN NEW.base_attributes_json <> OLD.base_attributes_json
BEGIN
  SELECT RAISE(ABORT, 'base character attributes are immutable');
END;

CREATE TRIGGER player_character_base_attributes_immutable
BEFORE UPDATE OF attributes_json ON player_characters
FOR EACH ROW
WHEN NEW.attributes_json <> OLD.attributes_json
BEGIN
  SELECT RAISE(ABORT, 'base character attributes are immutable');
END;

CREATE TABLE rules_events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  player_character_id TEXT NOT NULL
    REFERENCES player_characters (id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('LOCAL_RULE', 'PLAYER_ACTION', 'SYSTEM')),
  command_kind TEXT NOT NULL CHECK (
    command_kind IN (
      'TAKE_DAMAGE', 'RECOVER_HP', 'DEFINE_SKILL', 'CHANGE_SKILL',
      'ADD_STATUS', 'REMOVE_STATUS', 'EQUIP_ITEM', 'UNEQUIP_ITEM',
      'CHANGE_MONEY', 'ADVANCE_TIME', 'DEFINE_RESOURCE', 'CHANGE_RESOURCE',
      'SET_TRAIT_MODIFIER', 'REMOVE_TRAIT_MODIFIER', 'TRANSITION_QUEST'
    )
  ),
  command_json TEXT NOT NULL CHECK (json_valid(command_json)),
  before_revision INTEGER NOT NULL CHECK (before_revision >= 1),
  after_revision INTEGER NOT NULL CHECK (after_revision = before_revision + 1),
  state_before_json TEXT NOT NULL CHECK (json_valid(state_before_json)),
  state_after_json TEXT NOT NULL CHECK (json_valid(state_after_json)),
  quest_before_status TEXT CHECK (
    quest_before_status IS NULL OR quest_before_status IN (
      'AVAILABLE', 'ACCEPTED', 'ACTIVE', 'COMPLETED', 'FAILED', 'ABANDONED'
    )
  ),
  quest_after_status TEXT CHECK (
    quest_after_status IS NULL OR quest_after_status IN (
      'AVAILABLE', 'ACCEPTED', 'ACTIVE', 'COMPLETED', 'FAILED', 'ABANDONED'
    )
  ),
  occurred_at TEXT NOT NULL,
  UNIQUE (player_character_id, after_revision),
  CHECK (
    (quest_before_status IS NULL AND quest_after_status IS NULL)
    OR (quest_before_status IS NOT NULL AND quest_after_status IS NOT NULL)
  ),
  CHECK (json_extract(command_json, '$.campaignId') = campaign_id),
  CHECK (json_extract(command_json, '$.playerCharacterId') = player_character_id),
  CHECK (json_extract(command_json, '$.authority') = source),
  CHECK (json_extract(command_json, '$.kind') = command_kind),
  CHECK (json_extract(state_before_json, '$.campaignId') = campaign_id),
  CHECK (json_extract(state_after_json, '$.campaignId') = campaign_id),
  CHECK (json_extract(state_before_json, '$.playerCharacterId') = player_character_id),
  CHECK (json_extract(state_after_json, '$.playerCharacterId') = player_character_id),
  CHECK (json_extract(state_before_json, '$.revision') = before_revision),
  CHECK (json_extract(state_after_json, '$.revision') = after_revision)
);

CREATE INDEX idx_rules_events_campaign_time
  ON rules_events (campaign_id, occurred_at, id);
CREATE INDEX idx_rules_events_character_revision
  ON rules_events (player_character_id, after_revision);

CREATE TRIGGER rules_events_append_only_update
BEFORE UPDATE ON rules_events
BEGIN
  SELECT RAISE(ABORT, 'rules events are append-only');
END;

CREATE TRIGGER rules_events_append_only_delete
BEFORE DELETE ON rules_events
WHEN EXISTS (SELECT 1 FROM campaigns WHERE id = OLD.campaign_id)
BEGIN
  SELECT RAISE(ABORT, 'rules events are append-only');
END;
