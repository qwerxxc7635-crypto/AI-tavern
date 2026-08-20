import { invoke } from '@tauri-apps/api/core';

import { FactionInputSchema, FactionOutputSchema, type AIProvider } from '@ember-tavern/ai-core';
import {
  campaignId,
  factionActionProposal,
  factionId,
  generationRecordId,
  idempotencyKey,
  isoTimestamp,
  parseActiveFactionProfile,
  type ActiveFactionProfile,
  type FactionActionBudget,
  type FactionActionEvent,
  type FactionActionProposal,
} from '@ember-tavern/contracts';

import { desktopAIEngine, type DesktopAIEngine } from './desktop-ai-orchestrator.js';

export interface ActiveFactionSnapshot {
  readonly factions: readonly ActiveFactionProfile[];
  readonly actionHistory: readonly FactionActionEvent[];
}

export interface ActiveFactionGenerationSnapshot {
  readonly factions: ActiveFactionSnapshot;
  readonly input: ReturnType<typeof FactionInputSchema.parse>;
}

interface GenerationIdentity {
  readonly requestId: string;
  readonly generationRecordId: string;
  readonly idempotencyKey: string;
}

interface ActionIdentity {
  readonly eventId: string;
  readonly operationId: string;
}

export interface ActiveFactionGateway {
  load(campaignId: string): Promise<ActiveFactionSnapshot>;
  generation(command: {
    readonly campaignId: string;
    readonly requestedFactionIds: readonly string[];
  }): Promise<ActiveFactionGenerationSnapshot>;
  commit(command: {
    readonly campaignId: string;
    readonly requestedFactionIds: readonly string[];
    readonly generation: Record<string, unknown>;
  }): Promise<ActiveFactionSnapshot>;
  apply(command: {
    readonly eventId: string;
    readonly operationId: string;
    readonly campaignId: string;
    readonly expectedRevision: number;
    readonly proposal: FactionActionProposal;
    readonly budget: FactionActionBudget;
    readonly worldFactId: string | null;
  }): Promise<ActiveFactionSnapshot>;
}

export const tauriActiveFactionGateway: ActiveFactionGateway = {
  async load(campaignIdValue) {
    return parseSnapshot(
      await invoke<unknown>('active_factions_get', { campaignId: campaignIdValue }),
    );
  },
  async generation(command) {
    return parseGenerationSnapshot(
      await invoke<unknown>('active_factions_generation_get', { command }),
    );
  },
  async commit(command) {
    return parseSnapshot(await invoke<unknown>('active_factions_generation_commit', { command }));
  },
  async apply(command) {
    return parseSnapshot(await invoke<unknown>('active_factions_action_apply', { command }));
  },
};

export class ActiveFactionService {
  private readonly ai: DesktopAIEngine;
  private readonly active = new Map<string, Promise<ActiveFactionSnapshot>>();

  public constructor(
    private readonly gateway: ActiveFactionGateway = tauriActiveFactionGateway,
    source?: DesktopAIEngine | AIProvider,
    private readonly createGenerationIdentity: () => GenerationIdentity = defaultGenerationIdentity,
    private readonly createActionIdentity: () => ActionIdentity = defaultActionIdentity,
  ) {
    this.ai = desktopAIEngine(source);
  }

  public load(campaignIdValue: string): Promise<ActiveFactionSnapshot> {
    campaignId(campaignIdValue);
    return this.gateway.load(campaignIdValue);
  }

  public activate(
    campaignIdValue: string,
    requestedFactionIdValues: readonly string[],
  ): Promise<ActiveFactionSnapshot> {
    campaignId(campaignIdValue);
    const requested = requestedFactionIdValues.map((value) => factionId(value));
    if (
      requested.length === 0 ||
      requested.length > 16 ||
      new Set(requested).size !== requested.length
    ) {
      throw new ActiveFactionServiceError('ACTIVATION_INVALID');
    }
    const canonical = [...requested].sort();
    const key = `${campaignIdValue}:${canonical.join(',')}`;
    const existing = this.active.get(key);
    if (existing !== undefined) return existing;
    const operation = this.performActivation(campaignIdValue, canonical).finally(() => {
      if (this.active.get(key) === operation) this.active.delete(key);
    });
    this.active.set(key, operation);
    return operation;
  }

  public applyAction(command: {
    readonly campaignId: string;
    readonly expectedRevision: number;
    readonly proposal: FactionActionProposal;
    readonly budget: FactionActionBudget;
    readonly worldFactId: string | null;
  }): Promise<ActiveFactionSnapshot> {
    campaignId(command.campaignId);
    if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1) {
      throw new ActiveFactionServiceError('ACTION_INVALID');
    }
    const proposal = factionActionProposal(command.proposal);
    return this.gateway.apply({ ...command, proposal, ...this.createActionIdentity() });
  }

  private async performActivation(
    campaignIdValue: string,
    requestedFactionIds: readonly string[],
  ): Promise<ActiveFactionSnapshot> {
    const snapshot = await this.gateway.generation({
      campaignId: campaignIdValue,
      requestedFactionIds,
    });
    const input = FactionInputSchema.parse(snapshot.input);
    const identity = this.createGenerationIdentity();
    const generated = await this.ai.execute('GENERATE_FACTIONS', input, {
      requestId: identity.requestId,
      temperature: 0.55,
      maxOutputTokens: 8_000,
      timeoutMs: 10_000,
    });
    const output = FactionOutputSchema.parse(generated.validatedOutput);
    return this.gateway.commit({
      campaignId: campaignIdValue,
      requestedFactionIds,
      generation: {
        ...identity,
        promptVersion: generated.request.promptVersion,
        input,
        context: { campaignId: campaignIdValue, requestedFactionIds },
        request: generated.request,
        rawResponseText: generated.response.content,
        validatedOutput: output,
      },
    });
  }
}

export class ActiveFactionServiceError extends Error {
  public constructor(public readonly code: string) {
    super('Active faction operation failed');
    this.name = 'ActiveFactionServiceError';
  }
}

function parseGenerationSnapshot(value: unknown): ActiveFactionGenerationSnapshot {
  const record = object(value);
  const factions = parseSnapshot(record['factions']);
  const input = FactionInputSchema.parse(record['input']);
  if (input.context.worldId !== factions.factions[0]?.campaignId) {
    throw new ActiveFactionServiceError('SNAPSHOT_INVALID');
  }
  return Object.freeze({ factions, input });
}

function parseSnapshot(value: unknown): ActiveFactionSnapshot {
  const record = object(value);
  const factions = array(record['factions']).map(parseActiveFactionProfile);
  if (
    factions.length === 0 ||
    factions.some(({ campaignId: id }) => id !== factions[0]?.campaignId)
  ) {
    throw new ActiveFactionServiceError('SNAPSHOT_INVALID');
  }
  const actionHistory = array(record['actionHistory']).map(parseActionEvent);
  return Object.freeze({
    factions: Object.freeze(factions),
    actionHistory: Object.freeze(actionHistory),
  });
}

function parseActionEvent(value: unknown): FactionActionEvent {
  const record = object(value);
  return Object.freeze({
    id: requiredString(record['id']),
    campaignId: campaignId(requiredString(record['campaignId'])),
    factionId: factionId(requiredString(record['factionId'])),
    source: requiredString(record['source']) as FactionActionEvent['source'],
    actionKind: requiredString(record['actionKind']) as FactionActionEvent['actionKind'],
    summary: requiredString(record['summary']),
    cost: positiveInteger(record['cost']),
    budgetDecisionId: requiredString(record['budgetDecisionId']),
    beforeRevision: positiveInteger(record['beforeRevision']),
    afterRevision: positiveInteger(record['afterRevision']),
    proposal: factionActionProposal(record['proposal'] as FactionActionProposal),
    occurredAt: isoTimestamp(requiredString(record['occurredAt'])),
  });
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ActiveFactionServiceError('SNAPSHOT_INVALID');
  }
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new ActiveFactionServiceError('SNAPSHOT_INVALID');
  return value;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new ActiveFactionServiceError('SNAPSHOT_INVALID');
  return value;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new ActiveFactionServiceError('SNAPSHOT_INVALID');
  return value as number;
}

function defaultGenerationIdentity(): GenerationIdentity {
  const id = crypto.randomUUID();
  return {
    requestId: `faction-request-${id}`,
    generationRecordId: generationRecordId(`faction-generation-${id}`),
    idempotencyKey: idempotencyKey(`faction-activation:${id}`),
  };
}

function defaultActionIdentity(): ActionIdentity {
  const id = crypto.randomUUID();
  return { eventId: `faction-event-${id}`, operationId: `faction-action:${id}` };
}
