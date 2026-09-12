import { describe, expect, it, vi } from 'vitest';

import type { CombatThemeManifest, CombatWorldType } from '@ember-tavern/contracts';

import {
  DEFAULT_COMBAT_THEME_BY_WORLD_TYPE,
  CombatThemeLoader,
  CombatThemeResolver,
} from './combat-theme-service.js';
import type { CombatThemeServiceError } from './combat-theme-service.js';

describe('CombatThemeLoader and WorldType resolver', () => {
  it.each([
    ['FANTASY', 'fantasy-default', 'fantasy'],
    ['SCI_FI', 'scifi-default', 'scifi'],
    ['CULTIVATION', 'cultivation-default', 'cultivation'],
    ['URBAN', 'urban-default', 'urban'],
  ] as const)('maps %s to its required default package', async (worldType, themeId, preset) => {
    const read = vi.fn(async (requestedId: string) => manifest(requestedId, preset));
    const resolver = new CombatThemeResolver(new CombatThemeLoader({ read }));

    const resolved = await resolver.resolve(worldType);

    expect(DEFAULT_COMBAT_THEME_BY_WORLD_TYPE[worldType]).toBe(themeId);
    expect(read).toHaveBeenCalledWith(themeId);
    expect(resolved).toEqual({
      themeId,
      layoutPreset: preset,
      manifest: manifest(themeId, preset),
      selection: 'WORLD_DEFAULT',
    });
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it('allows an explicit development or QA theme override without changing world ownership', async () => {
    const source = { read: async (themeId: string) => manifest(themeId, 'urban') };
    const resolver = new CombatThemeResolver(new CombatThemeLoader(source));

    const resolved = await resolver.resolve('FANTASY', 'urban-qa');

    expect(resolved.themeId).toBe('urban-qa');
    expect(resolved.layoutPreset).toBe('urban');
    expect(resolved.selection).toBe('QA_OVERRIDE');
    expect(DEFAULT_COMBAT_THEME_BY_WORLD_TYPE.FANTASY).toBe('fantasy-default');
  });

  it('does not receive or mutate Combat State, Commands, rules, or an Engine lifecycle', async () => {
    const combatRuntime = Object.freeze({
      engine: Object.freeze({ instanceId: 'engine-1' }),
      state: Object.freeze({ revision: 12, hitPoints: 24 }),
      command: Object.freeze({ kind: 'END_TURN' }),
      rules: Object.freeze({ legalTargetIds: ['enemy'] }),
    });
    const before = JSON.stringify(combatRuntime);
    const engine = combatRuntime.engine;
    const resolver = new CombatThemeResolver(
      new CombatThemeLoader({ read: async (themeId) => manifest(themeId, 'scifi') }),
    );

    await resolver.resolve('SCI_FI');
    await resolver.resolve('SCI_FI', 'scifi-qa');

    expect(JSON.stringify(combatRuntime)).toBe(before);
    expect(combatRuntime.engine).toBe(engine);
  });

  it('rejects a source manifest whose stable identity differs from the requested package', async () => {
    const loader = new CombatThemeLoader({
      read: async () => manifest('other-theme', 'fantasy'),
    });
    await expect(loader.load('fantasy-default')).rejects.toEqual(
      expect.objectContaining<Partial<CombatThemeServiceError>>({
        code: 'THEME_ID_MISMATCH',
        subject: 'fantasy-default',
      }),
    );
  });

  it('fails closed for source errors, unsupported versions and unknown runtime world values', async () => {
    const sourceFailure = new CombatThemeLoader({
      read: async () => {
        throw new Error('disk detail must not become the service error');
      },
    });
    await expect(sourceFailure.load('fantasy-default')).rejects.toEqual(
      expect.objectContaining({ code: 'THEME_SOURCE_FAILED', subject: 'fantasy-default' }),
    );

    const future = new CombatThemeLoader({
      read: async (themeId) => ({ ...manifest(themeId, 'fantasy'), version: 2 }),
    });
    await expect(future.load('fantasy-default')).rejects.toEqual(
      expect.objectContaining({ code: 'COMBAT_THEME_MANIFEST_UNSUPPORTED', path: 'version' }),
    );

    const resolver = new CombatThemeResolver(
      new CombatThemeLoader({ read: async (themeId) => manifest(themeId, 'base') }),
    );
    await expect(resolver.resolve('UNKNOWN' as CombatWorldType)).rejects.toEqual(
      expect.objectContaining({ code: 'WORLD_TYPE_UNSUPPORTED', subject: 'UNKNOWN' }),
    );
  });
});

function manifest(
  themeId: string,
  layoutPreset: CombatThemeManifest['layoutPreset'],
): CombatThemeManifest {
  return {
    version: 1,
    themeId,
    layoutPreset,
    fallbackThemeId: 'base',
    assets: { THEME_BG_BATTLE_01: 'assets/backgrounds/battle-background-01.png' },
  };
}
