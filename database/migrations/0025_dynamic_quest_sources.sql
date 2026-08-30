CREATE TABLE quest_pool_creation_intents (
  quest_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN (
    'HIDDEN','DISCOVERED','AVAILABLE','ACCEPTED','ACTIVE','BLOCKED','UPDATED',
    'COMPLETED','FAILED','EXPIRED','ABANDONED'
  )),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 4000),
  operation_id TEXT NOT NULL UNIQUE CHECK (length(trim(operation_id)) BETWEEN 1 AND 240),
  created_at TEXT NOT NULL
);

DROP TRIGGER quest_pool_after_quest_insert;

CREATE TRIGGER quest_pool_after_quest_insert
AFTER INSERT ON quests
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM quest_pool_restore_sessions WHERE campaign_id=NEW.campaign_id
)
BEGIN
  INSERT INTO quest_pool_states (
    quest_id,campaign_id,status,revision,last_source,last_reason,last_operation_id,created_at,updated_at
  ) VALUES (
    NEW.id,NEW.campaign_id,
    COALESCE((SELECT status FROM quest_pool_creation_intents WHERE quest_id=NEW.id),NEW.status),
    1,
    CASE WHEN EXISTS (SELECT 1 FROM quest_pool_creation_intents WHERE quest_id=NEW.id)
      THEN 'LOCAL_RULE' ELSE 'INITIALIZATION' END,
    COALESCE((SELECT reason FROM quest_pool_creation_intents WHERE quest_id=NEW.id),
      'Initialized with the quest.'),
    COALESCE((SELECT operation_id FROM quest_pool_creation_intents WHERE quest_id=NEW.id),
      'quest:initialize:' || NEW.id),
    NEW.created_at,NEW.updated_at
  );
  INSERT INTO quest_pool_transitions (
    operation_id,quest_id,campaign_id,from_status,to_status,source,reason,
    before_revision,after_revision,occurred_at
  ) VALUES (
    COALESCE((SELECT operation_id FROM quest_pool_creation_intents WHERE quest_id=NEW.id),
      'quest:initialize:' || NEW.id),
    NEW.id,NEW.campaign_id,NULL,
    COALESCE((SELECT status FROM quest_pool_creation_intents WHERE quest_id=NEW.id),NEW.status),
    CASE WHEN EXISTS (SELECT 1 FROM quest_pool_creation_intents WHERE quest_id=NEW.id)
      THEN 'LOCAL_RULE' ELSE 'INITIALIZATION' END,
    COALESCE((SELECT reason FROM quest_pool_creation_intents WHERE quest_id=NEW.id),
      'Initialized with the quest.'),
    0,1,NEW.updated_at
  );
  DELETE FROM quest_pool_creation_intents WHERE quest_id=NEW.id;
END;

CREATE TABLE dynamic_quest_sources (
  quest_id TEXT PRIMARY KEY REFERENCES quests(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'NPC','FACTION','WORLD_EVENT','DISCOVERY','PLAYER_ACTION','CONSEQUENCE'
  )),
  occurrence_id TEXT NOT NULL CHECK (length(trim(occurrence_id)) BETWEEN 1 AND 200),
  entity_kind TEXT NOT NULL CHECK (entity_kind IN (
    'NPC','FACTION','GAME_EVENT','WORLD_FACT','PLAYER_ACTION','QUEST_GRAPH'
  )),
  entity_id TEXT NOT NULL CHECK (length(trim(entity_id)) BETWEEN 1 AND 200),
  actor_npc_id TEXT REFERENCES npcs(id) ON DELETE RESTRICT,
  visibility TEXT NOT NULL CHECK (visibility IN ('PLAYER_VISIBLE','HIDDEN')),
  player_intervened INTEGER NOT NULL CHECK (player_intervened IN (0,1)),
  source_summary TEXT NOT NULL CHECK (length(trim(source_summary)) BETWEEN 1 AND 4000),
  source_snapshot_json TEXT NOT NULL CHECK (
    json_valid(source_snapshot_json) AND json_type(source_snapshot_json)='object'
  ),
  relevant_fact_ids_json TEXT NOT NULL CHECK (
    json_valid(relevant_fact_ids_json) AND json_type(relevant_fact_ids_json)='array'
  ),
  context_digest TEXT NOT NULL CHECK (length(context_digest)=64),
  generation_record_id TEXT NOT NULL UNIQUE REFERENCES generation_records(id) ON DELETE RESTRICT,
  budget_json TEXT NOT NULL CHECK (json_valid(budget_json) AND json_type(budget_json)='object'),
  created_at TEXT NOT NULL,
  UNIQUE(campaign_id,source_kind,occurrence_id),
  UNIQUE(quest_id,campaign_id),
  CHECK ((source_kind='PLAYER_ACTION')=player_intervened),
  CHECK ((source_kind='NPC')=(actor_npc_id IS NOT NULL)),
  CHECK (
    (source_kind='NPC' AND entity_kind='NPC') OR
    (source_kind='FACTION' AND entity_kind='FACTION') OR
    (source_kind='WORLD_EVENT' AND entity_kind='GAME_EVENT') OR
    (source_kind='DISCOVERY' AND entity_kind='WORLD_FACT') OR
    (source_kind='PLAYER_ACTION' AND entity_kind='PLAYER_ACTION') OR
    (source_kind='CONSEQUENCE' AND entity_kind='QUEST_GRAPH')
  )
);

CREATE INDEX idx_dynamic_quest_source_campaign
  ON dynamic_quest_sources(campaign_id,source_kind,created_at,quest_id);

CREATE TRIGGER dynamic_quest_source_reference_guard
BEFORE INSERT ON dynamic_quest_sources
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM quests WHERE id=NEW.quest_id AND campaign_id=NEW.campaign_id
    ) THEN RAISE(ABORT,'dynamic quest target is not in the campaign')
    WHEN NOT EXISTS (
      SELECT 1 FROM generation_records
      WHERE id=NEW.generation_record_id AND campaign_id=NEW.campaign_id
        AND task='GENERATE_QUEST' AND validated_output_json IS NOT NULL
    ) THEN RAISE(ABORT,'dynamic quest generation provenance is invalid')
    WHEN NEW.actor_npc_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM npcs WHERE id=NEW.actor_npc_id AND campaign_id=NEW.campaign_id
    ) THEN RAISE(ABORT,'dynamic quest actor is not in the campaign')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.relevant_fact_ids_json) fact
      WHERE NOT EXISTS (
        SELECT 1 FROM world_facts WHERE id=fact.value AND campaign_id=NEW.campaign_id
      )
    ) THEN RAISE(ABORT,'dynamic quest fact is not in the campaign')
    WHEN NEW.source_kind='NPC' AND NOT EXISTS (
      SELECT 1 FROM npc_timeline_operations
      WHERE id=NEW.occurrence_id AND campaign_id=NEW.campaign_id
        AND scope_kind='NPC_DIALOGUE' AND scope_id=NEW.entity_id AND status='COMMITTED'
    ) THEN RAISE(ABORT,'dynamic NPC source occurrence is invalid')
    WHEN NEW.source_kind='FACTION' AND NOT EXISTS (
      SELECT 1 FROM faction_action_events
      WHERE id=NEW.occurrence_id AND campaign_id=NEW.campaign_id
        AND faction_id=NEW.entity_id
    ) THEN RAISE(ABORT,'dynamic Faction source occurrence is invalid')
    WHEN NEW.source_kind='WORLD_EVENT' AND NOT EXISTS (
      SELECT 1 FROM game_events
      WHERE id=NEW.occurrence_id AND campaign_id=NEW.campaign_id
        AND type IN ('WORLD_CLOCK_ADVANCED','ADVENTURE_COMPLETED')
    ) THEN RAISE(ABORT,'dynamic World Event source occurrence is invalid')
    WHEN NEW.source_kind='DISCOVERY' AND NOT EXISTS (
      SELECT 1 FROM game_events
      WHERE id=NEW.occurrence_id AND campaign_id=NEW.campaign_id
        AND type='FACT_DISCOVERED'
        AND json_extract(payload_json,'$.worldFactId')=NEW.entity_id
    ) THEN RAISE(ABORT,'dynamic Discovery source occurrence is invalid')
    WHEN NEW.source_kind='PLAYER_ACTION' AND NOT EXISTS (
      SELECT 1 FROM game_events
      WHERE id=NEW.occurrence_id AND campaign_id=NEW.campaign_id
        AND type='PLAYER_ACTION_SUBMITTED'
    ) THEN RAISE(ABORT,'dynamic Player Action source occurrence is invalid')
    WHEN NEW.source_kind='CONSEQUENCE' AND NOT EXISTS (
      SELECT 1 FROM quest_graph_evaluations
      WHERE operation_id=NEW.occurrence_id AND campaign_id=NEW.campaign_id
        AND json_array_length(changes_json)>0
    ) THEN RAISE(ABORT,'dynamic Consequence source occurrence is invalid')
  END;
END;

CREATE TRIGGER dynamic_quest_source_update_guard
BEFORE UPDATE ON dynamic_quest_sources
BEGIN
  SELECT RAISE(ABORT,'dynamic quest provenance is append-only');
END;

CREATE TRIGGER dynamic_quest_source_delete_guard
BEFORE DELETE ON dynamic_quest_sources
WHEN EXISTS (SELECT 1 FROM campaigns WHERE id=OLD.campaign_id)
  AND NOT EXISTS (
    SELECT 1 FROM quest_pool_restore_sessions WHERE campaign_id=OLD.campaign_id
  )
BEGIN
  SELECT RAISE(ABORT,'dynamic quest provenance is append-only');
END;
