// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CURRENT_COMBAT_VERSION_SET, type CombatCommandEnvelope } from '@ember-tavern/contracts';

import { CombatPage } from './combat-page.js';
import type { CombatSessionGateway, CombatSessionSnapshot, CombatWorld } from './combat-service.js';
import type { CombatScreenShellViewModel } from './combat-screen.js';
import { readPublicThemeManifest } from './combat-theme-asset-test-helpers.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('combat production page', () => {
  it('loads a durable session, submits the reaction envelope, commits the result, and returns', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'ui-command-1' });
    vi.stubGlobal('fetch', async (url: string) => ({
      ok:
        url === '/assets/combat-themes/fantasy-default/manifest.json' ||
        url === '/assets/combat-themes/common/manifest.json',
      json: async () =>
        url === '/assets/combat-themes/common/manifest.json'
          ? {
              assets: {
                COMBAT_VFX_HIT_PHYSICAL: 'effects/hit-physical.png',
              },
            }
          : readPublicThemeManifest('fantasy-default'),
    }));
    const gateway = new FakeCombatGateway();
    render(
      <MemoryRouter initialEntries={['/combat?campaignId=campaign-ui&world=FANTASY']}>
        <Routes>
          <Route path="combat" element={<CombatPage gateway={gateway} />} />
          <Route path="tavern" element={<h1>酒馆已恢复</h1>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('complementary', { name: '旅者的反应选择' })).toBeTruthy();
    const combatScreen = screen.getByRole('main', { name: '战斗界面' });
    expect(combatScreen.getAttribute('data-combat-theme')).toBe('fantasy-default');
    expect(combatScreen.getAttribute('data-layout-preset')).toBe('fantasy');
    expect(combatScreen.style.getPropertyValue('--combat-asset-theme-bg-battle-01')).toContain(
      '/assets/combat-themes/fantasy-default/assets/backgrounds/battle-background-01.png',
    );
    expect(combatScreen.style.getPropertyValue('--combat-asset-combat-vfx-hit-physical')).toContain(
      '/assets/combat-themes/common/effects/hit-physical.png',
    );
    fireEvent.click(screen.getByRole('button', { name: '发动' }));

    expect(await screen.findByText('胜利')).toBeTruthy();
    expect(gateway.commands).toHaveLength(1);
    expect(gateway.commands[0]?.payload).toEqual({
      kind: 'RESOLVE_REACTION',
      reactionWindowId: 'window-1',
      choice: 'TRIGGER',
      selectedReactionId: 'reaction.guard',
    });

    fireEvent.click(screen.getByRole('button', { name: '返回酒馆' }));
    await waitFor(() => expect(gateway.completions).toEqual(['campaign-ui:FANTASY']));
    expect(await screen.findByRole('heading', { name: '酒馆已恢复' })).toBeTruthy();
  });

  it('rejects a combat route without an explicit supported world', () => {
    render(
      <MemoryRouter initialEntries={['/combat?campaignId=campaign-ui&world=UNKNOWN']}>
        <CombatPage gateway={new FakeCombatGateway()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert').textContent).toContain('缺少存档或世界类型');
  });
});

class FakeCombatGateway implements CombatSessionGateway {
  readonly commands: CombatCommandEnvelope[] = [];
  readonly completions: string[] = [];

  async start(campaignId: string, world: CombatWorld): Promise<CombatSessionSnapshot> {
    return snapshot(campaignId, world, false);
  }

  async submit(
    campaignId: string,
    world: CombatWorld,
    command: CombatCommandEnvelope,
  ): Promise<CombatSessionSnapshot> {
    this.commands.push(command);
    return snapshot(campaignId, world, true);
  }

  async complete(campaignId: string, world: CombatWorld): Promise<void> {
    this.completions.push(`${campaignId}:${world}`);
  }
}

function snapshot(
  campaignId: string,
  world: CombatWorld,
  finished: boolean,
): CombatSessionSnapshot {
  return {
    campaignId,
    world,
    persistenceRevision: finished ? 2 : 1,
    viewModel: viewModel(finished),
  };
}

function viewModel(finished: boolean): CombatScreenShellViewModel {
  return {
    combatInstanceId: 'combat-campaign-ui-fantasy',
    versions: CURRENT_COMBAT_VERSION_SET,
    stateRevision: finished ? 2 : 1,
    phaseLabelZhCn: '行动',
    roundLabelZhCn: '第 1 轮',
    activeCombatantId: null,
    timeline: [],
    combatants: [],
    enemyIntents: [],
    actions: [],
    reactionModes: [
      {
        reactionId: 'reaction.guard',
        displayNameZhCn: '奥术屏障',
        mode: 'ASK',
        modeLabelZhCn: '询问',
      },
    ],
    pendingReaction: finished
      ? null
      : {
          reactionWindowId: 'window-1',
          actorId: 'hero',
          actorNameZhCn: '旅者',
          options: [
            {
              reactionId: 'reaction.guard',
              displayNameZhCn: '奥术屏障',
              mode: 'ASK',
              modeLabelZhCn: '询问',
              costSummaryZhCn: '消耗 1 次反应',
              effectSummaryZhCn: '化解威胁',
            },
          ],
        },
    tacticalSettings: [],
    combatLog: [],
    result: finished
      ? {
          kind: 'VICTORY',
          titleZhCn: '胜利',
          detailZhCn: '敌方已失去战斗能力。',
          isSafeAbort: false,
        }
      : null,
  };
}
