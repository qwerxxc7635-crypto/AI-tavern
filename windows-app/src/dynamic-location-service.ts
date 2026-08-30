import { invoke } from '@tauri-apps/api/core';

import { LocationInputSchema, LocationOutputSchema, type AIProvider } from '@ember-tavern/ai-core';
import {
  LOCATION_EXPANSION_MODES,
  LOCATION_TRAVEL_MODES,
  campaignId,
  generationRecordId,
  idempotencyKey,
  isoTimestamp,
  locationId,
  parseDynamicLocationProfile,
  type CampaignLocationState,
  type DynamicLocationProfile,
  type LocationConnection,
  type LocationExpansionMode,
  type LocationTravelEvent,
  type LocationTravelMode,
} from '@ember-tavern/contracts';
import { validateLocationTopology } from '@ember-tavern/domain';

import {
  desktopAIEngine,
  tauriDesktopAIOrchestrator,
  type DesktopAIEngine,
} from './desktop-ai-orchestrator.js';

export interface DynamicLocationSnapshot {
  readonly state: CampaignLocationState;
  readonly locations: readonly DynamicLocationProfile[];
  readonly connections: readonly LocationConnection[];
  readonly travelHistory: readonly LocationTravelEvent[];
}

export interface DynamicLocationGenerationSnapshot {
  readonly graph: DynamicLocationSnapshot;
  readonly input: ReturnType<typeof LocationInputSchema.parse>;
}

interface LocationGenerationAudit {
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

interface LocationIdentity {
  readonly requestId: string;
  readonly generationRecordId: string;
  readonly idempotencyKey: string;
}

interface TravelIdentity {
  readonly eventId: string;
  readonly operationId: string;
}

export interface DynamicLocationGateway {
  load(campaignId: string): Promise<DynamicLocationSnapshot>;
  generation(command: {
    readonly campaignId: string;
    readonly originLocationId: string;
    readonly expansionMode: LocationExpansionMode;
    readonly requestedCount: number;
  }): Promise<DynamicLocationGenerationSnapshot>;
  commit(command: {
    readonly campaignId: string;
    readonly originLocationId: string;
    readonly expansionMode: LocationExpansionMode;
    readonly requestedCount: number;
    readonly generation: LocationGenerationAudit;
  }): Promise<DynamicLocationSnapshot>;
  travel(command: {
    readonly campaignId: string;
    readonly targetLocationId: string;
    readonly expectedRevision: number;
    readonly mode: LocationTravelMode;
    readonly eventId: string;
    readonly operationId: string;
  }): Promise<DynamicLocationSnapshot>;
}

export const tauriDynamicLocationGateway: DynamicLocationGateway = {
  async load(campaignIdValue) {
    return parseSnapshot(
      await invoke<unknown>('dynamic_locations_get', { campaignId: campaignIdValue }),
    );
  },
  async generation(command) {
    return parseGenerationSnapshot(
      await invoke<unknown>('dynamic_locations_generation_get', { command }),
    );
  },
  async commit(command) {
    return parseSnapshot(await invoke<unknown>('dynamic_locations_generation_commit', { command }));
  },
  async travel(command) {
    return parseSnapshot(await invoke<unknown>('dynamic_locations_travel', { command }));
  },
};

export class DynamicLocationService {
  private readonly ai: DesktopAIEngine;
  private readonly active = new Map<string, Promise<DynamicLocationSnapshot>>();

  public constructor(
    private readonly gateway: DynamicLocationGateway = tauriDynamicLocationGateway,
    source?: DesktopAIEngine | AIProvider,
    private readonly createIdentity: () => LocationIdentity = defaultLocationIdentity,
    private readonly createTravelIdentity: () => TravelIdentity = defaultTravelIdentity,
  ) {
    this.ai = desktopAIEngine(source);
  }

  public load(campaignIdValue: string): Promise<DynamicLocationSnapshot> {
    campaignId(campaignIdValue);
    return this.gateway.load(campaignIdValue);
  }

  public expand(
    campaignIdValue: string,
    originLocationIdValue: string,
    expansionMode: LocationExpansionMode,
    requestedCount: number,
  ): Promise<DynamicLocationSnapshot> {
    campaignId(campaignIdValue);
    locationId(originLocationIdValue);
    if (
      !LOCATION_EXPANSION_MODES.includes(expansionMode) ||
      !Number.isSafeInteger(requestedCount) ||
      requestedCount < 1 ||
      requestedCount > 8
    ) {
      throw new DynamicLocationServiceError('EXPANSION_INVALID');
    }
    const key = `${campaignIdValue}:${originLocationIdValue}:${expansionMode}:${requestedCount}`;
    const existing = this.active.get(key);
    if (existing !== undefined) return existing;
    const operation = this.performExpansion(
      campaignIdValue,
      originLocationIdValue,
      expansionMode,
      requestedCount,
    ).finally(() => {
      if (this.active.get(key) === operation) this.active.delete(key);
    });
    this.active.set(key, operation);
    return operation;
  }

  public async travel(
    campaignIdValue: string,
    targetLocationIdValue: string,
    expectedRevision: number,
    mode: LocationTravelMode,
  ): Promise<DynamicLocationSnapshot> {
    campaignId(campaignIdValue);
    locationId(targetLocationIdValue);
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 1 ||
      !LOCATION_TRAVEL_MODES.includes(mode)
    ) {
      throw new DynamicLocationServiceError('TRAVEL_INVALID');
    }
    return this.gateway.travel({
      campaignId: campaignIdValue,
      targetLocationId: targetLocationIdValue,
      expectedRevision,
      mode,
      ...this.createTravelIdentity(),
    });
  }

  private async performExpansion(
    campaignIdValue: string,
    originLocationIdValue: string,
    expansionMode: LocationExpansionMode,
    requestedCount: number,
  ): Promise<DynamicLocationSnapshot> {
    const snapshot = await this.gateway.generation({
      campaignId: campaignIdValue,
      originLocationId: originLocationIdValue,
      expansionMode,
      requestedCount,
    });
    const input = LocationInputSchema.parse(snapshot.input);
    const identity = this.createIdentity();
    const generated = await this.ai.execute('GENERATE_LOCATIONS', input, {
      requestId: identity.requestId,
      temperature: 0.65,
      maxOutputTokens: 8_000,
      timeoutMs: 10_000,
    });
    const output = LocationOutputSchema.parse(generated.validatedOutput);
    return this.gateway.commit({
      campaignId: campaignIdValue,
      originLocationId: originLocationIdValue,
      expansionMode,
      requestedCount,
      generation: {
        ...identity,
        promptVersion: generated.request.promptVersion,
        input,
        context: {
          campaignId: campaignIdValue,
          originLocationId: originLocationIdValue,
          expansionMode,
          requestedCount,
        },
        request: generated.request,
        rawResponseText: generated.response.content,
        validatedOutput: output,
      },
    });
  }
}

export class DynamicLocationServiceError extends Error {
  public constructor(
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super('Dynamic location operation failed', options);
    this.name = 'DynamicLocationServiceError';
  }
}

function parseGenerationSnapshot(value: unknown): DynamicLocationGenerationSnapshot {
  const record = object(value, 'generation snapshot');
  const graph = parseSnapshot(record['graph']);
  const input = LocationInputSchema.parse(record['input']);
  if (
    input.context.worldId !== graph.state.campaignId ||
    !graph.locations.some(({ id }) => id === input.originLocation.id)
  ) {
    throw new DynamicLocationServiceError('SNAPSHOT_INVALID');
  }
  return Object.freeze({ graph, input });
}

function parseSnapshot(value: unknown): DynamicLocationSnapshot {
  try {
    const record = object(value, 'location snapshot');
    const stateRecord = object(record['state'], 'location state');
    const state = Object.freeze({
      campaignId: campaignId(requiredString(stateRecord['campaignId'])),
      currentLocationId: locationId(requiredString(stateRecord['currentLocationId'])),
      revision: positiveInteger(stateRecord['revision']),
      updatedAt: isoTimestamp(requiredString(stateRecord['updatedAt'])),
    });
    const locations = array(record['locations']).map(parseDynamicLocationProfile);
    validateLocationTopology(locations);
    if (
      locations.length === 0 ||
      !locations.some(({ id }) => id === state.currentLocationId) ||
      locations.some(({ campaignId: owner }) => owner !== state.campaignId)
    ) {
      throw new DynamicLocationServiceError('SNAPSHOT_INVALID');
    }
    const connections = array(record['connections']).map((entry) => parseConnection(entry, state));
    const travelHistory = array(record['travelHistory']).map((entry) => parseTravel(entry, state));
    return Object.freeze({
      state,
      locations: Object.freeze(locations),
      connections: Object.freeze(connections),
      travelHistory: Object.freeze(travelHistory),
    });
  } catch (error) {
    if (error instanceof DynamicLocationServiceError) throw error;
    throw new DynamicLocationServiceError('SNAPSHOT_INVALID', { cause: error });
  }
}

function parseConnection(value: unknown, state: CampaignLocationState): LocationConnection {
  const record = object(value, 'location connection');
  const source = record['source'];
  if (source !== 'INITIAL_HIERARCHY' && source !== 'GENERATED') {
    throw new DynamicLocationServiceError('SNAPSHOT_INVALID');
  }
  if (campaignId(requiredString(record['campaignId'])) !== state.campaignId) {
    throw new DynamicLocationServiceError('SNAPSHOT_INVALID');
  }
  return Object.freeze({
    id: requiredString(record['id']),
    campaignId: state.campaignId,
    firstLocationId: locationId(requiredString(record['firstLocationId'])),
    secondLocationId: locationId(requiredString(record['secondLocationId'])),
    source,
    generationRecordId:
      record['generationRecordId'] === null
        ? null
        : generationRecordId(requiredString(record['generationRecordId'])),
    createdAt: isoTimestamp(requiredString(record['createdAt'])),
  });
}

function parseTravel(value: unknown, state: CampaignLocationState): LocationTravelEvent {
  const record = object(value, 'location travel');
  const mode = record['mode'];
  if (typeof mode !== 'string' || !LOCATION_TRAVEL_MODES.includes(mode as LocationTravelMode)) {
    throw new DynamicLocationServiceError('SNAPSHOT_INVALID');
  }
  if (campaignId(requiredString(record['campaignId'])) !== state.campaignId) {
    throw new DynamicLocationServiceError('SNAPSHOT_INVALID');
  }
  return Object.freeze({
    id: requiredString(record['id']),
    campaignId: state.campaignId,
    fromLocationId: locationId(requiredString(record['fromLocationId'])),
    toLocationId: locationId(requiredString(record['toLocationId'])),
    mode: mode as LocationTravelMode,
    beforeRevision: positiveInteger(record['beforeRevision']),
    afterRevision: positiveInteger(record['afterRevision']),
    occurredAt: isoTimestamp(requiredString(record['occurredAt'])),
  });
}

function defaultLocationIdentity(): LocationIdentity {
  const suffix = crypto.randomUUID();
  return Object.freeze({
    requestId: `request-location-${suffix}`,
    generationRecordId: generationRecordId(`generation-location-${suffix}`),
    idempotencyKey: idempotencyKey(`location:${suffix}`),
  });
}

function defaultTravelIdentity(): TravelIdentity {
  const suffix = crypto.randomUUID();
  return Object.freeze({
    eventId: `travel-${suffix}`,
    operationId: `location-travel:${suffix}`,
  });
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DynamicLocationServiceError('SNAPSHOT_INVALID', { cause: new TypeError(label) });
  }
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new DynamicLocationServiceError('SNAPSHOT_INVALID');
  return value;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new DynamicLocationServiceError('SNAPSHOT_INVALID');
  }
  return value;
}

function positiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new DynamicLocationServiceError('SNAPSHOT_INVALID');
  }
  return value;
}

export const dynamicLocationService = new DynamicLocationService(
  tauriDynamicLocationGateway,
  tauriDesktopAIOrchestrator,
);
