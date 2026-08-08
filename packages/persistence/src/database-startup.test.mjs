import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { prepareDatabaseFile } from './database-startup.mjs';

async function withDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), 'ember-tavern-startup-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('upgrades an old schema on a copy and preserves a pre-migration database', async () => {
  await withDirectory(async (directory) => {
    const path = join(directory, 'campaign.sqlite');
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE legacy_notes (id TEXT PRIMARY KEY, note TEXT NOT NULL);
      INSERT INTO legacy_notes (id, note) VALUES ('note-1', 'keep me');
    `);
    old.close();

    const result = await prepareDatabaseFile(path);

    assert.equal(result.status, 'MIGRATED');
    assert.equal(result.fromVersion, 0);
    assert.equal(result.toVersion, 3);
    assert.notEqual(result.backupPath, null);
    await access(result.backupPath);

    const migrated = new DatabaseSync(path, { readOnly: true });
    assert.equal(
      migrated.prepare('SELECT note FROM legacy_notes WHERE id = ?').get('note-1').note,
      'keep me',
    );
    assert.deepEqual(
      migrated
        .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
        .all()
        .map((row) => ({ ...row })),
      [
        { version: 1, name: 'initial' },
        { version: 2, name: 'credential_cleanup_queue' },
        { version: 3, name: 'provider_probe_consistency' },
      ],
    );
    assert.equal(migrated.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    migrated.close();

    const backup = new DatabaseSync(result.backupPath, { readOnly: true });
    assert.equal(
      backup
        .prepare(
          `SELECT COUNT(*) AS count FROM sqlite_master
           WHERE type = 'table' AND name = 'schema_migrations'`,
        )
        .get().count,
      0,
    );
    assert.equal(
      backup.prepare('SELECT note FROM legacy_notes WHERE id = ?').get('note-1').note,
      'keep me',
    );
    backup.close();
  });
});

test('keeps the original bytes unchanged when migration fails', async () => {
  await withDirectory(async (directory) => {
    const path = join(directory, 'campaign.sqlite');
    const incompatible = new DatabaseSync(path);
    incompatible.exec(`
      CREATE TABLE campaigns (id TEXT PRIMARY KEY, legacy_value TEXT NOT NULL);
      INSERT INTO campaigns (id, legacy_value) VALUES ('legacy-1', 'untouched');
    `);
    incompatible.close();
    const before = await digest(path);

    const result = await prepareDatabaseFile(path);

    assert.equal(result.status, 'FAILED');
    assert.equal(result.error.code, 'MIGRATION_FAILED');
    assert.equal(result.error.originalPreserved, true);
    assert.equal(await digest(path), before);
    const reopened = new DatabaseSync(path, { readOnly: true });
    assert.equal(
      reopened.prepare('SELECT legacy_value FROM campaigns WHERE id = ?').get('legacy-1')
        .legacy_value,
      'untouched',
    );
    reopened.close();
  });
});

test('does not start migration or mutate the original when its required backup fails', async () => {
  await withDirectory(async (directory) => {
    const path = join(directory, 'campaign.sqlite');
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE legacy_notes (id TEXT PRIMARY KEY, note TEXT NOT NULL);
      INSERT INTO legacy_notes (id, note) VALUES ('note-1', 'keep me');
    `);
    old.close();
    const before = await digest(path);
    const invalidDirectory = join(directory, 'not-a-directory');
    await writeFile(invalidDirectory, 'occupied', 'utf8');

    const result = await prepareDatabaseFile(path, { backupDirectory: invalidDirectory });

    assert.equal(result.status, 'FAILED');
    assert.equal(result.error.code, 'BACKUP_FAILED');
    assert.equal(result.error.originalPreserved, true);
    assert.equal(await digest(path), before);
    const reopened = new DatabaseSync(path, { readOnly: true });
    assert.equal(
      reopened.prepare('SELECT note FROM legacy_notes WHERE id = ?').get('note-1').note,
      'keep me',
    );
    reopened.close();
  });
});

test('rejects a newer schema with a clear failure and no file mutation', async () => {
  await withDirectory(async (directory) => {
    const path = join(directory, 'future.sqlite');
    const future = new DatabaseSync(path);
    future.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (99, 'future', '2026-07-31T00:00:00.000Z');
    `);
    future.close();
    const before = await digest(path);

    const result = await prepareDatabaseFile(path);

    assert.equal(result.status, 'FAILED');
    assert.equal(result.error.code, 'SCHEMA_TOO_NEW');
    assert.match(result.error.message, /newer than supported/);
    assert.equal(await digest(path), before);
  });
});

test('reports corrupt databases without replacing the damaged evidence', async () => {
  await withDirectory(async (directory) => {
    const path = join(directory, 'corrupt.sqlite');
    await writeFile(path, 'not a sqlite database', 'utf8');
    const before = await digest(path);

    const result = await prepareDatabaseFile(path);

    assert.equal(result.status, 'FAILED');
    assert.equal(result.error.code, 'INTEGRITY_CHECK_FAILED');
    assert.equal(result.error.originalPreserved, true);
    assert.equal(await digest(path), before);
  });
});

async function digest(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}
