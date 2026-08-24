import { describe, expect, it } from 'vitest';

import {
  WindowsWorldCreationService,
  type WorldBibleView,
  type WorldCreationGateway,
  type WorldCreationSnapshot,
  type WorldDraft,
} from './world-creation-service.js';
import type { DesktopAIEngine } from './desktop-ai-orchestrator.js';

describe('WindowsWorldCreationService', () => {
  it('uses the unified Fake Provider and commits schema-validated generation and refinement', async () => {
    const gateway = new FakeWorldGateway();
    let identity = 0;
    const service = new WindowsWorldCreationService(
      gateway,
      undefined,
      (task) => {
        identity += 1;
        return {
          requestId: `request-${identity}`,
          generationRecordId: `generation-${identity}`,
          idempotencyKey: `world:${task}:${identity}`,
        };
      },
      {
        async resolveTemperature() {
          return 1.4;
        },
      },
    );

    const generated = await service.generate('campaign-world', {
      concept: '漂浮在风暴云海上的群岛世界',
      storyPreferences: ['奇幻', '轻松', '一座城市'],
      contentBoundaries: {
        allowHorror: false,
        allowPermanentDeath: false,
        allowRomance: true,
        allowBetrayal: true,
        excludedContent: ['虐待动物'],
      },
    });
    expect(generated).toMatchObject({
      campaignState: 'REVIEWING_WORLD',
      world: { name: 'Ember Coast', currentRegion: 'Ash Harbor' },
    });
    expect(gateway.commits[0]).toMatchObject({
      task: 'GENERATE_WORLD',
      requestId: 'request-1',
      promptVersion: 2,
      request: { temperature: 1.4 },
    });

    const current = generated.world;
    if (current === null) throw new Error('expected generated world');
    gateway.snapshot = {
      ...generated,
      world: { ...current, lockedFields: ['powerRules'] },
    };
    const refined = await service.refine(
      'campaign-world',
      gateway.snapshot.world as WorldBibleView,
      ['只调整主要势力的叙述。'],
    );
    expect(refined.world?.powerRules).toEqual(current.powerRules);
    expect(gateway.commits[1]).toMatchObject({
      task: 'REFINE_WORLD',
      requestId: 'request-2',
    });
  });

  it('persists manual edits and confirmation only through the native gateway', async () => {
    const gateway = new FakeWorldGateway();
    const service = new WindowsWorldCreationService(gateway);
    const generated = await service.generate('campaign-world', defaultOptions());
    const current = generated.world;
    if (current === null) throw new Error('expected generated world');

    const edited: WorldDraft = {
      ...worldDraft(),
      summary: '玩家手动修订后的世界简介。',
    };
    const updated = await service.update('campaign-world', edited, ['summary']);
    expect(updated.world).toMatchObject({
      summary: '玩家手动修订后的世界简介。',
      lockedFields: ['summary'],
    });

    const confirmed = await service.confirm('campaign-world');
    expect(confirmed.campaignState).toBe('CREATING_CHARACTER');
    expect(gateway.confirmCalls).toEqual(['campaign-world']);
  });

  it('streams only the world introduction and commits the complete validated world once', async () => {
    const gateway = new FakeWorldGateway();
    const draft = worldDraft();
    const raw = JSON.stringify(draft);
    const split = raw.indexOf(draft.summary) + 8;
    const engine: DesktopAIEngine = {
      async execute(_task, _input, options) {
        options.stream?.onChunk({ sequence: 1, content: raw.slice(0, split) });
        options.stream?.onChunk({ sequence: 2, content: raw.slice(split) });
        return {
          request: { requestId: options.requestId, promptVersion: 2 },
          response: { content: raw },
          validatedOutput: draft,
        } as never;
      },
    };
    const service = new WindowsWorldCreationService(gateway, engine);
    const visible: string[] = [];

    const generated = await service.generate('campaign-world', defaultOptions(), {
      signal: new AbortController().signal,
      onChunk: (content) => visible.push(content),
    });

    expect(visible.join('')).toBe(draft.summary);
    expect(generated.world?.summary).toBe(draft.summary);
    expect(gateway.commits).toHaveLength(1);
  });
});

class FakeWorldGateway implements WorldCreationGateway {
  public snapshot: WorldCreationSnapshot = {
    campaignState: 'CREATING_WORLD',
    world: null,
    constitution: null,
  };
  public readonly commits: Array<Parameters<WorldCreationGateway['commit']>[0]> = [];
  public readonly confirmCalls: string[] = [];

  public async load(): Promise<WorldCreationSnapshot> {
    return this.snapshot;
  }

  public async commit(
    command: Parameters<WorldCreationGateway['commit']>[0],
  ): Promise<WorldCreationSnapshot> {
    this.commits.push(command);
    const previous = this.snapshot.world;
    this.snapshot = {
      campaignState: 'REVIEWING_WORLD',
      world: viewOf(command.campaignId, command.world, previous?.lockedFields ?? []),
      constitution: constitutionView(command.campaignId, command.world.constitution, 1, 'DRAFT'),
    };
    return this.snapshot;
  }

  public async update(
    id: string,
    world: WorldDraft,
    lockedFields: WorldBibleView['lockedFields'],
  ): Promise<WorldCreationSnapshot> {
    this.snapshot = {
      campaignState: 'REVIEWING_WORLD',
      world: viewOf(id, world, lockedFields),
      constitution: constitutionView(
        id,
        world.constitution,
        (this.snapshot.constitution?.revision ?? 0) + 1,
        'DRAFT',
      ),
    };
    return this.snapshot;
  }

  public async confirm(id: string): Promise<WorldCreationSnapshot> {
    this.confirmCalls.push(id);
    this.snapshot = {
      ...this.snapshot,
      campaignState: 'CREATING_CHARACTER',
      constitution:
        this.snapshot.constitution === null
          ? null
          : {
              ...this.snapshot.constitution,
              status: 'LOCKED',
              lockedAt: '2026-07-31T01:01:00.000Z',
            },
    };
    return this.snapshot;
  }
}

function viewOf(
  campaignId: string,
  world: WorldDraft,
  lockedFields: WorldBibleView['lockedFields'],
): WorldBibleView {
  return {
    ...world,
    campaignId,
    lockedFields,
    createdAt: '2026-07-31T01:00:00.000Z',
    updatedAt: '2026-07-31T01:00:00.000Z',
  };
}

function defaultOptions() {
  return {
    concept: 'A storm-bound fantasy coast',
    storyPreferences: ['奇幻', '平衡'],
    contentBoundaries: {
      allowHorror: false,
      allowPermanentDeath: false,
      allowRomance: true,
      allowBetrayal: true,
      excludedContent: [],
    },
  } as const;
}

function worldDraft(): WorldDraft {
  const view = worldView();
  return {
    constitution: view.constitution,
    name: view.name,
    currentRegion: view.currentRegion,
    summary: view.summary,
    coreConflict: view.coreConflict,
    technologyLevel: view.technologyLevel,
    powerRules: view.powerRules,
    factions: view.factions,
    locations: view.locations,
    narrativeStyle: view.narrativeStyle,
    forbiddenElements: view.forbiddenElements,
    tavernReason: view.tavernReason,
    storyHooks: view.storyHooks,
  };
}

function worldView(): WorldBibleView {
  const draft = {
    constitution: constitutionDraft(),
    name: 'Ember Coast',
    currentRegion: 'Ash Harbor',
    summary: 'A storm-bound coast.',
    coreConflict: 'The old lighthouse has gone dark.',
    technologyLevel: 'Early industrial',
    powerRules: ['Weather magic changes nearby climate.'],
    factions: [
      {
        name: 'Lantern Guild',
        description: 'Keepers of the coast lights.',
        goals: ['Restore the beacon.'],
      },
    ],
    locations: [
      {
        name: 'Ash Harbor',
        description: 'A sheltered port.',
        parentName: null,
        factionNames: ['Lantern Guild'],
      },
    ],
    narrativeStyle: 'Grounded mystery.',
    forbiddenElements: [],
    tavernReason: 'Travelers wait for storms to pass.',
    storyHooks: ['A light moves beneath the harbor.'],
  } satisfies WorldDraft;
  return {
    ...draft,
    campaignId: 'campaign-world',
    lockedFields: [],
    createdAt: '2026-07-31T01:00:00.000Z',
    updatedAt: '2026-07-31T01:00:00.000Z',
  };
}

function constitutionDraft() {
  return {
    schemaVersion: 1 as const,
    worldType: 'Low coastal fantasy',
    era: 'Early industrial',
    technology: 'Early industrial',
    magic: 'Weather magic changes nearby climate.',
    peoples: ['Coastal communities'],
    society: 'Guilds connect isolated ports.',
    politics: 'Harbor councils share authority.',
    economy: 'Fishing and shipping.',
    combatScale: 'Personal and small-group conflict.',
    deathRules: 'Death is permanent.',
    careerRules: 'Careers arise from local institutions.',
    equipmentRules: 'Equipment follows local craft.',
    npcRules: 'NPC motives follow knowledge and obligations.',
    traitRules: 'Benefits require balancing drawbacks.',
    taboos: [],
  };
}

function constitutionView(
  campaignId: string,
  draft: WorldDraft['constitution'],
  revision: number,
  status: 'DRAFT' | 'LOCKED',
) {
  return {
    ...draft,
    campaignId,
    revision,
    status,
    createdAt: '2026-07-31T01:00:00.000Z',
    updatedAt: '2026-07-31T01:00:00.000Z',
    lockedAt: status === 'LOCKED' ? '2026-07-31T01:01:00.000Z' : null,
  };
}
