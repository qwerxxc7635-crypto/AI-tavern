import { COMBAT_THEME_ASSET_SLOTS } from '@ember-tavern/contracts';
import type { CombatThemeAssetSlot, CombatWorldType } from '@ember-tavern/contracts';

import { CombatThemeAssetResolver, type CombatThemeWarning } from './combat-theme-fallback.js';
import {
  CombatThemeLoader,
  CombatThemeResolver,
  DEFAULT_COMBAT_THEME_BY_WORLD_TYPE,
  type CombatThemeManifestSource,
  type CombatThemePackage,
} from './combat-theme-service.js';

export interface CombatThemeBinding {
  readonly themeId: string;
  readonly layoutPreset: string;
  readonly cssVariables: Readonly<Record<string, string>>;
  readonly warnings: readonly CombatThemeWarning[];
}

const publicThemeSource: CombatThemeManifestSource = {
  async read(themeId) {
    const packageId = themeId === 'base' ? 'common' : themeId;
    const response = await fetch(`/assets/combat-themes/${packageId}/manifest.json`);
    if (!response.ok) throw new Error('Combat theme manifest unavailable');
    const manifest: unknown = await response.json();
    if (themeId !== 'base') return manifest;
    if (typeof manifest !== 'object' || manifest === null || !('assets' in manifest)) {
      throw new TypeError('Shared combat theme manifest is invalid');
    }
    return {
      version: 1,
      themeId: 'base',
      layoutPreset: 'base',
      fallbackThemeId: null,
      assets: manifest.assets,
    };
  },
};

export async function loadCombatThemeForWorld(
  world: CombatWorldType,
  source: CombatThemeManifestSource = publicThemeSource,
): Promise<CombatThemeBinding> {
  const manifestReads = new Map<string, Promise<unknown>>();
  const loader = new CombatThemeLoader({
    read(themeId) {
      let reading = manifestReads.get(themeId);
      if (reading === undefined) {
        reading = source.read(themeId);
        manifestReads.set(themeId, reading);
      }
      return reading;
    },
  });
  try {
    const themePackage = await new CombatThemeResolver(loader).resolve(world);
    return bindCombatThemePackage(
      themePackage,
      new CombatThemeAssetResolver(loader),
      COMBAT_THEME_ASSET_SLOTS,
    );
  } catch {
    return Object.freeze({
      themeId: 'base',
      layoutPreset: 'base',
      cssVariables: Object.freeze({}),
      warnings: Object.freeze(
        COMBAT_THEME_ASSET_SLOTS.map((slot) => ({
          code: 'FALLBACK_THEME_FAILED' as const,
          themeId: DEFAULT_COMBAT_THEME_BY_WORLD_TYPE[world],
          slot,
        })),
      ),
    });
  }
}

export async function bindCombatThemePackage(
  themePackage: CombatThemePackage,
  resolver: CombatThemeAssetResolver,
  requiredSlots: readonly CombatThemeAssetSlot[],
): Promise<CombatThemeBinding> {
  const cssVariables: Record<string, string> = {};
  const warnings: CombatThemeWarning[] = [];
  for (const slot of requiredSlots) {
    const resolved = await resolver.resolveAsset(themePackage, slot);
    warnings.push(...resolved.warnings);
    if (resolved.asset.source !== 'CSS_VECTOR_FALLBACK') {
      const packageId =
        resolved.asset.ownerThemeId === 'base' ? 'common' : resolved.asset.ownerThemeId;
      const publicPath = `/assets/combat-themes/${packageId}/${resolved.asset.path}`;
      cssVariables[cssVariableForSlot(slot)] = `url("${publicPath}")`;
    }
  }
  return Object.freeze({
    themeId: themePackage.themeId,
    layoutPreset: themePackage.layoutPreset,
    cssVariables: Object.freeze(cssVariables),
    warnings: Object.freeze(warnings),
  });
}

export function cssVariableForSlot(slot: CombatThemeAssetSlot): string {
  return `--combat-asset-${slot.toLowerCase().replaceAll('_', '-')}`;
}
