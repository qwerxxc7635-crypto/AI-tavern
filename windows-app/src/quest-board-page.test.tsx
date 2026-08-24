// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { QuestBoardPage } from './quest-board-page.js';
import type { QuestBoardSnapshot } from './quest-board-service.js';

afterEach(cleanup);

describe('quest board page', () => {
  it('hides undiscovered quests and enters preparation by direct intervention', async () => {
    const service = new FakeQuestService();
    render(
      <MemoryRouter initialEntries={['/quests?campaignId=campaign-tavern']}>
        <Routes>
          <Route path="/quests" element={<QuestBoardPage service={service} />} />
          <Route path="/adventure" element={<AdventureEcho />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '任务告示' })).toBeTruthy();
    expect(screen.getByText('中等风险')).toBeTruthy();
    expect(screen.getByText('知识')).toBeTruthy();
    expect(screen.getByText('敏捷')).toBeTruthy();
    expect(screen.getByText('Restore the beacon.')).toBeTruthy();
    expect(screen.queryByText('Hidden Thread')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '介入任务' }));
    expect(await screen.findByRole('link', { name: '进入冒险准备' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: '进入冒险准备' }));
    expect(await screen.findByText('准备 quest-one campaign-tavern')).toBeTruthy();
    expect(service.intervened).toEqual(['quest-one']);
  });
});

function AdventureEcho() {
  const search = new URLSearchParams(useLocation().search);
  return (
    <p>
      准备 {search.get('questId')} {search.get('campaignId')}
    </p>
  );
}

class FakeQuestService {
  public readonly intervened: string[] = [];
  private snapshot = boardSnapshot();

  public async load() {
    return this.snapshot;
  }

  public async initialize() {
    return this.snapshot;
  }

  public async intervene(_campaignId: string, questId: string, revision: number) {
    this.intervened.push(questId);
    this.snapshot = {
      ...this.snapshot,
      quests: this.snapshot.quests.map((quest) =>
        quest.id === questId
          ? {
              ...quest,
              status: 'ACTIVE' as const,
              revision: revision + 1,
              statusSource: 'PLAYER_INTERVENTION' as const,
              statusReason: '玩家已经介入。',
            }
          : quest,
      ),
    };
    return this.snapshot;
  }

  public async abandon(_campaignId: string, questId: string, revision: number) {
    this.snapshot = {
      ...this.snapshot,
      quests: this.snapshot.quests.map((quest) =>
        quest.id === questId
          ? {
              ...quest,
              status: 'ABANDONED' as const,
              revision: revision + 1,
              statusSource: 'PLAYER' as const,
              statusReason: '玩家已经放弃。',
            }
          : quest,
      ),
    };
    return this.snapshot;
  }
}

function boardSnapshot(): QuestBoardSnapshot {
  return {
    campaignId: 'campaign-tavern',
    campaignState: 'TAVERN',
    source: {
      tavernId: 'tavern-rest',
      tavernName: 'Ember Rest',
      playerCharacterId: 'character-player',
      playerConcept: 'Scout',
      world: {
        name: 'Ember Coast',
        currentRegion: 'Ash Harbor',
        summary: 'A storm-bound coast.',
        coreConflict: 'The beacon is fading.',
        technologyLevel: 'Late medieval',
        powerRules: ['Magic leaves warmth.'],
      },
      availableNpcs: [],
      recentQuestTitles: ['The Fading Beacon', 'The Lost Courier'],
      recentQuestStructures: [
        'moderate|notable|8-12|agility,knowledge',
        'moderate|notable|8-12|agility,knowledge',
      ],
    },
    quests: [
      quest('quest-one', 'The Fading Beacon'),
      quest('quest-two', 'The Lost Courier'),
      { ...quest('quest-hidden', 'Hidden Thread'), status: 'HIDDEN' },
    ],
  };
}

function quest(id: string, title: string) {
  return {
    id,
    publisherNpcId: 'npc-owner',
    publisherName: 'Ilyra Venn',
    content: {
      title,
      summary: 'Investigate the failing lighthouse.',
      objective: 'Restore the beacon.',
      failureCost: 'Ships remain trapped.',
    },
    status: 'AVAILABLE' as const,
    revision: 1,
    statusSource: 'GENERATION' as const,
    statusReason: '任务机会已经出现。',
    risk: 'MODERATE' as const,
    recommendedAttributes: ['knowledge', 'agility'] as const,
    expectedTurnsMin: 8,
    expectedTurnsMax: 12,
    rewardTier: 'NOTABLE' as const,
    createdAt: '2026-07-31T06:00:00.000Z',
    updatedAt: '2026-07-31T06:00:00.000Z',
  };
}
