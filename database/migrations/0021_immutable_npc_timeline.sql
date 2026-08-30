CREATE TABLE npc_timeline_operations (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('NPC_DIALOGUE','TAVERN_SCENE')),
  scope_id TEXT NOT NULL CHECK (length(trim(scope_id)) BETWEEN 1 AND 200),
  player_intent TEXT NOT NULL CHECK (length(trim(player_intent)) BETWEEN 1 AND 4000),
  addressed_npc_id TEXT,
  hard_result_key TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'PENDING','FAILED_RETRYABLE','FAILED_FINAL','COMMITTED','CANCELLED'
  )),
  committed_ref_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((status='COMMITTED')=(committed_ref_id IS NOT NULL)),
  CHECK (addressed_npc_id IS NULL OR length(trim(addressed_npc_id)) BETWEEN 1 AND 200),
  CHECK (hard_result_key IS NULL OR length(trim(hard_result_key)) BETWEEN 1 AND 200)
);

CREATE INDEX idx_npc_timeline_scope
  ON npc_timeline_operations(campaign_id,scope_kind,scope_id,created_at,id);

CREATE UNIQUE INDEX idx_npc_timeline_one_unresolved_scope
  ON npc_timeline_operations(campaign_id,scope_kind,scope_id)
  WHERE status IN ('PENDING','FAILED_RETRYABLE');

CREATE TABLE npc_timeline_attempts (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES npc_timeline_operations(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  request_ids_json TEXT NOT NULL CHECK (
    json_valid(request_ids_json) AND json_type(request_ids_json)='array'
      AND json_array_length(request_ids_json) BETWEEN 1 AND 6
  ),
  generation_record_ids_json TEXT NOT NULL CHECK (
    json_valid(generation_record_ids_json) AND json_type(generation_record_ids_json)='array'
      AND json_array_length(generation_record_ids_json)=json_array_length(request_ids_json)
  ),
  idempotency_keys_json TEXT NOT NULL CHECK (
    json_valid(idempotency_keys_json) AND json_type(idempotency_keys_json)='array'
      AND json_array_length(idempotency_keys_json)=json_array_length(request_ids_json)
  ),
  status TEXT NOT NULL CHECK (status IN ('STARTED','FAILED','COMMITTED')),
  error_kind TEXT CHECK (error_kind IS NULL OR error_kind IN (
    'PROVIDER','GENERATION','VALIDATION','PERSISTENCE','RULE','NETWORK'
  )),
  error_code TEXT,
  retryable INTEGER CHECK (retryable IS NULL OR retryable IN (0,1)),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(operation_id,sequence),
  CHECK (
    (status='STARTED' AND error_kind IS NULL AND error_code IS NULL
      AND retryable IS NULL AND completed_at IS NULL)
    OR (status='FAILED' AND error_kind IS NOT NULL AND error_code IS NOT NULL
      AND retryable IS NOT NULL AND completed_at IS NOT NULL)
    OR (status='COMMITTED' AND error_kind IS NULL AND error_code IS NULL
      AND retryable IS NULL AND completed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_npc_timeline_one_started
  ON npc_timeline_attempts(operation_id) WHERE status='STARTED';

CREATE TRIGGER npc_timeline_operation_insert_guard
BEFORE INSERT ON npc_timeline_operations FOR EACH ROW BEGIN
  SELECT CASE
    WHEN NEW.status<>'PENDING' OR NEW.committed_ref_id IS NOT NULL
      THEN RAISE(ABORT,'timeline must begin pending')
    WHEN NEW.scope_kind='NPC_DIALOGUE' AND NOT EXISTS (
      SELECT 1 FROM npc_lod_profiles
      WHERE id=NEW.scope_id AND campaign_id=NEW.campaign_id AND lod>=1
    ) THEN RAISE(ABORT,'timeline NPC scope is invalid')
    WHEN NEW.scope_kind='TAVERN_SCENE' AND NOT EXISTS (
      SELECT 1 FROM tavern_scenes
      WHERE id=NEW.scope_id AND campaign_id=NEW.campaign_id
    ) THEN RAISE(ABORT,'timeline Scene scope is invalid')
    WHEN NEW.addressed_npc_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM npc_lod_profiles
      WHERE id=NEW.addressed_npc_id AND campaign_id=NEW.campaign_id
    ) THEN RAISE(ABORT,'timeline addressed NPC is invalid')
  END;
END;

CREATE TRIGGER npc_timeline_attempt_insert_guard
BEFORE INSERT ON npc_timeline_attempts FOR EACH ROW BEGIN
  SELECT CASE
    WHEN NEW.status<>'STARTED' OR NEW.error_kind IS NOT NULL OR NEW.error_code IS NOT NULL
      OR NEW.retryable IS NOT NULL OR NEW.completed_at IS NOT NULL
      THEN RAISE(ABORT,'timeline attempt must begin started')
    WHEN NOT EXISTS (
      SELECT 1 FROM npc_timeline_operations
      WHERE id=NEW.operation_id AND status='PENDING'
    ) THEN RAISE(ABORT,'timeline attempt requires pending operation')
  END;
END;

CREATE TRIGGER npc_timeline_operation_update_guard
BEFORE UPDATE ON npc_timeline_operations FOR EACH ROW BEGIN
  SELECT CASE
    WHEN NEW.id<>OLD.id OR NEW.operation_id<>OLD.operation_id
      OR NEW.campaign_id<>OLD.campaign_id OR NEW.scope_kind<>OLD.scope_kind
      OR NEW.scope_id<>OLD.scope_id OR NEW.player_intent<>OLD.player_intent
      OR NEW.addressed_npc_id IS NOT OLD.addressed_npc_id
      OR NEW.hard_result_key IS NOT OLD.hard_result_key OR NEW.created_at<>OLD.created_at
      THEN RAISE(ABORT,'timeline locked intent is immutable')
    WHEN OLD.status IN ('COMMITTED','FAILED_FINAL','CANCELLED')
      THEN RAISE(ABORT,'terminal timeline operation is immutable')
    WHEN OLD.status='PENDING' AND NEW.status NOT IN ('FAILED_RETRYABLE','FAILED_FINAL','COMMITTED')
      THEN RAISE(ABORT,'timeline pending transition is invalid')
    WHEN OLD.status='FAILED_RETRYABLE' AND NEW.status NOT IN ('PENDING','CANCELLED')
      THEN RAISE(ABORT,'timeline retry transition is invalid')
  END;
END;

CREATE TRIGGER npc_timeline_attempt_update_guard
BEFORE UPDATE ON npc_timeline_attempts FOR EACH ROW BEGIN
  SELECT CASE
    WHEN NEW.id<>OLD.id OR NEW.operation_id<>OLD.operation_id OR NEW.sequence<>OLD.sequence
      OR NEW.request_ids_json<>OLD.request_ids_json
      OR NEW.generation_record_ids_json<>OLD.generation_record_ids_json
      OR NEW.idempotency_keys_json<>OLD.idempotency_keys_json OR NEW.started_at<>OLD.started_at
      THEN RAISE(ABORT,'timeline attempt identity is immutable')
    WHEN OLD.status<>'STARTED' THEN RAISE(ABORT,'completed timeline attempt is immutable')
    WHEN NEW.status NOT IN ('FAILED','COMMITTED')
      THEN RAISE(ABORT,'timeline attempt transition is invalid')
  END;
END;

CREATE TRIGGER npc_timeline_message_update_guard
BEFORE UPDATE ON messages FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM npc_timeline_operations operation
  JOIN messages committed ON committed.id=operation.committed_ref_id
  WHERE operation.scope_kind='NPC_DIALOGUE'
    AND operation.status='COMMITTED'
    AND EXISTS (SELECT 1 FROM campaigns WHERE id=operation.campaign_id)
    AND committed.conversation_id=OLD.conversation_id
    AND OLD.sequence_number BETWEEN committed.sequence_number-1 AND committed.sequence_number
)
BEGIN SELECT RAISE(ABORT,'committed timeline messages are append-only'); END;

CREATE TRIGGER npc_timeline_message_delete_guard
BEFORE DELETE ON messages FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM npc_timeline_operations operation
  JOIN messages committed ON committed.id=operation.committed_ref_id
  WHERE operation.scope_kind='NPC_DIALOGUE'
    AND operation.status='COMMITTED'
    AND EXISTS (SELECT 1 FROM campaigns WHERE id=operation.campaign_id)
    AND committed.conversation_id=OLD.conversation_id
    AND OLD.sequence_number BETWEEN committed.sequence_number-1 AND committed.sequence_number
)
BEGIN SELECT RAISE(ABORT,'committed timeline messages are append-only'); END;
