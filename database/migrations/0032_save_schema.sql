ALTER TABLE campaigns
  ADD COLUMN save_schema_version INTEGER NOT NULL DEFAULT 3
  CHECK (save_schema_version = 3);

ALTER TABLE campaigns
  ADD COLUMN world_schema_version INTEGER NOT NULL DEFAULT 1
  CHECK (world_schema_version = 1);

-- Portable restore uses the existing quest restore boundary while inserting an
-- already-validated campaign graph. NPC projections must observe the same
-- boundary so importing an existing LOD profile does not require weakening its
-- normal delete guard.
DROP TRIGGER npc_lod_delete_guard;
CREATE TRIGGER npc_lod_delete_guard
BEFORE DELETE ON npc_lod_profiles
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM campaigns WHERE id = OLD.campaign_id)
  AND NOT EXISTS (
    SELECT 1 FROM quest_pool_restore_sessions WHERE campaign_id = OLD.campaign_id
  )
BEGIN
  SELECT RAISE(ABORT, 'NPC LOD profiles cannot be deleted');
END;
