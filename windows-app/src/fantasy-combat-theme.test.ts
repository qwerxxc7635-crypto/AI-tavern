import { describe, expect, it } from 'vitest';

import {
  readPublicThemeAsset,
  readPublicThemeManifest,
  pngMetadata,
  sha256,
} from './combat-theme-asset-test-helpers.js';
import { bindCombatThemePackage } from './combat-theme-binding.js';
import { BASE_COMBAT_THEME_MANIFEST, CombatThemeAssetResolver } from './combat-theme-fallback.js';
import { CombatThemeLoader } from './combat-theme-service.js';
import type { CombatThemePackage } from './combat-theme-service.js';
import {
  FANTASY_COMBAT_THEME_MANIFEST,
  FANTASY_REQUIRED_ASSET_SLOTS,
} from './fantasy-combat-theme.js';

describe('Fantasy Combat Theme integration', () => {
  it('keeps the public manifest identical to the validated 27-slot package', () => {
    expect(readPublicThemeManifest('fantasy-default')).toEqual(FANTASY_COMBAT_THEME_MANIFEST);
    expect(FANTASY_REQUIRED_ASSET_SLOTS).toHaveLength(27);
  });

  it('ships every declared FINAL slot as a transparent RGBA PNG', () => {
    for (const [slot, path] of Object.entries(FANTASY_COMBAT_THEME_MANIFEST.assets)) {
      const metadata = pngMetadata(readPublicThemeAsset('fantasy-default', path));
      expect(metadata.signature, slot).toBe('89504e470d0a1a0a');
      expect(metadata.colorType, slot).toBe(6);
      expect(metadata.width, slot).toBeGreaterThan(0);
      expect(metadata.height, slot).toBeGreaterThan(0);
    }
  });

  it.each([
    [
      'THEME_ABILITY_SLOT_HOVER',
      'b275cf66aad2b1e3826d9ec001c6eeccc25eac1be7d656594202d6e5ab821a3b',
    ],
    [
      'THEME_ABILITY_SLOT_SELECTED',
      'd468a7be7ae4ee26182fc5247f3cbcbf36a6f42138bf77811484d07de6196b21',
    ],
    [
      'THEME_ABILITY_SLOT_DISABLED',
      'f14061ed7bdf634605ab16434c0b75e08a31a59955b5a889725c9e471a5e8da9',
    ],
    [
      'THEME_BUTTON_ENDTURN_HOVER',
      '130a99bbaddcaaeedcfe37aeed6ba3a0e4f50a7b57429fa95376b3156696205d',
    ],
    [
      'THEME_BUTTON_ENDTURN_PRESSED',
      '90b49b0b36f0282ab3cf2cb3c2ca786345142ffdf7c381887c633b2a4c3ed410',
    ],
    ['THEME_AP_NODE_EMPTY', '0a990eef6980a6e1bc0bc4ce5751c349b69bec58df352752bfaea0f2917177b9'],
    ['FANTASY_FX_HOLY_SHIELD', 'bb4d0cd8651c174269abde2c478bbbdc1b23d45cd3e3dddc08da055910fad9a2'],
  ] as const)('matches the FINAL digest for %s', (slot, expectedDigest) => {
    const path = FANTASY_COMBAT_THEME_MANIFEST.assets[slot];
    if (path === undefined) throw new Error(`Missing test slot ${slot}`);
    expect(sha256(readPublicThemeAsset('fantasy-default', path))).toBe(expectedDigest);
  });

  it('binds the complete Fantasy package through the shared theme API without warnings', async () => {
    const themePackage: CombatThemePackage = {
      themeId: 'fantasy-default',
      layoutPreset: 'fantasy',
      manifest: FANTASY_COMBAT_THEME_MANIFEST,
      selection: 'WORLD_DEFAULT',
    };
    const manifests = new Map([
      ['fantasy-default', FANTASY_COMBAT_THEME_MANIFEST],
      ['base', BASE_COMBAT_THEME_MANIFEST],
    ]);
    const binding = await bindCombatThemePackage(
      themePackage,
      new CombatThemeAssetResolver(
        new CombatThemeLoader({ read: async (themeId) => manifests.get(themeId) }),
      ),
      FANTASY_REQUIRED_ASSET_SLOTS,
    );

    expect(binding.warnings).toEqual([]);
    expect(Object.keys(binding.cssVariables)).toHaveLength(27);
    expect(binding.cssVariables['--combat-asset-fantasy-resource-mana-frame']).toContain(
      '/fantasy-default/assets/resources/resource-mana-frame.png',
    );
    expect(binding.cssVariables['--combat-asset-fantasy-fx-necrotic']).toContain(
      '/fantasy-default/assets/effects/fx-necrotic.png',
    );
  });
});
