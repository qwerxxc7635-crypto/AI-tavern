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

const define = (
  task: AITask,
  role: AILogicalRole,
  instruction: string,
  version = 1,
): TaskPromptDefinition =>
  Object.freeze({
    task,
    version: promptVersion(version),
    role,
    outputSchemaName: `${task.toLowerCase()}_v${version}`,
    instruction,
  });

export const TASK_PROMPTS = Object.freeze({
  GENERATE_WORLD: define(
    'GENERATE_WORLD',
    'WORLD_DESIGNER',
    'Create a coherent original world from the player concept, preferences, and boundaries. Make every requested world field concrete and mutually consistent. Faction and location names must each be unique. Every parentName must be null or exactly match another generated location name, never itself. Every factionNames entry must exactly match a generated faction name.',
  ),
  REFINE_WORLD: define(
    'REFINE_WORLD',
    'WORLD_DESIGNER',
    'Revise only what the instructions require. Preserve every locked field exactly and summarize the actual changes.',
  ),
  GENERATE_CHARACTER_TRAITS: define(
    'GENERATE_CHARACTER_TRAITS',
    'WORLD_DESIGNER',
    'Create exactly six distinct narrative trait candidates that fit the character concept, class, goal, and story preferences. The player will choose exactly two.',
    2,
  ),
  COMPLETE_CHARACTER_BACKGROUND: define(
    'COMPLETE_CHARACTER_BACKGROUND',
    'WORLD_DESIGNER',
    'Complete a grounded character background that connects the existing concept, goal, and traits without changing them. Also provide one to four narrative initial equipment names and descriptions; the program assigns all mechanical effects.',
    2,
  ),
  GENERATE_TAVERN: define(
    'GENERATE_TAVERN',
    'WORLD_DESIGNER',
    'Create a memorable tavern rooted in the current region, including its long-term problem and a fully characterized owner.',
  ),
  GENERATE_NPCS: define(
    'GENERATE_NPCS',
    'WORLD_DESIGNER',
    'Create exactly three non-owner tavern NPCs: exactly two RESIDENT and exactly one TEMPORARY_VISITOR. Only the temporary visitor has a non-null visitReason. Give each a unique name and a distinct identity and personality archetype unlike existingNpcArchetypes, with independent motives, secrets, and speech. Do not repeat substantial phrases. Also create exactly three rumors whose sourceNpcName exactly matches one of the three generated NPC names. Classify each source as witness, hearsay, personal belief, or faction message and give the Claim confidence independently from its hidden veracity proposal.',
    4,
  ),
  NPC_REPLY: define(
    'NPC_REPLY',
    'NPC_ACTOR',
    'Reply only from this NPC perspective without repeating substantial phrases inside the response. Treat only KNOWN Truth entries as objective, SUSPECTED Claims as uncertain, and BELIEVED Claims as the NPC subjective belief. Never infer omitted world facts, reveal another actor knowledge, or present a Claim as WorldTruth.',
    3,
  ),
  GENERATE_QUEST: define(
    'GENERATE_QUEST',
    'WORLD_DESIGNER',
    'Create a short-session quest grounded in supplied facts and NPCs. expectedTurns min and max must both be between 8 and 12 inclusive, with max at least min. Its risk, reward, turn range, and recommended-attribute structure must differ from every recentQuestStructures entry, and its content must not repeat substantial phrases. relatedNpcIds may contain only exact IDs from availableNpcs; relatedFactIds must be empty because no fact IDs are supplied. Separate narrative content from program-controlled risk and reward proposals.',
    2,
  ),
  GENERATE_ADVENTURE_PLAN: define(
    'GENERATE_ADVENTURE_PLAN',
    'GAME_MASTER',
    'Create a hidden adventure skeleton with necessary clues, obstacles, possible endings, and a failure cost that supports the quest.',
  ),
  GENERATE_ADVENTURE_TURN: define(
    'GENERATE_ADVENTURE_TURN',
    'GAME_MASTER',
    'Resolve only the submitted intent from the supplied SceneFrame. ACTION changes the situation, DIALOGUE addresses a participant, and OBSERVE gathers perceivable information. For an active scene, return 3-5 distinct suggestions grounded jointly in the scene, quest, player character, knownFacts, and npcKnowledge; return none for ENDING. checkRequest must be non-null exactly when adventureState is CHECK_REQUIRED. speakerNpcIds may contain only exact NPC IDs supplied by the quest; discoveredClues may contain only exact titles supplied in the adventure plan. statePatchProposals must be empty unless proposing a new FACT; every FACT proposal has targetId null and a non-empty string payload.statement. Preserve authority boundaries and propose, but never apply, state changes.',
    4,
  ),
  RESOLVE_DICE_RESULT: define(
    'RESOLVE_DICE_RESULT',
    'GAME_MASTER',
    'Narrate the supplied immutable local dice result only after hard logic has fixed raw, modifier, total, DC, and result. Never reroll or change any of those five values. statePatchProposals must be empty unless proposing a new FACT; every FACT proposal has targetId null and a non-empty string payload.statement. Preserve authority boundaries and propose, but never apply, state changes.',
    3,
  ),
  GENERATE_WORLD_EVENT: define(
    'GENERATE_WORLD_EVENT',
    'WORLD_DESIGNER',
    'Create one world event consistent with known facts. Clock advances are proposals of exactly one step.',
    2,
  ),
  SUMMARIZE_ADVENTURE: define(
    'SUMMARIZE_ADVENTURE',
    'ARCHIVIST',
    'Compress the supplied adventure history without inventing events. Propose only related NPC mood and one-step relationship changes, one visible tavern consequence, the required quest outcome, and at most one narrative item reward; all state changes remain subject to local validation.',
    2,
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
