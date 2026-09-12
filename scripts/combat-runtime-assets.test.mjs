import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import {
  RUNTIME_ASSET_COUNT,
  RUNTIME_PACKAGE_ID,
  auditCombatRuntimeAssets,
} from './combat-runtime-assets.mjs';

test('FINAL combat runtime package has complete manifests, slots, names, and digests', () => {
  const report = auditCombatRuntimeAssets();
  assert.equal(report.packageId, RUNTIME_PACKAGE_ID);
  assert.equal(report.assetCount, RUNTIME_ASSET_COUNT);
  assert.deepEqual(report.counts, {
    common: 10,
    cultivation: 27,
    fantasy: 27,
    scifi: 28,
    urban: 27,
  });
  assert.ok(report.sourceBytes > 0);
  assert.ok(report.decodedRgbaBytes > report.sourceBytes);
});

test('committed performance receipt uses real browser measurements for every FINAL theme', () => {
  const audit = auditCombatRuntimeAssets();
  const performance = JSON.parse(
    readFileSync(resolve('docs/v0.4.1/m9-theme-performance.json'), 'utf8'),
  );
  assert.equal(performance.packageId, RUNTIME_PACKAGE_ID);
  assert.equal(performance.evidenceKind, 'REAL_BROWSER');
  assert.equal(performance.gatePolicy, 'SOT_SHOULD_RECORD_NO_ABSOLUTE_THRESHOLD');
  assert.deepEqual(performance.package, {
    assetCount: audit.assetCount,
    sourceBytes: audit.sourceBytes,
    decodedRgbaBytes: audit.decodedRgbaBytes,
  });

  const runtimeToSource = {
    'cultivation-default': 'cultivation',
    'fantasy-default': 'fantasy',
    'scifi-default': 'scifi',
    'urban-default': 'urban',
  };
  assert.deepEqual(Object.keys(performance.themes).sort(), Object.keys(runtimeToSource).sort());
  for (const [runtimeTheme, sourceTheme] of Object.entries(runtimeToSource)) {
    const measurement = performance.themes[runtimeTheme];
    const themeMemory = audit.memoryByTheme[sourceTheme];
    const commonMemory = audit.memoryByTheme.common;
    assert.equal(measurement.themeId, runtimeTheme);
    assert.equal(measurement.themeAssetCount, sourceTheme === 'scifi' ? 28 : 27);
    assert.equal(measurement.commonAssetCount, 10);
    assert.equal(measurement.loadedAssetCount, measurement.themeAssetCount + 10);
    assert.equal(measurement.sourceBytes, themeMemory.sourceBytes + commonMemory.sourceBytes);
    assert.equal(
      measurement.decodedRgbaBytes,
      themeMemory.decodedRgbaBytes + commonMemory.decodedRgbaBytes,
    );
    assert.match(measurement.userAgent, /HeadlessChrome\//u);
    assert.equal(measurement.renderFrame.iterations, 30);
    for (const value of [
      measurement.themeLoadMs,
      measurement.renderFrame.medianMs,
      measurement.renderFrame.p95Ms,
      measurement.renderFrame.maximumMs,
    ]) {
      assert.ok(Number.isFinite(value) && value > 0);
    }
  }
});
