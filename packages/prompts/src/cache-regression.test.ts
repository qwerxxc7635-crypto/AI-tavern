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
  renderStablePromptProfile,
  stableWorldTruthsFromContext,
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
        version: promptVersion(6),
        outputSchemaName: 'npc_reply_v6',
      },
      schema,
      { world: '暮湾' },
    );
    const context = await layout('action', 'turn', 'Wait.');
    const currentHash = await promptCachePrefixHash(current, context);
    const updatedHash = await promptCachePrefixHash(updated, context);

    expect(current.promptVersion).toBe(5);
    expect(updated.promptVersion).toBe(6);
    expect(updatedHash).not.toBe(currentHash);
  });

  it('projects stable rules byte-identically while excluding private dynamic context', async () => {
    const first = await stableAssembly('volatile-a', 7, 'Ask about the cellar.', 'private-a');
    const second = await stableAssembly('volatile-b', 7, 'Leave the tavern.', 'private-b');
    const firstTruths = stableWorldTruthsFromContext(first);
    const secondTruths = stableWorldTruthsFromContext(second);

    expect(canonical(firstTruths)).toBe(canonical(secondTruths));
    expect(canonical(firstTruths)).not.toMatch(/volatile|cellar|tavern|private/u);
    const firstProfile = createStablePromptProfile(TASK_PROMPTS.NPC_REPLY, schema, firstTruths);
    const secondProfile = createStablePromptProfile(TASK_PROMPTS.NPC_REPLY, schema, secondTruths);
    expect(renderStablePromptProfile(firstProfile)).toBe(renderStablePromptProfile(secondProfile));
  });

  it('invalidates stable prefix bytes when the Constitution revision changes', async () => {
    const first = stableWorldTruthsFromContext(
      await stableAssembly('volatile-a', 7, 'Wait.', 'private-a'),
    );
    const revised = stableWorldTruthsFromContext(
      await stableAssembly('volatile-b', 8, 'Wait.', 'private-a'),
    );
    expect(canonical(first)).not.toBe(canonical(revised));
  });
});

function canonical(value: unknown): string {
  return JSON.stringify(value);
}

async function stableAssembly(
  volatileIdentity: string,
  constitutionRevision: number,
  actionText: string,
  privateKnowledge: string,
) {
  const rules = await createContextBlock({
    id: `rules-${volatileIdentity}`,
    type: 'rules',
    content: {
      constitution: {
        campaignId: '123e4567-e89b-42d3-a456-426614174000',
        createdAt: '2026-08-24T00:00:00.000Z',
        revision: constitutionRevision,
        magic: 'LOW',
      },
    },
    sourceId: `campaign-${volatileIdentity}`,
    sourceRevision: constitutionRevision,
    stability: 'stable',
    priority: 100,
    tokenBudget: 200,
    privacyClass: 'game_private',
    version: 1,
  });
  const knowledge = await createContextBlock({
    id: `knowledge-${volatileIdentity}`,
    type: 'knowledge',
    content: { knowledge: privateKnowledge },
    sourceId: `actor-${volatileIdentity}`,
    sourceRevision: 1,
    stability: 'semi_stable',
    priority: 50,
    tokenBudget: 200,
    privacyClass: 'secret',
    version: 1,
  });
  const action = await createContextBlock({
    id: `action-${volatileIdentity}`,
    type: 'action',
    content: { action: actionText },
    sourceId: `turn-${volatileIdentity}`,
    sourceRevision: 1,
    stability: 'dynamic',
    priority: 10,
    tokenBudget: 200,
    privacyClass: 'game_private',
    version: 1,
  });
  return assembleContextBlocks(
    [rules, knowledge, action].map((block) => ({ block, relevance: 1, required: true })),
    { maxTokens: 1_000, typeOrder: ['rules', 'knowledge', 'action'] },
  );
}

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
