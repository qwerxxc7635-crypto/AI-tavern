import { describe, expect, it } from 'vitest';

import { COMBAT_THEME_ASSET_SLOTS, parseCombatThemeManifest } from '@ember-tavern/contracts';
import type { CombatThemeManifest } from '@ember-tavern/contracts';

import { BASE_COMBAT_THEME_MANIFEST, CombatThemeAssetResolver } from './combat-theme-fallback.js';
import { CombatThemeLoader } from './combat-theme-service.js';
import type { CombatThemePackage } from './combat-theme-service.js';

describe('Base Combat Theme asset fallback', () => {
  it('uses a concrete asset from the selected theme without warnings', async () => {
    const selected = manifest('fantasy-default', 'base', {
      THEME_BG_BATTLE_01: 'assets/backgrounds/battle-background-01.png',
    });
    const resolver = resolverFrom([selected, BASE_COMBAT_THEME_MANIFEST]);

    await expect(
      resolver.resolveAsset(themePackage(selected), 'THEME_BG_BATTLE_01'),
    ).resolves.toEqual({
      asset: {
        source: 'THEME_ASSET',
        slot: 'THEME_BG_BATTLE_01',
        ownerThemeId: 'fantasy-default',
        path: 'assets/backgrounds/battle-background-01.png',
      },
      warnings: [],
    });
  });

  it('warns for the selected-theme miss and resolves a concrete Base Theme asset', async () => {
    const selected = manifest('fantasy-default', 'base');
    const base = manifest('base', null, {
      THEME_PANEL_CHARACTER: 'assets/panels/base-character-panel.svg',
    });

    await expect(
      resolverFrom([selected, base]).resolveAsset(themePackage(selected), 'THEME_PANEL_CHARACTER'),
    ).resolves.toEqual({
      asset: {
        source: 'FALLBACK_THEME_ASSET',
        slot: 'THEME_PANEL_CHARACTER',
        ownerThemeId: 'base',
        path: 'assets/panels/base-character-panel.svg',
      },
      warnings: [
        {
          code: 'THEME_ASSET_MISSING',
          themeId: 'fantasy-default',
          slot: 'THEME_PANEL_CHARACTER',
        },
      ],
    });
  });

  it('provides a non-throwing CSS or Vector fallback for every stable slot', async () => {
    const selected = manifest('urban-default', 'base');
    const resolver = resolverFrom([selected, BASE_COMBAT_THEME_MANIFEST]);

    const results = await Promise.all(
      COMBAT_THEME_ASSET_SLOTS.map((slot) => resolver.resolveAsset(themePackage(selected), slot)),
    );

    expect(results).toHaveLength(59);
    expect(results.every(({ asset }) => asset.source === 'CSS_VECTOR_FALLBACK')).toBe(true);
    expect(results.find(({ asset }) => asset.slot === 'THEME_BG_BATTLE_01')?.asset).toEqual(
      expect.objectContaining({ fallbackKind: 'CSS_BACKGROUND' }),
    );
    expect(results.find(({ asset }) => asset.slot === 'COMBAT_VFX_CRITICAL_HIT')?.asset).toEqual(
      expect.objectContaining({ fallbackKind: 'VECTOR_EFFECT' }),
    );
    expect(results.every(({ warnings }) => warnings.length === 2)).toBe(true);
    expect(results.every(({ warnings }) => Object.isFrozen(warnings))).toBe(true);
  });

  it('recovers with CSS fallback and warnings when the fallback package is unavailable', async () => {
    const selected = manifest('scifi-default', 'missing-base');
    const resolver = resolverFrom([selected]);

    const result = await resolver.resolveAsset(themePackage(selected), 'THEME_AP_NODE_EMPTY');

    expect(result.asset).toEqual(
      expect.objectContaining({
        source: 'CSS_VECTOR_FALLBACK',
        fallbackKind: 'CSS_RESOURCE',
      }),
    );
    expect(result.warnings.map(({ code }) => code)).toEqual([
      'THEME_ASSET_MISSING',
      'FALLBACK_THEME_FAILED',
    ]);
  });

  it('recovers from a fallback cycle without hanging or throwing', async () => {
    const first = manifest('cycle-a', 'cycle-b');
    const second = manifest('cycle-b', 'cycle-a');

    const result = await resolverFrom([first, second]).resolveAsset(
      themePackage(first),
      'THEME_INTENT_FRAME',
    );

    expect(result.asset).toEqual(
      expect.objectContaining({ source: 'CSS_VECTOR_FALLBACK', fallbackKind: 'CSS_INTENT' }),
    );
    expect(result.warnings.map(({ code }) => code)).toEqual([
      'THEME_ASSET_MISSING',
      'THEME_ASSET_MISSING',
      'FALLBACK_CYCLE',
    ]);
  });
});

function manifest(
  themeId: string,
  fallbackThemeId: string | null,
  assets: CombatThemeManifest['assets'] = {},
): CombatThemeManifest {
  return parseCombatThemeManifest({
    version: 1,
    themeId,
    layoutPreset: themeId === 'base' ? 'base' : 'fantasy',
    fallbackThemeId,
    assets,
  });
}

function resolverFrom(manifests: readonly CombatThemeManifest[]): CombatThemeAssetResolver {
  const byId = new Map(manifests.map((entry) => [entry.themeId, entry]));
  return new CombatThemeAssetResolver(
    new CombatThemeLoader({
      read: async (themeId) => {
        const value = byId.get(themeId);
        if (value === undefined) throw new Error('missing fixture theme');
        return value;
      },
    }),
  );
}

function themePackage(manifest: CombatThemeManifest): CombatThemePackage {
  return {
    themeId: manifest.themeId,
    layoutPreset: manifest.layoutPreset,
    manifest,
    selection: 'WORLD_DEFAULT',
  };
}
