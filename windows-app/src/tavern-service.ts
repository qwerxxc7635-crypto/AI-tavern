import { invoke } from '@tauri-apps/api/core';

import {
  FakeAIProvider,
  GenerateNpcsInputSchema,
  GenerateNpcsOutputSchema,
  GenerateTavernInputSchema,
  GenerateTavernOutputSchema,
  validateAIOutput,
  type AIProvider,
  type AITask,
  type NormalizedAIRequest,
  type ProviderConfig,
} from '@ember-tavern/ai-core';
import {
  aiRequestId,
  campaignId,
  generationRecordId,
  idempotencyKey,
  isoTimestamp,
} from '@ember-tavern/contracts';
import { formatTaskPrompt } from '@ember-tavern/prompts';

export interface TavernWorldContext {
  readonly name: string;
  readonly currentRegion: string;
  readonly summary: string;
  readonly coreConflict: string;
  readonly technologyLevel: string;
  readonly powerRules: readonly string[];
}

export interface TavernGenerationSource {
  readonly playerCharacterId: string;
  readonly locationId: string;
  readonly world: TavernWorldContext;
  readonly playerConcept: string;
  readonly desiredPosition: string | null;
}

export interface TavernView {
  readonly id: string;
  readonly campaignId: string;
  readonly locationId: string;
  readonly name: string;
  readonly position: string;
  readonly environment: string;
  readonly specialRules: readonly string[];
  readonly longTermProblem: string;
  readonly ownerNpcId: string;
  readonly changes: readonly {
    readonly id: string;
    readonly kind: string;
    readonly description: string;
  }[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TavernNpcView {
  readonly id: string;
  readonly residency: 'OWNER' | 'RESIDENT' | 'TEMPORARY_VISITOR';
  readonly name: string;
  readonly identity: string;
  readonly appearance: string;
  readonly personality: string;
  readonly currentMood: string;
  readonly currentStatus: 'ACTIVE' | 'ABSENT' | 'LEFT' | 'DECEASED';
  readonly visitReason: string | null;
}

export interface RumorView {
  readonly id: string;
  readonly statement: string;
  readonly sourceNpcId: string;
}

export interface WorldClockView {
  readonly id: string;
  readonly name: string;
  readonly current: number;
  readonly max: number;
  readonly stages: readonly { readonly at: number; readonly title: string }[];
}

export interface TavernSnapshot {
  readonly campaignState: string;
  readonly source: TavernGenerationSource;
  readonly tavern: TavernView | null;
  readonly npcs: readonly TavernNpcView[];
  readonly rumors: readonly RumorView[];
  readonly clocks: readonly WorldClockView[];
}

interface GenerationAudit {
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

interface TavernCommit {
  readonly campaignId: string;
  readonly generation: GenerationAudit;
}

interface NpcRosterCommit extends TavernCommit {
  readonly tavernId: string;
}

export interface TavernGateway {
  load(campaignId: string): Promise<TavernSnapshot>;
  commitTavern(command: TavernCommit): Promise<TavernSnapshot>;
  commitNpcs(command: NpcRosterCommit): Promise<TavernSnapshot>;
}

interface RequestIdentity {
  readonly requestId: string;
  readonly generationRecordId: string;
  readonly idempotencyKey: string;
}

const PROVIDER_CONFIG: ProviderConfig = Object.freeze({
  id: 'windows-offline-fake',
  providerType: 'LOCAL_OPENAI_COMPATIBLE',
  presetKey: 'custom',
  displayName: 'Ember Fake',
  baseUrl: null,
  credentialRef: null,
  options: {},
  enabled: true,
});

export const tauriTavernGateway: TavernGateway = {
  async load(id) {
    return parseSnapshot(await invoke<unknown>('tavern_get', { id }), id);
  },
  async commitTavern(command) {
    return parseSnapshot(
      await invoke<unknown>('tavern_generation_commit', { command }),
      command.campaignId,
    );
  },
  async commitNpcs(command) {
    return parseSnapshot(
      await invoke<unknown>('tavern_npcs_commit', { command }),
      command.campaignId,
    );
  },
};

export class WindowsTavernService {
  private readonly initializations = new Map<string, Promise<TavernSnapshot>>();

  public constructor(
    private readonly gateway: TavernGateway = tauriTavernGateway,
    private readonly provider: AIProvider = new FakeAIProvider(),
    private readonly createIdentity: (task: TavernTask) => RequestIdentity = defaultIdentity,
  ) {}

  public load(id: string): Promise<TavernSnapshot> {
    campaignId(id);
    return this.gateway.load(id);
  }

  public async initialize(id: string): Promise<TavernSnapshot> {
    campaignId(id);
    const existing = this.initializations.get(id);
    if (existing !== undefined) return existing;
    const operation = this.initializeOnce(id);
    this.initializations.set(id, operation);
    try {
      return await operation;
    } finally {
      if (this.initializations.get(id) === operation) {
        this.initializations.delete(id);
      }
    }
  }

  private async initializeOnce(id: string): Promise<TavernSnapshot> {
    let snapshot = await this.gateway.load(id);
    if (snapshot.campaignState === 'TAVERN') return snapshot;
    if (snapshot.campaignState !== 'GENERATING_TAVERN') {
      throw new TavernServiceError('CAMPAIGN_STATE_INVALID');
    }
    if (snapshot.tavern === null) {
      const input = GenerateTavernInputSchema.parse({
        world: snapshot.source.world,
        playerConcept: snapshot.source.playerConcept,
        desiredPosition: snapshot.source.desiredPosition,
      });
      snapshot = await this.gateway.commitTavern({
        campaignId: id,
        generation: await this.generate('GENERATE_TAVERN', input, {
          source: snapshot.source,
        }),
      });
    }
    const tavern = snapshot.tavern;
    if (tavern === null) throw new TavernServiceError('TAVERN_COMMIT_MISSING');
    const input = GenerateNpcsInputSchema.parse({
      world: snapshot.source.world,
      tavern: {
        name: tavern.name,
        position: tavern.position,
        environment: tavern.environment,
        longTermProblem: tavern.longTermProblem,
      },
      existingNpcNames: snapshot.npcs.map(({ name }) => name),
      requestedCount: 3,
    });
    return this.gateway.commitNpcs({
      campaignId: id,
      tavernId: tavern.id,
      generation: await this.generate('GENERATE_NPCS', input, {
        source: snapshot.source,
        tavernId: tavern.id,
      }),
    });
  }

  private async generate(
    task: TavernTask,
    input: unknown,
    context: unknown,
  ): Promise<GenerationAudit> {
    const identity = this.createIdentity(task);
    const model = (await this.provider.listModels()).find(({ name }) => name === 'ember-fake-v1');
    if (model === undefined) throw new TavernServiceError('MODEL_NOT_FOUND');
    const prompt = formatTaskPrompt(task, input, model.capabilities);
    const request: NormalizedAIRequest = {
      requestId: aiRequestId(identity.requestId),
      task,
      promptVersion: prompt.promptVersion,
      modelName: model.name,
      messages: prompt.messages,
      responseFormat: prompt.responseFormat,
      temperature: 0,
      maxOutputTokens: 6_000,
      timeoutMs: 5_000,
    };
    const response = await this.provider.generate(request, PROVIDER_CONFIG);
    if (response.requestId !== request.requestId || response.modelName !== request.modelName) {
      throw new TavernServiceError('PROVIDER_IDENTITY_MISMATCH');
    }
    const validated = validateAIOutput(task, response.content);
    if (!validated.ok) throw new TavernServiceError(validated.error.code);
    if (task === 'GENERATE_TAVERN') {
      GenerateTavernOutputSchema.parse(validated.validatedOutput);
    } else {
      GenerateNpcsOutputSchema.parse(validated.validatedOutput);
    }
    return {
      ...identity,
      promptVersion: request.promptVersion,
      input,
      context,
      request,
      rawResponseText: response.content,
      validatedOutput: validated.validatedOutput,
    };
  }
}

export const windowsTavernService = new WindowsTavernService();

export class TavernServiceError extends Error {
  public constructor(public readonly code: string) {
    super('Tavern operation failed');
    this.name = 'TavernServiceError';
  }
}

type TavernTask = Extract<AITask, 'GENERATE_TAVERN' | 'GENERATE_NPCS'>;

function defaultIdentity(task: TavernTask): RequestIdentity {
  const suffix = crypto.randomUUID();
  return {
    requestId: aiRequestId(`tavern-request-${suffix}`),
    generationRecordId: generationRecordId(`tavern-generation-${suffix}`),
    idempotencyKey: idempotencyKey(`tavern:${task.toLowerCase()}:${suffix}`),
  };
}

function parseSnapshot(value: unknown, expectedCampaignId: string): TavernSnapshot {
  const record = requireRecord(value);
  const npcs = requireArray(record['npcs']).map(parseNpc);
  const rumors = requireArray(record['rumors']).map(parseRumor);
  const clocks = requireArray(record['clocks']).map(parseClock);
  return Object.freeze({
    campaignState: requireString(record['campaignState']),
    source: parseSource(record['source']),
    tavern: record['tavern'] === null ? null : parseTavern(record['tavern'], expectedCampaignId),
    npcs: Object.freeze(npcs),
    rumors: Object.freeze(rumors),
    clocks: Object.freeze(clocks),
  });
}

function parseSource(value: unknown): TavernGenerationSource {
  const record = requireRecord(value);
  const world = requireRecord(record['world']);
  return Object.freeze({
    playerCharacterId: requireString(record['playerCharacterId']),
    locationId: requireString(record['locationId']),
    world: {
      name: requireString(world['name']),
      currentRegion: requireString(world['currentRegion']),
      summary: requireString(world['summary']),
      coreConflict: requireString(world['coreConflict']),
      technologyLevel: requireString(world['technologyLevel']),
      powerRules: stringArray(world['powerRules']),
    },
    playerConcept: requireString(record['playerConcept']),
    desiredPosition: nullableString(record['desiredPosition']),
  });
}

function parseTavern(value: unknown, expectedCampaignId: string): TavernView {
  const record = requireRecord(value);
  const storedCampaign = campaignId(requireString(record['campaignId']));
  if (storedCampaign !== expectedCampaignId)
    throw new TypeError('Tavern belongs to another campaign');
  return Object.freeze({
    id: requireString(record['id']),
    campaignId: storedCampaign,
    locationId: requireString(record['locationId']),
    name: requireString(record['name']),
    position: requireString(record['position']),
    environment: requireString(record['environment']),
    specialRules: stringArray(record['specialRules']),
    longTermProblem: requireString(record['longTermProblem']),
    ownerNpcId: requireString(record['ownerNpcId']),
    changes: Object.freeze(
      requireArray(record['changes']).map((value) => {
        const change = requireRecord(value);
        return Object.freeze({
          id: requireString(change['id']),
          kind: requireString(change['kind']),
          description: requireString(change['description']),
        });
      }),
    ),
    createdAt: isoTimestamp(requireString(record['createdAt'])),
    updatedAt: isoTimestamp(requireString(record['updatedAt'])),
  });
}

function parseNpc(value: unknown): TavernNpcView {
  const record = requireRecord(value);
  const residency = requireString(record['residency']);
  const status = requireString(record['currentStatus']);
  if (!['OWNER', 'RESIDENT', 'TEMPORARY_VISITOR'].includes(residency)) {
    throw new TypeError('NPC residency is invalid');
  }
  if (!['ACTIVE', 'ABSENT', 'LEFT', 'DECEASED'].includes(status)) {
    throw new TypeError('NPC status is invalid');
  }
  return Object.freeze({
    id: requireString(record['id']),
    residency: residency as TavernNpcView['residency'],
    name: requireString(record['name']),
    identity: requireString(record['identity']),
    appearance: requireString(record['appearance']),
    personality: requireString(record['personality']),
    currentMood: requireString(record['currentMood']),
    currentStatus: status as TavernNpcView['currentStatus'],
    visitReason: nullableString(record['visitReason']),
  });
}

function parseRumor(value: unknown): RumorView {
  const record = requireRecord(value);
  return Object.freeze({
    id: requireString(record['id']),
    statement: requireString(record['statement']),
    sourceNpcId: requireString(record['sourceNpcId']),
  });
}

function parseClock(value: unknown): WorldClockView {
  const record = requireRecord(value);
  const current = safeInteger(record['current']);
  const max = safeInteger(record['max']);
  if (current < 0 || max < 1 || current > max) throw new TypeError('World clock range is invalid');
  const stages = requireArray(record['stages']).map((value) => {
    const stage = requireRecord(value);
    const at = safeInteger(stage['at']);
    if (at < 1 || at > max) throw new TypeError('World clock stage is invalid');
    return Object.freeze({ at, title: requireString(stage['title']) });
  });
  return Object.freeze({
    id: requireString(record['id']),
    name: requireString(record['name']),
    current,
    max,
    stages: Object.freeze(stages),
  });
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Native tavern response must be an object');
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError('Native tavern collection is invalid');
  return value;
}

function requireString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new TypeError('Native tavern text is invalid');
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : requireString(value);
}

function safeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError('Native tavern number is invalid');
  }
  return value;
}

function stringArray(value: unknown): readonly string[] {
  return Object.freeze(requireArray(value).map(requireString));
}
