import {
  GenerateNpcsInputSchema,
  GenerateNpcsOutputSchema,
  GenerateTavernInputSchema,
  GenerateTavernOutputSchema,
  standardizeAIError,
  validateAIOutput,
  type AIProvider,
  type AITask,
  type NormalizedAIRequest,
  type ProviderConfig,
} from '@ember-tavern/ai-core';
import {
  createNpcKnowledge,
  createNpcRelationship,
  transitionCampaign,
  type AiRequestId,
  type Campaign,
  type CampaignId,
  type GenerationRecordId,
  type IdempotencyKey,
  type IsoTimestamp,
  type JsonValue,
  type LocationId,
  type ModelProfileId,
  type NpcId,
  type NpcProfile,
  type PlayerCharacterId,
  type Tavern,
  type TavernId,
  type WorldBible,
  type WorldFact,
  type WorldFactId,
} from '@ember-tavern/contracts';
import {
  CampaignRepository,
  GenerationRecordRepository,
  NpcRepository,
  PendingAiRequestRepository,
  PlayerCharacterRepository,
  TavernRepository,
  WorldRepository,
  type NpcInitializationRecord,
  type TransactionalSqliteDatabase,
} from '@ember-tavern/persistence';
import { formatTaskPrompt } from '@ember-tavern/prompts';

import { AIOrchestrationError, type AITurnGenerationOptions } from './ai-turn-orchestrator.js';
import { executePrimaryAITask } from './ai-task-orchestrator.js';

export interface TavernIdentityFactory {
  tavern(name: string): TavernId;
  npc(name: string, index: number): NpcId;
  fact(statement: string, index: number): WorldFactId;
}

export interface TavernGenerationRequest {
  readonly campaignId: CampaignId;
  readonly requestId: AiRequestId;
  readonly generationRecordId: GenerationRecordId;
  readonly idempotencyKey: IdempotencyKey;
  readonly modelProfileId: ModelProfileId | null;
  readonly modelName: string;
  readonly generationOptions: AITurnGenerationOptions;
}

export interface GenerateTavernCommand extends TavernGenerationRequest {
  readonly playerCharacterId: PlayerCharacterId;
  readonly locationId: LocationId;
  readonly desiredPosition: string | null;
}

export interface GenerateNpcsCommand extends TavernGenerationRequest {
  readonly playerCharacterId: PlayerCharacterId;
  readonly tavernId: TavernId;
}

export interface TavernInitialization {
  readonly tavern: Tavern;
  readonly npcs: readonly NpcProfile[];
  readonly rumors: readonly WorldFact[];
  readonly questPublisherNpcIds: readonly NpcId[];
}

export class TavernInitializationUseCases {
  private readonly campaigns: CampaignRepository;
  private readonly worlds: WorldRepository;
  private readonly characters: PlayerCharacterRepository;
  private readonly taverns: TavernRepository;
  private readonly npcs: NpcRepository;
  private readonly requests: PendingAiRequestRepository;
  private readonly generations: GenerationRecordRepository;

  public constructor(
    database: TransactionalSqliteDatabase,
    private readonly provider: AIProvider,
    private readonly providerConfig: ProviderConfig,
    private readonly identities: TavernIdentityFactory,
    private readonly now: () => IsoTimestamp,
  ) {
    this.campaigns = new CampaignRepository(database);
    this.worlds = new WorldRepository(database);
    this.characters = new PlayerCharacterRepository(database);
    this.taverns = new TavernRepository(database);
    this.npcs = new NpcRepository(database);
    this.requests = new PendingAiRequestRepository(database);
    this.generations = new GenerationRecordRepository(database);
  }

  public async generateTavern(command: GenerateTavernCommand): Promise<Tavern> {
    const campaign = this.requireCampaign(command.campaignId);
    if (campaign.state !== 'GENERATING_TAVERN') {
      throw new AIOrchestrationError(
        'TAVERN_NOT_GENERATABLE',
        'Tavern generation requires GENERATING_TAVERN',
      );
    }
    const world = this.requireWorld(command.campaignId);
    const character = this.requireCharacter(command.playerCharacterId, command.campaignId);
    if (!world.locations.some(({ id }) => id === command.locationId)) {
      throw new AIOrchestrationError(
        'TAVERN_LOCATION_INVALID',
        'Tavern location is outside the campaign world',
      );
    }
    const input = GenerateTavernInputSchema.parse({
      world: worldContext(world),
      playerConcept: character.concept,
      desiredPosition: command.desiredPosition,
    });
    const output = GenerateTavernOutputSchema.parse(
      await this.generateValidated('GENERATE_TAVERN', command, input),
    );
    const timestamp = this.now();
    const tavernId = this.identities.tavern(output.name);
    const ownerId = this.identities.npc(output.owner.name, 0);
    const tavern: Tavern = Object.freeze({
      id: tavernId,
      campaignId: command.campaignId,
      locationId: command.locationId,
      name: output.name,
      position: output.position,
      environment: output.environment,
      specialRules: Object.freeze([...output.specialRules]),
      longTermProblem: output.longTermProblem,
      ownerNpcId: ownerId,
      residentNpcIds: Object.freeze([ownerId]),
      visitorNpcIds: Object.freeze([]),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const owner = npcRecord(
      {
        id: ownerId,
        campaignId: command.campaignId,
        tavernId,
        residency: 'OWNER',
        ...output.owner,
        currentStatus: 'ACTIVE',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      null,
      command.playerCharacterId,
      [],
    );
    try {
      this.requests.commitTavernOnce(
        command.idempotencyKey,
        command.campaignId,
        tavern,
        owner,
        timestamp,
      );
    } catch (error) {
      this.fail(command, 'COMMIT_FAILED', 'Tavern commit failed', false);
      throw new AIOrchestrationError('COMMIT_FAILED', 'Tavern commit failed', { cause: error });
    }
    return this.requireTavern(tavernId);
  }

  public async generateNpcs(command: GenerateNpcsCommand): Promise<TavernInitialization> {
    const prior = this.requests.getByIdempotencyKey(command.idempotencyKey);
    const campaign = this.requireCampaign(command.campaignId);
    if (campaign.state !== 'GENERATING_TAVERN' && prior?.status !== 'COMMITTED') {
      throw new AIOrchestrationError(
        'NPCS_NOT_GENERATABLE',
        'Initial NPC generation requires GENERATING_TAVERN',
      );
    }
    const world = this.requireWorld(command.campaignId);
    const character = this.requireCharacter(command.playerCharacterId, command.campaignId);
    const tavern = this.requireTavern(command.tavernId);
    if (tavern.campaignId !== command.campaignId) {
      throw new AIOrchestrationError(
        'TAVERN_CAMPAIGN_MISMATCH',
        'Tavern belongs to another campaign',
      );
    }
    const owner = this.requireNpc(tavern.ownerNpcId);
    const input = GenerateNpcsInputSchema.parse({
      world: worldContext(world),
      tavern: {
        name: tavern.name,
        position: tavern.position,
        environment: tavern.environment,
        longTermProblem: tavern.longTermProblem,
      },
      existingNpcNames: [owner.name],
      requestedCount: 3,
    });
    const output = GenerateNpcsOutputSchema.parse(
      await this.generateValidated('GENERATE_NPCS', command, input),
    );
    validateInitialRoster(output, owner.name);
    const timestamp = this.now();
    const profiles = output.npcs.map((draft, index): NpcProfile =>
      Object.freeze({
        id: this.identities.npc(draft.name, index + 1),
        campaignId: command.campaignId,
        tavernId: tavern.id,
        residency: draft.residency,
        name: draft.name,
        identity: draft.identity,
        appearance: draft.appearance,
        personality: draft.personality,
        goal: draft.goal,
        secret: draft.secret,
        speechStyle: draft.speechStyle,
        currentMood: draft.currentMood,
        currentStatus: 'ACTIVE',
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    const rumorFacts: readonly WorldFact[] = Object.freeze(
      output.rumors.map((rumor, index) =>
        Object.freeze({
          id: this.identities.fact(rumor.statement, index),
          campaignId: command.campaignId,
          kind: 'RUMOR' as const,
          statement: rumor.statement,
          locationId: tavern.locationId,
          factionIds: Object.freeze([]),
          veracity: rumor.veracity,
          createdAt: timestamp,
        }),
      ),
    );
    const records = profiles.map((profile, index) => {
      const draft = output.npcs[index];
      if (draft === undefined) {
        throw new AIOrchestrationError('INVALID_NPC_ROSTER', 'NPC output index is missing');
      }
      const sourcedRumors = output.rumors.flatMap((rumor, rumorIndex) =>
        rumor.sourceNpcName === profile.name ? [rumorFacts[rumorIndex]] : [],
      );
      if (sourcedRumors.some((fact) => fact === undefined)) {
        throw new AIOrchestrationError('INVALID_NPC_ROSTER', 'Rumor mapping is incomplete');
      }
      return npcRecord(
        profile,
        draft.residency === 'TEMPORARY_VISITOR'
          ? {
              npcId: profile.id,
              tavernId: tavern.id,
              visitReason: requireVisitReason(draft.visitReason),
              arrivedAt: timestamp,
              plannedDepartureAt: null,
            }
          : null,
        character.id,
        sourcedRumors.map((fact) => requireFact(fact).id),
      );
    });
    const nextCampaign =
      campaign.state === 'GENERATING_TAVERN'
        ? transitionCampaign(campaign, 'TAVERN', timestamp)
        : campaign;
    try {
      this.requests.commitNpcRosterOnce(
        command.idempotencyKey,
        nextCampaign,
        tavern.id,
        records,
        rumorFacts,
        timestamp,
      );
    } catch (error) {
      this.fail(command, 'COMMIT_FAILED', 'NPC roster commit failed', false);
      throw new AIOrchestrationError('COMMIT_FAILED', 'NPC roster commit failed', {
        cause: error,
      });
    }
    const storedTavern = this.requireTavern(tavern.id);
    const storedNpcs = Object.freeze([
      this.requireNpc(storedTavern.ownerNpcId),
      ...profiles.map(({ id }) => this.requireNpc(id)),
    ]);
    return Object.freeze({
      tavern: storedTavern,
      npcs: storedNpcs,
      rumors: this.worlds
        .listFacts(command.campaignId)
        .filter((fact) => rumorFacts.some(({ id }) => id === fact.id)),
      questPublisherNpcIds: Object.freeze(
        storedNpcs
          .filter(
            ({ residency, currentStatus }) =>
              residency !== 'TEMPORARY_VISITOR' && currentStatus === 'ACTIVE',
          )
          .map(({ id }) => id),
      ),
    });
  }

  private async generateValidated(
    task: Extract<AITask, 'GENERATE_TAVERN' | 'GENERATE_NPCS'>,
    command: TavernGenerationRequest,
    input: unknown,
  ): Promise<JsonValue> {
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
    if (pending.status === 'COMMITTED') {
      const record = this.generations.get(command.generationRecordId);
      if (record === null || record.validatedOutput === null) {
        throw new AIOrchestrationError(
          'GENERATION_RECORD_MISSING',
          'Committed tavern generation has no validated output',
        );
      }
      return record.validatedOutput;
    }
    if (pending.status !== 'CREATED') {
      throw new AIOrchestrationError('REQUEST_NOT_READY', `Cannot start from ${pending.status}`);
    }
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
      );
      if (response.requestId !== request.requestId || response.modelName !== request.modelName) {
        throw new AIOrchestrationError('INVALID_OUTPUT', 'Provider response identity mismatch');
      }
      raw = response.content;
      this.requests.markReceived(command.requestId, this.now());
      this.requests.markValidating(command.requestId, this.now());
    } catch (error) {
      const providerError = standardizeAIError(error);
      this.generations.complete(command.generationRecordId, {
        rawResponseText: null,
        validatedOutput: null,
        validationError: generationError(providerError.code, 'Tavern provider request failed'),
        completedAt: this.now(),
      });
      this.fail(
        command,
        providerError.code,
        'Tavern provider request failed',
        providerError.retryable,
      );
      throw new AIOrchestrationError(providerError.code, 'Tavern provider request failed', {
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
      this.fail(command, 'INVALID_OUTPUT', 'Tavern output validation failed', true);
      throw new AIOrchestrationError('INVALID_OUTPUT', 'Tavern output validation failed');
    }
    this.generations.complete(command.generationRecordId, {
      rawResponseText: raw,
      validatedOutput: validated.validatedOutput,
      validationError: null,
      completedAt: this.now(),
    });
    return validated.validatedOutput;
  }

  private fail(
    command: TavernGenerationRequest,
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

  private requireCharacter(id: PlayerCharacterId, campaign: CampaignId) {
    const value = this.characters.get(id);
    if (value === null || value.campaignId !== campaign) {
      throw new AIOrchestrationError('CHARACTER_NOT_FOUND', 'Campaign player character not found');
    }
    return value;
  }

  private requireTavern(id: TavernId): Tavern {
    const value = this.taverns.get(id);
    if (value === null) throw new AIOrchestrationError('TAVERN_NOT_FOUND', 'Tavern not found');
    return value;
  }

  private requireNpc(id: NpcId): NpcProfile {
    const value = this.npcs.get(id);
    if (value === null) throw new AIOrchestrationError('NPC_NOT_FOUND', 'NPC not found');
    return value;
  }
}

function npcRecord(
  profile: NpcProfile,
  visitor: NpcInitializationRecord['visitor'],
  playerCharacterId: PlayerCharacterId,
  knownFactIds: readonly WorldFactId[],
): NpcInitializationRecord {
  return Object.freeze({
    profile: Object.freeze(profile),
    visitor: visitor === null ? null : Object.freeze(visitor),
    knowledge: createNpcKnowledge({
      npcId: profile.id,
      knownFactIds,
      suspectedFactIds: [],
      falseBeliefFactIds: [],
      excludedSecretFactIds: [],
    }),
    relationship: createNpcRelationship({
      npcId: profile.id,
      playerCharacterId,
      trust: 0,
      closeness: 0,
      awe: 0,
      obligation: 0,
    }),
  });
}

function validateInitialRoster(
  output: ReturnType<typeof GenerateNpcsOutputSchema.parse>,
  ownerName: string,
): void {
  const residents = output.npcs.filter(({ residency }) => residency === 'RESIDENT');
  const visitors = output.npcs.filter(({ residency }) => residency === 'TEMPORARY_VISITOR');
  const names = [ownerName, ...output.npcs.map(({ name }) => name)];
  if (
    output.npcs.length !== 3 ||
    residents.length !== 2 ||
    visitors.length !== 1 ||
    new Set(names).size !== names.length ||
    output.npcs.some(
      ({ residency, visitReason }) =>
        (residency === 'TEMPORARY_VISITOR') !== (visitReason !== null),
    ) ||
    output.rumors.some(
      ({ sourceNpcName }) => !output.npcs.some(({ name }) => name === sourceNpcName),
    )
  ) {
    throw new AIOrchestrationError(
      'INVALID_NPC_ROSTER',
      'Initial roster must contain two residents, one visitor and three attributed rumors',
    );
  }
}

function worldContext(world: WorldBible) {
  return {
    name: world.name,
    currentRegion: world.currentRegion,
    summary: world.summary,
    coreConflict: world.coreConflict,
    technologyLevel: world.technologyLevel,
    powerRules: world.powerRules,
  };
}

function requireVisitReason(value: string | null): string {
  if (value === null) {
    throw new AIOrchestrationError('INVALID_NPC_ROSTER', 'Visitor requires a visit reason');
  }
  return value;
}

function requireFact(value: WorldFact | undefined): WorldFact {
  if (value === undefined) {
    throw new AIOrchestrationError('INVALID_NPC_ROSTER', 'Rumor fact is missing');
  }
  return value;
}

function generationError(code: string, message: string) {
  return Object.freeze({
    code,
    issues: Object.freeze([Object.freeze({ path: Object.freeze([]), code, message })]),
  });
}

function json(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(json);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, json(entry)]));
  }
  throw new TypeError('Value must be finite JSON');
}
