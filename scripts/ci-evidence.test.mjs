import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { resolveProcessInvocation } from './process-runner.mjs';

test('resolves pnpm through Node when an npm entrypoint is available', () => {
  assert.deepEqual(
    resolveProcessInvocation('pnpm', ['test'], {
      platform: 'win32',
      npmExecPath: 'C:\\pnpm\\pnpm.cjs',
      nodeExecPath: 'C:\\node\\node.exe',
    }),
    {
      command: 'C:\\node\\node.exe',
      args: ['C:\\pnpm\\pnpm.cjs', 'test'],
      shell: false,
    },
  );
});

test('uses the Windows command shim through a shell only as a direct-call fallback', () => {
  assert.deepEqual(
    resolveProcessInvocation('pnpm', ['test'], {
      platform: 'win32',
      npmExecPath: null,
      nodeExecPath: 'C:\\node\\node.exe',
    }),
    { command: 'pnpm.cmd', args: ['test'], shell: true },
  );
});

test('records UTF-8 command output, timestamps and exit code', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ember-ci-evidence-'));
  try {
    const output = join(directory, 'command.json');
    const result = spawnSync(
      process.execPath,
      [
        'scripts/run-with-evidence.mjs',
        '--output',
        output,
        '--',
        process.execPath,
        '-e',
        "process.stdout.write('完成\\n'); process.stderr.write('warning\\n')",
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    assert.equal(result.status, 0);
    const record = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(record.exitCode, 0);
    assert.equal(record.stdout, '完成\n');
    assert.equal(record.stderr, 'warning\n');
    assert.equal(Number.isNaN(Date.parse(record.startedAt)), false);
    assert.equal(Number.isNaN(Date.parse(record.endedAt)), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('collects deterministic paths, byte sizes and SHA-256 hashes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ember-release-evidence-'));
  try {
    const bundle = join(directory, 'bundle');
    mkdirSync(join(bundle, 'nested'), { recursive: true });
    writeFileSync(join(bundle, 'nested', 'artifact.bin'), 'release-bytes');
    const output = join(directory, 'release.json');
    const result = spawnSync(
      process.execPath,
      ['scripts/collect-release-evidence.mjs', '--root', bundle, '--output', output],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    const record = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(record.files.length, 1);
    assert.equal(record.files[0].bytes, 13);
    assert.equal(
      record.files[0].sha256,
      createHash('sha256').update('release-bytes').digest('hex'),
    );
    assert.match(record.files[0].path, /bundle\/nested\/artifact\.bin$/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
