import {
  GenerateWorldInputSchema,
  GenerateWorldOutputSchema,
  RefineWorldInputSchema,
  RefineWorldOutputSchema,
  standardizeAIError,
  validateAIOutput,
  type AIProvider,
  type AITask,
  type NormalizedAIRequest,
  type ProviderConfig,
} from '@ember-tavern/ai-core';
import {
  createCampaign,
  schemaVersion,
  transitionCampaign,
  type AiRequestId,
  type Campaign,
  type CampaignId,
  type FactionId,
  type GenerationRecordId,
  type IdempotencyKey,
  type IsoTimestamp,
  type JsonValue,
  type LocationId,
  type ModelProfileId,
  type WorldBible,
  type WorldConstitution,
  type WorldConstitutionContent,
} from '@ember-tavern/contracts';
import { assertWorldConstitutionCompliance } from '@ember-tavern/domain';
import {
  CampaignRepository,
  GenerationRecordRepository,
  PendingAiRequestRepository,
  WorldConstitutionRepository,
  WorldRepository,
  WorldSeedRepository,
  type TransactionalSqliteDatabase,
} from '@ember-tavern/persistence';
import { formatTaskPrompt } from '@ember-tavern/prompts';

import { AIOrchestrationError, type AITurnGenerationOptions } from './ai-turn-orchestrator.js';
import { executePrimaryAITask } from './ai-task-orchestrator.js';

export interface WorldIdentityFactory {
  faction(name: string, index: number): FactionId;
  location(name: string, index: number): LocationId;
}
export type WorldSeedFactory = () => string;
export interface WorldGenerationRequest {
  readonly campaignId: CampaignId;
  readonly requestId: AiRequestId;
  readonly generationRecordId: GenerationRecordId;
  readonly idempotencyKey: IdempotencyKey;
  readonly modelProfileId: ModelProfileId | null;
  readonly modelName: string;
  readonly generationOptions: AITurnGenerationOptions;
}
export interface GenerateWorldCommand extends WorldGenerationRequest {
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
export interface RefineWorldCommand extends WorldGenerationRequest {
  readonly revisionInstructions: readonly string[];
}

export class WorldCreationUseCases {
  private readonly campaigns: CampaignRepository;
  private readonly worlds: WorldRepository;
  private readonly requests: PendingAiRequestRepository;
  private readonly generations: GenerationRecordRepository;
  private readonly constitutions: WorldConstitutionRepository;
  private readonly seeds: WorldSeedRepository;

  public constructor(
    private readonly database: TransactionalSqliteDatabase,
    private readonly provider: AIProvider,
    private readonly providerConfig: ProviderConfig,
    private readonly identities: WorldIdentityFactory,
    private readonly now: () => IsoTimestamp,
    private readonly seedFactory: WorldSeedFactory = randomWorldSeed,
  ) {
    this.campaigns = new CampaignRepository(database);
    this.worlds = new WorldRepository(database);
    this.requests = new PendingAiRequestRepository(database);
    this.generations = new GenerationRecordRepository(database);
    this.constitutions = new WorldConstitutionRepository(database);
    this.seeds = new WorldSeedRepository(database);
  }

  public createCampaign(id: CampaignId): Campaign {
    const timestamp = this.now();
    const value = createCampaign({ id, schemaVersion: schemaVersion(1), now: timestamp });
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.campaigns.create(value);
      this.seeds.create({
        campaignId: id,
        schemaVersion: schemaVersion(1),
        algorithm: 'EMBER_STREAM_V1',
        seed: this.seedFactory(),
        createdAt: timestamp,
      });
      this.database.exec('COMMIT');
      return value;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Campaign creation rollback failed', {
          cause: rollbackError,
        });
      }
      throw error;
    }
  }

  public generateWorld(command: GenerateWorldCommand): Promise<WorldBible> {
    const campaign = this.requireCampaign(command.campaignId);
    if (campaign.state !== 'CREATING_WORLD' || this.worlds.getBible(command.campaignId) !== null)
      throw new AIOrchestrationError(
        'WORLD_ALREADY_GENERATED',
        'World generation requires an empty CREATING_WORLD campaign',
      );
    const input = GenerateWorldInputSchema.parse({
      concept: command.concept,
      storyPreferences: command.storyPreferences,
      contentBoundaries: command.contentBoundaries,
    });
    return this.run('GENERATE_WORLD', command, input, (output) => {
      const draft = GenerateWorldOutputSchema.parse(output);
      return this.fromDraft(command.campaignId, draft, null);
    });
  }

  public refineWorld(command: RefineWorldCommand): Promise<WorldBible> {
    const campaign = this.requireCampaign(command.campaignId);
    const current = this.requireWorld(command.campaignId);
    const constitution = this.requireConstitution(command.campaignId);
    if (campaign.state !== 'REVIEWING_WORLD')
      throw new AIOrchestrationError(
        'WORLD_NOT_REVIEWABLE',
        'World refinement requires REVIEWING_WORLD',
      );
    const input = RefineWorldInputSchema.parse({
      world: toDraft(current, constitution),
      revisionInstructions: command.revisionInstructions,
      lockedFields: current.lockedFields,
    });
    return this.run('REFINE_WORLD', command, input, (output) => {
      const next = this.fromDraft(
        command.campaignId,
        RefineWorldOutputSchema.parse(output).world,
        current,
      );
      for (const field of current.lockedFields)
        if (JSON.stringify(current[field]) !== JSON.stringify(next.world[field]))
          throw new Error(`Locked world field changed: ${field}`);
      return next;
    });
  }

  public confirmWorld(id: CampaignId): Campaign {
    const campaign = this.requireCampaign(id);
    this.requireWorld(id);
    const constitution = this.requireConstitution(id);
    const next = transitionCampaign(campaign, 'CREATING_CHARACTER', this.now());
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.constitutions.lock(id, constitution.revision, next.updatedAt);
      this.campaigns.update(next);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return next;
  }

  private async run(
    task: Extract<AITask, 'GENERATE_WORLD' | 'REFINE_WORLD'>,
    command: WorldGenerationRequest,
    input: unknown,
    build: (output: JsonValue) => Readonly<{
      world: WorldBible;
      constitution: WorldConstitutionContent;
    }>,
  ): Promise<WorldBible> {
    const inputJson = json(input);
    const pending = this.requests.createOrGet({
      id: command.requestId,
      campaignId: command.campaignId,
      turnId: null,
      idempotencyKey: command.idempotencyKey,
      task,
      modelProfileId: command.modelProfileId,
      input: inputJson,
      createdAt: this.now(),
    });
    if (pending.status === 'COMMITTED') return this.requireWorld(command.campaignId);
    if (pending.status !== 'CREATED')
      throw new AIOrchestrationError('REQUEST_NOT_READY', `Cannot start from ${pending.status}`);
    this.requests.setContext(command.requestId, inputJson, this.now());
    const model = (await this.provider.listModels()).find(({ name }) => name === command.modelName);
    if (model === undefined) {
      this.fail(command, 'MODEL_NOT_FOUND', 'Configured model is unavailable', false);
      throw new AIOrchestrationError('MODEL_NOT_FOUND', 'Configured model is unavailable');
    }
    const prompt = formatTaskPrompt(task, input, model.capabilities);
    const request: NormalizedAIRequest = {
      requestId: command.requestId,
      task,
      promptVersion: prompt.promptVersion,
      modelName: command.modelName,
      messages: prompt.messages,
      responseFormat: prompt.responseFormat,
      ...command.generationOptions,
    };
    this.generations.create({
      id: command.generationRecordId,
      campaignId: command.campaignId,
      requestId: command.requestId,
      task,
      modelProfileId: command.modelProfileId,
      promptVersion: request.promptVersion,
      request: json({ ...request, context: inputJson }),
      startedAt: this.now(),
    });
    this.requests.startAttempt(command.requestId, this.now());
    let raw: string;
    try {
      const response = await executePrimaryAITask(
        this.provider,
        this.providerConfig,
        command.campaignId,
        request,
        inputJson,
        command.modelProfileId,
        model.capabilities,
      );
      if (response.requestId !== request.requestId || response.modelName !== request.modelName)
        throw new AIOrchestrationError('INVALID_OUTPUT', 'Provider response identity mismatch');
      raw = response.content;
      this.requests.markReceived(command.requestId, this.now());
      this.requests.markValidating(command.requestId, this.now());
    } catch (error) {
      const providerError = standardizeAIError(error);
      this.record(
        command,
        null,
        null,
        providerError.code,
        'Provider request failed',
        providerError.retryable,
      );
      throw new AIOrchestrationError(providerError.code, 'Provider request failed', {
        cause: providerError,
      });
    }
    const validated = validateAIOutput(task, raw);
    if (!validated.ok) {
      this.generations.complete(command.generationRecordId, {
        rawResponseText: raw,
        validatedOutput: null,
        validationError: validated.error,
        completedAt: this.now(),
      });
      this.fail(command, 'INVALID_OUTPUT', 'AI output structure validation failed', true);
      throw new AIOrchestrationError('INVALID_OUTPUT', 'AI output structure validation failed');
    }
    let generated: Readonly<{ world: WorldBible; constitution: WorldConstitutionContent }>;
    try {
      generated = build(validated.validatedOutput);
    } catch (error) {
      this.record(
        command,
        raw,
        null,
        'WORLD_VALIDATION_FAILED',
        'Generated world failed local validation',
      );
      throw new AIOrchestrationError(
        'WORLD_VALIDATION_FAILED',
        'Generated world failed local validation',
        { cause: error },
      );
    }
    this.generations.complete(command.generationRecordId, {
      rawResponseText: raw,
      validatedOutput: validated.validatedOutput,
      validationError: null,
      completedAt: this.now(),
    });
    const current = this.requireCampaign(command.campaignId);
    const campaign =
      current.state === 'CREATING_WORLD'
        ? transitionCampaign(current, 'REVIEWING_WORLD', this.now())
        : { ...current, updatedAt: this.now() };
    try {
      this.requests.commitWorldOnce(
        command.idempotencyKey,
        campaign,
        generated.world,
        generated.constitution,
        this.now(),
      );
    } catch (error) {
      this.fail(command, 'COMMIT_FAILED', 'World commit failed', false);
      throw new AIOrchestrationError('COMMIT_FAILED', 'World commit failed', { cause: error });
    }
    return this.requireWorld(command.campaignId);
  }

  private fromDraft(
    campaignId: CampaignId,
    draft: ReturnType<typeof GenerateWorldOutputSchema.parse>,
    current: WorldBible | null,
  ): Readonly<{ world: WorldBible; constitution: WorldConstitutionContent }> {
    const { constitution: proposal, ...worldDraft } = draft;
    const constitution = constitutionContent(proposal);
    assertWorldConstitutionCompliance(constitution, worldDraft);
    const factions = worldDraft.factions.map((value, index) => ({
      ...value,
      id:
        current?.factions.find(({ name }) => name === value.name)?.id ??
        this.identities.faction(value.name, index),
      relations: current?.factions.find(({ name }) => name === value.name)?.relations ?? [],
    }));
    const locationIds = new Map(
      worldDraft.locations.map((value, index) => [
        value.name,
        current?.locations.find(({ name }) => name === value.name)?.id ??
          this.identities.location(value.name, index),
      ]),
    );
    const timestamp = this.now();
    const world: WorldBible = {
      campaignId,
      schemaVersion: schemaVersion(1),
      ...worldDraft,
      factions,
      locations: worldDraft.locations.map((value) => {
        const id = locationIds.get(value.name);
        const parentLocationId =
          value.parentName === null ? null : locationIds.get(value.parentName);
        if (id === undefined || parentLocationId === undefined)
          throw new Error(`Invalid location relationship: ${value.name}`);
        return {
          id,
          name: value.name,
          description: value.description,
          parentLocationId,
          factionIds: value.factionNames.map((name) => {
            const faction = factions.find((candidate) => candidate.name === name);
            if (faction === undefined) throw new Error(`Unknown faction: ${name}`);
            return faction.id;
          }),
        };
      }),
      lockedFields: current?.lockedFields ?? [],
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    return Object.freeze({ world, constitution });
  }

  private record(
    command: WorldGenerationRequest,
    raw: string | null,
    output: JsonValue | null,
    code: string,
    message: string,
    retryable = false,
  ): void {
    this.generations.complete(command.generationRecordId, {
      rawResponseText: raw,
      validatedOutput: output,
      validationError: output === null ? { code, issues: [{ path: [], code, message }] } : null,
      completedAt: this.now(),
    });
    this.fail(command, code, message, retryable);
  }

  private fail(
    command: WorldGenerationRequest,
    code: string,
    message: string,
    retryable: boolean,
  ): void {
    this.requests.fail(command.requestId, { code, message, retryable }, this.now());
  }

  private requireCampaign(id: CampaignId): Campaign {
    const value = this.campaigns.get(id);
    if (value === null) throw new AIOrchestrationError('CAMPAIGN_NOT_FOUND', 'Campaign not found');
    return value;
  }
  private requireWorld(id: CampaignId): WorldBible {
    const value = this.worlds.getBible(id);
    if (value === null) throw new AIOrchestrationError('WORLD_NOT_FOUND', 'World not found');
    return value;
  }
  private requireConstitution(id: CampaignId) {
    const value = this.constitutions.get(id);
    if (value === null)
      throw new AIOrchestrationError('CONSTITUTION_NOT_FOUND', 'World Constitution not found');
    return value;
  }
}

function toDraft(world: WorldBible, constitution: WorldConstitution) {
  const factions = new Map(world.factions.map((value) => [value.id, value.name]));
  const locations = new Map(world.locations.map((value) => [value.id, value.name]));
  return {
    constitution: {
      schemaVersion: constitution.schemaVersion,
      ...constitutionContent(constitution),
    },
    name: world.name,
    currentRegion: world.currentRegion,
    summary: world.summary,
    coreConflict: world.coreConflict,
    technologyLevel: world.technologyLevel,
    powerRules: world.powerRules,
    factions: world.factions.map(({ name, description, goals }) => ({ name, description, goals })),
    locations: world.locations.map((value) => ({
      name: value.name,
      description: value.description,
      parentName:
        value.parentLocationId === null ? null : (locations.get(value.parentLocationId) ?? null),
      factionNames: value.factionIds.flatMap((id) => {
        const name = factions.get(id);
        return name === undefined ? [] : [name];
      }),
    })),
    narrativeStyle: world.narrativeStyle,
    forbiddenElements: world.forbiddenElements,
    tavernReason: world.tavernReason,
    storyHooks: world.storyHooks,
  };
}

function constitutionContent(value: WorldConstitutionContent): WorldConstitutionContent {
  return Object.freeze({
    worldType: value.worldType,
    era: value.era,
    technology: value.technology,
    magic: value.magic,
    peoples: Object.freeze([...value.peoples]),
    society: value.society,
    politics: value.politics,
    economy: value.economy,
    combatScale: value.combatScale,
    deathRules: value.deathRules,
    careerRules: value.careerRules,
    equipmentRules: value.equipmentRules,
    npcRules: value.npcRules,
    traitRules: value.traitRules,
    taboos: Object.freeze([...value.taboos]),
  });
}

function json(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return value;
  if (Array.isArray(value)) return value.map(json);
  if (typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, json(entry)]));
  throw new TypeError('Value must be finite JSON');
}

function randomWorldSeed(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}
