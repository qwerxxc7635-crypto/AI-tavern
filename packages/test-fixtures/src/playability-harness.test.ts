import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendPlaytestActionEvidence,
  completePlaytestWorld,
  materializePlaytestRun,
  PlaytestHarnessError,
  resetPlaytestWorld,
  scenarioHashFor,
  setPlaytestProvider,
  validatePlaytestWorldFixtures,
  verifyPlaytestRun,
  type PlaytestAction,
  type PlaytestActionEvidence,
  type PlaytestWorldFixture,
  type PlaytestWorldKey,
} from './index.js';
import { PLAYTEST_WORLD_FIXTURES, PLAYTEST_WORLD_KEYS } from './playability-worlds.js';

const temporaryDirectories: string[] = [];
const sourceCommit = '2b67ffc';
const at = '2026-08-26T08:00:00.000Z';

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('M11 three-world playtest harness', () => {
  it('validates three synthetic and structurally different 32-action worlds', () => {
    expect(() => validatePlaytestWorldFixtures()).not.toThrow();
    expect(Object.keys(PLAYTEST_WORLD_FIXTURES)).toEqual(PLAYTEST_WORLD_KEYS);
    expect(
      PLAYTEST_WORLD_KEYS.map((key) => PLAYTEST_WORLD_FIXTURES[key].behaviorScript.length),
    ).toEqual([32, 32, 32]);
    expect(
      new Set(PLAYTEST_WORLD_KEYS.map((key) => scenarioHashFor(PLAYTEST_WORLD_FIXTURES[key]))).size,
    ).toBe(3);

    const extensionShapes = PLAYTEST_WORLD_KEYS.map((key) =>
      PLAYTEST_WORLD_FIXTURES[key].extension.fields.map(
        ({ key: fieldKey, type }) => `${fieldKey}:${type}`,
      ),
    );
    expect(extensionShapes).toEqual([
      ['oathDebt:INTEGER', 'guildStanding:ENUM', 'knownRunes:TEXT_LIST'],
      ['composure:INTEGER', 'fortune:INTEGER', 'credit:INTEGER', 'clueLoad:INTEGER'],
      [
        'neuralLoad:INTEGER',
        'streetReputation:INTEGER',
        'traceHeat:INTEGER',
        'implantSlots:TEXT_LIST',
        'networkAccess:ENUM',
      ],
    ]);
  });

  it('materializes isolated world directories with traceable immutable scenario hashes', async () => {
    const outputRoot = await temporaryRoot();
    const { runDirectory, manifest } = await materializePlaytestRun({
      outputRoot,
      runId: 'm11-harness-a',
      sourceCommit,
      createdAt: at,
    });

    expect(manifest.worlds.map(({ databaseFile }) => databaseFile)).toEqual([
      'campaign.sqlite3',
      'campaign.sqlite3',
      'campaign.sqlite3',
    ]);
    expect(new Set(manifest.worlds.map(({ directory }) => directory)).size).toBe(3);
    expect(new Set(manifest.worlds.map(({ scenarioHash }) => scenarioHash)).size).toBe(3);
    expect(await verifyPlaytestRun(runDirectory)).toEqual({
      runId: 'm11-harness-a',
      sourceCommit,
      worldCount: 3,
      actionCount: 0,
      statuses: { fantasy: 'NOT_RUN', investigation: 'NOT_RUN', cyberpunk: 'NOT_RUN' },
    });
  });

  it('resets only the selected world and preserves the replay identity', async () => {
    const outputRoot = await temporaryRoot();
    const { runDirectory, manifest } = await materializePlaytestRun({
      outputRoot,
      runId: 'm11-reset-a',
      sourceCommit,
      createdAt: at,
    });
    for (const key of PLAYTEST_WORLD_KEYS) {
      await writeFile(join(runDirectory, key, 'campaign.sqlite3'), key, 'utf8');
    }
    const fantasyAction = PLAYTEST_WORLD_FIXTURES.fantasy.behaviorScript[0];
    if (fantasyAction === undefined) throw new Error('Fantasy script is empty');
    await appendPlaytestActionEvidence(runDirectory, 'fantasy', evidenceFor(fantasyAction));

    const reset = await resetPlaytestWorld(runDirectory, 'fantasy');
    expect(reset).toMatchObject({ status: 'NOT_RUN', resetCount: 1, actions: [] });
    await expect(readFile(join(runDirectory, 'fantasy', 'campaign.sqlite3'))).rejects.toMatchObject(
      {
        code: 'ENOENT',
      },
    );
    await expect(
      readFile(join(runDirectory, 'investigation', 'campaign.sqlite3'), 'utf8'),
    ).resolves.toBe('investigation');
    await expect(
      readFile(join(runDirectory, 'cyberpunk', 'campaign.sqlite3'), 'utf8'),
    ).resolves.toBe('cyberpunk');
    expect(manifest.worlds.find(({ key }) => key === 'fantasy')?.scenarioHash).toBe(
      scenarioHashFor(PLAYTEST_WORLD_FIXTURES.fantasy),
    );
  });

  it('replays the same inputs into byte-identical fixtures and scripts without copying evidence', async () => {
    const outputRoot = await temporaryRoot();
    const first = await materializePlaytestRun({
      outputRoot,
      runId: 'm11-replay-a',
      sourceCommit,
      createdAt: at,
    });
    const action = PLAYTEST_WORLD_FIXTURES.investigation.behaviorScript[0];
    if (action === undefined) throw new Error('Investigation script is empty');
    await appendPlaytestActionEvidence(first.runDirectory, 'investigation', evidenceFor(action));
    const second = await materializePlaytestRun({
      outputRoot,
      runId: 'm11-replay-b',
      sourceCommit,
      createdAt: at,
    });

    expect(second.manifest.worlds.map(({ scenarioHash }) => scenarioHash)).toEqual(
      first.manifest.worlds.map(({ scenarioHash }) => scenarioHash),
    );
    expect(await verifyPlaytestRun(second.runDirectory)).toMatchObject({
      actionCount: 0,
      statuses: { fantasy: 'NOT_RUN', investigation: 'NOT_RUN', cyberpunk: 'NOT_RUN' },
    });
  });

  it('rejects out-of-order or incomplete action evidence and freezes provider identity', async () => {
    const outputRoot = await temporaryRoot();
    const { runDirectory } = await materializePlaytestRun({
      outputRoot,
      runId: 'm11-evidence-a',
      sourceCommit,
      createdAt: at,
    });
    await setPlaytestProvider(runDirectory, 'cyberpunk', {
      mode: 'FAKE',
      providerName: 'Deterministic Fake Provider',
      modelName: 'fixture-v1',
    });
    const [first, second] = PLAYTEST_WORLD_FIXTURES.cyberpunk.behaviorScript;
    if (first === undefined || second === undefined)
      throw new Error('Cyberpunk script is incomplete');
    await expect(
      appendPlaytestActionEvidence(runDirectory, 'cyberpunk', evidenceFor(second)),
    ).rejects.toMatchObject({ code: 'ACTION_OUT_OF_ORDER' });
    await appendPlaytestActionEvidence(runDirectory, 'cyberpunk', evidenceFor(first));
    await expect(
      setPlaytestProvider(runDirectory, 'cyberpunk', {
        mode: 'REAL',
        providerName: 'DeepSeek',
        modelName: 'deepseek-chat',
      }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_INVALID' });
    await expect(completePlaytestWorld(runDirectory, 'cyberpunk', at)).rejects.toMatchObject({
      code: 'EVIDENCE_INVALID',
    });
  });

  it('records all scripted actions before COMPLETE can be claimed', async () => {
    const outputRoot = await temporaryRoot();
    const { runDirectory } = await materializePlaytestRun({
      outputRoot,
      runId: 'm11-complete-a',
      sourceCommit,
      createdAt: at,
    });
    await setPlaytestProvider(runDirectory, 'fantasy', {
      mode: 'FAKE',
      providerName: 'Deterministic Fake Provider',
      modelName: 'fixture-v1',
    });
    for (const action of PLAYTEST_WORLD_FIXTURES.fantasy.behaviorScript) {
      await appendPlaytestActionEvidence(runDirectory, 'fantasy', evidenceFor(action));
    }
    await expect(completePlaytestWorld(runDirectory, 'fantasy', at)).resolves.toMatchObject({
      status: 'COMPLETE',
      actions: { length: 32 },
    });
    await expect(verifyPlaytestRun(runDirectory)).resolves.toMatchObject({
      actionCount: 32,
      statuses: { fantasy: 'COMPLETE' },
    });
  });

  it('fails closed on secrets and hash tampering', async () => {
    const cloned = structuredClone(PLAYTEST_WORLD_FIXTURES) as Record<
      PlaytestWorldKey,
      PlaytestWorldFixture
    >;
    const first = cloned.investigation.behaviorScript[0];
    if (first === undefined) throw new Error('Investigation script is empty');
    cloned.investigation = {
      ...cloned.investigation,
      behaviorScript: [
        { ...first, input: 'api_key=forbidden-test-value-123456' },
        ...cloned.investigation.behaviorScript.slice(1),
      ],
    };
    expect(() => validatePlaytestWorldFixtures(cloned)).toThrow(
      expect.objectContaining({ code: 'SECRET_DETECTED' }),
    );

    const outputRoot = await temporaryRoot();
    const { runDirectory } = await materializePlaytestRun({
      outputRoot,
      runId: 'm11-tamper-a',
      sourceCommit,
      createdAt: at,
    });
    await writeFile(join(runDirectory, 'fantasy', 'script.json'), '[]\n', 'utf8');
    await expect(verifyPlaytestRun(runDirectory)).rejects.toBeInstanceOf(PlaytestHarnessError);
    await expect(verifyPlaytestRun(runDirectory)).rejects.toMatchObject({ code: 'HASH_MISMATCH' });
  });
});

function evidenceFor(action: PlaytestAction): PlaytestActionEvidence {
  return {
    sequence: action.sequence,
    actionId: action.id,
    outcome: 'SUCCEEDED',
    latencyMs: 12.5,
    persisted: true,
    recordedAt: at,
    observations: action.requiredEvidence.map((kind) => ({
      kind,
      status: 'PASS',
      detail: `synthetic evidence for ${action.id}:${kind}`,
    })),
  };
}

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ember-m11-harness-'));
  temporaryDirectories.push(directory);
  return directory;
}
