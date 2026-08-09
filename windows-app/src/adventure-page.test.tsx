// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { AdventurePage } from './adventure-page.js';
import type { AdventureSnapshot, AdventureTurnObserver } from './adventure-service.js';
import type { AdventureActionMode } from '@ember-tavern/contracts';

afterEach(cleanup);

describe('adventure page', () => {
  it('renders the three ledgers and drives action and dice states', async () => {
    const service = new FakeAdventureService();
    render(
      <MemoryRouter initialEntries={['/adventure?campaignId=campaign-adventure']}>
        <AdventurePage service={service} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'The Fading Beacon' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: '角色与目标' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '剧情与行动' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: '物品线索与骰子' })).toBeTruthy();
    expect(screen.getByText('Storm')).toBeTruthy();
    expect(screen.getByText('Scorched Lens')).toBeTruthy();
    expect((screen.getByRole('radio', { name: '行动' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: '观察' }));
    expect(screen.getByPlaceholderText('描述角色要仔细观察什么…')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '对话' }));
    expect(screen.getByPlaceholderText('描述要和谁说什么，以及想达成什么…')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Study the lock.' }));
    fireEvent.click(screen.getByRole('button', { name: '提交对话' }));
    expect(await screen.findByRole('button', { name: '投掷 D20' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '投掷 D20' }));
    expect(await screen.findByText('总计 15 / 难度 11')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('最新剧情已呈现');
    expect(service.actions).toEqual([{ mode: 'DIALOGUE', text: 'Study the lock.' }]);
    expect(service.rolls).toBe(1);
  });

  it('keeps editable free input available alongside suggestions', async () => {
    const service = new FakeAdventureService();
    render(
      <MemoryRouter initialEntries={['/adventure?campaignId=campaign-adventure']}>
        <AdventurePage service={service} />
      </MemoryRouter>,
    );

    const freeInput = (await screen.findByRole('textbox', {
      name: '自由输入',
    })) as HTMLTextAreaElement;
    expect(freeInput.disabled).toBe(false);
    expect(screen.getByText(/可以忽略上方建议/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /lock|keeper|hinges/i })).toHaveLength(3);

    fireEvent.change(freeInput, {
      target: { value: 'I circle behind the rain barrel and listen at the cellar wall.' },
    });
    fireEvent.click(screen.getByRole('radio', { name: '观察' }));
    fireEvent.click(screen.getByRole('button', { name: '提交观察' }));

    expect(await screen.findByRole('button', { name: '投掷 D20' })).toBeTruthy();
    expect(service.actions).toEqual([
      {
        mode: 'OBSERVE',
        text: 'I circle behind the rain barrel and listen at the cellar wall.',
      },
    ]);
  });

  it('retains free input after a failed submission so the player can retry or edit it', async () => {
    const service = new FailingAdventureService();
    render(
      <MemoryRouter initialEntries={['/adventure?campaignId=campaign-adventure']}>
        <AdventurePage service={service} />
      </MemoryRouter>,
    );

    const freeInput = (await screen.findByRole('textbox', {
      name: '自由输入',
    })) as HTMLTextAreaElement;
    fireEvent.change(freeInput, { target: { value: 'Knock three times on the cellar wall.' } });
    fireEvent.click(screen.getByRole('button', { name: '提交行动' }));

    await waitFor(() => expect(freeInput.disabled).toBe(false));
    expect(freeInput.value).toBe('Knock three times on the cellar wall.');
    expect(screen.getByRole('status').textContent).toContain('剧情生成失败');
    expect(screen.getByRole('button', { name: '提交行动' })).toBeTruthy();
  });

  it('offers a deterministic retry when loading or pending-turn recovery fails', async () => {
    const service = new RecoveringLoadService();
    render(
      <MemoryRouter initialEntries={['/adventure?campaignId=campaign-adventure']}>
        <AdventurePage service={service} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: /冒险记录无法载入/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: '打开恢复中心' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重新载入并继续' }));

    expect(await screen.findByRole('textbox', { name: '自由输入' })).toBeTruthy();
    expect(service.loadCount).toBe(2);
  });
});

class FakeAdventureService {
  public readonly actions: { readonly mode: AdventureActionMode; readonly text: string }[] = [];
  public rolls = 0;
  private snapshot = sceneSnapshot();

  public async load() {
    return this.snapshot;
  }

  public async prepare() {
    return this.snapshot;
  }

  public async start() {
    return this.snapshot;
  }

  public async act(
    _campaignId: string,
    _adventureId: string,
    mode: AdventureActionMode,
    action: string,
    observer?: AdventureTurnObserver,
  ) {
    observer?.onSubmitted?.();
    observer?.onGenerationStarted?.();
    observer?.onValidationStarted?.();
    observer?.onResolutionStarted?.();
    this.actions.push({ mode, text: action });
    this.snapshot = {
      ...this.snapshot,
      state: 'CHECK_REQUIRED',
      currentTurnNumber: 1,
      turns: [
        {
          id: 'turn-one',
          turnNumber: 1,
          sceneText: 'Warm light leaks through the lock.',
          playerAction: action,
          actionMode: mode,
          suggestedActions: [],
          checkRequest: {
            attribute: 'knowledge',
            difficulty: 11,
            reason: 'Identify the hidden mechanism.',
          },
          diceResult: null,
          resolved: false,
        },
      ],
    };
    observer?.onCommitted?.();
    return this.snapshot;
  }

  public async resolveCheck() {
    this.rolls += 1;
    const turn = this.snapshot.turns[0];
    if (turn === undefined) throw new Error('Expected a turn before resolving a check');
    this.snapshot = {
      ...this.snapshot,
      state: 'SCENE',
      currentTurnNumber: 2,
      turns: [
        {
          ...turn,
          diceResult: { naturalRoll: 12, total: 15, difficulty: 11, success: true },
          resolved: true,
        },
        {
          id: 'turn-two',
          turnNumber: 2,
          sceneText: 'The quiet landing needs no check.',
          playerAction: 'Cross the landing.',
          actionMode: 'ACTION',
          suggestedActions: [],
          checkRequest: null,
          diceResult: null,
          resolved: true,
        },
      ],
    };
    return this.snapshot;
  }
}

class FailingAdventureService extends FakeAdventureService {
  public override async act(
    ...args: Parameters<FakeAdventureService['act']>
  ): Promise<AdventureSnapshot> {
    args[4]?.onSubmitted?.();
    args[4]?.onGenerationStarted?.();
    throw new Error('offline');
  }
}

class RecoveringLoadService extends FakeAdventureService {
  public loadCount = 0;

  public override async load(): Promise<AdventureSnapshot> {
    this.loadCount += 1;
    if (this.loadCount === 1) throw new Error('interrupted');
    return super.load();
  }
}

function sceneSnapshot(): AdventureSnapshot {
  return {
    campaignId: 'campaign-adventure',
    campaignState: 'ADVENTURE',
    adventureId: 'adventure-beacon',
    state: 'SCENE',
    currentTurnNumber: 0,
    planInput: {},
    player: {
      id: 'character-player',
      name: 'Mara',
      classDisplayName: 'Scout',
      personalGoal: 'Find the road.',
      attributes: { physique: 2, agility: 4, knowledge: 3, charisma: 1 },
    },
    quest: {
      id: 'quest-beacon',
      publisherNpcId: 'npc-owner',
      relatedNpcIds: ['npc-owner'],
      content: {
        title: 'The Fading Beacon',
        summary: 'Investigate the lighthouse.',
        objective: 'Restore the beacon.',
      },
    },
    clocks: [{ id: 'clock-storm', name: 'Storm', current: 2, max: 6 }],
    items: [
      {
        id: 'item-rope',
        content: { name: 'Rope', description: 'A coil of sturdy rope.' },
      },
    ],
    clues: [
      {
        id: 'clue-lens',
        title: 'Scorched Lens',
        description: 'Burned from inside.',
        isCore: true,
        discoveredInTurnId: 'turn-zero',
      },
    ],
    turns: [],
    currentScene: 'Rain lashes the shuttered lighthouse.',
    sceneFrame: null,
    suggestedActions: ['Study the lock.', 'Ask the keeper about the key.', 'Inspect the hinges.'],
    turnGenerationContext: null,
    diceGenerationInput: null,
  };
}
