import { AI_TASKS, type AITask } from '@ember-tavern/ai-core';
import { promptVersion, type PromptVersion } from '@ember-tavern/contracts';

export interface PromptHistoryEntry {
  readonly task: AITask;
  readonly version: PromptVersion;
  readonly change: string;
}

export const PROMPT_HISTORY: readonly PromptHistoryEntry[] = Object.freeze(
  AI_TASKS.map((task) =>
    Object.freeze({
      task,
      version: promptVersion(1),
      change: 'Initial v0.1 task prompt and structured-output contract.',
    }),
  ),
);
