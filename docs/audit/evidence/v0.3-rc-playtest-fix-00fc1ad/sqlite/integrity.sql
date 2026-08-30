PRAGMA foreign_keys = ON;

SELECT json_object(
  'integrityCheck', (SELECT integrity_check FROM pragma_integrity_check LIMIT 1),
  'foreignKeyViolations', (SELECT COUNT(*) FROM pragma_foreign_key_check),
  'campaigns', (SELECT COUNT(*) FROM campaigns),
  'unfinishedPendingRequests', (
    SELECT COUNT(*) FROM pending_ai_requests
    WHERE status NOT IN ('COMMITTED', 'FAILED', 'CANCELLED')
  ),
  'unfinishedGenerationRecords', (
    SELECT COUNT(*) FROM generation_records WHERE completed_at IS NULL
  ),
  'duplicateIdempotencyKeys', (
    SELECT COUNT(*) FROM (
      SELECT idempotency_key FROM pending_ai_requests
      GROUP BY idempotency_key HAVING COUNT(*) > 1
    )
  ),
  'duplicateGenerationRequestIds', (
    SELECT COUNT(*) FROM (
      SELECT request_id FROM generation_records
      GROUP BY request_id HAVING COUNT(*) > 1
    )
  ),
  'duplicateWorldsPerCampaign', (
    SELECT COUNT(*) FROM (
      SELECT campaign_id FROM world_bibles
      GROUP BY campaign_id HAVING COUNT(*) > 1
    )
  ),
  'orphanWorlds', (
    SELECT COUNT(*) FROM world_bibles AS world
    LEFT JOIN campaigns AS campaign ON campaign.id = world.campaign_id
    WHERE campaign.id IS NULL
  )
) AS result;
