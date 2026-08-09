import {
  assembleContextBlocks,
  createContextBlock,
  createContextCacheLayout,
  type ContextCacheLayout,
} from '@ember-tavern/ai-core';
import { promptVersion } from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import {
  TASK_PROMPTS,
  createStablePromptProfile,
  promptCachePrefixHash,
  renderContextCacheLayout,
  renderPromptCachePrefix,
} from './index.js';

const schema = { properties: { answer: { type: 'string' } }, type: 'object' } as const;

describe('DeepSeek cache regression', () => {
  it('emits identical prefix bytes for the same stable semantic input', async () => {
    const firstProfile = createStablePromptProfile(TASK_PROMPTS.NPC_REPLY, schema, {
      world: { tone: '暮色', rules: ['不改骰点', '不泄露秘密'] },
    });
    const secondProfile = createStablePromptProfile(TASK_PROMPTS.NPC_REPLY, schema, {
      world: { rules: ['不改骰点', '不泄露秘密'], tone: '暮色' },
    });
    const firstLayout = await layout('first-random-id', 'source-a', 'Open the cellar.');
    const secondLayout = await layout('second-random-id', 'source-b', 'Open the cellar.');

    const first = new TextEncoder().encode(renderPromptCachePrefix(firstProfile, firstLayout));
    const second = new TextEncoder().encode(renderPromptCachePrefix(secondProfile, secondLayout));
    expect(first).toEqual(second);
    await expect(promptCachePrefixHash(firstProfile, firstLayout)).resolves.toBe(
      await promptCachePrefixHash(secondProfile, secondLayout),
    );
  });

  it('changes only the dynamic tail when the current action changes', async () => {
    const profile = createStablePromptProfile(TASK_PROMPTS.NPC_REPLY, schema, {
      world: '暮湾',
    });
    const first = await layout('action-a', 'turn-a', 'Inspect the door.');
    const second = await layout('action-b', 'turn-b', 'Knock on the door.');

    expect(renderPromptCachePrefix(profile, first)).toBe(renderPromptCachePrefix(profile, second));
    expect(renderContextCacheLayout(first)).not.toBe(renderContextCacheLayout(second));
    await expect(promptCachePrefixHash(profile, first)).resolves.toBe(
      await promptCachePrefixHash(profile, second),
    );
  });

  it('changes the prefix hash when the prompt profile version changes', async () => {
    const current = createStablePromptProfile(TASK_PROMPTS.NPC_REPLY, schema, { world: '暮湾' });
    const updated = createStablePromptProfile(
      {
        ...TASK_PROMPTS.NPC_REPLY,
        version: promptVersion(4),
        outputSchemaName: 'npc_reply_v4',
      },
      schema,
      { world: '暮湾' },
    );
    const context = await layout('action', 'turn', 'Wait.');
    const currentHash = await promptCachePrefixHash(current, context);
    const updatedHash = await promptCachePrefixHash(updated, context);

    expect(current.promptVersion).toBe(3);
    expect(updated.promptVersion).toBe(4);
    expect(updatedHash).not.toBe(currentHash);
  });
});

async function layout(
  randomId: string,
  randomSourceId: string,
  actionText: string,
): Promise<ContextCacheLayout> {
  const summary = await createContextBlock({
    id: `summary-${randomId}`,
    type: 'summary',
    content: { summary: 'The tavern cellar is sealed.' },
    sourceId: `summary-${randomSourceId}`,
    sourceRevision: 4,
    stability: 'semi_stable',
    priority: 10,
    tokenBudget: 100,
    privacyClass: 'game_private',
    version: 1,
  });
  const action = await createContextBlock({
    id: randomId,
    type: 'action',
    content: { action: actionText },
    sourceId: randomSourceId,
    sourceRevision: 9,
    stability: 'dynamic',
    priority: 10,
    tokenBudget: 100,
    privacyClass: 'game_private',
    version: 1,
  });
  return createContextCacheLayout(
    assembleContextBlocks(
      [summary, action].map((block) => ({ block, relevance: 1, required: true })),
      { maxTokens: 1_000, typeOrder: ['summary', 'action'] },
    ),
  );
}
