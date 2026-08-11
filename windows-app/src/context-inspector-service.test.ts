import { describe, expect, it } from 'vitest';

import {
  assembleContextBlocks,
  createContextBlock,
  type ContextCandidate,
} from '@ember-tavern/ai-core';

import {
  projectContextManifest,
  recordContextInspection,
  sessionContextInspectorGateway,
} from './context-inspector-service.js';

describe('context inspector service', () => {
  it('records an actual task manifest without exposing context content', async () => {
    await recordContextInspection('NPC_REPLY', { secret: 'must-not-be-rendered' });
    const first = await sessionContextInspectorGateway.load();
    expect(first).toMatchObject({ task: 'NPC_REPLY', entries: [{ decision: 'INCLUDED' }] });
    expect(JSON.stringify(first)).not.toContain('must-not-be-rendered');
    expect(first?.entries[0]?.hash).toHaveLength(12);

    await recordContextInspection('NPC_REPLY', { secret: 'must-not-be-rendered' });
    expect((await sessionContextInspectorGateway.load())?.entries[0]?.cache).toBe('HIT');
  });

  it('projects included and omitted entries while redacting secret sources', async () => {
    const included = await createContextBlock({
      id: 'included',
      type: 'world',
      content: { summary: 'public summary' },
      sourceId: 'world-1',
      sourceRevision: 3,
      stability: 'semi_stable',
      priority: 10,
      tokenBudget: 100,
      privacyClass: 'game_private',
      version: 1,
    });
    const omitted = await createContextBlock({
      id: 'omitted',
      type: 'lore',
      content: { hidden: 'secret lore' },
      sourceId: 'secret-fact-1',
      sourceRevision: 2,
      stability: 'semi_stable',
      priority: 1,
      tokenBudget: 100,
      privacyClass: 'secret',
      version: 1,
    });
    const candidates: ContextCandidate[] = [
      { block: included, relevance: 1, required: false },
      { block: omitted, relevance: 0, required: false },
    ];
    const assembly = assembleContextBlocks(candidates, {
      maxTokens: 100,
      typeOrder: ['world', 'lore'],
      minimumRelevance: 0.5,
    });
    const view = projectContextManifest('CHECK_CONSISTENCY', assembly.manifest);
    expect(view.entries).toEqual([
      expect.objectContaining({
        block: 'world',
        source: 'world-1',
        revision: 3,
        stability: 'semi_stable',
        decision: 'INCLUDED',
        cache: 'MISS',
      }),
      expect.objectContaining({
        block: 'lore',
        source: '已遮罩',
        decision: 'OMITTED',
        reason: 'not_relevant',
        cache: 'NOT_APPLICABLE',
      }),
    ]);
    expect(JSON.stringify(view)).not.toContain('secret lore');
    expect(JSON.stringify(view)).not.toContain('secret-fact-1');
  });
});
