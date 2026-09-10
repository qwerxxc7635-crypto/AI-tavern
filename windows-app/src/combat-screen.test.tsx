// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CURRENT_COMBAT_VERSION_SET, parseCombatCommandEnvelope } from '@ember-tavern/contracts';
import type { CombatCommandPayload } from '@ember-tavern/contracts';

import {
  BattleStage,
  CharacterHUD,
  CombatScreen,
  CombatantView,
  ResourceHUD,
  StatusStrip,
  TurnTimeline,
} from './combat-screen.js';
import type {
  CombatResourceViewModel,
  CombatScreenShellViewModel,
  CombatantStageViewModel,
} from './combat-screen.js';

afterEach(cleanup);

describe('CombatScreen shell', () => {
  it('renders the authoritative timeline in supplied order and marks exactly the current slot', () => {
    render(<CombatScreen viewModel={viewModel()} commandPort={commandPort()} />);

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
    render(<CombatScreen viewModel={viewModel()} commandPort={commandPort()} />);

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
      ...hud(),
    };
    const model = viewModel();
    render(
      <CombatScreen
        viewModel={{ ...model, combatants: [...model.combatants, neutral] }}
        commandPort={commandPort()}
      />,
    );

    expect(
      within(screen.getByRole('region', { name: '中立单位' })).getByText('见证者'),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: '中立单位' })).queryAllByRole('button'),
    ).toHaveLength(0);
  });

  it('updates from a replacement view model without retaining local timeline or active state', () => {
    const first = viewModel();
    const port = commandPort();
    const rendered = render(<CombatScreen viewModel={first} commandPort={port} />);
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
    rendered.rerender(<CombatScreen viewModel={next} commandPort={port} />);

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

  it('renders exact active-character meters, AP, reaction, resources, and statuses', () => {
    render(<CombatScreen viewModel={viewModel()} commandPort={commandPort()} />);

    const panel = screen.getByRole('region', { name: '旅者的战斗状态' });
    expect(
      within(panel).getByRole('meter', { name: '生命：30/40' }).getAttribute('aria-valuenow'),
    ).toBe('30');
    expect(within(panel).getByRole('meter', { name: '护盾：4/10' })).toBeTruthy();
    expect(within(panel).getByLabelText('行动点：2/3').getAttribute('data-current')).toBe('2');
    expect(within(panel).getByLabelText('反应次数：1/1')).toBeTruthy();
    expect(within(panel).getByText('法力：6/10')).toBeTruthy();
    expect(within(panel).getByText('燃烧')).toBeTruthy();
    expect(within(panel).getByText('2 层')).toBeTruthy();
    expect(within(panel).getByText('剩余 1 次计时')).toBeTruthy();
  });

  it.each([
    ['西幻', ['法力', '体力']],
    ['科幻', ['能量', '热量']],
    ['修仙', ['灵力', '神识']],
    ['都市', ['体力', '专注']],
  ])('uses ViewModel-provided labels for the %s resource profile', (_profile, labels) => {
    const resources = labels.map((label, index) => resource(`resource-${String(index)}`, label));
    render(<ResourceHUD resources={resources} />);

    for (const label of labels) expect(screen.getByText(label)).toBeTruthy();
  });

  it('marks projected pressure state and handles an empty status strip', () => {
    const heat = {
      ...resource('heat', '热量'),
      current: 80,
      isOverheated: true,
      textZhCn: '热量：80/100',
    };
    const view = render(<ResourceHUD resources={[heat]} />);
    expect(screen.getByText('已过热')).toBeTruthy();
    expect(screen.getByText('过热阈值：80')).toBeTruthy();
    expect(screen.getByText('热量').closest('li')?.getAttribute('data-overheated')).toBe('true');

    view.rerender(<StatusStrip statuses={[]} />);
    expect(screen.getByText('无状态')).toBeTruthy();
  });

  it('keeps HUD components presentational and independently reusable', () => {
    const hero = requiredAt(viewModel().combatants, 1);
    render(<CharacterHUD combatant={hero} />);
    expect(screen.getByRole('region', { name: '世界资源' })).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('renders ability cooldown, usage, and disabled reasons without submitting a command', () => {
    const port = commandPort();
    render(<CombatScreen viewModel={viewModel()} commandPort={port} />);

    const ready = screen.getByRole('button', { name: '余烬斩' });
    fireEvent.click(ready);
    expect(port.onAbilitySelected).toHaveBeenCalledWith('ability.ember-slash');
    expect(port.submitCommand).not.toHaveBeenCalled();
    expect(screen.getByText('本回合 1/3')).toBeTruthy();
    expect(screen.getByText('本场 2/6')).toBeTruthy();

    const cooling = screen.getByRole('button', { name: '星火震荡' });
    expect(cooling.hasAttribute('disabled')).toBe(true);
    expect(within(cooling).getByText('冷却 2')).toBeTruthy();
    expect(screen.getByText('技能仍在冷却')).toBeTruthy();
    fireEvent.click(cooling);
    expect(port.onAbilitySelected).toHaveBeenCalledTimes(1);
  });

  it('keeps EndTurn outside ability slots and submits one structured existing command envelope', () => {
    const port = commandPort();
    render(<CombatScreen viewModel={viewModel()} commandPort={port} />);

    const endTurn = screen.getByRole('button', { name: '结束回合' });
    expect(endTurn.closest('.ability-slot')).toBeNull();
    fireEvent.click(endTurn);

    expect(port.createCommand).toHaveBeenCalledWith({ kind: 'END_TURN' });
    expect(port.submitCommand).toHaveBeenCalledTimes(1);
    const submitted = port.submitCommand.mock.calls[0]?.[0];
    expect(submitted?.payload).toEqual({ kind: 'END_TURN' });
    expect(submitted?.actorId).toBe('hero');
  });
});

function viewModel(): CombatScreenShellViewModel {
  return {
    combatInstanceId: 'combat-ui-shell',
    versions: CURRENT_COMBAT_VERSION_SET,
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
        ...hud(),
      },
      {
        combatantId: 'hero',
        displayNameZhCn: '旅者',
        side: 'PLAYER',
        sideLabelZhCn: '我方主角',
        stateLabelZhCn: '可行动',
        isActiveTurn: true,
        ...hud(),
      },
      {
        combatantId: 'enemy-a',
        displayNameZhCn: '暮影',
        side: 'HOSTILE',
        sideLabelZhCn: '敌方',
        stateLabelZhCn: '倒地',
        isActiveTurn: false,
        ...hud(),
      },
    ],
    actions: [
      {
        actionId: 'ability.ember-slash',
        displayNameZhCn: '余烬斩',
        kind: 'ABILITY',
        enabled: true,
        legalTargetIds: ['enemy-b'],
        disabledReasonsZhCn: [],
        abilityUsage: {
          cooldownRemaining: 0,
          usesThisNormalOwnerTurn: 1,
          maxUsesPerNormalOwnerTurn: 3,
          usesThisBattle: 2,
          maxUsesPerBattle: 6,
        },
      },
      {
        actionId: 'ability.spark-shock',
        displayNameZhCn: '星火震荡',
        kind: 'ABILITY',
        enabled: false,
        legalTargetIds: [],
        disabledReasonsZhCn: ['技能仍在冷却'],
        abilityUsage: {
          cooldownRemaining: 2,
          usesThisNormalOwnerTurn: 0,
          maxUsesPerNormalOwnerTurn: null,
          usesThisBattle: 1,
          maxUsesPerBattle: null,
        },
      },
      {
        actionId: 'command.end-turn',
        displayNameZhCn: '结束回合',
        kind: 'END_TURN',
        enabled: true,
        legalTargetIds: [],
        disabledReasonsZhCn: [],
        abilityUsage: null,
      },
    ],
  };
}

function requiredAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`Missing fixture index ${String(index)}`);
  return value;
}

function hud() {
  return {
    health: { current: 30, maximum: 40, textZhCn: '生命：30/40' },
    shield: { current: 4, maximum: 10, textZhCn: '护盾：4/10' },
    actionPoints: { current: 2, maximum: 3, textZhCn: '行动点：2/3' },
    reactionCharges: { current: 1, maximum: 1, textZhCn: '反应次数：1/1' },
    resources: [resource('mana', '法力')],
    statuses: [
      {
        statusInstanceId: 'status-burning-1',
        statusDefinitionId: 'status.burning',
        displayNameZhCn: '燃烧',
        stackCount: 2,
        remainingDuration: 1,
      },
    ],
  } as const;
}

function resource(resourceId: string, labelZhCn: string): CombatResourceViewModel {
  return {
    resourceId,
    labelZhCn,
    current: resourceId === 'mana' ? 6 : 5,
    minimum: 0,
    maximum: resourceId === 'heat' ? 100 : 10,
    overheatThreshold: resourceId === 'heat' ? 80 : null,
    isOverheated: false,
    textZhCn: `${labelZhCn}：${resourceId === 'mana' ? '6' : '5'}/${resourceId === 'heat' ? '100' : '10'}`,
  };
}

function commandPort() {
  let sequence = 0;
  return {
    createCommand: vi.fn((payload: CombatCommandPayload) => {
      sequence += 1;
      return parseCombatCommandEnvelope({
        commandId: `ui-command-${String(sequence)}`,
        source: { kind: 'PLAYER', controllerId: 'player-local' },
        actorId: 'hero',
        versions: CURRENT_COMBAT_VERSION_SET,
        payload,
      });
    }),
    submitCommand: vi.fn(),
    onAbilitySelected: vi.fn(),
  };
}
