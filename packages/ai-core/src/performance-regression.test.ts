import { describe, expect, it } from 'vitest';

import {
  BASELINE_TASKS,
  evaluatePerformanceRegression,
  M1_T04_PERFORMANCE_REFERENCE,
  renderPerformanceRegressionMarkdown,
  summarizePerformanceMetrics,
  type PerformanceBaselineReport,
  type PerformanceMetric,
  type PerformanceRegressionGateInput,
} from './index.js';

const commit = 'a'.repeat(40);

describe('performance regression gate', () => {
  it('uses the median of independent P95 runs and generates a complete report', () => {
    const input = gateInput([1, 50, 2]);
    const report = evaluatePerformanceRegression(input);

    expect(report.aggregation).toBe('MEDIAN_OF_RUN_P95');
    expect(report.current[0]?.coldLatencyP95MedianMs).toBe(2);
    expect(report.checks.filter(({ status }) => status === 'NOT_EVALUATED')).toHaveLength(2);
    expect(report.passed).toBe(true);
    expect(renderPerformanceRegressionMarkdown(report)).toContain(
      '# Ember Tavern V0.3 Performance Regression Report',
    );
    expect(renderPerformanceRegressionMarkdown(report)).toContain('never selects the fastest');
  });

  it('fails latency, queue, long-save, token and cache threshold regressions', () => {
    const input = gateInput([100, 100, 100]);
    const report = evaluatePerformanceRegression({
      ...input,
      longSave: {
        ...input.longSave,
        databaseBytesAtLarge: 10_000_000,
        contextTokensAtLarge: 4096,
        generationQueueP95Ms: 500,
      },
      usage: {
        inputTokens: 1_000_000,
        sampleCount: 10,
        promptCacheHitTokens: 1,
        promptCacheMissTokens: 99,
      },
    });

    expect(report.passed).toBe(false);
    expect(report.checks.filter(({ status }) => status === 'FAIL').map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        'GENERATE_WORLD.cold.latency_p95',
        'generation_queue.p95',
        'long_save.database_bytes_per_turn',
        'long_save.context_tokens',
        'provider.input_tokens_per_sample',
        'provider.cache_hit_ratio',
      ]),
    );
  });

  it('rejects insufficient or inconsistent warm/cold evidence', () => {
    const input = gateInput([1, 2, 3]);
    const firstWarmRun = input.warmRuns[0];
    if (firstWarmRun === undefined) throw new TypeError('Test warm run is missing');
    expect(() =>
      evaluatePerformanceRegression({ ...input, coldRuns: input.coldRuns.slice(0, 2) }),
    ).toThrow('insufficient');
    expect(() =>
      evaluatePerformanceRegression({
        ...input,
        warmRuns: [{ ...firstWarmRun, realProviderStatus: 'RUN' }, ...input.warmRuns.slice(1)],
      }),
    ).toThrow();
  });
});

function gateInput(latencies: readonly number[]): PerformanceRegressionGateInput {
  const runs = latencies.map((latency, index) => report(latency, index));
  return {
    recordedAt: '2026-08-24T00:00:00.000Z',
    sourceCommit: commit,
    baselineCommit: '589ef756c4df3b552a1b8c7cbf5b8da34c8793f5',
    baseline: M1_T04_PERFORMANCE_REFERENCE,
    coldRuns: runs,
    warmRuns: runs,
    longSave: {
      smallTurns: 100,
      largeTurns: 1000,
      databaseBytesAtSmall: 1_000_000,
      databaseBytesAtLarge: 2_000_000,
      contextTokensAtSmall: 1000,
      contextTokensAtLarge: 1000,
      generationQueueP95Ms: 10,
    },
    usage: {
      inputTokens: null,
      sampleCount: 150,
      promptCacheHitTokens: null,
      promptCacheMissTokens: null,
    },
  };
}

function report(latencyMs: number, run: number): PerformanceBaselineReport {
  const samples = BASELINE_TASKS.flatMap((task) =>
    Array.from({ length: 10 }, (_, index): PerformanceMetric => ({
      schemaVersion: 1,
      task,
      providerKind: 'FAKE',
      scenario:
        task === 'GENERATE_QUEST' && index === 0
          ? 'CONTROLLED_FAILURE'
          : task === 'GENERATE_ADVENTURE_TURN' && index === 0
            ? 'CONTROLLED_RETRY'
            : 'NORMAL',
      status: task === 'GENERATE_QUEST' && index === 0 ? 'FAILED' : 'SUCCEEDED',
      latencyMs,
      queueWaitMs: Math.min(latencyMs, latencyMs / 2),
      inputTokens: null,
      outputTokens: null,
      promptCacheHitTokens: null,
      promptCacheMissTokens: null,
      retryCount: task === 'GENERATE_ADVENTURE_TURN' && index === 0 ? 1 : 0,
      errorCode: task === 'GENERATE_QUEST' && index === 0 ? 'TIMEOUT' : null,
    })),
  );
  return {
    schemaVersion: 1,
    evidenceKind: 'FAKE',
    realProviderStatus: 'NOT_RUN',
    recordedAt: new Date(Date.UTC(2026, 7, 24, 0, 0, run)).toISOString(),
    sourceCommit: commit,
    environment: {
      node: 'v26.7.0',
      platform: 'darwin',
      architecture: 'arm64',
      iterationsPerTask: 10,
    },
    samples,
    summary: summarizePerformanceMetrics(samples),
  };
}
