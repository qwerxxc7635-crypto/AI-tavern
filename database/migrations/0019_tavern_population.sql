CREATE UNIQUE INDEX idx_taverns_identity_campaign
  ON taverns (id,campaign_id);

CREATE TABLE tavern_population_states (
  tavern_id TEXT PRIMARY KEY REFERENCES taverns (id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  last_trigger TEXT NOT NULL CHECK (last_trigger IN (
    'ENTERED','TIME_ADVANCED','EVENT_COMMITTED','ADVENTURE_RETURNED','MANUAL_REFRESH'
  )),
  context_json TEXT NOT NULL CHECK (
    json_valid(context_json) AND json_type(context_json)='object' AND length(context_json)<=524288
  ),
  opportunities_json TEXT NOT NULL CHECK (
    json_valid(opportunities_json) AND json_type(opportunities_json)='array' AND length(opportunities_json)<=524288
  ),
  empty_state INTEGER NOT NULL CHECK (empty_state IN (0,1)),
  projected_at TEXT NOT NULL,
  UNIQUE (tavern_id,campaign_id),
  CHECK (json_extract(context_json,'$.campaignId')=campaign_id),
  CHECK (json_extract(context_json,'$.tavernId')=tavern_id)
);

CREATE TABLE tavern_population_members (
  tavern_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  npc_id TEXT NOT NULL REFERENCES npc_lod_profiles (id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'OWNER','ESTABLISHED','LOCATION','CLOCK','FACTION','EVENT'
  )),
  source_id TEXT NOT NULL CHECK (length(trim(source_id)) BETWEEN 1 AND 200),
  population_role TEXT NOT NULL CHECK (length(trim(population_role)) BETWEEN 1 AND 200),
  presence TEXT NOT NULL CHECK (presence IN ('PRESENT','ABSENT')),
  is_important INTEGER NOT NULL CHECK (is_important IN (0,1)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  encounter_count INTEGER NOT NULL CHECK (encounter_count >= 1),
  PRIMARY KEY (tavern_id,npc_id),
  UNIQUE (tavern_id,source_kind,source_id),
  FOREIGN KEY (tavern_id,campaign_id)
    REFERENCES taverns (id,campaign_id) ON DELETE CASCADE,
  CHECK (last_seen_at >= first_seen_at),
  CHECK (
    (source_kind IN ('OWNER','ESTABLISHED') AND source_id=npc_id)
    OR source_kind NOT IN ('OWNER','ESTABLISHED')
  )
);

CREATE INDEX idx_tavern_population_members_presence
  ON tavern_population_members (tavern_id,presence,is_important,source_kind,npc_id);

CREATE TABLE tavern_population_cycles (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  tavern_id TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN (
    'ENTERED','TIME_ADVANCED','EVENT_COMMITTED','ADVENTURE_RETURNED','MANUAL_REFRESH'
  )),
  before_revision INTEGER NOT NULL CHECK (before_revision >= 0),
  after_revision INTEGER NOT NULL CHECK (after_revision=before_revision+1),
  context_json TEXT NOT NULL CHECK (json_valid(context_json) AND json_type(context_json)='object'),
  present_npc_ids_json TEXT NOT NULL CHECK (
    json_valid(present_npc_ids_json) AND json_type(present_npc_ids_json)='array'
  ),
  opportunity_ids_json TEXT NOT NULL CHECK (
    json_valid(opportunity_ids_json) AND json_type(opportunity_ids_json)='array'
  ),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (tavern_id,campaign_id)
    REFERENCES taverns (id,campaign_id) ON DELETE CASCADE
);

CREATE INDEX idx_tavern_population_cycles_history
  ON tavern_population_cycles (campaign_id,tavern_id,occurred_at,id);

CREATE TABLE tavern_population_focus_events (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  tavern_id TEXT NOT NULL,
  npc_id TEXT NOT NULL REFERENCES npc_lod_profiles (id) ON DELETE RESTRICT,
  before_revision INTEGER NOT NULL CHECK (before_revision >= 1),
  after_revision INTEGER NOT NULL CHECK (after_revision=before_revision+1),
  npc_lod INTEGER NOT NULL CHECK (npc_lod BETWEEN 1 AND 3),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (tavern_id,campaign_id)
    REFERENCES taverns (id,campaign_id) ON DELETE CASCADE,
  FOREIGN KEY (tavern_id,npc_id)
    REFERENCES tavern_population_members (tavern_id,npc_id) ON DELETE RESTRICT
);

CREATE INDEX idx_tavern_population_focus_history
  ON tavern_population_focus_events (campaign_id,tavern_id,npc_id,occurred_at,id);

CREATE TRIGGER tavern_population_state_insert_guard
BEFORE INSERT ON tavern_population_states
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM taverns WHERE id=NEW.tavern_id AND campaign_id=NEW.campaign_id
  ) THEN RAISE(ABORT,'tavern population state requires its campaign tavern') END;
END;

CREATE TRIGGER tavern_population_state_update_guard
BEFORE UPDATE ON tavern_population_states
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.tavern_id<>OLD.tavern_id OR NEW.campaign_id<>OLD.campaign_id
      THEN RAISE(ABORT,'tavern population state identity is immutable')
    WHEN NEW.revision<>OLD.revision+1
      THEN RAISE(ABORT,'tavern population revision must increase by one')
  END;
END;

CREATE TRIGGER tavern_population_member_insert_guard
BEFORE INSERT ON tavern_population_members
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM npc_lod_profiles
      WHERE id=NEW.npc_id AND campaign_id=NEW.campaign_id
        AND json_extract(profile_json,'$.populationRole')=NEW.population_role
    ) THEN RAISE(ABORT,'tavern population member requires a matching NPC identity')
    WHEN NEW.source_kind IN ('OWNER','ESTABLISHED') AND NOT EXISTS (
      SELECT 1 FROM npcs
      WHERE id=NEW.npc_id AND campaign_id=NEW.campaign_id AND tavern_id=NEW.tavern_id
    ) THEN RAISE(ABORT,'established population source is not a tavern NPC')
    WHEN NEW.source_kind='OWNER' AND NOT EXISTS (
      SELECT 1 FROM taverns WHERE id=NEW.tavern_id AND owner_npc_id=NEW.npc_id
    ) THEN RAISE(ABORT,'owner population source is not the tavern owner')
    WHEN NEW.source_kind='LOCATION' AND NOT EXISTS (
      SELECT 1 FROM dynamic_locations WHERE id=NEW.source_id AND campaign_id=NEW.campaign_id
    ) THEN RAISE(ABORT,'location population source is outside the campaign')
    WHEN NEW.source_kind='CLOCK' AND NOT EXISTS (
      SELECT 1 FROM world_clocks WHERE id=NEW.source_id AND campaign_id=NEW.campaign_id
    ) THEN RAISE(ABORT,'clock population source is outside the campaign')
    WHEN NEW.source_kind='FACTION' AND NOT EXISTS (
      SELECT 1 FROM active_factions WHERE id=NEW.source_id AND campaign_id=NEW.campaign_id
    ) THEN RAISE(ABORT,'faction population source is outside the campaign')
    WHEN NEW.source_kind='EVENT' AND NOT EXISTS (
      SELECT 1 FROM game_events WHERE id=NEW.source_id AND campaign_id=NEW.campaign_id
    ) THEN RAISE(ABORT,'event population source is outside the campaign')
  END;
END;

CREATE TRIGGER tavern_population_member_update_guard
BEFORE UPDATE ON tavern_population_members
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.tavern_id<>OLD.tavern_id OR NEW.campaign_id<>OLD.campaign_id
      OR NEW.npc_id<>OLD.npc_id OR NEW.source_kind<>OLD.source_kind
      OR NEW.source_id<>OLD.source_id OR NEW.population_role<>OLD.population_role
      OR NEW.first_seen_at<>OLD.first_seen_at
      THEN RAISE(ABORT,'tavern population member identity is immutable')
    WHEN NEW.encounter_count<OLD.encounter_count
      OR (OLD.is_important=1 AND NEW.is_important<>1)
      OR NEW.last_seen_at<OLD.last_seen_at
      THEN RAISE(ABORT,'tavern population history cannot move backward')
  END;
END;

CREATE TRIGGER tavern_population_state_delete_guard
BEFORE DELETE ON tavern_population_states
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM campaigns WHERE id=OLD.campaign_id)
BEGIN SELECT RAISE(ABORT,'tavern population state is retained'); END;

CREATE TRIGGER tavern_population_member_delete_guard
BEFORE DELETE ON tavern_population_members
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM campaigns WHERE id=OLD.campaign_id)
BEGIN SELECT RAISE(ABORT,'tavern population identity is retained'); END;

CREATE TRIGGER tavern_population_cycle_update_guard
BEFORE UPDATE ON tavern_population_cycles
FOR EACH ROW BEGIN SELECT RAISE(ABORT,'tavern population cycles are append-only'); END;

CREATE TRIGGER tavern_population_cycle_delete_guard
BEFORE DELETE ON tavern_population_cycles
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM campaigns WHERE id=OLD.campaign_id)
BEGIN SELECT RAISE(ABORT,'tavern population cycles are append-only'); END;

CREATE TRIGGER tavern_population_focus_update_guard
BEFORE UPDATE ON tavern_population_focus_events
FOR EACH ROW BEGIN SELECT RAISE(ABORT,'tavern population focus history is append-only'); END;

CREATE TRIGGER tavern_population_focus_delete_guard
BEFORE DELETE ON tavern_population_focus_events
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM campaigns WHERE id=OLD.campaign_id)
BEGIN SELECT RAISE(ABORT,'tavern population focus history is append-only'); END;
