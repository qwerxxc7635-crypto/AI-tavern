import { invoke } from '@tauri-apps/api/core';

import {
  GenerateWorldInputSchema,
  GenerateWorldOutputSchema,
  GenerationQueue,
  RefineWorldInputSchema,
  RefineWorldOutputSchema,
  StructuredJsonStreamProjector,
  WorldConstitutionOutputSchema,
  type AIProvider,
  type AITask,
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
import {
  desktopAIEngine,
  tauriDesktopAIOrchestrator,
  type DesktopAIEngine,
} from './desktop-ai-orchestrator.js';
import {
  balancedRandomnessTemperatureSource,
  tauriRandomnessTemperatureSource,
  type RandomnessTemperatureSource,
} from './randomness-settings-service.js';

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
  readonly constitution: WorldConstitutionView | null;
}

export interface WorldConstitutionView extends ReturnType<
  typeof WorldConstitutionOutputSchema.parse
> {
  readonly campaignId: string;
  readonly revision: number;
  readonly status: 'DRAFT' | 'LOCKED';
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lockedAt: string | null;
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

export interface WorldGenerationStreamOptions {
  readonly signal: AbortSignal;
  readonly onChunk: (content: string) => void;
  readonly onReset?: () => void;
}

// The transport retains a strict 120s ceiling. The outer operation budget allows either one
// schema-repair request or one authorized Provider fallback plus bounded local validation/commit.
export const WORLD_PROVIDER_TIMEOUT_MS = 120_000;
export const WORLD_OPERATION_TIMEOUT_MS = 270_000;

const worldGenerationQueue = new GenerationQueue({ concurrency: 1, maxPending: 32 });

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
    provider?: AIProvider | DesktopAIEngine,
    private readonly createIdentity: (
      task: Extract<AITask, 'GENERATE_WORLD' | 'REFINE_WORLD'>,
    ) => WorldRequestIdentity = defaultIdentity,
    private readonly randomness: RandomnessTemperatureSource = balancedRandomnessTemperatureSource,
    private readonly generationQueue: GenerationQueue = worldGenerationQueue,
  ) {
    this.ai = desktopAIEngine(provider);
  }

  private readonly ai: DesktopAIEngine;

  public load(campaignIdValue: string): Promise<WorldCreationSnapshot> {
    campaignId(campaignIdValue);
    return this.gateway.load(campaignIdValue);
  }

  public async generate(
    campaignIdValue: string,
    options: GenerateWorldOptions,
    stream?: WorldGenerationStreamOptions,
  ): Promise<WorldCreationSnapshot> {
    campaignId(campaignIdValue);
    const input = GenerateWorldInputSchema.parse(options);
    return this.execute('GENERATE_WORLD', campaignIdValue, input, stream);
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
    stream?: WorldGenerationStreamOptions,
  ): Promise<WorldCreationSnapshot> {
    const identity = this.createIdentity(task);
    const handle = this.generationQueue.submit({
      id: identity.requestId,
      intentKey: `world:${campaignIdValue}:${task}`,
      task,
      priority: 'P0',
      timeoutMs: WORLD_OPERATION_TIMEOUT_MS,
      maxRetries: 0,
      allowFallback: false,
      execute: async ({ signal }) => {
        const temperature = await this.randomness.resolveTemperature();
        let projector = stream === undefined ? null : new StructuredJsonStreamProjector('summary');
        let rawChunks = 0;
        const generated = await this.ai.execute(task, input, {
          requestId: identity.requestId,
          temperature,
          maxOutputTokens: 4_096,
          timeoutMs: WORLD_PROVIDER_TIMEOUT_MS,
          signal,
          ...(stream === undefined
            ? {}
            : {
                stream: {
                  signal,
                  onChunk(chunk: { readonly content: string }) {
                    rawChunks += 1;
                    const visible = projector?.push(chunk.content) ?? '';
                    if (visible.length > 0) stream.onChunk(visible);
                  },
                  onReset() {
                    projector = new StructuredJsonStreamProjector('summary');
                    rawChunks = 0;
                    stream.onReset?.();
                  },
                },
              }),
        });
        if (signal.aborted) throw new WorldCreationServiceError('CANCELLED');
        if (projector !== null && rawChunks > 0) {
          const visible = projector.finish(generated.response.content);
          if (visible.length > 0) stream?.onChunk(visible);
        }
        const world =
          task === 'GENERATE_WORLD'
            ? GenerateWorldOutputSchema.parse(generated.validatedOutput)
            : RefineWorldOutputSchema.parse(generated.validatedOutput).world;
        if (signal.aborted) throw new WorldCreationServiceError('CANCELLED');
        return this.gateway.commit({
          campaignId: campaignIdValue,
          task,
          requestId: identity.requestId,
          generationRecordId: identity.generationRecordId,
          idempotencyKey: identity.idempotencyKey,
          promptVersion: generated.request.promptVersion,
          input,
          request: generated.request,
          rawResponseText: generated.response.content,
          validatedOutput: generated.validatedOutput,
          world,
        });
      },
    });
    const cancel = () => handle.cancel();
    stream?.signal.addEventListener('abort', cancel, { once: true });
    if (stream?.signal.aborted === true) handle.cancel();
    try {
      return await handle.promise;
    } finally {
      stream?.signal.removeEventListener('abort', cancel);
    }
  }
}

export const windowsWorldCreationService = new WindowsWorldCreationService(
  tauriWorldCreationGateway,
  tauriDesktopAIOrchestrator,
  defaultIdentity,
  tauriRandomnessTemperatureSource,
);

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
    constitution: world.constitution,
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
  const rawConstitution = record['constitution'];
  const constitution = rawConstitution === null ? null : parseConstitution(rawConstitution);
  if (world !== null && world.campaignId !== expectedCampaignId) {
    throw new TypeError('World belongs to another campaign');
  }
  if (constitution !== null && constitution.campaignId !== expectedCampaignId) {
    throw new TypeError('World Constitution belongs to another campaign');
  }
  if ((world === null) !== (constitution === null)) {
    throw new TypeError('World and Constitution must exist together');
  }
  return Object.freeze({
    campaignState,
    world,
    constitution,
  });
}

function parseWorld(value: unknown): WorldBibleView {
  const record = requireRecord(value);
  const draft = GenerateWorldOutputSchema.parse({
    constitution: record['constitution'],
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

function parseConstitution(value: unknown): WorldConstitutionView {
  const record = requireRecord(value);
  const content = WorldConstitutionOutputSchema.parse(constitutionContentRecord(record));
  const revision = record['revision'];
  if (!Number.isSafeInteger(revision) || (revision as number) < 1) {
    throw new TypeError('World Constitution revision is invalid');
  }
  const status = requireString(record['status']);
  if (status !== 'DRAFT' && status !== 'LOCKED') {
    throw new TypeError('World Constitution status is invalid');
  }
  const createdAt = isoTimestamp(requireString(record['createdAt']));
  const updatedAt = isoTimestamp(requireString(record['updatedAt']));
  const rawLockedAt = record['lockedAt'];
  const lockedAt = rawLockedAt === null ? null : isoTimestamp(requireString(rawLockedAt));
  if (
    updatedAt < createdAt ||
    (status === 'DRAFT' && lockedAt !== null) ||
    (status === 'LOCKED' && lockedAt === null)
  ) {
    throw new TypeError('World Constitution metadata is invalid');
  }
  return Object.freeze({
    ...content,
    campaignId: campaignId(requireString(record['campaignId'])),
    revision: revision as number,
    status,
    createdAt,
    updatedAt,
    lockedAt,
  });
}

function constitutionContentRecord(record: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: record['schemaVersion'],
    worldType: record['worldType'],
    era: record['era'],
    technology: record['technology'],
    magic: record['magic'],
    peoples: record['peoples'],
    society: record['society'],
    politics: record['politics'],
    economy: record['economy'],
    combatScale: record['combatScale'],
    deathRules: record['deathRules'],
    careerRules: record['careerRules'],
    equipmentRules: record['equipmentRules'],
    npcRules: record['npcRules'],
    traitRules: record['traitRules'],
    taboos: record['taboos'],
  };
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
