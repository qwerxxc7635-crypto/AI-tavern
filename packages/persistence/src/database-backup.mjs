import { randomUUID } from 'node:crypto';
import { access, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

const DEFAULT_RETENTION = 3;

export class DatabaseBackupError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'DatabaseBackupError';
    this.code = code;
  }
}

export async function createConsistentDatabaseBackup(databasePath, options = {}) {
  const backupDirectory = options.backupDirectory ?? `${databasePath}.backups`;
  const retention = options.retention ?? DEFAULT_RETENTION;
  requireRetention(retention);

  const token = randomUUID();
  const prefix = `${basename(databasePath)}.full-`;
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const finalPath = join(backupDirectory, `${prefix}${timestamp}-${token}.sqlite`);
  const workingPath = `${finalPath}.tmp`;
  let source;
  let finalCreated = false;

  try {
    await access(databasePath);
    await mkdir(backupDirectory, { recursive: true });
    source = new DatabaseSync(databasePath, { readOnly: true });
    assertIntegrity(source, 'source');
    await backup(source, workingPath);
    source.close();
    source = undefined;

    const copy = new DatabaseSync(workingPath, { readOnly: true });
    try {
      assertIntegrity(copy, 'backup');
    } finally {
      copy.close();
    }

    await rename(workingPath, finalPath);
    finalCreated = true;
    await rotateBackups(backupDirectory, prefix, retention);
    const details = await stat(finalPath);
    return Object.freeze({
      databasePath,
      backupPath: finalPath,
      createdAt: details.mtime.toISOString(),
      sizeBytes: details.size,
    });
  } catch (error) {
    const backupError = asBackupError(error);
    try {
      if (source !== undefined) source.close();
    } catch (closeError) {
      throw new DatabaseBackupError(
        'BACKUP_CLOSE_FAILED',
        'Database backup failed and the read-only source connection could not close',
        { cause: new AggregateError([backupError, closeError]) },
      );
    } finally {
      await rm(workingPath, { force: true }).catch(() => undefined);
      if (finalCreated) await rm(finalPath, { force: true }).catch(() => undefined);
    }
    throw backupError;
  }
}

export async function listConsistentDatabaseBackups(databasePath, options = {}) {
  const backupDirectory = options.backupDirectory ?? `${databasePath}.backups`;
  const prefix = `${basename(databasePath)}.full-`;
  let entries;
  try {
    entries = await readdir(backupDirectory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return Object.freeze([]);
    throw asBackupError(error);
  }
  const paths = entries
    .filter(
      (entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith('.sqlite'),
    )
    .map((entry) => join(backupDirectory, entry.name))
    .sort()
    .reverse();
  return Object.freeze(paths);
}

async function rotateBackups(directory, prefix, retention) {
  const entries = await readdir(directory, { withFileTypes: true });
  const obsolete = entries
    .filter(
      (entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith('.sqlite'),
    )
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .slice(retention);
  for (const name of obsolete) await rm(join(directory, name));
}

function assertIntegrity(database, label) {
  let rows;
  try {
    rows = database.prepare('PRAGMA integrity_check').all();
  } catch (error) {
    throw new DatabaseBackupError(
      'BACKUP_INTEGRITY_FAILED',
      `SQLite ${label} integrity check could not run: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') {
    throw new DatabaseBackupError(
      'BACKUP_INTEGRITY_FAILED',
      `SQLite ${label} integrity check failed`,
    );
  }
}

function requireRetention(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DatabaseBackupError(
      'BACKUP_CONFIGURATION_INVALID',
      'Backup retention must be a positive safe integer',
    );
  }
}

function asBackupError(error) {
  if (error instanceof DatabaseBackupError) return error;
  return new DatabaseBackupError(
    'BACKUP_FAILED',
    error instanceof Error ? error.message : String(error),
    { cause: error },
  );
}

function isMissing(error) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
