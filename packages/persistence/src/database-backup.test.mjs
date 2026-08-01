import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  createConsistentDatabaseBackup,
  listConsistentDatabaseBackups,
} from './database-backup.mjs';

async function withDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), 'ember-tavern-backup-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('creates database-consistent online backups and retains the newest three', async () => {
  await withDirectory(async (directory) => {
    const databasePath = join(directory, 'campaign.sqlite');
    const source = new DatabaseSync(databasePath);
    source.exec(
      'PRAGMA journal_mode = WAL; CREATE TABLE facts (id INTEGER PRIMARY KEY, value TEXT)',
    );

    for (let id = 1; id <= 4; id += 1) {
      source.prepare('INSERT INTO facts (id, value) VALUES (?, ?)').run(id, `fact-${id}`);
      await createConsistentDatabaseBackup(databasePath);
    }

    const backups = await listConsistentDatabaseBackups(databasePath);
    assert.equal(backups.length, 3);
    const counts = backups.map((backupPath) => {
      const copy = new DatabaseSync(backupPath, { readOnly: true });
      try {
        assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
        return copy.prepare('SELECT COUNT(*) AS count FROM facts').get().count;
      } finally {
        copy.close();
      }
    });
    assert.deepEqual(counts, [4, 3, 2]);
    source.close();
  });
});

test('does not mutate the main database when the backup destination fails', async () => {
  await withDirectory(async (directory) => {
    const databasePath = join(directory, 'campaign.sqlite');
    const source = new DatabaseSync(databasePath);
    source.exec("CREATE TABLE facts (value TEXT NOT NULL); INSERT INTO facts VALUES ('untouched')");
    source.close();
    const before = await digest(databasePath);
    const invalidDirectory = join(directory, 'not-a-directory');
    await writeFile(invalidDirectory, 'occupied', 'utf8');

    await assert.rejects(
      createConsistentDatabaseBackup(databasePath, { backupDirectory: invalidDirectory }),
      (error) => error.code === 'BACKUP_FAILED',
    );

    assert.equal(await digest(databasePath), before);
    const reopened = new DatabaseSync(databasePath, { readOnly: true });
    assert.equal(reopened.prepare('SELECT value FROM facts').get().value, 'untouched');
    reopened.close();
  });
});

async function digest(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}
