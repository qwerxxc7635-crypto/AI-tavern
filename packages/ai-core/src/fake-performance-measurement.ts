import { performance } from 'node:perf_hooks';

import { aiRequestId, promptVersion } from '@ember-tavern/contracts';

import { FakeAIProvider } from './fake-ai-provider.js';
import {
  BASELINE_TASKS,
  validatePerformanceMetric,
  type BaselineScenario,
  type PerformanceMetric,
} from './performance-metric.js';
import type { ProviderConfig } from './protocol.js';
import { StandardAIError, standardizeAIError } from './standard-ai-error.js';

export async function measureFakePerformanceBatch(
  iterations: number,
  provider = new FakeAIProvider(),
): Promise<readonly PerformanceMetric[]> {
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 20) {
    throw new TypeError('Performance baseline iterations are invalid');
  }
  const metrics: PerformanceMetric[] = [];
  for (const task of BASELINE_TASKS) {
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      metrics.push(await measure(provider, task, iteration));
    }
  }
  return Object.freeze(metrics);
}

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
