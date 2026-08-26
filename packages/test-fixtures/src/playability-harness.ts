import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import {
  assertBalancedCharacterTraitPoints,
  campaignId,
  createTraitPointProfile,
  createWorldCharacterExtensionDefinition,
  isoTimestamp,
  validateCharacterExtensionDraftValues,
} from '@ember-tavern/contracts';
import { assertWorldConstitutionCompliance } from '@ember-tavern/domain';
import { findSecretInJson } from '@ember-tavern/persistence';

import {
  PLAYTEST_ACTION_KINDS,
  PLAYTEST_EVIDENCE_KINDS,
  PLAYTEST_WORLD_FIXTURES,
  PLAYTEST_WORLD_KEYS,
  type PlaytestAction,
  type PlaytestEvidenceKind,
  type PlaytestWorldFixture,
  type PlaytestWorldKey,
} from './playability-worlds.js';

export const PLAYTEST_RUN_FORMAT = 'EMBER_PLAYTEST_RUN' as const;
export const PLAYTEST_EVIDENCE_FORMAT = 'EMBER_PLAYTEST_EVIDENCE' as const;
export const PLAYTEST_FORMAT_VERSION = 1 as const;

export const PLAYTEST_OUTCOMES = ['SUCCEEDED', 'FAILED', 'REJECTED', 'BLOCKED'] as const;
export type PlaytestOutcome = (typeof PLAYTEST_OUTCOMES)[number];

export const PLAYTEST_EVIDENCE_STATUSES = [
  'NOT_RUN',
  'IN_PROGRESS',
  'COMPLETE',
  'BLOCKED',
] as const;
export type PlaytestEvidenceStatus = (typeof PLAYTEST_EVIDENCE_STATUSES)[number];

export interface PlaytestProviderRecord {
  readonly mode: 'NOT_SET' | 'FAKE' | 'REAL';
  readonly providerName: string | null;
  readonly modelName: string | null;
}

export interface PlaytestObservation {
  readonly kind: PlaytestEvidenceKind;
  readonly status: 'PASS' | 'FAIL' | 'NOT_OBSERVED';
  readonly detail: string;
}

export interface PlaytestActionEvidence {
  readonly sequence: number;
  readonly actionId: string;
  readonly outcome: PlaytestOutcome;
  readonly latencyMs: number;
  readonly persisted: boolean;
  readonly recordedAt: string;
  readonly observations: readonly PlaytestObservation[];
}

export interface PlaytestFinding {
  readonly id: string;
  readonly severity: 'P0' | 'P1' | 'P2' | 'P3';
  readonly title: string;
  readonly evidence: string;
  readonly status: 'OPEN' | 'FIXED' | 'DEFERRED' | 'BLOCKED';
}

export interface PlaytestWorldEvidence {
  readonly format: typeof PLAYTEST_EVIDENCE_FORMAT;
  readonly formatVersion: typeof PLAYTEST_FORMAT_VERSION;
  readonly runId: string;
  readonly worldKey: PlaytestWorldKey;
  readonly scenarioHash: string;
  readonly sourceCommit: string;
  readonly provider: PlaytestProviderRecord;
  readonly status: PlaytestEvidenceStatus;
  readonly resetCount: number;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly actions: readonly PlaytestActionEvidence[];
  readonly findings: readonly PlaytestFinding[];
  readonly blockedReason: string | null;
}

export interface PlaytestRunWorldManifest {
  readonly key: PlaytestWorldKey;
  readonly scenarioHash: string;
  readonly fixtureHash: string;
  readonly scriptHash: string;
  readonly directory: string;
  readonly fixtureFile: string;
  readonly scriptFile: string;
  readonly evidenceFile: string;
  readonly databaseFile: string;
}

export interface PlaytestRunManifest {
  readonly format: typeof PLAYTEST_RUN_FORMAT;
  readonly formatVersion: typeof PLAYTEST_FORMAT_VERSION;
  readonly runId: string;
  readonly sourceCommit: string;
  readonly createdAt: string;
  readonly dataOrigin: 'SYNTHETIC_M11';
  readonly worlds: readonly PlaytestRunWorldManifest[];
}

export interface PlaytestRunVerification {
  readonly runId: string;
  readonly sourceCommit: string;
  readonly worldCount: 3;
  readonly actionCount: number;
  readonly statuses: Readonly<Record<PlaytestWorldKey, PlaytestEvidenceStatus>>;
}

export class PlaytestHarnessError extends Error {
  public constructor(
    public readonly code:
      | 'FIXTURE_INVALID'
      | 'RUN_INVALID'
      | 'RUN_EXISTS'
      | 'RUN_NOT_FOUND'
      | 'HASH_MISMATCH'
      | 'SECRET_DETECTED'
      | 'ACTION_OUT_OF_ORDER'
      | 'EVIDENCE_INVALID'
      | 'UNSAFE_PATH',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PlaytestHarnessError';
  }
}

export function validatePlaytestWorldFixtures(
  fixtures: Readonly<Record<PlaytestWorldKey, PlaytestWorldFixture>> = PLAYTEST_WORLD_FIXTURES,
): void {
  const keys = Object.keys(fixtures).sort();
  if (canonicalJson(keys) !== canonicalJson([...PLAYTEST_WORLD_KEYS].sort())) {
    invalidFixture('The harness must contain exactly fantasy, investigation and cyberpunk');
  }

  const globalIds = new Map<string, PlaytestWorldKey>();
  const structuralSignatures = new Set<string>();
  for (const key of PLAYTEST_WORLD_KEYS) {
    const fixture = fixtures[key];
    validateFixtureIdentity(fixture, key);
    assertSecretFree(fixture, `fixtures.${key}`);
    assertWorldConstitutionCompliance(fixture.constitution, {
      technologyLevel: fixture.constitution.technology,
      powerRules: [fixture.constitution.magic],
      forbiddenElements: fixture.constitution.taboos,
    });
    validateCollections(fixture, globalIds);
    validateTraits(fixture);
    validateExtension(fixture);
    validateBehaviorScript(fixture.behaviorScript, key);
    const signature = structuralSignature(fixture);
    if (structuralSignatures.has(signature)) {
      invalidFixture(`World ${key} duplicates another world's structural signature`);
    }
    structuralSignatures.add(signature);
  }
}

export function scenarioHashFor(fixture: PlaytestWorldFixture): string {
  validatePlaytestWorldFixtures();
  const fixtureHash = sha256(canonicalJson({ ...fixture, behaviorScript: undefined }));
  const scriptHash = sha256(canonicalJson(fixture.behaviorScript));
  return sha256(`${fixtureHash}:${scriptHash}`);
}

export async function materializePlaytestRun(input: {
  readonly outputRoot: string;
  readonly runId: string;
  readonly sourceCommit: string;
  readonly createdAt: string;
}): Promise<Readonly<{ runDirectory: string; manifest: PlaytestRunManifest }>> {
  validatePlaytestWorldFixtures();
  const runId = requireRunId(input.runId);
  const sourceCommit = requireCommit(input.sourceCommit);
  const createdAt = requireTimestamp(input.createdAt, 'createdAt');
  const outputRoot = resolve(input.outputRoot);
  const runDirectory = resolve(outputRoot, runId);
  assertChildPath(outputRoot, runDirectory);
  await mkdir(outputRoot, { recursive: true });
  if (await exists(runDirectory)) {
    throw new PlaytestHarnessError('RUN_EXISTS', `Playtest run already exists: ${runId}`);
  }

  const stagingDirectory = resolve(outputRoot, `.${runId}.staging-${randomUUID()}`);
  assertChildPath(outputRoot, stagingDirectory);
  await mkdir(stagingDirectory);
  try {
    const worlds: PlaytestRunWorldManifest[] = [];
    for (const key of PLAYTEST_WORLD_KEYS) {
      const fixture = PLAYTEST_WORLD_FIXTURES[key];
      const directory = key;
      const worldDirectory = join(stagingDirectory, directory);
      await mkdir(worldDirectory);
      const fixturePayload = { ...fixture, behaviorScript: undefined };
      const scriptPayload = fixture.behaviorScript;
      const fixtureHash = sha256(canonicalJson(fixturePayload));
      const scriptHash = sha256(canonicalJson(scriptPayload));
      const scenarioHash = sha256(`${fixtureHash}:${scriptHash}`);
      const world = Object.freeze({
        key,
        scenarioHash,
        fixtureHash,
        scriptHash,
        directory,
        fixtureFile: 'fixture.json',
        scriptFile: 'script.json',
        evidenceFile: 'evidence.json',
        databaseFile: 'campaign.sqlite3',
      });
      await writeNewJson(join(worldDirectory, world.fixtureFile), fixturePayload);
      await writeNewJson(join(worldDirectory, world.scriptFile), scriptPayload);
      await writeNewJson(
        join(worldDirectory, world.evidenceFile),
        emptyEvidence({ runId, sourceCommit, world, resetCount: 0 }),
      );
      worlds.push(world);
    }
    const manifest: PlaytestRunManifest = Object.freeze({
      format: PLAYTEST_RUN_FORMAT,
      formatVersion: PLAYTEST_FORMAT_VERSION,
      runId,
      sourceCommit,
      createdAt,
      dataOrigin: 'SYNTHETIC_M11',
      worlds: Object.freeze(worlds),
    });
    assertSecretFree(manifest, 'manifest');
    await writeNewJson(join(stagingDirectory, 'manifest.json'), manifest);
    await rename(stagingDirectory, runDirectory);
    return Object.freeze({ runDirectory, manifest });
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function resetPlaytestWorld(
  runDirectoryInput: string,
  worldKey: PlaytestWorldKey,
): Promise<PlaytestWorldEvidence> {
  const { runDirectory, manifest } = await loadAndVerifyManifest(runDirectoryInput);
  const world = requireWorld(manifest, worldKey);
  const evidencePath = worldPath(runDirectory, world, world.evidenceFile);
  const previous = parseEvidence(await readJson(evidencePath), world);
  assertEvidenceIdentity(previous, manifest);
  for (const filename of [
    world.databaseFile,
    `${world.databaseFile}-wal`,
    `${world.databaseFile}-shm`,
    'actions.ndjson',
  ]) {
    await unlinkIfPresent(worldPath(runDirectory, world, filename));
  }
  const next = emptyEvidence({
    runId: manifest.runId,
    sourceCommit: manifest.sourceCommit,
    world,
    resetCount: previous.resetCount + 1,
  });
  await atomicWriteJson(evidencePath, next);
  await verifyPlaytestRun(runDirectory);
  return next;
}

export async function appendPlaytestActionEvidence(
  runDirectoryInput: string,
  worldKey: PlaytestWorldKey,
  record: PlaytestActionEvidence,
  findings: readonly PlaytestFinding[] = [],
): Promise<PlaytestWorldEvidence> {
  const { runDirectory, manifest } = await loadAndVerifyManifest(runDirectoryInput);
  const world = requireWorld(manifest, worldKey);
  const worldDirectory = worldPath(runDirectory, world, '.');
  const script = parseBehaviorScript(
    await readJson(join(worldDirectory, world.scriptFile)),
    worldKey,
  );
  const evidencePath = join(worldDirectory, world.evidenceFile);
  const previous = parseEvidence(await readJson(evidencePath), world);
  assertEvidenceIdentity(previous, manifest);
  if (previous.status === 'COMPLETE' || previous.status === 'BLOCKED') {
    throw new PlaytestHarnessError(
      'EVIDENCE_INVALID',
      `Cannot append actions while ${worldKey} is ${previous.status}`,
    );
  }
  const expected = script[previous.actions.length];
  if (
    expected === undefined ||
    record.sequence !== expected.sequence ||
    record.actionId !== expected.id
  ) {
    throw new PlaytestHarnessError(
      'ACTION_OUT_OF_ORDER',
      `Expected ${expected?.id ?? 'no further action'}, received ${record.actionId}`,
    );
  }
  validateActionEvidence(record, expected);
  const previousAction = previous.actions.at(-1);
  if (previousAction !== undefined && record.recordedAt < previousAction.recordedAt) {
    throw new PlaytestHarnessError(
      'EVIDENCE_INVALID',
      `Action ${record.actionId} predates the previous evidence record`,
    );
  }
  findings.forEach(validateFinding);
  const findingIds = [...previous.findings.map(({ id }) => id), ...findings.map(({ id }) => id)];
  if (new Set(findingIds).size !== findingIds.length) {
    throw new PlaytestHarnessError('EVIDENCE_INVALID', 'Finding IDs must be unique per world');
  }
  assertSecretFree({ record, findings }, `evidence.${worldKey}.${record.actionId}`);
  const next: PlaytestWorldEvidence = Object.freeze({
    ...previous,
    provider: previous.provider,
    status: 'IN_PROGRESS',
    startedAt: previous.startedAt ?? record.recordedAt,
    actions: Object.freeze([...previous.actions, Object.freeze(record)]),
    findings: Object.freeze([
      ...previous.findings,
      ...findings.map((finding) => Object.freeze(finding)),
    ]),
  });
  await atomicWriteJson(evidencePath, next);
  return next;
}

export async function setPlaytestProvider(
  runDirectoryInput: string,
  worldKey: PlaytestWorldKey,
  provider: PlaytestProviderRecord,
): Promise<PlaytestWorldEvidence> {
  validateProvider(provider);
  assertSecretFree(provider, `provider.${worldKey}`);
  const { runDirectory, manifest } = await loadAndVerifyManifest(runDirectoryInput);
  const world = requireWorld(manifest, worldKey);
  const evidencePath = worldPath(runDirectory, world, world.evidenceFile);
  const previous = parseEvidence(await readJson(evidencePath), world);
  assertEvidenceIdentity(previous, manifest);
  if (previous.status !== 'NOT_RUN' || previous.actions.length > 0) {
    throw new PlaytestHarnessError(
      'EVIDENCE_INVALID',
      'Provider identity must be frozen while evidence is NOT_RUN',
    );
  }
  const next = Object.freeze({ ...previous, provider: Object.freeze(provider) });
  await atomicWriteJson(evidencePath, next);
  return next;
}

export async function completePlaytestWorld(
  runDirectoryInput: string,
  worldKey: PlaytestWorldKey,
  completedAtInput: string,
): Promise<PlaytestWorldEvidence> {
  const completedAt = requireTimestamp(completedAtInput, 'completedAt');
  const { runDirectory, manifest } = await loadAndVerifyManifest(runDirectoryInput);
  const world = requireWorld(manifest, worldKey);
  const worldDirectory = worldPath(runDirectory, world, '.');
  const script = parseBehaviorScript(
    await readJson(join(worldDirectory, world.scriptFile)),
    worldKey,
  );
  const evidencePath = join(worldDirectory, world.evidenceFile);
  const previous = parseEvidence(await readJson(evidencePath), world);
  assertEvidenceIdentity(previous, manifest);
  if (previous.status !== 'IN_PROGRESS') {
    throw new PlaytestHarnessError(
      'EVIDENCE_INVALID',
      `Cannot complete ${worldKey} while evidence is ${previous.status}`,
    );
  }
  if (previous.provider.mode === 'NOT_SET') {
    throw new PlaytestHarnessError(
      'EVIDENCE_INVALID',
      `Cannot complete ${worldKey} without a frozen provider identity`,
    );
  }
  if (previous.actions.length !== script.length || previous.startedAt === null) {
    throw new PlaytestHarnessError(
      'EVIDENCE_INVALID',
      `Cannot complete ${worldKey} before all ${script.length} actions are recorded`,
    );
  }
  if (completedAt < previous.startedAt) {
    throw new PlaytestHarnessError('EVIDENCE_INVALID', 'completedAt predates startedAt');
  }
  const next = Object.freeze({
    ...previous,
    status: 'COMPLETE' as const,
    completedAt,
    blockedReason: null,
  });
  await atomicWriteJson(evidencePath, next);
  return next;
}

export async function blockPlaytestWorld(
  runDirectoryInput: string,
  worldKey: PlaytestWorldKey,
  blockedAtInput: string,
  reasonInput: string,
): Promise<PlaytestWorldEvidence> {
  const blockedAt = requireTimestamp(blockedAtInput, 'blockedAt');
  const reason = requireText(reasonInput, 'blockedReason', 2_000);
  assertSecretFree(reason, `blockedReason.${worldKey}`);
  const { runDirectory, manifest } = await loadAndVerifyManifest(runDirectoryInput);
  const world = requireWorld(manifest, worldKey);
  const evidencePath = worldPath(runDirectory, world, world.evidenceFile);
  const previous = parseEvidence(await readJson(evidencePath), world);
  assertEvidenceIdentity(previous, manifest);
  if (previous.status === 'COMPLETE') {
    throw new PlaytestHarnessError('EVIDENCE_INVALID', 'A completed playtest cannot be blocked');
  }
  const next = Object.freeze({
    ...previous,
    status: 'BLOCKED' as const,
    startedAt: previous.startedAt ?? blockedAt,
    completedAt: blockedAt,
    blockedReason: reason,
  });
  await atomicWriteJson(evidencePath, next);
  return next;
}

export async function verifyPlaytestRun(
  runDirectoryInput: string,
): Promise<PlaytestRunVerification> {
  validatePlaytestWorldFixtures();
  const { runDirectory, manifest } = await loadAndVerifyManifest(runDirectoryInput);
  const statuses = {} as Record<PlaytestWorldKey, PlaytestEvidenceStatus>;
  let actionCount = 0;
  const resolvedDatabases = new Set<string>();
  for (const world of manifest.worlds) {
    const worldDirectory = worldPath(runDirectory, world, '.');
    const fixture = await readJson(join(worldDirectory, world.fixtureFile));
    const script = await readJson(join(worldDirectory, world.scriptFile));
    if (sha256(canonicalJson(fixture)) !== world.fixtureHash) hashMismatch(world.key, 'fixture');
    if (sha256(canonicalJson(script)) !== world.scriptHash) hashMismatch(world.key, 'script');
    if (sha256(`${world.fixtureHash}:${world.scriptHash}`) !== world.scenarioHash) {
      hashMismatch(world.key, 'scenario');
    }
    assertSecretFree({ fixture, script }, `run.${world.key}`);
    const parsedScript = parseBehaviorScript(script, world.key);
    const evidence = parseEvidence(await readJson(join(worldDirectory, world.evidenceFile)), world);
    if (evidence.runId !== manifest.runId || evidence.sourceCommit !== manifest.sourceCommit) {
      throw new PlaytestHarnessError('EVIDENCE_INVALID', `${world.key} evidence identity drifted`);
    }
    assertSecretFree(evidence, `evidence.${world.key}`);
    validateEvidenceProgress(evidence, parsedScript);
    const databasePath = worldPath(runDirectory, world, world.databaseFile);
    if (resolvedDatabases.has(databasePath)) {
      throw new PlaytestHarnessError('RUN_INVALID', 'World database paths are not isolated');
    }
    resolvedDatabases.add(databasePath);
    statuses[world.key] = evidence.status;
    actionCount += evidence.actions.length;
  }
  return Object.freeze({
    runId: manifest.runId,
    sourceCommit: manifest.sourceCommit,
    worldCount: 3,
    actionCount,
    statuses: Object.freeze(statuses),
  });
}

async function loadAndVerifyManifest(runDirectoryInput: string): Promise<{
  readonly runDirectory: string;
  readonly manifest: PlaytestRunManifest;
}> {
  const runDirectory = resolve(runDirectoryInput);
  if (!(await exists(runDirectory))) {
    throw new PlaytestHarnessError('RUN_NOT_FOUND', `Playtest run not found: ${runDirectory}`);
  }
  const manifest = parseManifest(await readJson(join(runDirectory, 'manifest.json')));
  if (resolve(dirname(runDirectory), manifest.runId) !== runDirectory) {
    throw new PlaytestHarnessError('RUN_INVALID', 'Run directory does not match manifest runId');
  }
  assertSecretFree(manifest, 'manifest');
  return { runDirectory, manifest };
}

function parseManifest(value: unknown): PlaytestRunManifest {
  const record = requireRecord(value, 'manifest');
  if (
    record['format'] !== PLAYTEST_RUN_FORMAT ||
    record['formatVersion'] !== PLAYTEST_FORMAT_VERSION ||
    record['dataOrigin'] !== 'SYNTHETIC_M11' ||
    !Array.isArray(record['worlds']) ||
    record['worlds'].length !== PLAYTEST_WORLD_KEYS.length
  ) {
    throw new PlaytestHarnessError('RUN_INVALID', 'Playtest manifest header is invalid');
  }
  const runId = requireRunId(record['runId']);
  const sourceCommit = requireCommit(record['sourceCommit']);
  const createdAt = requireTimestamp(record['createdAt'], 'manifest.createdAt');
  const worlds = record['worlds'].map((world, index) => parseWorldManifest(world, index));
  if (canonicalJson(worlds.map(({ key }) => key)) !== canonicalJson(PLAYTEST_WORLD_KEYS)) {
    throw new PlaytestHarnessError('RUN_INVALID', 'Manifest world order or identity is invalid');
  }
  return Object.freeze({
    format: PLAYTEST_RUN_FORMAT,
    formatVersion: PLAYTEST_FORMAT_VERSION,
    runId,
    sourceCommit,
    createdAt,
    dataOrigin: 'SYNTHETIC_M11',
    worlds: Object.freeze(worlds),
  });
}

function parseWorldManifest(value: unknown, index: number): PlaytestRunWorldManifest {
  const record = requireRecord(value, `manifest.worlds[${index}]`);
  const key = record['key'];
  if (!PLAYTEST_WORLD_KEYS.includes(key as PlaytestWorldKey)) {
    throw new PlaytestHarnessError('RUN_INVALID', `Unknown world key at index ${index}`);
  }
  const worldKey = key as PlaytestWorldKey;
  const directory = requireSafeFilename(record['directory'], `worlds.${worldKey}.directory`);
  if (directory !== worldKey) {
    throw new PlaytestHarnessError('RUN_INVALID', `World directory must equal ${worldKey}`);
  }
  return Object.freeze({
    key: worldKey,
    scenarioHash: requireHash(record['scenarioHash'], 'scenarioHash'),
    fixtureHash: requireHash(record['fixtureHash'], 'fixtureHash'),
    scriptHash: requireHash(record['scriptHash'], 'scriptHash'),
    directory,
    fixtureFile: requireExactFilename(record['fixtureFile'], 'fixture.json'),
    scriptFile: requireExactFilename(record['scriptFile'], 'script.json'),
    evidenceFile: requireExactFilename(record['evidenceFile'], 'evidence.json'),
    databaseFile: requireExactFilename(record['databaseFile'], 'campaign.sqlite3'),
  });
}

function parseEvidence(value: unknown, world: PlaytestRunWorldManifest): PlaytestWorldEvidence {
  const record = requireRecord(value, `evidence.${world.key}`);
  if (
    record['format'] !== PLAYTEST_EVIDENCE_FORMAT ||
    record['formatVersion'] !== PLAYTEST_FORMAT_VERSION ||
    record['worldKey'] !== world.key ||
    record['scenarioHash'] !== world.scenarioHash ||
    !PLAYTEST_EVIDENCE_STATUSES.includes(record['status'] as PlaytestEvidenceStatus) ||
    !Array.isArray(record['actions']) ||
    !Array.isArray(record['findings'])
  ) {
    throw new PlaytestHarnessError(
      'EVIDENCE_INVALID',
      `Evidence header is invalid for ${world.key}`,
    );
  }
  const provider = parseProvider(record['provider']);
  const actions = record['actions'].map((action) => parseActionEvidence(action));
  const findings = record['findings'].map((finding) => parseFinding(finding));
  const resetCount = record['resetCount'];
  if (!Number.isSafeInteger(resetCount) || (resetCount as number) < 0) {
    throw new PlaytestHarnessError('EVIDENCE_INVALID', 'resetCount is invalid');
  }
  const blockedReason = optionalText(record['blockedReason'], 'blockedReason', 2_000);
  return Object.freeze({
    format: PLAYTEST_EVIDENCE_FORMAT,
    formatVersion: PLAYTEST_FORMAT_VERSION,
    runId: requireRunId(record['runId']),
    worldKey: world.key,
    scenarioHash: world.scenarioHash,
    sourceCommit: requireCommit(record['sourceCommit']),
    provider,
    status: record['status'] as PlaytestEvidenceStatus,
    resetCount: resetCount as number,
    startedAt: optionalTimestamp(record['startedAt'], 'startedAt'),
    completedAt: optionalTimestamp(record['completedAt'], 'completedAt'),
    actions: Object.freeze(actions),
    findings: Object.freeze(findings),
    blockedReason,
  });
}

function parseBehaviorScript(
  value: unknown,
  worldKey: PlaytestWorldKey,
): readonly PlaytestAction[] {
  if (!Array.isArray(value)) {
    throw new PlaytestHarnessError('RUN_INVALID', `Script for ${worldKey} is not an array`);
  }
  const actions = value.map((action, index) => {
    const record = requireRecord(action, `script.${worldKey}[${index}]`);
    const kind = record['kind'];
    const requiredEvidence = record['requiredEvidence'];
    if (
      !PLAYTEST_ACTION_KINDS.includes(kind as PlaytestAction['kind']) ||
      !Array.isArray(requiredEvidence) ||
      requiredEvidence.some(
        (entry) => !PLAYTEST_EVIDENCE_KINDS.includes(entry as PlaytestEvidenceKind),
      )
    ) {
      throw new PlaytestHarnessError('RUN_INVALID', `Script action ${index + 1} is invalid`);
    }
    return Object.freeze({
      sequence: requireSequence(record['sequence'], index + 1),
      id: requireText(record['id'], 'action.id', 100),
      kind: kind as PlaytestAction['kind'],
      input: requireText(record['input'], 'action.input', 2_000),
      requiredEvidence: Object.freeze(requiredEvidence as PlaytestEvidenceKind[]),
    });
  });
  validateBehaviorScript(actions, worldKey);
  return Object.freeze(actions);
}

function parseActionEvidence(value: unknown): PlaytestActionEvidence {
  const record = requireRecord(value, 'actionEvidence');
  const observations = record['observations'];
  if (!Array.isArray(observations)) {
    throw new PlaytestHarnessError('EVIDENCE_INVALID', 'Action observations must be an array');
  }
  const parsed: PlaytestActionEvidence = Object.freeze({
    sequence: requirePositiveInteger(record['sequence'], 'action.sequence'),
    actionId: requireText(record['actionId'], 'action.actionId', 100),
    outcome: requireOutcome(record['outcome']),
    latencyMs: requireLatency(record['latencyMs']),
    persisted: requireBoolean(record['persisted'], 'action.persisted'),
    recordedAt: requireTimestamp(record['recordedAt'], 'action.recordedAt'),
    observations: Object.freeze(observations.map(parseObservation)),
  });
  return parsed;
}

function parseObservation(value: unknown): PlaytestObservation {
  const record = requireRecord(value, 'observation');
  if (
    !PLAYTEST_EVIDENCE_KINDS.includes(record['kind'] as PlaytestEvidenceKind) ||
    !['PASS', 'FAIL', 'NOT_OBSERVED'].includes(record['status'] as string)
  ) {
    throw new PlaytestHarnessError('EVIDENCE_INVALID', 'Observation is invalid');
  }
  return Object.freeze({
    kind: record['kind'] as PlaytestEvidenceKind,
    status: record['status'] as PlaytestObservation['status'],
    detail: requireText(record['detail'], 'observation.detail', 4_000),
  });
}

function parseFinding(value: unknown): PlaytestFinding {
  const record = requireRecord(value, 'finding');
  const finding = Object.freeze({
    id: requireText(record['id'], 'finding.id', 100),
    severity: record['severity'] as PlaytestFinding['severity'],
    title: requireText(record['title'], 'finding.title', 500),
    evidence: requireText(record['evidence'], 'finding.evidence', 4_000),
    status: record['status'] as PlaytestFinding['status'],
  });
  validateFinding(finding);
  return finding;
}

function validateFixtureIdentity(fixture: PlaytestWorldFixture, key: PlaytestWorldKey): void {
  if (
    fixture.schemaVersion !== 1 ||
    fixture.dataOrigin !== 'SYNTHETIC_M11' ||
    fixture.key !== key ||
    fixture.campaignId !== `playtest-m11-${key}`
  ) {
    invalidFixture(`World ${key} does not use the reserved synthetic identity`);
  }
  requireText(fixture.displayName, `${key}.displayName`, 120);
}

function validateCollections(
  fixture: PlaytestWorldFixture,
  globalIds: Map<string, PlaytestWorldKey>,
): void {
  const collections = [
    ['careers', fixture.careers, 3],
    ['equipment', fixture.equipment, 3],
    ['traits', fixture.traits, 2],
    ['npcs', fixture.npcs, 3],
    ['quests', fixture.quests, 3],
  ] as const;
  for (const [label, values, minimum] of collections) {
    if (values.length < minimum) invalidFixture(`${fixture.key}.${label} is incomplete`);
    const localIds = new Set<string>();
    for (const value of values) {
      const id = String(value.id);
      requireText(id, `${fixture.key}.${label}.id`, 120);
      if (localIds.has(id)) invalidFixture(`${fixture.key}.${label} contains duplicate ${id}`);
      localIds.add(id);
      const globalKey = `${label}:${id}`;
      const owner = globalIds.get(globalKey);
      if (owner !== undefined) {
        invalidFixture(`${fixture.key}.${label}.${id} duplicates ${owner}`);
      }
      globalIds.set(globalKey, fixture.key);
    }
  }
  const npcIds = new Set(fixture.npcs.map(({ id }) => id));
  for (const career of fixture.careers) {
    requireText(career.name, `${fixture.key}.${career.id}.name`, 120);
    requireText(career.role, `${fixture.key}.${career.id}.role`, 1_000);
    requireText(career.socialPosition, `${fixture.key}.${career.id}.socialPosition`, 1_000);
    requireTextList(career.skills, `${fixture.key}.${career.id}.skills`, 2, 24);
    requireTextList(career.equipmentTags, `${fixture.key}.${career.id}.equipmentTags`, 1, 24);
  }
  for (const item of fixture.equipment) {
    if (!['WEAPON', 'ARMOR', 'TOOL', 'CONSUMABLE', 'CLUE', 'OTHER'].includes(item.category)) {
      invalidFixture(`${fixture.key}.${item.id} uses an invalid equipment category`);
    }
    requireText(item.name, `${fixture.key}.${item.id}.name`, 120);
    requireText(item.description, `${fixture.key}.${item.id}.description`, 1_000);
    requireText(item.ruleHook, `${fixture.key}.${item.id}.ruleHook`, 1_000);
  }
  for (const npc of fixture.npcs) {
    requireText(npc.name, `${fixture.key}.${npc.id}.name`, 120);
    requireText(npc.identity, `${fixture.key}.${npc.id}.identity`, 1_000);
    requireText(npc.personality, `${fixture.key}.${npc.id}.personality`, 1_000);
    requireText(npc.goal, `${fixture.key}.${npc.id}.goal`, 1_000);
    requireText(npc.hiddenMotive, `${fixture.key}.${npc.id}.hiddenMotive`, 1_000);
    requireText(npc.knowledgeBoundary, `${fixture.key}.${npc.id}.knowledgeBoundary`, 1_000);
  }
  for (const quest of fixture.quests) {
    if (!npcIds.has(quest.publisherNpcId)) {
      invalidFixture(`${fixture.key}.${quest.id} references an unknown publisher`);
    }
    if (!['LOW', 'MODERATE', 'HIGH', 'EXTREME'].includes(quest.risk)) {
      invalidFixture(`${fixture.key}.${quest.id} uses an invalid risk`);
    }
    requireText(quest.title, `${fixture.key}.${quest.id}.title`, 120);
    requireText(quest.objective, `${fixture.key}.${quest.id}.objective`, 1_000);
    requireText(quest.failureCost, `${fixture.key}.${quest.id}.failureCost`, 1_000);
  }
}

function validateTraits(fixture: PlaytestWorldFixture): void {
  const traits = fixture.traits.map((trait) => ({
    ...trait,
    pointProfile: createTraitPointProfile(trait.pointProfile),
  }));
  assertBalancedCharacterTraitPoints(traits);
}

function validateExtension(fixture: PlaytestWorldFixture): void {
  const at = isoTimestamp('2026-08-24T00:00:00.000Z');
  const campaign = campaignId(fixture.campaignId);
  const definition = createWorldCharacterExtensionDefinition({
    schemaVersion: 1,
    campaignId: campaign,
    namespace: fixture.extension.namespace,
    displayName: fixture.extension.displayName,
    constitutionRevision: 1,
    fields: fixture.extension.fields,
    revision: 1,
    createdAt: at,
    updatedAt: at,
  });
  validateCharacterExtensionDraftValues(
    {
      campaignId: campaign,
      extensions: [
        {
          namespace: fixture.extension.namespace,
          schemaVersion: 1,
          values: fixture.extension.initialValues,
        },
      ],
    },
    [definition],
  );
}

function validateBehaviorScript(
  actions: readonly PlaytestAction[],
  worldKey: PlaytestWorldKey,
): void {
  if (actions.length < 30 || actions.length > 50) {
    invalidFixture(`${worldKey} behavior script must contain 30 to 50 actions`);
  }
  const ids = new Set<string>();
  const kinds = new Set<PlaytestAction['kind']>();
  actions.forEach((action, index) => {
    if (
      action.sequence !== index + 1 ||
      action.id !== `${worldKey}-${String(index + 1).padStart(2, '0')}`
    ) {
      invalidFixture(`${worldKey} action sequence is not canonical`);
    }
    if (ids.has(action.id)) invalidFixture(`${worldKey} action IDs are not unique`);
    ids.add(action.id);
    kinds.add(action.kind);
    requireText(action.input, `${action.id}.input`, 2_000);
    const required = requiredEvidenceForValidation(action.kind);
    if (canonicalJson(action.requiredEvidence) !== canonicalJson(required)) {
      invalidFixture(`${action.id} evidence requirements drifted from its action kind`);
    }
  });
  for (const kind of PLAYTEST_ACTION_KINDS) {
    if (!kinds.has(kind)) invalidFixture(`${worldKey} script does not cover ${kind}`);
  }
}

function structuralSignature(fixture: PlaytestWorldFixture): string {
  return canonicalJson({
    technology: fixture.constitution.technology,
    magic: fixture.constitution.magic,
    economy: fixture.constitution.economy,
    equipmentCategories: fixture.equipment.map(({ category }) => category).sort(),
    traitProfiles: fixture.traits.map(({ pointProfile }) => ({
      type: pointProfile?.type,
      buffPoints: pointProfile?.buffPoints,
      debuffPoints: pointProfile?.debuffPoints,
    })),
    questRisks: fixture.quests.map(({ risk }) => risk).sort(),
    extension: fixture.extension.fields.map((field) => ({
      key: field.key,
      type: field.type,
      minimum: 'minimum' in field ? field.minimum : null,
      maximum: 'maximum' in field ? field.maximum : null,
      options: 'options' in field ? field.options : null,
    })),
  });
}

function emptyEvidence(input: {
  readonly runId: string;
  readonly sourceCommit: string;
  readonly world: PlaytestRunWorldManifest;
  readonly resetCount: number;
}): PlaytestWorldEvidence {
  return Object.freeze({
    format: PLAYTEST_EVIDENCE_FORMAT,
    formatVersion: PLAYTEST_FORMAT_VERSION,
    runId: input.runId,
    worldKey: input.world.key,
    scenarioHash: input.world.scenarioHash,
    sourceCommit: input.sourceCommit,
    provider: Object.freeze({ mode: 'NOT_SET', providerName: null, modelName: null }),
    status: 'NOT_RUN',
    resetCount: input.resetCount,
    startedAt: null,
    completedAt: null,
    actions: Object.freeze([]),
    findings: Object.freeze([]),
    blockedReason: null,
  });
}

function validateActionEvidence(record: PlaytestActionEvidence, expected: PlaytestAction): void {
  if (
    !Number.isSafeInteger(record.sequence) ||
    !PLAYTEST_OUTCOMES.includes(record.outcome) ||
    !Number.isFinite(record.latencyMs) ||
    record.latencyMs < 0 ||
    typeof record.persisted !== 'boolean'
  ) {
    throw new PlaytestHarnessError('EVIDENCE_INVALID', `Action ${record.actionId} is invalid`);
  }
  requireTimestamp(record.recordedAt, 'recordedAt');
  const observedKinds = new Set(record.observations.map(({ kind }) => kind));
  if (observedKinds.size !== record.observations.length) {
    throw new PlaytestHarnessError(
      'EVIDENCE_INVALID',
      `Action ${record.actionId} contains duplicate observations`,
    );
  }
  for (const kind of expected.requiredEvidence) {
    if (!observedKinds.has(kind)) {
      throw new PlaytestHarnessError(
        'EVIDENCE_INVALID',
        `Action ${record.actionId} is missing ${kind}`,
      );
    }
  }
  record.observations.forEach(parseObservation);
}

function assertEvidenceIdentity(
  evidence: PlaytestWorldEvidence,
  manifest: PlaytestRunManifest,
): void {
  if (evidence.runId !== manifest.runId || evidence.sourceCommit !== manifest.sourceCommit) {
    throw new PlaytestHarnessError(
      'EVIDENCE_INVALID',
      `${evidence.worldKey} evidence identity drifted`,
    );
  }
}

function validateFinding(finding: PlaytestFinding): void {
  if (
    !['P0', 'P1', 'P2', 'P3'].includes(finding.severity) ||
    !['OPEN', 'FIXED', 'DEFERRED', 'BLOCKED'].includes(finding.status)
  ) {
    throw new PlaytestHarnessError('EVIDENCE_INVALID', `Finding ${finding.id} is invalid`);
  }
  requireText(finding.id, 'finding.id', 100);
  requireText(finding.title, 'finding.title', 500);
  requireText(finding.evidence, 'finding.evidence', 4_000);
}

function validateEvidenceProgress(
  evidence: PlaytestWorldEvidence,
  script: readonly PlaytestAction[],
): void {
  if (evidence.actions.length > script.length) {
    throw new PlaytestHarnessError('EVIDENCE_INVALID', 'Evidence exceeds behavior script length');
  }
  evidence.actions.forEach((record, index) => {
    const expected = script[index];
    if (expected === undefined) {
      throw new PlaytestHarnessError('EVIDENCE_INVALID', 'Evidence action has no script entry');
    }
    if (record.sequence !== expected.sequence || record.actionId !== expected.id) {
      throw new PlaytestHarnessError('ACTION_OUT_OF_ORDER', 'Evidence action order drifted');
    }
    validateActionEvidence(record, expected);
  });
  if (evidence.status === 'NOT_RUN' && evidence.actions.length !== 0) {
    throw new PlaytestHarnessError('EVIDENCE_INVALID', 'NOT_RUN evidence contains actions');
  }
  if (evidence.status === 'COMPLETE' && evidence.actions.length !== script.length) {
    throw new PlaytestHarnessError('EVIDENCE_INVALID', 'COMPLETE evidence is missing actions');
  }
  if (evidence.status === 'BLOCKED' && evidence.blockedReason === null) {
    throw new PlaytestHarnessError('EVIDENCE_INVALID', 'BLOCKED evidence has no reason');
  }
  if (evidence.status !== 'BLOCKED' && evidence.blockedReason !== null) {
    throw new PlaytestHarnessError(
      'EVIDENCE_INVALID',
      'Non-blocked evidence contains a blocked reason',
    );
  }
}

function validateProvider(provider: PlaytestProviderRecord): void {
  if (!['NOT_SET', 'FAKE', 'REAL'].includes(provider.mode)) {
    throw new PlaytestHarnessError('EVIDENCE_INVALID', 'Provider mode is invalid');
  }
  if (provider.mode === 'NOT_SET') {
    if (provider.providerName !== null || provider.modelName !== null) {
      throw new PlaytestHarnessError('EVIDENCE_INVALID', 'NOT_SET provider cannot name a model');
    }
    return;
  }
  requireText(provider.providerName, 'providerName', 240);
  requireText(provider.modelName, 'modelName', 240);
}

function parseProvider(value: unknown): PlaytestProviderRecord {
  const record = requireRecord(value, 'provider');
  const provider = Object.freeze({
    mode: record['mode'] as PlaytestProviderRecord['mode'],
    providerName: optionalText(record['providerName'], 'providerName', 240),
    modelName: optionalText(record['modelName'], 'modelName', 240),
  });
  validateProvider(provider);
  return provider;
}

function requiredEvidenceForValidation(
  kind: PlaytestAction['kind'],
): readonly PlaytestEvidenceKind[] {
  const base: PlaytestEvidenceKind[] = ['OUTPUT', 'LATENCY', 'STATE_DIGEST'];
  if (kind === 'TALK_NPC' || kind === 'INSPECT_RUMOR') base.push('KNOWLEDGE_BOUNDARY');
  if (kind === 'ACCEPT_QUEST') base.push('QUEST_STATE');
  if (kind === 'D20_ACTION') base.push('D20_HARD_RESULT');
  if (kind === 'EQUIP_ITEM' || kind === 'TRADE') base.push('ECONOMY_EQUIPMENT');
  if (kind === 'TRAVEL' || kind === 'ADVANCE_TIME') base.push('WORLD_STATE');
  if (kind === 'SAVE_REOPEN') base.push('REOPEN_STATE');
  if (kind === 'FREE_INPUT') base.push('CONSEQUENCE');
  return base;
}

function requireWorld(
  manifest: PlaytestRunManifest,
  key: PlaytestWorldKey,
): PlaytestRunWorldManifest {
  const world = manifest.worlds.find((candidate) => candidate.key === key);
  if (world === undefined) {
    throw new PlaytestHarnessError('RUN_INVALID', `Manifest does not contain ${key}`);
  }
  return world;
}

function worldPath(
  runDirectory: string,
  world: PlaytestRunWorldManifest,
  filename: string,
): string {
  const worldDirectory = resolve(runDirectory, world.directory);
  assertChildPath(runDirectory, worldDirectory);
  const target = resolve(worldDirectory, filename);
  if (filename === '.') return worldDirectory;
  assertChildPath(worldDirectory, target);
  return target;
}

function assertChildPath(parentInput: string, childInput: string): void {
  const parent = resolve(parentInput);
  const child = resolve(childInput);
  const relativePath = relative(parent, child);
  if (relativePath === '' || relativePath.startsWith(`..${sep}`) || relativePath === '..') {
    throw new PlaytestHarnessError(
      'UNSAFE_PATH',
      `Path is outside the playtest boundary: ${child}`,
    );
  }
}

function assertSecretFree(value: unknown, path: string): void {
  const detection =
    typeof value === 'string' ? findSecretInJson({ value }, path) : findSecretInJson(value, path);
  if (detection !== null) {
    throw new PlaytestHarnessError(
      'SECRET_DETECTED',
      `Secret material detected at ${detection.path}`,
    );
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function writeNewJson(path: string, value: unknown): Promise<void> {
  assertSecretFree(value, path);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  assertSecretFree(value, path);
  const temporary = `${path}.tmp-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  await rename(temporary, path);
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    throw new PlaytestHarnessError('RUN_INVALID', `Cannot read playtest JSON: ${path}`, {
      cause: error,
    });
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PlaytestHarnessError('RUN_INVALID', `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireRunId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{2,63}$/u.test(value)) {
    throw new PlaytestHarnessError('RUN_INVALID', 'runId must be a safe lowercase slug');
  }
  return value;
}

function requireCommit(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{7,40}$/u.test(value)) {
    throw new PlaytestHarnessError('RUN_INVALID', 'sourceCommit must be a Git commit hash');
  }
  return value;
}

function requireHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new PlaytestHarnessError('RUN_INVALID', `${label} must be SHA-256`);
  }
  return value;
}

function requireExactFilename(value: unknown, expected: string): string {
  if (value !== expected) {
    throw new PlaytestHarnessError('RUN_INVALID', `Expected filename ${expected}`);
  }
  return expected;
}

function requireSafeFilename(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]*$/u.test(value)) {
    throw new PlaytestHarnessError('RUN_INVALID', `${label} is unsafe`);
  }
  return value;
}

function requireText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
    throw new PlaytestHarnessError('EVIDENCE_INVALID', `${label} is invalid`);
  }
  return value;
}

function requireTextList(
  values: readonly string[],
  label: string,
  minimum: number,
  maximum: number,
): void {
  if (values.length < minimum || values.length > maximum) {
    invalidFixture(`${label} has an invalid item count`);
  }
  const normalized = values.map((value, index) =>
    requireText(value, `${label}[${index}]`, 240).normalize('NFKC').trim().toLowerCase(),
  );
  if (new Set(normalized).size !== normalized.length) {
    invalidFixture(`${label} contains duplicates`);
  }
}

function optionalText(value: unknown, label: string, maximum: number): string | null {
  return value === null ? null : requireText(value, label, maximum);
}

function requireTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new PlaytestHarnessError('EVIDENCE_INVALID', `${label} must be an ISO timestamp`);
  }
  return value;
}

function optionalTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : requireTimestamp(value, label);
}

function requireSequence(value: unknown, expected: number): number {
  const sequence = requirePositiveInteger(value, 'sequence');
  if (sequence !== expected) {
    throw new PlaytestHarnessError('RUN_INVALID', `Expected sequence ${expected}`);
  }
  return sequence;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new PlaytestHarnessError('EVIDENCE_INVALID', `${label} must be a positive integer`);
  }
  return value as number;
}

function requireLatency(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new PlaytestHarnessError('EVIDENCE_INVALID', 'latencyMs must be finite and non-negative');
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new PlaytestHarnessError('EVIDENCE_INVALID', `${label} must be boolean`);
  }
  return value;
}

function requireOutcome(value: unknown): PlaytestOutcome {
  if (!PLAYTEST_OUTCOMES.includes(value as PlaytestOutcome)) {
    throw new PlaytestHarnessError('EVIDENCE_INVALID', 'Action outcome is invalid');
  }
  return value as PlaytestOutcome;
}

function invalidFixture(message: string): never {
  throw new PlaytestHarnessError('FIXTURE_INVALID', message);
}

function hashMismatch(worldKey: PlaytestWorldKey, target: string): never {
  throw new PlaytestHarnessError('HASH_MISMATCH', `${worldKey} ${target} hash mismatch`);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value;
}
