import type { CombatThemeAssetSlot } from '@ember-tavern/contracts';

import type { CombatThemeAssetResolver, CombatThemeWarning } from './combat-theme-fallback.js';
import type { CombatThemePackage } from './combat-theme-service.js';

export interface CombatThemeBinding {
  readonly themeId: string;
  readonly layoutPreset: string;
  readonly cssVariables: Readonly<Record<string, string>>;
  readonly warnings: readonly CombatThemeWarning[];
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
      const publicPath = `/assets/combat-themes/${resolved.asset.ownerThemeId}/${resolved.asset.path}`;
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
