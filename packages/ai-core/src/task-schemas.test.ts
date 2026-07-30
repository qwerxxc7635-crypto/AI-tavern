import { describe, expect, it } from 'vitest';

import { AI_TASKS, AI_TASK_SCHEMAS, type AITask } from './index.js';

const boundaries = {
  allowHorror: true,
  allowPermanentDeath: false,
  allowRomance: true,
  allowBetrayal: true,
  excludedContent: [],
};
const world = {
  name: 'Ember Coast',
  currentRegion: 'Ash Harbor',
  summary: 'A storm-bound coast of old trade roads.',
  coreConflict: 'The lighthouse fire is fading.',
  technologyLevel: 'Late medieval',
  powerRules: ['Magic always leaves a warm trace.'],
};
const worldDraft = {
  ...world,
  factions: [
    {
      name: 'Lantern Guild',
      description: 'Harbor keepers and navigators.',
      goals: ['Restore the lighthouse.'],
    },
  ],
  locations: [
    {
      name: 'Ash Harbor',
      description: 'A sheltered port beneath black cliffs.',
      parentName: null,
      factionNames: ['Lantern Guild'],
    },
  ],
  narrativeStyle: 'Grounded heroic fantasy.',
  forbiddenElements: [],
  tavernReason: 'Travelers wait here for safe tides.',
  storyHooks: ['The lighthouse flame dims at every moonrise.'],
};
const npc = {
  id: 'npc-owner',
  name: 'Ilyra',
  identity: 'Innkeeper',
  personality: 'Practical and observant.',
  goal: 'Keep the harbor road open.',
  currentMood: 'Concerned',
};
const questContent = {
  title: 'The Fading Beacon',
  summary: 'Investigate the lighthouse.',
  objective: 'Restore the beacon flame.',
  failureCost: 'Ships remain trapped outside the harbor.',
};
const patch = {
  kind: 'FACT',
  targetId: null,
  rationale: 'The opened chamber becomes a persistent fact.',
  payload: { statement: 'The lighthouse chamber is open.' },
};
const questOutput = {
  content: questContent,
  risk: 'MODERATE',
  recommendedAttributes: ['knowledge'],
  expectedTurns: { min: 8, max: 12 },
  rewardTier: 'NOTABLE',
  relatedNpcIds: ['npc-owner'],
  relatedFactIds: [],
};
const adventureTurnOutput = {
  sceneText: 'Warm light leaks through the lock.',
  speakerNpcIds: [],
  suggestedActions: [{ text: 'Use a thin tool.' }],
  checkRequest: { attribute: 'knowledge', difficulty: 11, reason: 'Study the old lock.' },
  discoveredClues: ['The lock is warm from inside.'],
  statePatchProposals: [patch],
  adventureState: 'CHECK_REQUIRED',
};

const fixtures: Readonly<Record<AITask, Readonly<{ input: unknown; output: unknown }>>> = {
  GENERATE_WORLD: {
    input: {
      concept: 'Coastal fantasy',
      storyPreferences: ['Mystery'],
      contentBoundaries: boundaries,
    },
    output: worldDraft,
  },
  REFINE_WORLD: {
    input: {
      world: worldDraft,
      revisionInstructions: ['Make the guild more prominent.'],
      lockedFields: ['powerRules'],
    },
    output: { world: worldDraft, changeSummary: ['Expanded the guild role.'] },
  },
  GENERATE_CHARACTER_TRAITS: {
    input: {
      concept: 'Curious scout',
      classArchetype: 'ROGUE',
      personalGoal: 'Find a lost sibling.',
      storyPreferences: ['Exploration'],
    },
    output: {
      traits: [
        { name: 'Keen Listener', description: 'Notices quiet changes.' },
        { name: 'Roadwise', description: 'Reads signs left by travelers.' },
        { name: 'Steady Hands', description: 'Works calmly under pressure.' },
        { name: 'Harborwise', description: 'Understands ports and sailors.' },
        { name: 'Quiet Courage', description: 'Acts despite fear.' },
        { name: 'Old Maps', description: 'Recognizes forgotten routes.' },
      ],
    },
  },
  COMPLETE_CHARACTER_BACKGROUND: {
    input: {
      name: 'Mira',
      concept: 'Curious scout',
      classDisplayName: 'Wayfinder',
      personalGoal: 'Find a lost sibling.',
      traits: [
        { name: 'Keen Listener', description: 'Notices quiet changes.' },
        { name: 'Roadwise', description: 'Reads signs left by travelers.' },
      ],
    },
    output: {
      birthplace: 'North Road',
      formativeExperience: 'Survived a winter crossing.',
      adventureMotivation: 'Protect stranded travelers.',
      secret: 'Once followed the wrong beacon.',
      importantPerson: 'Her missing sibling.',
      tavernArrivalReason: 'Seeking the last caravan.',
      initialEquipment: [
        { name: 'Trail Compass', description: 'A compass marked with caravan routes.' },
      ],
    },
  },
  GENERATE_TAVERN: {
    input: { world, playerConcept: 'Curious scout', desiredPosition: null },
    output: {
      name: 'Ember Rest',
      position: 'Harbor crossroads',
      environment: 'Warm stone hall filled with salt air.',
      specialRules: ['Weapons remain sheathed.'],
      longTermProblem: 'The cellar light appears each night.',
      owner: {
        name: 'Ilyra',
        identity: 'Innkeeper',
        appearance: 'Tall, with a red wool coat.',
        personality: 'Practical and observant.',
        goal: 'Keep the road open.',
        secret: 'Knows an old tunnel.',
        speechStyle: 'Measured and direct.',
        currentMood: 'Concerned',
      },
    },
  },
  GENERATE_NPCS: {
    input: {
      world,
      tavern: {
        name: 'Ember Rest',
        position: 'Harbor crossroads',
        environment: 'Warm stone hall.',
        longTermProblem: 'A strange cellar light.',
      },
      existingNpcNames: ['Ilyra'],
      requestedCount: 1,
    },
    output: {
      npcs: [
        {
          residency: 'RESIDENT',
          name: 'Tomas',
          identity: 'Cartographer',
          appearance: 'Ink-stained hands.',
          personality: 'Patient and skeptical.',
          goal: 'Map the old tunnels.',
          secret: 'Has seen the lighthouse chamber.',
          speechStyle: 'Careful questions.',
          currentMood: 'Curious',
          visitReason: null,
        },
      ],
    },
  },
  NPC_REPLY: {
    input: {
      worldSummary: world.summary,
      currentRegion: world.currentRegion,
      npc: {
        ...npc,
        appearance: 'Tall, with a red wool coat.',
        secret: 'Knows an old tunnel.',
        speechStyle: 'Measured and direct.',
        currentStatus: 'ACTIVE',
      },
      relationship: { trust: 1, closeness: 0, awe: 0, obligation: 0 },
      knownFacts: ['The cellar has an old door.'],
      suspectedFacts: ['The lighthouse keeper used the tunnel.'],
      falseBeliefs: [],
      recentMessages: [{ role: 'PLAYER', content: 'What is below the cellar?' }],
      longTermMemories: ['Mira previously helped close the harbor gate.'],
      playerMessage: 'Show me the door.',
    },
    output: {
      reply: 'I will show you, but stay close.',
      mood: 'Wary',
      suggestedTopics: ['The old tunnel'],
      memoryCandidate: 'Mira asked to see the cellar door.',
      relationshipProposal: { trust: 1 },
    },
  },
  GENERATE_QUEST: {
    input: {
      world,
      tavernName: 'Ember Rest',
      publisher: npc,
      availableNpcs: [npc],
      playerConcept: 'Curious scout',
      recentQuestTitles: [],
    },
    output: questOutput,
  },
  GENERATE_ADVENTURE_PLAN: {
    input: {
      world,
      quest: {
        id: 'quest-1',
        content: questContent,
        risk: 'MODERATE',
        expectedTurns: { min: 8, max: 12 },
      },
      playerSummary: 'Mira is a curious scout.',
      relevantFacts: ['Magic leaves warm traces.'],
    },
    output: {
      objective: 'Restore the beacon flame.',
      risk: 'MODERATE',
      expectedTurns: { min: 8, max: 12 },
      coreScenes: ['Reach the lighthouse.'],
      necessaryClues: [
        { title: 'Scorched Lens', description: 'Burned from within.', isCore: true },
      ],
      majorObstacles: ['A flooded causeway.'],
      possibleEndings: ['The beacon is restored.'],
      failureCost: questContent.failureCost,
    },
  },
  GENERATE_ADVENTURE_TURN: {
    input: {
      adventureId: 'adventure-1',
      worldRules: world.powerRules,
      playerCharacter: {
        id: 'player-1',
        name: 'Mira',
        concept: 'Curious scout',
        classDisplayName: 'Wayfinder',
        attributes: { physique: 2, agility: 3, knowledge: 3, charisma: 2 },
        traits: [
          { name: 'Keen Listener', description: 'Notices quiet changes.' },
          { name: 'Roadwise', description: 'Reads signs left by travelers.' },
        ],
        personalGoal: 'Find a lost sibling.',
      },
      quest: {
        id: 'quest-1',
        content: questContent,
        status: 'ACTIVE',
        risk: 'MODERATE',
        rewardTier: 'NOTABLE',
      },
      adventurePlan: {
        objective: 'Restore the beacon.',
        risk: 'MODERATE',
        expectedTurns: { min: 8, max: 12 },
        coreScenes: ['Reach the lighthouse.'],
        necessaryClues: ['Scorched Lens: Burned from within.'],
        majorObstacles: ['A flooded causeway.'],
        possibleEndings: ['The beacon is restored.'],
        failureCost: questContent.failureCost,
      },
      currentTurnNumber: 1,
      currentScene: 'The cellar door is sealed.',
      longTermSummary: null,
      recentTurns: [],
      discoveredClues: [],
      relatedNpcs: [npc],
      playerAction: 'Inspect the lock.',
    },
    output: adventureTurnOutput,
  },
  RESOLVE_DICE_RESULT: {
    input: {
      scene: 'The cellar door is sealed.',
      action: 'Inspect the lock.',
      attribute: 'knowledge',
      difficulty: 11,
      total: 14,
      success: true,
    },
    output: {
      narration: 'Mira identifies a hidden catch.',
      consequence: 'The door can now be opened safely.',
      statePatchProposals: [patch],
    },
  },
  GENERATE_WORLD_EVENT: {
    input: {
      activeClocks: [{ id: 'clock-storm', name: 'Storm', current: 1, max: 6 }],
      factionStates: [
        {
          id: 'faction-lantern',
          name: 'Lantern Guild',
          goals: ['Restore the lighthouse.'],
          relations: ['faction-reef NEUTRAL: Trade continues cautiously.'],
        },
      ],
      recentImportantEvents: ['FACT_DISCOVERED: The beacon is dim.'],
      currentChapter: 'The storm closes around Ash Harbor.',
    },
    output: {
      title: 'The tide turns',
      description: 'The storm moves closer to Ash Harbor.',
      newFacts: ['The outer road is flooded.'],
      clockAdvances: [{ clockId: 'clock-storm', amount: 1, reason: 'A night has passed.' }],
    },
  },
  SUMMARIZE_ADVENTURE: {
    input: {
      questTitle: 'The Fading Beacon',
      turnSummaries: ['Mira opened the cellar door.'],
      ending: null,
    },
    output: {
      summary: 'Mira found a tunnel leading toward the lighthouse.',
      keyDecisions: ['Opened the cellar door.'],
      unresolvedThreads: ['Where the tunnel ends.'],
    },
  },
  EXTRACT_MEMORIES: {
    input: {
      npc,
      turnIds: ['turn-1'],
      transcript: ['Mira promised Ilyra to investigate the tunnel.'],
    },
    output: {
      memories: [
        { summary: 'Mira promised to investigate the tunnel.', sourceTurnIds: ['turn-1'] },
      ],
    },
  },
  CHECK_CONSISTENCY: {
    input: {
      world,
      lockedRules: ['Magic leaves warm traces.'],
      knownFacts: ['The lighthouse is dark.'],
      proposedContent: 'A warm trace leads toward the lighthouse.',
    },
    output: { consistent: true, issues: [] },
  },
};

describe('versioned AI task schemas', () => {
  it('registers independent input and output schemas for every initial task', () => {
    expect(Object.keys(AI_TASK_SCHEMAS)).toEqual(AI_TASKS);
    expect(new Set(Object.values(AI_TASK_SCHEMAS).map(({ input }) => input)).size).toBe(
      AI_TASKS.length,
    );
    expect(new Set(Object.values(AI_TASK_SCHEMAS).map(({ output }) => output)).size).toBe(
      AI_TASKS.length,
    );
  });

  it.each(AI_TASKS)('%s has a current version and accepts its own fixture', (task) => {
    const definition = AI_TASK_SCHEMAS[task];
    const expectedVersion = [
      'GENERATE_CHARACTER_TRAITS',
      'COMPLETE_CHARACTER_BACKGROUND',
      'NPC_REPLY',
      'GENERATE_ADVENTURE_TURN',
      'GENERATE_WORLD_EVENT',
    ].includes(task)
      ? 2
      : 1;
    expect(definition.schemaVersion).toBe(expectedVersion);
    expect(definition.input.safeParse(fixtures[task].input).success).toBe(true);
    expect(definition.output.safeParse(fixtures[task].output).success).toBe(true);
  });

  it.each(AI_TASKS)('%s rejects an empty output', (task) => {
    expect(AI_TASK_SCHEMAS[task].output.safeParse({}).success).toBe(false);
  });

  it('enforces representative structural rules before business validation', () => {
    expect(
      AI_TASK_SCHEMAS.GENERATE_CHARACTER_TRAITS.output.safeParse({
        traits: [{ name: 'Only one', description: 'Incomplete tuple.' }],
      }).success,
    ).toBe(false);
    expect(
      AI_TASK_SCHEMAS.GENERATE_QUEST.output.safeParse({
        ...questOutput,
        expectedTurns: { min: 12, max: 8 },
      }).success,
    ).toBe(false);
    expect(
      AI_TASK_SCHEMAS.GENERATE_ADVENTURE_TURN.output.safeParse({
        ...adventureTurnOutput,
        unvalidatedExtra: true,
      }).success,
    ).toBe(false);
  });
});
