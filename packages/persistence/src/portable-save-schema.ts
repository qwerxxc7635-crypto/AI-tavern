export const PORTABLE_SAVE_SCHEMA_VERSION = 3;
export const PORTABLE_ARCHIVE_DATABASE_VERSION = 5;
export const WORLD_SCHEMA_VERSION = 1;

export const LEGACY_CAMPAIGN_TABLES = [
  'world_bibles',
  'world_facts',
  'player_characters',
  'taverns',
  'npcs',
  'npc_knowledge',
  'npc_relationships',
  'quests',
  'adventures',
  'adventure_turns',
  'conversations',
  'messages',
  'items',
  'world_clocks',
] as const;

export const V2_CAMPAIGN_TABLES = [
  ...LEGACY_CAMPAIGN_TABLES.slice(0, 9),
  'scene_frames',
  ...LEGACY_CAMPAIGN_TABLES.slice(9),
] as const;

export const V3_CAMPAIGN_TABLES = [
  ...V2_CAMPAIGN_TABLES,
  'world_constitutions',
  'world_seeds',
  'world_random_streams',
  'character_rule_states',
  'rules_events',
  'world_truths',
  'knowledge_claims',
  'actor_knowledge',
  'knowledge_memories',
  'character_extension_definitions',
  'universal_character_profiles',
  'character_creation_sessions',
  'career_pools',
  'npc_lod_profiles',
  'npc_lod_transitions',
  'dynamic_locations',
  'location_connections',
  'campaign_location_states',
  'location_travel_events',
  'active_factions',
  'faction_action_events',
  'tavern_population_states',
  'tavern_population_members',
  'tavern_population_cycles',
  'tavern_population_focus_events',
  'tavern_scenes',
  'tavern_scene_participants',
  'tavern_scene_turns',
  'tavern_scene_actor_proposals',
  'npc_timeline_operations',
  'npc_timeline_attempts',
  'quest_pool_states',
  'quest_pool_transitions',
  'quest_graphs',
  'quest_graph_edges',
  'quest_graph_revisions',
  'quest_graph_evaluations',
  'quest_pool_creation_intents',
  'dynamic_quest_sources',
  'world_director_runs',
  'world_director_proposals',
  'director_budget_states',
  'director_budget_admissions',
  'director_budget_entries',
  'director_budget_cooldowns',
  'director_budget_decisions',
  'historical_summaries',
  'world_lore_entries',
  'memory_artifact_sources',
  'world_lore_retrieval_rules',
  'lazy_world_generation_plans',
  'lazy_world_generation_transitions',
  'event_ledger',
  'ai_candidates',
] as const;

export const V4_CAMPAIGN_TABLES = [
  ...V3_CAMPAIGN_TABLES,
  'battle_records',
  'active_combat_saves',
] as const;

export const PORTABLE_CAMPAIGN_TABLES = [
  ...V4_CAMPAIGN_TABLES,
  'campaign_combat_profiles',
] as const;

export type PortableCampaignTable = (typeof PORTABLE_CAMPAIGN_TABLES)[number];

const INDIRECT_TABLE_QUERIES: Readonly<Partial<Record<PortableCampaignTable, string>>> = {
  npc_knowledge: `SELECT npc_knowledge.* FROM npc_knowledge
    JOIN npcs ON npcs.id = npc_knowledge.npc_id
    WHERE npcs.campaign_id = ? ORDER BY npc_knowledge.rowid`,
  npc_relationships: `SELECT npc_relationships.* FROM npc_relationships
    JOIN npcs ON npcs.id = npc_relationships.npc_id
    WHERE npcs.campaign_id = ? ORDER BY npc_relationships.rowid`,
  adventure_turns: `SELECT adventure_turns.* FROM adventure_turns
    JOIN adventures ON adventures.id = adventure_turns.adventure_id
    WHERE adventures.campaign_id = ? ORDER BY adventure_turns.rowid`,
  messages: `SELECT messages.* FROM messages
    JOIN conversations ON conversations.id = messages.conversation_id
    WHERE conversations.campaign_id = ? ORDER BY messages.rowid`,
  npc_timeline_attempts: `SELECT npc_timeline_attempts.* FROM npc_timeline_attempts
    JOIN npc_timeline_operations ON npc_timeline_operations.id = npc_timeline_attempts.operation_id
    WHERE npc_timeline_operations.campaign_id = ? ORDER BY npc_timeline_attempts.rowid`,
};

export function portableTableQuery(table: PortableCampaignTable): string {
  return (
    INDIRECT_TABLE_QUERIES[table] ?? `SELECT * FROM "${table}" WHERE campaign_id = ? ORDER BY rowid`
  );
}
