import { writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { summarizePerformanceMetrics, validatePerformanceBaselineReport } from './index.js';
import { measureFakePerformanceBatch } from './fake-performance-measurement.js';

const outputPath = process.env['EMBER_PERFORMANCE_BASELINE_OUTPUT'];

describe('repeatable Fake Provider performance baseline', () => {
  it.skipIf(outputPath === undefined)(
    'measures world, NPC, quest, action and D20 without persisting content',
    async () => {
      const iterations = requireIterations(process.env['EMBER_PERFORMANCE_BASELINE_ITERATIONS']);
      const sourceCommit = requireCommit(process.env['EMBER_PERFORMANCE_BASELINE_COMMIT']);
      const metrics = await measureFakePerformanceBatch(iterations);

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
