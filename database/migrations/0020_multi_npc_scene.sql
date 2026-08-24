CREATE TABLE tavern_scenes (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  tavern_id TEXT NOT NULL REFERENCES taverns(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (campaign_id,tavern_id,id)
);

CREATE UNIQUE INDEX idx_tavern_scenes_one_active
  ON tavern_scenes(tavern_id) WHERE status='ACTIVE';

CREATE TABLE tavern_scene_participants (
  scene_id TEXT NOT NULL REFERENCES tavern_scenes(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  npc_id TEXT NOT NULL REFERENCES npc_lod_profiles(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  population_role TEXT NOT NULL CHECK (length(trim(population_role)) BETWEEN 1 AND 200),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','LISTENING','LEFT')),
  joined_at TEXT NOT NULL,
  left_at TEXT,
  PRIMARY KEY(scene_id,npc_id),
  CHECK ((status='LEFT')=(left_at IS NOT NULL))
);

CREATE TABLE tavern_scene_turns (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  scene_id TEXT NOT NULL REFERENCES tavern_scenes(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  before_revision INTEGER NOT NULL CHECK (before_revision >= 1),
  after_revision INTEGER NOT NULL CHECK (after_revision=before_revision+1),
  player_intent TEXT NOT NULL CHECK (length(trim(player_intent)) BETWEEN 1 AND 4000),
  addressed_npc_id TEXT,
  actions_json TEXT NOT NULL CHECK (json_valid(actions_json) AND json_type(actions_json)='array'),
  occurred_at TEXT NOT NULL,
  UNIQUE(scene_id,sequence)
);

CREATE TABLE tavern_scene_actor_proposals (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL REFERENCES tavern_scenes(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL REFERENCES tavern_scene_turns(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  actor_npc_id TEXT NOT NULL REFERENCES npc_lod_profiles(id) ON DELETE RESTRICT,
  generation_record_id TEXT NOT NULL REFERENCES generation_records(id) ON DELETE RESTRICT,
  context_digest TEXT NOT NULL CHECK (length(trim(context_digest)) > 0),
  authorized_knowledge_ids_json TEXT NOT NULL CHECK (
    json_valid(authorized_knowledge_ids_json) AND json_type(authorized_knowledge_ids_json)='array'
  ),
  proposal_json TEXT NOT NULL CHECK (json_valid(proposal_json) AND json_type(proposal_json)='object'),
  selected INTEGER NOT NULL CHECK (selected IN (0,1)),
  created_at TEXT NOT NULL,
  UNIQUE(turn_id,actor_npc_id)
);

CREATE INDEX idx_tavern_scene_turn_history ON tavern_scene_turns(scene_id,sequence);
CREATE INDEX idx_tavern_scene_participant_status ON tavern_scene_participants(scene_id,status,npc_id);

CREATE TRIGGER tavern_scene_participant_insert_guard
BEFORE INSERT ON tavern_scene_participants FOR EACH ROW BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tavern_scenes scene
    JOIN tavern_population_members member ON member.tavern_id=scene.tavern_id
      AND member.campaign_id=scene.campaign_id AND member.npc_id=NEW.npc_id
    JOIN npc_lod_profiles profile ON profile.id=member.npc_id
    WHERE scene.id=NEW.scene_id AND scene.campaign_id=NEW.campaign_id
      AND member.presence='PRESENT' AND profile.lod>=1
  ) THEN RAISE(ABORT,'scene participant must be a focused present population member') END;
END;

CREATE TRIGGER tavern_scene_participant_update_guard
BEFORE UPDATE ON tavern_scene_participants FOR EACH ROW BEGIN
  SELECT CASE
    WHEN NEW.scene_id<>OLD.scene_id OR NEW.campaign_id<>OLD.campaign_id
      OR NEW.npc_id<>OLD.npc_id OR NEW.name<>OLD.name OR NEW.population_role<>OLD.population_role
      OR NEW.joined_at<>OLD.joined_at THEN RAISE(ABORT,'scene participant identity is immutable')
    WHEN OLD.status='LEFT' THEN RAISE(ABORT,'a departed participant cannot return')
  END;
END;

CREATE TRIGGER tavern_scene_turn_update_guard BEFORE UPDATE ON tavern_scene_turns
FOR EACH ROW BEGIN SELECT RAISE(ABORT,'scene turns are append-only'); END;
CREATE TRIGGER tavern_scene_proposal_update_guard BEFORE UPDATE ON tavern_scene_actor_proposals
FOR EACH ROW BEGIN SELECT RAISE(ABORT,'scene proposals are append-only'); END;
