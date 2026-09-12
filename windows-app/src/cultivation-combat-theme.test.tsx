// @vitest-environment jsdom

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CURRENT_COMBAT_VERSION_SET, parseCombatThemeManifest } from '@ember-tavern/contracts';

import { CombatScreen } from './combat-screen.js';
import type { CombatScreenShellViewModel } from './combat-screen.js';
import { bindCombatThemePackage } from './combat-theme-binding.js';
import { BASE_COMBAT_THEME_MANIFEST, CombatThemeAssetResolver } from './combat-theme-fallback.js';
import { CombatThemeLoader } from './combat-theme-service.js';
import type { CombatThemePackage } from './combat-theme-service.js';
import {
  CULTIVATION_COMBAT_THEME_MANIFEST,
  CULTIVATION_REQUIRED_ASSET_SLOTS,
} from './cultivation-combat-theme.js';

afterEach(cleanup);

const themeRoot = resolve(
  process.cwd(),
  'windows-app/public/assets/combat-themes/cultivation-default',
);

describe('Cultivation Combat Theme integration', () => {
  it('keeps the public runtime manifest identical to the validated in-code package', () => {
    const publicManifest = parseCombatThemeManifest(
      JSON.parse(readFileSync(resolve(themeRoot, 'manifest.json'), 'utf8')) as unknown,
    );
    expect(publicManifest).toEqual(CULTIVATION_COMBAT_THEME_MANIFEST);
    expect(CULTIVATION_REQUIRED_ASSET_SLOTS).toHaveLength(27);
  });

  it('ships every declared FINAL slot as a transparent RGBA PNG', () => {
    for (const [slot, relativePath] of Object.entries(CULTIVATION_COMBAT_THEME_MANIFEST.assets)) {
      const png = readFileSync(resolve(themeRoot, relativePath));
      expect(png.subarray(0, 8).toString('hex'), slot).toBe('89504e470d0a1a0a');
      expect(png.readUInt8(25), slot).toBe(6);
      expect(png.readUInt32BE(16), slot).toBeGreaterThan(0);
      expect(png.readUInt32BE(20), slot).toBeGreaterThan(0);
    }
  });

  it.each([
    [
      'THEME_ABILITY_SLOT_HOVER',
      '7f97d9f0099d7cf81c8f868985312205fdf21196ca1779866d82a405e94f8122',
    ],
    [
      'THEME_ABILITY_SLOT_SELECTED',
      '72badca159a9dc37d45b74584a2792eef4b88aec0f64ef5a6428d658bd905264',
    ],
    [
      'THEME_ABILITY_SLOT_DISABLED',
      '45e0f8e552392929fc5adb784b6151b4113c3fce87794459a8abaff7f36508fe',
    ],
    [
      'THEME_BUTTON_ENDTURN_HOVER',
      '85e337b84cdc2ec5ef1a4ba9abd6d702330333f47fed158b86cca0edd126b1c2',
    ],
    [
      'THEME_BUTTON_ENDTURN_PRESSED',
      '02fb4f2d8a692265f2eea973d5c9b73703cc38c89096a108135147737fb9d128',
    ],
    ['THEME_AP_NODE_EMPTY', 'f9720cb9f18079de6f94d877cd4f576a06292159b06b6290f64adbd6e1b40d5a'],
    ['CULTIVATION_FX_SHIELD', 'cd2dbdb7ec0db1e83ab21e0ff35e1218a3c8f07da4f9295e6897894e53e6c7cd'],
  ] as const)('matches the FINAL digest for %s', (slot, expectedDigest) => {
    const path = CULTIVATION_COMBAT_THEME_MANIFEST.assets[slot];
    if (path === undefined) throw new Error(`Missing test slot ${slot}`);
    const digest = createHash('sha256')
      .update(readFileSync(resolve(themeRoot, path)))
      .digest('hex');
    expect(digest).toBe(expectedDigest);
  });

  it('binds all 27 assets to one semantic CombatScreen without changing its API', async () => {
    const themePackage: CombatThemePackage = {
      themeId: 'cultivation-default',
      layoutPreset: 'cultivation',
      manifest: CULTIVATION_COMBAT_THEME_MANIFEST,
      selection: 'WORLD_DEFAULT',
    };
    const manifests = new Map([
      ['cultivation-default', CULTIVATION_COMBAT_THEME_MANIFEST],
      ['base', BASE_COMBAT_THEME_MANIFEST],
    ]);
    const binding = await bindCombatThemePackage(
      themePackage,
      new CombatThemeAssetResolver(
        new CombatThemeLoader({
          read: async (themeId) => manifests.get(themeId),
        }),
      ),
      CULTIVATION_REQUIRED_ASSET_SLOTS,
    );

    expect(binding.warnings).toEqual([]);
    expect(Object.keys(binding.cssVariables)).toHaveLength(27);
    expect(binding.cssVariables['--combat-asset-theme-bg-battle-01']).toBe(
      'url("/assets/combat-themes/cultivation-default/assets/backgrounds/battle-background-01.png")',
    );
    expect(binding.cssVariables['--combat-asset-cultivation-fx-shield']).toContain(
      '/effects/fx-shield.png',
    );
    expect(binding.cssVariables['--combat-asset-theme-timeline-frame-boss']).toContain(
      '/timeline/timeline-frame-boss.png',
    );

    render(
      <CombatScreen
        viewModel={emptyViewModel()}
        commandPort={{
          createCommand: () => {
            throw new Error('No command should be created');
          },
          submitCommand: () => undefined,
          onAbilitySelected: () => undefined,
        }}
        theme={binding}
      />,
    );
    const combatScreen = screen.getByRole('main', { name: '战斗界面' });
    expect(combatScreen.getAttribute('data-combat-theme')).toBe('cultivation-default');
    expect(combatScreen.getAttribute('data-layout-preset')).toBe('cultivation');
    expect(combatScreen.style.getPropertyValue('--combat-asset-theme-bg-battle-01')).toContain(
      'cultivation-default',
    );
    expect(screen.getByRole('navigation', { name: '行动顺序' })).toBeTruthy();
  });
});

function emptyViewModel(): CombatScreenShellViewModel {
  return {
    combatInstanceId: 'theme-preview',
    versions: CURRENT_COMBAT_VERSION_SET,
    stateRevision: 1,
    phaseLabelZhCn: '等待行动',
    roundLabelZhCn: '第 1 轮',
    activeCombatantId: null,
    timeline: [],
    combatants: [],
    enemyIntents: [],
    actions: [],
    reactionModes: [],
    pendingReaction: null,
    tacticalSettings: [],
    combatLog: [],
    result: null,
  };
}
