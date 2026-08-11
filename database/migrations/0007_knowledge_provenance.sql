ALTER TABLE npc_knowledge
ADD COLUMN provenance_json TEXT NOT NULL DEFAULT '[]'
CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'array');

UPDATE npc_knowledge
SET known_fact_ids_json = COALESCE((
      SELECT json_group_array(active.value)
      FROM json_each(npc_knowledge.known_fact_ids_json) AS active
      WHERE NOT EXISTS (
        SELECT 1 FROM json_each(npc_knowledge.excluded_secret_fact_ids_json) AS excluded
        WHERE excluded.value = active.value
      )
    ), '[]'),
    suspected_fact_ids_json = COALESCE((
      SELECT json_group_array(active.value)
      FROM json_each(npc_knowledge.suspected_fact_ids_json) AS active
      WHERE NOT EXISTS (
        SELECT 1 FROM json_each(npc_knowledge.excluded_secret_fact_ids_json) AS excluded
        WHERE excluded.value = active.value
      )
    ), '[]'),
    false_belief_fact_ids_json = COALESCE((
      SELECT json_group_array(active.value)
      FROM json_each(npc_knowledge.false_belief_fact_ids_json) AS active
      WHERE NOT EXISTS (
        SELECT 1 FROM json_each(npc_knowledge.excluded_secret_fact_ids_json) AS excluded
        WHERE excluded.value = active.value
      )
    ), '[]');

UPDATE npc_knowledge
SET provenance_json = COALESCE(
  (
    SELECT json_group_array(
      json_object(
        'factId', entries.fact_id,
        'state', entries.knowledge_state,
        'source', 'IMPORT',
        'eventId', NULL,
        'learnedAt', npc_knowledge.updated_at,
        'confidence', entries.confidence
      )
    )
    FROM (
      SELECT value AS fact_id, 'KNOWN' AS knowledge_state, 1.0 AS confidence,
             0 AS state_order, CAST(key AS INTEGER) AS item_order
      FROM json_each(npc_knowledge.known_fact_ids_json)
      UNION ALL
      SELECT value, 'SUSPECTED', 0.5, 1, CAST(key AS INTEGER)
      FROM json_each(npc_knowledge.suspected_fact_ids_json)
      UNION ALL
      SELECT value, 'BELIEVED', 1.0, 2, CAST(key AS INTEGER)
      FROM json_each(npc_knowledge.false_belief_fact_ids_json)
      ORDER BY state_order, item_order
    ) AS entries
    WHERE NOT EXISTS (
      SELECT 1
      FROM json_each(npc_knowledge.excluded_secret_fact_ids_json) AS excluded
      WHERE excluded.value = entries.fact_id
    )
  ),
  '[]'
);
