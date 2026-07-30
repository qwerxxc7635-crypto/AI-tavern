export type SqliteValue = string | number | bigint | Uint8Array | null;

export interface SqliteRunResult {
  readonly changes: number | bigint;
}

export interface SqliteStatement {
  run(...values: SqliteValue[]): SqliteRunResult;
  get(...values: SqliteValue[]): unknown;
  all(...values: SqliteValue[]): readonly unknown[];
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
}
