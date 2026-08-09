CREATE TABLE scene_frames (
  adventure_id TEXT PRIMARY KEY REFERENCES adventures (id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  scene_id TEXT NOT NULL CHECK (length(trim(scene_id)) > 0),
  location TEXT NOT NULL CHECK (length(trim(location)) > 0),
  participants_json TEXT NOT NULL CHECK (json_valid(participants_json) AND json_type(participants_json) = 'array'),
  pressure_json TEXT NOT NULL CHECK (json_valid(pressure_json) AND json_type(pressure_json) = 'array'),
  affordances_json TEXT NOT NULL CHECK (json_valid(affordances_json) AND json_type(affordances_json) = 'array'),
  pending_consequences_json TEXT NOT NULL CHECK (json_valid(pending_consequences_json) AND json_type(pending_consequences_json) = 'array'),
  return_point_json TEXT NOT NULL CHECK (json_valid(return_point_json) AND json_type(return_point_json) = 'object'),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_scene_frames_campaign_revision
  ON scene_frames (campaign_id, revision);

CREATE TRIGGER scene_frames_campaign_matches_adventure_insert
BEFORE INSERT ON scene_frames
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM adventures
  WHERE id = NEW.adventure_id AND campaign_id = NEW.campaign_id
)
BEGIN
  SELECT RAISE(ABORT, 'scene frame campaign must match adventure');
END;

CREATE TRIGGER scene_frames_campaign_matches_adventure_update
BEFORE UPDATE OF adventure_id, campaign_id ON scene_frames
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM adventures
  WHERE id = NEW.adventure_id AND campaign_id = NEW.campaign_id
)
BEGIN
  SELECT RAISE(ABORT, 'scene frame campaign must match adventure');
END;

-- A portable SceneFrame can arrive without the device-local Event Ledger. Its
-- first local SCENE audit entry therefore starts at the imported frame revision;
-- all subsequent entries remain contiguous. Other aggregate types retain the
-- original revision-1 requirement.
DROP TRIGGER event_ledger_contiguous_revision;

CREATE TRIGGER event_ledger_contiguous_revision
BEFORE INSERT ON event_ledger
FOR EACH ROW
WHEN NEW.revision <> COALESCE(
  (SELECT MAX(revision) + 1 FROM event_ledger
   WHERE aggregate_type = NEW.aggregate_type AND aggregate_id = NEW.aggregate_id),
  CASE WHEN NEW.aggregate_type = 'SCENE' THEN NEW.revision ELSE 1 END
)
BEGIN
  SELECT RAISE(ABORT, 'event ledger revision must be contiguous');
END;
