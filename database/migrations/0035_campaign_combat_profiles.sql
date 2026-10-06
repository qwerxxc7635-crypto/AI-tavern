CREATE TABLE campaign_combat_profiles (
  campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  world_constitution_revision INTEGER NOT NULL CHECK(world_constitution_revision>=1),
  profile_id TEXT NOT NULL CHECK(profile_id IN ('FANTASY','SCI_FI','CULTIVATION','URBAN')),
  selection_operation_id TEXT NOT NULL UNIQUE CHECK(
    length(selection_operation_id)=36
    AND selection_operation_id NOT GLOB '*[^0-9a-f-]*'
  ),
  selected_at TEXT NOT NULL
);

CREATE TRIGGER campaign_combat_profiles_immutable
BEFORE UPDATE ON campaign_combat_profiles
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'campaign combat profile is immutable');
END;
