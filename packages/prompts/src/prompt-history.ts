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
  Object.freeze({
    task: 'SUMMARIZE_ADVENTURE',
    version: promptVersion(2),
    change:
      'Include locally validated settlement proposals, tavern consequences, and next directions.',
  }),
  Object.freeze({
    task: 'GENERATE_WORLD_EVENT',
    version: promptVersion(2),
    change: 'Build settlement world events from filtered clocks, factions, and recent events.',
  }),
  Object.freeze({
    task: 'GENERATE_ADVENTURE_TURN',
    version: promptVersion(2),
    change: 'Ground every turn in the persisted SceneFrame recovery and authority boundaries.',
  }),
  Object.freeze({
    task: 'GENERATE_ADVENTURE_TURN',
    version: promptVersion(3),
    change: 'Interpret explicit action, dialogue, and observation intent modes.',
  }),
  Object.freeze({
    task: 'GENERATE_ADVENTURE_TURN',
    version: promptVersion(4),
    change: 'Require 3-5 grounded and distinct suggestions for active scenes.',
  }),
]);
