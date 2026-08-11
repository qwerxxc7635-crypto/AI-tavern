ALTER TABLE provider_configs
  ADD COLUMN endpoint_fingerprint TEXT
  CHECK (endpoint_fingerprint IS NULL OR length(endpoint_fingerprint) = 64);

ALTER TABLE model_profiles
  ADD COLUMN capability_source TEXT
  CHECK (capability_source IS NULL OR capability_source IN (
    'PROVIDER_RESPONSE', 'PRESET_METADATA', 'UNKNOWN'
  ));

ALTER TABLE model_profiles
  ADD COLUMN probe_fingerprint TEXT
  CHECK (probe_fingerprint IS NULL OR length(probe_fingerprint) = 64);
