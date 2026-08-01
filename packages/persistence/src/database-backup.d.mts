export type DatabaseBackupFailureCode =
  | 'BACKUP_CLOSE_FAILED'
  | 'BACKUP_CONFIGURATION_INVALID'
  | 'BACKUP_FAILED'
  | 'BACKUP_INTEGRITY_FAILED';

export interface DatabaseBackupOptions {
  readonly backupDirectory?: string;
  readonly retention?: number;
}

export interface DatabaseBackupResult {
  readonly databasePath: string;
  readonly backupPath: string;
  readonly createdAt: string;
  readonly sizeBytes: number;
}

export class DatabaseBackupError extends Error {
  readonly code: DatabaseBackupFailureCode;
}

export function createConsistentDatabaseBackup(
  databasePath: string,
  options?: DatabaseBackupOptions,
): Promise<Readonly<DatabaseBackupResult>>;

export function listConsistentDatabaseBackups(
  databasePath: string,
  options?: Pick<DatabaseBackupOptions, 'backupDirectory'>,
): Promise<readonly string[]>;
