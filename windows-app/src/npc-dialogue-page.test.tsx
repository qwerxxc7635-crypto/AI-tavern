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
          <Route
            path="/npc"
            element={<NpcDialoguePage service={service} suggestionService={suggestionService} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Ilyra Venn' })).toBeTruthy();
    expect(screen.getByText('Earlier question')).toBeTruthy();
    expect(screen.getByLabelText('信任 1')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'The old tunnel' }));
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

  it('submits a suggestion through the same path and suppresses duplicate clicks', async () => {
    const service = new FakeDialogueService();
    render(
      <MemoryRouter initialEntries={['/npc?campaignId=campaign-tavern&npcId=npc-owner']}>
        <Routes>
          <Route
            path="/npc"
            element={<NpcDialoguePage service={service} suggestionService={suggestionService} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Ilyra Venn' });
    fireEvent.click(await screen.findByRole('button', { name: 'The cellar door' }));
    const submit = screen.getByRole('button', { name: '发送' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(service.sent).toEqual(['The cellar door']));
  });

  it('keeps free input usable when optional suggestions fail', async () => {
    const service = new FakeDialogueService();
    render(
      <MemoryRouter initialEntries={['/npc?campaignId=campaign-tavern&npcId=npc-owner']}>
        <Routes>
          <Route
            path="/npc"
            element={
              <NpcDialoguePage
                service={service}
                suggestionService={{
                  async load() {
                    throw new Error('offline');
                  },
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    const input = (await screen.findByLabelText('你想说什么？')) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'I speak without a suggestion.' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(service.sent).toEqual(['I speak without a suggestion.']));
  });

  it('shows streamed NPC prose, exposes cancel and never inserts preview as history', async () => {
    let aborted = false;
    const service = {
      async load() {
        return initialSnapshot();
      },
      async send(
        _campaignId: string,
        _npcId: string,
        _message: string,
        stream?: { readonly signal: AbortSignal; readonly onChunk: (content: string) => void },
      ): Promise<NpcDialogueSnapshot> {
        stream?.onChunk('The flame flickers.');
        return new Promise((_resolve, reject) => {
          stream?.signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject({ code: 'CANCELLED' });
            },
            { once: true },
          );
        });
      },
      async retry() {
        return initialSnapshot();
      },
    };
    render(
      <MemoryRouter initialEntries={['/npc?campaignId=campaign-tavern&npcId=npc-owner']}>
        <Routes>
          <Route
            path="/npc"
            element={<NpcDialoguePage service={service} suggestionService={suggestionService} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    const input = await screen.findByLabelText('你想说什么？');
    fireEvent.change(input, { target: { value: 'Read the flame.' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText('The flame flickers.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(aborted).toBe(true));
    await waitFor(() => expect(screen.queryByText('The flame flickers.')).toBeNull());
    expect(screen.getByText('Earlier answer')).toBeTruthy();
    expect((screen.getByLabelText('你想说什么？') as HTMLTextAreaElement).value).toBe(
      'Read the flame.',
    );
  });
});

const suggestionService = {
  async load() {
    return {
      cacheId: 'cache-1',
      campaignId: 'campaign-tavern',
      scopeKind: 'NPC_DIALOGUE' as const,
      scopeId: 'npc-owner',
      contextDigest: 'a'.repeat(64),
      suggestions: ['The old tunnel', 'The lighthouse keeper', 'The cellar door'].map(
        (text, index) => ({ id: `topic-${index + 1}`, text, addressedNpcId: 'npc-owner' }),
      ),
      source: 'CACHE' as const,
      createdAt: '2026-08-24T00:00:00Z',
    };
  },
};

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

  public async retry() {
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
    suggestedTopics: ['The old tunnel', 'The lighthouse keeper', 'The cellar door'],
    generationContext: {},
    timeline: null,
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
