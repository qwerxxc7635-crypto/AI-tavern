import { AI_TASKS, type AITask } from '@ember-tavern/ai-core';
import { promptVersion, type PromptVersion } from '@ember-tavern/contracts';

export interface PromptHistoryEntry {
  readonly task: AITask;
  readonly version: PromptVersion;
  readonly change: string;
}

const initial: readonly PromptHistoryEntry[] = AI_TASKS.map((task) =>
  Object.freeze({
    task,
    version: promptVersion(1),
    change: 'Initial v0.1 task prompt and structured-output contract.',
  }),
);

export const PROMPT_HISTORY: readonly PromptHistoryEntry[] = Object.freeze([
  ...initial,
  Object.freeze({
    task: 'GENERATE_CHARACTER_TRAITS',
    version: promptVersion(2),
    change: 'Generate six candidates so the player can choose exactly two.',
  }),
  Object.freeze({
    task: 'COMPLETE_CHARACTER_BACKGROUND',
    version: promptVersion(2),
    change: 'Generate narrative initial equipment while local rules retain mechanical authority.',
  }),
  Object.freeze({
    task: 'GENERATE_NPCS',
    version: promptVersion(2),
    change: 'Generate three attributed tavern rumors together with the initial NPC roster.',
  }),
]);
