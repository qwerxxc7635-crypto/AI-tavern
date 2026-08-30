import type { AITask } from './protocol.js';

export const BASELINE_TASKS = [
  'GENERATE_WORLD',
  'GENERATE_NPCS',
  'GENERATE_QUEST',
  'GENERATE_ADVENTURE_TURN',
  'RESOLVE_DICE_RESULT',
] as const satisfies readonly AITask[];

export type BaselineTask = (typeof BASELINE_TASKS)[number];
export type BaselineProviderKind = 'FAKE' | 'REAL';
export type BaselineScenario = 'NORMAL' | 'CONTROLLED_RETRY' | 'CONTROLLED_FAILURE';
export type BaselineStatus = 'SUCCEEDED' | 'FAILED';

export interface PerformanceMetric {
  readonly schemaVersion: 1;
  readonly task: BaselineTask;
  readonly providerKind: BaselineProviderKind;
  readonly scenario: BaselineScenario;
  readonly status: BaselineStatus;
  readonly latencyMs: number;
  readonly queueWaitMs: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly promptCacheHitTokens: number | null;
  readonly promptCacheMissTokens: number | null;
  readonly retryCount: number;
  readonly errorCode: string | null;
}

export interface PerformanceSummary {
  readonly task: BaselineTask;
  readonly samples: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly retries: number;
  readonly latencyP50Ms: number;
  readonly latencyP95Ms: number;
  readonly queueWaitP50Ms: number;
  readonly queueWaitP95Ms: number;
  readonly inputTokensTotal: number | null;
  readonly outputTokensTotal: number | null;
  readonly promptCacheHitTokensTotal: number | null;
  readonly promptCacheMissTokensTotal: number | null;
}

export interface PerformanceBaselineReport {
  readonly schemaVersion: 1;
  readonly evidenceKind: BaselineProviderKind;
  readonly realProviderStatus: 'NOT_RUN' | 'RUN';
  readonly recordedAt: string;
  readonly sourceCommit: string;
  readonly environment: Readonly<{
    node: string;
    platform: string;
    architecture: string;
    iterationsPerTask: number;
  }>;
  readonly samples: readonly PerformanceMetric[];
  readonly summary: readonly PerformanceSummary[];
}

const ALLOWED_FIELDS = new Set([
  'schemaVersion',
  'task',
  'providerKind',
  'scenario',
  'status',
  'latencyMs',
  'queueWaitMs',
  'inputTokens',
  'outputTokens',
  'promptCacheHitTokens',
  'promptCacheMissTokens',
  'retryCount',
  'errorCode',
]);

export function validatePerformanceMetric(value: unknown): PerformanceMetric {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Performance metric must be an object');
  }
  const metric = value as Readonly<Record<string, unknown>>;
  if (Object.keys(metric).some((field) => !ALLOWED_FIELDS.has(field))) {
    throw new TypeError('Performance metric contains a forbidden field');
  }
  if (
    metric['schemaVersion'] !== 1 ||
    !BASELINE_TASKS.includes(metric['task'] as BaselineTask) ||
    !['FAKE', 'REAL'].includes(metric['providerKind'] as string) ||
    !['NORMAL', 'CONTROLLED_RETRY', 'CONTROLLED_FAILURE'].includes(metric['scenario'] as string) ||
    !['SUCCEEDED', 'FAILED'].includes(metric['status'] as string)
  ) {
    throw new TypeError('Performance metric identity is invalid');
  }
  const latencyMs = duration(metric['latencyMs'], 'latency');
  const queueWaitMs = duration(metric['queueWaitMs'], 'queue wait');
  if (queueWaitMs > latencyMs) throw new TypeError('Queue wait exceeds total latency');
  const retryCount = count(metric['retryCount'], 'retry count', 100);
  const errorCode = nullableErrorCode(metric['errorCode']);
  if (
    (metric['status'] === 'SUCCEEDED' && errorCode !== null) ||
    (metric['status'] === 'FAILED' && errorCode === null)
  ) {
    throw new TypeError('Performance metric failure identity is inconsistent');
  }
  return Object.freeze({
    schemaVersion: 1,
    task: metric['task'] as BaselineTask,
    providerKind: metric['providerKind'] as BaselineProviderKind,
    scenario: metric['scenario'] as BaselineScenario,
    status: metric['status'] as BaselineStatus,
    latencyMs,
    queueWaitMs,
    inputTokens: nullableCount(metric['inputTokens'], 'input tokens'),
    outputTokens: nullableCount(metric['outputTokens'], 'output tokens'),
    promptCacheHitTokens: nullableCount(metric['promptCacheHitTokens'], 'cache hit tokens'),
    promptCacheMissTokens: nullableCount(metric['promptCacheMissTokens'], 'cache miss tokens'),
    retryCount,
    errorCode,
  });
}

export function summarizePerformanceMetrics(
  values: readonly unknown[],
): readonly PerformanceSummary[] {
  if (values.length === 0 || values.length > 500) {
    throw new TypeError('Performance baseline must contain 1 to 500 samples');
  }
  const metrics = values.map(validatePerformanceMetric);
  return Object.freeze(
    BASELINE_TASKS.flatMap((task) => {
      const taskMetrics = metrics.filter((metric) => metric.task === task);
      if (taskMetrics.length === 0) return [];
      return [
        Object.freeze({
          task,
          samples: taskMetrics.length,
          succeeded: taskMetrics.filter(({ status }) => status === 'SUCCEEDED').length,
          failed: taskMetrics.filter(({ status }) => status === 'FAILED').length,
          retries: taskMetrics.reduce((total, metric) => total + metric.retryCount, 0),
          latencyP50Ms: percentile(
            taskMetrics.map(({ latencyMs }) => latencyMs),
            0.5,
          ),
          latencyP95Ms: percentile(
            taskMetrics.map(({ latencyMs }) => latencyMs),
            0.95,
          ),
          queueWaitP50Ms: percentile(
            taskMetrics.map(({ queueWaitMs }) => queueWaitMs),
            0.5,
          ),
          queueWaitP95Ms: percentile(
            taskMetrics.map(({ queueWaitMs }) => queueWaitMs),
            0.95,
          ),
          inputTokensTotal: totalOrUnknown(taskMetrics.map(({ inputTokens }) => inputTokens)),
          outputTokensTotal: totalOrUnknown(taskMetrics.map(({ outputTokens }) => outputTokens)),
          promptCacheHitTokensTotal: totalOrUnknown(
            taskMetrics.map(({ promptCacheHitTokens }) => promptCacheHitTokens),
          ),
          promptCacheMissTokensTotal: totalOrUnknown(
            taskMetrics.map(({ promptCacheMissTokens }) => promptCacheMissTokens),
          ),
        }),
      ];
    }),
  );
}

export function validatePerformanceBaselineReport(value: unknown): PerformanceBaselineReport {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Performance baseline report must be an object');
  }
  const report = value as Readonly<Record<string, unknown>>;
  const allowed = new Set([
    'schemaVersion',
    'evidenceKind',
    'realProviderStatus',
    'recordedAt',
    'sourceCommit',
    'environment',
    'samples',
    'summary',
  ]);
  if (Object.keys(report).some((field) => !allowed.has(field))) {
    throw new TypeError('Performance baseline report contains a forbidden field');
  }
  if (
    report['schemaVersion'] !== 1 ||
    !['FAKE', 'REAL'].includes(report['evidenceKind'] as string) ||
    !['NOT_RUN', 'RUN'].includes(report['realProviderStatus'] as string) ||
    typeof report['recordedAt'] !== 'string' ||
    new Date(report['recordedAt']).toISOString() !== report['recordedAt'] ||
    typeof report['sourceCommit'] !== 'string' ||
    !/^[0-9a-f]{40}$/.test(report['sourceCommit']) ||
    !Array.isArray(report['samples']) ||
    !Array.isArray(report['summary'])
  ) {
    throw new TypeError('Performance baseline report identity is invalid');
  }
  const environment = validateEnvironment(report['environment']);
  const samples = Object.freeze(report['samples'].map(validatePerformanceMetric));
  if (samples.some(({ providerKind }) => providerKind !== report['evidenceKind'])) {
    throw new TypeError('Performance baseline evidence kind is inconsistent');
  }
  if (report['evidenceKind'] === 'FAKE' && report['realProviderStatus'] !== 'NOT_RUN') {
    throw new TypeError('Fake evidence cannot claim a real Provider run');
  }
  const summary = summarizePerformanceMetrics(samples);
  if (JSON.stringify(summary) !== JSON.stringify(report['summary'])) {
    throw new TypeError('Performance baseline summary is inconsistent');
  }
  return Object.freeze({
    schemaVersion: 1,
    evidenceKind: report['evidenceKind'] as BaselineProviderKind,
    realProviderStatus: report['realProviderStatus'] as 'NOT_RUN' | 'RUN',
    recordedAt: report['recordedAt'],
    sourceCommit: report['sourceCommit'],
    environment,
    samples,
    summary,
  });
}

function duration(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 600_000) {
    throw new TypeError(`Performance ${label} is invalid`);
  }
  return value;
}

function count(value: unknown, label: string, maximum = 1_000_000_000): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new TypeError(`Performance ${label} is invalid`);
  }
  return value as number;
}

function nullableCount(value: unknown, label: string): number | null {
  return value === null ? null : count(value, label);
}

function nullableErrorCode(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[A-Z0-9_]{2,64}$/.test(value)) {
    throw new TypeError('Performance error code is invalid');
  }
  return value;
}

function percentile(values: readonly number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index] ?? 0;
}

function totalOrUnknown(values: readonly (number | null)[]): number | null {
  return values.some((value) => value === null)
    ? null
    : values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function validateEnvironment(value: unknown): PerformanceBaselineReport['environment'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Performance baseline environment is invalid');
  }
  const environment = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(environment).some(
      (field) => !['node', 'platform', 'architecture', 'iterationsPerTask'].includes(field),
    ) ||
    typeof environment['node'] !== 'string' ||
    !/^v\d+\.\d+\.\d+$/.test(environment['node']) ||
    typeof environment['platform'] !== 'string' ||
    !/^[a-z0-9_-]{2,32}$/.test(environment['platform']) ||
    typeof environment['architecture'] !== 'string' ||
    !/^[a-z0-9_-]{2,32}$/.test(environment['architecture'])
  ) {
    throw new TypeError('Performance baseline environment is invalid');
  }
  const iterationsPerTask = count(environment['iterationsPerTask'], 'iterations per task', 100);
  if (iterationsPerTask < 1) throw new TypeError('Performance baseline iterations are invalid');
  return Object.freeze({
    node: environment['node'],
    platform: environment['platform'],
    architecture: environment['architecture'],
    iterationsPerTask,
  });
}
