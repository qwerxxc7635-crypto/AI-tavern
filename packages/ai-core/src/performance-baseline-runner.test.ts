import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import {
  BASELINE_TASKS,
  FakeAIProvider,
  StandardAIError,
  standardizeAIError,
  summarizePerformanceMetrics,
  validatePerformanceBaselineReport,
  validatePerformanceMetric,
  type BaselineScenario,
  type PerformanceMetric,
  type ProviderConfig,
} from './index.js';
import { aiRequestId, promptVersion } from '../../contracts/src/index.js';

const outputPath = process.env['EMBER_PERFORMANCE_BASELINE_OUTPUT'];

describe('repeatable Fake Provider performance baseline', () => {
  it.skipIf(outputPath === undefined)(
    'measures world, NPC, quest, action and D20 without persisting content',
    async () => {
      const iterations = requireIterations(process.env['EMBER_PERFORMANCE_BASELINE_ITERATIONS']);
      const sourceCommit = requireCommit(process.env['EMBER_PERFORMANCE_BASELINE_COMMIT']);
      const provider = new FakeAIProvider();
      const metrics: PerformanceMetric[] = [];

      for (const task of BASELINE_TASKS) {
        for (let iteration = 0; iteration < iterations; iteration += 1) {
          metrics.push(await measure(provider, task, iteration));
        }
      }

      const report = validatePerformanceBaselineReport({
        schemaVersion: 1,
        evidenceKind: 'FAKE',
        realProviderStatus: 'NOT_RUN',
        recordedAt: new Date().toISOString(),
        sourceCommit,
        environment: {
          node: process.version,
          platform: process.platform,
          architecture: process.arch,
          iterationsPerTask: iterations,
        },
        samples: metrics,
        summary: summarizePerformanceMetrics(metrics),
      });
      const serialized = `${JSON.stringify(report, null, 2)}\n`;
      for (const forbidden of [
        'private player text',
        'authorization',
        'apiKey',
        'credentialRef',
        '"messages"',
        '"prompt":',
        'requestId',
      ]) {
        expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
      writeFileSync(requireOutputPath(outputPath), serialized, { encoding: 'utf8', flag: 'wx' });
    },
  );
});

async function measure(
  provider: FakeAIProvider,
  task: (typeof BASELINE_TASKS)[number],
  iteration: number,
): Promise<PerformanceMetric> {
  const queuedAt = performance.now();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const startedAt = performance.now();
  let scenario: BaselineScenario = 'NORMAL';
  let retryCount = 0;
  let errorCode: string | null = null;
  let response: Awaited<ReturnType<FakeAIProvider['generate']>> | null = null;

  if (task === 'GENERATE_QUEST' && iteration === 0) {
    scenario = 'CONTROLLED_FAILURE';
    try {
      throwControlledTimeout();
    } catch (error) {
      errorCode = standardizeAIError(error).code;
    }
  } else {
    if (task === 'GENERATE_ADVENTURE_TURN' && iteration === 0) {
      scenario = 'CONTROLLED_RETRY';
      try {
        throwControlledTimeout();
      } catch (error) {
        const standardized = standardizeAIError(error);
        if (!standardized.retryable) throw standardized;
        retryCount += 1;
      }
    }
    response = await provider.generate(
      {
        requestId: aiRequestId(`performance-${task.toLowerCase()}-${iteration}`),
        task,
        promptVersion: promptVersion(1),
        modelName: 'ember-fake-v1',
        messages: [{ role: 'USER', content: 'private player text excluded from telemetry' }],
        responseFormat: { kind: 'JSON_OBJECT' },
        temperature: 0,
        maxOutputTokens: 4096,
        timeoutMs: 30_000,
      },
      fakeConfig,
    );
  }
  const completedAt = performance.now();
  return validatePerformanceMetric({
    schemaVersion: 1,
    task,
    providerKind: 'FAKE',
    scenario,
    status: errorCode === null ? 'SUCCEEDED' : 'FAILED',
    latencyMs: rounded(completedAt - queuedAt),
    queueWaitMs: rounded(startedAt - queuedAt),
    inputTokens: response?.usage.inputTokens ?? null,
    outputTokens: response?.usage.outputTokens ?? null,
    promptCacheHitTokens: response?.usage.promptCacheHitTokens ?? null,
    promptCacheMissTokens: response?.usage.promptCacheMissTokens ?? null,
    retryCount,
    errorCode,
  });
}

function throwControlledTimeout(): never {
  throw new StandardAIError('TIMEOUT');
}

const fakeConfig: ProviderConfig = Object.freeze({
  id: 'performance-fake',
  providerType: 'OPENAI_COMPATIBLE',
  presetKey: 'custom',
  displayName: 'Performance Fake',
  baseUrl: null,
  credentialRef: null,
  options: {},
  enabled: true,
});

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function requireIterations(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 20) {
    throw new TypeError('Performance baseline iterations are invalid');
  }
  return parsed;
}

function requireCommit(value: string | undefined): string {
  if (value === undefined || !/^[0-9a-f]{40}$/.test(value)) {
    throw new TypeError('Performance baseline source commit is invalid');
  }
  return value;
}

function requireOutputPath(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new TypeError('Performance baseline output path is invalid');
  }
  return value;
}
