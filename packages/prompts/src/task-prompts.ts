import { promptVersion, type PromptVersion } from '@ember-tavern/contracts';
import type { AITask } from '@ember-tavern/ai-core';

export type AILogicalRole = 'WORLD_DESIGNER' | 'GAME_MASTER' | 'NPC_ACTOR' | 'ARCHIVIST';

export interface TaskPromptDefinition {
  readonly task: AITask;
  readonly version: PromptVersion;
  readonly role: AILogicalRole;
  readonly outputSchemaName: string;
  readonly instruction: string;
}

const define = (task: AITask, role: AILogicalRole, instruction: string): TaskPromptDefinition =>
  Object.freeze({
    task,
    version: promptVersion(1),
    role,
    outputSchemaName: `${task.toLowerCase()}_v1`,
    instruction,
  });

export const TASK_PROMPTS = Object.freeze({
  GENERATE_WORLD: define(
    'GENERATE_WORLD',
    'WORLD_DESIGNER',
    'Create a coherent original world from the player concept, preferences, and boundaries. Make every requested world field concrete and mutually consistent.',
  ),
  REFINE_WORLD: define(
    'REFINE_WORLD',
    'WORLD_DESIGNER',
    'Revise only what the instructions require. Preserve every locked field exactly and summarize the actual changes.',
  ),
  GENERATE_CHARACTER_TRAITS: define(
    'GENERATE_CHARACTER_TRAITS',
    'WORLD_DESIGNER',
    'Create exactly two distinctive narrative traits that fit the character concept, class, goal, and story preferences.',
  ),
  COMPLETE_CHARACTER_BACKGROUND: define(
    'COMPLETE_CHARACTER_BACKGROUND',
    'WORLD_DESIGNER',
    'Complete a grounded character background that connects the existing concept, goal, and traits without changing them.',
  ),
  GENERATE_TAVERN: define(
    'GENERATE_TAVERN',
    'WORLD_DESIGNER',
    'Create a memorable tavern rooted in the current region, including its long-term problem and a fully characterized owner.',
  ),
  GENERATE_NPCS: define(
    'GENERATE_NPCS',
    'WORLD_DESIGNER',
    'Create the requested number of non-owner tavern NPCs. Give each independent motives, secrets, speech, and a valid residency-specific visit reason.',
  ),
  NPC_REPLY: define(
    'NPC_REPLY',
    'NPC_ACTOR',
    'Reply only from this NPC perspective and limited knowledge. Do not reveal excluded secrets or facts belonging only to other NPCs.',
  ),
  GENERATE_QUEST: define(
    'GENERATE_QUEST',
    'WORLD_DESIGNER',
    'Create a short-session quest grounded in supplied facts and NPCs. Separate narrative content from program-controlled risk and reward proposals.',
  ),
  GENERATE_ADVENTURE_PLAN: define(
    'GENERATE_ADVENTURE_PLAN',
    'GAME_MASTER',
    'Create a hidden adventure skeleton with necessary clues, obstacles, possible endings, and a failure cost that supports the quest.',
  ),
  GENERATE_ADVENTURE_TURN: define(
    'GENERATE_ADVENTURE_TURN',
    'GAME_MASTER',
    'Resolve only the submitted action into the next scene. Offer clear actions and propose, but never apply, state changes.',
  ),
  RESOLVE_DICE_RESULT: define(
    'RESOLVE_DICE_RESULT',
    'GAME_MASTER',
    'Narrate the supplied immutable local dice result. Never reroll, change the total, difficulty, or success value.',
  ),
  GENERATE_WORLD_EVENT: define(
    'GENERATE_WORLD_EVENT',
    'WORLD_DESIGNER',
    'Create one world event consistent with known facts. Clock advances are proposals of exactly one step.',
  ),
  SUMMARIZE_ADVENTURE: define(
    'SUMMARIZE_ADVENTURE',
    'ARCHIVIST',
    'Compress the supplied adventure history into durable facts, key decisions, and unresolved threads without inventing events.',
  ),
  EXTRACT_MEMORIES: define(
    'EXTRACT_MEMORIES',
    'ARCHIVIST',
    'Extract only memories relevant to the named NPC and cite the supplied source turn identifiers.',
  ),
  CHECK_CONSISTENCY: define(
    'CHECK_CONSISTENCY',
    'ARCHIVIST',
    'Compare proposed content with locked rules and known facts. Report precise contradictions and return no issues when it is consistent.',
  ),
} satisfies Readonly<Record<AITask, TaskPromptDefinition>>);

export function taskPrompt(task: AITask): TaskPromptDefinition {
  return TASK_PROMPTS[task];
}
