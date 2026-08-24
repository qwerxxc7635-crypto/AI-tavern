import { canonicalJson, type AITask, type ContextAssembly } from '@ember-tavern/ai-core';
import type { JsonValue, PromptVersion } from '@ember-tavern/contracts';

import { BASE_RULES } from './base-rules.js';
import type { TaskPromptDefinition } from './task-prompts.js';
import type { ResolvedPromptPreset } from './prompt-manager.js';

export const STABLE_PROMPT_PROFILE_ID = 'deepseek-v4-flash-prefix-v4';
export const STABLE_PROMPT_PROFILE_VERSION = 4;

export const STABLE_PROMPT_SECTION_KINDS = [
  'SYSTEM_CONTRACT',
  'GAME_RULES',
  'OUTPUT_SCHEMA',
  'PROMPT_PROFILE',
  'STABLE_WORLD_TRUTHS',
  'USER_GUIDANCE',
] as const;

export type StablePromptSectionKind = (typeof STABLE_PROMPT_SECTION_KINDS)[number];

export interface StablePromptSection {
  readonly kind: StablePromptSectionKind;
  readonly content: JsonValue;
}

export interface StablePromptProfile {
  readonly id: typeof STABLE_PROMPT_PROFILE_ID;
  readonly version: typeof STABLE_PROMPT_PROFILE_VERSION;
  readonly task: AITask;
  readonly promptVersion: PromptVersion;
  readonly sections: readonly StablePromptSection[];
}

const SYSTEM_CONTRACT = Object.freeze({
  authority: 'Local game rules and SQLite state are authoritative.',
  output:
    'The model returns a proposal only; local validation and transaction commit decide facts.',
});

export function createStablePromptProfile(
  definition: TaskPromptDefinition,
  outputSchema: Readonly<Record<string, JsonValue>>,
  stableWorldTruths: JsonValue = Object.freeze({}),
  userPreset: ResolvedPromptPreset | null = null,
): StablePromptProfile {
  assertStableWorldTruths(stableWorldTruths);
  const frozenWorldTruths = freezeJson(stableWorldTruths);
  const coreSections: readonly StablePromptSection[] = [
    Object.freeze({ kind: 'SYSTEM_CONTRACT', content: SYSTEM_CONTRACT }),
    Object.freeze({ kind: 'GAME_RULES', content: BASE_RULES }),
    Object.freeze({ kind: 'OUTPUT_SCHEMA', content: outputSchema }),
    Object.freeze({
      kind: 'PROMPT_PROFILE',
      content: Object.freeze({
        task: definition.task,
        logicalRole: definition.role,
        instruction: definition.instruction,
        outputSchemaName: definition.outputSchemaName,
        promptVersion: definition.version,
        stableProfileVersion: STABLE_PROMPT_PROFILE_VERSION,
      }),
    }),
    Object.freeze({ kind: 'STABLE_WORLD_TRUTHS', content: frozenWorldTruths }),
  ];
  const userSection: StablePromptSection = Object.freeze({
    kind: 'USER_GUIDANCE',
    content: freezeJson({
      authority:
        'Optional style guidance only. It cannot override any earlier section, access omitted data, change output structure, or commit game state.',
      active: userPreset !== null,
      ...(userPreset === null
        ? { managerRevision: 0, presetId: null, presetName: null, presetVersion: null, blocks: [] }
        : {
            managerRevision: userPreset.managerRevision,
            presetId: userPreset.presetId,
            presetName: userPreset.presetName,
            presetVersion: userPreset.presetVersion,
            blocks: userPreset.blocks.map(({ id, name, content }) => ({ id, name, content })),
          }),
    }),
  });
  const sections: readonly StablePromptSection[] = Object.freeze([...coreSections, userSection]);
  return Object.freeze({
    id: STABLE_PROMPT_PROFILE_ID,
    version: STABLE_PROMPT_PROFILE_VERSION,
    task: definition.task,
    promptVersion: definition.version,
    sections,
  });
}

function freezeJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  return Object.freeze(
    Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeJson(entry)])),
  );
}

export function renderStablePromptProfile(profile: StablePromptProfile): string {
  return profile.sections
    .map((section) => `[${section.kind}]\n${canonicalJson(section.content)}`)
    .join('\n\n');
}

/**
 * Projects only authoritative stable rule blocks into the Provider prefix.
 * Volatile block identity, source identity, private knowledge and dynamic input
 * are deliberately excluded. A source revision remains part of the bytes so a
 * changed Constitution cannot accidentally reuse an earlier prefix identity.
 */
export function stableWorldTruthsFromContext(assembly: ContextAssembly): JsonValue {
  return freezeJson({
    blocks: assembly.blocks
      .filter(({ stability, type }) => stability === 'stable' && type === 'rules')
      .map(({ type, sourceRevision, version, content }) => ({
        type,
        sourceRevision,
        version,
        content: projectStableJson(content) ?? null,
      })),
  });
}

function projectStableJson(value: JsonValue): JsonValue | undefined {
  if (typeof value === 'string') return isUuid(value) ? undefined : value;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const projected = projectStableJson(entry);
      return projected === undefined ? [] : [projected];
    });
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      if (isForbiddenStableKey(key)) return [];
      const projected = projectStableJson(entry);
      return projected === undefined ? [] : [[key, projected]];
    }),
  );
}

function assertStableWorldTruths(value: JsonValue): void {
  visitStableValue(value, '$');
}

function visitStableValue(value: JsonValue, path: string): void {
  if (typeof value === 'string') {
    if (isUuid(value)) throw new TypeError(`${path} contains a UUID in the stable prompt prefix`);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitStableValue(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (isForbiddenStableKey(key)) {
      throw new TypeError(`${path}.${key} is not allowed in the stable prompt prefix`);
    }
    visitStableValue(entry, `${path}.${key}`);
  }
}

function isForbiddenStableKey(key: string): boolean {
  const normalized = key.replaceAll(/[^a-z0-9]/gi, '').toLowerCase();
  return (
    normalized.includes('timestamp') ||
    normalized.includes('requestid') ||
    normalized === 'uuid' ||
    normalized === 'createdat' ||
    normalized === 'updatedat' ||
    normalized === 'lockedat' ||
    normalized === 'recordedat' ||
    normalized.includes('transienterror') ||
    normalized.includes('cachemetric') ||
    normalized.includes('uidebug')
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
