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
    'Create a coherent original world from the player concept, preferences, and boundaries. First define the complete structured World Constitution; make every world field obey it. Faction and location names must each be unique. Every parentName must be null or exactly match another generated location name, never itself. Every factionNames entry must exactly match a generated faction name. Do not pre-generate careers, equipment, NPCs, or quests.',
    2,
  ),
  REFINE_WORLD: define(
    'REFINE_WORLD',
    'WORLD_DESIGNER',
    'Revise only what the instructions require. Keep the structured World Constitution and all world fields mutually consistent, preserve every locked field exactly, and summarize the actual changes.',
    2,
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
  GENERATE_QUICK_CHARACTER: define(
    'GENERATE_QUICK_CHARACTER',
    'WORLD_DESIGNER',
    'Turn the single player concept into one complete editable character that obeys the locked World Constitution, player boundaries, and every supplied extension definition. Select career.id, displayName, and legacyArchetype exactly from one supplied Career Pool entry; never invent or rename a career. Return narrative content and a unique attribute priority only; never assign money, status, derived values, equipment IDs, or mechanical bonuses. Use exactly two distinct narrative Traits for the current compatibility stage, fill every required extension field, and do not invent extension namespaces or keys.',
  ),
  EDIT_CHARACTER_DRAFT: define(
    'EDIT_CHARACTER_DRAFT',
    'WORLD_DESIGNER',
    'Edit only the exact targetPaths of the supplied universal character draft. Obey the locked World Constitution, content boundaries, extension definitions, and every locked field. FIELD with OPTIONS returns exactly three distinct candidates and no patch; every other operation returns a patch covering exactly the requested targets. Preserve value kinds, never invent paths, and never change age, attributes, derived values, skill numbers, wealth, equipment IDs, reputation, relationships, status, Trait type, Trait point values, mechanical bonuses, or any non-target field.',
  ),
  GENERATE_CAREER_POOL: define(
    'GENERATE_CAREER_POOL',
    'WORLD_DESIGNER',
    'Generate exactly requestedCount distinct careers for the requested rarity multiset. Every career must arise from the supplied locked Constitution, repeat its four exact Constitution evidence strings, include every structured field, and choose one legacyArchetype only as a compatibility projection. Never add attribute modifiers, numeric bonuses, money, damage, defense, or equipment instances. INITIAL creates the visible world Career Pool; RUNTIME_DISCOVERY adds only careers not present in existingCareerIds or existingCareerNames.',
  ),
  GENERATE_ITEMS: define(
    'GENERATE_ITEMS',
    'WORLD_DESIGNER',
    'Generate exactly requestedCount distinct semantic equipment candidates at requestedRarity. Names, descriptions, appearance, history, origin, narrative abilities, semantic effects, and balance tags are narrative only. Repeat the three locked Constitution evidence strings exactly. Use only supplied binding targets and allowed triggers, include at least the Quest and one NPC binding, and do not invent target IDs. Never assign or imply damage, defense, price, check modifiers, recovery values, uses, or any other numeric mechanic; the Rules Engine derives all mechanics locally. Do not duplicate existingItemIds or existingItemNames.',
  ),
  GENERATE_NPC_LOD: define(
    'GENERATE_NPC_LOD',
    'WORLD_DESIGNER',
    'Upgrade exactly one NPC by one LOD level. Repeat npcId, identityAnchor, populationRole, every existing non-null field, every existing list entry, and the three locked Constitution evidence strings exactly. Add only the fields unlocked by targetLod. Reference only IDs supplied in allowedReferences; references are selections, never new facts, memories, relationships, quests, items, secrets, or events. Do not downgrade, rename, replace, contradict, or rewrite the existing identity. LOD1 adds name, appearance, and current behavior; LOD2 adds career, personality, goals, authorized knowledge and relationships; LOD3 may add authorized memories, secret facts, quests, items, and experiences.',
  ),
  GENERATE_LOCATIONS: define(
    'GENERATE_LOCATIONS',
    'WORLD_DESIGNER',
    'Materialize exactly requestedCount locations around the supplied origin without expanding any other part of the world. Repeat the four locked Constitution evidence strings exactly. CHILDREN creates direct children whose parentLocationId is the origin ID. CONNECTED creates peers with the same parentLocationId as the origin and every new location must connect back to the origin. Use only allowed faction IDs and existing or newly returned location IDs in connections. Return distinct IDs and names not present in the existing lists. Every location must be detailed with atmosphere, at least one feature, and a current situation. Never generate a complete country, city, region, dungeon, or world map, and never create NPCs, factions, quests, items, rules, travel outcomes, or hidden facts.',
  ),
  GENERATE_FACTIONS: define(
    'GENERATE_FACTIONS',
    'WORLD_DESIGNER',
    'Activate exactly the requested existing factions without creating new identities. Repeat each supplied id, name, goal, player relation, established territory, established enemy and ally references, and the four locked Constitution evidence strings exactly. Add concrete resources, leadership, and one current action. Enemy and ally references must use only allowed faction IDs, be disjoint, never self-reference, and be reciprocal when both factions are in this batch. Territory may use only allowed location IDs and must retain every established territory. Do not assign numeric mechanics, change quests, move NPCs, write facts, spend Director budget, or execute faction actions.',
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
    'Reply only from this NPC perspective without repeating substantial phrases inside the response. Return 3-5 distinct suggested topics grounded in this NPC knowledge and the conversation; they are optional player suggestions with no extra authority. Treat only KNOWN Truth entries as objective, SUSPECTED Claims as uncertain, and BELIEVED Claims as the NPC subjective belief. Never infer omitted world facts, reveal another actor knowledge, or present a Claim as WorldTruth.',
    4,
  ),
  GENERATE_DIALOGUE_SUGGESTIONS: define(
    'GENERATE_DIALOGUE_SUGGESTIONS',
    'GAME_MASTER',
    'Create 3-5 distinct optional player dialogue suggestions using only the supplied player-visible world, participant, relationship, public transcript, and open-quest context. Every addressedNpcId must be null or exactly one supplied participant ID. Suggestions must fit the immediate conversation, must not reveal private NPC knowledge or hidden facts, must not invent outcomes, and never count as a submitted player action.',
  ),
  PROPOSE_TAVERN_SCENE_ACTION: define(
    'PROPOSE_TAVERN_SCENE_ACTION',
    'NPC_ACTOR',
    "Propose exactly one action for the supplied actor only. Use only that actor's authorized knowledge, memories, goals, and the public scene transcript. Never infer another participant's private motive, memory, secret, or knowledge. SPEAK, INTERRUPT, and INTERVENE require an utterance; SILENCE, EAVESDROP, and LEAVE require null. Cite only supplied knowledge IDs. The program validates and arbitrates all independent proposals locally; this proposal never mutates game state.",
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
