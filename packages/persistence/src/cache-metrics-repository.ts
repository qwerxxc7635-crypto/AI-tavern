import { PersistenceDataError } from './campaign-repository.js';
import { requireArray, requireNumber, requireRecord, requireString } from './persistence-validation.js';
import type { TransactionalSqliteDatabase } from './sqlite-port.js';

const SETTINGS_KEY = 'deepseek_cache_metrics_v1';
const MAX_METRICS = 200;
const AI_TASKS = new Set([
  'GENERATE_WORLD',
  'REFINE_WORLD',
  'GENERATE_CHARACTER_TRAITS',
  'COMPLETE_CHARACTER_BACKGROUND',
  'GENERATE_TAVERN',
  'GENERATE_NPCS',
  'NPC_REPLY',
  'GENERATE_QUEST',
  'GENERATE_ADVENTURE_PLAN',
  'GENERATE_ADVENTURE_TURN',
  'RESOLVE_DICE_RESULT',
  'GENERATE_WORLD_EVENT',
  'SUMMARIZE_ADVENTURE',
  'EXTRACT_MEMORIES',
  'CHECK_CONSISTENCY',
]);

export interface CacheMetricInput {
  readonly taskType: string;
  readonly promptCacheHitTokens: number;
  readonly promptCacheMissTokens: number;
  readonly prefixHash: string;
  readonly recordedAt: string;
}

export interface CacheMetric extends CacheMetricInput {
  readonly hitRatio: number;
}

export class CacheMetricsRepository {
  constructor(private readonly database: TransactionalSqliteDatabase) {}

  record(input: CacheMetricInput): CacheMetric {
    const metric = validateMetric({
      ...input,
      hitRatio: ratio(input.promptCacheHitTokens, input.promptCacheMissTokens),
    });
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.readAll();
      const metrics = [...existing, metric].slice(-MAX_METRICS);
      this.database
        .prepare(
          `INSERT INTO app_settings (key, value_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             value_json = excluded.value_json, updated_at = excluded.updated_at`,
        )
        .run(SETTINGS_KEY, JSON.stringify(metrics), metric.recordedAt);
      this.database.exec('COMMIT');
      return metric;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  list(): readonly CacheMetric[] {
    return Object.freeze(this.readAll());
  }

  private readAll(): CacheMetric[] {
    const row = this.database
      .prepare('SELECT value_json FROM app_settings WHERE key = ?')
      .get(SETTINGS_KEY);
    if (row === undefined) return [];
    try {
      const record = requireRecord(row, 'Cache metrics setting');
      const text = requireString(record['value_json'], 'value_json');
      const values = requireArray(JSON.parse(text) as unknown, 'cache metrics');
      if (values.length > MAX_METRICS) {
        throw new PersistenceDataError('Cache metrics exceed the local retention limit');
      }
      return values.map(validateMetric);
    } catch (error) {
      if (error instanceof PersistenceDataError) throw error;
      throw new PersistenceDataError('Stored cache metrics are invalid', { cause: error });
    }
  }
}

function validateMetric(value: unknown): CacheMetric {
  const record = requireRecord(value, 'Cache metric');
  const allowed = new Set([
    'taskType',
    'promptCacheHitTokens',
    'promptCacheMissTokens',
    'hitRatio',
    'prefixHash',
    'recordedAt',
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new PersistenceDataError('Cache metric contains an unknown field');
  }
  const taskType = requireString(record['taskType'], 'taskType');
  const hit = requireNumber(record['promptCacheHitTokens'], 'promptCacheHitTokens');
  const miss = requireNumber(record['promptCacheMissTokens'], 'promptCacheMissTokens');
  const hitRatio = requireNumber(record['hitRatio'], 'hitRatio');
  const prefixHash = requireString(record['prefixHash'], 'prefixHash');
  const recordedAt = requireString(record['recordedAt'], 'recordedAt');
  if (
    !AI_TASKS.has(taskType) ||
    !Number.isSafeInteger(hit) ||
    hit < 0 ||
    !Number.isSafeInteger(miss) ||
    miss < 0 ||
    !Number.isSafeInteger(hit + miss) ||
    hitRatio !== ratio(hit, miss) ||
    !/^[0-9a-f]{64}$/.test(prefixHash) ||
    !isTimestamp(recordedAt)
  ) {
    throw new PersistenceDataError('Cache metric is invalid');
  }
  return Object.freeze({
    taskType,
    promptCacheHitTokens: hit,
    promptCacheMissTokens: miss,
    hitRatio,
    prefixHash,
    recordedAt,
  });
}

function ratio(hit: number, miss: number): number {
  const total = hit + miss;
  return total === 0 ? 0 : hit / total;
}

function isTimestamp(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}
