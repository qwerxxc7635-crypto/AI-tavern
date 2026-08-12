import type { JsonValue } from '@ember-tavern/contracts';
import { z } from 'zod';

import { findRepeatedNpcArchetype, findRepeatedPhrase } from './repetition-detector.js';

const text = z.string().trim().min(1).max(4_000);
const sceneText = z.string().trim().min(1).max(12_000);
const shortText = z.string().trim().min(1).max(200);
const identifier = z.string().trim().min(1).max(200);
const stringList = z.array(text).max(30);
const identifierList = z.array(identifier).max(50);
const attribute = z.enum(['physique', 'agility', 'knowledge', 'charisma']);
const adventureActionMode = z.enum(['ACTION', 'DIALOGUE', 'OBSERVE']);
const worldFactKind = z.enum([
  'LOCKED_RULE',
  'DEVELOPING_FACT',
  'TEMPORARY_NARRATIVE',
  'RUMOR',
  'FALSE_BELIEF',
]);
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
const worldDraft = z
  .object(worldDraftShape)
  .strict()
  .superRefine((world, context) => {
    const factionNames = new Set<string>();
    world.factions.forEach((faction, index) => {
      if (factionNames.has(faction.name)) {
        context.addIssue({
          code: 'custom',
          path: ['factions', index, 'name'],
          message: 'Faction names must be unique',
        });
      }
      factionNames.add(faction.name);
    });
    const locationNames = new Set<string>();
    world.locations.forEach((location, index) => {
      if (locationNames.has(location.name)) {
        context.addIssue({
          code: 'custom',
          path: ['locations', index, 'name'],
          message: 'Location names must be unique',
        });
      }
      locationNames.add(location.name);
    });
    world.locations.forEach((location, index) => {
      if (location.parentName === location.name) {
        context.addIssue({
          code: 'custom',
          path: ['locations', index, 'parentName'],
          message: 'A location cannot be its own parent',
        });
      } else if (location.parentName !== null && !locationNames.has(location.parentName)) {
        context.addIssue({
          code: 'custom',
          path: ['locations', index, 'parentName'],
          message: 'Location parentName must reference a generated location',
        });
      }
      location.factionNames.forEach((name, factionIndex) => {
        if (!factionNames.has(name)) {
          context.addIssue({
            code: 'custom',
            path: ['locations', index, 'factionNames', factionIndex],
            message: 'Location factionNames must reference a generated faction',
          });
        }
      });
    });
  });
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
const npcContextCard = npcBrief
  .extend({
    appearance: text,
    secret: text,
    speechStyle: text,
    currentStatus: z.enum(['ACTIVE', 'ABSENT', 'LEFT', 'DECEASED']),
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
const v02QuestTurnRange = z
  .object({
    min: z.number().int().min(8).max(12),
    max: z.number().int().min(8).max(12),
  })
  .strict();
const playerContext = z
  .object({
    id: identifier,
    name: shortText,
    concept: text,
    classDisplayName: shortText,
    attributes: z
      .object({
        physique: z.number().int().min(1).max(5),
        agility: z.number().int().min(1).max(5),
        knowledge: z.number().int().min(1).max(5),
        charisma: z.number().int().min(1).max(5),
      })
      .strict(),
    traits: z.array(traitDraft).length(2),
    personalGoal: text,
  })
  .strict();
const questContext = z
  .object({
    id: identifier,
    content: questContent,
    status: z.enum(['AVAILABLE', 'ACCEPTED', 'ACTIVE', 'COMPLETED', 'FAILED', 'ABANDONED']),
    risk: questRisk,
    rewardTier,
  })
  .strict();
const adventurePlanContext = z
  .object({
    objective: text,
    risk: questRisk,
    expectedTurns: v02QuestTurnRange,
    coreScenes: stringList.min(1).max(20),
    necessaryClues: stringList.max(20),
    majorObstacles: stringList.min(1).max(20),
    possibleEndings: stringList.min(1).max(12),
    failureCost: text,
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
export const GenerateWorldOutputSchema = worldDraft;

export const RefineWorldInputSchema = z
  .object({
    world: worldDraft,
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
  .object({ world: worldDraft, changeSummary: stringList.min(1) })
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
  .object({ traits: z.array(traitDraft).length(6) })
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
    initialEquipment: z
      .array(z.object({ name: shortText, description: text }).strict())
      .min(1)
      .max(4),
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
    existingNpcArchetypes: z.array(text).max(20),
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
    rumors: z
      .array(
        z
          .object({
            statement: text,
            sourceNpcName: shortText,
            sourceBasis: z.enum(['WITNESS', 'HEARSAY', 'PERSONAL_BELIEF', 'FACTION_MESSAGE']),
            confidence: z.number().min(0).max(1),
            veracity: z.enum(['UNKNOWN', 'TRUE', 'PARTIAL', 'FALSE']),
          })
          .strict(),
      )
      .length(3),
  })
  .strict()
  .superRefine((output, context) => {
    const names = new Set<string>();
    output.npcs.forEach((npc, index) => {
      if (names.has(npc.name)) {
        context.addIssue({
          code: 'custom',
          path: ['npcs', index, 'name'],
          message: 'NPC names must be unique',
        });
      }
      names.add(npc.name);
      const visitor = npc.residency === 'TEMPORARY_VISITOR';
      if (visitor !== (npc.visitReason !== null)) {
        context.addIssue({
          code: 'custom',
          path: ['npcs', index, 'visitReason'],
          message: 'Only temporary visitors require a visitReason',
        });
      }
    });
    if (
      output.npcs.length === 3 &&
      output.npcs.filter((npc) => npc.residency === 'RESIDENT').length !== 2
    ) {
      context.addIssue({
        code: 'custom',
        path: ['npcs'],
        message: 'Exactly two NPCs must be residents',
      });
    }
    if (
      output.npcs.length === 3 &&
      output.npcs.filter((npc) => npc.residency === 'TEMPORARY_VISITOR').length !== 1
    ) {
      context.addIssue({
        code: 'custom',
        path: ['npcs'],
        message: 'Exactly one NPC must be a temporary visitor',
      });
    }
    output.rumors.forEach((rumor, index) => {
      if (!names.has(rumor.sourceNpcName)) {
        context.addIssue({
          code: 'custom',
          path: ['rumors', index, 'sourceNpcName'],
          message: 'Rumor sourceNpcName must match a generated NPC name',
        });
      }
    });
    const archetype = findRepeatedNpcArchetype(output.npcs);
    if (archetype !== null) {
      context.addIssue({
        code: 'custom',
        path: ['npcs'],
        message: `repeated NPC archetype: ${archetype}`,
      });
    }
    const phrase = findRepeatedPhrase([
      ...output.npcs.flatMap((npc) => [
        npc.identity,
        npc.appearance,
        npc.personality,
        npc.goal,
        npc.secret,
        npc.speechStyle,
        npc.visitReason ?? '',
      ]),
      ...output.rumors.map((rumor) => rumor.statement),
    ]);
    if (phrase !== null) {
      context.addIssue({
        code: 'custom',
        path: ['npcs'],
        message: `repeated phrase: ${phrase}`,
      });
    }
  });

export const NpcReplyInputSchema = z
  .object({
    worldSummary: text,
    currentRegion: shortText,
    npc: npcContextCard,
    relationship,
    knowledge: z
      .array(
        z
          .object({
            targetKind: z.enum(['TRUTH', 'CLAIM']),
            state: z.enum(['KNOWN', 'SUSPECTED', 'BELIEVED']),
            statement: text,
          })
          .strict(),
      )
      .max(100),
    recentMessages: z
      .array(z.object({ role: z.enum(['PLAYER', 'NPC']), content: text }).strict())
      .max(12),
    longTermMemories: stringList.max(9),
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
        trust: z.number().int().min(-1).max(1).nullable().optional(),
        closeness: z.number().int().min(-1).max(1).nullable().optional(),
        awe: z.number().int().min(-1).max(1).nullable().optional(),
        obligation: z.number().int().min(-1).max(1).nullable().optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((output, context) => {
    const phrase = findRepeatedPhrase([
      output.reply,
      ...output.suggestedTopics,
      output.memoryCandidate ?? '',
    ]);
    if (phrase !== null) {
      context.addIssue({ code: 'custom', path: ['reply'], message: `repeated phrase: ${phrase}` });
    }
  });

export const GenerateQuestInputSchema = z
  .object({
    world: worldContext,
    tavernName: shortText,
    publisher: npcBrief,
    availableNpcs: z.array(npcBrief).max(12),
    playerConcept: text,
    recentQuestTitles: z.array(shortText).max(20),
    recentQuestStructures: z.array(shortText).max(20),
  })
  .strict();
export const GenerateQuestOutputSchema = z
  .object({
    content: questContent,
    risk: questRisk,
    recommendedAttributes: z.array(attribute).min(1).max(4),
    expectedTurns: v02QuestTurnRange,
    rewardTier,
    relatedNpcIds: identifierList,
    relatedFactIds: identifierList,
  })
  .strict()
  .refine((quest) => quest.expectedTurns.max >= quest.expectedTurns.min, {
    message: 'expectedTurns.max must be at least min',
    path: ['expectedTurns', 'max'],
  })
  .superRefine((quest, context) => {
    const phrase = findRepeatedPhrase([
      quest.content.title,
      quest.content.summary,
      quest.content.objective,
      quest.content.failureCost,
    ]);
    if (phrase !== null) {
      context.addIssue({
        code: 'custom',
        path: ['content'],
        message: `repeated phrase: ${phrase}`,
      });
    }
  });

export const GenerateAdventurePlanInputSchema = z
  .object({
    world: worldContext,
    quest: z
      .object({ id: identifier, content: questContent, risk: questRisk, expectedTurns: turnRange })
      .strict(),
    playerSummary: text,
    relevantFacts: stringList.max(30),
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

export const SceneFrameSchema = z
  .object({
    sceneId: identifier,
    location: text,
    participants: identifierList.min(1).max(30),
    pressure: z
      .array(z.object({ id: identifier, kind: shortText, level: z.number().int().min(0) }).strict())
      .max(30),
    affordances: z
      .array(z.object({ id: identifier, label: text, preconditions: stringList.max(20) }).strict())
      .max(10),
    pendingConsequences: z
      .array(z.object({ id: identifier, trigger: shortText, payload: jsonValueSchema }).strict())
      .max(20),
    returnPoint: z.object({ eventId: identifier, summary: sceneText }).strict(),
    revision: z.number().int().min(1),
  })
  .strict();

export const GenerateAdventureTurnInputSchema = z
  .object({
    adventureId: identifier,
    worldRules: stringList.min(1),
    playerCharacter: playerContext,
    quest: questContext,
    adventurePlan: adventurePlanContext,
    currentTurnNumber: z.number().int().min(0),
    currentScene: sceneText,
    sceneFrame: SceneFrameSchema,
    longTermSummary: text.nullable(),
    recentTurns: stringList.max(8),
    discoveredClues: stringList,
    relatedNpcs: z.array(npcBrief).max(12),
    knownFacts: z
      .array(z.object({ id: identifier, kind: worldFactKind, statement: text }).strict())
      .max(30),
    npcKnowledge: z
      .array(
        z
          .object({
            npcId: identifier,
            knownFacts: stringList,
            suspectedFacts: stringList,
            falseBeliefs: stringList,
          })
          .strict(),
      )
      .max(12),
    playerActionMode: adventureActionMode,
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
  .strict()
  .superRefine((output, context) => {
    if ((output.checkRequest !== null) !== (output.adventureState === 'CHECK_REQUIRED')) {
      context.addIssue({
        code: 'custom',
        path: ['checkRequest'],
        message: 'checkRequest must exist exactly when adventureState is CHECK_REQUIRED',
      });
    }
    output.statePatchProposals.forEach((proposal, index) => {
      if (
        proposal.kind !== 'FACT' ||
        proposal.targetId !== null ||
        typeof proposal.payload['statement'] !== 'string' ||
        proposal.payload['statement'].trim().length === 0
      ) {
        context.addIssue({
          code: 'custom',
          path: ['statePatchProposals', index],
          message: 'Adventure turns may only propose new FACT statements with a null targetId',
        });
      }
    });
    const count = output.suggestedActions.length;
    if (output.adventureState === 'ENDING' ? count !== 0 : count < 3 || count > 5) {
      context.addIssue({
        code: 'custom',
        path: ['suggestedActions'],
        message: 'Active scenes require 3-5 suggestions; endings require none',
      });
    }
    const normalized = output.suggestedActions.map(({ text }) => text.toLocaleLowerCase('zh-CN'));
    if (new Set(normalized).size !== normalized.length) {
      context.addIssue({
        code: 'custom',
        path: ['suggestedActions'],
        message: 'Suggested actions must be unique',
      });
    }
  });

export const ResolveDiceResultInputSchema = z
  .object({
    scene: text,
    action: text,
    attribute,
    raw: z.number().int().min(1).max(20),
    modifier: z.number().int(),
    total: z.number().int(),
    dc: z.union([z.literal(8), z.literal(11), z.literal(14), z.literal(17)]),
    result: z.enum(['SUCCESS', 'FAILURE']),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.raw + input.modifier !== input.total) {
      context.addIssue({
        code: 'custom',
        path: ['total'],
        message: 'total must equal raw plus modifier',
      });
    }
    const resultIsSuccess = input.result === 'SUCCESS';
    const totalMeetsDc = input.total >= input.dc;
    if (resultIsSuccess !== totalMeetsDc) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'result must be derived from total and DC',
      });
    }
  });
export const ResolveDiceResultOutputSchema = z
  .object({
    narration: text,
    consequence: text,
    statePatchProposals: z.array(statePatchProposal).max(10),
  })
  .strict()
  .superRefine((output, context) => {
    output.statePatchProposals.forEach((proposal, index) => {
      if (
        proposal.kind !== 'FACT' ||
        proposal.targetId !== null ||
        typeof proposal.payload['statement'] !== 'string' ||
        proposal.payload['statement'].trim().length === 0
      ) {
        context.addIssue({
          code: 'custom',
          path: ['statePatchProposals', index],
          message:
            'Dice resolution may only propose FACT patches with null targetId and a non-empty payload.statement',
        });
      }
    });
  });

export const GenerateWorldEventInputSchema = z
  .object({
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
    factionStates: z
      .array(
        z
          .object({
            id: identifier,
            name: shortText,
            goals: stringList,
            relations: stringList,
          })
          .strict(),
      )
      .max(12),
    recentImportantEvents: stringList.max(10),
    currentChapter: text,
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
    turnSummaries: stringList.min(1).max(9),
    ending: z.enum(['SUCCESS', 'PARTIAL_SUCCESS', 'FAILURE']),
    discoveredClues: stringList,
    relatedNpcs: z
      .array(z.object({ id: identifier, name: shortText, currentMood: shortText }).strict())
      .max(12),
  })
  .strict();
export const SummarizeAdventureOutputSchema = z
  .object({
    summary: text,
    keyDecisions: stringList.max(20),
    unresolvedThreads: stringList.max(20),
    nextDirections: stringList.max(10),
    npcUpdates: z
      .array(
        z
          .object({
            npcId: identifier,
            currentMood: shortText,
            relationshipPatch: z
              .object({
                trust: z.number().int().min(-1).max(1).optional(),
                closeness: z.number().int().min(-1).max(1).optional(),
                awe: z.number().int().min(-1).max(1).optional(),
                obligation: z.number().int().min(-1).max(1).optional(),
              })
              .strict()
              .refine((patch) => Object.keys(patch).length > 0, {
                message: 'relationshipPatch must change at least one dimension',
              }),
          })
          .strict(),
      )
      .max(12),
    tavernChange: z
      .object({
        kind: z.enum(['TROPHY', 'MENU', 'DAMAGE', 'DECORATION', 'LAYOUT', 'OTHER']),
        description: text,
      })
      .strict(),
    statePatchProposals: z.array(statePatchProposal).max(20),
  })
  .strict();

export const ExtractMemoriesInputSchema = z
  .object({ npc: npcBrief, turnIds: identifierList.max(50), transcript: stringList.min(1).max(13) })
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
    lockedRules: stringList.max(30),
    knownFacts: stringList.max(30),
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
