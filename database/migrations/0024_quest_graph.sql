CREATE TABLE quest_graphs (
  campaign_id TEXT PRIMARY KEY REFERENCES campaigns (id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at TEXT NOT NULL
);

CREATE TABLE quest_graph_edges (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES quest_graphs (campaign_id) ON DELETE CASCADE,
  edge_kind TEXT NOT NULL CHECK (edge_kind IN ('PREREQUISITE','CONSEQUENCE')),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('QUEST','WORLD_FACT','NPC','FACTION','LOCATION')),
  source_id TEXT NOT NULL,
  predicate TEXT NOT NULL CHECK (predicate IN (
    'STATUS_EQUALS','EXISTS','MATERIALIZATION_EQUALS','PLAYER_RELATION_EQUALS'
  )),
  expected_value TEXT NOT NULL CHECK (length(trim(expected_value)) BETWEEN 1 AND 120),
  target_quest_id TEXT NOT NULL REFERENCES quests (id) ON DELETE CASCADE,
  satisfied_status TEXT NOT NULL CHECK (satisfied_status IN (
    'HIDDEN','DISCOVERED','AVAILABLE','ACCEPTED','ACTIVE','BLOCKED','UPDATED',
    'COMPLETED','FAILED','EXPIRED','ABANDONED'
  )),
  unsatisfied_status TEXT CHECK (unsatisfied_status IS NULL OR unsatisfied_status IN (
    'HIDDEN','DISCOVERED','AVAILABLE','ACCEPTED','ACTIVE','BLOCKED','UPDATED',
    'COMPLETED','FAILED','EXPIRED','ABANDONED'
  )),
  priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 1000),
  created_at TEXT NOT NULL,
  UNIQUE (
    campaign_id,edge_kind,source_kind,source_id,predicate,expected_value,target_quest_id
  ),
  CHECK (edge_kind='PREREQUISITE' OR unsatisfied_status IS NULL),
  CHECK (
    (source_kind='QUEST' AND predicate='STATUS_EQUALS' AND expected_value IN (
      'HIDDEN','DISCOVERED','AVAILABLE','ACCEPTED','ACTIVE','BLOCKED','UPDATED',
      'COMPLETED','FAILED','EXPIRED','ABANDONED'
    )) OR
    (source_kind='WORLD_FACT' AND predicate='EXISTS' AND expected_value='TRUE') OR
    (source_kind='NPC' AND predicate='STATUS_EQUALS') OR
    (source_kind='FACTION' AND predicate='MATERIALIZATION_EQUALS' AND expected_value IN ('OUTLINE','ACTIVE')) OR
    (source_kind='FACTION' AND predicate='PLAYER_RELATION_EQUALS' AND expected_value IN (
      'HOSTILE','WARY','NEUTRAL','FRIENDLY','ALLIED','UNKNOWN'
    )) OR
    (source_kind='LOCATION' AND predicate='MATERIALIZATION_EQUALS' AND expected_value IN ('OUTLINE','DETAILED'))
  )
);

CREATE INDEX idx_quest_graph_edges_target
  ON quest_graph_edges (campaign_id,target_quest_id,priority DESC,id);
CREATE INDEX idx_quest_graph_edges_source
  ON quest_graph_edges (campaign_id,source_kind,source_id);

CREATE TABLE quest_graph_revisions (
  operation_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES quest_graphs (campaign_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  edges_json TEXT NOT NULL CHECK (json_valid(edges_json) AND json_type(edges_json)='array'),
  occurred_at TEXT NOT NULL,
  UNIQUE (campaign_id,revision)
);

CREATE TABLE quest_graph_evaluations (
  operation_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES quest_graphs (campaign_id) ON DELETE CASCADE,
  graph_revision INTEGER NOT NULL CHECK (graph_revision >= 1),
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN (
    'GRAPH_CHANGED','QUEST_TRANSITION','WORLD_FACT_CHANGE','NPC_CHANGE','FACTION_CHANGE',
    'LOCATION_CHANGE','MANUAL_REEVALUATION'
  )),
  trigger_id TEXT NOT NULL CHECK (length(trim(trigger_id)) BETWEEN 1 AND 200),
  evaluated_edge_ids_json TEXT NOT NULL CHECK (
    json_valid(evaluated_edge_ids_json) AND json_type(evaluated_edge_ids_json)='array'
  ),
  changes_json TEXT NOT NULL CHECK (json_valid(changes_json) AND json_type(changes_json)='array'),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id,graph_revision)
    REFERENCES quest_graph_revisions (campaign_id,revision)
);

CREATE INDEX idx_quest_graph_evaluations_campaign
  ON quest_graph_evaluations (campaign_id,occurred_at,operation_id);

CREATE TRIGGER quest_graph_after_campaign_insert
AFTER INSERT ON campaigns
FOR EACH ROW
BEGIN
  INSERT INTO quest_graphs (campaign_id,revision,updated_at)
  VALUES (NEW.id,1,NEW.created_at);
  INSERT INTO quest_graph_revisions (operation_id,campaign_id,revision,edges_json,occurred_at)
  VALUES ('quest-graph:initialize:' || NEW.id,NEW.id,1,'[]',NEW.created_at);
END;

INSERT INTO quest_graphs (campaign_id,revision,updated_at)
SELECT id,1,updated_at FROM campaigns;

INSERT INTO quest_graph_revisions (operation_id,campaign_id,revision,edges_json,occurred_at)
SELECT 'quest-graph:migration:' || id,id,1,'[]',updated_at FROM campaigns;

CREATE TRIGGER quest_graph_edge_reference_guard
BEFORE INSERT ON quest_graph_edges
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM quests WHERE id=NEW.target_quest_id AND campaign_id=NEW.campaign_id
  ) THEN RAISE(ABORT,'quest graph target must belong to the campaign') END;
  SELECT CASE
    WHEN NEW.source_kind='QUEST' AND NOT EXISTS (
      SELECT 1 FROM quests WHERE id=NEW.source_id AND campaign_id=NEW.campaign_id
    ) THEN RAISE(ABORT,'quest graph source quest is missing')
    WHEN NEW.source_kind='WORLD_FACT' AND NOT EXISTS (
      SELECT 1 FROM world_facts WHERE id=NEW.source_id AND campaign_id=NEW.campaign_id
    ) THEN RAISE(ABORT,'quest graph source fact is missing')
    WHEN NEW.source_kind='NPC' AND NOT EXISTS (
      SELECT 1 FROM npcs WHERE id=NEW.source_id AND campaign_id=NEW.campaign_id
    ) THEN RAISE(ABORT,'quest graph source npc is missing')
    WHEN NEW.source_kind='FACTION' AND NOT EXISTS (
      SELECT 1 FROM active_factions WHERE id=NEW.source_id AND campaign_id=NEW.campaign_id
    ) THEN RAISE(ABORT,'quest graph source faction is missing')
    WHEN NEW.source_kind='LOCATION' AND NOT EXISTS (
      SELECT 1 FROM dynamic_locations WHERE id=NEW.source_id AND campaign_id=NEW.campaign_id
    ) THEN RAISE(ABORT,'quest graph source location is missing')
  END;
END;

CREATE TRIGGER quest_graph_edge_cycle_guard
BEFORE INSERT ON quest_graph_edges
FOR EACH ROW
WHEN NEW.source_kind='QUEST'
BEGIN
  SELECT CASE WHEN NEW.source_id=NEW.target_quest_id OR EXISTS (
    WITH RECURSIVE descendants(quest_id) AS (
      SELECT target_quest_id FROM quest_graph_edges
      WHERE campaign_id=NEW.campaign_id AND source_kind='QUEST'
        AND source_id=NEW.target_quest_id
      UNION
      SELECT edge.target_quest_id
      FROM quest_graph_edges edge JOIN descendants
        ON edge.source_id=descendants.quest_id
      WHERE edge.campaign_id=NEW.campaign_id AND edge.source_kind='QUEST'
    )
    SELECT 1 FROM descendants WHERE quest_id=NEW.source_id
  ) THEN RAISE(ABORT,'quest graph cycle detected') END;
END;

CREATE TRIGGER quest_graph_revision_guard
BEFORE UPDATE ON quest_graphs
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.campaign_id<>OLD.campaign_id THEN RAISE(ABORT,'quest graph identity is immutable')
    WHEN NEW.revision<>OLD.revision+1 THEN RAISE(ABORT,'quest graph revision must increase by one')
  END;
END;

CREATE TRIGGER quest_graph_revision_history_update_guard
BEFORE UPDATE ON quest_graph_revisions
BEGIN
  SELECT RAISE(ABORT,'quest graph revision history is append-only');
END;

CREATE TRIGGER quest_graph_revision_history_delete_guard
BEFORE DELETE ON quest_graph_revisions
WHEN EXISTS (SELECT 1 FROM campaigns WHERE id=OLD.campaign_id)
  AND NOT EXISTS (
    SELECT 1 FROM quest_pool_restore_sessions WHERE campaign_id=OLD.campaign_id
  )
BEGIN
  SELECT RAISE(ABORT,'quest graph revision history is append-only');
END;

CREATE TRIGGER quest_graph_evaluation_update_guard
BEFORE UPDATE ON quest_graph_evaluations
BEGIN
  SELECT RAISE(ABORT,'quest graph evaluations are append-only');
END;

CREATE TRIGGER quest_graph_evaluation_delete_guard
BEFORE DELETE ON quest_graph_evaluations
WHEN EXISTS (SELECT 1 FROM campaigns WHERE id=OLD.campaign_id)
  AND NOT EXISTS (
    SELECT 1 FROM quest_pool_restore_sessions WHERE campaign_id=OLD.campaign_id
  )
BEGIN
  SELECT RAISE(ABORT,'quest graph evaluations are append-only');
END;
