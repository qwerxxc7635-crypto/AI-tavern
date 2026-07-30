// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { TavernPage } from './tavern-page.js';
import type { TavernSnapshot } from './tavern-service.js';

afterEach(cleanup);

describe('tavern page', () => {
  it('initializes an unfinished tavern and displays NPCs, visitor, rumors and clocks', async () => {
    const service = new FakeTavernService(emptySnapshot(), finalSnapshot());
    renderTavern(service);

    expect(await screen.findByRole('heading', { name: 'Ember Rest' })).toBeTruthy();
    expect(screen.getByText('临时访客 · Concerned')).toBeTruthy();
    expect(screen.getByText('A light moves below the cellar.')).toBeTruthy();
    expect(screen.queryByText(/TRUE|PARTIAL|UNKNOWN/)).toBeNull();
    expect(screen.getAllByLabelText(/0\/6/)).toHaveLength(3);
    expect(service.initializeCalls).toEqual(['campaign-tavern']);
  });

  it('selects an NPC and carries both campaign and NPC identity into dialogue', async () => {
    const service = new FakeTavernService(finalSnapshot(), finalSnapshot());
    renderTavern(service);

    const visitor = await screen.findByRole('button', { name: /Sera Holt/ });
    fireEvent.click(visitor);
    expect(visitor.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Waiting for the causeway.')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: '开始交谈' }));
    expect(await screen.findByText('NPC 对话 npc-visitor campaign-tavern')).toBeTruthy();

    renderTavern(service);
    await screen.findByRole('heading', { name: 'Ember Rest' });
    fireEvent.click(screen.getByRole('link', { name: '选择任务入口' }));
    expect(await screen.findByText('任务入口 campaign-tavern')).toBeTruthy();
  });
});

function renderTavern(service: FakeTavernService) {
  return render(
    <MemoryRouter initialEntries={['/tavern?campaignId=campaign-tavern']}>
      <Routes>
        <Route path="/tavern" element={<TavernPage service={service} />} />
        <Route path="/quests" element={<QuestRouteEcho />} />
        <Route path="/npc" element={<DialogueRouteEcho />} />
      </Routes>
    </MemoryRouter>,
  );
}

function DialogueRouteEcho() {
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  return (
    <p>
      NPC 对话 {search.get('npcId')} {search.get('campaignId')}
    </p>
  );
}

function QuestRouteEcho() {
  const location = useLocation();
  const id = new URLSearchParams(location.search).get('campaignId');
  return <p>任务入口 {id ?? '未选择'}</p>;
}

class FakeTavernService {
  public readonly initializeCalls: string[] = [];

  public constructor(
    private readonly loaded: TavernSnapshot,
    private readonly initialized: TavernSnapshot,
  ) {}

  public async load(): Promise<TavernSnapshot> {
    return this.loaded;
  }

  public async initialize(id: string): Promise<TavernSnapshot> {
    this.initializeCalls.push(id);
    return this.initialized;
  }
}

function emptySnapshot(): TavernSnapshot {
  return {
    campaignState: 'GENERATING_TAVERN',
    source: {
      playerCharacterId: 'character-player',
      locationId: 'location-harbor',
      world: {
        name: 'Ember Coast',
        currentRegion: 'Ash Harbor',
        summary: 'A storm-bound coast.',
        coreConflict: 'The lighthouse has gone dark.',
        technologyLevel: 'Early industrial',
        powerRules: ['Weather magic has a cost.'],
      },
      playerConcept: 'Curious scout',
      desiredPosition: null,
    },
    tavern: null,
    npcs: [],
    rumors: [],
    clocks: [],
  };
}

function finalSnapshot(): TavernSnapshot {
  return {
    ...emptySnapshot(),
    campaignState: 'TAVERN',
    tavern: {
      id: 'tavern-ember-rest',
      campaignId: 'campaign-tavern',
      locationId: 'location-harbor',
      name: 'Ember Rest',
      position: 'The harbor crossroads',
      environment: 'A warm stone hall filled with salt air.',
      specialRules: ['Weapons remain sheathed beside the common fire.'],
      longTermProblem: 'A strange light appears beneath the cellar.',
      ownerNpcId: 'npc-owner',
      createdAt: '2026-07-31T04:00:00.000Z',
      updatedAt: '2026-07-31T04:00:00.000Z',
    },
    npcs: [
      npc('npc-owner', 'OWNER', 'Ilyra Venn', null),
      npc('npc-resident-1', 'RESIDENT', 'Tomas Reed', null),
      npc('npc-resident-2', 'RESIDENT', 'Nessa Vale', null),
      npc('npc-visitor', 'TEMPORARY_VISITOR', 'Sera Holt', 'Waiting for the causeway.'),
    ],
    rumors: [
      {
        id: 'rumor-1',
        statement: 'A light moves below the cellar.',
        sourceNpcId: 'npc-resident-1',
      },
      {
        id: 'rumor-2',
        statement: 'The guild pays for tunnel maps.',
        sourceNpcId: 'npc-resident-2',
      },
      {
        id: 'rumor-3',
        statement: 'The courier crossed alone.',
        sourceNpcId: 'npc-visitor',
      },
    ],
    clocks: ['世界冲突', '酒馆长期问题', '区域局势'].map((name, index) => ({
      id: `clock-${index}`,
      name,
      current: 0,
      max: 6,
      stages: [
        { at: 2, title: '迹象浮现' },
        { at: 4, title: '局势升级' },
        { at: 6, title: '局势爆发' },
      ],
    })),
  };
}

function npc(
  id: string,
  residency: 'OWNER' | 'RESIDENT' | 'TEMPORARY_VISITOR',
  name: string,
  visitReason: string | null,
) {
  return {
    id,
    residency,
    name,
    identity: 'Traveler',
    appearance: 'Weathered clothes.',
    personality: 'Observant and practical.',
    currentMood: 'Concerned',
    currentStatus: 'ACTIVE' as const,
    visitReason,
  };
}
