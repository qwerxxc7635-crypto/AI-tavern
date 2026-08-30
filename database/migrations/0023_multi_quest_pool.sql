CREATE TABLE quest_pool_states (
  quest_id TEXT PRIMARY KEY REFERENCES quests (id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN (
    'HIDDEN','DISCOVERED','AVAILABLE','ACCEPTED','ACTIVE','BLOCKED','UPDATED',
    'COMPLETED','FAILED','EXPIRED','ABANDONED'
  )),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  last_source TEXT NOT NULL CHECK (last_source IN (
    'INITIALIZATION','MIGRATION','GENERATION','PLAYER_INTERVENTION','PLAYER',
    'LOCAL_RULE','SYSTEM','ADVENTURE','FACTION','LEGACY'
  )),
  last_reason TEXT NOT NULL CHECK (length(trim(last_reason)) BETWEEN 1 AND 4000),
  last_operation_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (quest_id, campaign_id)
);

CREATE INDEX idx_quest_pool_campaign_status
  ON quest_pool_states (campaign_id, status, updated_at, quest_id);

CREATE TABLE quest_pool_transitions (
  operation_id TEXT PRIMARY KEY,
  quest_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  from_status TEXT CHECK (from_status IS NULL OR from_status IN (
    'HIDDEN','DISCOVERED','AVAILABLE','ACCEPTED','ACTIVE','BLOCKED','UPDATED',
    'COMPLETED','FAILED','EXPIRED','ABANDONED'
  )),
  to_status TEXT NOT NULL CHECK (to_status IN (
    'HIDDEN','DISCOVERED','AVAILABLE','ACCEPTED','ACTIVE','BLOCKED','UPDATED',
    'COMPLETED','FAILED','EXPIRED','ABANDONED'
  )),
  source TEXT NOT NULL CHECK (source IN (
    'INITIALIZATION','MIGRATION','GENERATION','PLAYER_INTERVENTION','PLAYER',
    'LOCAL_RULE','SYSTEM','ADVENTURE','FACTION','LEGACY'
  )),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 4000),
  before_revision INTEGER NOT NULL CHECK (before_revision >= 0),
  after_revision INTEGER NOT NULL CHECK (after_revision = before_revision + 1),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (quest_id, campaign_id)
    REFERENCES quest_pool_states (quest_id, campaign_id) ON DELETE CASCADE,
  CHECK ((before_revision = 0) = (from_status IS NULL))
);

CREATE INDEX idx_quest_pool_transition_history
  ON quest_pool_transitions (campaign_id, quest_id, after_revision);

CREATE TABLE quest_pool_restore_sessions (
  campaign_id TEXT PRIMARY KEY REFERENCES campaigns (id) ON DELETE CASCADE
);

INSERT INTO quest_pool_states (
  quest_id,campaign_id,status,revision,last_source,last_reason,last_operation_id,created_at,updated_at
)
SELECT
  id,campaign_id,status,1,'MIGRATION','Backfilled from the legacy quest status.',
  'quest:migration:' || id,created_at,updated_at
FROM quests;

INSERT INTO quest_pool_transitions (
  operation_id,quest_id,campaign_id,from_status,to_status,source,reason,
  before_revision,after_revision,occurred_at
)
SELECT
  last_operation_id,quest_id,campaign_id,NULL,status,last_source,last_reason,0,1,updated_at
FROM quest_pool_states;

CREATE TRIGGER quest_pool_state_insert_guard
BEFORE INSERT ON quest_pool_states
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM quests WHERE id=NEW.quest_id AND campaign_id=NEW.campaign_id
  ) THEN RAISE(ABORT, 'quest pool state requires a quest in the same campaign') END;
END;

CREATE TRIGGER quest_pool_state_update_guard
BEFORE UPDATE ON quest_pool_states
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.quest_id<>OLD.quest_id OR NEW.campaign_id<>OLD.campaign_id
      OR NEW.created_at<>OLD.created_at
      THEN RAISE(ABORT, 'quest pool identity is immutable')
    WHEN NEW.status=OLD.status
      THEN RAISE(ABORT, 'quest pool transition must change status')
    WHEN NEW.revision<>OLD.revision+1
      THEN RAISE(ABORT, 'quest pool revision must increase by one')
    WHEN NEW.last_operation_id=OLD.last_operation_id
      THEN RAISE(ABORT, 'quest pool operation must change')
    WHEN OLD.status IN ('COMPLETED','FAILED','EXPIRED','ABANDONED')
      THEN RAISE(ABORT, 'terminal quest status is immutable')
    WHEN NOT (
      (OLD.status='HIDDEN' AND NEW.status IN ('DISCOVERED','AVAILABLE','ACTIVE','FAILED','EXPIRED')) OR
      (OLD.status='DISCOVERED' AND NEW.status IN ('AVAILABLE','ACTIVE','BLOCKED','UPDATED','FAILED','EXPIRED','ABANDONED')) OR
      (OLD.status='AVAILABLE' AND NEW.status IN ('ACCEPTED','ACTIVE','BLOCKED','UPDATED','FAILED','EXPIRED','ABANDONED')) OR
      (OLD.status='ACCEPTED' AND NEW.status IN ('ACTIVE','BLOCKED','UPDATED','FAILED','EXPIRED','ABANDONED')) OR
      (OLD.status='ACTIVE' AND NEW.status IN ('BLOCKED','UPDATED','COMPLETED','FAILED','EXPIRED','ABANDONED')) OR
      (OLD.status='BLOCKED' AND NEW.status IN ('AVAILABLE','ACTIVE','UPDATED','FAILED','EXPIRED','ABANDONED')) OR
      (OLD.status='UPDATED' AND NEW.status IN ('DISCOVERED','AVAILABLE','ACCEPTED','ACTIVE','BLOCKED','COMPLETED','FAILED','EXPIRED','ABANDONED'))
    ) THEN RAISE(ABORT, 'illegal quest pool transition')
    WHEN NEW.last_source='PLAYER_INTERVENTION' AND NOT (
      OLD.status IN ('DISCOVERED','AVAILABLE','ACCEPTED','UPDATED') AND NEW.status='ACTIVE'
    ) THEN RAISE(ABORT, 'player intervention can only activate a visible quest')
    WHEN NEW.last_source='PLAYER' AND NOT (
      OLD.status<>'HIDDEN' AND NEW.status='ABANDONED'
    ) THEN RAISE(ABORT, 'player can only abandon a visible nonterminal quest')
    WHEN NEW.last_source IN ('INITIALIZATION','MIGRATION','GENERATION')
      THEN RAISE(ABORT, 'initial sources cannot transition an existing quest')
  END;
END;

CREATE TRIGGER quest_pool_state_after_update
AFTER UPDATE ON quest_pool_states
FOR EACH ROW
BEGIN
  INSERT INTO quest_pool_transitions (
    operation_id,quest_id,campaign_id,from_status,to_status,source,reason,
    before_revision,after_revision,occurred_at
  ) VALUES (
    NEW.last_operation_id,NEW.quest_id,NEW.campaign_id,OLD.status,NEW.status,
    NEW.last_source,NEW.last_reason,OLD.revision,NEW.revision,NEW.updated_at
  );
END;

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
    NEW.id,NEW.campaign_id,NEW.status,1,'INITIALIZATION','Initialized with the quest.',
    'quest:initialize:' || NEW.id,NEW.created_at,NEW.updated_at
  );
  INSERT INTO quest_pool_transitions (
    operation_id,quest_id,campaign_id,from_status,to_status,source,reason,
    before_revision,after_revision,occurred_at
  ) VALUES (
    'quest:initialize:' || NEW.id,NEW.id,NEW.campaign_id,NULL,NEW.status,
    'INITIALIZATION','Initialized with the quest.',0,1,NEW.updated_at
  );
END;

CREATE TRIGGER quest_pool_legacy_status_stale_guard
BEFORE UPDATE OF status ON quests
FOR EACH ROW
WHEN NEW.status<>OLD.status AND (
  SELECT status FROM quest_pool_states WHERE quest_id=OLD.id
)<>OLD.status
BEGIN
  SELECT RAISE(ABORT, 'legacy quest status cannot overwrite the quest pool state');
END;

CREATE TRIGGER quest_pool_after_legacy_status_update
AFTER UPDATE OF status ON quests
FOR EACH ROW
WHEN NEW.status<>OLD.status
BEGIN
  UPDATE quest_pool_states SET
    status=NEW.status,
    revision=revision+1,
    last_source='LEGACY',
    last_reason='Synchronized from a legacy quest transition.',
    last_operation_id='quest:legacy:' || NEW.id || ':' || CAST(revision+1 AS TEXT),
    updated_at=NEW.updated_at
  WHERE quest_id=NEW.id AND campaign_id=NEW.campaign_id AND status=OLD.status;
END;

CREATE TRIGGER quest_pool_transition_update_guard
BEFORE UPDATE ON quest_pool_transitions
BEGIN
  SELECT RAISE(ABORT, 'quest pool transition history is append-only');
END;

CREATE TRIGGER quest_pool_transition_delete_guard
BEFORE DELETE ON quest_pool_transitions
WHEN EXISTS (SELECT 1 FROM campaigns WHERE id=OLD.campaign_id)
  AND NOT EXISTS (
    SELECT 1 FROM quest_pool_restore_sessions WHERE campaign_id=OLD.campaign_id
  )
BEGIN
  SELECT RAISE(ABORT, 'quest pool transition history is append-only');
END;
