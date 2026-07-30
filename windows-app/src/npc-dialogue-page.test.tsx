// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { NpcDialoguePage } from './npc-dialogue-page.js';
import type { NpcDialogueSnapshot } from './npc-dialogue-service.js';

afterEach(cleanup);

describe('NPC dialogue page', () => {
  it('shows restored history, suggested topics and relationship state then sends freely', async () => {
    const service = new FakeDialogueService();
    render(
      <MemoryRouter initialEntries={['/npc?campaignId=campaign-tavern&npcId=npc-owner']}>
        <Routes>
          <Route path="/npc" element={<NpcDialoguePage service={service} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Ilyra Venn' })).toBeTruthy();
    expect(screen.getByText('Earlier question')).toBeTruthy();
    expect(screen.getByLabelText('信任 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'The old tunnel' }));
    expect((screen.getByLabelText('你想说什么？') as HTMLTextAreaElement).value).toBe(
      'The old tunnel',
    );
    fireEvent.change(screen.getByLabelText('你想说什么？'), {
      target: { value: 'May I see the cellar?' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(service.sent).toEqual(['May I see the cellar?']));
    expect(await screen.findByText('Stay close.')).toBeTruthy();
    expect(screen.getByLabelText('信任 2')).toBeTruthy();
  });
});

class FakeDialogueService {
  public readonly sent: string[] = [];
  private snapshot = initialSnapshot();

  public async load() {
    return this.snapshot;
  }

  public async send(_campaignId: string, _npcId: string, message: string) {
    this.sent.push(message);
    this.snapshot = {
      ...this.snapshot,
      relationship: { ...this.snapshot.relationship, trust: 2 },
      messages: [
        ...this.snapshot.messages,
        dialogueMessage('player-2', 3, 'PLAYER', message),
        dialogueMessage('npc-2', 4, 'NPC', 'Stay close.'),
      ],
    };
    return this.snapshot;
  }
}

function initialSnapshot(): NpcDialogueSnapshot {
  return {
    campaignId: 'campaign-tavern',
    conversationId: 'conversation-owner',
    npc: {
      id: 'npc-owner',
      name: 'Ilyra Venn',
      identity: 'Innkeeper',
      appearance: 'A weathered red coat.',
      personality: 'Practical and observant.',
      currentMood: 'Wary',
    },
    relationship: { trust: 1, closeness: 0, awe: 0, obligation: 0 },
    messages: [
      dialogueMessage('player-1', 1, 'PLAYER', 'Earlier question'),
      dialogueMessage('npc-1', 2, 'NPC', 'Earlier answer'),
    ],
    suggestedTopics: ['The old tunnel', 'The lighthouse keeper'],
    generationContext: {},
  };
}

function dialogueMessage(
  id: string,
  sequenceNumber: number,
  role: 'PLAYER' | 'NPC',
  content: string,
) {
  return {
    id,
    sequenceNumber,
    role,
    content,
    createdAt: '2026-07-31T05:00:00.000Z',
  };
}
