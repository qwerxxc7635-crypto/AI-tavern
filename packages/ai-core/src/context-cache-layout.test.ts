import { describe, expect, it } from 'vitest';

import { assembleContextBlocks, createContextBlock, type ContextBlockType } from './index.js';
import {
  CONTEXT_CACHE_SECTION_KINDS,
  ContextCacheLayoutError,
  createContextCacheLayout,
} from './context-cache-layout.js';

describe('context cache layout', () => {
  it('separates semi-stable and dynamic content into the required order', async () => {
    const blocks = await Promise.all([
      block('action', 'dynamic', 8),
      block('state', 'dynamic', 7),
      block('history', 'dynamic', 6),
      block('knowledge', 'semi_stable', 5),
      block('lore', 'semi_stable', 4),
      block('summary', 'semi_stable', 3),
    ]);
    const assembly = assembleContextBlocks(
      blocks.reverse().map((entry) => ({ block: entry, relevance: 1, required: true })),
      {
        maxTokens: 1_000,
        typeOrder: ['summary', 'lore', 'knowledge', 'history', 'state', 'action'],
      },
    );
    const layout = createContextCacheLayout(assembly);

    expect(layout.sections.map(({ kind }) => kind)).toEqual(CONTEXT_CACHE_SECTION_KINDS);
    expect(layout.sections.map(({ stability }) => stability)).toEqual([
      'semi_stable',
      'semi_stable',
      'dynamic',
      'dynamic',
      'dynamic',
    ]);
    expect(layout.sections.map(({ blocks: entries }) => entries.map(({ type }) => type))).toEqual([
      ['summary'],
      ['lore', 'knowledge'],
      ['history'],
      ['state'],
      ['action'],
    ]);
    expect(JSON.stringify(layout)).not.toContain('sourceId');
  });

  it('fails closed when a block enters the wrong stability tier or has no layout', async () => {
    const dynamicLore = await block('lore', 'dynamic', 1);
    const unsupported = await block('world', 'semi_stable', 1);
    for (const entry of [dynamicLore, unsupported]) {
      const assembly = assembleContextBlocks([{ block: entry, relevance: 1, required: true }], {
        maxTokens: 100,
        typeOrder: [entry.type],
      });
      expect(() => createContextCacheLayout(assembly)).toThrow(ContextCacheLayoutError);
    }
  });
});

async function block(
  type: ContextBlockType,
  stability: 'semi_stable' | 'dynamic',
  sourceRevision: number,
) {
  return createContextBlock({
    id: `${type}-${sourceRevision}`,
    type,
    content: { value: type },
    sourceId: 'campaign-cache-layout',
    sourceRevision,
    stability,
    priority: 10,
    tokenBudget: 100,
    privacyClass: 'game_private',
    version: 1,
  });
}
