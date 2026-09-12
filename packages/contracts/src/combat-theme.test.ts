import { describe, expect, it } from 'vitest';

import {
  COMBAT_THEME_ASSET_SLOTS,
  CURRENT_COMBAT_THEME_MANIFEST_VERSION,
  assertSupportedCombatThemeManifest,
  parseCombatThemeManifest,
} from './combat-theme.js';
import type { CombatThemeManifestError } from './combat-theme.js';

const validManifest = {
  version: 1,
  themeId: 'cultivation-default',
  layoutPreset: 'cultivation',
  fallbackThemeId: 'base',
  assets: {
    THEME_BG_BATTLE_01: 'assets/backgrounds/battle-background-01.png',
    THEME_AP_NODE_FILLED: 'assets/resources/ap-node-filled.png',
    CULTIVATION_RESOURCE_QI_FRAME: 'assets/resources/resource-qi-frame.png',
  },
} as const;

describe('Combat Theme Manifest schema', () => {
  it('parses stable identity, layout, fallback and canonical slot mappings', () => {
    const manifest = parseCombatThemeManifest(validManifest);

    expect(manifest).toEqual(validManifest);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.assets)).toBe(true);
    expect(COMBAT_THEME_ASSET_SLOTS).toHaveLength(59);
    assertSupportedCombatThemeManifest(manifest);
  });

  it.each([
    ['unknown manifest field', { ...validManifest, damageMultiplier: 2 }, 'manifest'],
    ['rule payload', { ...validManifest, legalTargetIds: ['enemy'] }, 'manifest'],
    ['unstable theme id', { ...validManifest, themeId: 'Cultivation Default' }, 'themeId'],
    ['numeric theme id', { ...validManifest, themeId: '2026' }, 'themeId'],
    [
      'self fallback',
      { ...validManifest, fallbackThemeId: validManifest.themeId },
      'fallbackThemeId',
    ],
    ['unknown layout', { ...validManifest, layoutPreset: 'damage-heavy' }, 'layoutPreset'],
    [
      'unknown slot',
      { ...validManifest, assets: { DAMAGE_MULTIPLIER: 'rules/damage.png' } },
      'assets.DAMAGE_MULTIPLIER',
    ],
    [
      'absolute path',
      { ...validManifest, assets: { THEME_BG_BATTLE_01: '/tmp/battle.png' } },
      'assets.THEME_BG_BATTLE_01',
    ],
    [
      'traversal path',
      { ...validManifest, assets: { THEME_BG_BATTLE_01: '../battle.png' } },
      'assets.THEME_BG_BATTLE_01',
    ],
    [
      'non-canonical path',
      { ...validManifest, assets: { THEME_BG_BATTLE_01: 'assets/Battle Background.png' } },
      'assets.THEME_BG_BATTLE_01',
    ],
  ] as const)('rejects %s', (_label, value, path) => {
    expect(() => parseCombatThemeManifest(value)).toThrow(
      expect.objectContaining<Partial<CombatThemeManifestError>>({
        code: 'COMBAT_THEME_MANIFEST_STRUCTURE_INVALID',
        path,
      }),
    );
  });

  it('separates positive structural versions from runtime compatibility', () => {
    const future = parseCombatThemeManifest({ ...validManifest, version: 2 });
    expect(() => assertSupportedCombatThemeManifest(future)).toThrow(
      expect.objectContaining<Partial<CombatThemeManifestError>>({
        code: 'COMBAT_THEME_MANIFEST_UNSUPPORTED',
        path: 'version',
      }),
    );
    expect(CURRENT_COMBAT_THEME_MANIFEST_VERSION).toBe(1);
  });

  it('supports an asset-free base manifest with no fallback', () => {
    expect(
      parseCombatThemeManifest({
        version: 1,
        themeId: 'base',
        layoutPreset: 'base',
        fallbackThemeId: null,
        assets: {},
      }),
    ).toEqual({
      version: 1,
      themeId: 'base',
      layoutPreset: 'base',
      fallbackThemeId: null,
      assets: {},
    });
  });
});
