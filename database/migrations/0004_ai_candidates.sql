CREATE TABLE ai_candidates (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL UNIQUE,
  task TEXT NOT NULL CHECK (length(trim(task)) > 0),
  generation_record_id TEXT REFERENCES generation_records (id) ON DELETE SET NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  validation_json TEXT NOT NULL CHECK (json_valid(validation_json)),
  provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
  expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
  status TEXT NOT NULL CHECK (status IN ('PROPOSED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED')),
  supersedes_candidate_id TEXT REFERENCES ai_candidates (id) ON DELETE CASCADE,
  superseded_by_candidate_id TEXT REFERENCES ai_candidates (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (supersedes_candidate_id IS NULL OR supersedes_candidate_id <> id),
  CHECK (
    (status = 'SUPERSEDED' AND superseded_by_candidate_id IS NOT NULL)
    OR (status <> 'SUPERSEDED' AND superseded_by_candidate_id IS NULL)
  )
);

CREATE INDEX idx_ai_candidates_campaign_status
  ON ai_candidates (campaign_id, status, updated_at, id);
CREATE INDEX idx_ai_candidates_generation
  ON ai_candidates (generation_record_id);
