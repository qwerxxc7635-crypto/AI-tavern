import assert from 'node:assert/strict';
import test from 'node:test';

import {
  currentReleaseHighlights,
  expectedReleaseInfo,
  releaseStateErrors,
  renderGeneratedReleaseInfo,
} from './release-version.mjs';

test('builds deterministic unreleased metadata from the authority version', () => {
  const highlights = ['First change'];
  const info = expectedReleaseInfo('0.2.0', highlights);
  assert.deepEqual(info, {
    schemaVersion: 1,
    version: '0.2.0',
    channel: 'development',
    status: 'unreleased',
    changelogPath: 'CHANGELOG.md',
    changelogHeading: '[0.2.0] - Unreleased',
    highlights,
  });
  assert.deepEqual(
    currentReleaseHighlights('## [0.2.0] - Unreleased\n\n- First change\n\n## [0.1.0]\n', '0.2.0'),
    highlights,
  );
  assert.match(renderGeneratedReleaseInfo(info), /First change/);
});

test('reports every release mirror that drifts from the authority version', () => {
  const errors = releaseStateErrors({
    sourceVersion: '0.2.0',
    packageVersions: { 'package.json': '0.2.0', 'windows-app/package.json': '0.1.0' },
    tauriVersion: '0.1.0',
    cargoWorkspaceVersion: '0.1.0',
    cargoMembersInherit: { 'crates/example/Cargo.toml': false },
    cargoLockVersions: { example: '0.1.0' },
    releaseInfo: expectedReleaseInfo('0.1.0'),
    generatedReleaseInfo: '',
    changelog: '# Changelog',
  });
  assert.equal(errors.length, 8);
  assert.match(errors.join('\n'), /windows-app/);
  assert.match(errors.join('\n'), /release-info/);
  assert.match(errors.join('\n'), /CHANGELOG/);
});
