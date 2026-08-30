import type { ContextCacheLayout } from '@ember-tavern/ai-core';

import { promptCachePrefixHash } from './cache-prefix.js';
import { formatOutputRepairPrompt, formatTaskPrompt } from './provider-format.js';
import {
  PromptManagerSnapshotSchema,
  PromptPresetBundleSchema,
  parsePromptManagerSnapshot,
  resolvePromptPreset,
} from './prompt-manager.js';
import { describe, expect, it } from 'vitest';

const capabilities = {
  text: true,
  streaming: true,
  systemMessages: true,
  jsonMode: true,
  jsonSchema: true,
  toolCalling: false,
  reasoning: false,
  contextWindowTokens: 32_000,
  costStatus: 'PAID' as const,
  checkedAt: '2026-08-24T00:00:00.000Z' as never,
};
const worldInput = {
  concept: 'A rain-bound harbor.',
  storyPreferences: ['Mystery'],
  contentBoundaries: {
    allowHorror: true,
    allowPermanentDeath: false,
    allowRomance: true,
    allowBetrayal: true,
    excludedContent: [],
  },
};
const emptyCacheLayout: ContextCacheLayout = Object.freeze({ sections: Object.freeze([]) });

describe('Prompt Manager contract', () => {
  it('keeps block order, filters task scope and leaves core sections immutable', async () => {
    const snapshot = parsePromptManagerSnapshot({
      schemaVersion: 1,
      revision: 7,
      activePresetId: 'preset-candle',
      presets: [
        {
          id: 'preset-candle',
          name: 'Candlelit mystery',
          version: 3,
          blocks: [
            {
              id: 'tone',
              name: 'Tone first',
              content: 'Use restrained sensory prose.',
              enabled: true,
              tasks: [],
            },
            {
              id: 'dialogue',
              name: 'Dialogue second',
              content: 'Keep spoken lines concise.',
              enabled: true,
              tasks: ['NPC_REPLY'],
            },
            {
              id: 'disabled',
              name: 'Disabled',
              content: 'Never included.',
              enabled: false,
              tasks: [],
            },
          ],
        },
      ],
    });
    const resolved = resolvePromptPreset(snapshot, 'NPC_REPLY');
    expect(resolved?.blocks.map(({ id }) => id)).toEqual(['tone', 'dialogue']);

    const baseline = formatTaskPrompt('GENERATE_WORLD', worldInput, capabilities);
    const customized = formatTaskPrompt('GENERATE_WORLD', worldInput, capabilities, {
      userPreset: resolvePromptPreset(snapshot, 'GENERATE_WORLD'),
    });
    expect(customized.stableProfile.sections.slice(0, 5)).toEqual(
      baseline.stableProfile.sections.slice(0, 5),
    );
    expect(customized.stableProfile.sections.at(-1)).toMatchObject({
      kind: 'USER_GUIDANCE',
      content: { managerRevision: 7, presetVersion: 3 },
    });
    await expect(
      promptCachePrefixHash(customized.stableProfile, emptyCacheLayout),
    ).resolves.not.toBe(await promptCachePrefixHash(baseline.stableProfile, emptyCacheLayout));
  });

  it('preserves the same user preset during structural repair', () => {
    const snapshot = parsePromptManagerSnapshot({
      schemaVersion: 1,
      revision: 1,
      activePresetId: 'preset-one',
      presets: [
        {
          id: 'preset-one',
          name: 'Brief',
          version: 1,
          blocks: [
            { id: 'brief', name: 'Brief', content: 'Use brief prose.', enabled: true, tasks: [] },
          ],
        },
      ],
    });
    const repaired = formatOutputRepairPrompt(
      'GENERATE_WORLD',
      worldInput,
      '{',
      { code: 'INVALID_JSON', issues: [] },
      capabilities,
      { userPreset: resolvePromptPreset(snapshot, 'GENERATE_WORLD') },
    );
    expect(repaired.messages[0]?.content).toContain('Use brief prose.');
    expect(repaired.messages.at(-1)?.content).toContain('JSON only');
  });

  it('rejects missing active presets, duplicate blocks and malformed bundles', () => {
    expect(
      PromptManagerSnapshotSchema.safeParse({
        schemaVersion: 1,
        revision: 1,
        activePresetId: 'missing',
        presets: [],
      }).success,
    ).toBe(false);
    expect(
      PromptManagerSnapshotSchema.safeParse({
        schemaVersion: 1,
        revision: 1,
        activePresetId: 'preset',
        presets: [
          {
            id: 'preset',
            name: 'Preset',
            version: 1,
            blocks: [
              { id: 'same', name: 'A', content: 'A', enabled: true, tasks: [] },
              { id: 'same', name: 'B', content: 'B', enabled: true, tasks: [] },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      PromptPresetBundleSchema.safeParse({ format: 'OTHER', formatVersion: 1, preset: {} }).success,
    ).toBe(false);
  });
});
