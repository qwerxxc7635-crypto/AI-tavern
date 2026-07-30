import { constants } from 'node:fs';
import { access, copyFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { applyMigrations, currentSchemaVersion, migrationManifest } from './migrations.mjs';

export class DatabaseStartupError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'DatabaseStartupError';
    this.code = code;
  }
}

export async function prepareDatabaseFile(databasePath) {
  const existed = await pathExists(databasePath);
  if (existed) {
    const sidecars = await existingSidecars(databasePath);
    if (sidecars.length > 0) {
      return failure(
        new DatabaseStartupError(
          'ACTIVE_DATABASE',
          `Database has active SQLite sidecar files: ${sidecars.join(', ')}`,
        ),
        databasePath,
        true,
      );
    }
    return migrateExistingFile(databasePath);
  }
  return createNewFile(databasePath);
}

async function createNewFile(databasePath) {
  let database;
  try {
    database = new DatabaseSync(databasePath);
    await applyMigrations(database);
    assertIntegrity(database);
    const version = inspectSchemaVersion(database);
    database.close();
    return Object.freeze({
      status: 'READY',
      databasePath,
      fromVersion: 0,
      toVersion: version,
      backupPath: null,
    });
  } catch (error) {
    let startupError = closeAfterFailure(database, asStartupError(error, 'DATABASE_CREATE_FAILED'));
    startupError = await removeAfterFailure(databasePath, startupError);
    return failure(startupError, databasePath, false);
  }
}

async function migrateExistingFile(databasePath) {
  const token = randomUUID();
  const workingPath = `${databasePath}.migration-${token}.tmp`;
  const backupPath = `${databasePath}.pre-migration-${token}.sqlite`;
  let database;
  try {
    await copyFile(databasePath, workingPath, constants.COPYFILE_EXCL);
    database = new DatabaseSync(workingPath);
    assertIntegrity(database);
    const fromVersion = inspectSchemaVersion(database);
    assertCompatibleVersion(fromVersion);
    if (fromVersion === currentSchemaVersion) {
      database.close();
      database = undefined;
      await rm(workingPath, { force: true });
      return Object.freeze({
        status: 'READY',
        databasePath,
        fromVersion,
        toVersion: fromVersion,
        backupPath: null,
      });
    }

    await applyMigrations(database);
    assertIntegrity(database);
    const toVersion = inspectSchemaVersion(database);
    if (toVersion !== currentSchemaVersion) {
      throw new DatabaseStartupError(
        'MIGRATION_INCOMPLETE',
        `Migration stopped at schema ${toVersion}; expected ${currentSchemaVersion}`,
      );
    }
    database.close();
    database = undefined;

    await rename(databasePath, backupPath);
    try {
      await rename(workingPath, databasePath);
    } catch (error) {
      await restoreOriginal(backupPath, databasePath, error);
    }
    return Object.freeze({
      status: 'MIGRATED',
      databasePath,
      fromVersion,
      toVersion,
      backupPath,
    });
  } catch (error) {
    let startupError = closeAfterFailure(database, asStartupError(error, 'MIGRATION_FAILED'));
    startupError = await removeAfterFailure(workingPath, startupError);
    return failure(startupError, databasePath, true);
  }
}

function inspectSchemaVersion(database) {
  const table = database
    .prepare(
      `SELECT 1 AS present
       FROM sqlite_master
       WHERE type = 'table' AND name = 'schema_migrations'`,
    )
    .get();
  if (table === undefined) return 0;
  const rows = database
    .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
    .all();
  if (rows.length === 0) return 0;
  const newest = rows.at(-1);
  if (newest !== undefined && newest.version > currentSchemaVersion) {
    throw new DatabaseStartupError(
      'SCHEMA_TOO_NEW',
      `Database schema ${newest.version} is newer than supported schema ${currentSchemaVersion}`,
    );
  }
  for (const [index, row] of rows.entries()) {
    const expected = migrationManifest[index];
    if (expected === undefined || row.version !== expected.version || row.name !== expected.name) {
      throw new DatabaseStartupError(
        'SCHEMA_HISTORY_INVALID',
        `Unknown or non-contiguous migration record at position ${index + 1}`,
      );
    }
  }
  return rows.at(-1).version;
}

function assertCompatibleVersion(version) {
  if (version > currentSchemaVersion) {
    throw new DatabaseStartupError(
      'SCHEMA_TOO_NEW',
      `Database schema ${version} is newer than supported schema ${currentSchemaVersion}`,
    );
  }
}

function assertIntegrity(database) {
  let rows;
  try {
    rows = database.prepare('PRAGMA integrity_check').all();
  } catch (error) {
    throw new DatabaseStartupError(
      'INTEGRITY_CHECK_FAILED',
      `SQLite integrity check could not run: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (rows.length !== 1 || rows[0] === undefined || rows[0].integrity_check !== 'ok') {
    const details = rows.map((row) => String(row.integrity_check)).join('; ');
    throw new DatabaseStartupError(
      'INTEGRITY_CHECK_FAILED',
      `SQLite integrity check failed: ${details || 'no result'}`,
    );
  }
}

async function existingSidecars(databasePath) {
  const candidates = [`${databasePath}-journal`, `${databasePath}-wal`, `${databasePath}-shm`];
  const checks = await Promise.all(
    candidates.map(async (path) => ((await pathExists(path)) ? path : null)),
  );
  return checks.filter((path) => path !== null);
}

async function restoreOriginal(backupPath, databasePath, switchError) {
  try {
    await rename(backupPath, databasePath);
  } catch (restoreError) {
    throw new AggregateError(
      [switchError, restoreError],
      `Database switch failed; original remains at ${backupPath}`,
      { cause: restoreError },
    );
  }
  throw new DatabaseStartupError(
    'DATABASE_SWITCH_FAILED',
    'Migrated database could not replace the original; original was restored',
    { cause: switchError },
  );
}

function asStartupError(error, fallbackCode) {
  if (error instanceof DatabaseStartupError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new DatabaseStartupError(fallbackCode, message, { cause: error });
}

function failure(error, databasePath, originalPreserved) {
  return Object.freeze({
    status: 'FAILED',
    databasePath,
    error: Object.freeze({
      code: error.code,
      message: error.message,
      originalPreserved,
    }),
  });
}

function closeAfterFailure(database, primaryError) {
  if (database === undefined) return primaryError;
  try {
    database.close();
    return primaryError;
  } catch (closeError) {
    return new DatabaseStartupError(
      'DATABASE_CLOSE_FAILED',
      `Database startup failed and the working connection could not close: ${
        closeError instanceof Error ? closeError.message : String(closeError)
      }`,
      { cause: new AggregateError([primaryError, closeError]) },
    );
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function removeAfterFailure(path, primaryError) {
  try {
    await rm(path, { force: true });
    return primaryError;
  } catch (cleanupError) {
    return new DatabaseStartupError(
      'CLEANUP_FAILED',
      `Database startup failed and its working file could not be removed: ${
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      }`,
      { cause: new AggregateError([primaryError, cleanupError]) },
    );
  }
}
