import type { AITask } from './protocol.js';

const world = {
  name: 'Ember Coast',
  currentRegion: 'Ash Harbor',
  summary: 'A storm-bound coast linked by old beacon roads.',
  coreConflict: 'The lighthouse fire is fading as an unnatural storm approaches.',
  technologyLevel: 'Late medieval',
  powerRules: ['Magic always leaves a warm trace.'],
  factions: [
    {
      name: 'Lantern Guild',
      description: 'Navigators who maintain the coast beacons.',
      goals: ['Restore the Ash Harbor lighthouse.'],
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
  narrativeStyle: 'Grounded heroic fantasy with quiet mysteries.',
  forbiddenElements: [],
  tavernReason: 'Travelers wait here for safe tides and guarded roads.',
  storyHooks: ['The lighthouse flame dims at every moonrise.'],
};
const quest = {
  title: 'The Fading Beacon',
  summary: 'Investigate why the lighthouse fire is failing.',
  objective: 'Restore the beacon before the storm reaches the harbor.',
  failureCost: 'Ships remain trapped beyond the reef.',
};
const factPatch = {
  kind: 'FACT',
  targetId: null,
  rationale: 'The opened chamber becomes a persistent world fact.',
  payload: { statement: 'The old beacon chamber is open.' },
};

export const FAKE_TASK_OUTPUTS = Object.freeze({
  GENERATE_WORLD: world,
  REFINE_WORLD: {
    world,
    changeSummary: ['Clarified the Lantern Guild role while preserving locked rules.'],
  },
  GENERATE_CHARACTER_TRAITS: {
    traits: [
      { name: 'Keen Listener', description: 'Notices quiet changes in people and places.' },
      { name: 'Roadwise', description: 'Reads signs left by travelers and weather.' },
    ],
  },
  COMPLETE_CHARACTER_BACKGROUND: {
    birthplace: 'The North Road',
    formativeExperience: 'Survived a winter caravan crossing.',
    adventureMotivation: 'Protect travelers from hidden dangers.',
    secret: 'Once followed a false beacon into the marsh.',
    importantPerson: 'A sibling who vanished near Ash Harbor.',
    tavernArrivalReason: 'Seeking the last caravan that saw the missing sibling.',
  },
  GENERATE_TAVERN: {
    name: 'Ember Rest',
    position: 'The harbor crossroads',
    environment: 'A warm stone hall filled with salt air and amber light.',
    specialRules: ['Weapons remain sheathed beside the common fire.'],
    longTermProblem: 'A strange light appears beneath the cellar each night.',
    owner: {
      name: 'Ilyra Venn',
      identity: 'Innkeeper and retired route warden',
      appearance: 'Tall, with a weathered red wool coat.',
      personality: 'Practical, observant, and slow to trust.',
      goal: 'Keep the harbor road open.',
      secret: 'Knows a sealed tunnel reaches toward the lighthouse.',
      speechStyle: 'Measured statements and pointed questions.',
      currentMood: 'Concerned',
    },
  },
  GENERATE_NPCS: {
    npcs: [
      {
        residency: 'RESIDENT',
        name: 'Tomas Reed',
        identity: 'Cartographer',
        appearance: 'Ink-stained hands and a patched blue scarf.',
        personality: 'Patient and skeptical.',
        goal: 'Map the sealed coastal tunnels.',
        secret: 'Has already entered the first tunnel chamber.',
        speechStyle: 'Careful questions followed by precise corrections.',
        currentMood: 'Curious',
        visitReason: null,
      },
      {
        residency: 'TEMPORARY_VISITOR',
        name: 'Sera Holt',
        identity: 'Storm courier',
        appearance: 'Travel cloak crusted with sea salt.',
        personality: 'Restless but generous.',
        goal: 'Deliver a warning to the Lantern Guild.',
        secret: 'Lost the original warning seal.',
        speechStyle: 'Quick sentences and nautical idioms.',
        currentMood: 'Urgent',
        visitReason: 'Waiting for the causeway to reopen.',
      },
    ],
  },
  NPC_REPLY: {
    reply: 'I will show you the cellar door, but stay close and touch nothing warm.',
    mood: 'Wary',
    suggestedTopics: ['The old tunnel', 'The lighthouse keeper'],
    memoryCandidate: 'The player asked Ilyra to reveal the cellar door.',
    relationshipProposal: { trust: 1 },
  },
  GENERATE_QUEST: {
    content: quest,
    risk: 'MODERATE',
    recommendedAttributes: ['knowledge', 'agility'],
    expectedTurns: { min: 8, max: 12 },
    rewardTier: 'NOTABLE',
    relatedNpcIds: ['npc-owner', 'npc-cartographer'],
    relatedFactIds: [],
  },
  GENERATE_ADVENTURE_PLAN: {
    objective: quest.objective,
    risk: 'MODERATE',
    expectedTurns: { min: 8, max: 12 },
    coreScenes: ['Open the cellar passage.', 'Cross the flooded causeway.', 'Reach the beacon.'],
    necessaryClues: [
      {
        title: 'Scorched Lens',
        description: 'The beacon lens was burned from inside.',
        isCore: true,
      },
    ],
    majorObstacles: ['A rusted lock.', 'A flooded tunnel.', 'The approaching storm.'],
    possibleEndings: ['The beacon is restored.', 'The harbor evacuates before the storm.'],
    failureCost: quest.failureCost,
  },
  GENERATE_ADVENTURE_TURN: {
    sceneText: 'Warm light leaks through the old cellar lock as the storm shakes the shutters.',
    speakerNpcIds: [],
    suggestedActions: [{ text: 'Study the lock.' }, { text: 'Ask Ilyra for the old key.' }],
    checkRequest: {
      attribute: 'knowledge',
      difficulty: 11,
      reason: 'Identify the hidden locking mechanism.',
    },
    discoveredClues: ['The lock is heated from the tunnel side.'],
    statePatchProposals: [factPatch],
    adventureState: 'CHECK_REQUIRED',
  },
  RESOLVE_DICE_RESULT: {
    narration: 'The hidden catch yields, revealing a narrow stair lit by ember-colored moss.',
    consequence: 'The cellar passage can now be entered safely.',
    statePatchProposals: [factPatch],
  },
  GENERATE_WORLD_EVENT: {
    title: 'The tide turns',
    description: 'The storm front moves closer and floods the outer harbor road.',
    newFacts: ['The outer harbor road is flooded.'],
    clockAdvances: [
      { clockId: 'clock-storm', amount: 1, reason: 'Another storm tide has arrived.' },
    ],
  },
  SUMMARIZE_ADVENTURE: {
    summary: 'The party opened the cellar passage and found a route toward the lighthouse.',
    keyDecisions: ['Trusted Ilyra.', 'Opened the cellar door.'],
    unresolvedThreads: ['Who damaged the beacon lens?'],
  },
  EXTRACT_MEMORIES: {
    memories: [
      {
        summary: 'The player promised Ilyra to investigate the lighthouse passage.',
        sourceTurnIds: ['turn-1'],
      },
    ],
  },
  CHECK_CONSISTENCY: {
    consistent: true,
    issues: [],
  },
} satisfies Readonly<Record<AITask, unknown>>);
