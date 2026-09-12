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
    fireEvent.click(screen.getByRole('button', { name: '余烬斩' }));
    expect(screen.getByRole('button', { name: '选择灰烬守卫作为余烬斩的目标' })).toBeTruthy();
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
    expect(screen.queryByRole('button', { name: /作为余烬斩的目标/ })).toBeNull();
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

  it('highlights only projected legal targets and submits the selected target as UseAbility', () => {
    const port = commandPort();
    render(<CombatScreen viewModel={viewModel()} commandPort={port} />);

    fireEvent.click(screen.getByRole('button', { name: '余烬斩' }));
    const target = screen.getByRole('button', { name: '选择灰烬守卫作为余烬斩的目标' });
    expect(screen.queryByRole('button', { name: /选择旅者作为余烬斩/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /选择暮影作为余烬斩/ })).toBeNull();
    expect(target.closest('[data-combatant-id]')?.getAttribute('data-target-state')).toBe('legal');

    fireEvent.click(target);
    expect(port.createCommand).toHaveBeenCalledWith({
      kind: 'USE_ABILITY',
      abilityId: 'ability.ember-slash',
      targetId: 'enemy-b',
    });
    expect(port.submitCommand.mock.calls[0]?.[0]?.payload).toEqual({
      kind: 'USE_ABILITY',
      abilityId: 'ability.ember-slash',
      targetId: 'enemy-b',
    });
    expect(screen.queryByText('正在为“余烬斩”选择目标')).toBeNull();
  });

  it('uses projected target IDs without inferring side or defeated state in React', () => {
    const model = viewModel();
    const action = requiredAt(model.actions, 0);
    render(
      <CombatScreen
        viewModel={{
          ...model,
          actions: [{ ...action, legalTargetIds: ['hero', 'enemy-a'] }, ...model.actions.slice(1)],
        }}
        commandPort={commandPort()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '余烬斩' }));
    expect(screen.getByRole('button', { name: '选择旅者作为余烬斩的目标' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '选择暮影作为余烬斩的目标' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /选择灰烬守卫作为余烬斩/ })).toBeNull();
  });

  it('cancels target selection explicitly, with Escape, and by clicking the empty stage', () => {
    const port = commandPort();
    render(<CombatScreen viewModel={viewModel()} commandPort={port} />);
    const ability = screen.getByRole('button', { name: '余烬斩' });

    fireEvent.click(ability);
    fireEvent.click(screen.getByRole('button', { name: '取消选取' }));
    expect(screen.queryByRole('button', { name: /作为余烬斩的目标/ })).toBeNull();

    fireEvent.click(ability);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: /作为余烬斩的目标/ })).toBeNull();

    fireEvent.click(ability);
    fireEvent.click(screen.getByRole('region', { name: '战斗场景' }));
    expect(screen.queryByRole('button', { name: /作为余烬斩的目标/ })).toBeNull();
    expect(port.submitCommand).not.toHaveBeenCalled();
  });

  it('submits a targetless projected ability with a null target immediately', () => {
    const model = viewModel();
    const action = requiredAt(model.actions, 0);
    const port = commandPort();
    render(
      <CombatScreen
        viewModel={{
          ...model,
          actions: [
            {
              ...action,
              actionId: 'ability.focus-self',
              displayNameZhCn: '凝神',
              requiresTarget: false,
              legalTargetIds: [],
              tooltip: tooltip('ability.focus-self', '收束思绪，让呼吸与战机合一。'),
            },
            ...model.actions.slice(1),
          ],
        }}
        commandPort={port}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '凝神' }));
    expect(port.submitCommand.mock.calls[0]?.[0]?.payload).toEqual({
      kind: 'USE_ABILITY',
      abilityId: 'ability.focus-self',
      targetId: null,
    });
    expect(screen.queryByRole('button', { name: /作为凝神的目标/ })).toBeNull();
  });

  it('shows the composed flavor, mechanical tooltip, and cost preview on hover and focus', () => {
    render(<CombatScreen viewModel={viewModel()} commandPort={commandPort()} />);
    const ability = screen.getByRole('button', { name: '余烬斩' });
    const slot = ability.closest('.ability-slot') as HTMLElement;
    const hiddenTooltip = within(slot).getByRole('tooltip', { hidden: true });
    expect(hiddenTooltip.hasAttribute('hidden')).toBe(true);

    fireEvent.mouseEnter(slot);
    const hoveredTooltip = within(slot).getByRole('tooltip');
    expect(within(hoveredTooltip).getByText('余烬沿刃口迸发，照亮短暂战机。')).toBeTruthy();
    expect(within(hoveredTooltip).getByRole('region', { name: '消耗预览' })).toBeTruthy();
    expect(within(hoveredTooltip).getByText('行动点：2 → 1')).toBeTruthy();
    expect(within(hoveredTooltip).getByText('法力：6 → 4')).toBeTruthy();
    expect(within(hoveredTooltip).getByRole('region', { name: '技能规则' })).toBeTruthy();
    expect(within(hoveredTooltip).getByText('伤害：物理（8）')).toBeTruthy();

    fireEvent.mouseLeave(slot);
    expect(hiddenTooltip.hasAttribute('hidden')).toBe(true);
    fireEvent.focus(ability);
    expect(hiddenTooltip.hasAttribute('hidden')).toBe(false);
    fireEvent.blur(ability);
    expect(hiddenTooltip.hasAttribute('hidden')).toBe(true);
  });

  it('keeps the tooltip open while selected and renders projected Heat transition state', () => {
    const model = viewModel();
    const action = requiredAt(model.actions, 0);
    render(
      <CombatScreen
        viewModel={{
          ...model,
          actions: [
            {
              ...action,
              costPreview: {
                ...costPreview(),
                resources: [
                  {
                    resourceId: 'heat',
                    labelZhCn: '热量',
                    before: 70,
                    after: 85,
                    overheatThreshold: 80,
                    isOverheatedBefore: false,
                    isOverheatedAfter: true,
                    textZhCn: '热量：70 → 85',
                  },
                ],
              },
            },
            ...model.actions.slice(1),
          ],
        }}
        commandPort={commandPort()}
      />,
    );

    const ability = screen.getByRole('button', { name: '余烬斩' });
    fireEvent.click(ability);
    fireEvent.blur(ability);
    const tooltipPanel = within(ability.closest('.ability-slot') as HTMLElement).getByRole(
      'tooltip',
    );
    expect(within(tooltipPanel).getByText('热量：70 → 85（过热阈值 80，使用后过热）')).toBeTruthy();
    expect(
      within(tooltipPanel)
        .getByText(/热量：70/)
        .closest('li')
        ?.getAttribute('data-overheated-after'),
    ).toBe('true');
  });

  it('preserves long dynamic flavor and mechanical text inside the bounded tooltip panel', () => {
    const model = viewModel();
    const action = requiredAt(model.actions, 0);
    const longFlavor = `传承记述：${'余烬流转，星火不息。'.repeat(20)}`;
    const longMechanical = `特殊效果：${'按规则顺序结算。'.repeat(24)}`;
    const baseTooltip = tooltip(action.actionId, longFlavor);
    render(
      <CombatScreen
        viewModel={{
          ...model,
          actions: [
            {
              ...action,
              tooltip: {
                ...baseTooltip,
                mechanics: {
                  ...baseTooltip.mechanics,
                  lines: [
                    ...baseTooltip.mechanics.lines,
                    { kind: 'EFFECT', sourceIds: ['effect.long'], text: longMechanical },
                  ],
                },
              },
            },
            ...model.actions.slice(1),
          ],
        }}
        commandPort={commandPort()}
      />,
    );

    const slot = screen.getByRole('button', { name: '余烬斩' }).closest('.ability-slot');
    if (!(slot instanceof HTMLElement)) throw new Error('Missing ability slot');
    fireEvent.mouseEnter(slot);
    const tooltipPanel = within(slot).getByRole('tooltip');
    expect(within(tooltipPanel).getByText(longFlavor).textContent).toBe(longFlavor);
    expect(within(tooltipPanel).getByText(longMechanical).textContent).toBe(longMechanical);
  });

  it('shows Auto, Ask, and Disabled reaction modes with required Chinese labels', () => {
    render(<CombatScreen viewModel={viewModel()} commandPort={commandPort()} />);
    const modes = screen.getByRole('region', { name: '反应模式' });
    expect(within(modes).getByText('自动')).toBeTruthy();
    expect(within(modes).getByText('询问')).toBeTruthy();
    expect(within(modes).getByText('禁用')).toBeTruthy();
    expect(modes.querySelector('[data-reaction-mode="AUTO"]')?.textContent).toContain('迅捷格挡');
  });

  it('submits one structured trigger decision and blocks repeated UI submission', () => {
    const port = commandPort();
    render(
      <CombatScreen
        viewModel={{ ...viewModel(), pendingReaction: pendingReaction() }}
        commandPort={port}
      />,
    );

    const prompt = screen.getByLabelText('旅者的反应选择');
    expect(within(prompt).getByText('模式：询问')).toBeTruthy();
    expect(within(prompt).getByText('消耗 15 法力')).toBeTruthy();
    const trigger = within(prompt).getByRole('button', { name: '发动' });
    fireEvent.click(trigger);
    fireEvent.click(trigger);

    expect(port.createCommand).toHaveBeenCalledTimes(1);
    expect(port.submitCommand).toHaveBeenCalledTimes(1);
    expect(port.submitCommand.mock.calls[0]?.[0]?.payload).toEqual({
      kind: 'RESOLVE_REACTION',
      reactionWindowId: 'reaction-window-1',
      choice: 'TRIGGER',
      selectedReactionId: 'reaction.spirit-shield',
    });
    expect(prompt.getAttribute('aria-busy')).toBe('true');
    expect(within(prompt).getByText('正在处理反应决定')).toBeTruthy();
  });

  it('submits Skip and does not reopen after the authoritative pending window clears', () => {
    const model = { ...viewModel(), pendingReaction: pendingReaction() };
    const port = commandPort();
    const rendered = render(<CombatScreen viewModel={model} commandPort={port} />);
    fireEvent.click(screen.getByRole('button', { name: '跳过' }));
    expect(port.submitCommand.mock.calls[0]?.[0]?.payload).toEqual({
      kind: 'RESOLVE_REACTION',
      reactionWindowId: 'reaction-window-1',
      choice: 'SKIP',
      selectedReactionId: null,
    });

    rendered.rerender(
      <CombatScreen
        viewModel={{ ...model, stateRevision: model.stateRevision + 1, pendingReaction: null }}
        commandPort={port}
      />,
    );
    expect(screen.queryByLabelText('旅者的反应选择')).toBeNull();
    expect(port.submitCommand).toHaveBeenCalledTimes(1);
  });

  it('restores an unresolved ReactionPrompt after the UI is closed and reopened', () => {
    const model = { ...viewModel(), pendingReaction: pendingReaction() };
    const first = render(<CombatScreen viewModel={model} commandPort={commandPort()} />);
    expect(screen.getByLabelText('旅者的反应选择')).toBeTruthy();
    first.unmount();

    render(<CombatScreen viewModel={model} commandPort={commandPort()} />);
    const restored = screen.getByLabelText('旅者的反应选择');
    expect(restored.getAttribute('data-reaction-window-id')).toBe('reaction-window-1');
    expect(within(restored).getByRole('button', { name: '发动' })).toBeTruthy();
  });

  it('submits every tactical strategy and preference as Commands without optimistic mutation', () => {
    const model = viewModel();
    const companion: CombatantStageViewModel = {
      combatantId: 'companion-mira',
      displayNameZhCn: '米拉',
      side: 'COMPANION',
      sideLabelZhCn: '我方队友',
      stateLabelZhCn: '可行动',
      isActiveTurn: false,
      ...hud(),
    };
    const port = commandPort();
    render(
      <CombatScreen
        viewModel={{
          ...model,
          combatants: [...model.combatants, companion],
          tacticalSettings: [tacticalSettings()],
        }}
        commandPort={port}
      />,
    );

    const strategy = screen.getByRole('combobox', { name: '米拉的基础策略' });
    fireEvent.change(strategy, { target: { value: 'SUPPORT' } });
    fireEvent.change(screen.getByRole('combobox', { name: '米拉的治疗阈值' }), {
      target: { value: '70' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '米拉的终极技能' }), {
      target: { value: 'HOLD' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '米拉的消耗品' }), {
      target: { value: 'DISABLED' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '米拉的保护主角' }), {
      target: { value: 'HIGH' },
    });

    expect(port.createCommand.mock.calls.map((call) => call[0])).toEqual([
      { kind: 'SET_TACTICAL_STRATEGY', companionId: 'companion-mira', strategyId: 'SUPPORT' },
      {
        kind: 'SET_TACTICAL_PREFERENCE',
        companionId: 'companion-mira',
        preferenceKey: 'healingThreshold',
        structuredValue: { valueType: 'INTEGER', value: 70 },
      },
      {
        kind: 'SET_TACTICAL_PREFERENCE',
        companionId: 'companion-mira',
        preferenceKey: 'ultimatePolicy',
        structuredValue: { valueType: 'STABLE_ID', value: 'HOLD' },
      },
      {
        kind: 'SET_TACTICAL_PREFERENCE',
        companionId: 'companion-mira',
        preferenceKey: 'consumablePolicy',
        structuredValue: { valueType: 'STABLE_ID', value: 'DISABLED' },
      },
      {
        kind: 'SET_TACTICAL_PREFERENCE',
        companionId: 'companion-mira',
        preferenceKey: 'protectMainCharacter',
        structuredValue: { valueType: 'STABLE_ID', value: 'HIGH' },
      },
    ]);
    expect(port.submitCommand).toHaveBeenCalledTimes(5);
    expect((strategy as HTMLSelectElement).value).toBe('BALANCED');
    expect(screen.getByText('使用默认设置')).toBeTruthy();
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
        requiresTarget: true,
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
        costPreview: costPreview(),
        tooltip: tooltip('ability.ember-slash', '余烬沿刃口迸发，照亮短暂战机。'),
      },
      {
        actionId: 'ability.spark-shock',
        displayNameZhCn: '星火震荡',
        kind: 'ABILITY',
        requiresTarget: true,
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
        costPreview: costPreview(),
        tooltip: tooltip('ability.spark-shock', '星火震荡空气，压制近处的威胁。'),
      },
      {
        actionId: 'command.end-turn',
        displayNameZhCn: '结束回合',
        kind: 'END_TURN',
        requiresTarget: false,
        enabled: true,
        legalTargetIds: [],
        disabledReasonsZhCn: [],
        abilityUsage: null,
        costPreview: null,
        tooltip: null,
      },
    ],
    reactionModes: [
      {
        reactionId: 'reaction.quick-guard',
        displayNameZhCn: '迅捷格挡',
        mode: 'AUTO',
        modeLabelZhCn: '自动',
      },
      {
        reactionId: 'reaction.spirit-shield',
        displayNameZhCn: '灵力护盾',
        mode: 'ASK',
        modeLabelZhCn: '询问',
      },
      {
        reactionId: 'reaction.risky-counter',
        displayNameZhCn: '冒险反击',
        mode: 'DISABLED',
        modeLabelZhCn: '禁用',
      },
    ],
    pendingReaction: null,
    tacticalSettings: [],
  };
}

function costPreview() {
  return {
    actionPoints: { before: 2, after: 1, textZhCn: '行动点：2 → 1' },
    resources: [
      {
        resourceId: 'mana',
        labelZhCn: '法力',
        before: 6,
        after: 4,
        overheatThreshold: null,
        isOverheatedBefore: false,
        isOverheatedAfter: false,
        textZhCn: '法力：6 → 4',
      },
    ],
  } as const;
}

function tooltip(abilityId: string, flavorDescription: string) {
  return {
    flavor: {
      displayName: '余烬战技',
      flavorDescription,
      lore: '守火人世代相传的战斗技艺。',
    },
    mechanics: {
      abilityId,
      lines: [
        { kind: 'ACTION_POINT', sourceIds: [], text: '行动点：1' },
        { kind: 'DAMAGE', sourceIds: ['physical'], text: '伤害：物理（8）' },
        { kind: 'TARGET', sourceIds: ['enemy'], text: '目标：单个合法目标' },
      ],
    },
  } as const;
}

function pendingReaction() {
  return {
    reactionWindowId: 'reaction-window-1',
    actorId: 'hero',
    actorNameZhCn: '旅者',
    options: [
      {
        reactionId: 'reaction.spirit-shield',
        displayNameZhCn: '灵力护盾',
        costSummaryZhCn: '消耗 15 法力',
        effectSummaryZhCn: '减少本次伤害 40%',
        mode: 'ASK',
        modeLabelZhCn: '询问',
      },
    ],
  } as const;
}

function tacticalSettings() {
  return {
    companionId: 'companion-mira',
    displayNameZhCn: '米拉',
    strategy: 'BALANCED',
    strategyLabelZhCn: '均衡',
    healingThresholdPercent: 50,
    ultimatePolicy: 'ELITE_BOSS_PRIORITY',
    ultimatePolicyLabelZhCn: '精英与首领优先',
    consumablePolicy: 'EMERGENCY_ONLY',
    consumablePolicyLabelZhCn: '仅紧急时',
    protectMainCharacter: 'NORMAL',
    protectMainCharacterLabelZhCn: '普通',
    lastAppliedSequence: 0,
  } as const;
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
