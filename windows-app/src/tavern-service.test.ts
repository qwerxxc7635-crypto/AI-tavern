import { describe, expect, it } from 'vitest';

import { WindowsTavernService, type TavernGateway, type TavernSnapshot } from './tavern-service.js';

describe('WindowsTavernService', () => {
  it('uses the unified Fake Provider for the two validated initialization stages', async () => {
    const gateway = new FakeTavernGateway();
    let sequence = 0;
    const service = new WindowsTavernService(gateway, undefined, (task) => {
      sequence += 1;
      return {
        requestId: `tavern-request-${sequence}`,
        generationRecordId: `tavern-generation-${sequence}`,
        idempotencyKey: `tavern:${task}:${sequence}`,
      };
    });

    const [initialized, duplicate] = await Promise.all([
      service.initialize('campaign-tavern'),
      service.initialize('campaign-tavern'),
    ]);

    expect(initialized).toMatchObject({
      campaignState: 'TAVERN',
      tavern: { name: 'Ember Rest' },
    });
    expect(initialized.npcs).toHaveLength(4);
    expect(initialized.rumors).toHaveLength(3);
    expect(duplicate).toEqual(initialized);
    expect(gateway.tavernCommits).toHaveLength(1);
    expect(gateway.npcCommits).toHaveLength(1);
    expect(gateway.tavernCommits[0]).toMatchObject({
      generation: {
        requestId: 'tavern-request-1',
        promptVersion: 1,
        input: { playerConcept: 'Curious scout' },
      },
    });
    expect(gateway.npcCommits[0]).toMatchObject({
      generation: {
        requestId: 'tavern-request-2',
        promptVersion: 4,
        input: {
          requestedCount: 3,
          existingNpcNames: ['Ilyra Venn'],
          existingNpcArchetypes: [
            'innkeeper and retired route warden|practical observant and slow to trust',
          ],
        },
      },
    });
  });

  it('returns an initialized SQLite snapshot without generating again', async () => {
    const gateway = new FakeTavernGateway(finalSnapshot());
    const service = new WindowsTavernService(gateway);

    expect(await service.initialize('campaign-tavern')).toEqual(finalSnapshot());
    expect(gateway.tavernCommits).toHaveLength(0);
    expect(gateway.npcCommits).toHaveLength(0);
  });
});

class FakeTavernGateway implements TavernGateway {
  public readonly tavernCommits: Array<Parameters<TavernGateway['commitTavern']>[0]> = [];
  public readonly npcCommits: Array<Parameters<TavernGateway['commitNpcs']>[0]> = [];

  public constructor(private snapshot: TavernSnapshot = emptySnapshot()) {}

  public async load(): Promise<TavernSnapshot> {
    return this.snapshot;
  }

  public async commitTavern(
    command: Parameters<TavernGateway['commitTavern']>[0],
  ): Promise<TavernSnapshot> {
    this.tavernCommits.push(command);
    const output = command.generation.validatedOutput as {
      readonly name: string;
      readonly position: string;
      readonly environment: string;
      readonly specialRules: readonly string[];
      readonly longTermProblem: string;
      readonly owner: {
        readonly name: string;
        readonly identity: string;
        readonly appearance: string;
        readonly personality: string;
        readonly currentMood: string;
      };
    };
    this.snapshot = {
      ...this.snapshot,
      tavern: {
        id: 'tavern-ember-rest',
        campaignId: command.campaignId,
        locationId: this.snapshot.source.locationId,
        name: output.name,
        position: output.position,
        environment: output.environment,
        specialRules: output.specialRules,
        longTermProblem: output.longTermProblem,
        ownerNpcId: 'npc-owner',
        changes: [],
        createdAt: '2026-07-31T04:00:00.000Z',
        updatedAt: '2026-07-31T04:00:00.000Z',
      },
      npcs: [
        {
          id: 'npc-owner',
          residency: 'OWNER',
          name: output.owner.name,
          identity: output.owner.identity,
          appearance: output.owner.appearance,
          personality: output.owner.personality,
          currentMood: output.owner.currentMood,
          currentStatus: 'ACTIVE',
          visitReason: null,
        },
      ],
    };
    return this.snapshot;
  }

  public async commitNpcs(
    command: Parameters<TavernGateway['commitNpcs']>[0],
  ): Promise<TavernSnapshot> {
    this.npcCommits.push(command);
    this.snapshot = finalSnapshot();
    return this.snapshot;
  }
}

export function emptySnapshot(): TavernSnapshot {
  return {
    campaignState: 'GENERATING_TAVERN',
    source: {
      playerCharacterId: 'character-player',
      locationId: 'location-harbor',
      world: {
        name: 'Ember Coast',
        currentRegion: 'Ash Harbor',
        summary: 'A storm-bound coast.',
        coreConflict: 'The lighthouse has gone dark.',
        technologyLevel: 'Early industrial',
        powerRules: ['Weather magic has a cost.'],
      },
      playerConcept: 'Curious scout',
      desiredPosition: null,
    },
    tavern: null,
    npcs: [],
    rumors: [],
    clocks: [],
  };
}

export function finalSnapshot(): TavernSnapshot {
  const base = emptySnapshot();
  return {
    ...base,
    campaignState: 'TAVERN',
    tavern: {
      id: 'tavern-ember-rest',
      campaignId: 'campaign-tavern',
      locationId: 'location-harbor',
      name: 'Ember Rest',
      position: 'The harbor crossroads',
      environment: 'A warm stone hall filled with salt air.',
      specialRules: ['Weapons remain sheathed beside the common fire.'],
      longTermProblem: 'A strange light appears beneath the cellar.',
      ownerNpcId: 'npc-owner',
      changes: [],
      createdAt: '2026-07-31T04:00:00.000Z',
      updatedAt: '2026-07-31T04:00:00.000Z',
    },
    npcs: [
      npc('npc-owner', 'OWNER', 'Ilyra Venn', null),
      npc('npc-resident-1', 'RESIDENT', 'Tomas Reed', null),
      npc('npc-resident-2', 'RESIDENT', 'Nessa Vale', null),
      npc('npc-visitor', 'TEMPORARY_VISITOR', 'Sera Holt', 'Waiting for the causeway.'),
    ],
    rumors: [
      {
        id: 'rumor-1',
        claimId: 'claim-rumor-1',
        statement: 'A light moves below the cellar.',
        sourceNpcId: 'npc-resident-1',
        sourceBasis: 'WITNESS',
      },
      {
        id: 'rumor-2',
        claimId: 'claim-rumor-2',
        statement: 'The guild pays for tunnel maps.',
        sourceNpcId: 'npc-resident-2',
        sourceBasis: 'FACTION_MESSAGE',
      },
      {
        id: 'rumor-3',
        claimId: 'claim-rumor-3',
        statement: 'The courier crossed alone.',
        sourceNpcId: 'npc-visitor',
        sourceBasis: 'HEARSAY',
      },
    ],
    clocks: [
      clock('clock-world', '世界冲突'),
      clock('clock-tavern', '酒馆长期问题'),
      clock('clock-region', '区域局势'),
    ],
  };
}

function npc(
  id: string,
  residency: 'OWNER' | 'RESIDENT' | 'TEMPORARY_VISITOR',
  name: string,
  visitReason: string | null,
) {
  return {
    id,
    residency,
    name,
    identity: 'Traveler',
    appearance: 'Weathered clothes.',
    personality: 'Observant and practical.',
    currentMood: 'Concerned',
    currentStatus: 'ACTIVE' as const,
    visitReason,
  };
}

function clock(id: string, name: string) {
  return {
    id,
    name,
    current: 0,
    max: 6,
    stages: [
      { at: 2, title: '迹象浮现' },
      { at: 4, title: '局势升级' },
      { at: 6, title: '局势爆发' },
    ],
  };
}
