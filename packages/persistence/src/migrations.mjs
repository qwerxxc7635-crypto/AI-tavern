import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

const migrations = [
  {
    version: 1,
    name: 'initial',
    source: new URL('../../../database/migrations/0001_initial.sql', import.meta.url),
  },
  {
    version: 2,
    name: 'credential_cleanup_queue',
    source: new URL(
      '../../../database/migrations/0002_credential_cleanup_queue.sql',
      import.meta.url,
    ),
  },
  {
    version: 3,
    name: 'provider_probe_consistency',
    source: new URL(
      '../../../database/migrations/0003_provider_probe_consistency.sql',
      import.meta.url,
    ),
  },
  {
    version: 4,
    name: 'ai_candidates',
    source: new URL('../../../database/migrations/0004_ai_candidates.sql', import.meta.url),
  },
  {
    version: 5,
    name: 'event_ledger',
    source: new URL('../../../database/migrations/0005_event_ledger.sql', import.meta.url),
  },
  {
    version: 6,
    name: 'scene_frames',
    source: new URL('../../../database/migrations/0006_scene_frames.sql', import.meta.url),
  },
  {
    version: 7,
    name: 'knowledge_provenance',
    source: new URL('../../../database/migrations/0007_knowledge_provenance.sql', import.meta.url),
  },
  {
    version: 8,
    name: 'rumor_claim_sources',
    source: new URL('../../../database/migrations/0008_rumor_claim_sources.sql', import.meta.url),
  },
  {
    version: 9,
    name: 'world_constitutions',
    source: new URL('../../../database/migrations/0009_world_constitutions.sql', import.meta.url),
  },
  {
    version: 10,
    name: 'world_seed',
    source: new URL('../../../database/migrations/0010_world_seed.sql', import.meta.url),
  },
  {
    version: 11,
    name: 'rules_engine',
    source: new URL('../../../database/migrations/0011_rules_engine.sql', import.meta.url),
  },
  {
    version: 12,
    name: 'knowledge_boundary',
    source: new URL('../../../database/migrations/0012_knowledge_boundary.sql', import.meta.url),
  },
  {
    version: 13,
    name: 'universal_character',
    source: new URL('../../../database/migrations/0013_universal_character.sql', import.meta.url),
  },
  {
    version: 14,
    name: 'character_creation_sessions',
    source: new URL(
      '../../../database/migrations/0014_character_creation_sessions.sql',
      import.meta.url,
    ),
  },
  {
    version: 15,
    name: 'career_pools',
    source: new URL('../../../database/migrations/0015_career_pools.sql', import.meta.url),
  },
  {
    version: 16,
    name: 'npc_lod',
    source: new URL('../../../database/migrations/0016_npc_lod.sql', import.meta.url),
  },
  {
    version: 17,
    name: 'dynamic_locations',
    source: new URL('../../../database/migrations/0017_dynamic_locations.sql', import.meta.url),
  },
  {
    version: 18,
    name: 'active_factions',
    source: new URL('../../../database/migrations/0018_active_factions.sql', import.meta.url),
  },
  {
    version: 19,
    name: 'tavern_population',
    source: new URL('../../../database/migrations/0019_tavern_population.sql', import.meta.url),
  },
  {
    version: 20,
    name: 'multi_npc_scene',
    source: new URL('../../../database/migrations/0020_multi_npc_scene.sql', import.meta.url),
  },
  {
    version: 21,
    name: 'immutable_npc_timeline',
    source: new URL(
      '../../../database/migrations/0021_immutable_npc_timeline.sql',
      import.meta.url,
    ),
  },
  {
    version: 22,
    name: 'dialogue_suggestion_cache',
    source: new URL(
      '../../../database/migrations/0022_dialogue_suggestion_cache.sql',
      import.meta.url,
    ),
  },
  {
    version: 23,
    name: 'multi_quest_pool',
    source: new URL('../../../database/migrations/0023_multi_quest_pool.sql', import.meta.url),
  },
  {
    version: 24,
    name: 'quest_graph',
    source: new URL('../../../database/migrations/0024_quest_graph.sql', import.meta.url),
  },
  {
    version: 25,
    name: 'dynamic_quest_sources',
    source: new URL('../../../database/migrations/0025_dynamic_quest_sources.sql', import.meta.url),
  },
  {
    version: 26,
    name: 'world_director',
    source: new URL('../../../database/migrations/0026_world_director.sql', import.meta.url),
  },
  {
    version: 27,
    name: 'director_budget',
    source: new URL('../../../database/migrations/0027_director_budget.sql', import.meta.url),
  },
  {
    version: 28,
    name: 'memory_layers',
    source: new URL('../../../database/migrations/0028_memory_layers.sql', import.meta.url),
  },
  {
    version: 29,
    name: 'world_info_retrieval',
    source: new URL('../../../database/migrations/0029_world_info_retrieval.sql', import.meta.url),
  },
  {
    version: 30,
    name: 'lazy_world_generation',
    source: new URL('../../../database/migrations/0030_lazy_world_generation.sql', import.meta.url),
  },
  {
    version: 31,
    name: 'prefetch',
    source: new URL('../../../database/migrations/0031_prefetch.sql', import.meta.url),
  },
  {
    version: 32,
    name: 'save_schema',
    source: new URL('../../../database/migrations/0032_save_schema.sql', import.meta.url),
  },
];

export const migrationManifest = Object.freeze(
  migrations.map(({ version, name }) => Object.freeze({ version, name })),
);
export const currentSchemaVersion = migrations.at(-1)?.version ?? 0;

export async function applyMigrations(database) {
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const findApplied = database.prepare('SELECT version FROM schema_migrations WHERE version = ?');
  const recordApplied = database.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );

  for (const migration of migrations) {
    if (findApplied.get(migration.version) !== undefined) continue;
    const sql = await readFile(migration.source, 'utf8');
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(sql);
      recordApplied.run(migration.version, migration.name, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}

export const migrationCount = migrations.length;
