export type DatabaseStartupFailureCode =
  | 'ACTIVE_DATABASE'
  | 'CLEANUP_FAILED'
  | 'DATABASE_CLOSE_FAILED'
  | 'DATABASE_CREATE_FAILED'
  | 'DATABASE_SWITCH_FAILED'
  | 'INTEGRITY_CHECK_FAILED'
  | 'MIGRATION_FAILED'
  | 'MIGRATION_INCOMPLETE'
  | 'SCHEMA_HISTORY_INVALID'
  | 'SCHEMA_TOO_NEW';

export type DatabaseStartupResult =
  | Readonly<{
      status: 'READY' | 'MIGRATED';
      databasePath: string;
      fromVersion: number;
      toVersion: number;
      backupPath: string | null;
    }>
  | Readonly<{
      status: 'FAILED';
      databasePath: string;
      error: Readonly<{
        code: DatabaseStartupFailureCode;
        message: string;
        originalPreserved: boolean;
      }>;
    }>;

export class DatabaseStartupError extends Error {
  readonly code: DatabaseStartupFailureCode;
}

export function prepareDatabaseFile(databasePath: string): Promise<DatabaseStartupResult>;
