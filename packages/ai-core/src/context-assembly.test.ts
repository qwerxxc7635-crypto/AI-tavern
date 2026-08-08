import { describe, expect, it } from 'vitest';

import {
  assembleContextBlocks,
  ContextAssemblyError,
  createContextBlock,
  estimateContextTokens,
  type ContextBlockDraft,
  type ContextStability,
} from './context-assembly.js';

describe('ContextBlock assembly', () => {
  it('hashes canonical content and records provenance without exposing content in the manifest', async () => {
    const left = await createContextBlock(draft('world', 'stable', { b: 2, a: 1 }));
    const right = await createContextBlock(draft('world', 'stable', { a: 1, b: 2 }));

    expect(left.contentHash).toBe(right.contentHash);
    expect(left.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    const assembly = assembleContextBlocks([{ block: left, relevance: 1, required: true }], {
      maxTokens: 100,
      typeOrder: ['world'],
    });
    expect(assembly.manifest.entries[0]).toMatchObject({
      sourceId: 'campaign-a',
      sourceRevision: 3,
      privacyClass: 'game_private',
      included: true,
      reason: 'required',
    });
    expect(assembly.manifest.entries[0]).not.toHaveProperty('content');

    const composed = await createContextBlock(draft('unicode', 'stable', { text: 'é' }));
    const decomposed = await createContextBlock(draft('unicode', 'stable', { text: 'e\u0301' }));
    expect(composed.contentHash).toBe(decomposed.contentHash);
  });

  it('orders stable, semi-stable and dynamic blocks deterministically', async () => {
    const candidates = await Promise.all([
      candidate('dynamic-b', 'user_input', 'dynamic', 100),
      candidate('stable-z', 'rules', 'stable', 1),
      candidate('semi-b', 'world', 'semi_stable', 10),
      candidate('stable-a', 'rules', 'stable', 1),
      candidate('semi-a', 'world', 'semi_stable', 20),
    ]);
    const assembly = assembleContextBlocks(candidates.reverse(), {
      maxTokens: 1_000,
      typeOrder: ['rules', 'world', 'user_input'],
    });

    expect(assembly.blocks.map(({ id }) => id)).toEqual([
      'stable-a',
      'stable-z',
      'semi-a',
      'semi-b',
      'dynamic-b',
    ]);
  });

  it('excludes irrelevant and over-budget optional blocks without truncating JSON', async () => {
    const relevant = await candidate('relevant', 'history', 'dynamic', 10, { value: 'keep' });
    const irrelevant = await candidate('irrelevant', 'memory', 'semi_stable', 10);
    const tooLarge = await candidate(
      'too-large',
      'lore',
      'stable',
      10,
      { value: 'large'.repeat(100) },
      1,
    );
    const assembly = assembleContextBlocks(
      [relevant, { ...irrelevant, relevance: 0.1 }, tooLarge],
      { maxTokens: 100, typeOrder: ['lore', 'memory', 'history'], minimumRelevance: 0.5 },
    );

    expect(assembly.blocks.map(({ id }) => id)).toEqual(['relevant']);
    expect(assembly.manifest.entries.map(({ blockId, reason }) => [blockId, reason])).toEqual([
      ['too-large', 'block_budget'],
      ['irrelevant', 'not_relevant'],
      ['relevant', 'relevant'],
    ]);
    expect(assembly.blocks[0]?.content).toEqual({ value: 'keep' });
  });

  it('fails closed when required context cannot fit', async () => {
    const required = await candidate(
      'required',
      'user_input',
      'dynamic',
      10,
      { value: 'required'.repeat(100) },
      1,
      true,
    );
    expect(() =>
      assembleContextBlocks([required], { maxTokens: 1, typeOrder: ['user_input'] }),
    ).toThrow(ContextAssemblyError);
  });

  it('estimates UTF-8 content deterministically', () => {
    expect(estimateContextTokens({ text: '酒馆' })).toBe(5);
  });
});

function draft(
  id: string,
  stability: ContextStability,
  content: ContextBlockDraft['content'] = { value: id },
  tokenBudget = 100,
): ContextBlockDraft {
  return {
    id,
    type: 'world',
    content,
    sourceId: 'campaign-a',
    sourceRevision: 3,
    stability,
    priority: 10,
    tokenBudget,
    privacyClass: 'game_private',
    version: 1,
  };
}

async function candidate(
  id: string,
  type: ContextBlockDraft['type'],
  stability: ContextStability,
  priority: number,
  content: ContextBlockDraft['content'] = { value: id },
  tokenBudget = 100,
  required = false,
) {
  return {
    block: await createContextBlock({
      ...draft(id, stability, content, tokenBudget),
      type,
      priority,
    }),
    relevance: 1,
    required,
  };
}
