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
import { URBAN_COMBAT_THEME_MANIFEST, URBAN_REQUIRED_ASSET_SLOTS } from './urban-combat-theme.js';

describe('Urban Combat Theme integration', () => {
  it('keeps the public manifest identical to the validated 27-slot package', () => {
    expect(readPublicThemeManifest('urban-default')).toEqual(URBAN_COMBAT_THEME_MANIFEST);
    expect(URBAN_REQUIRED_ASSET_SLOTS).toHaveLength(27);
  });

  it('ships every declared FINAL slot as a transparent RGBA PNG', () => {
    for (const [slot, path] of Object.entries(URBAN_COMBAT_THEME_MANIFEST.assets)) {
      const metadata = pngMetadata(readPublicThemeAsset('urban-default', path));
      expect(metadata.signature, slot).toBe('89504e470d0a1a0a');
      expect(metadata.colorType, slot).toBe(6);
      expect(metadata.width, slot).toBeGreaterThan(0);
      expect(metadata.height, slot).toBeGreaterThan(0);
    }
  });

  it.each([
    [
      'THEME_ABILITY_SLOT_HOVER',
      '6fbb0d9a4d44b3c0bb6cab4a9e4ed5e24ac838a5f27b7c49c5194af520820615',
    ],
    [
      'THEME_ABILITY_SLOT_SELECTED',
      '6e57538f1a1a6d445780e0cf05da340551928cfdf7110bec4376b3a204209cdd',
    ],
    [
      'THEME_ABILITY_SLOT_DISABLED',
      '9fb6e8d0ec4f1ab1a6034d8f949f27262f171dc8467bdd7686886da7ee2fd1b7',
    ],
    [
      'THEME_BUTTON_ENDTURN_HOVER',
      '917b95287774be8fd775975857fce1f2d862c9fa309e9bc6cc39b994086f9698',
    ],
    [
      'THEME_BUTTON_ENDTURN_PRESSED',
      'bcf89a2a63bb34da56704a3d39a52b98bc4bddc2d891d9c6ad77e411fa1e904a',
    ],
    ['THEME_AP_NODE_EMPTY', '5861ebada8d080e9fb65c4a3b54063e6d6b61dd613ecfd076bca5a167af81616'],
    ['URBAN_FX_BULLET_IMPACT', 'b1e206ec83438b650300f226d9ddf346113a1ab0ca6b4cc589bd9bc38b176208'],
  ] as const)('matches the FINAL digest for %s', (slot, expectedDigest) => {
    const path = URBAN_COMBAT_THEME_MANIFEST.assets[slot];
    if (path === undefined) throw new Error(`Missing test slot ${slot}`);
    expect(sha256(readPublicThemeAsset('urban-default', path))).toBe(expectedDigest);
  });

  it('binds Stamina and Focus through the shared API without warnings', async () => {
    const themePackage: CombatThemePackage = {
      themeId: 'urban-default',
      layoutPreset: 'urban',
      manifest: URBAN_COMBAT_THEME_MANIFEST,
      selection: 'WORLD_DEFAULT',
    };
    const manifests = new Map([
      ['urban-default', URBAN_COMBAT_THEME_MANIFEST],
      ['base', BASE_COMBAT_THEME_MANIFEST],
    ]);
    const binding = await bindCombatThemePackage(
      themePackage,
      new CombatThemeAssetResolver(
        new CombatThemeLoader({ read: async (themeId) => manifests.get(themeId) }),
      ),
      URBAN_REQUIRED_ASSET_SLOTS,
    );

    expect(binding.warnings).toEqual([]);
    expect(Object.keys(binding.cssVariables)).toHaveLength(27);
    for (const resource of ['stamina', 'focus']) {
      expect(binding.cssVariables[`--combat-asset-urban-resource-${resource}-frame`]).toContain(
        `/resources/resource-${resource}-frame.png`,
      );
    }
  });
});
