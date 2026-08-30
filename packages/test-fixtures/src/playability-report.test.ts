import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, test } from 'vitest';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../..');
const REPORT_PATH = resolve(REPOSITORY_ROOT, 'docs/V0.3_PLAYABILITY_REPORT.md');
const SUMMARY_PATH = resolve(
  REPOSITORY_ROOT,
  'docs/audit/evidence/v0.3-playability/m11-t06-report-95e5e1e/report-summary.json',
);
const OUTPUT_ENV = 'EMBER_PLAYABILITY_REPORT_SUMMARY_PATH';

const RUNS = [
  {
    task: 'M11-T02',
    world: 'fantasy',
    directory: 'docs/audit/evidence/v0.3-playability/m11-t02-fantasy-e8f3a3c',
    evidence: 'fantasy/evidence.json',
    summary: 'fantasy/run-summary.json',
    score: {
      executionRecovery: 2,
      knowledgePersonality: 1.6,
      questWorldConsistency: 1.8,
      systemsContext: 1.7,
      agency: 1.5,
    },
  },
  {
    task: 'M11-T03',
    world: 'investigation',
    directory: 'docs/audit/evidence/v0.3-playability/m11-t03-investigation-0779808',
    evidence: 'investigation/evidence.json',
    summary: 'investigation/run-summary.json',
    score: {
      executionRecovery: 2,
      knowledgePersonality: 1.7,
      questWorldConsistency: 1.8,
      systemsContext: 1.8,
      agency: 1.5,
    },
  },
  {
    task: 'M11-T04',
    world: 'cyberpunk',
    directory: 'docs/audit/evidence/v0.3-playability/m11-t04-cyberpunk-d42bae2',
    evidence: 'cyberpunk/evidence.json',
    summary: 'cyberpunk/run-summary.json',
    score: {
      executionRecovery: 2,
      knowledgePersonality: 1.7,
      questWorldConsistency: 1.9,
      systemsContext: 1.8,
      agency: 1.5,
    },
  },
] as const;

const STRESS_RUN = {
  task: 'M11-T05',
  directory: 'docs/audit/evidence/v0.3-playability/m11-t05-free-input-2432d18',
  evidence: 'evidence.json',
  summary: 'run-summary.json',
} as const;

interface EvidenceFinding {
  readonly id: string;
  readonly severity: 'P0' | 'P1' | 'P2' | 'P3';
  readonly status: string;
  readonly title: string;
}

interface LongPlayEvidence {
  readonly format: string;
  readonly sourceCommit: string;
  readonly worldKey: string;
  readonly status: string;
  readonly provider: { readonly mode: string; readonly modelName: string };
  readonly actions: readonly {
    readonly sequence: number;
    readonly outcome: string;
    readonly persisted: boolean;
    readonly observations: readonly { readonly kind: string; readonly status: string }[];
  }[];
  readonly findings: readonly EvidenceFinding[];
}

interface LongPlaySummary {
  readonly sourceCommit: string;
  readonly providerMode: string;
  readonly behaviorCount: number;
  readonly coreFlowLatencyMs: number;
  readonly amortizedActionLatencyMs: number;
  readonly metrics: Readonly<Record<string, string | number>>;
}

interface StressEvidence {
  readonly format: string;
  readonly sourceCommit: string;
  readonly status: string;
  readonly provider: { readonly mode: string; readonly modelName: string };
  readonly actions: readonly {
    readonly sequence: number;
    readonly category: string;
    readonly expectedOutcome: string;
    readonly outcome: string;
    readonly persisted: boolean;
    readonly reopenVerified: boolean;
    readonly freeInputPersisted: boolean;
    readonly suggestionRequired: boolean;
    readonly response: string;
  }[];
  readonly findings: readonly EvidenceFinding[];
}

interface StressSummary {
  readonly sourceCommit: string;
  readonly behaviorCount: number;
  readonly coreFlowLatencyMs: number;
  readonly amortizedActionLatencyMs: number;
  readonly metrics: Readonly<Record<string, Readonly<Record<string, string | number>>>>;
}

let recomputed: ReturnType<typeof buildSummary>;

beforeAll(() => {
  recomputed = buildSummary();
  const output = process.env[OUTPUT_ENV];
  if (output !== undefined) {
    writeFileSync(resolve(output), `${JSON.stringify(recomputed, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
  }
});

describe('M11-T06 playability report', () => {
  test('recomputes every M11 behavior, finding, score and evidence hash', () => {
    expect(recomputed).toMatchObject({
      format: 'EMBER_PLAYABILITY_REPORT_SUMMARY',
      formatVersion: 1,
      sourceCommit: '95e5e1e',
      fixedWorldBehaviorCount: 96,
      freeInputBehaviorCount: 8,
      totalBehaviorCount: 104,
      provider: {
        observedModes: ['FAKE'],
        observedModelNames: ['ember-fake-v1'],
        v03RealProviderStatus: 'NOT_EVALUATED',
      },
      findings: {
        total: { P0: 0, P1: 1, P2: 0, P3: 0 },
        fixed: { P0: 0, P1: 1, P2: 0, P3: 0 },
        open: { P0: 0, P1: 0, P2: 0, P3: 0 },
      },
      performance: {
        longPlayCoreFlowLatencyMs: 7815.667,
        longPlayAmortizedActionLatencyMs: 81.413,
        stressCoreFlowLatencyMs: 2291.522,
        stressAmortizedActionLatencyMs: 286.44,
      },
      scoring: {
        scale: 10,
        confidence: 'MEDIUM',
        aggregateScore: 8.8,
      },
      evidenceHashesVerified: true,
    });
    expect(recomputed.worlds.map(({ score }) => score)).toEqual([8.6, 8.8, 8.9]);
    expect(recomputed.freeInput.outcomes).toEqual({ SUCCEEDED: 4, FAILED: 2, REJECTED: 2 });
  });

  test('keeps the committed machine summary equal to a fresh evidence calculation', () => {
    expect(existsSync(SUMMARY_PATH)).toBe(true);
    verifyEvidenceHashes(resolve(SUMMARY_PATH, '..'));
    expect(readJson(SUMMARY_PATH)).toEqual(recomputed);
  });

  test('keeps the human report complete and linked to authoritative evidence', () => {
    const report = readFileSync(REPORT_PATH, 'utf8');
    for (const heading of [
      '# Ember Tavern V0.3 可玩性报告',
      '## 1. Verdict 与证据边界',
      '## 2. 运行与统计总览',
      '## 3. 逐世界评估与评分',
      '## 4. 系统覆盖结论',
      '## 5. Findings、修复与剩余项',
      '## 6. 真实模型验证状态',
      '## 7. 性能、Context 与 Cache',
      '## 8. Remaining Risks',
      '## 9. 复现与报告门禁',
      '## M11 Playability Verdict',
    ]) {
      expect(report).toContain(heading);
    }
    for (const required of [
      '104',
      '8.8/10',
      'NOT_EVALUATED',
      'M11-FAN-001',
      'P0=0 / P1=0 / P2=0 / P3=0',
      'report-summary.json',
      'V0_3_FANTASY_LONG_PLAYTEST.md',
      'V0_3_INVESTIGATION_LONG_PLAYTEST.md',
      'V0_3_CYBERPUNK_LONG_PLAYTEST.md',
      'V0_3_FREE_INPUT_STRESS_TEST.md',
    ]) {
      expect(report).toContain(required);
    }
  });
});

function buildSummary() {
  const worlds = RUNS.map((run) => {
    verifyEvidenceHashes(resolve(REPOSITORY_ROOT, run.directory));
    const evidence = readJson<LongPlayEvidence>(
      resolve(REPOSITORY_ROOT, run.directory, run.evidence),
    );
    const summary = readJson<LongPlaySummary>(resolve(REPOSITORY_ROOT, run.directory, run.summary));
    expect(evidence).toMatchObject({
      format: 'EMBER_PLAYTEST_EVIDENCE',
      worldKey: run.world,
      status: 'COMPLETE',
      provider: { mode: 'FAKE', modelName: 'ember-fake-v1' },
    });
    expect(evidence.actions).toHaveLength(32);
    expect(summary).toMatchObject({
      sourceCommit: evidence.sourceCommit,
      providerMode: 'FAKE',
      behaviorCount: 32,
      metrics: {
        campaignState: 'TAVERN',
        integrityCheck: 'ok',
        foreignKeyViolationCount: 0,
        unfinishedRequestCount: 0,
      },
    });
    expect(
      evidence.actions.every(
        (action, index) =>
          action.sequence === index + 1 &&
          action.outcome === 'SUCCEEDED' &&
          action.persisted &&
          action.observations.every(({ status }) => status === 'PASS'),
      ),
    ).toBe(true);
    const score = round(
      Object.values(run.score).reduce((total, value) => total + value, 0),
      1,
    );
    return {
      task: run.task,
      world: run.world,
      evidenceDirectory: run.directory,
      sourceCommit: evidence.sourceCommit,
      providerMode: evidence.provider.mode,
      modelName: evidence.provider.modelName,
      behaviorCount: summary.behaviorCount,
      coreFlowLatencyMs: summary.coreFlowLatencyMs,
      amortizedActionLatencyMs: summary.amortizedActionLatencyMs,
      scoreDimensions: run.score,
      score,
      findings: evidence.findings,
      metrics: summary.metrics,
    };
  });

  verifyEvidenceHashes(resolve(REPOSITORY_ROOT, STRESS_RUN.directory));
  const stressEvidence = readJson<StressEvidence>(
    resolve(REPOSITORY_ROOT, STRESS_RUN.directory, STRESS_RUN.evidence),
  );
  const stressSummary = readJson<StressSummary>(
    resolve(REPOSITORY_ROOT, STRESS_RUN.directory, STRESS_RUN.summary),
  );
  expect(stressEvidence).toMatchObject({
    format: 'EMBER_FREE_INPUT_STRESS_EVIDENCE',
    status: 'COMPLETE',
    provider: { mode: 'FAKE', modelName: 'ember-fake-v1' },
  });
  expect(stressEvidence.actions).toHaveLength(8);
  expect(stressSummary.behaviorCount).toBe(8);
  expect(
    stressEvidence.actions.every(
      (action, index) =>
        action.sequence === index + 1 &&
        action.expectedOutcome === action.outcome &&
        action.persisted &&
        action.reopenVerified &&
        action.freeInputPersisted &&
        !action.suggestionRequired &&
        !action.response.includes('无法解析'),
    ),
  ).toBe(true);

  const allFindings = [...worlds.flatMap(({ findings }) => findings), ...stressEvidence.findings];
  const fixedWorldBehaviorCount = worlds.reduce((total, world) => total + world.behaviorCount, 0);
  const longPlayCoreFlowLatencyMs = round(
    worlds.reduce((total, world) => total + world.coreFlowLatencyMs, 0),
    3,
  );
  const outcomeEntries = ['SUCCEEDED', 'FAILED', 'REJECTED'].map((outcome) => [
    outcome,
    stressEvidence.actions.filter((action) => action.outcome === outcome).length,
  ]);
  const aggregateScore = round(
    worlds.reduce((total, world) => total + world.score * world.behaviorCount, 0) /
      fixedWorldBehaviorCount,
    1,
  );

  return {
    format: 'EMBER_PLAYABILITY_REPORT_SUMMARY',
    formatVersion: 1,
    sourceCommit: '95e5e1e',
    generatedFrom: [...RUNS.map(({ directory }) => directory), STRESS_RUN.directory],
    worlds,
    freeInput: {
      task: STRESS_RUN.task,
      evidenceDirectory: STRESS_RUN.directory,
      sourceCommit: stressEvidence.sourceCommit,
      providerMode: stressEvidence.provider.mode,
      modelName: stressEvidence.provider.modelName,
      behaviorCount: stressSummary.behaviorCount,
      outcomes: Object.fromEntries(outcomeEntries),
      categories: stressEvidence.actions.map(({ category }) => category),
      findings: stressEvidence.findings,
      metrics: stressSummary.metrics,
    },
    fixedWorldBehaviorCount,
    freeInputBehaviorCount: stressSummary.behaviorCount,
    totalBehaviorCount: fixedWorldBehaviorCount + stressSummary.behaviorCount,
    provider: {
      observedModes: [...new Set(worlds.map(({ providerMode }) => providerMode))],
      observedModelNames: [...new Set(worlds.map(({ modelName }) => modelName))],
      v03RealProviderStatus: 'NOT_EVALUATED',
    },
    findings: {
      total: findingCounts(allFindings),
      fixed: findingCounts(allFindings.filter(({ status }) => status === 'FIXED')),
      open: findingCounts(allFindings.filter(({ status }) => status !== 'FIXED')),
      ledger: allFindings,
    },
    performance: {
      longPlayCoreFlowLatencyMs,
      longPlayAmortizedActionLatencyMs: round(
        longPlayCoreFlowLatencyMs / fixedWorldBehaviorCount,
        3,
      ),
      stressCoreFlowLatencyMs: stressSummary.coreFlowLatencyMs,
      stressAmortizedActionLatencyMs: stressSummary.amortizedActionLatencyMs,
    },
    scoring: {
      scale: 10,
      confidence: 'MEDIUM',
      method:
        'Five evidence-backed dimensions worth two points each; aggregate is behavior-weighted across the three fixed-world runs. Real-model prose quality is explicitly outside this score.',
      aggregateScore,
    },
    evidenceHashesVerified: true,
  } as const;
}

function verifyEvidenceHashes(directory: string): void {
  const sums = readFileSync(resolve(directory, 'SHA256SUMS'), 'utf8').trim().split('\n');
  expect(sums.length).toBeGreaterThan(0);
  for (const line of sums) {
    const match = /^([a-f0-9]{64}) {2}(.+)$/.exec(line);
    expect(match).not.toBeNull();
    if (match === null) continue;
    const expected = match[1];
    const relativePath = match[2];
    if (expected === undefined || relativePath === undefined) {
      throw new Error(`Invalid SHA256SUMS entry: ${line}`);
    }
    const actual = createHash('sha256')
      .update(readFileSync(resolve(directory, relativePath)))
      .digest('hex');
    expect(actual).toBe(expected);
  }
}

function findingCounts(findings: readonly EvidenceFinding[]) {
  return Object.fromEntries(
    (['P0', 'P1', 'P2', 'P3'] as const).map((severity) => [
      severity,
      findings.filter((finding) => finding.severity === severity).length,
    ]),
  );
}

function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
