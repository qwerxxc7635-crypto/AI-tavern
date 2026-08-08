import {
  AI_TASK_SCHEMAS,
  canonicalJson,
  selectStructuredFormat,
  type AITask,
  type ContextCacheLayout,
  type ModelCapabilities,
  type NormalizedMessage,
  type NormalizedResponseFormat,
} from '@ember-tavern/ai-core';
import type { JsonValue, PromptVersion } from '@ember-tavern/contracts';
import { z } from 'zod';

import {
  createStablePromptProfile,
  renderStablePromptProfile,
  type StablePromptProfile,
} from './stable-prompt-profile.js';
import { taskPrompt } from './task-prompts.js';
import { renderContextCacheLayout } from './context-cache-renderer.js';

export interface FormattedTaskPrompt {
  readonly promptVersion: PromptVersion;
  readonly messages: readonly NormalizedMessage[];
  readonly responseFormat: NormalizedResponseFormat;
  readonly stableProfile: StablePromptProfile;
}

export interface StructuralRepairError {
  readonly code: string;
  readonly issues: readonly {
    readonly path: readonly (string | number)[];
    readonly code: string;
    readonly message: string;
  }[];
}

export interface PromptFormatContext {
  readonly stableWorldTruths?: JsonValue;
  readonly cacheLayout?: ContextCacheLayout;
}

export function formatTaskPrompt(
  task: AITask,
  input: unknown,
  capabilities: ModelCapabilities,
  context: PromptFormatContext = Object.freeze({}),
): FormattedTaskPrompt {
  const schemas = AI_TASK_SCHEMAS[task];
  const validatedInput = schemas.input.parse(input);
  const definition = taskPrompt(task);
  const outputSchema = jsonRecord(z.toJSONSchema(schemas.output));
  const stableProfile = createStablePromptProfile(
    definition,
    outputSchema,
    context.stableWorldTruths,
  );
  const system = renderStablePromptProfile(stableProfile);
  const user = [
    context.cacheLayout === undefined ? null : renderContextCacheLayout(context.cacheLayout),
    `[TASK_INPUT]\nTask input JSON:\n${canonicalJson(validatedInput as JsonValue)}`,
  ]
    .filter((part): part is string => part !== null)
    .join('\n\n');
  const messages: readonly NormalizedMessage[] = capabilities.systemMessages
    ? [
        { role: 'SYSTEM', content: system },
        { role: 'USER', content: user },
      ]
    : [{ role: 'USER', content: `${system}\n\n${user}` }];

  return Object.freeze({
    promptVersion: definition.version,
    messages: Object.freeze(messages),
    responseFormat: responseFormat(definition.outputSchemaName, schemas.output, capabilities),
    stableProfile,
  });
}

export function formatOutputRepairPrompt(
  task: AITask,
  input: unknown,
  invalidOutput: string,
  error: StructuralRepairError,
  capabilities: ModelCapabilities,
): FormattedTaskPrompt {
  const base = formatTaskPrompt(task, input, capabilities);
  const instruction = [
    'The previous response failed local structure validation.',
    'Repair that response into exactly one JSON value matching the requested schema.',
    'Preserve the original meaning. Do not add new story facts, state changes, or player actions.',
    'Return JSON only: no Markdown fences, commentary, apology, or explanation.',
    `Validation errors: ${JSON.stringify(error)}`,
  ].join('\n');
  return Object.freeze({
    ...base,
    messages: Object.freeze([
      ...base.messages,
      { role: 'ASSISTANT', content: invalidOutput } satisfies NormalizedMessage,
      { role: 'USER', content: instruction } satisfies NormalizedMessage,
    ]),
  });
}

function responseFormat(
  name: string,
  outputSchema: z.ZodType,
  capabilities: ModelCapabilities,
): NormalizedResponseFormat {
  const selected = selectStructuredFormat(capabilities);
  if (selected === 'JSON_SCHEMA') {
    return Object.freeze({
      kind: 'JSON_SCHEMA',
      name,
      schema: jsonRecord(z.toJSONSchema(outputSchema)),
    });
  }
  if (selected === 'JSON_OBJECT') return Object.freeze({ kind: 'JSON_OBJECT' });
  return Object.freeze({ kind: 'TEXT' });
}

function jsonRecord(value: unknown): Readonly<Record<string, JsonValue>> {
  const converted = jsonValue(value, '$');
  if (!isJsonObject(converted)) {
    throw new TypeError('Generated JSON Schema must be an object');
  }
  return converted;
}

function isJsonObject(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function jsonValue(value: unknown, path: string): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry, index) => jsonValue(entry, `${path}[${index}]`)));
  }
  if (typeof value === 'object') {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, jsonValue(entry, `${path}.${key}`)]),
      ),
    );
  }
  throw new TypeError(`${path} is not a JSON value`);
}
