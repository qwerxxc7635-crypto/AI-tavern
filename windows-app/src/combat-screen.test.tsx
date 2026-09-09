// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BattleStage, CombatScreen, CombatantView, TurnTimeline } from './combat-screen.js';
import type { CombatScreenShellViewModel, CombatantStageViewModel } from './combat-screen.js';

afterEach(cleanup);

describe('CombatScreen shell', () => {
  it('renders the authoritative timeline in supplied order and marks exactly the current slot', () => {
    render(<CombatScreen viewModel={viewModel()} />);

    const timeline = screen.getByRole('navigation', { name: '行动顺序' });
    const entries = within(timeline).getAllByRole('listitem');
    expect(entries.map((entry) => entry.getAttribute('data-combatant-id'))).toEqual([
      'enemy-b',
      'hero',
      'enemy-a',
    ]);
    expect(entries.filter((entry) => entry.getAttribute('aria-current') === 'step')).toHaveLength(
      1,
    );
    expect(entries[1]?.getAttribute('aria-current')).toBe('step');
    expect(within(entries[2] as HTMLElement).getByText('额外回合')).toBeTruthy();
  });

  it('groups stage cards only by the projected side and exposes semantic team regions', () => {
    render(<CombatScreen viewModel={viewModel()} />);

    const party = screen.getByRole('region', { name: '我方队伍' });
    const hostiles = screen.getByRole('region', { name: '敌方队伍' });
    expect(within(party).getByRole('article', { name: '旅者，我方主角，可行动' })).toBeTruthy();
    expect(within(hostiles).getAllByRole('article')).toHaveLength(2);
    expect(screen.queryByRole('region', { name: '中立单位' })).toBeNull();
    expect(screen.getByText('轮到：旅者')).toBeTruthy();
  });

  it('renders neutral units in a own optional group without adding combat controls', () => {
    const neutral: CombatantStageViewModel = {
      combatantId: 'observer',
      displayNameZhCn: '见证者',
      side: 'NEUTRAL',
      sideLabelZhCn: '中立',
      stateLabelZhCn: '可行动',
      isActiveTurn: false,
    };
    const model = viewModel();
    render(<CombatScreen viewModel={{ ...model, combatants: [...model.combatants, neutral] }} />);

    expect(
      within(screen.getByRole('region', { name: '中立单位' })).getByText('见证者'),
    ).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('updates from a replacement view model without retaining local timeline or active state', () => {
    const first = viewModel();
    const rendered = render(<CombatScreen viewModel={first} />);
    const next: CombatScreenShellViewModel = {
      ...first,
      stateRevision: 9,
      activeCombatantId: 'enemy-a',
      timeline: [
        { ...requiredAt(first.timeline, 2), isCurrent: true },
        { ...requiredAt(first.timeline, 1), isCurrent: false },
      ],
      combatants: first.combatants.map((combatant) => ({
        ...combatant,
        isActiveTurn: combatant.combatantId === 'enemy-a',
      })),
    };
    rendered.rerender(<CombatScreen viewModel={next} />);

    const timeline = screen.getByRole('navigation', { name: '行动顺序' });
    expect(
      within(timeline)
        .getAllByRole('listitem')
        .map((entry) => entry.getAttribute('data-combatant-id')),
    ).toEqual(['enemy-a', 'hero']);
    expect(screen.getByText('轮到：暮影')).toBeTruthy();
    expect(screen.getByRole('main').getAttribute('data-state-revision')).toBe('9');
  });

  it('keeps timeline, stage, and combatant primitives independently reusable', () => {
    const model = viewModel();
    const view = render(<TurnTimeline entries={model.timeline} />);
    expect(screen.getByRole('navigation', { name: '行动顺序' })).toBeTruthy();
    const hero = requiredAt(model.combatants, 1);
    view.rerender(<BattleStage party={[hero]} hostiles={[]} neutral={[]} />);
    expect(screen.getByRole('region', { name: '战斗场景' })).toBeTruthy();
    view.rerender(<CombatantView combatant={hero} />);
    expect(screen.getByRole('article', { name: '旅者，我方主角，可行动' })).toBeTruthy();
  });
});

function viewModel(): CombatScreenShellViewModel {
  return {
    combatInstanceId: 'combat-ui-shell',
    stateRevision: 8,
    phaseLabelZhCn: '行动阶段',
    roundLabelZhCn: '第 2 轮',
    activeCombatantId: 'hero',
    timeline: [
      {
        combatantId: 'enemy-b',
        displayNameZhCn: '灰烬守卫',
        isExtraTurn: false,
        isCurrent: false,
      },
      {
        combatantId: 'hero',
        displayNameZhCn: '旅者',
        isExtraTurn: false,
        isCurrent: true,
      },
      {
        combatantId: 'enemy-a',
        displayNameZhCn: '暮影',
        isExtraTurn: true,
        isCurrent: false,
      },
    ],
    combatants: [
      {
        combatantId: 'enemy-b',
        displayNameZhCn: '灰烬守卫',
        side: 'HOSTILE',
        sideLabelZhCn: '敌方',
        stateLabelZhCn: '可行动',
        isActiveTurn: false,
      },
      {
        combatantId: 'hero',
        displayNameZhCn: '旅者',
        side: 'PLAYER',
        sideLabelZhCn: '我方主角',
        stateLabelZhCn: '可行动',
        isActiveTurn: true,
      },
      {
        combatantId: 'enemy-a',
        displayNameZhCn: '暮影',
        side: 'HOSTILE',
        sideLabelZhCn: '敌方',
        stateLabelZhCn: '倒地',
        isActiveTurn: false,
      },
    ],
  };
}

function requiredAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`Missing fixture index ${String(index)}`);
  return value;
}
