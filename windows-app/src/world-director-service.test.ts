import { describe, expect, it, vi } from 'vitest';

import type { WorldDirectorPreparation, WorldDirectorRun } from '@ember-tavern/contracts';

import {
  WorldDirectorService,
  WorldDirectorServiceError,
  type WorldDirectorGateway,
} from './world-director-service.js';

const digest = 'c'.repeat(64);

describe('WorldDirectorService', () => {
  it('coalesces one trigger and commits the exact prepared digest without an AI dependency', async () => {
    const gateway = new FakeGateway(preparation());
    const service = new WorldDirectorService(gateway, identity);

    const [first, second] = await Promise.all([
      service.schedule('campaign-director', 'WORLD_EVENT', 'event-storm'),
      service.schedule('campaign-director', 'WORLD_EVENT', 'event-storm'),
    ]);

    expect(first).toBe(second);
    expect(gateway.prepare).toHaveBeenCalledTimes(1);
    expect(gateway.commits).toEqual([
      {
        id: 'director-run-test',
        campaignId: 'campaign-director',
        trigger: { kind: 'WORLD_EVENT', id: 'event-storm' },
        expectedContextDigest: digest,
        occurredAt: '2026-08-24T02:00:00.000Z',
      },
    ]);
  });

  it('returns explainable read-only history', async () => {
    const gateway = new FakeGateway(preparation());
    const service = new WorldDirectorService(gateway, identity);

    const history = await service.history('campaign-director', 5);

    expect(gateway.history).toHaveBeenCalledWith('campaign-director', 5);
    expect(history[0]).toMatchObject({
      pace: 'QUIET',
      signals: { openQuestCount: 0 },
      proposals: [{ kind: 'OPPORTUNITY', rationale: expect.any(String) }],
    });
  });

  it('preserves preparation failure as the service error cause and never commits', async () => {
    const rejection = new Error('campaign unavailable');
    const gateway = new FakeGateway(Promise.reject(rejection));
    const service = new WorldDirectorService(gateway, identity);

    await expect(service.schedule('campaign-director', 'MANUAL', 'manual-test')).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof WorldDirectorServiceError &&
        error.code === 'PREPARE_FAILED' &&
        error.cause === rejection,
    );
    expect(gateway.commits).toEqual([]);
  });
});

class FakeGateway implements WorldDirectorGateway {
  public readonly commits: Readonly<Record<string, unknown>>[] = [];
  public readonly prepare = vi.fn(async () => this.resolvePreparation());
  public readonly history = vi.fn(async () => [run]);
  private readonly prepared: WorldDirectorPreparation | Promise<WorldDirectorPreparation>;

  public constructor(prepared: WorldDirectorPreparation | Promise<WorldDirectorPreparation>) {
    this.prepared = prepared;
  }

  public async commit(command: Readonly<Record<string, unknown>>): Promise<WorldDirectorRun> {
    this.commits.push(command);
    return run;
  }

  private resolvePreparation(): Promise<WorldDirectorPreparation> {
    return Promise.resolve(this.prepared);
  }
}

function preparation(): WorldDirectorPreparation {
  return {
    campaignId: 'campaign-director',
    campaignState: 'TAVERN',
    contextDigest: digest,
    pace: 'QUIET',
    pressureScore: 0,
    signals,
    proposals,
    suppressed: [],
    sourceSnapshot: { schemaVersion: 1 },
  } as unknown as WorldDirectorPreparation;
}

function identity() {
  return { id: 'director-run-test', occurredAt: '2026-08-24T02:00:00.000Z' };
}

const signals = {
  openQuestCount: 0,
  activeQuestCount: 0,
  blockedQuestCount: 0,
  staleQuestIds: [],
  urgentClockIds: [],
  foreshadowClockIds: [],
  hostileFactionIds: [],
  recentFailureCount: 0,
  recentEventCount: 0,
};
const proposals = [
  {
    id: 'director-action-1',
    rank: 1,
    kind: 'OPPORTUNITY',
    actorEntityId: null,
    targetEntityIds: ['location-current'],
    rationale: 'The world is quiet.',
    proposedEffects: ['Request one local opportunity.'],
    urgency: 'MEDIUM',
    cooldownKey: 'director:opportunity:location-current',
    route: 'GENERATOR',
  },
] as const;
const run = {
  ...preparation(),
  id: 'director-run-test',
  trigger: { kind: 'WORLD_EVENT', id: 'event-storm' },
  createdAt: '2026-08-24T02:00:00.000Z',
} as WorldDirectorRun;
