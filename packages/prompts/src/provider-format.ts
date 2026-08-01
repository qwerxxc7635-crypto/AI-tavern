import {
  AI_TASK_SCHEMAS,
  selectStructuredFormat,
  type AITask,
  type ModelCapabilities,
  type NormalizedMessage,
  type NormalizedResponseFormat,
} from '@ember-tavern/ai-core';
import type { JsonValue, PromptVersion } from '@ember-tavern/contracts';
import { z } from 'zod';

import { BASE_SYSTEM_PROMPT } from './base-rules.js';
import { taskPrompt } from './task-prompts.js';

export interface FormattedTaskPrompt {
  readonly promptVersion: PromptVersion;
  readonly messages: readonly NormalizedMessage[];
  readonly responseFormat: NormalizedResponseFormat;
}

export function formatTaskPrompt(
  task: AITask,
  input: unknown,
  capabilities: ModelCapabilities,
): FormattedTaskPrompt {
  const schemas = AI_TASK_SCHEMAS[task];
  const validatedInput = schemas.input.parse(input);
  const definition = taskPrompt(task);
  const system = [
    BASE_SYSTEM_PROMPT,
    `Logical role: ${definition.role}.`,
    `Task instruction: ${definition.instruction}`,
  ].join('\n\n');
  const user = `Task input JSON:\n${JSON.stringify(validatedInput)}`;
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
