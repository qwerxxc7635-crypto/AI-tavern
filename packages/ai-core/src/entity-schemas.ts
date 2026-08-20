import { z } from 'zod';

const VERSION = z.literal(1);
const id = z.string().trim().min(1).max(128);
const name = z.string().trim().min(1).max(120);
const label = z.string().trim().min(1).max(200);
const text = z.string().trim().min(1).max(4_000);
const shortList = z.array(label).max(24);
const idList = z.array(id).max(64);

const generationContext = z
  .object({
    worldId: id,
    constitutionRevision: z.number().int().min(1).max(1_000_000),
    contextSummary: text,
  })
  .strict();

const versioned = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ schemaVersion: VERSION, ...shape }).strict();

export const WorldConstitutionInputSchema = versioned({
  worldId: id,
  revision: z.number().int().min(1).max(1_000_000),
  worldConcept: text,
  contentBoundaries: shortList,
});

export const WorldConstitutionOutputSchema = versioned({
  worldType: name,
  era: name,
  technology: text,
  magic: text,
  peoples: shortList,
  society: text,
  politics: text,
  economy: text,
  combatScale: text,
  deathRules: text,
  careerRules: text,
  equipmentRules: text,
  npcRules: text,
  traitRules: text,
  taboos: shortList,
});

export const CareerInputSchema = versioned({
  context: generationContext,
  generationMode: z.enum(['INITIAL', 'RUNTIME_DISCOVERY']),
  requestedCount: z.number().int().min(1).max(24),
  requestedRarities: z
    .array(z.enum(['COMMON', 'UNCOMMON', 'RARE', 'SPECIAL']))
    .min(1)
    .max(24),
  existingCareerIds: idList,
  existingCareerNames: z.array(name).max(64),
});

const careerConstitutionEvidence = z
  .object({
    careerRules: text,
    society: text,
    technology: text,
    economy: text,
  })
  .strict();

const career = z
  .object({
    id,
    name,
    rarity: z.enum(['COMMON', 'UNCOMMON', 'RARE', 'SPECIAL']),
    role: text,
    skills: shortList,
    equipmentTags: shortList,
    socialPosition: text,
    relationshipHooks: shortList,
    risks: shortList,
    requirements: shortList,
    constitutionEvidence: careerConstitutionEvidence,
    legacyArchetype: z.enum(['WARRIOR', 'ROGUE', 'SCHOLAR', 'DIPLOMAT']),
  })
  .strict();

export const CareerOutputSchema = versioned({ careers: z.array(career).min(1).max(24) });

export const TraitInputSchema = versioned({
  context: generationContext,
  ownerConcept: text,
  requestedCount: z.number().int().min(1).max(12),
  existingTraitIds: idList,
});

const traitEffect = z
  .object({
    polarity: z.enum(['BENEFIT', 'DRAWBACK']),
    domain: z.enum(['COMBAT', 'SOCIAL', 'EXPLORATION', 'ECONOMY', 'NARRATIVE']),
    description: text,
    suggestedPoints: z.number().int().min(1).max(5),
  })
  .strict();

const trait = z
  .object({
    id,
    name,
    kind: z.enum(['BUFF', 'DEBUFF', 'MIXED', 'NARRATIVE']),
    description: text,
    triggers: shortList,
    effects: z.array(traitEffect).max(8),
  })
  .strict();

export const TraitOutputSchema = versioned({ traits: z.array(trait).min(1).max(12) });

export const ItemInputSchema = versioned({
  context: generationContext,
  purpose: text,
  requestedCount: z.number().int().min(1).max(24),
  requestedRarity: z.enum(['BASIC', 'NOTABLE', 'RARE', 'LEGENDARY']),
  source: z
    .object({
      kind: z.literal('QUEST_REWARD'),
      questId: id,
      adventureId: id,
    })
    .strict(),
  bindingTargets: z
    .array(
      z
        .object({
          kind: z.enum(['QUEST', 'NPC', 'WORLD_FACT']),
          targetId: id,
          allowedTriggers: z
            .array(
              z.enum(['QUEST_CONTEXT', 'NPC_RECOGNITION', 'FACT_EVIDENCE', 'RELATIONSHIP_HOOK']),
            )
            .min(1)
            .max(4),
          summary: text,
        })
        .strict(),
    )
    .min(2)
    .max(16),
  constitutionEvidence: z
    .object({ equipmentRules: text, technology: text, economy: text })
    .strict(),
  existingItemIds: idList,
  existingItemNames: z.array(name).max(64),
});

const itemBinding = z
  .object({
    kind: z.enum(['QUEST', 'NPC', 'WORLD_FACT']),
    targetId: id,
    trigger: z.enum(['QUEST_CONTEXT', 'NPC_RECOGNITION', 'FACT_EVIDENCE', 'RELATIONSHIP_HOOK']),
    summary: text,
  })
  .strict();

const item = z
  .object({
    id,
    name,
    description: text,
    category: z.enum(['WEAPON', 'ARMOR', 'TOOL', 'CONSUMABLE', 'CLUE', 'TREASURE', 'OTHER']),
    appearance: text,
    history: text,
    origin: text,
    narrativeAbilities: z.array(label).min(1).max(24),
    semanticEffects: z.array(label).min(1).max(24),
    balanceTags: z.array(label).min(1).max(24),
    bindings: z.array(itemBinding).min(2).max(16),
    constitutionEvidence: z
      .object({ equipmentRules: text, technology: text, economy: text })
      .strict(),
  })
  .strict();

export const ItemOutputSchema = versioned({ items: z.array(item).min(1).max(24) });

const locationConstitutionEvidence = z
  .object({ technology: text, magic: text, society: text, politics: text })
  .strict();

const locationKind = z.enum([
  'REGION',
  'COUNTRY',
  'CITY',
  'VILLAGE',
  'DISTRICT',
  'TAVERN',
  'SHOP',
  'RUIN',
  'DUNGEON',
  'SPECIAL',
]);

const locationContext = z
  .object({
    id,
    name,
    kind: locationKind,
    parentLocationId: id.nullable(),
    description: text,
  })
  .strict();

export const LocationInputSchema = versioned({
  context: generationContext,
  expansionMode: z.enum(['CHILDREN', 'CONNECTED']),
  originLocation: locationContext,
  requestedCount: z.number().int().min(1).max(8),
  existingLocationIds: idList,
  existingLocationNames: z.array(name).max(64),
  allowedFactionIds: idList,
  constitutionEvidence: locationConstitutionEvidence,
});

const location = z
  .object({
    id,
    name,
    kind: locationKind,
    parentLocationId: id.nullable(),
    description: text,
    atmosphere: text,
    features: shortList,
    factionIds: idList,
    connections: idList,
    currentSituation: text,
    constitutionEvidence: locationConstitutionEvidence,
  })
  .strict();

export const LocationOutputSchema = versioned({ locations: z.array(location).min(1).max(8) });

export const FactionInputSchema = versioned({
  context: generationContext,
  requestedCount: z.number().int().min(1).max(16),
  existingFactionIds: idList,
});

const faction = z
  .object({
    id,
    name,
    goal: text,
    resources: shortList,
    leadership: shortList,
    enemyFactionIds: idList,
    allyFactionIds: idList,
    territoryLocationIds: idList,
    currentAction: text,
    playerRelation: z.enum(['HOSTILE', 'WARY', 'NEUTRAL', 'FRIENDLY', 'ALLIED', 'UNKNOWN']),
  })
  .strict();

export const FactionOutputSchema = versioned({ factions: z.array(faction).min(1).max(16) });

const npcLodConstitutionEvidence = z
  .object({ npcRules: text, society: text, technology: text })
  .strict();

const npcLodFields = {
  npcId: id,
  lod: z.number().int().min(0).max(3),
  identityAnchor: id,
  populationRole: name,
  name: name.nullable(),
  appearance: text.nullable(),
  currentBehavior: text.nullable(),
  career: text.nullable(),
  personality: text.nullable(),
  goals: shortList,
  knowledgeFactIds: idList,
  relationshipNpcIds: idList,
  memoryIds: idList,
  secretFactIds: idList,
  questIds: idList,
  itemIds: idList,
  experienceEventIds: idList,
  constitutionEvidence: npcLodConstitutionEvidence,
} satisfies z.ZodRawShape;

const npcLod = z.object(npcLodFields).strict();

const npcLodReferences = z
  .object({
    knowledgeFactIds: idList,
    relationshipNpcIds: idList,
    memoryIds: idList,
    secretFactIds: idList,
    questIds: idList,
    itemIds: idList,
    experienceEventIds: idList,
  })
  .strict();

export const NpcLodInputSchema = versioned({
  context: generationContext,
  currentProfile: npcLod,
  targetLod: z.number().int().min(1).max(3),
  trigger: z.enum(['OBSERVED', 'INTERACTED', 'RECURRING']),
  allowedReferences: npcLodReferences,
  constitutionEvidence: npcLodConstitutionEvidence,
});

export const NpcLodOutputSchema = versioned({ npc: npcLod });

export const QuestGraphInputSchema = versioned({
  context: generationContext,
  requestedCount: z.number().int().min(1).max(24),
  existingQuestIds: idList,
  relevantEntityIds: idList,
});

const questNode = z
  .object({
    id,
    title: name,
    kind: z.enum([
      'WORLD',
      'NPC',
      'FACTION',
      'PERSONAL',
      'HIDDEN',
      'LONG_TERM',
      'URGENT',
      'EMERGENT',
    ]),
    state: z.enum([
      'HIDDEN',
      'DISCOVERED',
      'AVAILABLE',
      'ACTIVE',
      'BLOCKED',
      'UPDATED',
      'COMPLETED',
      'FAILED',
      'EXPIRED',
      'ABANDONED',
    ]),
    summary: text,
    objectives: shortList,
    entityIds: idList,
    consequenceTags: shortList,
  })
  .strict();

const questEdge = z
  .object({
    fromQuestId: id,
    toQuestId: id,
    kind: z.enum(['REQUIRES', 'UNLOCKS', 'BLOCKS', 'UPDATES', 'CONSEQUENCE']),
    condition: text,
  })
  .strict();

export const QuestGraphOutputSchema = versioned({
  quests: z.array(questNode).min(1).max(24),
  edges: z.array(questEdge).max(96),
});

export const DirectorActionInputSchema = versioned({
  context: generationContext,
  activeQuestIds: idList,
  availableBudgets: z
    .object({
      newEvents: z.number().int().min(0).max(16),
      highUrgencyEvents: z.number().int().min(0).max(8),
      npcInitiatives: z.number().int().min(0).max(32),
      backgroundChanges: z.number().int().min(0).max(32),
    })
    .strict(),
});

const directorAction = z
  .object({
    id,
    kind: z.enum([
      'WORLD_CHANGE',
      'NPC_ACTION',
      'FACTION_ACTION',
      'OPPORTUNITY',
      'FORESHADOW',
      'PRESSURE',
      'QUEST_UPDATE',
      'QUEST_EXPIRE',
    ]),
    actorEntityId: id.nullable(),
    targetEntityIds: idList,
    rationale: text,
    proposedEffects: shortList,
    urgency: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    cooldownKey: id,
  })
  .strict();

export const DirectorActionOutputSchema = versioned({
  actions: z.array(directorAction).max(32),
});

export const STRUCTURED_ENTITY_KINDS = [
  'WORLD_CONSTITUTION',
  'CAREER',
  'TRAIT',
  'ITEM',
  'LOCATION',
  'FACTION',
  'NPC_LOD',
  'QUEST_GRAPH',
  'DIRECTOR_ACTION',
] as const;

export type StructuredEntityKind = (typeof STRUCTURED_ENTITY_KINDS)[number];

export interface StructuredEntitySchemaDefinition {
  readonly schemaVersion: 1;
  readonly input: z.ZodType;
  readonly output: z.ZodType;
}

const definition = (input: z.ZodType, output: z.ZodType): StructuredEntitySchemaDefinition =>
  Object.freeze({ schemaVersion: 1, input, output });

export const STRUCTURED_ENTITY_SCHEMAS = Object.freeze({
  WORLD_CONSTITUTION: definition(WorldConstitutionInputSchema, WorldConstitutionOutputSchema),
  CAREER: definition(CareerInputSchema, CareerOutputSchema),
  TRAIT: definition(TraitInputSchema, TraitOutputSchema),
  ITEM: definition(ItemInputSchema, ItemOutputSchema),
  LOCATION: definition(LocationInputSchema, LocationOutputSchema),
  FACTION: definition(FactionInputSchema, FactionOutputSchema),
  NPC_LOD: definition(NpcLodInputSchema, NpcLodOutputSchema),
  QUEST_GRAPH: definition(QuestGraphInputSchema, QuestGraphOutputSchema),
  DIRECTOR_ACTION: definition(DirectorActionInputSchema, DirectorActionOutputSchema),
} satisfies Readonly<Record<StructuredEntityKind, StructuredEntitySchemaDefinition>>);

export function structuredEntitySchemas(
  kind: StructuredEntityKind,
): StructuredEntitySchemaDefinition {
  return STRUCTURED_ENTITY_SCHEMAS[kind];
}

export type WorldConstitutionInput = z.infer<typeof WorldConstitutionInputSchema>;
export type WorldConstitutionOutput = z.infer<typeof WorldConstitutionOutputSchema>;
export type CareerInput = z.infer<typeof CareerInputSchema>;
export type CareerOutput = z.infer<typeof CareerOutputSchema>;
export type TraitInput = z.infer<typeof TraitInputSchema>;
export type TraitOutput = z.infer<typeof TraitOutputSchema>;
export type ItemInput = z.infer<typeof ItemInputSchema>;
export type ItemOutput = z.infer<typeof ItemOutputSchema>;
export type LocationInput = z.infer<typeof LocationInputSchema>;
export type LocationOutput = z.infer<typeof LocationOutputSchema>;
export type FactionInput = z.infer<typeof FactionInputSchema>;
export type FactionOutput = z.infer<typeof FactionOutputSchema>;
export type NpcLodInput = z.infer<typeof NpcLodInputSchema>;
export type NpcLodOutput = z.infer<typeof NpcLodOutputSchema>;
export type QuestGraphInput = z.infer<typeof QuestGraphInputSchema>;
export type QuestGraphOutput = z.infer<typeof QuestGraphOutputSchema>;
export type DirectorActionInput = z.infer<typeof DirectorActionInputSchema>;
export type DirectorActionOutput = z.infer<typeof DirectorActionOutputSchema>;
