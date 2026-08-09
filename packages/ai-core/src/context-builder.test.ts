import {
  actionOptionId,
  adventureId,
  campaignId,
  characterTraitId,
  clueId,
  conversationId,
  factionId,
  gameEventId,
  isoTimestamp,
  locationId,
  messageId,
  npcId,
  npcMemoryId,
  playerCharacterId,
  questId,
  schemaVersion,
  tavernId,
  turnId,
  worldClockId,
  worldFactId,
  type Adventure,
  type AdventureTurn,
  type GameEvent,
  type Message,
  type NpcKnowledge,
  type NpcMemory,
  type NpcProfile,
  type NpcRelationship,
  type PlayerCharacter,
  type Quest,
  type WorldBible,
  type WorldFact,
} from '@ember-tavern/contracts';
import type { WorldClock } from '@ember-tavern/domain';
import { describe, expect, it } from 'vitest';

import {
  AI_TASKS,
  buildAdventureTurnContext,
  buildNpcDialogueContext,
  buildWorldEventContext,
  compressContextHistory,
  contextBudgetForTask,
  ContextBuildError,
  GenerateAdventureTurnInputSchema,
  GenerateWorldEventInputSchema,
  NpcReplyInputSchema,
  type ContextBudget,
} from './index.js';

const campaign = campaignId('campaign-context');
const otherCampaign = campaignId('campaign-other');
const now = isoTimestamp('2026-07-31T00:40:00.000Z');
const targetNpcId = npcId('npc-target');
const unrelatedNpcId = npcId('npc-unrelated');
const playerId = playerCharacterId('player-context');
const targetFactId = worldFactId('fact-target');
const suspectedFactId = worldFactId('fact-suspected');
const falseFactId = worldFactId('fact-false');
const excludedFactId = worldFactId('fact-excluded-secret');
const unrelatedFactId = worldFactId('fact-unrelated-secret');

const world: WorldBible = {
  campaignId: campaign,
  schemaVersion: schemaVersion(1),
  name: 'Ember Coast',
  currentRegion: 'Ash Harbor',
  summary: 'A storm-bound coast linked by beacon roads.',
  coreConflict: 'The lighthouse fire is fading.',
  technologyLevel: 'Late medieval',
  powerRules: ['Magic always leaves a warm trace.'],
  factions: [
    {
      id: factionId('faction-lantern'),
      name: 'Lantern Guild',
      description: 'Navigators and beacon keepers.',
      goals: ['Restore the lighthouse.'],
      relations: [
        {
          factionId: factionId('faction-reef'),
          disposition: 'NEUTRAL',
          summary: 'Trade continues cautiously.',
        },
      ],
    },
  ],
  locations: [
    {
      id: locationId('location-harbor'),
      name: 'Ash Harbor',
      description: 'A sheltered port.',
      parentLocationId: null,
      factionIds: [factionId('faction-lantern')],
    },
  ],
  narrativeStyle: 'Grounded heroic fantasy.',
  forbiddenElements: [],
  tavernReason: 'Travelers wait for safe tides.',
  storyHooks: ['The lighthouse dims at moonrise.'],
  lockedFields: ['powerRules'],
  createdAt: now,
  updatedAt: now,
};
const targetNpc: NpcProfile = {
  id: targetNpcId,
  campaignId: campaign,
  tavernId: tavernId('tavern-context'),
  residency: 'OWNER',
  name: 'Ilyra',
  identity: 'Innkeeper',
  appearance: 'Tall, with a weathered red coat.',
  personality: 'Practical and observant.',
  goal: 'Keep the harbor road open.',
  secret: 'Ilyra knows the lighthouse tunnel.',
  speechStyle: 'Measured questions.',
  currentMood: 'Concerned',
  currentStatus: 'ACTIVE',
  createdAt: now,
  updatedAt: now,
};
const unrelatedNpc: NpcProfile = {
  ...targetNpc,
  id: unrelatedNpcId,
  name: 'Tomas',
  secret: 'Tomas sabotaged the old ferry.',
};
const relationship: NpcRelationship = {
  npcId: targetNpcId,
  playerCharacterId: playerId,
  trust: 1,
  closeness: 0,
  awe: 0,
  obligation: 0,
};
const knowledge: NpcKnowledge = {
  npcId: targetNpcId,
  knownFactIds: [targetFactId, excludedFactId],
  suspectedFactIds: [suspectedFactId],
  falseBeliefFactIds: [falseFactId],
  excludedSecretFactIds: [excludedFactId],
};
const facts: readonly WorldFact[] = [
  fact(targetFactId, 'The cellar door is warm.'),
  fact(suspectedFactId, 'The keeper may use the tunnel.'),
  fact(falseFactId, 'The tunnel ends beneath the market.'),
  fact(excludedFactId, 'The sealed ledger names Ilyra.'),
  fact(unrelatedFactId, 'Tomas sabotaged the old ferry.'),
];

const generousBudget: ContextBudget = {
  maxCharacters: 24_000,
  recentMessageLimit: 20,
  longTermMemoryLimit: 20,
  recentTurnLimit: 10,
  recentEventLimit: 20,
  historicalSummaryMaxCharacters: 4_000,
};

describe('AI context builders', () => {
  it('builds an NPC view without unrelated or explicitly excluded secrets', () => {
    const messages: readonly Message[] = [
      message(1, 'PLAYER', null, 'What is below the cellar?'),
      message(2, 'NPC', targetNpcId, 'An old passage.'),
      message(3, 'NPC', unrelatedNpcId, 'My secret should not cross conversations.'),
      message(4, 'SYSTEM', null, 'Internal orchestration note.'),
    ];
    const memories: readonly NpcMemory[] = [
      memory('memory-target', targetNpcId, 'The player previously helped Ilyra.'),
      memory('memory-other', unrelatedNpcId, 'Tomas distrusts the player.'),
    ];

    const context = buildNpcDialogueContext(
      {
        world,
        npc: targetNpc,
        knowledge,
        relationship,
        facts,
        messages,
        memories,
        playerMessage: 'Show me the old door.',
      },
      generousBudget,
    );

    expect(NpcReplyInputSchema.safeParse(context).success).toBe(true);
    expect(context.knownFacts).toEqual(['The cellar door is warm.']);
    expect(context.suspectedFacts).toEqual(['The keeper may use the tunnel.']);
    expect(context.falseBeliefs).toEqual(['The tunnel ends beneath the market.']);
    expect(context.recentMessages).toEqual([
      { role: 'PLAYER', content: 'What is below the cellar?' },
      { role: 'NPC', content: 'An old passage.' },
    ]);
    expect(context.longTermMemories).toEqual(['The player previously helped Ilyra.']);
    expect(JSON.stringify(context)).toContain(targetNpc.secret);
    expect(JSON.stringify(context)).not.toContain(unrelatedNpc.secret);
    expect(JSON.stringify(context)).not.toContain('sealed ledger');
  });

  it('combines long-term memory with recent dialogue and trims oldest optional context first', () => {
    const context = buildNpcDialogueContext(
      {
        world,
        npc: targetNpc,
        knowledge,
        relationship,
        facts,
        messages: [
          message(1, 'PLAYER', null, 'old-message-'.repeat(50)),
          message(2, 'NPC', targetNpcId, 'new-message'),
        ],
        memories: [
          memory('memory-old', targetNpcId, 'old-memory-'.repeat(50)),
          memory('memory-new', targetNpcId, 'new-memory'),
        ],
        playerMessage: 'Continue.',
      },
      { ...generousBudget, maxCharacters: 1_200 },
    );

    expect(context.recentMessages).toEqual([{ role: 'NPC', content: 'new-message' }]);
    expect(context.longTermMemories).toEqual(['new-memory']);
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(1_200);
    expect(() =>
      buildNpcDialogueContext(
        {
          world,
          npc: targetNpc,
          knowledge,
          relationship,
          facts,
          messages: [],
          memories: [],
          playerMessage: 'Continue.',
        },
        { ...generousBudget, maxCharacters: 10 },
      ),
    ).toThrow(ContextBuildError);
  });

  it('builds an adventure from only its related turns, clues and NPCs', () => {
    const quest = createQuest();
    const adventure = createAdventure(quest);
    const ownClueId = clueId('clue-lens');
    const context = buildAdventureTurnContext(
      {
        world,
        playerCharacter: createPlayer(),
        quest,
        adventure: {
          ...adventure,
          plan: { ...adventure.plan, necessaryClueIds: [ownClueId] },
        },
        currentScene: 'The lighthouse stair is flooded.',
        turns: [
          adventureTurn('turn-own-0', adventure.id, 0, 'Entered the old tunnel.'),
          adventureTurn('turn-own-1', adventure.id, 1, 'Opened the cellar.'),
          adventureTurn('turn-other', adventureId('adventure-other'), 99, 'Unrelated secret.'),
          adventureTurn('turn-own-2', adventure.id, 2, 'Crossed the causeway.'),
        ],
        clues: [
          {
            id: ownClueId,
            adventureId: adventure.id,
            title: 'Scorched Lens',
            description: 'Burned from within.',
            isCore: true,
            discoveredInTurnId: turnId('turn-own-2'),
          },
          {
            id: clueId('clue-other'),
            adventureId: adventureId('adventure-other'),
            title: 'Unrelated Clue',
            description: 'Must not appear.',
            isCore: false,
            discoveredInTurnId: turnId('turn-other'),
          },
        ],
        relatedNpcs: [targetNpc, unrelatedNpc],
        playerAction: 'Climb above the flood.',
        longTermSummary: 'The party followed the warm trail from the cellar.',
      },
      { ...generousBudget, recentTurnLimit: 2 },
    );

    expect(GenerateAdventureTurnInputSchema.safeParse(context).success).toBe(true);
    expect(context.recentTurns).toHaveLength(2);
    expect(context.recentTurns.join(' ')).not.toContain('Entered the old tunnel');
    expect(context.recentTurns.join(' ')).not.toContain('Unrelated secret');
    expect(context.discoveredClues).toEqual(['Scorched Lens: Burned from within.']);
    expect(context.relatedNpcs.map(({ id }) => id)).toEqual([targetNpcId]);
    expect(context.sceneFrame).toMatchObject({
      participants: [createPlayer().id],
      revision: adventure.currentTurnNumber + 1,
      returnPoint: { summary: 'The lighthouse stair is flooded.' },
    });
    expect(JSON.stringify(context)).not.toContain(targetNpc.secret);
    expect(context.longTermSummary).toContain('warm trail');
  });

  it('builds world events from campaign clocks, faction state, recent events and chapter', () => {
    const clocks: readonly WorldClock[] = [
      {
        id: worldClockId('clock-storm'),
        campaignId: campaign,
        name: 'Storm',
        current: 2,
        max: 6,
        stages: [],
      },
      {
        id: worldClockId('clock-other'),
        campaignId: otherCampaign,
        name: 'Other',
        current: 1,
        max: 4,
        stages: [],
      },
    ];
    const events: readonly GameEvent[] = [
      {
        id: gameEventId('event-old'),
        campaignId: campaign,
        schemaVersion: schemaVersion(1),
        type: 'WORLD_CREATED',
        payload: { worldName: 'Ember Coast' },
        occurredAt: now,
      },
      {
        id: gameEventId('event-other'),
        campaignId: otherCampaign,
        schemaVersion: schemaVersion(1),
        type: 'WORLD_CREATED',
        payload: { worldName: 'Other World' },
        occurredAt: now,
      },
    ];

    const context = buildWorldEventContext(
      {
        world,
        clocks,
        recentEvents: events,
        currentChapter: 'The storm closes around Ash Harbor.',
      },
      generousBudget,
    );

    expect(GenerateWorldEventInputSchema.safeParse(context).success).toBe(true);
    expect(context.activeClocks.map(({ id }) => id)).toEqual([worldClockId('clock-storm')]);
    expect(context.factionStates).toHaveLength(1);
    expect(context.recentImportantEvents).toEqual(['WORLD_CREATED: {"worldName":"Ember Coast"}']);
    expect(JSON.stringify(context)).not.toContain('Other World');
  });

  it('rejects mixed primary ownership instead of leaking cross-campaign state', () => {
    expect(() =>
      buildNpcDialogueContext(
        {
          world,
          npc: { ...targetNpc, campaignId: otherCampaign },
          knowledge,
          relationship,
          facts,
          messages: [],
          memories: [],
          playerMessage: 'Hello.',
        },
        generousBudget,
      ),
    ).toThrow('same NPC and campaign');
  });

  it('assigns a validated context budget to every AI task', () => {
    expect(AI_TASKS.map((task) => contextBudgetForTask(task))).toHaveLength(AI_TASKS.length);
    expect(contextBudgetForTask('NPC_REPLY').recentMessageLimit).toBe(12);
    expect(contextBudgetForTask('GENERATE_ADVENTURE_TURN').recentTurnLimit).toBe(8);
    expect(contextBudgetForTask('GENERATE_WORLD').maxCharacters).toBeLessThan(
      contextBudgetForTask('GENERATE_ADVENTURE_TURN').maxCharacters,
    );
  });

  it('compresses older NPC and adventure history while preserving bounded recent context', () => {
    const dialogueBudget = contextBudgetForTask('NPC_REPLY');
    const dialogue = buildNpcDialogueContext(
      {
        world,
        npc: targetNpc,
        knowledge,
        relationship,
        facts,
        messages: Array.from({ length: 80 }, (_, index) =>
          message(
            index + 1,
            index % 2 === 0 ? 'PLAYER' : 'NPC',
            index % 2 === 0 ? null : targetNpcId,
            `dialogue-marker-${index}-${'x'.repeat(120)}`,
          ),
        ),
        memories: Array.from({ length: 40 }, (_, index) =>
          memory(`memory-${index}`, targetNpcId, `memory-marker-${index}-${'y'.repeat(120)}`),
        ),
        playerMessage: 'Continue the long-running conversation.',
      },
      dialogueBudget,
    );
    expect(dialogue.recentMessages).toHaveLength(dialogueBudget.recentMessageLimit);
    expect(dialogue.recentMessages[0]?.content).toContain('dialogue-marker-68');
    expect(dialogue.longTermMemories).toHaveLength(dialogueBudget.longTermMemoryLimit + 1);
    expect(dialogue.longTermMemories[0]).toMatch(/^Earlier history:/);
    expect(dialogue.longTermMemories.at(-1)).toContain('memory-marker-39');
    expect(JSON.stringify(dialogue).length).toBeLessThanOrEqual(dialogueBudget.maxCharacters);

    const quest = createQuest();
    const adventure = createAdventure(quest);
    const adventureBudget = contextBudgetForTask('GENERATE_ADVENTURE_TURN');
    const adventureContext = buildAdventureTurnContext(
      {
        world,
        playerCharacter: createPlayer(),
        quest,
        adventure,
        currentScene: 'The road continues.',
        turns: Array.from({ length: 60 }, (_, index) =>
          adventureTurn(
            `turn-long-${index}`,
            adventure.id,
            index,
            `turn-marker-${index}-${'z'.repeat(150)}`,
          ),
        ),
        clues: [],
        relatedNpcs: [targetNpc],
        playerAction: 'Continue.',
        longTermSummary: 'A previous adventure restored the harbor road.',
      },
      adventureBudget,
    );
    expect(adventureContext.recentTurns).toHaveLength(adventureBudget.recentTurnLimit);
    expect(adventureContext.recentTurns[0]).toContain('turn-marker-52');
    expect(adventureContext.longTermSummary).toContain('previous adventure');
    expect(adventureContext.longTermSummary).not.toContain('turn-marker-40');
    expect(JSON.stringify(adventureContext).length).toBeLessThanOrEqual(
      adventureBudget.maxCharacters,
    );
  });

  it('keeps a bounded older-history digest plus the newest entries', () => {
    const compressed = compressContextHistory(
      Array.from({ length: 20 }, (_, index) => `entry-${index}-${'x'.repeat(40)}`),
      3,
      180,
    );
    expect(compressed).toHaveLength(4);
    expect(compressed[0]).toMatch(/^Earlier history: 1\. entry-0-/);
    expect(compressed[0]?.length).toBeLessThanOrEqual(180);
    expect(compressed.slice(1)).toEqual([
      `entry-17-${'x'.repeat(40)}`,
      `entry-18-${'x'.repeat(40)}`,
      `entry-19-${'x'.repeat(40)}`,
    ]);
  });
});

function fact(id: WorldFact['id'], statement: string): WorldFact {
  return {
    id,
    campaignId: campaign,
    kind: 'DEVELOPING_FACT',
    statement,
    locationId: null,
    factionIds: [],
    supersedesFactId: null,
    createdAt: now,
  };
}

function message(
  sequenceNumber: number,
  role: Message['role'],
  speakerNpcId: Message['speakerNpcId'],
  content: string,
): Message {
  return {
    id: messageId(`message-${sequenceNumber}`),
    conversationId: conversationId('conversation-target'),
    sequenceNumber,
    role,
    speakerNpcId,
    content,
    generationRecordId: null,
    createdAt: now,
  };
}

function memory(id: string, owner: NpcMemory['npcId'], summary: string): NpcMemory {
  return {
    id: npcMemoryId(id),
    npcId: owner,
    summary,
    sourceTurnIds: [],
    createdAt: now,
  };
}

function createPlayer(): PlayerCharacter {
  return {
    id: playerId,
    campaignId: campaign,
    name: 'Mira',
    gender: null,
    age: null,
    concept: 'Curious scout',
    storyPreferences: ['Mystery'],
    contentBoundaries: {
      allowHorror: true,
      allowPermanentDeath: false,
      allowRomance: true,
      allowBetrayal: true,
      excludedContent: [],
    },
    classArchetype: 'ROGUE',
    classDisplayName: 'Wayfinder',
    attributes: { physique: 2, agility: 3, knowledge: 3, charisma: 2 },
    traits: [
      {
        id: characterTraitId('trait-listener'),
        name: 'Keen Listener',
        description: 'Notices quiet changes.',
      },
      {
        id: characterTraitId('trait-roadwise'),
        name: 'Roadwise',
        description: 'Reads signs left by travelers.',
      },
    ],
    personalGoal: 'Find a lost sibling.',
    background: {
      birthplace: 'North Road',
      formativeExperience: 'Survived a winter crossing.',
      adventureMotivation: 'Protect travelers.',
      secret: 'Once followed a false beacon.',
      importantPerson: 'A missing sibling.',
      tavernArrivalReason: 'Following the last caravan.',
    },
    initialEquipment: [],
    createdAt: now,
    updatedAt: now,
  };
}

function createQuest(): Quest {
  return {
    id: questId('quest-context'),
    campaignId: campaign,
    publisherNpcId: targetNpcId,
    content: {
      title: 'The Fading Beacon',
      summary: 'Investigate the lighthouse.',
      objective: 'Restore the beacon.',
      failureCost: 'Ships remain trapped.',
    },
    status: 'ACTIVE',
    risk: 'MODERATE',
    recommendedAttributes: ['knowledge'],
    expectedTurns: { min: 8, max: 12 },
    rewardTier: 'NOTABLE',
    relatedNpcIds: [targetNpcId],
    relatedFactIds: [targetFactId],
    createdAt: now,
    updatedAt: now,
  };
}

function createAdventure(quest: Quest): Adventure {
  const id = adventureId('adventure-context');
  return {
    id,
    campaignId: campaign,
    questId: quest.id,
    state: 'SCENE',
    plan: {
      adventureId: id,
      objective: quest.content.objective,
      risk: quest.risk,
      expectedTurns: quest.expectedTurns,
      coreScenes: ['Reach the lighthouse.'],
      necessaryClueIds: [],
      majorObstacles: ['A flooded causeway.'],
      possibleEndings: ['Restore the beacon.'],
      failureCost: quest.content.failureCost,
    },
    currentTurnNumber: 3,
    createdAt: now,
    updatedAt: now,
  };
}

function adventureTurn(
  id: string,
  owner: AdventureTurn['adventureId'],
  turnNumber: number,
  sceneText: string,
): AdventureTurn {
  return {
    id: turnId(id),
    adventureId: owner,
    turnNumber,
    sceneText,
    speakerNpcIds: [],
    suggestedActions: [
      {
        kind: 'SUGGESTED',
        optionId: actionOptionId(`${id}-option`),
        text: 'Continue.',
      },
    ],
    playerAction: { kind: 'FREEFORM', text: 'Continue.' },
    checkRequest: null,
    diceResult: null,
    createdAt: now,
    resolvedAt: now,
  };
}
