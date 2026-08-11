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
