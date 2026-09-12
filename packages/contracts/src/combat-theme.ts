export const CURRENT_COMBAT_THEME_MANIFEST_VERSION = 1;

export const COMBAT_WORLD_TYPES = ['FANTASY', 'SCI_FI', 'CULTIVATION', 'URBAN'] as const;

export type CombatWorldType = (typeof COMBAT_WORLD_TYPES)[number];

export const COMBAT_LAYOUT_PRESET_IDS = [
  'base',
  'cultivation',
  'fantasy',
  'scifi',
  'urban',
] as const;

export type CombatLayoutPresetId = (typeof COMBAT_LAYOUT_PRESET_IDS)[number];

export const COMBAT_THEME_ASSET_SLOTS = [
  'COMBAT_VFX_BUFF_APPLY',
  'COMBAT_VFX_CRITICAL_HIT',
  'COMBAT_VFX_DEBUFF_APPLY',
  'COMBAT_VFX_DEFEATED',
  'COMBAT_VFX_DOWNED',
  'COMBAT_VFX_HEAL',
  'COMBAT_VFX_HIT_PHYSICAL',
  'COMBAT_VFX_REVIVE',
  'COMBAT_VFX_SHIELD_BREAK',
  'COMBAT_VFX_SHIELD_HIT',
  'CULTIVATION_FX_SHIELD',
  'CULTIVATION_FX_SOUL_HIT',
  'CULTIVATION_RESOURCE_QI_FRAME',
  'CULTIVATION_RESOURCE_SOUL_FRAME',
  'FANTASY_FX_HOLY_SHIELD',
  'FANTASY_FX_NECROTIC',
  'FANTASY_RESOURCE_MANA_FRAME',
  'FANTASY_RESOURCE_STAMINA_FRAME',
  'SCIFI_FX_EMP',
  'SCIFI_FX_ENERGY_SHIELD',
  'SCIFI_RESOURCE_ENERGY_FRAME',
  'SCIFI_RESOURCE_HEAT_FRAME',
  'SCIFI_RESOURCE_SHIELD_FRAME',
  'THEME_ABILITY_SLOT_DISABLED',
  'THEME_ABILITY_SLOT_HOVER',
  'THEME_ABILITY_SLOT_NORMAL',
  'THEME_ABILITY_SLOT_SELECTED',
  'THEME_AP_NODE_EMPTY',
  'THEME_AP_NODE_FILLED',
  'THEME_BG_BATTLE_01',
  'THEME_BUTTON_ENDTURN_HOVER',
  'THEME_BUTTON_ENDTURN_NORMAL',
  'THEME_BUTTON_ENDTURN_PRESSED',
  'THEME_CULTIVATION_COMBAT_RESULT_DEFEAT',
  'THEME_CULTIVATION_COMBAT_RESULT_ESCAPE',
  'THEME_CULTIVATION_COMBAT_RESULT_VICTORY',
  'THEME_FANTASY_COMBAT_RESULT_DEFEAT',
  'THEME_FANTASY_COMBAT_RESULT_ESCAPE',
  'THEME_FANTASY_COMBAT_RESULT_VICTORY',
  'THEME_INTENT_FRAME',
  'THEME_PANEL_CHARACTER',
  'THEME_PANEL_COMBAT_LOG',
  'THEME_PANEL_REACTION',
  'THEME_PANEL_TOOLTIP',
  'THEME_SCIFI_COMBAT_RESULT_DEFEAT',
  'THEME_SCIFI_COMBAT_RESULT_ESCAPE',
  'THEME_SCIFI_COMBAT_RESULT_VICTORY',
  'THEME_SELECTION_ALLY',
  'THEME_SELECTION_ENEMY',
  'THEME_TIMELINE_FRAME_ALLY',
  'THEME_TIMELINE_FRAME_BOSS',
  'THEME_TIMELINE_FRAME_ENEMY',
  'THEME_URBAN_COMBAT_RESULT_DEFEAT',
  'THEME_URBAN_COMBAT_RESULT_ESCAPE',
  'THEME_URBAN_COMBAT_RESULT_VICTORY',
  'URBAN_FX_BULLET_IMPACT',
  'URBAN_FX_PSYCHIC',
  'URBAN_RESOURCE_FOCUS_FRAME',
  'URBAN_RESOURCE_STAMINA_FRAME',
] as const;

export type CombatThemeAssetSlot = (typeof COMBAT_THEME_ASSET_SLOTS)[number];

export interface CombatThemeManifest {
  readonly version: number;
  readonly themeId: string;
  readonly layoutPreset: CombatLayoutPresetId;
  readonly fallbackThemeId: string | null;
  readonly assets: Readonly<Partial<Record<CombatThemeAssetSlot, string>>>;
}

export type CombatThemeManifestErrorCode =
  'COMBAT_THEME_MANIFEST_STRUCTURE_INVALID' | 'COMBAT_THEME_MANIFEST_UNSUPPORTED';

export class CombatThemeManifestError extends Error {
  public constructor(
    public readonly code: CombatThemeManifestErrorCode,
    public readonly path: string,
  ) {
    super(code);
    this.name = 'CombatThemeManifestError';
  }
}

const MANIFEST_FIELDS = [
  'version',
  'themeId',
  'layoutPreset',
  'fallbackThemeId',
  'assets',
] as const;
const THEME_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const ASSET_PATH_PATTERN =
  /^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*[a-z0-9]+(?:-[a-z0-9]+)*\.(?:png|webp|svg|ogg|wav|woff2)$/u;
const ASSET_SLOT_SET = new Set<string>(COMBAT_THEME_ASSET_SLOTS);
const LAYOUT_PRESET_SET = new Set<string>(COMBAT_LAYOUT_PRESET_IDS);

export function parseCombatThemeManifest(value: unknown): CombatThemeManifest {
  if (!isRecord(value)) invalid('manifest');
  requireExactKeys(value, MANIFEST_FIELDS, 'manifest');
  const version = requirePositiveVersion(value['version'], 'version');
  const themeId = requireThemeId(value['themeId'], 'themeId');
  const fallbackThemeId =
    value['fallbackThemeId'] === null
      ? null
      : requireThemeId(value['fallbackThemeId'], 'fallbackThemeId');
  if (fallbackThemeId === themeId) invalid('fallbackThemeId');
  if (!LAYOUT_PRESET_SET.has(String(value['layoutPreset']))) invalid('layoutPreset');
  if (!isRecord(value['assets'])) invalid('assets');

  const assets: Partial<Record<CombatThemeAssetSlot, string>> = {};
  for (const [slot, path] of Object.entries(value['assets']).sort(([left], [right]) =>
    left.localeCompare(right, 'en'),
  )) {
    if (!ASSET_SLOT_SET.has(slot)) invalid(`assets.${slot}`);
    if (typeof path !== 'string' || !ASSET_PATH_PATTERN.test(path)) {
      invalid(`assets.${slot}`);
    }
    assets[slot as CombatThemeAssetSlot] = path;
  }

  return Object.freeze({
    version,
    themeId,
    layoutPreset: value['layoutPreset'] as CombatLayoutPresetId,
    fallbackThemeId,
    assets: Object.freeze(assets),
  });
}

export function assertSupportedCombatThemeManifest(manifest: CombatThemeManifest): void {
  if (manifest.version !== CURRENT_COMBAT_THEME_MANIFEST_VERSION) {
    throw new CombatThemeManifestError('COMBAT_THEME_MANIFEST_UNSUPPORTED', 'version');
  }
}

function requirePositiveVersion(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid(path);
  return value as number;
}

function requireThemeId(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > 80 || !THEME_ID_PATTERN.test(value)) {
    invalid(path);
  }
  return value;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    invalid(path);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(path: string): never {
  throw new CombatThemeManifestError('COMBAT_THEME_MANIFEST_STRUCTURE_INVALID', path);
}
