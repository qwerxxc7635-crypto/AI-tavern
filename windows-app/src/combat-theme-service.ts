import {
  COMBAT_WORLD_TYPES,
  CombatThemeManifestError,
  assertSupportedCombatThemeManifest,
  parseCombatThemeManifest,
} from '@ember-tavern/contracts';
import type {
  CombatLayoutPresetId,
  CombatThemeManifest,
  CombatWorldType,
} from '@ember-tavern/contracts';

export const DEFAULT_COMBAT_THEME_BY_WORLD_TYPE: Readonly<Record<CombatWorldType, string>> =
  Object.freeze({
    FANTASY: 'fantasy-default',
    SCI_FI: 'scifi-default',
    CULTIVATION: 'cultivation-default',
    URBAN: 'urban-default',
  });

export interface CombatThemeManifestSource {
  read(themeId: string): Promise<unknown>;
}

export interface CombatThemePackage {
  readonly themeId: string;
  readonly layoutPreset: CombatLayoutPresetId;
  readonly manifest: CombatThemeManifest;
  readonly selection: 'WORLD_DEFAULT' | 'QA_OVERRIDE';
}

export type CombatThemeServiceErrorCode =
  'THEME_SOURCE_FAILED' | 'THEME_ID_MISMATCH' | 'WORLD_TYPE_UNSUPPORTED';

export class CombatThemeServiceError extends Error {
  public constructor(
    public readonly code: CombatThemeServiceErrorCode,
    public readonly subject: string,
  ) {
    super(code);
    this.name = 'CombatThemeServiceError';
  }
}

export class CombatThemeLoader {
  public constructor(private readonly source: CombatThemeManifestSource) {}

  public async load(themeId: string): Promise<CombatThemeManifest> {
    let raw: unknown;
    try {
      raw = await this.source.read(themeId);
    } catch {
      throw new CombatThemeServiceError('THEME_SOURCE_FAILED', themeId);
    }
    const manifest = parseCombatThemeManifest(raw);
    assertSupportedCombatThemeManifest(manifest);
    if (manifest.themeId !== themeId) {
      throw new CombatThemeServiceError('THEME_ID_MISMATCH', themeId);
    }
    return manifest;
  }
}

export class CombatThemeResolver {
  private readonly worldTypes = new Set<string>(COMBAT_WORLD_TYPES);

  public constructor(private readonly loader: CombatThemeLoader) {}

  public async resolve(
    worldType: CombatWorldType,
    qaThemeOverride?: string,
  ): Promise<CombatThemePackage> {
    if (!this.worldTypes.has(worldType)) {
      throw new CombatThemeServiceError('WORLD_TYPE_UNSUPPORTED', String(worldType));
    }
    const selection = qaThemeOverride === undefined ? 'WORLD_DEFAULT' : 'QA_OVERRIDE';
    const themeId = qaThemeOverride ?? DEFAULT_COMBAT_THEME_BY_WORLD_TYPE[worldType];
    const manifest = await this.loader.load(themeId);
    return Object.freeze({
      themeId,
      layoutPreset: manifest.layoutPreset,
      manifest,
      selection,
    });
  }
}

export function isThemeContractError(error: unknown): boolean {
  return error instanceof CombatThemeManifestError || error instanceof CombatThemeServiceError;
}
