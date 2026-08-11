CREATE TABLE credential_cleanup_queue (
  credential_ref TEXT PRIMARY KEY
    CHECK (credential_ref GLOB 'credential:v1:????????-????-????-????-????????????'),
  reason TEXT NOT NULL CHECK (reason IN ('REPLACED', 'CLEARED', 'ROLLBACK', 'TRANSIENT')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_credential_cleanup_queue_updated
  ON credential_cleanup_queue (updated_at, credential_ref);
