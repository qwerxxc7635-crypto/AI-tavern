import type { z } from 'zod';

import type { AITask } from './protocol.js';
import {
  CareerInputSchema,
  CareerOutputSchema,
  FactionInputSchema,
  FactionOutputSchema,
  ItemInputSchema,
  ItemOutputSchema,
  LocationInputSchema,
  LocationOutputSchema,
  NpcLodInputSchema,
  NpcLodOutputSchema,
} from './entity-schemas.js';
import {
  CheckConsistencyInputSchema,
  CheckConsistencyOutputSchema,
  CombatContentTaskInputSchema,
  CombatContentTaskOutputSchema,
  EditCharacterDraftInputSchema,
  EditCharacterDraftOutputSchema,
  CompleteCharacterBackgroundInputSchema,
  CompleteCharacterBackgroundOutputSchema,
  ExtractMemoriesInputSchema,
  ExtractMemoriesOutputSchema,
  GenerateAdventurePlanInputSchema,
  GenerateAdventurePlanOutputSchema,
  GenerateAdventureTurnInputSchema,
  GenerateAdventureTurnOutputSchema,
  GenerateCharacterTraitsInputSchema,
  GenerateCharacterTraitsOutputSchema,
  GenerateQuickCharacterInputSchema,
  GenerateQuickCharacterOutputSchema,
  GenerateNpcsInputSchema,
  GenerateNpcsOutputSchema,
  GenerateQuestInputSchema,
  GenerateQuestOutputSchema,
  GenerateTavernInputSchema,
  GenerateTavernOutputSchema,
  GenerateWorldEventInputSchema,
  GenerateWorldEventOutputSchema,
  GenerateWorldInputSchema,
  GenerateWorldOutputSchema,
  NpcReplyInputSchema,
  NpcReplyOutputSchema,
  DialogueSuggestionInputSchema,
  DialogueSuggestionOutputSchema,
  ProposeTavernSceneActionInputSchema,
  ProposeTavernSceneActionOutputSchema,
  RefineWorldInputSchema,
  RefineWorldOutputSchema,
  ResolveDiceResultInputSchema,
  ResolveDiceResultOutputSchema,
  SummarizeAdventureInputSchema,
  SummarizeAdventureOutputSchema,
} from './task-schemas.js';

export interface AITaskSchemaDefinition {
  readonly schemaVersion: 1 | 2 | 3 | 4 | 5;
  readonly input: z.ZodType;
  readonly output: z.ZodType;
}

const definition = (
  input: z.ZodType,
  output: z.ZodType,
  schemaVersion: AITaskSchemaDefinition['schemaVersion'] = 1,
): AITaskSchemaDefinition => Object.freeze({ schemaVersion, input, output });

export const AI_TASK_SCHEMAS = Object.freeze({
  GENERATE_WORLD: definition(GenerateWorldInputSchema, GenerateWorldOutputSchema, 2),
  REFINE_WORLD: definition(RefineWorldInputSchema, RefineWorldOutputSchema, 2),
  GENERATE_CHARACTER_TRAITS: definition(
    GenerateCharacterTraitsInputSchema,
    GenerateCharacterTraitsOutputSchema,
    2,
  ),
  COMPLETE_CHARACTER_BACKGROUND: definition(
    CompleteCharacterBackgroundInputSchema,
    CompleteCharacterBackgroundOutputSchema,
    2,
  ),
  GENERATE_QUICK_CHARACTER: definition(
    GenerateQuickCharacterInputSchema,
    GenerateQuickCharacterOutputSchema,
  ),
  EDIT_CHARACTER_DRAFT: definition(EditCharacterDraftInputSchema, EditCharacterDraftOutputSchema),
  GENERATE_CAREER_POOL: definition(CareerInputSchema, CareerOutputSchema),
  GENERATE_ITEMS: definition(ItemInputSchema, ItemOutputSchema),
  GENERATE_NPC_LOD: definition(NpcLodInputSchema, NpcLodOutputSchema),
  GENERATE_LOCATIONS: definition(LocationInputSchema, LocationOutputSchema),
  GENERATE_FACTIONS: definition(FactionInputSchema, FactionOutputSchema),
  GENERATE_TAVERN: definition(GenerateTavernInputSchema, GenerateTavernOutputSchema),
  GENERATE_NPCS: definition(GenerateNpcsInputSchema, GenerateNpcsOutputSchema, 4),
  NPC_REPLY: definition(NpcReplyInputSchema, NpcReplyOutputSchema, 5),
  GENERATE_DIALOGUE_SUGGESTIONS: definition(
    DialogueSuggestionInputSchema,
    DialogueSuggestionOutputSchema,
  ),
  PROPOSE_TAVERN_SCENE_ACTION: definition(
    ProposeTavernSceneActionInputSchema,
    ProposeTavernSceneActionOutputSchema,
  ),
  GENERATE_QUEST: definition(GenerateQuestInputSchema, GenerateQuestOutputSchema, 3),
  GENERATE_ADVENTURE_PLAN: definition(
    GenerateAdventurePlanInputSchema,
    GenerateAdventurePlanOutputSchema,
  ),
  GENERATE_ADVENTURE_TURN: definition(
    GenerateAdventureTurnInputSchema,
    GenerateAdventureTurnOutputSchema,
    5,
  ),
  RESOLVE_DICE_RESULT: definition(ResolveDiceResultInputSchema, ResolveDiceResultOutputSchema, 2),
  GENERATE_WORLD_EVENT: definition(
    GenerateWorldEventInputSchema,
    GenerateWorldEventOutputSchema,
    2,
  ),
  SUMMARIZE_ADVENTURE: definition(SummarizeAdventureInputSchema, SummarizeAdventureOutputSchema, 2),
  EXTRACT_MEMORIES: definition(ExtractMemoriesInputSchema, ExtractMemoriesOutputSchema),
  CHECK_CONSISTENCY: definition(CheckConsistencyInputSchema, CheckConsistencyOutputSchema),
  COMBAT_CONTENT_GENERATION: definition(
    CombatContentTaskInputSchema,
    CombatContentTaskOutputSchema,
  ),
} satisfies Readonly<Record<AITask, AITaskSchemaDefinition>>);

export function taskSchemas(task: AITask): AITaskSchemaDefinition {
  return AI_TASK_SCHEMAS[task];
}
