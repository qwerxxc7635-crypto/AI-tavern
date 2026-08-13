import { describe, expect, it } from 'vitest';

import {
  summarizePerformanceMetrics,
  validatePerformanceBaselineReport,
  validatePerformanceMetric,
} from './performance-metric.js';

const metric = {
  schemaVersion: 1,
  task: 'GENERATE_WORLD',
  providerKind: 'FAKE',
  scenario: 'NORMAL',
  status: 'SUCCEEDED',
  latencyMs: 12,
  queueWaitMs: 2,
  inputTokens: null,
  outputTokens: null,
  promptCacheHitTokens: null,
  promptCacheMissTokens: null,
  retryCount: 0,
  errorCode: null,
} as const;

describe('performance metric contract', () => {
  it('accepts the bounded privacy-safe schema and reports unknown usage honestly', () => {
    expect(validatePerformanceMetric(metric)).toEqual(metric);
    expect(summarizePerformanceMetrics([metric])).toEqual([
      {
        task: 'GENERATE_WORLD',
        samples: 1,
        succeeded: 1,
        failed: 0,
        retries: 0,
        latencyP50Ms: 12,
        latencyP95Ms: 12,
        queueWaitP50Ms: 2,
        queueWaitP95Ms: 2,
        inputTokensTotal: null,
        outputTokensTotal: null,
        promptCacheHitTokensTotal: null,
        promptCacheMissTokensTotal: null,
      },
    ]);
  });

  it.each(['prompt', 'messages', 'playerText', 'credential', 'requestId', 'context'])(
    'rejects the forbidden telemetry field %s',
    (field) => {
      expect(() => validatePerformanceMetric({ ...metric, [field]: 'secret material' })).toThrow(
        'forbidden field',
      );
    },
  );

  it('validates failures, ranges and queue consistency', () => {
    expect(
      validatePerformanceMetric({
        ...metric,
        scenario: 'CONTROLLED_FAILURE',
        status: 'FAILED',
        errorCode: 'TIMEOUT',
        retryCount: 1,
      }),
    ).toMatchObject({ status: 'FAILED', errorCode: 'TIMEOUT', retryCount: 1 });
    expect(() => validatePerformanceMetric({ ...metric, latencyMs: -1 })).toThrow();
    expect(() => validatePerformanceMetric({ ...metric, queueWaitMs: 13 })).toThrow();
    expect(() => validatePerformanceMetric({ ...metric, status: 'FAILED' })).toThrow();
    expect(() => summarizePerformanceMetrics(Array.from({ length: 501 }, () => metric))).toThrow();
  });

  it('produces deterministic nearest-rank p50/p95 summaries', () => {
    const samples = [1, 2, 3, 4, 100].map((latencyMs) => ({
      ...metric,
      latencyMs,
      queueWaitMs: 0,
      inputTokens: 10,
      outputTokens: 2,
      promptCacheHitTokens: 4,
      promptCacheMissTokens: 6,
    }));
    expect(summarizePerformanceMetrics(samples)[0]).toMatchObject({
      latencyP50Ms: 3,
      latencyP95Ms: 100,
      inputTokensTotal: 50,
      outputTokensTotal: 10,
      promptCacheHitTokensTotal: 20,
      promptCacheMissTokensTotal: 30,
    });
  });

  it('rejects a report whose evidence label or summary does not match its samples', () => {
    const summary = summarizePerformanceMetrics([metric]);
    const report = {
      schemaVersion: 1,
      evidenceKind: 'FAKE',
      realProviderStatus: 'NOT_RUN',
      recordedAt: '2026-08-13T00:00:00.000Z',
      sourceCommit: 'a'.repeat(40),
      environment: {
        node: 'v26.7.0',
        platform: 'darwin',
        architecture: 'arm64',
        iterationsPerTask: 1,
      },
      samples: [metric],
      summary,
    };
    expect(validatePerformanceBaselineReport(report)).toMatchObject({ evidenceKind: 'FAKE' });
    expect(() =>
      validatePerformanceBaselineReport({ ...report, realProviderStatus: 'RUN' }),
    ).toThrow();
    expect(() => validatePerformanceBaselineReport({ ...report, summary: [] })).toThrow(
      'summary is inconsistent',
    );
    expect(() => validatePerformanceBaselineReport({ ...report, prompt: 'forbidden' })).toThrow(
      'forbidden field',
    );
  });
});
