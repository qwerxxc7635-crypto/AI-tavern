import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const sharedGate = readFileSync(new URL('./shared-check.mjs', import.meta.url), 'utf8');

test('runs shared quality gates on Windows and macOS', () => {
  assert.match(workflow, /os: \[windows-latest, macos-latest\]/u);
  assert.match(workflow, /pnpm archive:interop/u);
  assert.match(workflow, /cargo clippy --workspace --all-targets --all-features/u);
  assert.match(workflow, /cargo test --workspace/u);
});

test('keeps the local shared gate aligned with release, language and archive checks', () => {
  for (const required of [
    'format:check',
    'release:check',
    'i18n:check',
    'lint',
    'typecheck',
    'test',
    'archive:interop',
    "runProcess('cargo', ['fmt'",
    "'clippy'",
    "runProcess('cargo', ['test'",
  ]) {
    assert.ok(sharedGate.includes(required), `Shared gate is missing: ${required}`);
  }
});

test('builds, hashes and uploads Windows NSIS and macOS app evidence', () => {
  for (const required of [
    'pnpm test:windows-e2e',
    'tauri build --bundles nsis',
    'tauri build --bundles app',
    'run-with-evidence.mjs',
    'collect-release-evidence.mjs',
    'actions/upload-artifact@v4',
    'windows-release-files.json',
    'macos-release-files.json',
  ]) {
    assert.ok(workflow.includes(required), `CI is missing: ${required}`);
  }
});
