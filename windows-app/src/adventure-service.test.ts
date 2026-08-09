import { describe, expect, it } from 'vitest';

import {
  WindowsAdventureService,
  type AdventureGateway,
  type AdventureSnapshot,
} from './adventure-service.js';

describe('WindowsAdventureService', () => {
  it('prepares and completes an eight-turn Fake adventure through validated generation', async () => {
    const gateway = new MemoryAdventureGateway();
    const service = new WindowsAdventureService(gateway, undefined, (task) => ({
      requestId: `${task.toLowerCase()}-request`,
      generationRecordId: `${task.toLowerCase()}-generation`,
      idempotencyKey: `${task.toLowerCase()}:key`,
    }));

    let snapshot = await service.prepare('campaign-adventure', 'quest-beacon');
    expect(snapshot.state).toBe('PREPARING');
    snapshot = await service.start('campaign-adventure', adventureIdOf(snapshot));

    let checks = 0;
    let uncheckedTurns = 0;
    for (let turn = 1; turn <= 8; turn += 1) {
      snapshot = await service.act(
        'campaign-adventure',
        adventureIdOf(snapshot),
        `Take action ${turn}`,
      );
      if (snapshot.state === 'CHECK_REQUIRED') {
        checks += 1;
        expect(snapshot.state).toBe('CHECK_REQUIRED');
        snapshot = await service.resolveCheck('campaign-adventure', adventureIdOf(snapshot));
        expect(snapshot.state).toBe('SCENE');
      } else if (turn < 8) {
        uncheckedTurns += 1;
        expect(snapshot.state).toBe('SCENE');
      }
    }

    expect(snapshot.state).toBe('ENDING');
    expect(snapshot.currentTurnNumber).toBe(8);
    expect(checks).toBe(3);
    expect(uncheckedTurns).toBe(4);
    expect(gateway.tasks.filter((task) => task === 'GENERATE_ADVENTURE_TURN')).toHaveLength(8);
    expect(gateway.tasks.filter((task) => task === 'RESOLVE_DICE_RESULT')).toHaveLength(3);
  });

  it('coalesces duplicate actions so a turn is committed once', async () => {
    const gateway = new MemoryAdventureGateway();
    const service = new WindowsAdventureService(gateway);
    let snapshot = await service.prepare('campaign-adventure', 'quest-beacon');
    snapshot = await service.start('campaign-adventure', adventureIdOf(snapshot));
    const adventureId = adventureIdOf(snapshot);

    const [first, second] = await Promise.all([
      service.act('campaign-adventure', adventureId, 'Study the lock'),
      service.act('campaign-adventure', adventureId, 'Study the lock'),
    ]);

    expect(first.currentTurnNumber).toBe(1);
    expect(second).toBe(first);
    expect(gateway.submitCount).toBe(1);
  });

  it('resumes persisted action and dice work without submitting or rolling twice', async () => {
    const gateway = new MemoryAdventureGateway();
    const service = new WindowsAdventureService(gateway);
    let snapshot = await service.prepare('campaign-adventure', 'quest-beacon');
    snapshot = await service.start('campaign-adventure', adventureIdOf(snapshot));
    const adventureId = adventureIdOf(snapshot);

    await gateway.submit('campaign-adventure', adventureId, 'Study the lock');
    snapshot = await service.act('campaign-adventure', adventureId, 'Ignored retry text');
    expect(gateway.submitCount).toBe(1);
    expect(snapshot.state).toBe('CHECK_REQUIRED');

    await gateway.roll();
    snapshot = await service.resolveCheck('campaign-adventure', adventureId);
    expect(gateway.rollCount).toBe(1);
    expect(snapshot.state).toBe('SCENE');
  });

  it('resumes a persisted pending turn while loading after an application restart', async () => {
    const gateway = new MemoryAdventureGateway();
    const firstRun = new WindowsAdventureService(gateway);
    let snapshot = await firstRun.prepare('campaign-adventure', 'quest-beacon');
    snapshot = await firstRun.start('campaign-adventure', adventureIdOf(snapshot));
    const adventureId = adventureIdOf(snapshot);
    await gateway.submit('campaign-adventure', adventureId, 'Persist before restart');

    const restarted = new WindowsAdventureService(gateway);
    snapshot = await restarted.load('campaign-adventure');

    expect(snapshot.state).toBe('CHECK_REQUIRED');
    expect(gateway.submitCount).toBe(1);
  });
});

class MemoryAdventureGateway implements AdventureGateway {
  public readonly tasks: string[] = [];
  public submitCount = 0;
  public rollCount = 0;
  private snapshot = initialSnapshot();

  public async load() {
    return this.snapshot;
  }

  public async commitPlan(_campaignId: string, _questId: string, generation: Audit) {
    this.tasks.push(taskOf(generation));
    this.snapshot = {
      ...this.snapshot,
      adventureId: 'adventure-beacon',
      state: 'PREPARING',
      clues: [
        clue('clue-lens', 'Scorched Lens'),
        clue('clue-ledger', 'Tide Ledger'),
        clue('clue-signet', 'Keeper Signet'),
      ],
    };
    return this.snapshot;
  }

  public async start() {
    this.snapshot = { ...this.snapshot, campaignState: 'ADVENTURE', state: 'SCENE' };
    return this.snapshot;
  }

  public async submit(_campaignId: string, _adventureId: string, playerAction: string) {
    this.submitCount += 1;
    const next = this.snapshot.currentTurnNumber + 1;
    const newTurn = {
      id: `turn-${next}`,
      turnNumber: next,
      sceneText: this.snapshot.currentScene,
      playerAction,
      suggestedActions: [],
      checkRequest: null,
      diceResult: null,
      resolved: false,
    };
    this.snapshot = {
      ...this.snapshot,
      state: 'WAITING_FOR_PLAYER',
      turns: [...this.snapshot.turns, newTurn],
      turnGenerationContext: turnInput(this.snapshot, playerAction),
    };
    return this.snapshot;
  }

  public async commitTurn(_campaignId: string, _adventureId: string, generation: Audit) {
    this.tasks.push(taskOf(generation));
    const output = generation.validatedOutput as {
      sceneText: string;
      suggestedActions: readonly { readonly text: string }[];
      checkRequest: {
        attribute: 'knowledge';
        difficulty: number;
        reason: string;
      } | null;
      adventureState: 'SCENE' | 'CHECK_REQUIRED' | 'ENDING';
    };
    const last = lastTurnOf(this.snapshot);
    const updated = {
      ...last,
      sceneText: output.sceneText,
      suggestedActions: output.suggestedActions,
      checkRequest: output.checkRequest,
      resolved: output.checkRequest === null,
    };
    this.snapshot = {
      ...this.snapshot,
      state: output.adventureState,
      currentTurnNumber: last.turnNumber,
      currentScene: output.sceneText,
      suggestedActions: output.suggestedActions.map(({ text }) => text),
      turns: [...this.snapshot.turns.slice(0, -1), updated],
      turnGenerationContext: null,
    };
    return this.snapshot;
  }

  public async roll() {
    this.rollCount += 1;
    const last = lastTurnOf(this.snapshot);
    const updated = {
      ...last,
      diceResult: { naturalRoll: 12, total: 15, difficulty: 11, success: true },
    };
    this.snapshot = {
      ...this.snapshot,
      state: 'RESOLVING',
      turns: [...this.snapshot.turns.slice(0, -1), updated],
      diceGenerationInput: {
        scene: last.sceneText,
        action: last.playerAction,
        attribute: 'knowledge',
        difficulty: 11,
        total: 15,
        success: true,
      },
    };
    return this.snapshot;
  }

  public async commitDice(_campaignId: string, _adventureId: string, generation: Audit) {
    this.tasks.push(taskOf(generation));
    const last = lastTurnOf(this.snapshot);
    this.snapshot = {
      ...this.snapshot,
      state: 'SCENE',
      turns: [...this.snapshot.turns.slice(0, -1), { ...last, resolved: true }],
      diceGenerationInput: null,
    };
    return this.snapshot;
  }
}

type Audit = Parameters<AdventureGateway['commitPlan']>[2];

function taskOf(generation: Audit): string {
  return (generation.request as { task: string }).task;
}

function adventureIdOf(snapshot: AdventureSnapshot): string {
  if (snapshot.adventureId === null) throw new Error('Expected an adventure id');
  return snapshot.adventureId;
}

function lastTurnOf(snapshot: AdventureSnapshot) {
  const turn = snapshot.turns.at(-1);
  if (turn === undefined) throw new Error('Expected an adventure turn');
  return turn;
}

function initialSnapshot(): AdventureSnapshot {
  return {
    campaignId: 'campaign-adventure',
    campaignState: 'TAVERN',
    adventureId: null,
    state: null,
    currentTurnNumber: 0,
    planInput: {
      world: {
        name: 'Ember Coast',
        currentRegion: 'Ash Harbor',
        summary: 'A storm-bound coast.',
        coreConflict: 'The beacon is fading.',
        technologyLevel: 'Late medieval',
        powerRules: ['Magic leaves warmth.'],
      },
      quest: {
        id: 'quest-beacon',
        content: {
          title: 'The Fading Beacon',
          summary: 'Investigate the failing lighthouse.',
          objective: 'Restore the beacon.',
          failureCost: 'Ships remain trapped.',
        },
        risk: 'MODERATE',
        expectedTurns: { min: 8, max: 12 },
      },
      playerSummary: 'Mara: Curious scout; Find the road.',
      relevantFacts: [],
    },
    player: {
      id: 'character-player',
      name: 'Mara',
      classDisplayName: 'Scout',
      personalGoal: 'Find the road.',
      attributes: { physique: 2, agility: 4, knowledge: 3, charisma: 1 },
    },
    quest: {
      id: 'quest-beacon',
      publisherNpcId: 'npc-owner',
      relatedNpcIds: ['npc-owner'],
      content: {
        title: 'The Fading Beacon',
        summary: 'Investigate the failing lighthouse.',
        objective: 'Restore the beacon.',
      },
    },
    clocks: [],
    items: [],
    clues: [],
    turns: [],
    currentScene: 'Investigate the failing lighthouse.',
    sceneFrame: sceneFrame(),
    suggestedActions: [],
    turnGenerationContext: null,
    diceGenerationInput: null,
  };
}

function clue(id: string, title: string) {
  return {
    id,
    title,
    description: `${title} description.`,
    isCore: true,
    discoveredInTurnId: null,
  };
}

function turnInput(snapshot: AdventureSnapshot, playerAction: string) {
  return {
    adventureId: 'adventure-beacon',
    worldRules: ['Magic leaves warmth.'],
    playerCharacter: {
      id: 'character-player',
      name: 'Mara',
      concept: 'Curious scout',
      classDisplayName: 'Scout',
      attributes: { physique: 2, agility: 4, knowledge: 3, charisma: 1 },
      traits: [
        { name: 'Keen Eye', description: 'Notices small details.' },
        { name: 'Sure Step', description: 'Moves safely on poor ground.' },
      ],
      personalGoal: 'Find the road.',
    },
    quest: {
      id: 'quest-beacon',
      content: {
        title: 'The Fading Beacon',
        summary: 'Investigate the failing lighthouse.',
        objective: 'Restore the beacon.',
        failureCost: 'Ships remain trapped.',
      },
      status: 'ACTIVE',
      risk: 'MODERATE',
      rewardTier: 'NOTABLE',
    },
    adventurePlan: {
      objective: 'Restore the beacon.',
      risk: 'MODERATE',
      expectedTurns: { min: 8, max: 12 },
      coreScenes: ['Open the cellar passage.'],
      necessaryClues: ['Scorched Lens', 'Tide Ledger', 'Keeper Signet'],
      majorObstacles: ['A rusted lock.'],
      possibleEndings: ['The beacon is restored.', 'The harbor evacuates.'],
      failureCost: 'Ships remain trapped.',
    },
    currentTurnNumber: snapshot.currentTurnNumber,
    currentScene: snapshot.currentScene,
    sceneFrame: snapshot.sceneFrame,
    longTermSummary: null,
    recentTurns: snapshot.turns.map(({ sceneText }) => sceneText).slice(-10),
    discoveredClues: [],
    relatedNpcs: [],
    playerAction,
  };
}

function sceneFrame() {
  return {
    sceneId: 'scene-initial',
    location: 'Lighthouse approach',
    participants: ['character-player'],
    pressure: [],
    affordances: [],
    pendingConsequences: [],
    returnPoint: { eventId: 'event-quest-accepted', summary: 'Approach the lighthouse.' },
    revision: 1,
  } as const;
}
