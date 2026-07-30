import type { DatabaseSync } from 'node:sqlite';

export function applyMigrations(database: DatabaseSync): Promise<void>;
export const migrationCount: number;
