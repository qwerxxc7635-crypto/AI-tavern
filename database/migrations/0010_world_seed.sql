CREATE TABLE world_seeds (
  campaign_id TEXT PRIMARY KEY
    REFERENCES campaigns (id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  algorithm TEXT NOT NULL CHECK (algorithm = 'EMBER_STREAM_V1'),
  seed TEXT NOT NULL CHECK (
    length(seed) = 32
    AND seed NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL
);

INSERT INTO world_seeds (campaign_id, schema_version, algorithm, seed, created_at)
SELECT id, 1, 'EMBER_STREAM_V1', lower(hex(randomblob(16))), created_at
FROM campaigns;

CREATE TRIGGER world_seeds_immutable
BEFORE UPDATE ON world_seeds
BEGIN
  SELECT RAISE(ABORT, 'world seed is immutable');
END;

CREATE TABLE world_random_streams (
  campaign_id TEXT NOT NULL
    REFERENCES world_seeds (campaign_id) ON DELETE CASCADE,
  stream_id TEXT NOT NULL CHECK (
    length(stream_id) BETWEEN 1 AND 64
    AND substr(stream_id, 1, 1) GLOB '[a-z]'
    AND stream_id NOT GLOB '*[^a-z0-9._-]*'
    AND stream_id <> 'd20'
    AND stream_id NOT GLOB 'd20[._-]*'
    AND stream_id <> 'dice'
    AND stream_id NOT GLOB 'dice[._-]*'
  ),
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, stream_id)
);

CREATE INDEX idx_world_random_streams_updated
  ON world_random_streams (campaign_id, updated_at);
