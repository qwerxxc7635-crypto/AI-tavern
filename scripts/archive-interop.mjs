import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPnpm, runProcess } from './process-runner.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDirectory = join(root, 'packages', 'persistence', 'test-fixtures');
const manifest = JSON.parse(readFileSync(join(fixtureDirectory, 'archive-fixtures.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'ember-archive-interop-'));
const typescriptOutput = join(work, 'typescript-export-v1.emtavern');
const rustOutput = join(work, 'rust-export-v1.emtavern');

try {
  runPnpm(['exec', 'vitest', 'run', 'packages/persistence/src/save-export.test.ts'], {
    EMBER_TS_ARCHIVE_OUTPUT: typescriptOutput,
  });
  verifyRegeneratedFixture('typescript', typescriptOutput);

  runProcess(
    'cargo',
    [
      'test',
      '-p',
      'ember-native-bridge',
      'current_archive_interop_gate_imports_typescript_and_emits_rust',
    ],
    {
      EMBER_TS_ARCHIVE_INPUT: typescriptOutput,
      EMBER_RUST_ARCHIVE_OUTPUT: rustOutput,
      EMBER_ARCHIVE_INTEROP_WORK: work,
    },
  );
  verifyRegeneratedFixture('rust', rustOutput);

  runPnpm(['exec', 'vitest', 'run', 'packages/persistence/src/save-export.test.ts'], {
    EMBER_RUST_ARCHIVE_INPUT: rustOutput,
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}

function verifyRegeneratedFixture(key, generatedPath) {
  const metadata = manifest.fixtures[key];
  assert.equal(typeof metadata?.path, 'string', `Missing ${key} fixture metadata`);
  const committedPath = join(root, metadata.path);
  const committed = readFileSync(committedPath);
  const generated = readFileSync(generatedPath);
  assert.equal(sha256(committed), metadata.sha256, `${key} fixture manifest hash drifted`);
  assert.deepEqual(
    readStoredEntries(generated),
    readStoredEntries(committed),
    `${key} fixture content is stale; regenerate and review it`,
  );
}

function readStoredEntries(bytes) {
  const entries = [];
  let offset = 0;
  while (offset + 4 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8);
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    assert.equal(method, 0, 'Interop fixtures must use stored ZIP entries');
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    entries.push([
      bytes.subarray(nameStart, nameStart + nameLength).toString('utf8'),
      bytes.subarray(dataStart, dataStart + size),
    ]);
    offset = dataStart + size;
  }
  assert.equal(entries.length, 5, 'Interop fixture must contain exactly five entries');
  return entries;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
