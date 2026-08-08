import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReleaseMetadata } from './release-metadata.mjs';

test('builds deterministic cross-platform release metadata', () => {
  const metadata = buildReleaseMetadata({
    packageJson: { version: '0.1.0' },
    tauriConfig: { productName: 'Ember Tavern', version: '0.1.0' },
    gitCommit: 'abc123',
    platform: 'darwin',
    arch: 'arm64',
  });

  assert.deepEqual(metadata, {
    productName: 'Ember Tavern',
    version: '0.1.0',
    gitCommit: 'abc123',
    platform: 'darwin',
    arch: 'arm64',
  });
});

test('rejects inconsistent version sources', () => {
  assert.throws(
    () =>
      buildReleaseMetadata({
        packageJson: { version: '0.1.0' },
        tauriConfig: { productName: 'Ember Tavern', version: '0.2.0' },
        gitCommit: 'abc123',
        platform: 'win32',
        arch: 'x64',
      }),
    /versions differ/,
  );
});
