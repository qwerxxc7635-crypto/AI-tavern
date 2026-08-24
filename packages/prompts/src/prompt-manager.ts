import { AI_TASKS, type AITask } from '@ember-tavern/ai-core';
import { z } from 'zod';

export const PROMPT_PRESET_FORMAT = 'EMBER_PROMPT_PRESET';
export const PROMPT_PRESET_FORMAT_VERSION = 1;
export const MAX_PROMPT_PRESETS = 24;
export const MAX_PROMPT_BLOCKS = 8;

const identifier = z.string().trim().min(1).max(200);
const name = z.string().trim().min(1).max(80);
const content = z.string().trim().min(1).max(4_000);
const task = z.enum(AI_TASKS);

export const PromptUserBlockSchema = z
  .object({
    id: identifier,
    name,
    content,
    enabled: z.boolean(),
    tasks: z.array(task).max(AI_TASKS.length),
  })
  .strict();

export const PromptPresetSchema = z
  .object({
    id: identifier,
    name,
    version: z.number().int().min(1),
    blocks: z.array(PromptUserBlockSchema).max(MAX_PROMPT_BLOCKS),
  })
  .strict()
  .superRefine((preset, context) => {
    uniqueValues(
      preset.blocks.map(({ id }) => id),
      ['blocks'],
      'Prompt block IDs must be unique',
      context,
    );
    preset.blocks.forEach((block, index) =>
      uniqueValues(
        block.tasks,
        ['blocks', index, 'tasks'],
        'Prompt block tasks must be unique',
        context,
      ),
    );
  });

export const PromptManagerSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().min(0),
    activePresetId: identifier.nullable(),
    presets: z.array(PromptPresetSchema).max(MAX_PROMPT_PRESETS),
  })
  .strict()
  .superRefine((snapshot, context) => {
    uniqueValues(
      snapshot.presets.map(({ id }) => id),
      ['presets'],
      'Prompt preset IDs must be unique',
      context,
    );
    if (
      snapshot.activePresetId !== null &&
      !snapshot.presets.some(({ id }) => id === snapshot.activePresetId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['activePresetId'],
        message: 'Active prompt preset does not exist',
      });
    }
  });

export const PromptPresetBundleSchema = z
  .object({
    format: z.literal(PROMPT_PRESET_FORMAT),
    formatVersion: z.literal(PROMPT_PRESET_FORMAT_VERSION),
    preset: PromptPresetSchema,
  })
  .strict();

export interface PromptUserBlock {
  readonly id: string;
  readonly name: string;
  readonly content: string;
  readonly enabled: boolean;
  readonly tasks: readonly AITask[];
}

export interface PromptPreset {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly blocks: readonly PromptUserBlock[];
}

export interface PromptManagerSnapshot {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly activePresetId: string | null;
  readonly presets: readonly PromptPreset[];
}

export interface PromptPresetBundle {
  readonly format: typeof PROMPT_PRESET_FORMAT;
  readonly formatVersion: typeof PROMPT_PRESET_FORMAT_VERSION;
  readonly preset: PromptPreset;
}

export interface ResolvedPromptPreset {
  readonly managerRevision: number;
  readonly presetId: string;
  readonly presetName: string;
  readonly presetVersion: number;
  readonly blocks: readonly PromptUserBlock[];
}

export function parsePromptManagerSnapshot(value: unknown): PromptManagerSnapshot {
  return freezeSnapshot(PromptManagerSnapshotSchema.parse(value));
}

export function parsePromptPresetBundle(value: unknown): PromptPresetBundle {
  const parsed = PromptPresetBundleSchema.parse(value);
  return Object.freeze({
    ...parsed,
    preset: freezePreset(parsed.preset),
  });
}

export function resolvePromptPreset(
  snapshot: PromptManagerSnapshot,
  requestedTask: AITask,
): ResolvedPromptPreset | null {
  if (snapshot.activePresetId === null) return null;
  const preset = snapshot.presets.find(({ id }) => id === snapshot.activePresetId);
  if (preset === undefined) throw new TypeError('Active prompt preset is missing');
  const blocks = preset.blocks.filter(
    ({ enabled, tasks }) => enabled && (tasks.length === 0 || tasks.includes(requestedTask)),
  );
  return Object.freeze({
    managerRevision: snapshot.revision,
    presetId: preset.id,
    presetName: preset.name,
    presetVersion: preset.version,
    blocks: Object.freeze(blocks),
  });
}

function freezeSnapshot(snapshot: z.infer<typeof PromptManagerSnapshotSchema>) {
  return Object.freeze({
    ...snapshot,
    presets: Object.freeze(snapshot.presets.map(freezePreset)),
  });
}

function freezePreset(preset: z.infer<typeof PromptPresetSchema>) {
  return Object.freeze({
    ...preset,
    blocks: Object.freeze(
      preset.blocks.map((block) =>
        Object.freeze({ ...block, tasks: Object.freeze([...block.tasks]) }),
      ),
    ),
  });
}

function uniqueValues(
  values: readonly string[],
  path: readonly (string | number)[],
  message: string,
  context: z.RefinementCtx,
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: 'custom', path: [...path], message });
  }
}
