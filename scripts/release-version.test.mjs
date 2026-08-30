import assert from 'node:assert/strict';
import test from 'node:test';

import {
  currentReleaseHighlights,
  currentReleaseDate,
  expectedReleaseInfo,
  releaseStateErrors,
  renderGeneratedReleaseInfo,
  synchronizeCurrentReleaseHeading,
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
    changelogHeading: '[0.2.0] - 未发布',
    highlights,
  });
  assert.deepEqual(
    currentReleaseHighlights('## [0.2.0] - 未发布\n\n- 第一项变化\n\n## [0.1.0]\n', '0.2.0'),
    ['第一项变化'],
  );
  assert.match(renderGeneratedReleaseInfo(info), /First change/);
});

test('builds stable released metadata from a dated changelog heading', () => {
  const changelog =
    '<!-- current-release:start -->\n## [0.3.0] - 2026-08-30\n\n- 正式发布\n\n<!-- current-release:end -->\n';
  assert.equal(currentReleaseDate(changelog, '0.3.0'), '2026-08-30');
  assert.deepEqual(expectedReleaseInfo('0.3.0', ['正式发布'], '2026-08-30'), {
    schemaVersion: 1,
    version: '0.3.0',
    channel: 'stable',
    status: 'released',
    changelogPath: 'CHANGELOG.md',
    changelogHeading: '[0.3.0] - 2026-08-30',
    highlights: ['正式发布'],
  });
  assert.deepEqual(currentReleaseHighlights(changelog, '0.3.0'), ['正式发布']);
});

test('preserves a release date for the same version and resets it for a new version', () => {
  const changelog =
    '<!-- current-release:start -->\n## [0.3.0] - 2026-08-30\n\n- 正式发布\n\n<!-- current-release:end -->\n';
  assert.equal(synchronizeCurrentReleaseHeading(changelog, '0.3.0'), changelog);
  assert.match(synchronizeCurrentReleaseHeading(changelog, '0.3.1'), /## \[0\.3\.1\] - 未发布/u);
});

test('rejects missing release markers and impossible calendar dates', () => {
  assert.throws(
    () => synchronizeCurrentReleaseHeading('## [0.3.0] - 2026-08-30\n', '0.3.0'),
    /current release marker is missing/u,
  );
  assert.throws(
    () => currentReleaseDate('## [0.3.0] - 2026-99-99\n', '0.3.0'),
    /ISO calendar date/u,
  );
  assert.equal(currentReleaseDate('## [0.3.0] - 未发布\n', '0.3.0'), null);
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
