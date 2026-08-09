import { describe, expect, it } from 'vitest';
import type { AdventureSnapshot } from './adventure-service.js';
import {
  WindowsSettlementService,
  type AdventureArchive,
  type SettlementGateway,
} from './settlement-service.js';

describe('WindowsSettlementService', () => {
  it('generates validated proposals once and sends them to the fixed settlement command', async () => {
    const gateway = new Gateway();
    const service = new WindowsSettlementService(gateway);
    const snapshot = ending();
    const [first, second] = await Promise.all([
      service.settle('campaign', snapshot),
      service.settle('campaign', snapshot),
    ]);
    expect(first).toEqual(second);
    expect(gateway.commands).toHaveLength(1);
    const command = gateway.commands.at(0);
    expect(command).toBeDefined();
    if (command === undefined) throw new Error('Settlement command missing');
    expect(command.summary.validatedOutput).toMatchObject({ npcUpdates: [{ npcId: 'owner' }] });
    expect(command.worldEvent.validatedOutput).toMatchObject({
      clockAdvances: [{ clockId: 'clock' }],
    });
  });
  it('refuses a non-ending snapshot before invoking native storage', () => {
    const gateway = new Gateway();
    const service = new WindowsSettlementService(gateway);
    expect(() => service.settle('campaign', { ...ending(), state: 'SCENE' })).toThrow();
    expect(gateway.commands).toEqual([]);
  });
});
type Command = Parameters<SettlementGateway['commit']>[0];
class Gateway implements SettlementGateway {
  readonly commands: Command[] = [];
  async commit(command: Command) {
    this.commands.push(command);
    return archive;
  }
  async list() {
    return [archive];
  }
}
const archive: AdventureArchive = {
  campaignId: 'campaign',
  adventureId: 'adventure',
  title: 'Beacon',
  outcome: 'SUCCESS',
  summary: 'Done',
  keyDecisions: ['Stayed'],
  unresolvedThreads: [],
  nextDirections: ['Rest'],
  diceResults: [{ naturalRoll: 14, total: 16, difficulty: 11, success: true }],
  participantNpcs: [{ id: 'owner', name: 'Ilyra' }],
  unresolvedClues: [],
  tavernChange: { kind: 'TROPHY', description: 'Lens' },
  acquiredItems: [{ name: 'Compass', description: 'Stormglass' }],
  worldFacts: [{ statement: 'Road flooded', kind: 'DEVELOPING_FACT' }],
  generationUses: [{ task: 'SUMMARIZE_ADVENTURE', modelName: 'ember-fake-v1', promptVersion: 2 }],
  completedAt: '2026-08-01T00:00:00.000Z',
};
function ending(): AdventureSnapshot {
  return {
    campaignId: 'campaign',
    campaignState: 'ADVENTURE',
    adventureId: 'adventure',
    state: 'ENDING',
    currentTurnNumber: 8,
    planInput: {},
    player: {
      id: 'character',
      name: 'Mira',
      classDisplayName: 'Scholar',
      personalGoal: 'Learn',
      attributes: { physique: 0, agility: 0, knowledge: 1, charisma: 0 },
    },
    quest: {
      id: 'quest',
      publisherNpcId: 'owner',
      relatedNpcIds: [],
      content: { title: 'Beacon', objective: 'Light it', summary: 'Save it' },
    },
    clocks: [{ id: 'clock', name: 'Storm', current: 0, max: 4 }],
    items: [],
    clues: [
      {
        id: 'clue',
        title: 'Lens',
        description: 'Scorched',
        isCore: true,
        discoveredInTurnId: 'turn-1',
      },
    ],
    turns: [
      {
        id: 'turn-1',
        turnNumber: 1,
        sceneText: 'Done',
        playerAction: 'Act',
        actionMode: 'ACTION',
        suggestedActions: [],
        checkRequest: null,
        diceResult: null,
        resolved: true,
      },
    ],
    currentScene: 'Done',
    sceneFrame: null,
    suggestedActions: [],
    turnGenerationContext: null,
    diceGenerationInput: null,
  };
}
