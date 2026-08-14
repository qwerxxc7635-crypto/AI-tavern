// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { WorldCreationPage } from './world-creation-page.js';
import type {
  GenerateWorldOptions,
  WorldBibleView,
  WorldCreationSnapshot,
  WorldDraft,
} from './world-creation-service.js';

afterEach(cleanup);

describe('world creation page', () => {
  it('submits base options and an optional concept before showing the generated preview', async () => {
    const service = new FakeWorldService({
      campaignState: 'CREATING_WORLD',
      world: null,
      constitution: null,
    });
    renderWorldPage(service);

    fireEvent.change(await screen.findByLabelText(/自定义世界构想/), {
      target: { value: '漂浮在云海上的群岛。' },
    });
    fireEvent.change(screen.getByLabelText('世界类型'), { target: { value: '蒸汽朋克' } });
    fireEvent.click(screen.getByRole('button', { name: '使用默认模型生成' }));

    expect(await screen.findByDisplayValue('Ember Coast')).toBeTruthy();
    expect(service.generateOptions).toMatchObject({
      concept: expect.stringContaining('漂浮在云海上的群岛。'),
      storyPreferences: expect.arrayContaining(['蒸汽朋克']),
    });
  });

  it('saves locks, performs a partial refinement and confirms into character creation', async () => {
    const service = new FakeWorldService({
      campaignState: 'REVIEWING_WORLD',
      world: worldView(),
      constitution: constitutionView(),
    });
    renderWorldPage(service);

    expect(await screen.findByLabelText('世界宪法确认')).toBeTruthy();
    expect(screen.getByText('世界宪法 · 修订 1')).toBeTruthy();
    expect(screen.getByText('Low coastal fantasy · Early industrial')).toBeTruthy();
    expect(screen.getByText(/Death is permanent\./)).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: '世界简介' }));
    fireEvent.click(screen.getByRole('button', { name: '保存手动修改' }));
    await waitFor(() => expect(service.updateCalls.at(-1)?.lockedFields).toContain('summary'));

    fireEvent.change(screen.getByLabelText('修改要求'), {
      target: { value: '只调整主要势力的目标。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '按要求局部生成' }));
    await waitFor(() =>
      expect(service.refineInstructions.at(-1)).toEqual(['只调整主要势力的目标。']),
    );

    fireEvent.click(screen.getByRole('button', { name: '确认世界' }));
    expect(await screen.findByText('进入车卡 campaign-world')).toBeTruthy();
    expect(service.confirmCalls).toEqual(['campaign-world']);
  });
});

function renderWorldPage(service: FakeWorldService) {
  return render(
    <MemoryRouter initialEntries={['/world?campaignId=campaign-world']}>
      <Routes>
        <Route path="/world" element={<WorldCreationPage service={service} />} />
        <Route path="/character/create" element={<p>进入车卡 campaign-world</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

class FakeWorldService {
  public generateOptions: GenerateWorldOptions | null = null;
  public readonly updateCalls: Array<{
    readonly world: WorldDraft;
    readonly lockedFields: readonly string[];
  }> = [];
  public readonly refineInstructions: Array<readonly string[]> = [];
  public readonly confirmCalls: string[] = [];

  public constructor(private snapshot: WorldCreationSnapshot) {}

  public async load(): Promise<WorldCreationSnapshot> {
    return this.snapshot;
  }

  public async generate(
    _campaignId: string,
    options: GenerateWorldOptions,
  ): Promise<WorldCreationSnapshot> {
    this.generateOptions = options;
    this.snapshot = {
      campaignState: 'REVIEWING_WORLD',
      world: worldView(),
      constitution: constitutionView(),
    };
    return this.snapshot;
  }

  public async update(
    _campaignId: string,
    world: WorldDraft,
    lockedFields: readonly WorldBibleView['lockedFields'][number][],
  ): Promise<WorldCreationSnapshot> {
    this.updateCalls.push({ world, lockedFields });
    this.snapshot = {
      campaignState: 'REVIEWING_WORLD',
      world: { ...worldView(), ...world, lockedFields },
      constitution: constitutionView(),
    };
    return this.snapshot;
  }

  public async refine(
    _campaignId: string,
    current: WorldBibleView,
    instructions: readonly string[],
  ): Promise<WorldCreationSnapshot> {
    this.refineInstructions.push(instructions);
    this.snapshot = {
      campaignState: 'REVIEWING_WORLD',
      world: { ...current, coreConflict: 'Refined conflict.' },
      constitution: constitutionView(2),
    };
    return this.snapshot;
  }

  public async confirm(campaignId: string): Promise<WorldCreationSnapshot> {
    this.confirmCalls.push(campaignId);
    this.snapshot = { ...this.snapshot, campaignState: 'CREATING_CHARACTER' };
    return this.snapshot;
  }
}

function worldView(): WorldBibleView {
  return {
    campaignId: 'campaign-world',
    constitution: constitutionDraft(),
    name: 'Ember Coast',
    currentRegion: 'Ash Harbor',
    summary: 'A storm-bound coast.',
    coreConflict: 'The old lighthouse has gone dark.',
    technologyLevel: 'Early industrial',
    powerRules: ['Weather magic changes nearby climate.'],
    factions: [
      {
        name: 'Lantern Guild',
        description: 'Keepers of the coast lights.',
        goals: ['Restore the beacon.'],
      },
    ],
    locations: [
      {
        name: 'Ash Harbor',
        description: 'A sheltered port.',
        parentName: null,
        factionNames: ['Lantern Guild'],
      },
    ],
    narrativeStyle: 'Grounded mystery.',
    forbiddenElements: [],
    tavernReason: 'Travelers wait for storms to pass.',
    storyHooks: ['A light moves beneath the harbor.'],
    lockedFields: [],
    createdAt: '2026-07-31T01:00:00.000Z',
    updatedAt: '2026-07-31T01:00:00.000Z',
  };
}

function constitutionDraft() {
  return {
    schemaVersion: 1 as const,
    worldType: 'Low coastal fantasy',
    era: 'Early industrial',
    technology: 'Early industrial',
    magic: 'Weather magic changes nearby climate.',
    peoples: ['Coastal communities'],
    society: 'Guilds connect isolated ports.',
    politics: 'Harbor councils share authority.',
    economy: 'Fishing and shipping.',
    combatScale: 'Personal and small-group conflict.',
    deathRules: 'Death is permanent.',
    careerRules: 'Careers arise from local institutions.',
    equipmentRules: 'Equipment follows local craft.',
    npcRules: 'NPC motives follow knowledge and obligations.',
    traitRules: 'Benefits require balancing drawbacks.',
    taboos: [],
  };
}

function constitutionView(revision = 1) {
  return {
    ...constitutionDraft(),
    campaignId: 'campaign-world',
    revision,
    status: 'DRAFT' as const,
    createdAt: '2026-07-31T01:00:00.000Z',
    updatedAt: '2026-07-31T01:00:00.000Z',
    lockedAt: null,
  };
}
