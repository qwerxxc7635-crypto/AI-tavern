import {
  BASELINE_TASKS,
  validatePerformanceBaselineReport,
  type BaselineTask,
  type PerformanceBaselineReport,
  type PerformanceSummary,
} from './performance-metric.js';

export type PerformanceGateStatus = 'PASS' | 'FAIL' | 'NOT_EVALUATED';

export interface PerformanceReferenceSummary {
  readonly task: BaselineTask;
  readonly latencyP95Ms: number;
  readonly queueWaitP95Ms: number;
}

export interface PerformanceRegressionThresholds {
  readonly minimumRuns: number;
  readonly minimumIterationsPerTask: number;
  readonly latencyP95RatioMax: number;
  readonly latencyP95AbsoluteSlackMs: number;
  readonly queueP95RatioMax: number;
  readonly queueP95AbsoluteSlackMs: number;
  readonly generationQueueP95MaxMs: number;
  readonly databaseBytesPerTurnMax: number;
  readonly contextTokensMax: number;
  readonly contextGrowthRatioMax: number;
  readonly inputTokensPerSampleMax: number;
  readonly cacheHitRatioMin: number;
}

export interface LongSavePerformanceObservation {
  readonly smallTurns: number;
  readonly largeTurns: number;
  readonly databaseBytesAtSmall: number;
  readonly databaseBytesAtLarge: number;
  readonly contextTokensAtSmall: number;
  readonly contextTokensAtLarge: number;
  readonly generationQueueP95Ms: number;
}

export interface ProviderUsageObservation {
  readonly inputTokens: number | null;
  readonly sampleCount: number;
  readonly promptCacheHitTokens: number | null;
  readonly promptCacheMissTokens: number | null;
}

export interface PerformanceRegressionGateInput {
  readonly recordedAt: string;
  readonly sourceCommit: string;
  readonly baselineCommit: string;
  readonly baseline: readonly PerformanceReferenceSummary[];
  readonly coldRuns: readonly PerformanceBaselineReport[];
  readonly warmRuns: readonly PerformanceBaselineReport[];
  readonly longSave: LongSavePerformanceObservation;
  readonly usage: ProviderUsageObservation;
  readonly thresholds?: PerformanceRegressionThresholds;
}

export interface PerformanceGateCheck {
  readonly id: string;
  readonly status: PerformanceGateStatus;
  readonly observed: number | null;
  readonly threshold: string;
  readonly explanation: string;
}

export interface PerformanceRegressionReport {
  readonly schemaVersion: 1;
  readonly recordedAt: string;
  readonly sourceCommit: string;
  readonly baselineCommit: string;
  readonly evidenceKind: 'FAKE';
  readonly aggregation: 'MEDIAN_OF_RUN_P95';
  readonly coldRuns: number;
  readonly warmRuns: number;
  readonly iterationsPerTask: number;
  readonly baseline: readonly PerformanceReferenceSummary[];
  readonly current: readonly Readonly<{
    task: BaselineTask;
    coldLatencyP95MedianMs: number;
    warmLatencyP95MedianMs: number;
    coldQueueP95MedianMs: number;
    warmQueueP95MedianMs: number;
  }>[];
  readonly longSave: LongSavePerformanceObservation &
    Readonly<{
      databaseBytesPerAdditionalTurn: number;
      contextGrowthRatio: number;
    }>;
  readonly usage: ProviderUsageObservation;
  readonly thresholds: PerformanceRegressionThresholds;
  readonly checks: readonly PerformanceGateCheck[];
  readonly passed: boolean;
}

export const M1_T04_PERFORMANCE_REFERENCE = Object.freeze([
  Object.freeze({ task: 'GENERATE_WORLD', latencyP95Ms: 1.857, queueWaitP95Ms: 0.056 }),
  Object.freeze({ task: 'GENERATE_NPCS', latencyP95Ms: 2.003, queueWaitP95Ms: 1.077 }),
  Object.freeze({ task: 'GENERATE_QUEST', latencyP95Ms: 0.645, queueWaitP95Ms: 0.026 }),
  Object.freeze({ task: 'GENERATE_ADVENTURE_TURN', latencyP95Ms: 1.128, queueWaitP95Ms: 0.068 }),
  Object.freeze({ task: 'RESOLVE_DICE_RESULT', latencyP95Ms: 0.234, queueWaitP95Ms: 0.083 }),
]) satisfies readonly PerformanceReferenceSummary[];

export const DEFAULT_PERFORMANCE_REGRESSION_THRESHOLDS = Object.freeze({
  minimumRuns: 3,
  minimumIterationsPerTask: 10,
  latencyP95RatioMax: 3,
  latencyP95AbsoluteSlackMs: 5,
  queueP95RatioMax: 3,
  queueP95AbsoluteSlackMs: 5,
  generationQueueP95MaxMs: 50,
  databaseBytesPerTurnMax: 4096,
  contextTokensMax: 2048,
  contextGrowthRatioMax: 1.05,
  inputTokensPerSampleMax: 16_384,
  cacheHitRatioMin: 0.5,
}) satisfies PerformanceRegressionThresholds;

export function evaluatePerformanceRegression(
  input: PerformanceRegressionGateInput,
): PerformanceRegressionReport {
  validateIdentity(input);
  const thresholds = validateThresholds(
    input.thresholds ?? DEFAULT_PERFORMANCE_REGRESSION_THRESHOLDS,
  );
  const coldRuns = validateRuns(input.coldRuns, 'cold', thresholds);
  const warmRuns = validateRuns(input.warmRuns, 'warm', thresholds);
  const baseline = validateReference(input.baseline);
  const longSave = validateLongSave(input.longSave);
  const usage = validateUsage(input.usage);
  const current = BASELINE_TASKS.map((task) => {
    const cold = summariesFor(coldRuns, task);
    const warm = summariesFor(warmRuns, task);
    return Object.freeze({
      task,
      coldLatencyP95MedianMs: median(cold.map(({ latencyP95Ms }) => latencyP95Ms)),
      warmLatencyP95MedianMs: median(warm.map(({ latencyP95Ms }) => latencyP95Ms)),
      coldQueueP95MedianMs: median(cold.map(({ queueWaitP95Ms }) => queueWaitP95Ms)),
      warmQueueP95MedianMs: median(warm.map(({ queueWaitP95Ms }) => queueWaitP95Ms)),
    });
  });
  const databaseBytesPerAdditionalTurn =
    (longSave.databaseBytesAtLarge - longSave.databaseBytesAtSmall) /
    (longSave.largeTurns - longSave.smallTurns);
  const contextGrowthRatio =
    longSave.contextTokensAtSmall === 0
      ? Number.POSITIVE_INFINITY
      : longSave.contextTokensAtLarge / longSave.contextTokensAtSmall;
  const checks: PerformanceGateCheck[] = [];

  for (const observed of current) {
    const reference = baseline.find(({ task }) => task === observed.task);
    if (reference === undefined) throw new TypeError(`Missing baseline for ${observed.task}`);
    addRelativeCheck(
      checks,
      `${observed.task}.cold.latency_p95`,
      observed.coldLatencyP95MedianMs,
      reference.latencyP95Ms,
      thresholds.latencyP95RatioMax,
      thresholds.latencyP95AbsoluteSlackMs,
    );
    addRelativeCheck(
      checks,
      `${observed.task}.warm.latency_p95`,
      observed.warmLatencyP95MedianMs,
      reference.latencyP95Ms,
      thresholds.latencyP95RatioMax,
      thresholds.latencyP95AbsoluteSlackMs,
    );
    addRelativeCheck(
      checks,
      `${observed.task}.cold.queue_p95`,
      observed.coldQueueP95MedianMs,
      reference.queueWaitP95Ms,
      thresholds.queueP95RatioMax,
      thresholds.queueP95AbsoluteSlackMs,
    );
    addRelativeCheck(
      checks,
      `${observed.task}.warm.queue_p95`,
      observed.warmQueueP95MedianMs,
      reference.queueWaitP95Ms,
      thresholds.queueP95RatioMax,
      thresholds.queueP95AbsoluteSlackMs,
    );
  }
  addMaximumCheck(
    checks,
    'generation_queue.p95',
    longSave.generationQueueP95Ms,
    thresholds.generationQueueP95MaxMs,
    '真实 GenerationQueue 的同进程压力队列等待 P95。',
  );
  addMaximumCheck(
    checks,
    'long_save.database_bytes_per_turn',
    databaseBytesPerAdditionalTurn,
    thresholds.databaseBytesPerTurnMax,
    '以 SQLite page_count × page_size 计算 100→1000 回合的增量，不使用文件系统稀疏大小。',
  );
  addMaximumCheck(
    checks,
    'long_save.context_tokens',
    longSave.contextTokensAtLarge,
    thresholds.contextTokensMax,
    '长期存档只投影有界 recent/memory，不把完整数据库或全量历史送入 Context。',
  );
  addMaximumCheck(
    checks,
    'long_save.context_growth_ratio',
    contextGrowthRatio,
    thresholds.contextGrowthRatioMax,
    '比较 100 与 1000 回合的 Unified Context token 估算。',
  );
  addUsageChecks(checks, usage, thresholds);

  const frozenChecks = Object.freeze(checks.map((check) => Object.freeze(check)));
  return Object.freeze({
    schemaVersion: 1,
    recordedAt: input.recordedAt,
    sourceCommit: input.sourceCommit,
    baselineCommit: input.baselineCommit,
    evidenceKind: 'FAKE',
    aggregation: 'MEDIAN_OF_RUN_P95',
    coldRuns: coldRuns.length,
    warmRuns: warmRuns.length,
    iterationsPerTask: coldRuns[0]?.environment.iterationsPerTask ?? 0,
    baseline,
    current: Object.freeze(current),
    longSave: Object.freeze({
      ...longSave,
      databaseBytesPerAdditionalTurn: rounded(databaseBytesPerAdditionalTurn),
      contextGrowthRatio: rounded(contextGrowthRatio),
    }),
    usage,
    thresholds,
    checks: frozenChecks,
    passed: frozenChecks.every(({ status }) => status !== 'FAIL'),
  });
}

export function renderPerformanceRegressionMarkdown(report: PerformanceRegressionReport): string {
  const lines = [
    '# Ember Tavern V0.3 Performance Regression Report',
    '',
    `- Current evidence commit: \`${report.sourceCommit}\``,
    `- M1-T04 baseline commit: \`${report.baselineCommit}\``,
    `- Evidence: **${report.evidenceKind}**; real Provider: **NOT_RUN**`,
    `- Aggregation: ${report.aggregation}, cold ${report.coldRuns} runs + warm ${report.warmRuns} runs, ${report.iterationsPerTask} samples/task/run`,
    `- Gate: **${report.passed ? 'PASS' : 'FAIL'}**`,
    '',
    '## Core latency and queue comparison',
    '',
    '| Task | M1 latency P95 | Cold median P95 | Warm median P95 | M1 queue P95 | Cold queue median P95 | Warm queue median P95 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const current of report.current) {
    const baseline = report.baseline.find(({ task }) => task === current.task);
    if (baseline === undefined) continue;
    lines.push(
      `| ${current.task} | ${format(baseline.latencyP95Ms)} | ${format(current.coldLatencyP95MedianMs)} | ${format(current.warmLatencyP95MedianMs)} | ${format(baseline.queueWaitP95Ms)} | ${format(current.coldQueueP95MedianMs)} | ${format(current.warmQueueP95MedianMs)} |`,
    );
  }
  lines.push(
    '',
    '## Long-save, token and cache gates',
    '',
    `- SQLite growth: ${format(report.longSave.databaseBytesPerAdditionalTurn)} bytes/additional turn (limit ${report.thresholds.databaseBytesPerTurnMax}).`,
    `- Unified Context: ${report.longSave.contextTokensAtSmall} tokens at ${report.longSave.smallTurns} turns; ${report.longSave.contextTokensAtLarge} at ${report.longSave.largeTurns} turns; growth ratio ${format(report.longSave.contextGrowthRatio)} (limits ${report.thresholds.contextTokensMax} tokens / ${report.thresholds.contextGrowthRatioMax}×).`,
    `- GenerationQueue pressure P95: ${format(report.longSave.generationQueueP95Ms)} ms (limit ${report.thresholds.generationQueueP95MaxMs} ms).`,
    '- Fake Provider does not report prompt/output/cache usage. Unknown stays unknown; token and provider cache checks are NOT_EVALUATED, never converted to zero or a fabricated hit ratio.',
    '',
    '## Checks',
    '',
    '| Check | Status | Observed | Threshold | Explanation |',
    '| --- | --- | ---: | --- | --- |',
  );
  for (const check of report.checks) {
    lines.push(
      `| ${check.id} | ${check.status} | ${check.observed === null ? 'unknown' : format(check.observed)} | ${check.threshold} | ${check.explanation} |`,
    );
  }
  lines.push(
    '',
    '## Interpretation',
    '',
    'This gate compares medians of independent run-level P95 values. It never selects the fastest sample. The 5 ms absolute slack prevents sub-millisecond Fake Provider scheduler noise from looking like a large ratio regression; the 3× ratio still catches meaningful growth above that noise floor.',
    '',
    'Real Provider latency, token cost, and billing cache behavior require separately authorized REAL evidence. When available, input tokens must remain at or below the configured per-sample ceiling and cache hit ratio at or above the configured floor; missing usage cannot pass as zero.',
    '',
  );
  return lines.join('\n');
}

function validateIdentity(input: PerformanceRegressionGateInput): void {
  if (
    new Date(input.recordedAt).toISOString() !== input.recordedAt ||
    !/^[0-9a-f]{40}$/.test(input.sourceCommit) ||
    !/^[0-9a-f]{40}$/.test(input.baselineCommit)
  ) {
    throw new TypeError('Performance regression identity is invalid');
  }
}

function validateRuns(
  values: readonly PerformanceBaselineReport[],
  label: string,
  thresholds: PerformanceRegressionThresholds,
): readonly PerformanceBaselineReport[] {
  if (values.length < thresholds.minimumRuns || values.length > 20) {
    throw new TypeError(`Performance ${label} runs are insufficient`);
  }
  const runs = values.map(validatePerformanceBaselineReport);
  const iterations = runs[0]?.environment.iterationsPerTask;
  if (
    iterations === undefined ||
    iterations < thresholds.minimumIterationsPerTask ||
    runs.some(
      (run) =>
        run.evidenceKind !== 'FAKE' ||
        run.realProviderStatus !== 'NOT_RUN' ||
        run.environment.iterationsPerTask !== iterations ||
        run.summary.length !== BASELINE_TASKS.length,
    )
  ) {
    throw new TypeError(`Performance ${label} run identity is inconsistent`);
  }
  return Object.freeze(runs);
}

function validateReference(
  values: readonly PerformanceReferenceSummary[],
): readonly PerformanceReferenceSummary[] {
  if (values.length !== BASELINE_TASKS.length) {
    throw new TypeError('Performance baseline reference is incomplete');
  }
  const seen = new Set<BaselineTask>();
  return Object.freeze(
    values.map((value) => {
      if (
        !BASELINE_TASKS.includes(value.task) ||
        seen.has(value.task) ||
        !finiteNonNegative(value.latencyP95Ms) ||
        !finiteNonNegative(value.queueWaitP95Ms)
      ) {
        throw new TypeError('Performance baseline reference is invalid');
      }
      seen.add(value.task);
      return Object.freeze({ ...value });
    }),
  );
}

function validateThresholds(
  value: PerformanceRegressionThresholds,
): PerformanceRegressionThresholds {
  for (const threshold of Object.values(value)) {
    if (!Number.isFinite(threshold) || threshold <= 0) {
      throw new TypeError('Performance regression threshold is invalid');
    }
  }
  if (
    !Number.isSafeInteger(value.minimumRuns) ||
    !Number.isSafeInteger(value.minimumIterationsPerTask)
  ) {
    throw new TypeError('Performance regression sample threshold is invalid');
  }
  return Object.freeze({ ...value });
}

function validateLongSave(value: LongSavePerformanceObservation): LongSavePerformanceObservation {
  if (
    !Number.isSafeInteger(value.smallTurns) ||
    !Number.isSafeInteger(value.largeTurns) ||
    value.smallTurns < 1 ||
    value.largeTurns <= value.smallTurns ||
    !Number.isSafeInteger(value.databaseBytesAtSmall) ||
    !Number.isSafeInteger(value.databaseBytesAtLarge) ||
    value.databaseBytesAtSmall < 1 ||
    value.databaseBytesAtLarge < value.databaseBytesAtSmall ||
    !Number.isSafeInteger(value.contextTokensAtSmall) ||
    !Number.isSafeInteger(value.contextTokensAtLarge) ||
    value.contextTokensAtSmall < 1 ||
    value.contextTokensAtLarge < 1 ||
    !finiteNonNegative(value.generationQueueP95Ms)
  ) {
    throw new TypeError('Long-save performance observation is invalid');
  }
  return Object.freeze({ ...value });
}

function validateUsage(value: ProviderUsageObservation): ProviderUsageObservation {
  const counts = [value.inputTokens, value.promptCacheHitTokens, value.promptCacheMissTokens];
  if (
    !Number.isSafeInteger(value.sampleCount) ||
    value.sampleCount < 1 ||
    counts.some((count) => count !== null && (!Number.isSafeInteger(count) || count < 0)) ||
    (value.promptCacheHitTokens === null) !== (value.promptCacheMissTokens === null)
  ) {
    throw new TypeError('Provider usage observation is invalid');
  }
  return Object.freeze({ ...value });
}

function summariesFor(
  runs: readonly PerformanceBaselineReport[],
  task: BaselineTask,
): readonly PerformanceSummary[] {
  return runs.map((run) => {
    const summary = run.summary.find((candidate) => candidate.task === task);
    if (summary === undefined) throw new TypeError(`Performance run is missing ${task}`);
    return summary;
  });
}

function addRelativeCheck(
  checks: PerformanceGateCheck[],
  id: string,
  observed: number,
  baseline: number,
  ratio: number,
  slack: number,
): void {
  const maximum = Math.max(baseline * ratio, baseline + slack);
  checks.push({
    id,
    status: observed <= maximum ? 'PASS' : 'FAIL',
    observed: rounded(observed),
    threshold: `≤ max(M1 × ${ratio}, M1 + ${slack} ms) = ${format(maximum)} ms`,
    explanation: '使用多批次 run-level P95 的中位数，不选择单次最快值。',
  });
}

function addMaximumCheck(
  checks: PerformanceGateCheck[],
  id: string,
  observed: number,
  maximum: number,
  explanation: string,
): void {
  checks.push({
    id,
    status: observed <= maximum ? 'PASS' : 'FAIL',
    observed: rounded(observed),
    threshold: `≤ ${maximum}`,
    explanation,
  });
}

function addUsageChecks(
  checks: PerformanceGateCheck[],
  usage: ProviderUsageObservation,
  thresholds: PerformanceRegressionThresholds,
): void {
  if (usage.inputTokens === null) {
    checks.push({
      id: 'provider.input_tokens_per_sample',
      status: 'NOT_EVALUATED',
      observed: null,
      threshold: `≤ ${thresholds.inputTokensPerSampleMax}`,
      explanation: 'M1 与当前 Fake Provider 均未报告 usage；unknown 不按 0 处理。',
    });
  } else {
    addMaximumCheck(
      checks,
      'provider.input_tokens_per_sample',
      usage.inputTokens / usage.sampleCount,
      thresholds.inputTokensPerSampleMax,
      '真实 Provider usage 的每样本平均输入 token 上界。',
    );
  }
  if (usage.promptCacheHitTokens === null || usage.promptCacheMissTokens === null) {
    checks.push({
      id: 'provider.cache_hit_ratio',
      status: 'NOT_EVALUATED',
      observed: null,
      threshold: `≥ ${thresholds.cacheHitRatioMin}`,
      explanation: 'Fake Provider 没有计费缓存 usage；不以进程内 prefix reuse 冒充 Provider hit。',
    });
    return;
  }
  const total = usage.promptCacheHitTokens + usage.promptCacheMissTokens;
  const observed = total === 0 ? 0 : usage.promptCacheHitTokens / total;
  checks.push({
    id: 'provider.cache_hit_ratio',
    status: observed >= thresholds.cacheHitRatioMin ? 'PASS' : 'FAIL',
    observed: rounded(observed),
    threshold: `≥ ${thresholds.cacheHitRatioMin}`,
    explanation: '只使用 Provider usage hit/miss，不使用本地哈希重复观察。',
  });
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);
  return rounded(value);
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function format(value: number): string {
  return rounded(value).toFixed(3);
}
