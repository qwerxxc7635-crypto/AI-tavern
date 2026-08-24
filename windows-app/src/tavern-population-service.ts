import { invoke } from '@tauri-apps/api/core';

import {
  TAVERN_POPULATION_TRIGGERS,
  campaignId,
  createTavernPopulationSnapshot,
  npcId,
  type TavernPopulationSnapshot,
  type TavernPopulationTrigger,
} from '@ember-tavern/contracts';

import { npcLodService, type NpcLodService } from './npc-lod-service.js';

export interface TavernPopulationGateway {
  load(campaignId: string): Promise<TavernPopulationSnapshot>;
  project(command: {
    readonly campaignId: string;
    readonly trigger: TavernPopulationTrigger;
    readonly operationId: string;
    readonly cycleId: string;
  }): Promise<TavernPopulationSnapshot>;
  focus(command: {
    readonly campaignId: string;
    readonly npcId: string;
    readonly expectedRevision: number;
    readonly operationId: string;
    readonly eventId: string;
  }): Promise<TavernPopulationSnapshot>;
}

interface PopulationIdentity {
  readonly operationId: string;
  readonly recordId: string;
}

export const tauriTavernPopulationGateway: TavernPopulationGateway = {
  async load(campaignIdValue) {
    return parseSnapshot(
      await invoke<unknown>('tavern_population_get', { campaignId: campaignIdValue }),
    );
  },
  async project(command) {
    return parseSnapshot(await invoke<unknown>('tavern_population_project', { command }));
  },
  async focus(command) {
    return parseSnapshot(await invoke<unknown>('tavern_population_focus', { command }));
  },
};

export class TavernPopulationService {
  private readonly refreshes = new Map<string, Promise<TavernPopulationSnapshot>>();
  private readonly focuses = new Map<string, Promise<TavernPopulationSnapshot>>();

  public constructor(
    private readonly gateway: TavernPopulationGateway = tauriTavernPopulationGateway,
    private readonly lod: Pick<NpcLodService, 'upgrade'> = npcLodService,
    private readonly createIdentity: () => PopulationIdentity = defaultIdentity,
  ) {}

  public load(campaignIdValue: string): Promise<TavernPopulationSnapshot> {
    campaignId(campaignIdValue);
    return this.gateway.load(campaignIdValue).then(parseSnapshot);
  }

  public refresh(
    campaignIdValue: string,
    trigger: TavernPopulationTrigger,
  ): Promise<TavernPopulationSnapshot> {
    campaignId(campaignIdValue);
    if (!TAVERN_POPULATION_TRIGGERS.includes(trigger)) {
      throw new TavernPopulationServiceError('TRIGGER_INVALID');
    }
    const existing = this.refreshes.get(campaignIdValue);
    if (existing !== undefined) return existing;
    const identity = this.createIdentity();
    const operation = this.gateway
      .project({
        campaignId: campaignIdValue,
        trigger,
        operationId: identity.operationId,
        cycleId: identity.recordId,
      })
      .then(parseSnapshot)
      .finally(() => {
        if (this.refreshes.get(campaignIdValue) === operation) {
          this.refreshes.delete(campaignIdValue);
        }
      });
    this.refreshes.set(campaignIdValue, operation);
    return operation;
  }

  public focus(
    campaignIdValue: string,
    npcIdValue: string,
    expectedRevision: number,
  ): Promise<TavernPopulationSnapshot> {
    campaignId(campaignIdValue);
    npcId(npcIdValue);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new TavernPopulationServiceError('REVISION_INVALID');
    }
    const key = `${campaignIdValue}:${npcIdValue}`;
    const existing = this.focuses.get(key);
    if (existing !== undefined) return existing;
    const operation = this.performFocus(campaignIdValue, npcIdValue, expectedRevision).finally(
      () => {
        if (this.focuses.get(key) === operation) this.focuses.delete(key);
      },
    );
    this.focuses.set(key, operation);
    return operation;
  }

  private async performFocus(
    campaignIdValue: string,
    npcIdValue: string,
    expectedRevision: number,
  ): Promise<TavernPopulationSnapshot> {
    const snapshot = parseSnapshot(await this.gateway.load(campaignIdValue));
    const member = snapshot.members.find(({ npcId: id }) => id === npcIdValue);
    if (
      snapshot.state?.revision !== expectedRevision ||
      member === undefined ||
      member.presence !== 'PRESENT'
    ) {
      throw new TavernPopulationServiceError('FOCUS_INVALID');
    }
    if (member.profile.lod === 0) await this.lod.upgrade(campaignIdValue, npcIdValue);
    const identity = this.createIdentity();
    return parseSnapshot(
      await this.gateway.focus({
        campaignId: campaignIdValue,
        npcId: npcIdValue,
        expectedRevision,
        operationId: identity.operationId,
        eventId: identity.recordId,
      }),
    );
  }
}

export class TavernPopulationServiceError extends Error {
  public constructor(
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super('Tavern population operation failed', options);
    this.name = 'TavernPopulationServiceError';
  }
}

function parseSnapshot(value: unknown): TavernPopulationSnapshot {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError('Snapshot must be an object');
    }
    const record = value as Record<string, unknown>;
    if (
      !Array.isArray(record['members']) ||
      !Array.isArray(record['cycles']) ||
      !Array.isArray(record['focusHistory']) ||
      (record['state'] !== null &&
        (typeof record['state'] !== 'object' || Array.isArray(record['state'])))
    ) {
      throw new TypeError('Snapshot collections are invalid');
    }
    return createTavernPopulationSnapshot(value as TavernPopulationSnapshot);
  } catch (error) {
    throw new TavernPopulationServiceError('SNAPSHOT_INVALID', { cause: error });
  }
}

function defaultIdentity(): PopulationIdentity {
  const suffix = crypto.randomUUID();
  return Object.freeze({
    operationId: `tavern-population-operation-${suffix}`,
    recordId: `tavern-population-record-${suffix}`,
  });
}

export const tavernPopulationService = new TavernPopulationService(
  tauriTavernPopulationGateway,
  npcLodService,
);
