import {
  AI_TASKS,
  assembleContextBlocks,
  canonicalJson,
  createContextBlock,
  createContextCacheLayout,
  type ModelCapabilities,
} from '@ember-tavern/ai-core';
import { isoTimestamp } from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import {
  BASE_RULES,
  PROMPT_HISTORY,
  STABLE_PROMPT_PROFILE_ID,
  STABLE_PROMPT_PROFILE_VERSION,
  STABLE_PROMPT_SECTION_KINDS,
  TASK_PROMPTS,
  createStablePromptProfile,
  formatOutputRepairPrompt,
  formatTaskPrompt,
  promptCachePrefixHash,
  renderStablePromptProfile,
} from './index.js';

const checkedAt = isoTimestamp('2026-07-31T00:25:00.000Z');
const capabilities: ModelCapabilities = {
  text: true,
  streaming: false,
  systemMessages: true,
  jsonMode: true,
  jsonSchema: true,
  toolCalling: false,
  reasoning: false,
  contextWindowTokens: 8192,
  costStatus: 'UNKNOWN',
  checkedAt,
};
const worldInput = {
  concept: 'A coast lit by an ancient beacon.',
  storyPreferences: ['Mystery'],
  contentBoundaries: {
    allowHorror: true,
    allowPermanentDeath: false,
    allowRomance: true,
    allowBetrayal: true,
    excludedContent: [],
  },
};

describe('central prompt catalog', () => {
  it('has one versioned task prompt and history record for every AI task', () => {
    expect(Object.keys(TASK_PROMPTS)).toEqual(AI_TASKS);
    expect(PROMPT_HISTORY.slice(0, AI_TASKS.length).map(({ task }) => task)).toEqual(AI_TASKS);
    for (const task of AI_TASKS) {
      const expectedVersion = [
        'GENERATE_CHARACTER_TRAITS',
        'COMPLETE_CHARACTER_BACKGROUND',
        'GENERATE_NPCS',
        'NPC_REPLY',
        'GENERATE_WORLD_EVENT',
        'SUMMARIZE_ADVENTURE',
        'RESOLVE_DICE_RESULT',
      ].includes(task)
        ? 2
        : 1;
      expect(TASK_PROMPTS[task]).toMatchObject({
        task,
        version: task === 'GENERATE_ADVENTURE_TURN' ? 4 : expectedVersion,
      });
      expect(TASK_PROMPTS[task].instruction.length).toBeGreaterThan(20);
    }
    expect(PROMPT_HISTORY).toContainEqual(
      expect.objectContaining({ task: 'GENERATE_ADVENTURE_TURN', version: 4 }),
    );
    expect(TASK_PROMPTS.GENERATE_ADVENTURE_TURN.instruction).toMatch(/3-5 distinct suggestions/);
    expect(TASK_PROMPTS.GENERATE_ADVENTURE_TURN.instruction).toContain('knownFacts');
    expect(TASK_PROMPTS.GENERATE_ADVENTURE_TURN.instruction).toContain('npcKnowledge');
    expect(TASK_PROMPTS.RESOLVE_DICE_RESULT.instruction).toMatch(
      /raw, modifier, total, DC, and result/,
    );
  });

  it('centralizes authority, privacy, validation, and JSON rules', () => {
    expect(BASE_RULES.join(' ')).toMatch(/SQLite state are authoritative/);
    expect(BASE_RULES.join(' ')).toMatch(/never claim they are committed/);
    expect(BASE_RULES.join(' ')).toMatch(/API keys/);
    expect(BASE_RULES.join(' ')).toMatch(/exactly one JSON value/);
  });
});

describe('provider-neutral prompt formatting', () => {
  it('validates input and emits system/user messages with JSON Schema when supported', () => {
    const formatted = formatTaskPrompt('GENERATE_WORLD', worldInput, capabilities);

    expect(formatted.promptVersion).toBe(1);
    expect(formatted.messages.map(({ role }) => role)).toEqual(['SYSTEM', 'USER']);
    expect(formatted.messages[0]?.content).toContain('WORLD_DESIGNER');
    expect(formatted.messages[0]?.content).toContain('[SYSTEM_CONTRACT]');
    expect(formatted.messages[0]?.content).toContain('[STABLE_WORLD_TRUTHS]');
    expect(formatted.messages[1]?.content).toContain(canonicalJson(worldInput));
    expect(formatted.responseFormat).toMatchObject({
      kind: 'JSON_SCHEMA',
      name: 'generate_world_v1',
      schema: { type: 'object' },
    });
  });

  it('folds system rules into a user message for models without system-message support', () => {
    const formatted = formatTaskPrompt('GENERATE_WORLD', worldInput, {
      ...capabilities,
      systemMessages: false,
      jsonSchema: false,
      jsonMode: true,
    });

    expect(formatted.messages).toHaveLength(1);
    expect(formatted.messages[0]).toMatchObject({ role: 'USER' });
    expect(formatted.messages[0]?.content).toContain('SQLite state are authoritative');
    expect(formatted.responseFormat).toEqual({ kind: 'JSON_OBJECT' });
  });

  it('falls back to text format without claiming unsupported structured-output features', () => {
    const formatted = formatTaskPrompt('GENERATE_WORLD', worldInput, {
      ...capabilities,
      jsonSchema: false,
      jsonMode: false,
    });
    expect(formatted.responseFormat).toEqual({ kind: 'TEXT' });
  });

  it('rejects task input before rendering a provider prompt', () => {
    expect(() => formatTaskPrompt('GENERATE_WORLD', { concept: '' }, capabilities)).toThrow();
  });

  it('asks the original model for JSON-only repair while preserving the invalid output', () => {
    const formatted = formatOutputRepairPrompt(
      'GENERATE_WORLD',
      worldInput,
      '{"name":',
      {
        code: 'INVALID_JSON',
        issues: [{ path: [], code: 'invalid_json', message: 'Response is not valid JSON' }],
      },
      capabilities,
    );

    expect(formatted.messages.at(-2)).toEqual({ role: 'ASSISTANT', content: '{"name":' });
    expect(formatted.messages.at(-1)).toMatchObject({ role: 'USER' });
    expect(formatted.messages.at(-1)?.content).toMatch(/JSON only/);
    expect(formatted.messages.at(-1)?.content).toMatch(/Do not add new story facts/);
    expect(formatted.messages.at(-1)?.content).toContain('INVALID_JSON');
    expect(formatted.responseFormat.kind).toBe('JSON_SCHEMA');
  });
});

describe('stable prompt profile', () => {
  it('fixes the five required prefix sections and versions the profile', () => {
    const formatted = formatTaskPrompt('GENERATE_WORLD', worldInput, capabilities);
    expect(formatted.stableProfile).toMatchObject({
      id: STABLE_PROMPT_PROFILE_ID,
      version: STABLE_PROMPT_PROFILE_VERSION,
      task: 'GENERATE_WORLD',
      promptVersion: 1,
    });
    expect(formatted.stableProfile.sections.map(({ kind }) => kind)).toEqual(
      STABLE_PROMPT_SECTION_KINDS,
    );
    expect(formatted.stableProfile.sections[2]?.content).toMatchObject({ type: 'object' });
    expect(formatted.stableProfile.sections[3]?.content).toMatchObject({
      task: 'GENERATE_WORLD',
      logicalRole: 'WORLD_DESIGNER',
      stableProfileVersion: 1,
    });
  });

  it('rejects volatile request metadata and UUIDs from stable world truths', () => {
    const schema = { type: 'object' } as const;
    expect(() =>
      createStablePromptProfile(TASK_PROMPTS.GENERATE_WORLD, schema, {
        requestId: 'request-1',
      }),
    ).toThrow('not allowed');
    expect(() =>
      createStablePromptProfile(TASK_PROMPTS.GENERATE_WORLD, schema, {
        world: '00000000-0000-4000-8000-000000000001',
      }),
    ).toThrow('UUID');
  });

  it('renders canonical JSON with fixed LF separators and no trailing newline', () => {
    const profile = createStablePromptProfile(
      TASK_PROMPTS.GENERATE_WORLD,
      { required: ['z', 'a'], type: 'object' },
      { z: 'line one\r\nline two', a: 1, enumValue: 'LOCKED' },
    );
    const rendered = renderStablePromptProfile(profile);
    expect(rendered).not.toContain('\r');
    expect(rendered.endsWith('\n')).toBe(false);
    expect(rendered).toContain('[OUTPUT_SCHEMA]\n{"required":["z","a"],"type":"object"}');
    expect(rendered).toContain(
      '[STABLE_WORLD_TRUTHS]\n{"a":1,"enumValue":"LOCKED","z":"line one\\nline two"}',
    );
  });

  it('places semi-stable context before dynamic context and task input', async () => {
    const summary = await createContextBlock({
      id: 'summary-1',
      type: 'summary',
      content: { summary: 'The beacon failed.' },
      sourceId: 'campaign-a',
      sourceRevision: 2,
      stability: 'semi_stable',
      priority: 10,
      tokenBudget: 100,
      privacyClass: 'game_private',
      version: 1,
    });
    const action = await createContextBlock({
      id: 'action-1',
      type: 'action',
      content: { action: 'Inspect the beacon.' },
      sourceId: 'turn-a',
      sourceRevision: 7,
      stability: 'dynamic',
      priority: 10,
      tokenBudget: 100,
      privacyClass: 'game_private',
      version: 1,
    });
    const layout = createContextCacheLayout(
      assembleContextBlocks(
        [summary, action].map((block) => ({ block, relevance: 1, required: true })),
        { maxTokens: 1_000, typeOrder: ['summary', 'action'] },
      ),
    );
    const formatted = formatTaskPrompt('GENERATE_WORLD', worldInput, capabilities, {
      stableWorldTruths: { setting: 'Beacon Coast' },
      cacheLayout: layout,
    });
    const content = formatted.messages[1]?.content ?? '';
    expect(content.indexOf('[LONG_TERM_SUMMARY]')).toBeLessThan(
      content.indexOf('[RECENT_HISTORY]'),
    );
    expect(content.indexOf('[RECENT_HISTORY]')).toBeLessThan(content.indexOf('[PLAYER_ACTION]'));
    expect(content.indexOf('[PLAYER_ACTION]')).toBeLessThan(content.indexOf('[TASK_INPUT]'));
    expect(formatted.messages[0]?.content).toContain(
      '[STABLE_WORLD_TRUTHS]\n{"setting":"Beacon Coast"}',
    );
    await expect(promptCachePrefixHash(formatted.stableProfile, layout)).resolves.toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});
