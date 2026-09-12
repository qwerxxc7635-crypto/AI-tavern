import { describe, expect, it } from 'vitest';

import {
  pngMetadata,
  readPublicThemeAsset,
  readPublicThemeManifest,
  sha256,
} from './combat-theme-asset-test-helpers.js';
import { bindCombatThemePackage } from './combat-theme-binding.js';
import { BASE_COMBAT_THEME_MANIFEST, CombatThemeAssetResolver } from './combat-theme-fallback.js';
import { CombatThemeLoader } from './combat-theme-service.js';
import type { CombatThemePackage } from './combat-theme-service.js';
import { SCIFI_COMBAT_THEME_MANIFEST, SCIFI_REQUIRED_ASSET_SLOTS } from './scifi-combat-theme.js';

describe('Sci-Fi Combat Theme integration', () => {
  it('keeps the public manifest identical to the validated 28-slot package', () => {
    expect(readPublicThemeManifest('scifi-default')).toEqual(SCIFI_COMBAT_THEME_MANIFEST);
    expect(SCIFI_REQUIRED_ASSET_SLOTS).toHaveLength(28);
  });

  it('ships every declared FINAL slot as a transparent RGBA PNG', () => {
    for (const [slot, path] of Object.entries(SCIFI_COMBAT_THEME_MANIFEST.assets)) {
      const metadata = pngMetadata(readPublicThemeAsset('scifi-default', path));
      expect(metadata.signature, slot).toBe('89504e470d0a1a0a');
      expect(metadata.colorType, slot).toBe(6);
      expect(metadata.width, slot).toBeGreaterThan(0);
      expect(metadata.height, slot).toBeGreaterThan(0);
    }
  });

  it.each([
    [
      'THEME_ABILITY_SLOT_HOVER',
      'f9624c6c6e27e36bc66ed6c9519fcecf254489ff4ef26cee056195861a9c8af7',
    ],
    [
      'THEME_ABILITY_SLOT_SELECTED',
      'fccd6f5341d9a037be128d6965ee713cd80e4071bdc47bfd5ade60966f075d7b',
    ],
    [
      'THEME_ABILITY_SLOT_DISABLED',
      '86fc4a56d7275370104a5bb7d12954b542778fc7cf83382a431970ed5f5a60e8',
    ],
    [
      'THEME_BUTTON_ENDTURN_HOVER',
      'a30cbc57c5802e00854856b5fae38e2cefddd45235f70f86a1526823345d34cd',
    ],
    [
      'THEME_BUTTON_ENDTURN_PRESSED',
      '38476c7db9206ab1a6395dcf8e927cabf8bec6888a80c4fb0422a7383cb482bd',
    ],
    ['THEME_AP_NODE_EMPTY', '464101611820557de8e2301d79f368cd8b6f618ceaa28cfc811dbcdded0d27de'],
    ['SCIFI_FX_EMP', 'a0d7f7a79c71c16c021969d66e0e9e951acf74af1f0230c2557acf26d76bbfc4'],
  ] as const)('matches the FINAL digest for %s', (slot, expectedDigest) => {
    const path = SCIFI_COMBAT_THEME_MANIFEST.assets[slot];
    if (path === undefined) throw new Error(`Missing test slot ${slot}`);
    expect(sha256(readPublicThemeAsset('scifi-default', path))).toBe(expectedDigest);
  });

  it('locks the final pixel-derived AP Empty dimensions and exact digest', () => {
    const path = SCIFI_COMBAT_THEME_MANIFEST.assets.THEME_AP_NODE_EMPTY;
    if (path === undefined) throw new Error('Missing Sci-Fi AP Empty');
    const content = readPublicThemeAsset('scifi-default', path);
    expect(pngMetadata(content)).toEqual({
      signature: '89504e470d0a1a0a',
      width: 1254,
      height: 1254,
      colorType: 6,
    });
    expect(sha256(content)).toBe(
      '464101611820557de8e2301d79f368cd8b6f618ceaa28cfc811dbcdded0d27de',
    );
  });

  it('binds Shield, Energy and Heat through the shared API without warnings', async () => {
    const themePackage: CombatThemePackage = {
      themeId: 'scifi-default',
      layoutPreset: 'scifi',
      manifest: SCIFI_COMBAT_THEME_MANIFEST,
      selection: 'WORLD_DEFAULT',
    };
    const manifests = new Map([
      ['scifi-default', SCIFI_COMBAT_THEME_MANIFEST],
      ['base', BASE_COMBAT_THEME_MANIFEST],
    ]);
    const binding = await bindCombatThemePackage(
      themePackage,
      new CombatThemeAssetResolver(
        new CombatThemeLoader({ read: async (themeId) => manifests.get(themeId) }),
      ),
      SCIFI_REQUIRED_ASSET_SLOTS,
    );

    expect(binding.warnings).toEqual([]);
    expect(Object.keys(binding.cssVariables)).toHaveLength(28);
    for (const resource of ['shield', 'energy', 'heat']) {
      expect(binding.cssVariables[`--combat-asset-scifi-resource-${resource}-frame`]).toContain(
        `/resources/resource-${resource}-frame.png`,
      );
    }
  });
});
