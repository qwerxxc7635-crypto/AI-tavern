import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import {
  buildUnifiedTaskContext,
  evaluatePerformanceRegression,
  FakeAIProvider,
  GenerationQueue,
  M1_T04_PERFORMANCE_REFERENCE,
  renderPerformanceRegressionMarkdown,
  summarizePerformanceMetrics,
  validatePerformanceBaselineReport,
  type GenerationQueueMetric,
  type PerformanceBaselineReport,
} from '@ember-tavern/ai-core';
import { describe, expect, it } from 'vitest';

import { measureFakePerformanceBatch } from '../../ai-core/src/fake-performance-measurement.js';
import { applyMigrations } from './migrations.mjs';

const outputJson = process.env['EMBER_PERFORMANCE_GATE_JSON'];
const outputMarkdown = process.env['EMBER_PERFORMANCE_GATE_MARKDOWN'];

describe('M10-T06 repeatable performance regression gate', () => {
  it.skipIf(outputJson === undefined || outputMarkdown === undefined)(
    'compares cold/warm runs and long-save growth with M1-T04',
    async () => {
      const sourceCommit = requireCommit(process.env['EMBER_PERFORMANCE_GATE_COMMIT']);
      const iterations = 10;
      const runCount = 3;
      const coldRuns: PerformanceBaselineReport[] = [];
      const warmRuns: PerformanceBaselineReport[] = [];
      const warmProvider = new FakeAIProvider();

      for (let run = 0; run < runCount; run += 1) {
        coldRuns.push(await collectRun(iterations, sourceCommit));
      }
      for (let run = 0; run < runCount; run += 1) {
        warmRuns.push(await collectRun(iterations, sourceCommit, warmProvider));
      }

      const longSave = await measureLongSave();
      const allSamples = [...coldRuns, ...warmRuns].flatMap(({ samples }) => samples);
      const report = evaluatePerformanceRegression({
        recordedAt: new Date().toISOString(),
        sourceCommit,
        baselineCommit: '589ef756c4df3b552a1b8c7cbf5b8da34c8793f5',
        baseline: M1_T04_PERFORMANCE_REFERENCE,
        coldRuns,
        warmRuns,
        longSave,
        usage: {
          inputTokens: totalOrUnknown(allSamples.map(({ inputTokens }) => inputTokens)),
          sampleCount: allSamples.length,
          promptCacheHitTokens: totalOrUnknown(
            allSamples.map(({ promptCacheHitTokens }) => promptCacheHitTokens),
          ),
          promptCacheMissTokens: totalOrUnknown(
            allSamples.map(({ promptCacheMissTokens }) => promptCacheMissTokens),
          ),
        },
      });
      const serialized = `${JSON.stringify(report, null, 2)}\n`;
      for (const forbidden of [
        'private player text',
        'authorization',
        'apiKey',
        'credentialRef',
        'requestId',
        'messages',
      ]) {
        expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
      expect(report.passed).toBe(true);
      writeFileSync(requirePath(outputJson), serialized, { encoding: 'utf8', flag: 'wx' });
      writeFileSync(requirePath(outputMarkdown), renderPerformanceRegressionMarkdown(report), {
        encoding: 'utf8',
        flag: 'wx',
      });
    },
  );
});

async function collectRun(
  iterations: number,
  sourceCommit: string,
  provider?: FakeAIProvider,
): Promise<PerformanceBaselineReport> {
  const samples = await measureFakePerformanceBatch(iterations, provider);
  return validatePerformanceBaselineReport({
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
    samples,
    summary: summarizePerformanceMetrics(samples),
  });
}

async function measureLongSave() {
  const directory = await mkdtemp(join(tmpdir(), 'ember-performance-long-save-'));
  const database = new DatabaseSync(join(directory, 'campaign.sqlite'));
  try {
    await applyMigrations(database);
    database
      .prepare(
        `INSERT INTO campaigns (
           id, schema_version, state, resume_state, default_model_profile_id,
           fallback_model_profile_id, task_model_overrides_json, model_switch_policy,
           created_at, updated_at, archived_at
         ) VALUES (?, ?, 'TAVERN', NULL, NULL, NULL, '{}', 'ASK', ?, ?, NULL)`,
      )
      .run('performance-campaign', 32, '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
    database
      .prepare(
        `INSERT INTO conversations (
           id, campaign_id, kind, npc_id, adventure_id, created_at, updated_at
         ) VALUES (?, ?, 'SYSTEM', NULL, NULL, ?, ?)`,
      )
      .run(
        'performance-conversation',
        'performance-campaign',
        '2026-08-24T00:00:00.000Z',
        '2026-08-24T00:00:00.000Z',
      );
    const insert = database.prepare(
      `INSERT INTO messages (
         id, conversation_id, sequence_number, role, speaker_npc_id,
         content, generation_record_id, created_at
       ) VALUES (?, 'performance-conversation', ?, 'NARRATOR', NULL, ?, NULL, ?)`,
    );
    insertTurns(insert, 1, 100);
    const databaseBytesAtSmall = allocatedBytes(database);
    const contextTokensAtSmall = await contextTokens(100);
    insertTurns(insert, 101, 1000);
    const databaseBytesAtLarge = allocatedBytes(database);
    const contextTokensAtLarge = await contextTokens(1000);
    return Object.freeze({
      smallTurns: 100,
      largeTurns: 1000,
      databaseBytesAtSmall,
      databaseBytesAtLarge,
      contextTokensAtSmall,
      contextTokensAtLarge,
      generationQueueP95Ms: await measureGenerationQueue(),
    });
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function insertTurns(statement: ReturnType<DatabaseSync['prepare']>, first: number, last: number) {
  const body = 'The ember clock advances; one bounded game event is recorded for recovery. '.repeat(
    4,
  );
  for (let turn = first; turn <= last; turn += 1) {
    statement.run(
      `performance-message-${turn}`,
      turn,
      `Turn ${turn}. ${body}`,
      new Date(Date.UTC(2026, 7, 24, 0, 0, turn)).toISOString(),
    );
  }
}

function allocatedBytes(database: DatabaseSync): number {
  const pageCount = database.prepare('PRAGMA page_count').get() as { page_count: number };
  const pageSize = database.prepare('PRAGMA page_size').get() as { page_size: number };
  return pageCount.page_count * pageSize.page_size;
}

async function contextTokens(turns: number): Promise<number> {
  const recentTurns = Array.from({ length: 20 }, (_, index) => ({
    sequence: turns - 19 + index,
    event: 'A bounded recent event projection.',
  }));
  const context = await buildUnifiedTaskContext(
    'GENERATE_ADVENTURE_TURN',
    {
      worldConstitution: { revision: 1, rule: 'D20 hard result remains authoritative.' },
      longTermMemory: { revision: Math.ceil(turns / 100), summary: 'Stable bounded memory.' },
      recentTurns,
      currentAction: 'Continue from the durable state.',
    },
    {
      sourceId: 'performance-campaign',
      sourceRevision: turns,
      optionalFields: ['longTermMemory', 'recentTurns'],
      maxTokens: 2048,
    },
  );
  return context.assembly.manifest.estimatedTokens;
}

async function measureGenerationQueue(): Promise<number> {
  const metrics: GenerationQueueMetric[] = [];
  const queue = new GenerationQueue({
    concurrency: 2,
    maxPending: 64,
    onMetric: (metric) => metrics.push(metric),
  });
  const handles = Array.from({ length: 40 }, (_, index) =>
    queue.submit({
      id: `performance-queue-${index}`,
      intentKey: `performance-intent-${index}`,
      task: 'GENERATE_ADVENTURE_TURN',
      priority: index % 5 === 0 ? 'P0' : index % 2 === 0 ? 'P1' : 'P2',
      timeoutMs: 1000,
      maxRetries: 0,
      allowFallback: false,
      execute: () => new Promise<number>((resolve) => setImmediate(() => resolve(index))),
    }),
  );
  await Promise.all(handles.map(({ promise }) => promise));
  const values = metrics.map(({ queueWaitMs }) => queueWaitMs).sort((left, right) => left - right);
  const value = values[Math.max(0, Math.ceil(values.length * 0.95) - 1)] ?? 0;
  return Math.round(value * 1000) / 1000;
}

function totalOrUnknown(values: readonly (number | null)[]): number | null {
  return values.some((value) => value === null)
    ? null
    : values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function requireCommit(value: string | undefined): string {
  if (value === undefined || !/^[0-9a-f]{40}$/.test(value)) {
    throw new TypeError('Performance gate source commit is invalid');
  }
  return value;
}

function requirePath(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new TypeError('Performance gate output path is invalid');
  }
  return value;
}
