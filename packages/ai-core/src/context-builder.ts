import { createClaimFromRumor } from '@ember-tavern/contracts';
import type {
  Adventure,
  AdventureActionMode,
  AdventureTurn,
  Clue,
  GameEvent,
  Message,
  NpcKnowledge,
  NpcMemory,
  NpcProfile,
  NpcRelationship,
  PlayerCharacter,
  Quest,
  SceneFrame,
  WorldBible,
  WorldFact,
} from '@ember-tavern/contracts';
import type { WorldClock } from '@ember-tavern/domain';
import type { z } from 'zod';

import type { AITask } from './protocol.js';
import {
  GenerateAdventureTurnInputSchema,
  GenerateWorldEventInputSchema,
  NpcReplyInputSchema,
} from './task-schemas.js';

export interface ContextBudget {
  readonly maxCharacters: number;
  readonly recentMessageLimit: number;
  readonly longTermMemoryLimit: number;
  readonly recentTurnLimit: number;
  readonly recentEventLimit: number;
  readonly historicalSummaryMaxCharacters: number;
}

export const DEFAULT_CONTEXT_BUDGET = Object.freeze({
  maxCharacters: 24_000,
  recentMessageLimit: 12,
  longTermMemoryLimit: 8,
  recentTurnLimit: 8,
  recentEventLimit: 10,
  historicalSummaryMaxCharacters: 4_000,
}) satisfies ContextBudget;

const COMPACT_CONTEXT_BUDGET = Object.freeze({
  maxCharacters: 12_000,
  recentMessageLimit: 8,
  longTermMemoryLimit: 6,
  recentTurnLimit: 6,
  recentEventLimit: 8,
  historicalSummaryMaxCharacters: 2_000,
}) satisfies ContextBudget;

const DIALOGUE_CONTEXT_BUDGET = Object.freeze({
  maxCharacters: 16_000,
  recentMessageLimit: 12,
  longTermMemoryLimit: 8,
  recentTurnLimit: 6,
  recentEventLimit: 8,
  historicalSummaryMaxCharacters: 3_000,
}) satisfies ContextBudget;

const ADVENTURE_CONTEXT_BUDGET = Object.freeze({
  maxCharacters: 22_000,
  recentMessageLimit: 8,
  longTermMemoryLimit: 6,
  recentTurnLimit: 8,
  recentEventLimit: 10,
  historicalSummaryMaxCharacters: 4_000,
}) satisfies ContextBudget;

export const TASK_CONTEXT_BUDGETS: Readonly<Record<AITask, ContextBudget>> = Object.freeze({
  GENERATE_WORLD: COMPACT_CONTEXT_BUDGET,
  REFINE_WORLD: COMPACT_CONTEXT_BUDGET,
  GENERATE_CHARACTER_TRAITS: COMPACT_CONTEXT_BUDGET,
  COMPLETE_CHARACTER_BACKGROUND: COMPACT_CONTEXT_BUDGET,
  GENERATE_TAVERN: COMPACT_CONTEXT_BUDGET,
  GENERATE_NPCS: COMPACT_CONTEXT_BUDGET,
  NPC_REPLY: DIALOGUE_CONTEXT_BUDGET,
  GENERATE_QUEST: COMPACT_CONTEXT_BUDGET,
  GENERATE_ADVENTURE_PLAN: ADVENTURE_CONTEXT_BUDGET,
  GENERATE_ADVENTURE_TURN: ADVENTURE_CONTEXT_BUDGET,
  RESOLVE_DICE_RESULT: COMPACT_CONTEXT_BUDGET,
  GENERATE_WORLD_EVENT: COMPACT_CONTEXT_BUDGET,
  SUMMARIZE_ADVENTURE: ADVENTURE_CONTEXT_BUDGET,
  EXTRACT_MEMORIES: DIALOGUE_CONTEXT_BUDGET,
  CHECK_CONSISTENCY: COMPACT_CONTEXT_BUDGET,
});

export function contextBudgetForTask(task: AITask): ContextBudget {
  return TASK_CONTEXT_BUDGETS[task];
}

export class ContextBuildError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ContextBuildError';
  }
}

export interface NpcDialogueContextSource {
  readonly world: WorldBible;
  readonly npc: NpcProfile;
  readonly knowledge: NpcKnowledge;
  readonly relationship: NpcRelationship;
  readonly facts: readonly WorldFact[];
  readonly messages: readonly Message[];
  readonly memories: readonly NpcMemory[];
  readonly playerMessage: string;
}

export interface AdventureContextSource {
  readonly world: WorldBible;
  readonly playerCharacter: PlayerCharacter;
  readonly quest: Quest;
  readonly adventure: Adventure;
  readonly currentScene: string;
  readonly turns: readonly AdventureTurn[];
  readonly clues: readonly Clue[];
  readonly relatedNpcs: readonly NpcProfile[];
  readonly worldFacts: readonly WorldFact[];
  readonly npcKnowledge: readonly NpcKnowledge[];
  readonly playerAction: string;
  readonly playerActionMode?: AdventureActionMode;
  readonly longTermSummary: string | null;
  readonly sceneFrame?: SceneFrame;
}

export interface WorldEventContextSource {
  readonly world: WorldBible;
  readonly clocks: readonly WorldClock[];
  readonly recentEvents: readonly GameEvent[];
  readonly currentChapter: string;
}

export type NpcDialogueContext = z.infer<typeof NpcReplyInputSchema>;
export type AdventureTurnContext = z.infer<typeof GenerateAdventureTurnInputSchema>;
export type WorldEventContext = z.infer<typeof GenerateWorldEventInputSchema>;

export function buildNpcDialogueContext(
  source: NpcDialogueContextSource,
  budget: ContextBudget = DEFAULT_CONTEXT_BUDGET,
): NpcDialogueContext {
  validateBudget(budget);
  if (
    source.npc.campaignId !== source.world.campaignId ||
    source.knowledge.npcId !== source.npc.id ||
    source.relationship.npcId !== source.npc.id
  ) {
    throw new ContextBuildError('NPC context sources must belong to the same NPC and campaign');
  }

  const excluded = new Set(source.knowledge.excludedSecretFactIds);
  const facts = new Map(
    source.facts
      .filter((fact) => fact.campaignId === source.world.campaignId && !excluded.has(fact.id))
      .map((fact) => [fact.id, fact]),
  );
  const usedKnowledgeIds = new Set<WorldFact['id']>();
  const knowledgeEntries = (
    ids: readonly WorldFact['id'][],
    state: 'KNOWN' | 'SUSPECTED' | 'BELIEVED',
  ) =>
    ids.flatMap((id) => {
      if (excluded.has(id)) return [];
      if (usedKnowledgeIds.has(id)) {
        throw new ContextBuildError('NPC knowledge cannot place one fact in multiple states');
      }
      const fact = facts.get(id);
      if (fact === undefined) {
        throw new ContextBuildError('NPC knowledge references an unavailable campaign fact');
      }
      if (state === 'BELIEVED') {
        if (fact.kind !== 'FALSE_BELIEF' || !fact.believedByNpcIds.includes(source.npc.id)) {
          throw new ContextBuildError('NPC false belief is not assigned to this actor');
        }
      } else if (fact.kind === 'FALSE_BELIEF') {
        throw new ContextBuildError('NPC false belief cannot be promoted to truth or suspicion');
      }
      if (fact.kind === 'RUMOR') createClaimFromRumor(fact);
      usedKnowledgeIds.add(id);
      return [
        {
          targetKind: state === 'KNOWN' && fact.kind !== 'RUMOR' ? 'TRUTH' : 'CLAIM',
          state,
          statement: fact.statement,
        } as const,
      ];
    });
  const actorKnowledge = [
    ...knowledgeEntries(source.knowledge.knownFactIds, 'KNOWN'),
    ...knowledgeEntries(source.knowledge.suspectedFactIds, 'SUSPECTED'),
    ...knowledgeEntries(source.knowledge.falseBeliefFactIds, 'BELIEVED'),
  ];
  let recentMessages = takeNewest(
    source.messages
      .filter(
        (message) =>
          message.role === 'PLAYER' ||
          (message.role === 'NPC' && message.speakerNpcId === source.npc.id),
      )
      .map((message) => ({ role: message.role as 'PLAYER' | 'NPC', content: message.content })),
    Math.min(budget.recentMessageLimit, 20),
  );
  const memoryHistory = source.memories
    .filter((memory) => memory.npcId === source.npc.id)
    .map((memory) => memory.summary);
  let longTermMemories = compressContextHistory(
    memoryHistory,
    Math.min(budget.longTermMemoryLimit, 29),
    budget.historicalSummaryMaxCharacters,
  );

  const build = () => ({
    worldSummary: source.world.summary,
    currentRegion: source.world.currentRegion,
    npc: {
      id: source.npc.id,
      name: source.npc.name,
      identity: source.npc.identity,
      personality: source.npc.personality,
      goal: source.npc.goal,
      currentMood: source.npc.currentMood,
      appearance: source.npc.appearance,
      secret: source.npc.secret,
      speechStyle: source.npc.speechStyle,
      currentStatus: source.npc.currentStatus,
    },
    relationship: {
      trust: source.relationship.trust,
      closeness: source.relationship.closeness,
      awe: source.relationship.awe,
      obligation: source.relationship.obligation,
    },
    knowledge: actorKnowledge,
    recentMessages,
    longTermMemories,
    playerMessage: source.playerMessage,
  });

  while (serializedLength(build()) > budget.maxCharacters) {
    const oldestMessageSize =
      recentMessages.length === 0 ? -1 : serializedLength(recentMessages[0]);
    const oldestMemorySize =
      longTermMemories.length === 0 ? -1 : serializedLength(longTermMemories[0]);
    if (oldestMessageSize < 0 && oldestMemorySize < 0) {
      throw new ContextBuildError('NPC context core fields exceed the character budget');
    }
    if (oldestMessageSize >= oldestMemorySize) recentMessages = recentMessages.slice(1);
    else longTermMemories = longTermMemories.slice(1);
  }
  return NpcReplyInputSchema.parse(build());
}

export function buildAdventureTurnContext(
  source: AdventureContextSource,
  budget: ContextBudget = DEFAULT_CONTEXT_BUDGET,
): AdventureTurnContext {
  validateBudget(budget);
  const campaign = source.world.campaignId;
  if (
    source.playerCharacter.campaignId !== campaign ||
    source.quest.campaignId !== campaign ||
    source.adventure.campaignId !== campaign ||
    source.adventure.questId !== source.quest.id
  ) {
    throw new ContextBuildError('Adventure context sources must belong to one campaign and quest');
  }

  const relatedIds = new Set(source.quest.relatedNpcIds);
  let relatedNpcs = source.relatedNpcs
    .filter((npc) => npc.campaignId === campaign && relatedIds.has(npc.id))
    .map((npc) => ({
      id: npc.id,
      name: npc.name,
      identity: npc.identity,
      personality: npc.personality,
      goal: npc.goal,
      currentMood: npc.currentMood,
    }));
  const sceneFrame = source.sceneFrame ?? deriveSceneFrame(source);
  const relatedNpcIds = new Set(relatedNpcs.map(({ id }) => id));
  const factById = new Map(
    source.worldFacts.filter((fact) => fact.campaignId === campaign).map((fact) => [fact.id, fact]),
  );
  let knownFacts = source.worldFacts
    .filter(
      (fact) =>
        fact.campaignId === campaign &&
        fact.kind !== 'FALSE_BELIEF' &&
        (fact.kind === 'LOCKED_RULE' || source.quest.relatedFactIds.includes(fact.id)),
    )
    .slice(0, 30)
    .map(({ id, kind, statement }) => ({ id, kind, statement }));
  let npcKnowledge = source.npcKnowledge
    .filter(({ npcId }) => relatedNpcIds.has(npcId))
    .slice(0, 12)
    .map((knowledge) => {
      const excluded = new Set(knowledge.excludedSecretFactIds);
      const statementsFor = (ids: NpcKnowledge['knownFactIds']) =>
        ids.flatMap((id) => {
          if (excluded.has(id)) return [];
          const fact = factById.get(id);
          return fact === undefined ? [] : [fact.statement];
        });
      return {
        npcId: knowledge.npcId,
        knownFacts: statementsFor(knowledge.knownFactIds),
        suspectedFacts: statementsFor(knowledge.suspectedFactIds),
        falseBeliefs: statementsFor(knowledge.falseBeliefFactIds),
      };
    });
  const turnHistory = source.turns
    .filter((turn) => turn.adventureId === source.adventure.id)
    .sort((left, right) => left.turnNumber - right.turnNumber)
    .map(summarizeTurn);
  let recentTurns = takeNewest(turnHistory, Math.min(budget.recentTurnLimit, 10));
  let longTermSummary = boundedSummary(
    [
      ...(source.longTermSummary === null ? [] : [source.longTermSummary]),
      ...turnHistory.slice(0, Math.max(0, turnHistory.length - recentTurns.length)),
    ],
    budget.historicalSummaryMaxCharacters,
  );
  let discoveredClues = source.clues
    .filter((clue) => clue.adventureId === source.adventure.id && clue.discoveredInTurnId !== null)
    .map((clue) => `${clue.title}: ${clue.description}`);
  const clueById = new Map(
    source.clues
      .filter((clue) => clue.adventureId === source.adventure.id)
      .map((clue) => [clue.id, clue]),
  );
  const plan = source.adventure.plan;
  const build = () => ({
    adventureId: source.adventure.id,
    worldRules: [...source.world.powerRules],
    playerCharacter: {
      id: source.playerCharacter.id,
      name: source.playerCharacter.name,
      concept: source.playerCharacter.concept,
      classDisplayName: source.playerCharacter.classDisplayName,
      attributes: { ...source.playerCharacter.attributes },
      traits: source.playerCharacter.traits.map(({ name, description }) => ({
        name,
        description,
      })),
      personalGoal: source.playerCharacter.personalGoal,
    },
    quest: {
      id: source.quest.id,
      content: { ...source.quest.content },
      status: source.quest.status,
      risk: source.quest.risk,
      rewardTier: source.quest.rewardTier,
    },
    adventurePlan: {
      objective: plan.objective,
      risk: plan.risk,
      expectedTurns: { ...plan.expectedTurns },
      coreScenes: [...plan.coreScenes],
      necessaryClues: plan.necessaryClueIds.flatMap((id) => {
        const clue = clueById.get(id);
        return clue === undefined ? [] : [`${clue.title}: ${clue.description}`];
      }),
      majorObstacles: [...plan.majorObstacles],
      possibleEndings: [...plan.possibleEndings],
      failureCost: plan.failureCost,
    },
    currentTurnNumber: source.adventure.currentTurnNumber,
    currentScene: source.currentScene,
    sceneFrame,
    longTermSummary,
    recentTurns,
    discoveredClues,
    relatedNpcs,
    knownFacts,
    npcKnowledge,
    playerActionMode: source.playerActionMode ?? 'ACTION',
    playerAction: source.playerAction,
  });

  while (serializedLength(build()) > budget.maxCharacters) {
    if (recentTurns.length > 0) recentTurns = recentTurns.slice(1);
    else if (relatedNpcs.length > 0) {
      const removedNpcId = relatedNpcs.at(-1)?.id;
      relatedNpcs = relatedNpcs.slice(0, -1);
      npcKnowledge = npcKnowledge.filter(({ npcId }) => npcId !== removedNpcId);
    } else if (npcKnowledge.length > 0) npcKnowledge = npcKnowledge.slice(0, -1);
    else if (knownFacts.length > 0) knownFacts = knownFacts.slice(0, -1);
    else if (discoveredClues.length > 0) discoveredClues = discoveredClues.slice(1);
    else if (longTermSummary !== null) {
      longTermSummary = shrinkSummary(longTermSummary);
    } else throw new ContextBuildError('Adventure context core fields exceed the character budget');
  }
  return GenerateAdventureTurnInputSchema.parse(build());
}

function deriveSceneFrame(source: AdventureContextSource): SceneFrame {
  const latest = source.turns
    .filter(({ adventureId }) => adventureId === source.adventure.id)
    .sort((left, right) => left.turnNumber - right.turnNumber)
    .at(-1);
  const location =
    source.adventure.plan.coreScenes[
      Math.min(
        Math.max(source.adventure.currentTurnNumber - 1, 0),
        source.adventure.plan.coreScenes.length - 1,
      )
    ] ?? source.currentScene;
  return Object.freeze({
    sceneId: `${source.adventure.id}:scene:${source.adventure.currentTurnNumber}`,
    location,
    participants: Object.freeze([
      source.playerCharacter.id,
      ...new Set(latest?.speakerNpcIds ?? []),
    ]),
    pressure: Object.freeze([]),
    affordances: Object.freeze(
      (latest?.suggestedActions ?? []).map(({ optionId, text }) =>
        Object.freeze({ id: optionId, label: text, preconditions: Object.freeze([]) }),
      ),
    ),
    pendingConsequences: Object.freeze(
      latest?.checkRequest === null || latest?.checkRequest === undefined
        ? []
        : [
            Object.freeze({
              id: latest.checkRequest.id,
              trigger: 'CHECK_REQUIRED',
              payload: {
                id: latest.checkRequest.id,
                turnId: latest.checkRequest.turnId,
                attribute: latest.checkRequest.attribute,
                difficulty: latest.checkRequest.difficulty,
                reason: latest.checkRequest.reason,
              },
            }),
          ],
    ),
    returnPoint: Object.freeze({
      eventId: latest?.id ?? source.adventure.id,
      summary: source.currentScene,
    }),
    revision: Math.max(source.adventure.currentTurnNumber + 1, 1),
  });
}

export function buildWorldEventContext(
  source: WorldEventContextSource,
  budget: ContextBudget = DEFAULT_CONTEXT_BUDGET,
): WorldEventContext {
  validateBudget(budget);
  let recentImportantEvents = takeNewest(
    source.recentEvents
      .filter((event) => event.campaignId === source.world.campaignId)
      .map((event) => `${event.type}: ${JSON.stringify(event.payload)}`),
    Math.min(budget.recentEventLimit, 30),
  );
  let factionStates = source.world.factions.map((faction) => ({
    id: faction.id,
    name: faction.name,
    goals: [...faction.goals],
    relations: faction.relations.map(
      (relation) => `${relation.factionId} ${relation.disposition}: ${relation.summary}`,
    ),
  }));
  const build = () => ({
    activeClocks: source.clocks
      .filter((clock) => clock.campaignId === source.world.campaignId)
      .map(({ id, name, current, max }) => ({ id, name, current, max })),
    factionStates,
    recentImportantEvents,
    currentChapter: source.currentChapter,
  });

  while (serializedLength(build()) > budget.maxCharacters) {
    if (recentImportantEvents.length > 0) recentImportantEvents = recentImportantEvents.slice(1);
    else if (factionStates.length > 0) factionStates = factionStates.slice(0, -1);
    else throw new ContextBuildError('World event context core fields exceed the character budget');
  }
  return GenerateWorldEventInputSchema.parse(build());
}

function summarizeTurn(turn: AdventureTurn): string {
  const action =
    turn.playerAction === null
      ? ''
      : ` Player: ${
          turn.playerAction.kind === 'SUGGESTED'
            ? turn.playerAction.text
            : turn.playerAction.kind === 'FREEFORM'
              ? turn.playerAction.text
              : turn.playerAction.kind === 'USE_ITEM'
                ? turn.playerAction.intent
                : turn.playerAction.reason
        }`;
  return `Turn ${turn.turnNumber}: ${turn.sceneText}${action}`;
}

function takeNewest<Value>(values: readonly Value[], limit: number): Value[] {
  return values.slice(Math.max(0, values.length - limit));
}

export function compressContextHistory(
  values: readonly string[],
  recentLimit: number,
  summaryMaxCharacters: number,
): readonly string[] {
  if (!Number.isSafeInteger(recentLimit) || recentLimit < 1) {
    throw new ContextBuildError('recentLimit must be a positive safe integer');
  }
  if (!Number.isSafeInteger(summaryMaxCharacters) || summaryMaxCharacters < 1) {
    throw new ContextBuildError('summaryMaxCharacters must be a positive safe integer');
  }
  const canonical = values.filter((value) => value.trim().length > 0);
  const recent = takeNewest(canonical, recentLimit);
  const older = canonical.slice(0, Math.max(0, canonical.length - recent.length));
  const prefix = 'Earlier history: ';
  const summary = boundedSummary(older, Math.max(1, summaryMaxCharacters - prefix.length));
  return Object.freeze([...(summary === null ? [] : [`${prefix}${summary}`]), ...recent]);
}

function boundedSummary(values: readonly string[], maxCharacters: number): string | null {
  if (values.length === 0) return null;
  const joined = values.map((value, index) => `${index + 1}. ${value}`).join(' | ');
  if (joined.length <= maxCharacters) return joined;
  const separator = ' … ';
  if (maxCharacters <= separator.length) return '…'.slice(0, maxCharacters);
  const available = maxCharacters - separator.length;
  const headLength = Math.ceil(available / 2);
  const tailLength = Math.floor(available / 2);
  return `${joined.slice(0, headLength)}${separator}${joined.slice(-tailLength)}`;
}

function shrinkSummary(value: string): string | null {
  if (value.length <= 64) return null;
  return `${value.slice(0, Math.max(63, Math.floor(value.length / 2)))}…`;
}

function serializedLength(value: unknown): number {
  return JSON.stringify(value).length;
}

function validateBudget(budget: ContextBudget): void {
  for (const [name, value] of Object.entries(budget)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new ContextBuildError(`${name} must be a positive safe integer`);
    }
  }
}
