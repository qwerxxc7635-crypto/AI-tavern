UPDATE world_facts
SET detail_json = json_set(
  detail_json,
  '$.claimId', 'claim-' || id,
  '$.claimRevision', 1,
  '$.confidence', 0.5,
  '$.sourceBasis', 'HEARSAY',
  '$.sourceNpcId', COALESCE(
    json_extract(detail_json, '$.sourceNpcId'),
    (
      SELECT npc_knowledge.npc_id
      FROM npc_knowledge
      JOIN npcs ON npcs.id = npc_knowledge.npc_id
      JOIN json_each(npc_knowledge.known_fact_ids_json) AS known
      WHERE npcs.campaign_id = world_facts.campaign_id
        AND known.value = world_facts.id
      ORDER BY npc_knowledge.npc_id
      LIMIT 1
    )
  )
)
WHERE kind = 'RUMOR';
