import { invoke } from '@tauri-apps/api/core';

import { NpcLodInputSchema, NpcLodOutputSchema, type AIProvider } from '@ember-tavern/ai-core';
import {
  campaignId,
  generationRecordId,
  idempotencyKey,
  npcId,
  parseNpcLodProfile,
  type NpcLodProfile,
} from '@ember-tavern/contracts';

import {
  desktopAIEngine,
  tauriDesktopAIOrchestrator,
  type DesktopAIEngine,
} from './desktop-ai-orchestrator.js';

export interface NpcLodGenerationSnapshot {
  readonly profile: NpcLodProfile;
  readonly input: ReturnType<typeof NpcLodInputSchema.parse> | null;
}

interface NpcLodGenerationAudit {
  readonly requestId: string;
  readonly generationRecordId: string;
  readonly idempotencyKey: string;
  readonly promptVersion: number;
  readonly input: unknown;
  readonly context: unknown;
  readonly request: unknown;
  readonly rawResponseText: string;
  readonly validatedOutput: unknown;
}

export interface NpcLodGateway {
  seed(command: {
    readonly campaignId: string;
    readonly populationRole: string;
  }): Promise<NpcLodGenerationSnapshot>;
  load(campaignId: string, npcId: string): Promise<NpcLodGenerationSnapshot>;
  commit(command: {
    readonly campaignId: string;
    readonly npcId: string;
    readonly expectedRevision: number;
    readonly trigger: 'OBSERVED' | 'INTERACTED' | 'RECURRING';
    readonly generation: NpcLodGenerationAudit;
  }): Promise<NpcLodGenerationSnapshot>;
}

interface NpcLodIdentity {
  readonly requestId: string;
  readonly generationRecordId: string;
  readonly idempotencyKey: string;
}

export const tauriNpcLodGateway: NpcLodGateway = {
  async seed(command) {
    return parseSnapshot(await invoke<unknown>('npc_lod_seed', { command }));
  },
  async load(campaignIdValue, npcIdValue) {
    return parseSnapshot(
      await invoke<unknown>('npc_lod_get', {
        campaignId: campaignIdValue,
        npcId: npcIdValue,
      }),
    );
  },
  async commit(command) {
    return parseSnapshot(await invoke<unknown>('npc_lod_upgrade_commit', { command }));
  },
};

export class NpcLodService {
  private readonly ai: DesktopAIEngine;
  private readonly active = new Map<string, Promise<NpcLodGenerationSnapshot>>();

  public constructor(
    private readonly gateway: NpcLodGateway = tauriNpcLodGateway,
    source?: DesktopAIEngine | AIProvider,
    private readonly createIdentity: () => NpcLodIdentity = defaultIdentity,
  ) {
    this.ai = desktopAIEngine(source);
  }

  public seed(campaignIdValue: string, populationRole: string): Promise<NpcLodGenerationSnapshot> {
    campaignId(campaignIdValue);
    if (populationRole.trim() !== populationRole || populationRole.length === 0) {
      throw new NpcLodServiceError('POPULATION_ROLE_INVALID');
    }
    return this.gateway.seed({ campaignId: campaignIdValue, populationRole });
  }

  public load(campaignIdValue: string, npcIdValue: string): Promise<NpcLodGenerationSnapshot> {
    campaignId(campaignIdValue);
    npcId(npcIdValue);
    return this.gateway.load(campaignIdValue, npcIdValue);
  }

  public upgrade(campaignIdValue: string, npcIdValue: string): Promise<NpcLodGenerationSnapshot> {
    campaignId(campaignIdValue);
    npcId(npcIdValue);
    const key = `${campaignIdValue}:${npcIdValue}`;
    const existing = this.active.get(key);
    if (existing !== undefined) return existing;
    const operation = this.performUpgrade(campaignIdValue, npcIdValue).finally(() => {
      if (this.active.get(key) === operation) this.active.delete(key);
    });
    this.active.set(key, operation);
    return operation;
  }

  private async performUpgrade(
    campaignIdValue: string,
    npcIdValue: string,
  ): Promise<NpcLodGenerationSnapshot> {
    const snapshot = await this.gateway.load(campaignIdValue, npcIdValue);
    if (snapshot.input === null) throw new NpcLodServiceError('LOD_ALREADY_COMPLETE');
    const input = NpcLodInputSchema.parse(snapshot.input);
    const identity = this.createIdentity();
    const generated = await this.ai.execute('GENERATE_NPC_LOD', input, {
      requestId: identity.requestId,
      temperature: 0.6,
      maxOutputTokens: 6_000,
      timeoutMs: 8_000,
    });
    const output = NpcLodOutputSchema.parse(generated.validatedOutput);
    return this.gateway.commit({
      campaignId: campaignIdValue,
      npcId: npcIdValue,
      expectedRevision: snapshot.profile.revision,
      trigger: input.trigger,
      generation: {
        ...identity,
        promptVersion: generated.request.promptVersion,
        input,
        context: {
          campaignId: campaignIdValue,
          npcId: npcIdValue,
          expectedRevision: snapshot.profile.revision,
        },
        request: generated.request,
        rawResponseText: generated.response.content,
        validatedOutput: output,
      },
    });
  }
}

export class NpcLodServiceError extends Error {
  public constructor(public readonly code: string) {
    super('NPC LOD operation failed');
    this.name = 'NpcLodServiceError';
  }
}

function parseSnapshot(value: unknown): NpcLodGenerationSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new NpcLodServiceError('SNAPSHOT_INVALID');
  }
  const record = value as Record<string, unknown>;
  const profile = parseNpcLodProfile(record['profile']);
  const input = record['input'] === null ? null : NpcLodInputSchema.parse(record['input']);
  if (input !== null && input.currentProfile.npcId !== profile.id) {
    throw new NpcLodServiceError('SNAPSHOT_INVALID');
  }
  return Object.freeze({ profile, input });
}

function defaultIdentity(): NpcLodIdentity {
  const suffix = crypto.randomUUID();
  return Object.freeze({
    requestId: `request-npc-lod-${suffix}`,
    generationRecordId: generationRecordId(`generation-npc-lod-${suffix}`),
    idempotencyKey: idempotencyKey(`npc-lod:${suffix}`),
  });
}

export const npcLodService = new NpcLodService(tauriNpcLodGateway, tauriDesktopAIOrchestrator);
