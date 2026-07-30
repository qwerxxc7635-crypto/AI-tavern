import { invoke } from '@tauri-apps/api/core';

import {
  FakeAIProvider,
  GenerateWorldInputSchema,
  GenerateWorldOutputSchema,
  RefineWorldInputSchema,
  RefineWorldOutputSchema,
  validateAIOutput,
  type AIProvider,
  type AITask,
  type NormalizedAIRequest,
  type ProviderConfig,
} from '@ember-tavern/ai-core';
import {
  WORLD_BIBLE_LOCKABLE_FIELDS,
  aiRequestId,
  campaignId,
  generationRecordId,
  idempotencyKey,
  isoTimestamp,
  type WorldBibleLockableField,
} from '@ember-tavern/contracts';
import { formatTaskPrompt } from '@ember-tavern/prompts';

export type WorldDraft = ReturnType<typeof GenerateWorldOutputSchema.parse>;

export interface WorldBibleView extends WorldDraft {
  readonly campaignId: string;
  readonly lockedFields: readonly WorldBibleLockableField[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorldCreationSnapshot {
  readonly campaignState: string;
  readonly world: WorldBibleView | null;
}

export interface GenerateWorldOptions {
  readonly concept: string;
  readonly storyPreferences: readonly string[];
  readonly contentBoundaries: Readonly<{
    allowHorror: boolean;
    allowPermanentDeath: boolean;
    allowRomance: boolean;
    allowBetrayal: boolean;
    excludedContent: readonly string[];
  }>;
}

export interface WorldCreationGateway {
  load(campaignId: string): Promise<WorldCreationSnapshot>;
  commit(command: WorldGenerationCommit): Promise<WorldCreationSnapshot>;
  update(
    campaignId: string,
    world: WorldDraft,
    lockedFields: readonly WorldBibleLockableField[],
  ): Promise<WorldCreationSnapshot>;
  confirm(campaignId: string): Promise<WorldCreationSnapshot>;
}

interface WorldGenerationCommit {
  readonly campaignId: string;
  readonly task: Extract<AITask, 'GENERATE_WORLD' | 'REFINE_WORLD'>;
  readonly requestId: string;
  readonly generationRecordId: string;
  readonly idempotencyKey: string;
  readonly promptVersion: number;
  readonly input: unknown;
  readonly request: unknown;
  readonly rawResponseText: string;
  readonly validatedOutput: unknown;
  readonly world: WorldDraft;
}

interface WorldRequestIdentity {
  readonly requestId: string;
  readonly generationRecordId: string;
  readonly idempotencyKey: string;
}

const FAKE_PROVIDER_CONFIG: ProviderConfig = Object.freeze({
  id: 'windows-offline-fake',
  providerType: 'LOCAL_OPENAI_COMPATIBLE',
  presetKey: 'custom',
  displayName: 'Ember Fake',
  baseUrl: null,
  credentialRef: null,
  options: {},
  enabled: true,
});

export const tauriWorldCreationGateway: WorldCreationGateway = {
  async load(id) {
    return parseSnapshot(await invoke<unknown>('world_creation_get', { id }), id);
  },
  async commit(command) {
    return parseSnapshot(
      await invoke<unknown>('world_generation_commit', { command }),
      command.campaignId,
    );
  },
  async update(id, world, lockedFields) {
    return parseSnapshot(
      await invoke<unknown>('world_draft_update', {
        command: { campaignId: id, world, lockedFields },
      }),
      id,
    );
  },
  async confirm(id) {
    return parseSnapshot(await invoke<unknown>('world_confirm', { id }), id);
  },
};

export class WindowsWorldCreationService {
  public constructor(
    private readonly gateway: WorldCreationGateway = tauriWorldCreationGateway,
    private readonly provider: AIProvider = new FakeAIProvider(),
    private readonly createIdentity: (
      task: Extract<AITask, 'GENERATE_WORLD' | 'REFINE_WORLD'>,
    ) => WorldRequestIdentity = defaultIdentity,
  ) {}

  public load(campaignIdValue: string): Promise<WorldCreationSnapshot> {
    campaignId(campaignIdValue);
    return this.gateway.load(campaignIdValue);
  }

  public async generate(
    campaignIdValue: string,
    options: GenerateWorldOptions,
  ): Promise<WorldCreationSnapshot> {
    campaignId(campaignIdValue);
    const input = GenerateWorldInputSchema.parse(options);
    return this.execute('GENERATE_WORLD', campaignIdValue, input);
  }

  public async refine(
    campaignIdValue: string,
    current: WorldBibleView,
    revisionInstructions: readonly string[],
  ): Promise<WorldCreationSnapshot> {
    campaignId(campaignIdValue);
    const input = RefineWorldInputSchema.parse({
      world: draftOf(current),
      revisionInstructions,
      lockedFields: current.lockedFields,
    });
    return this.execute('REFINE_WORLD', campaignIdValue, input);
  }

  public update(
    campaignIdValue: string,
    world: WorldDraft,
    lockedFields: readonly WorldBibleLockableField[],
  ): Promise<WorldCreationSnapshot> {
    campaignId(campaignIdValue);
    const validated = GenerateWorldOutputSchema.parse(world);
    for (const field of lockedFields) {
      if (!(WORLD_BIBLE_LOCKABLE_FIELDS as readonly string[]).includes(field)) {
        throw new TypeError('Unknown world lock field');
      }
    }
    return this.gateway.update(campaignIdValue, validated, lockedFields);
  }

  public confirm(campaignIdValue: string): Promise<WorldCreationSnapshot> {
    campaignId(campaignIdValue);
    return this.gateway.confirm(campaignIdValue);
  }

  private async execute(
    task: Extract<AITask, 'GENERATE_WORLD' | 'REFINE_WORLD'>,
    campaignIdValue: string,
    input: unknown,
  ): Promise<WorldCreationSnapshot> {
    const identity = this.createIdentity(task);
    const model = (await this.provider.listModels()).find(({ name }) => name === 'ember-fake-v1');
    if (model === undefined) throw new WorldCreationServiceError('MODEL_NOT_FOUND');
    const prompt = formatTaskPrompt(task, input, model.capabilities);
    const request: NormalizedAIRequest = {
      requestId: aiRequestId(identity.requestId),
      task,
      promptVersion: prompt.promptVersion,
      modelName: model.name,
      messages: prompt.messages,
      responseFormat: prompt.responseFormat,
      temperature: 0,
      maxOutputTokens: 4_000,
      timeoutMs: 5_000,
    };
    const response = await this.provider.generate(request, FAKE_PROVIDER_CONFIG);
    if (response.requestId !== request.requestId || response.modelName !== request.modelName) {
      throw new WorldCreationServiceError('PROVIDER_IDENTITY_MISMATCH');
    }
    const validated = validateAIOutput(task, response.content);
    if (!validated.ok) throw new WorldCreationServiceError(validated.error.code);
    const world =
      task === 'GENERATE_WORLD'
        ? GenerateWorldOutputSchema.parse(validated.validatedOutput)
        : RefineWorldOutputSchema.parse(validated.validatedOutput).world;
    return this.gateway.commit({
      campaignId: campaignIdValue,
      task,
      requestId: identity.requestId,
      generationRecordId: identity.generationRecordId,
      idempotencyKey: identity.idempotencyKey,
      promptVersion: request.promptVersion,
      input,
      request,
      rawResponseText: response.content,
      validatedOutput: validated.validatedOutput,
      world,
    });
  }
}

export const windowsWorldCreationService = new WindowsWorldCreationService();

export class WorldCreationServiceError extends Error {
  public constructor(public readonly code: string) {
    super('World creation operation failed');
    this.name = 'WorldCreationServiceError';
  }
}

function defaultIdentity(
  task: Extract<AITask, 'GENERATE_WORLD' | 'REFINE_WORLD'>,
): WorldRequestIdentity {
  const suffix = crypto.randomUUID();
  return {
    requestId: aiRequestId(`world-request-${suffix}`),
    generationRecordId: generationRecordId(`world-generation-${suffix}`),
    idempotencyKey: idempotencyKey(`world:${task.toLowerCase()}:${suffix}`),
  };
}

function draftOf(world: WorldBibleView): WorldDraft {
  return GenerateWorldOutputSchema.parse({
    name: world.name,
    currentRegion: world.currentRegion,
    summary: world.summary,
    coreConflict: world.coreConflict,
    technologyLevel: world.technologyLevel,
    powerRules: world.powerRules,
    factions: world.factions,
    locations: world.locations,
    narrativeStyle: world.narrativeStyle,
    forbiddenElements: world.forbiddenElements,
    tavernReason: world.tavernReason,
    storyHooks: world.storyHooks,
  });
}

function parseSnapshot(value: unknown, expectedCampaignId: string): WorldCreationSnapshot {
  const record = requireRecord(value);
  const campaignState = requireString(record['campaignState']);
  if (
    ![
      'CREATING_WORLD',
      'REVIEWING_WORLD',
      'CREATING_CHARACTER',
      'GENERATING_TAVERN',
      'TAVERN',
      'ADVENTURE',
      'SETTLEMENT',
      'GENERATION_FAILED',
      'WAITING_FOR_MODEL',
      'RECOVERY_REQUIRED',
      'ARCHIVED',
    ].includes(campaignState)
  ) {
    throw new TypeError('Campaign state is invalid');
  }
  const rawWorld = record['world'];
  const world = rawWorld === null ? null : parseWorld(rawWorld);
  if (world !== null && world.campaignId !== expectedCampaignId) {
    throw new TypeError('World belongs to another campaign');
  }
  return Object.freeze({
    campaignState,
    world,
  });
}

function parseWorld(value: unknown): WorldBibleView {
  const record = requireRecord(value);
  const draft = GenerateWorldOutputSchema.parse({
    name: record['name'],
    currentRegion: record['currentRegion'],
    summary: record['summary'],
    coreConflict: record['coreConflict'],
    technologyLevel: record['technologyLevel'],
    powerRules: record['powerRules'],
    factions: record['factions'],
    locations: record['locations'],
    narrativeStyle: record['narrativeStyle'],
    forbiddenElements: record['forbiddenElements'],
    tavernReason: record['tavernReason'],
    storyHooks: record['storyHooks'],
  });
  const locks = record['lockedFields'];
  if (
    !Array.isArray(locks) ||
    locks.some(
      (field) =>
        typeof field !== 'string' ||
        !(WORLD_BIBLE_LOCKABLE_FIELDS as readonly string[]).includes(field),
    )
  ) {
    throw new TypeError('World lock list is invalid');
  }
  const createdAt = isoTimestamp(requireString(record['createdAt']));
  const updatedAt = isoTimestamp(requireString(record['updatedAt']));
  if (updatedAt < createdAt) throw new TypeError('World timestamps are out of order');
  return Object.freeze({
    ...draft,
    campaignId: campaignId(requireString(record['campaignId'])),
    lockedFields: Object.freeze(locks as WorldBibleLockableField[]),
    createdAt,
    updatedAt,
  });
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Native world response must be an object');
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Native world field must be text');
  return value;
}
