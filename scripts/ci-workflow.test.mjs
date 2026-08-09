import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const sharedGate = readFileSync(new URL('./shared-check.mjs', import.meta.url), 'utf8');
const windowsReleaseGate = readFileSync(
  new URL('./windows-release-gate.ps1', import.meta.url),
  'utf8',
);

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

test('requires an ephemeral Windows install lifecycle gate with system integrations', () => {
  for (const required of [
    'windows-release-gate.ps1',
    'windows-install-gate-command.json',
    'windows-install-lifecycle.json',
  ]) {
    assert.ok(workflow.includes(required), `CI is missing Windows evidence: ${required}`);
  }

  for (const required of [
    "env:CI -ne 'true'",
    "env:RUNNER_OS -ne 'Windows'",
    'ember-secure-secrets',
    'Microsoft\\EdgeWebView\\Application',
    "ArgumentList '/S'",
    'webView2ProcessObserved',
    'applicationDataPreserved',
    'Refusing to replace a pre-existing Ember Tavern installation',
    'Refusing to touch a pre-existing Ember Tavern application data directory',
  ]) {
    assert.ok(
      windowsReleaseGate.includes(required),
      `Windows release gate is missing: ${required}`,
    );
  }
});
