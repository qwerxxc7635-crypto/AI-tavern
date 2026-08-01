import { AI_TASKS, type ModelCapabilities } from '@ember-tavern/ai-core';
import { isoTimestamp } from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import {
  BASE_RULES,
  PROMPT_HISTORY,
  TASK_PROMPTS,
  formatOutputRepairPrompt,
  formatTaskPrompt,
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
        'GENERATE_WORLD_EVENT',
        'SUMMARIZE_ADVENTURE',
      ].includes(task)
        ? 2
        : 1;
      expect(TASK_PROMPTS[task]).toMatchObject({
        task,
        version: expectedVersion,
      });
      expect(TASK_PROMPTS[task].instruction.length).toBeGreaterThan(20);
    }
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
    expect(formatted.messages[1]?.content).toContain(JSON.stringify(worldInput));
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
