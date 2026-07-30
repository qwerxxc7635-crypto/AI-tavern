import type { JsonValue } from '@ember-tavern/contracts';
import { z } from 'zod';

const text = z.string().trim().min(1).max(4_000);
const shortText = z.string().trim().min(1).max(200);
const identifier = z.string().trim().min(1).max(200);
const stringList = z.array(text).max(30);
const identifierList = z.array(identifier).max(50);
const attribute = z.enum(['physique', 'agility', 'knowledge', 'charisma']);
const questRisk = z.enum(['LOW', 'MODERATE', 'HIGH', 'EXTREME']);
const rewardTier = z.enum(['BASIC', 'NOTABLE', 'RARE', 'LEGENDARY']);
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
const contentBoundaries = z
  .object({
    allowHorror: z.boolean(),
    allowPermanentDeath: z.boolean(),
    allowRomance: z.boolean(),
    allowBetrayal: z.boolean(),
    excludedContent: stringList,
  })
  .strict();
const factionDraft = z
  .object({ name: shortText, description: text, goals: stringList.min(1) })
  .strict();
const locationDraft = z
  .object({
    name: shortText,
    description: text,
    parentName: shortText.nullable(),
    factionNames: z.array(shortText).max(10),
  })
  .strict();
const worldDraftShape = {
  name: shortText,
  currentRegion: shortText,
  summary: text,
  coreConflict: text,
  technologyLevel: shortText,
  powerRules: stringList.min(1),
  factions: z.array(factionDraft).min(1).max(12),
  locations: z.array(locationDraft).min(1).max(30),
  narrativeStyle: text,
  forbiddenElements: stringList,
  tavernReason: text,
  storyHooks: stringList.min(1).max(12),
};
const worldContext = z
  .object({
    name: shortText,
    currentRegion: shortText,
    summary: text,
    coreConflict: text,
    technologyLevel: shortText,
    powerRules: stringList,
  })
  .strict();
const traitDraft = z.object({ name: shortText, description: text }).strict();
const npcBrief = z
  .object({
    id: identifier,
    name: shortText,
    identity: shortText,
    personality: text,
    goal: text,
    currentMood: shortText,
  })
  .strict();
const relationship = z
  .object({
    trust: z.number().int().min(-5).max(5),
    closeness: z.number().int().min(-5).max(5),
    awe: z.number().int().min(-5).max(5),
    obligation: z.number().int().min(-5).max(5),
  })
  .strict();
const questContent = z
  .object({ title: shortText, summary: text, objective: text, failureCost: text })
  .strict();
const turnRange = z
  .object({
    min: z.number().int().min(1).max(20),
    max: z.number().int().min(1).max(20),
  })
  .strict();
const statePatchProposal = z
  .object({
    kind: z.enum(['QUEST', 'RELATIONSHIP', 'FACT', 'CLOCK', 'ITEM_REWARD']),
    targetId: identifier.nullable(),
    rationale: text,
    payload: z.record(z.string(), jsonValueSchema),
  })
  .strict();

export const GenerateWorldInputSchema = z
  .object({ concept: text, storyPreferences: stringList, contentBoundaries })
  .strict();
export const GenerateWorldOutputSchema = z.object(worldDraftShape).strict();

export const RefineWorldInputSchema = z
  .object({
    world: z.object(worldDraftShape).strict(),
    revisionInstructions: stringList.min(1),
    lockedFields: z.array(
      z.enum([
        'name',
        'currentRegion',
        'summary',
        'coreConflict',
        'technologyLevel',
        'powerRules',
        'narrativeStyle',
        'forbiddenElements',
        'tavernReason',
      ]),
    ),
  })
  .strict();
export const RefineWorldOutputSchema = z
  .object({ world: z.object(worldDraftShape).strict(), changeSummary: stringList.min(1) })
  .strict();

export const GenerateCharacterTraitsInputSchema = z
  .object({
    concept: text,
    classArchetype: z.enum(['WARRIOR', 'ROGUE', 'SCHOLAR', 'DIPLOMAT']),
    personalGoal: text,
    storyPreferences: stringList,
  })
  .strict();
export const GenerateCharacterTraitsOutputSchema = z
  .object({ traits: z.tuple([traitDraft, traitDraft]) })
  .strict();

export const CompleteCharacterBackgroundInputSchema = z
  .object({
    name: shortText,
    concept: text,
    classDisplayName: shortText,
    personalGoal: text,
    traits: z.tuple([traitDraft, traitDraft]),
  })
  .strict();
export const CompleteCharacterBackgroundOutputSchema = z
  .object({
    birthplace: shortText,
    formativeExperience: text,
    adventureMotivation: text,
    secret: text,
    importantPerson: text,
    tavernArrivalReason: text,
  })
  .strict();

export const GenerateTavernInputSchema = z
  .object({ world: worldContext, playerConcept: text, desiredPosition: shortText.nullable() })
  .strict();
export const GenerateTavernOutputSchema = z
  .object({
    name: shortText,
    position: shortText,
    environment: text,
    specialRules: stringList,
    longTermProblem: text,
    owner: z
      .object({
        name: shortText,
        identity: shortText,
        appearance: text,
        personality: text,
        goal: text,
        secret: text,
        speechStyle: text,
        currentMood: shortText,
      })
      .strict(),
  })
  .strict();

export const GenerateNpcsInputSchema = z
  .object({
    world: worldContext,
    tavern: z
      .object({
        name: shortText,
        position: shortText,
        environment: text,
        longTermProblem: text,
      })
      .strict(),
    existingNpcNames: z.array(shortText).max(20),
    requestedCount: z.number().int().min(1).max(8),
  })
  .strict();
export const GenerateNpcsOutputSchema = z
  .object({
    npcs: z
      .array(
        z
          .object({
            residency: z.enum(['RESIDENT', 'TEMPORARY_VISITOR']),
            name: shortText,
            identity: shortText,
            appearance: text,
            personality: text,
            goal: text,
            secret: text,
            speechStyle: text,
            currentMood: shortText,
            visitReason: text.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();

export const NpcReplyInputSchema = z
  .object({
    worldSummary: text,
    npc: npcBrief,
    relationship,
    knownFacts: stringList,
    falseBeliefs: stringList,
    recentMessages: z
      .array(z.object({ role: z.enum(['PLAYER', 'NPC']), content: text }).strict())
      .max(20),
    playerMessage: text,
  })
  .strict();
export const NpcReplyOutputSchema = z
  .object({
    reply: text,
    mood: shortText,
    suggestedTopics: stringList.max(5),
    memoryCandidate: text.nullable(),
    relationshipProposal: z
      .object({
        trust: z.number().int().min(-1).max(1).optional(),
        closeness: z.number().int().min(-1).max(1).optional(),
        awe: z.number().int().min(-1).max(1).optional(),
        obligation: z.number().int().min(-1).max(1).optional(),
      })
      .strict(),
  })
  .strict();

export const GenerateQuestInputSchema = z
  .object({
    world: worldContext,
    tavernName: shortText,
    publisher: npcBrief,
    availableNpcs: z.array(npcBrief).max(12),
    playerConcept: text,
    recentQuestTitles: z.array(shortText).max(20),
  })
  .strict();
export const GenerateQuestOutputSchema = z
  .object({
    content: questContent,
    risk: questRisk,
    recommendedAttributes: z.array(attribute).min(1).max(4),
    expectedTurns: turnRange,
    rewardTier,
    relatedNpcIds: identifierList,
    relatedFactIds: identifierList,
  })
  .strict()
  .refine((quest) => quest.expectedTurns.max >= quest.expectedTurns.min, {
    message: 'expectedTurns.max must be at least min',
    path: ['expectedTurns', 'max'],
  });

export const GenerateAdventurePlanInputSchema = z
  .object({
    world: worldContext,
    quest: z
      .object({ id: identifier, content: questContent, risk: questRisk, expectedTurns: turnRange })
      .strict(),
    playerSummary: text,
    relevantFacts: stringList,
  })
  .strict();
export const GenerateAdventurePlanOutputSchema = z
  .object({
    objective: text,
    risk: questRisk,
    expectedTurns: turnRange,
    coreScenes: stringList.min(1).max(20),
    necessaryClues: z
      .array(z.object({ title: shortText, description: text, isCore: z.boolean() }).strict())
      .max(20),
    majorObstacles: stringList.min(1).max(20),
    possibleEndings: stringList.min(1).max(12),
    failureCost: text,
  })
  .strict()
  .refine((plan) => plan.expectedTurns.max >= plan.expectedTurns.min, {
    message: 'expectedTurns.max must be at least min',
    path: ['expectedTurns', 'max'],
  });

export const GenerateAdventureTurnInputSchema = z
  .object({
    adventureId: identifier,
    objective: text,
    currentTurnNumber: z.number().int().min(0),
    currentScene: text,
    recentTurns: stringList.max(10),
    discoveredClues: stringList,
    playerAction: text,
  })
  .strict();
export const GenerateAdventureTurnOutputSchema = z
  .object({
    sceneText: text,
    speakerNpcIds: identifierList,
    suggestedActions: z.array(z.object({ text }).strict()).max(5),
    checkRequest: z
      .object({
        attribute,
        difficulty: z.union([z.literal(8), z.literal(11), z.literal(14), z.literal(17)]),
        reason: text,
      })
      .strict()
      .nullable(),
    discoveredClues: z.array(shortText).max(10),
    statePatchProposals: z.array(statePatchProposal).max(20),
    adventureState: z.enum(['SCENE', 'WAITING_FOR_PLAYER', 'CHECK_REQUIRED', 'ENDING']),
  })
  .strict();

export const ResolveDiceResultInputSchema = z
  .object({
    scene: text,
    action: text,
    attribute,
    difficulty: z.union([z.literal(8), z.literal(11), z.literal(14), z.literal(17)]),
    total: z.number().int(),
    success: z.boolean(),
  })
  .strict();
export const ResolveDiceResultOutputSchema = z
  .object({
    narration: text,
    consequence: text,
    statePatchProposals: z.array(statePatchProposal).max(10),
  })
  .strict();

export const GenerateWorldEventInputSchema = z
  .object({
    world: worldContext,
    activeClocks: z
      .array(
        z
          .object({
            id: identifier,
            name: shortText,
            current: z.number().int().min(0),
            max: z.number().int().min(1),
          })
          .strict(),
      )
      .max(20),
    recentFacts: stringList,
  })
  .strict();
export const GenerateWorldEventOutputSchema = z
  .object({
    title: shortText,
    description: text,
    newFacts: stringList.max(10),
    clockAdvances: z
      .array(z.object({ clockId: identifier, amount: z.literal(1), reason: text }).strict())
      .max(10),
  })
  .strict();

export const SummarizeAdventureInputSchema = z
  .object({
    questTitle: shortText,
    turnSummaries: stringList.min(1).max(100),
    ending: text.nullable(),
  })
  .strict();
export const SummarizeAdventureOutputSchema = z
  .object({
    summary: text,
    keyDecisions: stringList.max(20),
    unresolvedThreads: stringList.max(20),
  })
  .strict();

export const ExtractMemoriesInputSchema = z
  .object({ npc: npcBrief, turnIds: identifierList, transcript: stringList.min(1).max(100) })
  .strict();
export const ExtractMemoriesOutputSchema = z
  .object({
    memories: z
      .array(z.object({ summary: text, sourceTurnIds: identifierList.min(1) }).strict())
      .max(20),
  })
  .strict();

export const CheckConsistencyInputSchema = z
  .object({
    world: worldContext,
    lockedRules: stringList,
    knownFacts: stringList,
    proposedContent: text,
  })
  .strict();
export const CheckConsistencyOutputSchema = z
  .object({
    consistent: z.boolean(),
    issues: z
      .array(
        z
          .object({
            severity: z.enum(['WARNING', 'ERROR']),
            path: shortText,
            message: text,
          })
          .strict(),
      )
      .max(50),
  })
  .strict()
  .refine((result) => result.consistent === (result.issues.length === 0), {
    message: 'consistent must match whether issues are empty',
    path: ['consistent'],
  });
