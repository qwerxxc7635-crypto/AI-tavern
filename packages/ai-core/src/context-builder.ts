import type {
  Adventure,
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
  WorldBible,
  WorldFact,
} from '@ember-tavern/contracts';
import type { WorldClock } from '@ember-tavern/domain';
import type { z } from 'zod';

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
}

export const DEFAULT_CONTEXT_BUDGET = Object.freeze({
  maxCharacters: 24_000,
  recentMessageLimit: 12,
  longTermMemoryLimit: 8,
  recentTurnLimit: 8,
  recentEventLimit: 10,
}) satisfies ContextBudget;

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
  readonly playerAction: string;
  readonly longTermSummary: string | null;
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
      .map((fact) => [fact.id, fact.statement]),
  );
  const statements = (ids: readonly WorldFact['id'][]) =>
    ids.flatMap((id) => {
      const statement = facts.get(id);
      return statement === undefined ? [] : [statement];
    });
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
  let longTermMemories = takeNewest(
    source.memories
      .filter((memory) => memory.npcId === source.npc.id)
      .map((memory) => memory.summary),
    Math.min(budget.longTermMemoryLimit, 30),
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
    knownFacts: statements(source.knowledge.knownFactIds),
    suspectedFacts: statements(source.knowledge.suspectedFactIds),
    falseBeliefs: statements(source.knowledge.falseBeliefFactIds),
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
  let recentTurns = takeNewest(
    source.turns
      .filter((turn) => turn.adventureId === source.adventure.id)
      .sort((left, right) => left.turnNumber - right.turnNumber)
      .map(summarizeTurn),
    Math.min(budget.recentTurnLimit, 10),
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
    longTermSummary: source.longTermSummary,
    recentTurns,
    discoveredClues,
    relatedNpcs,
    playerAction: source.playerAction,
  });

  while (serializedLength(build()) > budget.maxCharacters) {
    if (recentTurns.length > 0) recentTurns = recentTurns.slice(1);
    else if (relatedNpcs.length > 0) relatedNpcs = relatedNpcs.slice(0, -1);
    else if (discoveredClues.length > 0) discoveredClues = discoveredClues.slice(1);
    else throw new ContextBuildError('Adventure context core fields exceed the character budget');
  }
  return GenerateAdventureTurnInputSchema.parse(build());
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
