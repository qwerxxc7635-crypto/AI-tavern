CREATE TABLE event_ledger (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'CHARACTER_COMMITTED', 'QUEST_COMMITTED', 'TURN_COMMITTED', 'DICE_COMMITTED',
      'SCENE_COMMITTED', 'KNOWLEDGE_COMMITTED', 'SNAPSHOT_CREATED', 'RECOVERY_COMMITTED'
    )
  ),
  operation_id TEXT NOT NULL,
  aggregate_type TEXT NOT NULL CHECK (
    aggregate_type IN ('CHARACTER', 'QUEST', 'TURN', 'DICE', 'SCENE', 'KNOWLEDGE', 'SNAPSHOT', 'RECOVERY')
  ),
  aggregate_id TEXT NOT NULL CHECK (length(trim(aggregate_id)) > 0),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  payload_version INTEGER NOT NULL CHECK (payload_version >= 1),
  source TEXT NOT NULL CHECK (source IN ('LOCAL_RULE', 'USER_ACCEPTANCE', 'IMPORT', 'SYSTEM')),
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (operation_id, event_type, aggregate_id),
  UNIQUE (aggregate_type, aggregate_id, revision)
);

CREATE TRIGGER event_ledger_contiguous_revision
BEFORE INSERT ON event_ledger
FOR EACH ROW
WHEN NEW.revision <> COALESCE(
  (SELECT MAX(revision) + 1 FROM event_ledger
   WHERE aggregate_type = NEW.aggregate_type AND aggregate_id = NEW.aggregate_id),
  1
)
BEGIN
  SELECT RAISE(ABORT, 'event ledger revision must be contiguous');
END;

CREATE INDEX idx_event_ledger_campaign_time
  ON event_ledger (campaign_id, occurred_at, id);
CREATE INDEX idx_event_ledger_aggregate_revision
  ON event_ledger (aggregate_type, aggregate_id, revision);
