import type { z } from 'zod';

import type { AITask } from './protocol.js';
import {
  CheckConsistencyInputSchema,
  CheckConsistencyOutputSchema,
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
  GENERATE_WORLD: definition(GenerateWorldInputSchema, GenerateWorldOutputSchema),
  REFINE_WORLD: definition(RefineWorldInputSchema, RefineWorldOutputSchema),
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
  GENERATE_TAVERN: definition(GenerateTavernInputSchema, GenerateTavernOutputSchema),
  GENERATE_NPCS: definition(GenerateNpcsInputSchema, GenerateNpcsOutputSchema, 4),
  NPC_REPLY: definition(NpcReplyInputSchema, NpcReplyOutputSchema, 3),
  GENERATE_QUEST: definition(GenerateQuestInputSchema, GenerateQuestOutputSchema, 2),
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
} satisfies Readonly<Record<AITask, AITaskSchemaDefinition>>);

export function taskSchemas(task: AITask): AITaskSchemaDefinition {
  return AI_TASK_SCHEMAS[task];
}
