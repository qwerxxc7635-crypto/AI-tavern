import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';

import { describe, expect, test } from 'vitest';

import {
  FREE_INPUT_STRESS_ACTIONS,
  FREE_INPUT_STRESS_CATEGORIES,
  validateFreeInputStressActions,
  type FreeInputStressAction,
  type FreeInputStressOutcome,
  type PlaytestWorldKey,
} from './index.js';

const RUN_DIRECTORY_ENV = 'EMBER_FREE_INPUT_STRESS_RUN_DIRECTORY';
const SOURCE_COMMIT_ENV = 'EMBER_FREE_INPUT_STRESS_SOURCE_COMMIT';
const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../..');

const SOURCE_DATABASES: Readonly<Record<PlaytestWorldKey, string>> = Object.freeze({
  fantasy: resolve(
    REPOSITORY_ROOT,
    'docs/audit/evidence/v0.3-playability/m11-t02-fantasy-e8f3a3c/fantasy/campaign.sqlite3',
  ),
  investigation: resolve(
    REPOSITORY_ROOT,
    'docs/audit/evidence/v0.3-playability/m11-t03-investigation-0779808/investigation/campaign.sqlite3',
  ),
  cyberpunk: resolve(
    REPOSITORY_ROOT,
    'docs/audit/evidence/v0.3-playability/m11-t04-cyberpunk-d42bae2/cyberpunk/campaign.sqlite3',
  ),
});
const SOURCE_DATABASE_SHA256: Readonly<Record<PlaytestWorldKey, string>> = Object.freeze({
  fantasy: '5b7fb335d07900db374f4cd09231ac8b76265219eebebbd8aefff359e8303ab0',
  investigation: '6ef8ba1aa3c4b7a970afcb96bfbb787171336067cd346c916054e317d3849c28',
  cyberpunk: 'd61a103587d217612dc045cc14fd306d6da45f5ba23867d345921dcf52d8477f',
});

interface WorldHealth {
  readonly campaignState: string;
  readonly integrityCheck: string;
  readonly foreignKeyViolationCount: number;
  readonly unfinishedRequestCount: number;
  readonly playerMessageCount: number;
  readonly generatedReplyCount: number;
}

interface StressMetrics {
  readonly fantasy: WorldHealth & {
    readonly abandonedQuestCount: number;
    readonly ownerTrust: number;
    readonly money: number;
  };
  readonly investigation: WorldHealth & {
    readonly ownerTrust: number;
    readonly travelCount: number;
    readonly currentLocationName: string;
    readonly passerbyMessageCount: number;
    readonly passerbyTrust: number;
    readonly passerbyCloseness: number;
    readonly passerbyObligation: number;
  };
  readonly cyberpunk: WorldHealth & {
    readonly money: number;
    readonly rewardItemCount: number;
    readonly corporatePlayerRelation: string;
    readonly factionActionCount: number;
    readonly defectionFactCount: number;
  };
}

interface StressActionEvidence extends FreeInputStressAction {
  readonly outcome: FreeInputStressOutcome;
  readonly response: string;
  readonly consequence: string;
  readonly persisted: true;
  readonly reopenVerified: true;
  readonly freeInputPersisted: true;
  readonly suggestionRequired: false;
  readonly latencyMs: number;
}

describe('M11-T05 free-input stress runner', () => {
  test('covers all eight required non-recommended action categories across three worlds', () => {
    expect(() => validateFreeInputStressActions(FREE_INPUT_STRESS_ACTIONS)).not.toThrow();
    expect(FREE_INPUT_STRESS_ACTIONS.map(({ category }) => category)).toEqual(
      FREE_INPUT_STRESS_CATEGORIES,
    );
    expect(new Set(FREE_INPUT_STRESS_ACTIONS.map(({ world }) => world))).toEqual(
      new Set(['fantasy', 'investigation', 'cyberpunk']),
    );
    expect(
      new Set(FREE_INPUT_STRESS_ACTIONS.map(({ expectedOutcome }) => expectedOutcome)),
    ).toEqual(new Set(['SUCCEEDED', 'FAILED', 'REJECTED']));
  });

  test.runIf(process.env[RUN_DIRECTORY_ENV] !== undefined)(
    'executes the eight actions through production transactions and records reopen evidence',
    async () => {
      const runDirectory = resolve(requireEnvironment(RUN_DIRECTORY_ENV));
      const sourceCommit = requireEnvironment(SOURCE_COMMIT_ENV);
      const databasePaths = await prepareRun(runDirectory, sourceCommit);
      const startedAt = new Date();
      const started = performance.now();
      const cargo = spawnSync(
        'cargo',
        [
          'test',
          '-p',
          'ember-native-bridge',
          'free_input_stress_e2e::persists_cross_world_free_input_success_failure_and_refusal',
          '--',
          '--exact',
          '--nocapture',
        ],
        {
          cwd: REPOSITORY_ROOT,
          encoding: 'utf8',
          env: {
            ...process.env,
            EMBER_FREE_INPUT_FANTASY_DATABASE: databasePaths.fantasy,
            EMBER_FREE_INPUT_INVESTIGATION_DATABASE: databasePaths.investigation,
            EMBER_FREE_INPUT_CYBERPUNK_DATABASE: databasePaths.cyberpunk,
            EMBER_FREE_INPUT_STRESS_SCRIPT: join(runDirectory, 'script.json'),
          },
        },
      );
      const coreFlowLatencyMs = roundMilliseconds(performance.now() - started);
      if (cargo.status !== 0) {
        throw new Error(
          `Free-input production stress failed (${String(cargo.status)}):\n${cargo.stdout}\n${cargo.stderr}`,
        );
      }
      await Promise.all(
        Object.values(databasePaths).flatMap((path) => [
          unlink(`${path}.operation.lock`).catch(() => undefined),
          rm(`${path}.backups`, { recursive: true, force: true }),
        ]),
      );

      const metrics = inspectDatabases(databasePaths);
      assertHealthy(metrics);
      const actionLatencyMs = roundMilliseconds(
        coreFlowLatencyMs / FREE_INPUT_STRESS_ACTIONS.length,
      );
      const actions = buildEvidence(databasePaths, metrics, actionLatencyMs);
      expect(actions).toHaveLength(8);
      expect(actions.every(({ response }) => !response.includes('无法解析'))).toBe(true);
      expect(
        actions.every(
          ({ expectedOutcome, outcome, freeInputPersisted, suggestionRequired }) =>
            outcome === expectedOutcome && freeInputPersisted && !suggestionRequired,
        ),
      ).toBe(true);
      const completedAt = new Date().toISOString();
      await writeFile(
        join(runDirectory, 'evidence.json'),
        `${JSON.stringify(
          {
            format: 'EMBER_FREE_INPUT_STRESS_EVIDENCE',
            formatVersion: 1,
            runId: runDirectory.split('/').at(-1),
            sourceCommit,
            dataOrigin: 'SYNTHETIC_M11',
            provider: {
              mode: 'FAKE',
              providerName: 'Ember deterministic fixture provider',
              modelName: 'ember-fake-v1',
            },
            status: 'COMPLETE',
            startedAt: startedAt.toISOString(),
            completedAt,
            actions,
            findings: [],
          },
          null,
          2,
        )}\n`,
        { encoding: 'utf8', flag: 'wx' },
      );
      const files = await Promise.all(
        (['fantasy', 'investigation', 'cyberpunk'] as const).map(async (world) => {
          const database = await readFile(databasePaths[world]);
          const archive = await readFile(join(runDirectory, world, 'campaign.emtavern'));
          return {
            world,
            databaseBytes: database.byteLength,
            databaseSha256: sha256(database),
            archiveBytes: archive.byteLength,
            archiveSha256: sha256(archive),
          };
        }),
      );
      await writeFile(
        join(runDirectory, 'run-summary.json'),
        `${JSON.stringify(
          {
            format: 'EMBER_FREE_INPUT_STRESS_SUMMARY',
            formatVersion: 1,
            sourceCommit,
            behaviorCount: actions.length,
            coreFlowLatencyMs,
            amortizedActionLatencyMs: actionLatencyMs,
            latencyMethod:
              'Production transaction wall time divided by the fixed eight-action script; not Provider billing latency.',
            metrics,
            files,
            cargoCommand:
              'cargo test -p ember-native-bridge free_input_stress_e2e::persists_cross_world_free_input_success_failure_and_refusal -- --exact --nocapture',
            cargoStdout: cargo.stdout.trim(),
          },
          null,
          2,
        )}\n`,
        { encoding: 'utf8', flag: 'wx' },
      );
    },
    120_000,
  );
});

async function prepareRun(
  runDirectory: string,
  sourceCommit: string,
): Promise<Readonly<Record<PlaytestWorldKey, string>>> {
  await mkdir(runDirectory);
  const script = `${JSON.stringify(FREE_INPUT_STRESS_ACTIONS, null, 2)}\n`;
  await writeFile(join(runDirectory, 'script.json'), script, { encoding: 'utf8', flag: 'wx' });
  const sourceFiles = await Promise.all(
    (['fantasy', 'investigation', 'cyberpunk'] as const).map(async (world) => {
      const directory = join(runDirectory, world);
      await mkdir(directory);
      const target = join(directory, 'campaign.sqlite3');
      await copyFile(SOURCE_DATABASES[world], target);
      const source = await readFile(SOURCE_DATABASES[world]);
      const sourceSha256 = sha256(source);
      if (sourceSha256 !== SOURCE_DATABASE_SHA256[world]) {
        throw new Error(`${world} long-play source database hash drifted`);
      }
      return {
        world,
        sourceDatabase: SOURCE_DATABASES[world],
        sourceSha256,
        target,
      };
    }),
  );
  await writeFile(
    join(runDirectory, 'manifest.json'),
    `${JSON.stringify(
      {
        format: 'EMBER_FREE_INPUT_STRESS_RUN',
        formatVersion: 1,
        runId: runDirectory.split('/').at(-1),
        sourceCommit,
        dataOrigin: 'SYNTHETIC_M11',
        scriptSha256: sha256(Buffer.from(script, 'utf8')),
        baseRuns: sourceFiles.map(({ world, sourceDatabase, sourceSha256 }) => ({
          world,
          sourceDatabase: sourceDatabase.slice(REPOSITORY_ROOT.length + 1),
          sourceSha256,
        })),
      },
      null,
      2,
    )}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
  return Object.freeze(
    Object.fromEntries(sourceFiles.map(({ world, target }) => [world, target])) as Record<
      PlaytestWorldKey,
      string
    >,
  );
}

function inspectDatabases(paths: Readonly<Record<PlaytestWorldKey, string>>): StressMetrics {
  const fantasy = new DatabaseSync(paths.fantasy, { readOnly: true });
  const investigation = new DatabaseSync(paths.investigation, { readOnly: true });
  const cyberpunk = new DatabaseSync(paths.cyberpunk, { readOnly: true });
  try {
    return {
      fantasy: {
        ...worldHealth(fantasy, 'playtest-m11-fantasy'),
        abandonedQuestCount: number(
          fantasy,
          "SELECT COUNT(*) FROM quest_pool_states WHERE status='ABANDONED'",
        ),
        ownerTrust: number(
          fantasy,
          'SELECT trust FROM npc_relationships WHERE npc_id=(SELECT owner_npc_id FROM taverns LIMIT 1)',
        ),
        money: number(fantasy, 'SELECT money FROM character_rule_states LIMIT 1'),
      },
      investigation: {
        ...worldHealth(investigation, 'playtest-m11-investigation'),
        ownerTrust: number(
          investigation,
          'SELECT trust FROM npc_relationships WHERE npc_id=(SELECT owner_npc_id FROM taverns LIMIT 1)',
        ),
        travelCount: number(investigation, 'SELECT COUNT(*) FROM location_travel_events'),
        currentLocationName: text(
          investigation,
          'SELECT name FROM dynamic_locations WHERE id=(SELECT current_location_id FROM campaign_location_states LIMIT 1)',
        ),
        passerbyMessageCount: number(
          investigation,
          "SELECT COUNT(*) FROM messages WHERE conversation_id=(SELECT id FROM conversations WHERE npc_id=(SELECT id FROM npcs WHERE name='早班邮差') LIMIT 1)",
        ),
        passerbyTrust: number(
          investigation,
          "SELECT trust FROM npc_relationships WHERE npc_id=(SELECT id FROM npcs WHERE name='早班邮差')",
        ),
        passerbyCloseness: number(
          investigation,
          "SELECT closeness FROM npc_relationships WHERE npc_id=(SELECT id FROM npcs WHERE name='早班邮差')",
        ),
        passerbyObligation: number(
          investigation,
          "SELECT obligation FROM npc_relationships WHERE npc_id=(SELECT id FROM npcs WHERE name='早班邮差')",
        ),
      },
      cyberpunk: {
        ...worldHealth(cyberpunk, 'playtest-m11-cyberpunk'),
        money: number(cyberpunk, 'SELECT money FROM character_rule_states LIMIT 1'),
        rewardItemCount: number(
          cyberpunk,
          'SELECT COUNT(*) FROM items WHERE source_adventure_id IS NOT NULL',
        ),
        corporatePlayerRelation: text(
          cyberpunk,
          "SELECT json_extract(profile_json,'$.playerRelation') FROM active_factions WHERE name='栖桥公司'",
        ),
        factionActionCount: number(cyberpunk, 'SELECT COUNT(*) FROM faction_action_events'),
        defectionFactCount: number(
          cyberpunk,
          "SELECT COUNT(*) FROM world_facts WHERE id='m11-free-input-defection-fact'",
        ),
      },
    };
  } finally {
    fantasy.close();
    investigation.close();
    cyberpunk.close();
  }
}

function worldHealth(database: DatabaseSync, campaignId: string): WorldHealth {
  return {
    campaignState: text(database, `SELECT state FROM campaigns WHERE id='${campaignId}'`),
    integrityCheck: text(database, 'PRAGMA integrity_check'),
    foreignKeyViolationCount: database.prepare('PRAGMA foreign_key_check').all().length,
    unfinishedRequestCount: number(
      database,
      "SELECT COUNT(*) FROM pending_ai_requests WHERE status NOT IN ('COMMITTED','CANCELLED')",
    ),
    playerMessageCount: number(
      database,
      "SELECT COUNT(*) FROM messages WHERE role='PLAYER' AND content IN (SELECT value FROM json_each(?))",
      JSON.stringify(
        FREE_INPUT_STRESS_ACTIONS.filter(({ world }) => world === campaignWorld(campaignId)).map(
          ({ input }) => input,
        ),
      ),
    ),
    generatedReplyCount: number(
      database,
      "SELECT COUNT(*) FROM generation_records WHERE id LIKE 'm11-free-input-generation-%'",
    ),
  };
}

function assertHealthy(metrics: StressMetrics): void {
  for (const world of [metrics.fantasy, metrics.investigation, metrics.cyberpunk]) {
    expect(world).toMatchObject({
      campaignState: 'TAVERN',
      integrityCheck: 'ok',
      foreignKeyViolationCount: 0,
      unfinishedRequestCount: 0,
    });
  }
  expect(metrics.fantasy).toMatchObject({
    abandonedQuestCount: 1,
    ownerTrust: 2,
    money: 12,
    playerMessageCount: 3,
    generatedReplyCount: 3,
  });
  expect(metrics.investigation).toMatchObject({
    ownerTrust: 2,
    travelCount: 3,
    currentLocationName: '海雾观测站',
    passerbyMessageCount: 6,
    passerbyTrust: 1,
    passerbyCloseness: 1,
    passerbyObligation: 1,
    playerMessageCount: 3,
    generatedReplyCount: 5,
  });
  expect(metrics.cyberpunk).toMatchObject({
    money: 15,
    rewardItemCount: 1,
    corporatePlayerRelation: 'ALLIED',
    factionActionCount: 2,
    defectionFactCount: 1,
    playerMessageCount: 2,
    generatedReplyCount: 2,
  });
}

function buildEvidence(
  paths: Readonly<Record<PlaytestWorldKey, string>>,
  metrics: StressMetrics,
  latencyMs: number,
): readonly StressActionEvidence[] {
  const databases = Object.fromEntries(
    (['fantasy', 'investigation', 'cyberpunk'] as const).map((world) => [
      world,
      new DatabaseSync(paths[world], { readOnly: true }),
    ]),
  ) as Record<PlaytestWorldKey, DatabaseSync>;
  try {
    return FREE_INPUT_STRESS_ACTIONS.map((action) => {
      const response = dialogueReply(databases[action.world], action.input);
      return {
        ...action,
        outcome: actualOutcomeFor(action, metrics, response),
        response,
        consequence: consequenceFor(action, metrics),
        persisted: true,
        reopenVerified: true,
        freeInputPersisted: true,
        suggestionRequired: false,
        latencyMs,
      };
    });
  } finally {
    Object.values(databases).forEach((database) => database.close());
  }
}

function actualOutcomeFor(
  action: FreeInputStressAction,
  metrics: StressMetrics,
  response: string,
): FreeInputStressOutcome {
  switch (action.category) {
    case 'REFUSE_QUEST':
      return metrics.fantasy.abandonedQuestCount === 1 ? 'SUCCEEDED' : 'FAILED';
    case 'DECEIVE_PUBLISHER':
      return metrics.investigation.ownerTrust === 2 ? 'FAILED' : 'SUCCEEDED';
    case 'BUY_TAVERN':
      return metrics.fantasy.money === 12 && response.includes('不出售') ? 'REJECTED' : 'SUCCEEDED';
    case 'STEAL':
      return metrics.fantasy.money === 12 && metrics.fantasy.ownerTrust === 2
        ? 'FAILED'
        : 'SUCCEEDED';
    case 'LEAVE_TOWN':
      return metrics.investigation.currentLocationName === '海雾观测站' ? 'SUCCEEDED' : 'FAILED';
    case 'LONG_TERM_PASSERBY':
      return metrics.investigation.passerbyMessageCount === 6 ? 'SUCCEEDED' : 'FAILED';
    case 'SELL_QUEST_ITEM':
      return metrics.cyberpunk.rewardItemCount === 1 && metrics.cyberpunk.money === 15
        ? 'REJECTED'
        : 'SUCCEEDED';
    case 'DEFECT_TO_ENEMY':
      return metrics.cyberpunk.corporatePlayerRelation === 'ALLIED' &&
        metrics.cyberpunk.defectionFactCount === 1
        ? 'SUCCEEDED'
        : 'FAILED';
  }
}

function dialogueReply(database: DatabaseSync, playerInput: string): string {
  return text(
    database,
    "SELECT npc.content FROM messages player JOIN messages npc ON npc.conversation_id=player.conversation_id AND npc.sequence_number=player.sequence_number+1 WHERE player.role='PLAYER' AND npc.role='NPC' AND player.content=? ORDER BY player.created_at DESC LIMIT 1",
    playerInput,
  );
}

function consequenceFor(action: FreeInputStressAction, metrics: StressMetrics): string {
  switch (action.category) {
    case 'REFUSE_QUEST':
      return `${metrics.fantasy.abandonedQuestCount} quest is ABANDONED by a PLAYER transition; the campaign remains playable.`;
    case 'DECEIVE_PUBLISHER':
      return `The contradiction was rejected and publisher trust persisted at ${metrics.investigation.ownerTrust}.`;
    case 'BUY_TAVERN':
      return `Ownership did not change and fantasy money remains ${metrics.fantasy.money}.`;
    case 'STEAL':
      return `The theft failed, money remains ${metrics.fantasy.money}, and owner trust persisted at ${metrics.fantasy.ownerTrust}.`;
    case 'LEAVE_TOWN':
      return `Travel event ${metrics.investigation.travelCount} moved the player to ${metrics.investigation.currentLocationName} without completing open work.`;
    case 'LONG_TERM_PASSERBY':
      return `${metrics.investigation.passerbyMessageCount} passerby messages and relationship ${metrics.investigation.passerbyTrust}/${metrics.investigation.passerbyCloseness}/${metrics.investigation.passerbyObligation} survived repeated reopen.`;
    case 'SELL_QUEST_ITEM':
      return `The bound reward remained present (${metrics.cyberpunk.rewardItemCount}) and credits remain ${metrics.cyberpunk.money}.`;
    case 'DEFECT_TO_ENEMY':
      return `Corporate relation is ${metrics.cyberpunk.corporatePlayerRelation}; faction action and public consequence fact both persisted.`;
  }
}

function campaignWorld(campaignId: string): PlaytestWorldKey {
  if (campaignId.endsWith('fantasy')) return 'fantasy';
  if (campaignId.endsWith('investigation')) return 'investigation';
  return 'cyberpunk';
}

function number(database: DatabaseSync, sql: string, parameter?: string): number {
  const row = (
    parameter === undefined ? database.prepare(sql).get() : database.prepare(sql).get(parameter)
  ) as Record<string, unknown> | undefined;
  const value = row === undefined ? undefined : Object.values(row)[0];
  if (typeof value !== 'number') throw new Error(`Expected numeric SQLite result for ${sql}`);
  return value;
}

function text(database: DatabaseSync, sql: string, parameter?: string): string {
  const row = (
    parameter === undefined ? database.prepare(sql).get() : database.prepare(sql).get(parameter)
  ) as Record<string, unknown> | undefined;
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
