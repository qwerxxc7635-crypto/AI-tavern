import { afterEach, describe, expect, it, vi } from 'vitest';

import { GenerationQueue } from '@ember-tavern/ai-core';

import {
  WindowsWorldCreationService,
  type WorldBibleView,
  type WorldCreationGateway,
  type WorldCreationSnapshot,
  type WorldDraft,
} from './world-creation-service.js';
import type { DesktopAIEngine } from './desktop-ai-orchestrator.js';

afterEach(() => vi.useRealTimers());

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

  it('allows a valid long world response past the legacy timeout while keeping a finite provider cap', async () => {
    vi.useFakeTimers();
    const gateway = new FakeWorldGateway();
    const delayed = deferred<undefined>();
    let requestedTimeout = 0;
    let requestedOutputTokens = 0;
    const engine: DesktopAIEngine = {
      async execute(_task, _input, options) {
        requestedTimeout = options.timeoutMs;
        requestedOutputTokens = options.maxOutputTokens;
        await delayed.promise;
        return execution(options.requestId, worldDraft());
      },
    };
    const service = serviceWithQueue(gateway, engine);
    const generated = service.generate('campaign-world', defaultOptions());

    await vi.advanceTimersByTimeAsync(60_001);
    expect(gateway.commits).toHaveLength(0);
    expect(requestedTimeout).toBe(120_000);
    expect(requestedOutputTokens).toBe(4_096);
    delayed.resolve(undefined);
    await expect(generated).resolves.toMatchObject({ campaignState: 'REVIEWING_WORLD' });
    expect(gateway.commits).toHaveLength(1);
  });

  it('cancels a permanently hung generation at the overall cap without a partial commit', async () => {
    vi.useFakeTimers();
    const gateway = new FakeWorldGateway();
    let executionSignal: AbortSignal | undefined;
    const engine: DesktopAIEngine = {
      execute(_task, _input, options) {
        executionSignal = options.signal;
        return new Promise(() => {});
      },
    };
    const service = serviceWithQueue(gateway, engine);
    const generated = service.generate('campaign-world', defaultOptions());
    const rejected = expect(generated).rejects.toMatchObject({ code: 'TIMEOUT' });

    await vi.advanceTimersByTimeAsync(270_000);
    await rejected;
    expect(executionSignal?.aborted).toBe(true);
    expect(gateway.commits).toHaveLength(0);
  });

  it('retries from a clean request after timeout and persists exactly one world', async () => {
    vi.useFakeTimers();
    const gateway = new FakeWorldGateway();
    let calls = 0;
    const engine: DesktopAIEngine = {
      execute(_task, _input, options) {
        calls += 1;
        return calls === 1
          ? new Promise(() => {})
          : Promise.resolve(execution(options.requestId, worldDraft()));
      },
    };
    const service = serviceWithQueue(gateway, engine);
    const first = service.generate('campaign-world', defaultOptions());
    const rejected = expect(first).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(270_000);
    await rejected;

    await expect(service.generate('campaign-world', defaultOptions())).resolves.toMatchObject({
      campaignState: 'REVIEWING_WORLD',
    });
    expect(calls).toBe(2);
    expect(gateway.commits).toHaveLength(1);
  });

  it('leaves no partial world after invalid output and commits only the explicit retry', async () => {
    const gateway = new FakeWorldGateway();
    let calls = 0;
    const service = serviceWithQueue(gateway, {
      async execute(_task, _input, options) {
        calls += 1;
        if (calls === 1) throw Object.freeze({ code: 'SCHEMA_NAME_INVALID' });
        return execution(options.requestId, worldDraft());
      },
    });

    await expect(service.generate('campaign-world', defaultOptions())).rejects.toMatchObject({
      code: 'SCHEMA_NAME_INVALID',
    });
    expect(gateway.commits).toHaveLength(0);
    expect(gateway.snapshot).toEqual({
      campaignState: 'CREATING_WORLD',
      world: null,
      constitution: null,
    });

    await expect(service.generate('campaign-world', defaultOptions())).resolves.toMatchObject({
      campaignState: 'REVIEWING_WORLD',
    });
    expect(calls).toBe(2);
    expect(gateway.commits).toHaveLength(1);
  });

  it('deduplicates concurrent world intent and commits one successful result', async () => {
    const gateway = new FakeWorldGateway();
    const delayed = deferred<undefined>();
    const execute = vi.fn(async (_task, _input, options) => {
      await delayed.promise;
      return execution(options.requestId, worldDraft());
    });
    const service = serviceWithQueue(gateway, { execute } as DesktopAIEngine);

    const first = service.generate('campaign-world', defaultOptions());
    const second = service.generate('campaign-world', defaultOptions());
    delayed.resolve(undefined);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(execute).toHaveBeenCalledOnce();
    expect(gateway.commits).toHaveLength(1);
  });

  it('preserves provider errors and cleans up explicit cancellation without committing', async () => {
    const authenticationGateway = new FakeWorldGateway();
    const authentication = serviceWithQueue(authenticationGateway, {
      async execute() {
        throw Object.freeze({ code: 'AUTHENTICATION_FAILED' });
      },
    });
    await expect(authentication.generate('campaign-world', defaultOptions())).rejects.toMatchObject(
      { code: 'AUTHENTICATION_FAILED' },
    );
    expect(authenticationGateway.commits).toHaveLength(0);

    const cancelledGateway = new FakeWorldGateway();
    let executionSignal: AbortSignal | undefined;
    const cancelled = serviceWithQueue(cancelledGateway, {
      execute(_task, _input, options) {
        executionSignal = options.signal;
        return new Promise(() => {});
      },
    });
    const controller = new AbortController();
    const pending = cancelled.generate('campaign-world', defaultOptions(), {
      signal: controller.signal,
      onChunk() {},
    });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(executionSignal?.aborted).toBe(true);
    expect(cancelledGateway.commits).toHaveLength(0);
  });
});

function serviceWithQueue(gateway: FakeWorldGateway, engine: DesktopAIEngine) {
  return new WindowsWorldCreationService(
    gateway,
    engine,
    undefined,
    undefined,
    new GenerationQueue({ concurrency: 1, maxPending: 8 }),
  );
}

function execution(requestId: string, draft: WorldDraft) {
  return {
    request: { requestId, promptVersion: 2 },
    response: { content: JSON.stringify(draft) },
    validatedOutput: draft,
  } as never;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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
