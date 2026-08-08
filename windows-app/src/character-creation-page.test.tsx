// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { CharacterCreationPage } from './character-creation-page.js';
import type {
  CharacterCreationSnapshot,
  CharacterDraft,
  CharacterTraitView,
} from './character-creation-service.js';

afterEach(cleanup);

describe('character creation page', () => {
  it('allocates attributes, selects two generated traits and previews committed equipment', async () => {
    const service = new FakeCharacterService(emptySnapshot());
    renderCharacterPage(service);

    fireEvent.change(await screen.findByLabelText('姓名'), {
      target: { value: '林鸦' },
    });
    fireEvent.change(screen.getByLabelText('角色概念'), {
      target: { value: '追查失踪商队的荒野向导' },
    });
    fireEvent.change(screen.getByLabelText('个人目标'), {
      target: { value: '找到失踪的姐姐。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成六个候选特质' }));

    expect(await screen.findByText('敏锐观察')).toBeTruthy();
    expect(service.generatedDraft).toMatchObject({
      name: '林鸦',
      attributes: { physique: 3, agility: 3, knowledge: 2, charisma: 2 },
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /敏锐观察/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /守信/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认特质并生成背景' }));

    expect(await screen.findByRole('heading', { name: '背景' })).toBeTruthy();
    expect(screen.getByText('灰湾')).toBeTruthy();
    expect(screen.getByText('体魄检定 +1')).toBeTruthy();
    expect(service.selectedTraits).toHaveLength(2);
    expect(
      [...document.querySelectorAll<HTMLElement>('[data-character-section]')].map(
        ({ dataset }) => dataset['characterSection'],
      ),
    ).toEqual([
      'summary',
      'basics',
      'attributes',
      'background',
      'personality',
      'traits',
      'equipment',
      'ai-controls',
    ]);
    for (const heading of ['基础信息', '属性', '背景', '个性与偏好', '特质', '装备', 'AI 控制']) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole('button', { name: '进入酒馆生成流程' }));
    expect(await screen.findByText('等待酒馆生成 campaign-character')).toBeTruthy();
  });

  it('restores persisted trait candidates and prevents selecting more than two', async () => {
    const draft = characterDraft();
    const service = new FakeCharacterService({
      ...emptySnapshot(),
      draft,
      traitGenerationRecordId: 'generation-traits',
      traitCandidates: traitCandidates(),
    });
    renderCharacterPage(service);

    expect(await screen.findByText('决定角色如何面对世界。')).toBeTruthy();
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0] as HTMLElement);
    fireEvent.click(checkboxes[1] as HTMLElement);
    expect((checkboxes[2] as HTMLInputElement).disabled).toBe(true);
    expect(service.generatedDraft).toBeNull();
  });

  it('does not generate while the attribute allocation is not exactly ten', async () => {
    const service = new FakeCharacterService(emptySnapshot());
    renderCharacterPage(service);

    fireEvent.change(await screen.findByLabelText('体魄'), { target: { value: '4' } });
    expect(screen.getByText('已分配 11 / 10 点')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: '生成六个候选特质' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

function renderCharacterPage(service: FakeCharacterService) {
  return render(
    <MemoryRouter initialEntries={['/character/create?campaignId=campaign-character']}>
      <Routes>
        <Route path="/character/create" element={<CharacterCreationPage service={service} />} />
        <Route path="/tavern" element={<TavernRouteEcho />} />
      </Routes>
    </MemoryRouter>,
  );
}

function TavernRouteEcho() {
  const location = useLocation();
  const id = new URLSearchParams(location.search).get('campaignId');
  return <p>等待酒馆生成 {id ?? '未选择'}</p>;
}

class FakeCharacterService {
  public generatedDraft: CharacterDraft | null = null;
  public selectedTraits: readonly CharacterTraitView[] = [];

  public constructor(private snapshot: CharacterCreationSnapshot) {}

  public async load(): Promise<CharacterCreationSnapshot> {
    return this.snapshot;
  }

  public async generateTraits(draft: CharacterDraft): Promise<CharacterCreationSnapshot> {
    this.generatedDraft = draft;
    this.snapshot = {
      campaignState: 'CREATING_CHARACTER',
      draft,
      traitGenerationRecordId: 'generation-traits',
      traitCandidates: traitCandidates(),
      character: null,
    };
    return this.snapshot;
  }

  public async complete(
    draft: CharacterDraft,
    traitGenerationRecordId: string,
    selectedTraits: readonly CharacterTraitView[],
  ): Promise<CharacterCreationSnapshot> {
    expect(traitGenerationRecordId).toBe('generation-traits');
    this.selectedTraits = selectedTraits;
    this.snapshot = {
      campaignState: 'GENERATING_TAVERN',
      draft: null,
      traitGenerationRecordId,
      traitCandidates: selectedTraits,
      character: {
        ...draft,
        traits: selectedTraits,
        background: {
          birthplace: '灰湾',
          formativeExperience: '曾为远行商队领路。',
          adventureMotivation: '找回失踪的亲人。',
          secret: '保留着一张残缺地图。',
          importantPerson: '老向导赫姆。',
          tavernArrivalReason: '追踪地图上的炉火印记。',
        },
        initialEquipment: [
          {
            id: 'item-compass',
            name: '旧黄铜罗盘',
            description: '指针偶尔会偏向旧路。',
            effect: { kind: 'CHECK_MODIFIER', attribute: 'physique', modifier: 1 },
          },
          {
            id: 'item-cloak',
            name: '防雨斗篷',
            description: '一件结实的旅行斗篷。',
            effect: { kind: 'NONE' },
          },
        ],
        createdAt: '2026-07-31T12:00:00.000Z',
        updatedAt: '2026-07-31T12:00:00.000Z',
      },
    };
    return this.snapshot;
  }
}

function emptySnapshot(): CharacterCreationSnapshot {
  return {
    campaignState: 'CREATING_CHARACTER',
    draft: null,
    traitGenerationRecordId: null,
    traitCandidates: [],
    character: null,
  };
}

function characterDraft(): CharacterDraft {
  return {
    id: 'character-player',
    campaignId: 'campaign-character',
    name: '林鸦',
    gender: null,
    age: 24,
    concept: '追查失踪商队的荒野向导',
    storyPreferences: ['探索'],
    contentBoundaries: {
      allowHorror: false,
      allowPermanentDeath: false,
      allowRomance: true,
      allowBetrayal: true,
      excludedContent: [],
    },
    classArchetype: 'ROGUE',
    classDisplayName: '寻路者',
    attributes: { physique: 2, agility: 4, knowledge: 3, charisma: 1 },
    personalGoal: '找到失踪的姐姐。',
  };
}

function traitCandidates(): readonly CharacterTraitView[] {
  return [
    { id: 'trait-1', name: '敏锐观察', description: '善于察觉环境中的细微变化。' },
    { id: 'trait-2', name: '守信', description: '答应的事情总会尽力完成。' },
    { id: 'trait-3', name: '谨慎', description: '行动前习惯评估退路。' },
    { id: 'trait-4', name: '好奇', description: '无法忽视未解的谜团。' },
    { id: 'trait-5', name: '护短', description: '格外保护同行伙伴。' },
    { id: 'trait-6', name: '坚韧', description: '能在困境中保持行动。' },
  ];
}
