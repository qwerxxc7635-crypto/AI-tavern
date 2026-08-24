import { describe, expect, it } from 'vitest';

import { AI_TASKS } from './protocol.js';
import {
  buildUnifiedTaskContext,
  layerForContextField,
  UNIFIED_CONTEXT_LAYERS,
} from './unified-context-builder.js';

describe('Unified Context Builder', () => {
  it('assembles the required global layers in deterministic order without changing task fields', async () => {
    const input = {
      currentAction: 'Open the cellar door.',
      recentInteraction: ['The keeper warned the player.'],
      longTermMemory: ['The player once repaired the beacon.'],
      questState: { id: 'quest-beacon', status: 'ACTIVE' },
      actorKnowledge: [{ state: 'KNOWN', statement: 'The cellar is warm.' }],
      playerCharacter: { id: 'player-one', name: 'Mara' },
      currentLocation: { id: 'location-tavern', name: 'Ember Rest' },
      relevantLore: [{ id: 'fact-beacon', statement: 'Magic leaves heat.' }],
      constitution: { revision: 3, magic: 'Rare' },
    };
    const result = await buildUnifiedTaskContext('NPC_REPLY', input, source());

    expect(result.content).toEqual(input);
    expect(result.assembly.blocks.map(({ type }) => type)).toEqual([
      'task',
      'rules',
      'lore',
      'scene',
      'character',
      'knowledge',
      'state',
      'memory',
      'history',
      'action',
    ]);
    expect(result.assembly.blocks.find(({ type }) => type === 'rules')?.sourceRevision).toBe(3);
    expect(result.includedFields).toHaveLength(Object.keys(input).length);
    expect(result.omittedFields).toEqual([]);
    expect(UNIFIED_CONTEXT_LAYERS).toHaveLength(10);
  });

  it('omits irrelevant optional layers observably while retaining required action', async () => {
    const result = await buildUnifiedTaskContext(
      'GENERATE_QUEST',
      {
        relevantLore: [{ id: 'unrelated', statement: 'Far-away weather.' }],
        currentAction: 'Investigate the local bell.',
      },
      {
        ...source(),
        optionalFields: ['relevantLore'],
        relevanceByField: { relevantLore: 0 },
      },
    );
    expect(result.content).toEqual({ currentAction: 'Investigate the local bell.' });
    expect(result.omittedFields).toEqual(['relevantLore']);
    expect(
      result.assembly.manifest.entries.find(({ blockId }) => blockId.endsWith(':relevantLore')),
    ).toMatchObject({ included: false, reason: 'not_relevant' });
  });

  it('drops an optional oversized lore block before failing required context', async () => {
    const result = await buildUnifiedTaskContext(
      'CHECK_CONSISTENCY',
      { relevantLore: 'x'.repeat(2_000), currentAction: 'Check the current scene.' },
      { ...source(), optionalFields: ['relevantLore'], maxTokens: 100 },
    );
    expect(result.content).toEqual({ currentAction: 'Check the current scene.' });
    expect(result.assembly.manifest.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'block_budget', included: false }),
      ]),
    );
  });

  it('records total-budget omission after earlier relevant context consumes capacity', async () => {
    const result = await buildUnifiedTaskContext(
      'CHECK_CONSISTENCY',
      {
        relevantLore: 'a'.repeat(180),
        worldFacts: 'b'.repeat(180),
        currentAction: 'Check the current scene.',
      },
      {
        ...source(),
        optionalFields: ['relevantLore', 'worldFacts'],
        maxTokens: 100,
      },
    );
    expect(result.omittedFields).toHaveLength(1);
    expect(result.assembly.manifest.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'total_budget', included: false }),
      ]),
    );
  });

  it('rejects database dumps and credential-bearing context before prompt formatting', async () => {
    await expect(
      buildUnifiedTaskContext('NPC_REPLY', { databaseDump: { npcs: [] } }, source()),
    ).rejects.toThrow('database dump');
    await expect(
      buildUnifiedTaskContext(
        'NPC_REPLY',
        { actor: { provider: { apiKey: 'sk-never-in-context' } } },
        source(),
      ),
    ).rejects.toThrow('credential field');

    await expect(
      buildUnifiedTaskContext(
        'NPC_REPLY',
        { actor: { secret: 'The keeper belongs to the Ash Circle.' } },
        source(),
      ),
    ).resolves.toMatchObject({
      content: { actor: { secret: 'The keeper belongs to the Ash Circle.' } },
    });
  });

  it('provides the same unified action path for every registered Generator task', async () => {
    const results = await Promise.all(
      AI_TASKS.map((task) =>
        buildUnifiedTaskContext(task, { currentAction: `execute:${task}` }, source()),
      ),
    );
    expect(results).toHaveLength(AI_TASKS.length);
    for (const result of results) {
      expect(result.assembly.blocks.map(({ type }) => type)).toEqual(['task', 'action']);
      expect(result.content).toEqual({ currentAction: `execute:${result.task}` });
    }
  });

  it('uses one closed field taxonomy for relevance adapters', () => {
    expect(layerForContextField('worldConstitution')).toBe('CONSTITUTION');
    expect(layerForContextField('relevantFacts')).toBe('LORE');
    expect(layerForContextField('worldSummary')).toBe('LORE');
    expect(layerForContextField('sceneFrame')).toBe('LOCATION');
    expect(layerForContextField('playerState')).toBe('PLAYER');
    expect(layerForContextField('npcKnowledge')).toBe('ACTOR_KNOWLEDGE');
    expect(layerForContextField('activeQuests')).toBe('QUEST_STATE');
    expect(layerForContextField('longTermMemories')).toBe('MEMORY');
    expect(layerForContextField('recentMessages')).toBe('RECENT');
    expect(layerForContextField('playerAction')).toBe('ACTION');
  });
});

function source() {
  return { sourceId: 'campaign-unified-context', sourceRevision: 7 } as const;
}
