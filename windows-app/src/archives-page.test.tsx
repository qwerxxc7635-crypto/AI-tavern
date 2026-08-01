// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ArchivesPage } from './archives-page.js';
import type { AdventureArchive } from './settlement-service.js';

describe('ArchivesPage', () => {
  it('renders committed rewards, world facts, choices and tavern changes', async () => {
    render(
      <MemoryRouter initialEntries={['/archives?campaignId=campaign']}>
        <ArchivesPage service={{ list: async () => [archive] }} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Beacon' })).toBeTruthy();
    expect(screen.getByText('Compass — Stormglass')).toBeTruthy();
    expect(screen.getByText('Road flooded')).toBeTruthy();
    expect(screen.getByText('Lens above hearth')).toBeTruthy();
    expect(screen.getByText(/D20 14/)).toBeTruthy();
    expect(screen.getByText(/Ilyra/)).toBeTruthy();
    expect(screen.getByText(/SUMMARIZE_ADVENTURE/)).toBeTruthy();
  });
});
const archive: AdventureArchive = {
  campaignId: 'campaign',
  adventureId: 'adventure',
  title: 'Beacon',
  outcome: 'SUCCESS',
  summary: 'The beacon burns.',
  keyDecisions: ['Stayed'],
  unresolvedThreads: [],
  nextDirections: ['Rest'],
  diceResults: [{ naturalRoll: 14, total: 16, difficulty: 11, success: true }],
  participantNpcs: [{ id: 'owner', name: 'Ilyra' }],
  unresolvedClues: [],
  tavernChange: { kind: 'TROPHY', description: 'Lens above hearth' },
  acquiredItems: [{ name: 'Compass', description: 'Stormglass' }],
  worldFacts: [{ statement: 'Road flooded', kind: 'DEVELOPING_FACT' }],
  generationUses: [{ task: 'SUMMARIZE_ADVENTURE', modelName: 'ember-fake-v1', promptVersion: 2 }],
  completedAt: '2026-08-01T00:00:00.000Z',
};
