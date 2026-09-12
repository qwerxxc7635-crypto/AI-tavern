import { COMBAT_THEME_ASSET_SLOTS, parseCombatThemeManifest } from '@ember-tavern/contracts';
import type { CombatThemeAssetSlot, CombatThemeManifest } from '@ember-tavern/contracts';

import type { CombatThemeLoader, CombatThemePackage } from './combat-theme-service.js';

export const BASE_COMBAT_THEME_MANIFEST = parseCombatThemeManifest({
  version: 1,
  themeId: 'base',
  layoutPreset: 'base',
  fallbackThemeId: null,
  assets: {},
});

export type CombatThemeFallbackKind =
  | 'CSS_BACKGROUND'
  | 'CSS_PANEL'
  | 'CSS_TIMELINE'
  | 'CSS_ABILITY_SLOT'
  | 'CSS_BUTTON'
  | 'CSS_RESOURCE'
  | 'CSS_SELECTION'
  | 'CSS_INTENT'
  | 'CSS_RESULT'
  | 'VECTOR_EFFECT';

export type ResolvedCombatThemeAsset =
  | {
      readonly source: 'THEME_ASSET' | 'FALLBACK_THEME_ASSET';
      readonly slot: CombatThemeAssetSlot;
      readonly ownerThemeId: string;
      readonly path: string;
    }
  | {
      readonly source: 'CSS_VECTOR_FALLBACK';
      readonly slot: CombatThemeAssetSlot;
      readonly ownerThemeId: 'base';
      readonly fallbackKind: CombatThemeFallbackKind;
    };

export type CombatThemeWarningCode =
  'THEME_ASSET_MISSING' | 'FALLBACK_THEME_FAILED' | 'FALLBACK_CYCLE' | 'FALLBACK_DEPTH_EXCEEDED';

export interface CombatThemeWarning {
  readonly code: CombatThemeWarningCode;
  readonly themeId: string;
  readonly slot: CombatThemeAssetSlot;
}

export interface CombatThemeAssetResolution {
  readonly asset: ResolvedCombatThemeAsset;
  readonly warnings: readonly CombatThemeWarning[];
}

const MAX_FALLBACK_DEPTH = 16;
const KNOWN_SLOTS = new Set<string>(COMBAT_THEME_ASSET_SLOTS);

export class CombatThemeAssetResolver {
  public constructor(private readonly loader: CombatThemeLoader) {}

  public async resolveAsset(
    themePackage: CombatThemePackage,
    slot: CombatThemeAssetSlot,
  ): Promise<CombatThemeAssetResolution> {
    if (!KNOWN_SLOTS.has(slot)) throw new TypeError('Unknown combat theme asset slot');
    const warnings: CombatThemeWarning[] = [];
    const visited = new Set<string>();
    let manifest: CombatThemeManifest = themePackage.manifest;
    let depth = 0;

    while (true) {
      if (visited.has(manifest.themeId)) {
        warnings.push(warning('FALLBACK_CYCLE', manifest.themeId, slot));
        return resolution(cssVectorFallback(slot), warnings);
      }
      visited.add(manifest.themeId);
      const path = manifest.assets[slot];
      if (path !== undefined) {
        return resolution(
          Object.freeze({
            source:
              manifest.themeId === themePackage.themeId ? 'THEME_ASSET' : 'FALLBACK_THEME_ASSET',
            slot,
            ownerThemeId: manifest.themeId,
            path,
          }),
          warnings,
        );
      }
      warnings.push(warning('THEME_ASSET_MISSING', manifest.themeId, slot));

      if (manifest.fallbackThemeId === null) {
        return resolution(cssVectorFallback(slot), warnings);
      }
      const fallbackThemeId = manifest.fallbackThemeId;
      depth += 1;
      if (depth > MAX_FALLBACK_DEPTH) {
        warnings.push(warning('FALLBACK_DEPTH_EXCEEDED', manifest.themeId, slot));
        return resolution(cssVectorFallback(slot), warnings);
      }
      try {
        manifest = await this.loader.load(fallbackThemeId);
      } catch {
        warnings.push(warning('FALLBACK_THEME_FAILED', fallbackThemeId, slot));
        return resolution(cssVectorFallback(slot), warnings);
      }
    }
  }
}

function resolution(
  asset: ResolvedCombatThemeAsset,
  warnings: CombatThemeWarning[],
): CombatThemeAssetResolution {
  return Object.freeze({ asset, warnings: Object.freeze(warnings) });
}

function warning(
  code: CombatThemeWarningCode,
  themeId: string,
  slot: CombatThemeAssetSlot,
): CombatThemeWarning {
  return Object.freeze({ code, themeId, slot });
}

function cssVectorFallback(slot: CombatThemeAssetSlot): ResolvedCombatThemeAsset {
  return Object.freeze({
    source: 'CSS_VECTOR_FALLBACK',
    slot,
    ownerThemeId: 'base',
    fallbackKind: fallbackKind(slot),
  });
}

function fallbackKind(slot: CombatThemeAssetSlot): CombatThemeFallbackKind {
  if (slot.startsWith('COMBAT_VFX_') || slot.includes('_FX_')) return 'VECTOR_EFFECT';
  if (slot.startsWith('THEME_BG_')) return 'CSS_BACKGROUND';
  if (slot.startsWith('THEME_PANEL_')) return 'CSS_PANEL';
  if (slot.startsWith('THEME_TIMELINE_')) return 'CSS_TIMELINE';
  if (slot.startsWith('THEME_ABILITY_SLOT_')) return 'CSS_ABILITY_SLOT';
  if (slot.startsWith('THEME_BUTTON_')) return 'CSS_BUTTON';
  if (slot === 'THEME_AP_NODE_FILLED' || slot === 'THEME_AP_NODE_EMPTY') {
    return 'CSS_RESOURCE';
  }
  if (slot.includes('_RESOURCE_')) return 'CSS_RESOURCE';
  if (slot.startsWith('THEME_SELECTION_')) return 'CSS_SELECTION';
  if (slot === 'THEME_INTENT_FRAME') return 'CSS_INTENT';
  if (slot.includes('_COMBAT_RESULT_')) return 'CSS_RESULT';
  throw new TypeError(`Unmapped combat theme asset slot: ${slot}`);
}
