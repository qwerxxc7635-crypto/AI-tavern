import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const outputPath = readOutputPath(process.argv.slice(2));
const sourceCommit = run('git', ['rev-parse', 'HEAD']).stdout.trim();
const startedAt = new Date().toISOString();
const checks = [
  run('cargo', [
    'test',
    '-p',
    'ember-combat-core',
    'm11_long_combat_generated_content_stress',
    '--',
    '--nocapture',
  ]),
  run('cargo', [
    'test',
    '-p',
    'ember-native-bridge',
    'combat_persistence::tests::m11_long_combat_generated_content_stress_reopens_64_pending_reaction_checkpoints',
    '--',
    '--exact',
    '--nocapture',
  ]),
  run('pnpm', [
    'exec',
    'vitest',
    'run',
    'packages/application/src/combat-content-candidate-policy.test.ts',
    'packages/domain/src/semantic-equipment-validator.test.ts',
    'windows-app/src/combat-screen.test.tsx',
    '-t',
    'm11 long combat generated content stress',
    '--maxWorkers=1',
  ]),
  run('pnpm', ['test:combat-determinism']),
];

const receipt = {
  schemaVersion: 1,
  taskId: 'M11-T09',
  sourceCommit,
  startedAt,
  completedAt: new Date().toISOString(),
  status: 'PASS',
  evidenceKind: 'DETERMINISTIC_FIXTURE',
  realProviderStatus: 'NOT_RUN',
  uiOverflowMode: 'JSDOM_RENDER_AND_INTERACTION',
  platform: { os: process.platform, architecture: process.arch },
  coverage: {
    rounds: 128,
    triggerDepthAccepted: 32,
    triggerDepthOverflow: 33,
    reactionCandidates: 128,
    statusApplications: 4096,
    reinforcements: 64,
    checkpointReopens: 64,
    generatedCombatCandidatesAccepted: 192,
    generatedCombatCandidatesRejected: 64,
    generatedEquipmentDefinitions: 256,
    uiTimelineEntries: 48,
    uiCombatants: 48,
    uiStatuses: 128,
    uiAbilities: 128,
    uiEnemyIntents: 96,
    uiLogEntries: 512,
  },
  checks: checks.map(({ command, durationMs, stdout }) => ({
    command,
    durationMs,
    outputSha256: createHash('sha256').update(stdout).digest('hex'),
  })),
};

if (outputPath !== null) {
  const resolved = resolve(outputPath);
  if (existsSync(resolved)) throw new Error(`Refusing to overwrite stress receipt: ${resolved}`);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`M11-T09 stress receipt written to ${resolved}\n`);
}

function run(command, args) {
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
  });
  const stdout = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(stdout);
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status)}`);
  }
  return {
    command: [command, ...args].join(' '),
    durationMs: Math.round(performance.now() - started),
    stdout,
  };
}

function readOutputPath(args) {
  if (args.length === 0) return null;
  if (args.length === 2 && args[0] === '--output' && args[1]) return args[1];
  throw new Error('Use --output <new-json-path> or omit it');
}
