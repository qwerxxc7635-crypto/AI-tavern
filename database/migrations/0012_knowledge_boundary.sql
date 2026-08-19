CREATE TABLE world_truths (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  subject TEXT NOT NULL CHECK (length(trim(subject)) BETWEEN 1 AND 256),
  predicate TEXT NOT NULL CHECK (length(trim(predicate)) BETWEEN 1 AND 128),
  object_json TEXT NOT NULL CHECK (json_valid(object_json) AND length(object_json) <= 65536),
  authority TEXT NOT NULL CHECK (
    authority IN ('LOCAL_RULE', 'USER_ACCEPTANCE', 'DOMAIN_TRANSACTION', 'IMPORT')
  ),
  visibility TEXT NOT NULL CHECK (visibility IN ('PUBLIC', 'GAME_PRIVATE', 'SECRET')),
  source_event_id TEXT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_world_truths_campaign_visibility
  ON world_truths (campaign_id, visibility, id);

CREATE TABLE knowledge_claims (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  subject TEXT NOT NULL CHECK (length(trim(subject)) BETWEEN 1 AND 256),
  predicate TEXT NOT NULL CHECK (length(trim(predicate)) BETWEEN 1 AND 128),
  object_json TEXT NOT NULL CHECK (json_valid(object_json) AND length(object_json) <= 65536),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('TRUTH', 'EVENT', 'ACTOR')),
  source_truth_id TEXT REFERENCES world_truths (id) ON DELETE RESTRICT,
  source_event_id TEXT,
  source_actor_type TEXT CHECK (source_actor_type IN ('NPC', 'PLAYER_CHARACTER')),
  source_actor_id TEXT,
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (source_kind = 'TRUTH' AND source_truth_id IS NOT NULL
      AND source_event_id IS NULL AND source_actor_type IS NULL AND source_actor_id IS NULL)
    OR
    (source_kind = 'EVENT' AND source_truth_id IS NULL
      AND source_event_id IS NOT NULL AND source_actor_type IS NULL AND source_actor_id IS NULL)
    OR
    (source_kind = 'ACTOR' AND source_truth_id IS NULL
      AND source_event_id IS NULL AND source_actor_type IS NOT NULL
      AND length(trim(source_actor_id)) > 0)
  )
);

CREATE INDEX idx_knowledge_claims_campaign ON knowledge_claims (campaign_id, id);

CREATE TABLE actor_knowledge (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('NPC', 'PLAYER_CHARACTER')),
  actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) > 0),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('TRUTH', 'CLAIM')),
  truth_id TEXT REFERENCES world_truths (id) ON DELETE RESTRICT,
  claim_id TEXT REFERENCES knowledge_claims (id) ON DELETE RESTRICT,
  knowledge_state TEXT NOT NULL CHECK (knowledge_state IN ('KNOWN', 'SUSPECTED', 'BELIEVED')),
  visibility TEXT NOT NULL CHECK (visibility IN ('ACTOR_PRIVATE', 'SHARED')),
  provenance_kind TEXT NOT NULL CHECK (
    provenance_kind IN ('LOCAL_RULE', 'OBSERVATION', 'COMMUNICATION', 'INFERENCE', 'IMPORT')
  ),
  provenance_source_id TEXT NOT NULL CHECK (length(trim(provenance_source_id)) > 0),
  provenance_event_id TEXT,
  learned_at TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at TEXT NOT NULL,
  CHECK (
    (target_kind = 'TRUTH' AND truth_id IS NOT NULL AND claim_id IS NULL)
    OR (target_kind = 'CLAIM' AND truth_id IS NULL AND claim_id IS NOT NULL)
  ),
  CHECK (provenance_kind IN ('LOCAL_RULE', 'IMPORT') OR provenance_event_id IS NOT NULL),
  UNIQUE (campaign_id, actor_type, actor_id, target_kind, truth_id),
  UNIQUE (campaign_id, actor_type, actor_id, target_kind, claim_id)
);

CREATE INDEX idx_actor_knowledge_projection
  ON actor_knowledge (campaign_id, actor_type, actor_id, knowledge_state, id);

CREATE TABLE knowledge_memories (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('NPC', 'PLAYER_CHARACTER')),
  actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) > 0),
  summary TEXT NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 4000),
  source_knowledge_ids_json TEXT NOT NULL CHECK (
    json_valid(source_knowledge_ids_json) AND json_type(source_knowledge_ids_json) = 'array'
  ),
  source_event_ids_json TEXT NOT NULL CHECK (
    json_valid(source_event_ids_json) AND json_type(source_event_ids_json) = 'array'
  ),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  CHECK (
    json_array_length(source_knowledge_ids_json) > 0
    OR json_array_length(source_event_ids_json) > 0
  )
);

CREATE INDEX idx_knowledge_memories_actor
  ON knowledge_memories (campaign_id, actor_type, actor_id, created_at, id);

CREATE TRIGGER actor_knowledge_validate_insert
BEFORE INSERT ON actor_knowledge
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.actor_type = 'NPC' AND NOT EXISTS (
      SELECT 1 FROM npcs WHERE id = NEW.actor_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'knowledge actor is not an NPC in this campaign')
    WHEN NEW.actor_type = 'PLAYER_CHARACTER' AND NOT EXISTS (
      SELECT 1 FROM player_characters WHERE id = NEW.actor_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'knowledge actor is not a player character in this campaign')
    WHEN NEW.target_kind = 'TRUTH' AND NOT EXISTS (
      SELECT 1 FROM world_truths WHERE id = NEW.truth_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'knowledge truth is not in this campaign')
    WHEN NEW.target_kind = 'CLAIM' AND NOT EXISTS (
      SELECT 1 FROM knowledge_claims WHERE id = NEW.claim_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'knowledge claim is not in this campaign')
    WHEN NEW.provenance_event_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM game_events
      WHERE id = NEW.provenance_event_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'knowledge provenance event is not in this campaign')
  END;
END;

CREATE TRIGGER actor_knowledge_validate_update
BEFORE UPDATE ON actor_knowledge
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id OR NEW.campaign_id <> OLD.campaign_id
      OR NEW.actor_type <> OLD.actor_type OR NEW.actor_id <> OLD.actor_id
      OR NEW.target_kind <> OLD.target_kind
      OR NEW.truth_id IS NOT OLD.truth_id OR NEW.claim_id IS NOT OLD.claim_id
      THEN RAISE(ABORT, 'knowledge identity and scope are immutable')
    WHEN NEW.revision <> OLD.revision + 1
      THEN RAISE(ABORT, 'knowledge revision must advance by one')
    WHEN NEW.provenance_event_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM game_events
      WHERE id = NEW.provenance_event_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'knowledge provenance event is not in this campaign')
  END;
END;

CREATE TRIGGER knowledge_memory_validate_actor
BEFORE INSERT ON knowledge_memories
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.actor_type = 'NPC' AND NOT EXISTS (
      SELECT 1 FROM npcs WHERE id = NEW.actor_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'memory actor is not an NPC in this campaign')
    WHEN NEW.actor_type = 'PLAYER_CHARACTER' AND NOT EXISTS (
      SELECT 1 FROM player_characters WHERE id = NEW.actor_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'memory actor is not a player character in this campaign')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.source_knowledge_ids_json) AS source
      WHERE NOT EXISTS (
        SELECT 1 FROM actor_knowledge AS knowledge
        WHERE knowledge.id = source.value
          AND knowledge.campaign_id = NEW.campaign_id
          AND knowledge.actor_type = NEW.actor_type
          AND knowledge.actor_id = NEW.actor_id
      )
    ) THEN RAISE(ABORT, 'memory source knowledge belongs to another actor')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.source_event_ids_json) AS source
      WHERE NOT EXISTS (
        SELECT 1 FROM game_events
        WHERE id = source.value AND campaign_id = NEW.campaign_id
      )
    ) THEN RAISE(ABORT, 'memory source event is not in this campaign')
  END;
END;

CREATE TRIGGER world_truth_validate_source_insert
BEFORE INSERT ON world_truths
FOR EACH ROW
WHEN NEW.source_event_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM game_events
    WHERE id = NEW.source_event_id AND campaign_id = NEW.campaign_id
  )
BEGIN
  SELECT RAISE(ABORT, 'world truth source event is not in this campaign');
END;

CREATE TRIGGER world_truth_validate_source_update
BEFORE UPDATE ON world_truths
FOR EACH ROW
WHEN NEW.source_event_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM game_events
    WHERE id = NEW.source_event_id AND campaign_id = NEW.campaign_id
  )
BEGIN
  SELECT RAISE(ABORT, 'world truth source event is not in this campaign');
END;

CREATE TRIGGER knowledge_claim_validate_source_insert
BEFORE INSERT ON knowledge_claims
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.source_kind = 'TRUTH' AND NOT EXISTS (
      SELECT 1 FROM world_truths
      WHERE id = NEW.source_truth_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'claim source truth is not in this campaign')
    WHEN NEW.source_kind = 'EVENT' AND NOT EXISTS (
      SELECT 1 FROM game_events
      WHERE id = NEW.source_event_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'claim source event is not in this campaign')
    WHEN NEW.source_kind = 'ACTOR' AND NEW.source_actor_type = 'NPC' AND NOT EXISTS (
      SELECT 1 FROM npcs
      WHERE id = NEW.source_actor_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'claim source NPC is not in this campaign')
    WHEN NEW.source_kind = 'ACTOR' AND NEW.source_actor_type = 'PLAYER_CHARACTER'
      AND NOT EXISTS (
        SELECT 1 FROM player_characters
        WHERE id = NEW.source_actor_id AND campaign_id = NEW.campaign_id
      ) THEN RAISE(ABORT, 'claim source player is not in this campaign')
  END;
END;

CREATE TRIGGER knowledge_claim_validate_source_update
BEFORE UPDATE ON knowledge_claims
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.source_kind = 'TRUTH' AND NOT EXISTS (
      SELECT 1 FROM world_truths
      WHERE id = NEW.source_truth_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'claim source truth is not in this campaign')
    WHEN NEW.source_kind = 'EVENT' AND NOT EXISTS (
      SELECT 1 FROM game_events
      WHERE id = NEW.source_event_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'claim source event is not in this campaign')
    WHEN NEW.source_kind = 'ACTOR' AND NEW.source_actor_type = 'NPC' AND NOT EXISTS (
      SELECT 1 FROM npcs
      WHERE id = NEW.source_actor_id AND campaign_id = NEW.campaign_id
    ) THEN RAISE(ABORT, 'claim source NPC is not in this campaign')
    WHEN NEW.source_kind = 'ACTOR' AND NEW.source_actor_type = 'PLAYER_CHARACTER'
      AND NOT EXISTS (
        SELECT 1 FROM player_characters
        WHERE id = NEW.source_actor_id AND campaign_id = NEW.campaign_id
      ) THEN RAISE(ABORT, 'claim source player is not in this campaign')
  END;
END;

CREATE TRIGGER world_truth_revision_guard
BEFORE UPDATE ON world_truths
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id OR NEW.campaign_id <> OLD.campaign_id
      THEN RAISE(ABORT, 'world truth identity is immutable')
    WHEN NEW.revision <> OLD.revision + 1
      THEN RAISE(ABORT, 'world truth revision must advance by one')
  END;
END;

CREATE TRIGGER knowledge_claim_revision_guard
BEFORE UPDATE ON knowledge_claims
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id OR NEW.campaign_id <> OLD.campaign_id
      THEN RAISE(ABORT, 'knowledge claim identity is immutable')
    WHEN NEW.revision <> OLD.revision + 1
      THEN RAISE(ABORT, 'knowledge claim revision must advance by one')
  END;
END;

-- Import legacy facts as separate Truth or Claim records without exposing rumor veracity.
INSERT INTO world_truths (
  id, campaign_id, subject, predicate, object_json, authority, visibility,
  source_event_id, revision, created_at, updated_at
)
SELECT
  'truth-' || id, campaign_id, 'world_fact:' || id, 'states', json_quote(statement),
  'IMPORT', CASE WHEN kind = 'LOCKED_RULE' THEN 'PUBLIC' ELSE 'GAME_PRIVATE' END,
  NULL, 1, created_at, created_at
FROM world_facts
WHERE kind NOT IN ('RUMOR', 'FALSE_BELIEF');

INSERT INTO knowledge_claims (
  id, campaign_id, subject, predicate, object_json, source_kind,
  source_truth_id, source_event_id, source_actor_type, source_actor_id,
  confidence, revision, created_at, updated_at
)
SELECT
  CASE WHEN kind = 'RUMOR'
    THEN COALESCE(json_extract(detail_json, '$.claimId'), 'claim-' || id)
    ELSE 'claim-' || id END,
  campaign_id, 'world_fact:' || id, 'states', json_quote(statement), 'ACTOR',
  NULL, NULL, 'NPC',
  COALESCE(
    json_extract(detail_json, '$.sourceNpcId'),
    json_extract(detail_json, '$.believedByNpcIds[0]'),
    (SELECT knowledge.npc_id FROM npc_knowledge AS knowledge,
      json_each(knowledge.known_fact_ids_json) AS known
      WHERE known.value = world_facts.id ORDER BY knowledge.npc_id LIMIT 1),
    'legacy-system'
  ),
  COALESCE(json_extract(detail_json, '$.confidence'), 1.0),
  COALESCE(json_extract(detail_json, '$.claimRevision'), 1),
  created_at, created_at
FROM world_facts
WHERE kind IN ('RUMOR', 'FALSE_BELIEF');

INSERT INTO actor_knowledge (
  id, campaign_id, actor_type, actor_id, target_kind, truth_id, claim_id,
  knowledge_state, visibility, provenance_kind, provenance_source_id,
  provenance_event_id, learned_at, confidence, revision, updated_at
)
SELECT
  'knowledge:' || entries.npc_id || ':' || entries.fact_id,
  entries.campaign_id, 'NPC', entries.npc_id,
  CASE WHEN facts.kind IN ('RUMOR', 'FALSE_BELIEF') THEN 'CLAIM' ELSE 'TRUTH' END,
  CASE WHEN facts.kind IN ('RUMOR', 'FALSE_BELIEF') THEN NULL ELSE 'truth-' || facts.id END,
  CASE
    WHEN facts.kind = 'RUMOR'
      THEN COALESCE(json_extract(facts.detail_json, '$.claimId'), 'claim-' || facts.id)
    WHEN facts.kind = 'FALSE_BELIEF' THEN 'claim-' || facts.id
    ELSE NULL END,
  entries.knowledge_state, 'ACTOR_PRIVATE',
  COALESCE(json_extract(entries.provenance, '$.source'), 'IMPORT'),
  COALESCE(json_extract(entries.provenance, '$.eventId'), 'legacy:npc_knowledge'),
  json_extract(entries.provenance, '$.eventId'),
  COALESCE(json_extract(entries.provenance, '$.learnedAt'), entries.updated_at),
  COALESCE(json_extract(entries.provenance, '$.confidence'), entries.default_confidence),
  1, entries.updated_at
FROM (
  SELECT npcs.campaign_id, knowledge.npc_id, known.value AS fact_id,
         'KNOWN' AS knowledge_state, 1.0 AS default_confidence,
         knowledge.updated_at,
         (SELECT provenance.value FROM json_each(knowledge.provenance_json) AS provenance
          WHERE json_extract(provenance.value, '$.factId') = known.value LIMIT 1) AS provenance
  FROM npc_knowledge AS knowledge
  JOIN npcs ON npcs.id = knowledge.npc_id
  JOIN json_each(knowledge.known_fact_ids_json) AS known
  UNION ALL
  SELECT npcs.campaign_id, knowledge.npc_id, suspected.value,
         'SUSPECTED', 0.5, knowledge.updated_at,
         (SELECT provenance.value FROM json_each(knowledge.provenance_json) AS provenance
          WHERE json_extract(provenance.value, '$.factId') = suspected.value LIMIT 1)
  FROM npc_knowledge AS knowledge
  JOIN npcs ON npcs.id = knowledge.npc_id
  JOIN json_each(knowledge.suspected_fact_ids_json) AS suspected
  UNION ALL
  SELECT npcs.campaign_id, knowledge.npc_id, beliefs.value,
         'BELIEVED', 1.0, knowledge.updated_at,
         (SELECT provenance.value FROM json_each(knowledge.provenance_json) AS provenance
          WHERE json_extract(provenance.value, '$.factId') = beliefs.value LIMIT 1)
  FROM npc_knowledge AS knowledge
  JOIN npcs ON npcs.id = knowledge.npc_id
  JOIN json_each(knowledge.false_belief_fact_ids_json) AS beliefs
) AS entries
JOIN world_facts AS facts
  ON facts.id = entries.fact_id AND facts.campaign_id = entries.campaign_id;

INSERT INTO event_ledger (
  id, campaign_id, event_type, operation_id, aggregate_type, aggregate_id,
  revision, payload_json, payload_version, source, occurred_at
)
SELECT
  'ledger-import-' || id,
  campaign_id,
  'KNOWLEDGE_COMMITTED',
  'import:' || id,
  'KNOWLEDGE',
  id,
  revision,
  json_object('action', 'IMPORT', 'knowledgeId', id),
  1,
  'IMPORT',
  updated_at
FROM actor_knowledge;
