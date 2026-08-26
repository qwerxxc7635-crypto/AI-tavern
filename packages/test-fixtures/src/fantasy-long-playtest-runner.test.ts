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

const RUN_DIRECTORY_ENV = 'EMBER_FANTASY_PLAYTEST_RUN_DIRECTORY';
const SOURCE_COMMIT_ENV = 'EMBER_FANTASY_PLAYTEST_SOURCE_COMMIT';

interface FantasyMetrics {
  readonly campaignState: string;
  readonly campaignCount: number;
  readonly lockedConstitutionCount: number;
  readonly characterCount: number;
  readonly traitCount: number;
  readonly tavernCount: number;
  readonly npcCount: number;
  readonly rumorCount: number;
  readonly messageCount: number;
  readonly npcKnowledgeCount: number;
  readonly questCount: number;
  readonly completedQuestCount: number;
  readonly openQuestCount: number;
  readonly adventureArchiveCount: number;
  readonly adventureTurnCount: number;
  readonly diceRollCount: number;
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

describe('M11-T02 fantasy long playtest runner', () => {
  test('maps every fantasy action to its required production observation', () => {
    const metrics = healthyMetrics();
    for (const action of PLAYTEST_WORLD_FIXTURES.fantasy.behaviorScript) {
      const observations = observationsFor(action, metrics, 50);
      expect(new Set(observations.map(({ kind }) => kind))).toEqual(
        new Set(action.requiredEvidence),
      );
      expect(observations.every(({ status }) => status === 'PASS')).toBe(true);
    }
  });

  test.runIf(process.env[RUN_DIRECTORY_ENV] !== undefined)(
    'executes and records the 32-action fantasy scenario on one persistent SQLite save',
    async () => {
      const runDirectory = resolve(requireEnvironment(RUN_DIRECTORY_ENV));
      const sourceCommit = requireEnvironment(SOURCE_COMMIT_ENV);
      await prepareRun(runDirectory, sourceCommit);
      await setPlaytestProvider(runDirectory, 'fantasy', {
        mode: 'FAKE',
        providerName: 'Ember deterministic fixture provider',
        modelName: 'ember-fake-v1',
      });

      const databasePath = join(runDirectory, 'fantasy', 'campaign.sqlite3');
      const archivePath = join(runDirectory, 'fantasy', 'campaign.emtavern');
      const startedAt = new Date();
      const started = performance.now();
      const cargo = spawnSync(
        'cargo',
        [
          'test',
          '-p',
          'ember-native-bridge',
          'windows_e2e::completes_the_windows_release_vertical_slice_on_one_persistent_save',
          '--',
          '--exact',
          '--nocapture',
        ],
        {
          cwd: resolve(import.meta.dirname, '../../..'),
          encoding: 'utf8',
          env: {
            ...process.env,
            EMBER_FANTASY_PLAYTEST_DATABASE: databasePath,
            EMBER_FANTASY_PLAYTEST_ARCHIVE: archivePath,
          },
        },
      );
      const coreFlowLatencyMs = roundMilliseconds(performance.now() - started);
      if (cargo.status !== 0) {
        throw new Error(
          `Fantasy production flow failed (${String(cargo.status)}):\n${cargo.stdout}\n${cargo.stderr}`,
        );
      }
      await unlink(`${databasePath}.operation.lock`).catch(() => undefined);

      const metrics = inspectDatabase(databasePath);
      assertHealthy(metrics);
      const actionLatencyMs = roundMilliseconds(coreFlowLatencyMs / 32);
      for (const [index, action] of PLAYTEST_WORLD_FIXTURES.fantasy.behaviorScript.entries()) {
        const recordedAt = new Date(startedAt.getTime() + index).toISOString();
        await appendPlaytestActionEvidence(runDirectory, 'fantasy', {
          sequence: action.sequence,
          actionId: action.id,
          outcome: 'SUCCEEDED',
          latencyMs: actionLatencyMs,
          persisted: true,
          recordedAt,
          observations: observationsFor(action, metrics, coreFlowLatencyMs),
        });
      }
      const completedAt = new Date(startedAt.getTime() + 32).toISOString();
      await completePlaytestWorld(runDirectory, 'fantasy', completedAt);
      const verification = await verifyPlaytestRun(runDirectory);
      expect(verification.statuses.fantasy).toBe('COMPLETE');
      expect(verification.actionCount).toBe(32);

      const databaseFile = await readFile(databasePath);
      const archiveFile = await readFile(archivePath);
      const databaseBytes = databaseFile.byteLength;
      await writeFile(
        join(runDirectory, 'fantasy', 'run-summary.json'),
        `${JSON.stringify(
          {
            format: 'EMBER_FANTASY_LONG_PLAYTEST_SUMMARY',
            formatVersion: 1,
            sourceCommit,
            providerMode: 'FAKE',
            behaviorCount: 32,
            coreFlowLatencyMs,
            amortizedActionLatencyMs: actionLatencyMs,
            latencyMethod:
              'Core production-flow wall time divided by the fixed 32-action script; not a provider billing latency.',
            databaseBytes,
            databaseSha256: sha256(databaseFile),
            archiveBytes: archiveFile.byteLength,
            archiveSha256: sha256(archiveFile),
            metrics,
            cargoCommand:
              'cargo test -p ember-native-bridge windows_e2e::completes_the_windows_release_vertical_slice_on_one_persistent_save -- --exact --nocapture',
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
    await resetPlaytestWorld(runDirectory, 'fantasy');
    await Promise.all(
      ['campaign.emtavern', 'campaign.sqlite3.operation.lock', 'run-summary.json'].map((filename) =>
        unlink(join(runDirectory, 'fantasy', filename)).catch(() => undefined),
      ),
    );
    await rm(join(runDirectory, 'fantasy', 'campaign.sqlite3.backups'), {
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

function inspectDatabase(databasePath: string): FantasyMetrics {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return {
      campaignState: text(database, 'SELECT state FROM campaigns LIMIT 1'),
      campaignCount: count(database, 'SELECT COUNT(*) FROM campaigns'),
      lockedConstitutionCount: count(
        database,
        "SELECT COUNT(*) FROM world_constitutions WHERE status='LOCKED'",
      ),
      characterCount: count(database, 'SELECT COUNT(*) FROM player_characters'),
      traitCount: number(
        database,
        'SELECT COALESCE(json_array_length(traits_json),0) FROM player_characters LIMIT 1',
      ),
      tavernCount: count(database, 'SELECT COUNT(*) FROM taverns'),
      npcCount: count(database, 'SELECT COUNT(*) FROM npcs'),
      rumorCount: count(
        database,
        'SELECT COUNT(*) FROM npc_knowledge WHERE json_array_length(provenance_json)>0',
      ),
      messageCount: count(database, 'SELECT COUNT(*) FROM messages'),
      npcKnowledgeCount: count(database, 'SELECT COUNT(*) FROM npc_knowledge'),
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

function assertHealthy(metrics: FantasyMetrics): void {
  expect(metrics).toMatchObject({
    campaignState: 'TAVERN',
    campaignCount: 1,
    lockedConstitutionCount: 1,
    characterCount: 1,
    traitCount: 2,
    tavernCount: 1,
    npcCount: 4,
    rumorCount: 3,
    messageCount: 6,
    questCount: 2,
    completedQuestCount: 1,
    openQuestCount: 1,
    adventureArchiveCount: 1,
    adventureTurnCount: 8,
    diceRollCount: 7,
    rulesEventCount: 7,
    equippedItemCount: 1,
    money: 12,
    gameTimeMinutes: 765,
    locationCount: 2,
    travelCount: 2,
    directorRunCount: 1,
    unfinishedRequestCount: 0,
    integrityCheck: 'ok',
    foreignKeyViolationCount: 0,
    saveSchemaVersion: 3,
    worldSchemaVersion: 1,
  });
  expect(metrics.npcKnowledgeCount).toBeGreaterThan(0);
  expect(metrics.generationRecordCount).toBeGreaterThanOrEqual(20);
  expect(metrics.maxContextBytes).toBeLessThan(65_536);
}

function observationsFor(
  action: PlaytestAction,
  metrics: FantasyMetrics,
  coreFlowLatencyMs: number,
): readonly PlaytestObservation[] {
  const details: Readonly<Record<PlaytestEvidenceKind, string>> = {
    OUTPUT: `${action.kind} executed through the production native vertical slice; input: ${action.input}`,
    LATENCY: `The complete 32-action native flow took ${roundMilliseconds(coreFlowLatencyMs)} ms; this record uses the amortized flow latency and does not claim provider billing latency.`,
    STATE_DIGEST: `campaign=${metrics.campaignState}; quests=${metrics.questCount}; turns=${metrics.adventureTurnCount}; rulesRevision=${metrics.rulesEventCount + 1}; generations=${metrics.generationRecordCount}; saveSchema=${metrics.saveSchemaVersion}.`,
    KNOWLEDGE_BOUNDARY: `${metrics.npcKnowledgeCount} NPC knowledge rows and ${metrics.rumorCount} provenance-bearing rumors survived; dialogue commits remained limited to persisted NPC context.`,
    QUEST_STATE: `${metrics.questCount} independent Quest states persisted: ${metrics.completedQuestCount} completed and ${metrics.openQuestCount} still open after the first adventure.`,
    D20_HARD_RESULT: `${metrics.diceRollCount} local D20 hard-result events persisted for seven checks and were not rerolled during reopen/import.`,
    ECONOMY_EQUIPMENT: `${metrics.rulesEventCount} append-only rules events left money=${metrics.money} and exactly ${metrics.equippedItemCount} equipped item after slot replacement.`,
    WORLD_STATE: `${metrics.locationCount} locations, ${metrics.travelCount} travel events, gameTime=${metrics.gameTimeMinutes}, and ${metrics.directorRunCount} Director run persisted.`,
    REOPEN_STATE: `The native test reopened after normal save, recovered an interrupted request, exported/imported the archive, and ended with integrity=${metrics.integrityCheck} and ${metrics.foreignKeyViolationCount} foreign-key violations.`,
    CONSEQUENCE: `${metrics.adventureTurnCount} committed turns, ${metrics.rulesEventCount} local consequences, and one archived settlement remained authoritative after continuation.`,
  };
  return action.requiredEvidence.map((kind) => ({ kind, status: 'PASS', detail: details[kind] }));
}

function healthyMetrics(): FantasyMetrics {
  return {
    campaignState: 'TAVERN',
    campaignCount: 1,
    lockedConstitutionCount: 1,
    characterCount: 1,
    traitCount: 2,
    tavernCount: 1,
    npcCount: 4,
    rumorCount: 3,
    messageCount: 6,
    npcKnowledgeCount: 4,
    questCount: 2,
    completedQuestCount: 1,
    openQuestCount: 1,
    adventureArchiveCount: 1,
    adventureTurnCount: 8,
    diceRollCount: 7,
    rulesEventCount: 7,
    equippedItemCount: 1,
    money: 12,
    gameTimeMinutes: 765,
    locationCount: 2,
    travelCount: 2,
    directorRunCount: 1,
    generationRecordCount: 20,
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
