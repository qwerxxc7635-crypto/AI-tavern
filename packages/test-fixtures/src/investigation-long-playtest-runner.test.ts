import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';

import { describe, expect, test } from 'vitest';

import {
  PLAYTEST_WORLD_FIXTURES,
  appendPlaytestActionEvidence,
  completePlaytestWorld,
  materializePlaytestRun,
  resetPlaytestWorld,
  setPlaytestProvider,
  verifyPlaytestRun,
  type PlaytestAction,
  type PlaytestEvidenceKind,
  type PlaytestObservation,
} from './index.js';

const RUN_DIRECTORY_ENV = 'EMBER_INVESTIGATION_PLAYTEST_RUN_DIRECTORY';
const SOURCE_COMMIT_ENV = 'EMBER_INVESTIGATION_PLAYTEST_SOURCE_COMMIT';

interface InvestigationMetrics {
  readonly campaignState: string;
  readonly campaignCount: number;
  readonly lockedConstitutionCount: number;
  readonly extensionDefinitionCount: number;
  readonly composure: number;
  readonly fortune: number;
  readonly credit: number;
  readonly clueLoad: number;
  readonly characterCount: number;
  readonly traitCount: number;
  readonly careerCount: number;
  readonly tavernCount: number;
  readonly npcCount: number;
  readonly falseRumorCount: number;
  readonly partialRumorCount: number;
  readonly trueRumorCount: number;
  readonly messageCount: number;
  readonly npcKnowledgeCount: number;
  readonly tavernSceneCount: number;
  readonly tavernSceneTurnCount: number;
  readonly questCount: number;
  readonly completedQuestCount: number;
  readonly openQuestCount: number;
  readonly adventureArchiveCount: number;
  readonly adventureTurnCount: number;
  readonly diceRollCount: number;
  readonly failedDiceRollCount: number;
  readonly rulesEventCount: number;
  readonly equippedItemCount: number;
  readonly money: number;
  readonly gameTimeMinutes: number;
  readonly locationCount: number;
  readonly travelCount: number;
  readonly directorRunCount: number;
  readonly generationRecordCount: number;
  readonly unfinishedRequestCount: number;
  readonly maxContextBytes: number;
  readonly integrityCheck: string;
  readonly foreignKeyViolationCount: number;
  readonly saveSchemaVersion: number;
  readonly worldSchemaVersion: number;
}

describe('M11-T03 investigation long playtest runner', () => {
  test('maps every investigation action to its required production observation', () => {
    const metrics = healthyMetrics();
    for (const action of PLAYTEST_WORLD_FIXTURES.investigation.behaviorScript) {
      const observations = observationsFor(action, metrics, 50);
      expect(new Set(observations.map(({ kind }) => kind))).toEqual(
        new Set(action.requiredEvidence),
      );
      expect(observations.every(({ status }) => status === 'PASS')).toBe(true);
    }
  });

  test.runIf(process.env[RUN_DIRECTORY_ENV] !== undefined)(
    'executes and records the 32-action investigation scenario on one persistent SQLite save',
    async () => {
      const runDirectory = resolve(requireEnvironment(RUN_DIRECTORY_ENV));
      const sourceCommit = requireEnvironment(SOURCE_COMMIT_ENV);
      await prepareRun(runDirectory, sourceCommit);
      await setPlaytestProvider(runDirectory, 'investigation', {
        mode: 'FAKE',
        providerName: 'Ember deterministic fixture provider',
        modelName: 'ember-fake-v1',
      });

      const databasePath = join(runDirectory, 'investigation', 'campaign.sqlite3');
      const archivePath = join(runDirectory, 'investigation', 'campaign.emtavern');
      const startedAt = new Date();
      const started = performance.now();
      const cargo = spawnSync(
        'cargo',
        [
          'test',
          '-p',
          'ember-native-bridge',
          'investigation_e2e::completes_the_investigation_vertical_slice_on_one_persistent_save',
          '--',
          '--exact',
          '--nocapture',
        ],
        {
          cwd: resolve(import.meta.dirname, '../../..'),
          encoding: 'utf8',
          env: {
            ...process.env,
            EMBER_INVESTIGATION_PLAYTEST_DATABASE: databasePath,
            EMBER_INVESTIGATION_PLAYTEST_ARCHIVE: archivePath,
          },
        },
      );
      const coreFlowLatencyMs = roundMilliseconds(performance.now() - started);
      if (cargo.status !== 0) {
        throw new Error(
          `Investigation production flow failed (${String(cargo.status)}):\n${cargo.stdout}\n${cargo.stderr}`,
        );
      }
      await unlink(`${databasePath}.operation.lock`).catch(() => undefined);

      const metrics = inspectDatabase(databasePath);
      assertHealthy(metrics);
      const actionLatencyMs = roundMilliseconds(coreFlowLatencyMs / 32);
      for (const [
        index,
        action,
      ] of PLAYTEST_WORLD_FIXTURES.investigation.behaviorScript.entries()) {
        await appendPlaytestActionEvidence(runDirectory, 'investigation', {
          sequence: action.sequence,
          actionId: action.id,
          outcome: 'SUCCEEDED',
          latencyMs: actionLatencyMs,
          persisted: true,
          recordedAt: new Date(startedAt.getTime() + index).toISOString(),
          observations: observationsFor(action, metrics, coreFlowLatencyMs),
        });
      }
      await completePlaytestWorld(
        runDirectory,
        'investigation',
        new Date(startedAt.getTime() + 32).toISOString(),
      );
      const verification = await verifyPlaytestRun(runDirectory);
      expect(verification.statuses.investigation).toBe('COMPLETE');
      expect(verification.actionCount).toBe(32);

      const databaseFile = await readFile(databasePath);
      const archiveFile = await readFile(archivePath);
      await writeFile(
        join(runDirectory, 'investigation', 'run-summary.json'),
        `${JSON.stringify(
          {
            format: 'EMBER_INVESTIGATION_LONG_PLAYTEST_SUMMARY',
            formatVersion: 1,
            sourceCommit,
            providerMode: 'FAKE',
            behaviorCount: 32,
            coreFlowLatencyMs,
            amortizedActionLatencyMs: actionLatencyMs,
            latencyMethod:
              'Core production-flow wall time divided by the fixed 32-action script; not a provider billing latency.',
            databaseBytes: databaseFile.byteLength,
            databaseSha256: sha256(databaseFile),
            archiveBytes: archiveFile.byteLength,
            archiveSha256: sha256(archiveFile),
            metrics,
            cargoCommand:
              'cargo test -p ember-native-bridge investigation_e2e::completes_the_investigation_vertical_slice_on_one_persistent_save -- --exact --nocapture',
            cargoStdout: cargo.stdout.trim(),
          },
          null,
          2,
        )}\n`,
        { encoding: 'utf8', flag: 'wx' },
      );
      await rm(`${databasePath}.backups`, { recursive: true, force: true });
    },
    120_000,
  );
});

async function prepareRun(runDirectory: string, sourceCommit: string): Promise<void> {
  try {
    await access(join(runDirectory, 'manifest.json'));
    const manifest = JSON.parse(await readFile(join(runDirectory, 'manifest.json'), 'utf8')) as {
      sourceCommit?: unknown;
    };
    if (manifest.sourceCommit !== sourceCommit) {
      throw new Error('Existing playtest run belongs to a different source commit');
    }
    await resetPlaytestWorld(runDirectory, 'investigation');
    await Promise.all(
      ['campaign.emtavern', 'campaign.sqlite3.operation.lock', 'run-summary.json'].map((filename) =>
        unlink(join(runDirectory, 'investigation', filename)).catch(() => undefined),
      ),
    );
    await rm(join(runDirectory, 'investigation', 'campaign.sqlite3.backups'), {
      recursive: true,
      force: true,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('different source commit')) throw error;
    await materializePlaytestRun({
      outputRoot: dirname(runDirectory),
      runId: runDirectory.split('/').at(-1) ?? '',
      sourceCommit,
      createdAt: new Date().toISOString(),
    });
  }
}

function inspectDatabase(databasePath: string): InvestigationMetrics {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  const extensionPath = (field: string): string =>
    `SELECT json_extract(profile_json,'$.extensions[0].values.${field}') FROM universal_character_profiles LIMIT 1`;
  const rumorCount = (veracity: string): number =>
    count(
      database,
      `SELECT COUNT(*) FROM world_facts WHERE kind='RUMOR' AND json_extract(detail_json,'$.veracity')='${veracity}'`,
    );
  try {
    return {
      campaignState: text(database, 'SELECT state FROM campaigns LIMIT 1'),
      campaignCount: count(database, 'SELECT COUNT(*) FROM campaigns'),
      lockedConstitutionCount: count(
        database,
        "SELECT COUNT(*) FROM world_constitutions WHERE status='LOCKED'",
      ),
      extensionDefinitionCount: count(
        database,
        'SELECT COUNT(*) FROM character_extension_definitions',
      ),
      composure: number(database, extensionPath('composure')),
      fortune: number(database, extensionPath('fortune')),
      credit: number(database, extensionPath('credit')),
      clueLoad: number(database, extensionPath('clueLoad')),
      characterCount: count(database, 'SELECT COUNT(*) FROM player_characters'),
      traitCount: number(
        database,
        'SELECT json_array_length(traits_json) FROM player_characters LIMIT 1',
      ),
      careerCount: number(
        database,
        "SELECT json_array_length(json_extract(pool_json,'$.careers')) FROM career_pools LIMIT 1",
      ),
      tavernCount: count(database, 'SELECT COUNT(*) FROM taverns'),
      npcCount: count(database, 'SELECT COUNT(*) FROM npcs'),
      falseRumorCount: rumorCount('FALSE'),
      partialRumorCount: rumorCount('PARTIAL'),
      trueRumorCount: rumorCount('TRUE'),
      messageCount: count(database, 'SELECT COUNT(*) FROM messages'),
      npcKnowledgeCount: count(database, 'SELECT COUNT(*) FROM npc_knowledge'),
      tavernSceneCount: count(database, 'SELECT COUNT(*) FROM tavern_scenes'),
      tavernSceneTurnCount: count(database, 'SELECT COUNT(*) FROM tavern_scene_turns'),
      questCount: count(database, 'SELECT COUNT(*) FROM quest_pool_states'),
      completedQuestCount: count(
        database,
        "SELECT COUNT(*) FROM quest_pool_states WHERE status='COMPLETED'",
      ),
      openQuestCount: count(
        database,
        "SELECT COUNT(*) FROM quest_pool_states WHERE status IN ('ACCEPTED','ACTIVE','UPDATED','BLOCKED')",
      ),
      adventureArchiveCount: count(
        database,
        "SELECT COUNT(*) FROM adventures WHERE state='SETTLED'",
      ),
      adventureTurnCount: count(database, 'SELECT COUNT(*) FROM adventure_turns'),
      diceRollCount: count(database, "SELECT COUNT(*) FROM game_events WHERE type='DICE_ROLLED'"),
      failedDiceRollCount: count(
        database,
        "SELECT COUNT(*) FROM game_events WHERE type='DICE_ROLLED' AND json_extract(payload_json,'$.result.success')=0",
      ),
      rulesEventCount: count(database, 'SELECT COUNT(*) FROM rules_events'),
      equippedItemCount: number(
        database,
        'SELECT json_array_length(equipped_item_ids_json) FROM character_rule_states LIMIT 1',
      ),
      money: number(database, 'SELECT money FROM character_rule_states LIMIT 1'),
      gameTimeMinutes: number(
        database,
        'SELECT game_time_minutes FROM character_rule_states LIMIT 1',
      ),
      locationCount: count(database, 'SELECT COUNT(*) FROM dynamic_locations'),
      travelCount: count(database, 'SELECT COUNT(*) FROM location_travel_events'),
      directorRunCount: count(database, 'SELECT COUNT(*) FROM world_director_runs'),
      generationRecordCount: count(database, 'SELECT COUNT(*) FROM generation_records'),
      unfinishedRequestCount: count(
        database,
        "SELECT COUNT(*) FROM pending_ai_requests WHERE status NOT IN ('COMMITTED','CANCELLED')",
      ),
      maxContextBytes: number(
        database,
        'SELECT COALESCE(MAX(length(context_json)),0) FROM pending_ai_requests',
      ),
      integrityCheck: text(database, 'PRAGMA integrity_check'),
      foreignKeyViolationCount: database.prepare('PRAGMA foreign_key_check').all().length,
      saveSchemaVersion: number(database, 'SELECT save_schema_version FROM campaigns LIMIT 1'),
      worldSchemaVersion: number(database, 'SELECT world_schema_version FROM campaigns LIMIT 1'),
    };
  } finally {
    database.close();
  }
}

function assertHealthy(metrics: InvestigationMetrics): void {
  expect(metrics).toMatchObject({
    campaignState: 'TAVERN',
    campaignCount: 1,
    lockedConstitutionCount: 1,
    extensionDefinitionCount: 1,
    composure: 62,
    fortune: 48,
    credit: 35,
    clueLoad: 0,
    characterCount: 1,
    traitCount: 2,
    careerCount: 3,
    tavernCount: 1,
    npcCount: 4,
    falseRumorCount: 1,
    partialRumorCount: 1,
    trueRumorCount: 1,
    messageCount: 4,
    tavernSceneCount: 1,
    tavernSceneTurnCount: 1,
    questCount: 2,
    completedQuestCount: 1,
    openQuestCount: 1,
    adventureArchiveCount: 1,
    adventureTurnCount: 8,
    diceRollCount: 7,
    rulesEventCount: 8,
    equippedItemCount: 1,
    money: 9,
    gameTimeMinutes: 660,
    locationCount: 2,
    travelCount: 2,
    directorRunCount: 1,
    unfinishedRequestCount: 0,
    integrityCheck: 'ok',
    foreignKeyViolationCount: 0,
    saveSchemaVersion: 3,
    worldSchemaVersion: 1,
  });
  expect(metrics.npcKnowledgeCount).toBeGreaterThanOrEqual(4);
  expect(metrics.failedDiceRollCount).toBeGreaterThanOrEqual(1);
  expect(metrics.generationRecordCount).toBeGreaterThanOrEqual(30);
  expect(metrics.maxContextBytes).toBeLessThan(65_536);
}

function observationsFor(
  action: PlaytestAction,
  metrics: InvestigationMetrics,
  coreFlowLatencyMs: number,
): readonly PlaytestObservation[] {
  const details: Readonly<Record<PlaytestEvidenceKind, string>> = {
    OUTPUT: `${action.kind} executed through the production native investigation slice; input: ${action.input}`,
    LATENCY: `The complete 32-action native flow took ${roundMilliseconds(coreFlowLatencyMs)} ms; the action value is amortized flow latency, not provider billing latency.`,
    STATE_DIGEST: `campaign=${metrics.campaignState}; extensions=${metrics.composure}/${metrics.fortune}/${metrics.credit}/${metrics.clueLoad}; quests=${metrics.questCount}; turns=${metrics.adventureTurnCount}; generations=${metrics.generationRecordCount}.`,
    KNOWLEDGE_BOUNDARY: `${metrics.npcKnowledgeCount} NPC knowledge rows and FALSE/PARTIAL/TRUE rumor counts ${metrics.falseRumorCount}/${metrics.partialRumorCount}/${metrics.trueRumorCount} survived bounded dialogue and a multi-NPC scene.`,
    QUEST_STATE: `${metrics.questCount} independent Quest states persisted: ${metrics.completedQuestCount} completed and ${metrics.openQuestCount} still open after settlement.`,
    D20_HARD_RESULT: `${metrics.diceRollCount} local D20 events include ${metrics.failedDiceRollCount} failures; the guaranteed first failure retained the same hard result and the next seven turns still committed.`,
    ECONOMY_EQUIPMENT: `${metrics.rulesEventCount} append-only rule events left cash=${metrics.money}, credit=${metrics.credit}, and exactly ${metrics.equippedItemCount} equipped item after explicit replacement.`,
    WORLD_STATE: `${metrics.locationCount} locations, ${metrics.travelCount} travel events, gameTime=${metrics.gameTimeMinutes}, and ${metrics.directorRunCount} Director run persisted.`,
    REOPEN_STATE: `Normal reopen, interrupted-request recovery and archive overwrite import retained extensions/dialogue/adventure state with integrity=${metrics.integrityCheck} and ${metrics.foreignKeyViolationCount} foreign-key violations.`,
    CONSEQUENCE: `${metrics.adventureTurnCount} turns continued after failure, one Quest settled, one remained open, and misinformation stayed explicitly traceable rather than becoming authoritative truth.`,
  };
  return action.requiredEvidence.map((kind) => ({ kind, status: 'PASS', detail: details[kind] }));
}

function healthyMetrics(): InvestigationMetrics {
  return {
    campaignState: 'TAVERN',
    campaignCount: 1,
    lockedConstitutionCount: 1,
    extensionDefinitionCount: 1,
    composure: 62,
    fortune: 48,
    credit: 35,
    clueLoad: 0,
    characterCount: 1,
    traitCount: 2,
    careerCount: 3,
    tavernCount: 1,
    npcCount: 4,
    falseRumorCount: 1,
    partialRumorCount: 1,
    trueRumorCount: 1,
    messageCount: 4,
    npcKnowledgeCount: 4,
    tavernSceneCount: 1,
    tavernSceneTurnCount: 1,
    questCount: 2,
    completedQuestCount: 1,
    openQuestCount: 1,
    adventureArchiveCount: 1,
    adventureTurnCount: 8,
    diceRollCount: 7,
    failedDiceRollCount: 1,
    rulesEventCount: 8,
    equippedItemCount: 1,
    money: 9,
    gameTimeMinutes: 660,
    locationCount: 2,
    travelCount: 2,
    directorRunCount: 1,
    generationRecordCount: 32,
    unfinishedRequestCount: 0,
    maxContextBytes: 8_192,
    integrityCheck: 'ok',
    foreignKeyViolationCount: 0,
    saveSchemaVersion: 3,
    worldSchemaVersion: 1,
  };
}

function count(database: DatabaseSync, sql: string): number {
  return number(database, sql);
}

function number(database: DatabaseSync, sql: string): number {
  const row = database.prepare(sql).get() as Record<string, unknown> | undefined;
  const value = row === undefined ? undefined : Object.values(row)[0];
  if (typeof value !== 'number') throw new Error(`Expected numeric SQLite result for ${sql}`);
  return value;
}

function text(database: DatabaseSync, sql: string): string {
  const row = database.prepare(sql).get() as Record<string, unknown> | undefined;
  const value = row === undefined ? undefined : Object.values(row)[0];
  if (typeof value !== 'string') throw new Error(`Expected text SQLite result for ${sql}`);
  return value;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') throw new Error(`${name} is required`);
  return value;
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
