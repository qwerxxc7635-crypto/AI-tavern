import type { DatabaseSync } from 'node:sqlite';

export function applyMigrations(database: DatabaseSync): Promise<void>;
export const migrationCount: number;
export const currentSchemaVersion: number;
export const migrationManifest: readonly Readonly<{
  version: number;
  name: string;
}>[];
