CREATE TABLE world_lore_retrieval_rules (
  lore_entry_id TEXT PRIMARY KEY
    REFERENCES world_lore_entries (id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  keywords_json TEXT NOT NULL CHECK (
    json_valid(keywords_json) AND json_type(keywords_json) = 'array'
    AND json_array_length(keywords_json) <= 32 AND length(keywords_json) <= 8192
  ),
  entity_refs_json TEXT NOT NULL CHECK (
    json_valid(entity_refs_json) AND json_type(entity_refs_json) = 'array'
    AND json_array_length(entity_refs_json) <= 64 AND length(entity_refs_json) <= 32768
  ),
  location_ids_json TEXT NOT NULL CHECK (
    json_valid(location_ids_json) AND json_type(location_ids_json) = 'array'
    AND json_array_length(location_ids_json) <= 32 AND length(location_ids_json) <= 8192
  ),
  quest_ids_json TEXT NOT NULL CHECK (
    json_valid(quest_ids_json) AND json_type(quest_ids_json) = 'array'
    AND json_array_length(quest_ids_json) <= 32 AND length(quest_ids_json) <= 8192
  ),
  always_active INTEGER NOT NULL CHECK (always_active IN (0, 1)),
  match_mode TEXT NOT NULL CHECK (match_mode IN ('ANY', 'ALL')),
  priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 1000),
  token_budget INTEGER NOT NULL CHECK (token_budget BETWEEN 1 AND 4000),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at TEXT NOT NULL,
  CHECK (
    always_active = 1 OR json_array_length(keywords_json) > 0
    OR json_array_length(entity_refs_json) > 0
    OR json_array_length(location_ids_json) > 0
    OR json_array_length(quest_ids_json) > 0
  )
);

CREATE INDEX idx_world_lore_retrieval_campaign
  ON world_lore_retrieval_rules (campaign_id, enabled, priority DESC, lore_entry_id);

CREATE TRIGGER world_lore_retrieval_validate_insert
BEFORE INSERT ON world_lore_retrieval_rules
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM world_lore_entries
      WHERE id = NEW.lore_entry_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'lore retrieval rule belongs to another campaign')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.keywords_json)
      WHERE type <> 'text' OR length(trim(value)) NOT BETWEEN 1 AND 64
    ) THEN RAISE(ABORT, 'lore retrieval keyword is invalid')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.entity_refs_json) AS entity
      WHERE entity.type <> 'object'
        OR json_type(entity.value, '$.kind') <> 'text'
        OR json_extract(entity.value, '$.kind') NOT IN (
          'NPC', 'PLAYER_CHARACTER', 'FACTION', 'ITEM', 'WORLD_FACT'
        )
        OR json_type(entity.value, '$.id') <> 'text'
        OR length(trim(json_extract(entity.value, '$.id'))) NOT BETWEEN 1 AND 256
        OR (SELECT count(*) FROM json_each(entity.value)) <> 2
    ) THEN RAISE(ABORT, 'lore retrieval entity ref is invalid')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.entity_refs_json) AS entity
      WHERE CASE json_extract(entity.value, '$.kind')
        WHEN 'NPC' THEN NOT EXISTS (
          SELECT 1 FROM npcs
          WHERE id = json_extract(entity.value, '$.id') AND campaign_id = NEW.campaign_id
        )
        WHEN 'PLAYER_CHARACTER' THEN NOT EXISTS (
          SELECT 1 FROM player_characters
          WHERE id = json_extract(entity.value, '$.id') AND campaign_id = NEW.campaign_id
        )
        WHEN 'FACTION' THEN NOT EXISTS (
          SELECT 1 FROM active_factions
          WHERE id = json_extract(entity.value, '$.id') AND campaign_id = NEW.campaign_id
        )
        WHEN 'ITEM' THEN NOT EXISTS (
          SELECT 1 FROM items
          WHERE id = json_extract(entity.value, '$.id') AND campaign_id = NEW.campaign_id
        )
        WHEN 'WORLD_FACT' THEN NOT EXISTS (
          SELECT 1 FROM world_facts
          WHERE id = json_extract(entity.value, '$.id') AND campaign_id = NEW.campaign_id
        )
        ELSE 1
      END
    ) THEN RAISE(ABORT, 'lore retrieval entity belongs to another campaign')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.location_ids_json)
      WHERE type <> 'text' OR length(trim(value)) NOT BETWEEN 1 AND 256
    ) THEN RAISE(ABORT, 'lore retrieval location ID is invalid')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.location_ids_json) AS location
      WHERE NOT EXISTS (
        SELECT 1 FROM dynamic_locations
        WHERE id = location.value AND campaign_id = NEW.campaign_id
        UNION SELECT 1 FROM taverns
        WHERE location_id = location.value AND campaign_id = NEW.campaign_id
        UNION SELECT 1 FROM world_facts
        WHERE location_id = location.value AND campaign_id = NEW.campaign_id
      )
    ) THEN RAISE(ABORT, 'lore retrieval location belongs to another campaign')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.quest_ids_json)
      WHERE type <> 'text' OR length(trim(value)) NOT BETWEEN 1 AND 256
    ) THEN RAISE(ABORT, 'lore retrieval Quest ID is invalid')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.quest_ids_json) AS quest
      WHERE NOT EXISTS (
        SELECT 1 FROM quests
        WHERE id = quest.value AND campaign_id = NEW.campaign_id
      )
    ) THEN RAISE(ABORT, 'lore retrieval Quest belongs to another campaign')
  END;
END;

CREATE TRIGGER world_lore_retrieval_validate_update
BEFORE UPDATE ON world_lore_retrieval_rules
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.lore_entry_id <> OLD.lore_entry_id OR NEW.campaign_id <> OLD.campaign_id
      THEN RAISE(ABORT, 'lore retrieval identity is immutable')
    WHEN NEW.revision <> OLD.revision + 1
      THEN RAISE(ABORT, 'lore retrieval revision must advance by one')
    WHEN NOT EXISTS (
      SELECT 1 FROM world_lore_entries
      WHERE id = NEW.lore_entry_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'lore retrieval rule belongs to another campaign')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.keywords_json)
      WHERE type <> 'text' OR length(trim(value)) NOT BETWEEN 1 AND 64
    ) THEN RAISE(ABORT, 'lore retrieval keyword is invalid')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.entity_refs_json) AS entity
      WHERE entity.type <> 'object'
        OR json_type(entity.value, '$.kind') <> 'text'
        OR json_extract(entity.value, '$.kind') NOT IN (
          'NPC', 'PLAYER_CHARACTER', 'FACTION', 'ITEM', 'WORLD_FACT'
        )
        OR json_type(entity.value, '$.id') <> 'text'
        OR length(trim(json_extract(entity.value, '$.id'))) NOT BETWEEN 1 AND 256
        OR (SELECT count(*) FROM json_each(entity.value)) <> 2
    ) THEN RAISE(ABORT, 'lore retrieval entity ref is invalid')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.entity_refs_json) AS entity
      WHERE CASE json_extract(entity.value, '$.kind')
        WHEN 'NPC' THEN NOT EXISTS (
          SELECT 1 FROM npcs
          WHERE id = json_extract(entity.value, '$.id') AND campaign_id = NEW.campaign_id
        )
        WHEN 'PLAYER_CHARACTER' THEN NOT EXISTS (
          SELECT 1 FROM player_characters
          WHERE id = json_extract(entity.value, '$.id') AND campaign_id = NEW.campaign_id
        )
        WHEN 'FACTION' THEN NOT EXISTS (
          SELECT 1 FROM active_factions
          WHERE id = json_extract(entity.value, '$.id') AND campaign_id = NEW.campaign_id
        )
        WHEN 'ITEM' THEN NOT EXISTS (
          SELECT 1 FROM items
          WHERE id = json_extract(entity.value, '$.id') AND campaign_id = NEW.campaign_id
        )
        WHEN 'WORLD_FACT' THEN NOT EXISTS (
          SELECT 1 FROM world_facts
          WHERE id = json_extract(entity.value, '$.id') AND campaign_id = NEW.campaign_id
        )
        ELSE 1
      END
    ) THEN RAISE(ABORT, 'lore retrieval entity belongs to another campaign')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.location_ids_json)
      WHERE type <> 'text' OR length(trim(value)) NOT BETWEEN 1 AND 256
    ) THEN RAISE(ABORT, 'lore retrieval location ID is invalid')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.location_ids_json) AS location
      WHERE NOT EXISTS (
        SELECT 1 FROM dynamic_locations
        WHERE id = location.value AND campaign_id = NEW.campaign_id
        UNION SELECT 1 FROM taverns
        WHERE location_id = location.value AND campaign_id = NEW.campaign_id
        UNION SELECT 1 FROM world_facts
        WHERE location_id = location.value AND campaign_id = NEW.campaign_id
      )
    ) THEN RAISE(ABORT, 'lore retrieval location belongs to another campaign')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.quest_ids_json)
      WHERE type <> 'text' OR length(trim(value)) NOT BETWEEN 1 AND 256
    ) THEN RAISE(ABORT, 'lore retrieval Quest ID is invalid')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.quest_ids_json) AS quest
      WHERE NOT EXISTS (
        SELECT 1 FROM quests
        WHERE id = quest.value AND campaign_id = NEW.campaign_id
      )
    ) THEN RAISE(ABORT, 'lore retrieval Quest belongs to another campaign')
  END;
END;
