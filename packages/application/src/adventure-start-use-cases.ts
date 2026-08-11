import {
  GenerateAdventurePlanInputSchema,
  GenerateAdventurePlanOutputSchema,
  standardizeAIError,
  validateAIOutput,
  type AIProvider,
  type NormalizedAIRequest,
  type ProviderConfig,
} from '@ember-tavern/ai-core';
import {
  type Adventure,
  type AdventureId,
  type AiRequestId,
  type CampaignId,
  type Clue,
  type ClueId,
  type GenerationRecordId,
  type IdempotencyKey,
  type IsoTimestamp,
  type JsonValue,
  type ModelProfileId,
  type PlayerCharacterId,
  type Quest,
  type QuestId,
  type WorldBible,
} from '@ember-tavern/contracts';
import {
  AdventureRepository,
  CampaignRepository,
  GenerationRecordRepository,
  PendingAiRequestRepository,
  PlayerCharacterRepository,
  QuestRepository,
  WorldRepository,
  type TransactionalSqliteDatabase,
} from '@ember-tavern/persistence';
import { formatTaskPrompt } from '@ember-tavern/prompts';

import { AIOrchestrationError, type AITurnGenerationOptions } from './ai-turn-orchestrator.js';
import { executePrimaryAITask } from './ai-task-orchestrator.js';

export interface AdventureIdentityFactory {
  clue(title: string, index: number): ClueId;
}

export interface GenerateAdventurePlanCommand {
  readonly campaignId: CampaignId;
  readonly adventureId: AdventureId;
  readonly questId: QuestId;
  readonly playerCharacterId: PlayerCharacterId;
  readonly requestId: AiRequestId;
  readonly generationRecordId: GenerationRecordId;
  readonly idempotencyKey: IdempotencyKey;
  readonly modelProfileId: ModelProfileId | null;
  readonly modelName: string;
  readonly generationOptions: AITurnGenerationOptions;
}

export interface AdventureStartState {
  readonly adventureId: AdventureId;
  readonly questId: QuestId;
  readonly state: Adventure['state'];
  readonly currentTurnNumber: number;
}

export class AdventureStartUseCases {
  private readonly campaigns: CampaignRepository;
  private readonly worlds: WorldRepository;
  private readonly characters: PlayerCharacterRepository;
  private readonly quests: QuestRepository;
  private readonly adventures: AdventureRepository;
  private readonly requests: PendingAiRequestRepository;
  private readonly generations: GenerationRecordRepository;

  public constructor(
    database: TransactionalSqliteDatabase,
    private readonly provider: AIProvider,
    private readonly providerConfig: ProviderConfig,
    private readonly identities: AdventureIdentityFactory,
    private readonly now: () => IsoTimestamp,
  ) {
    this.campaigns = new CampaignRepository(database);
    this.worlds = new WorldRepository(database);
    this.characters = new PlayerCharacterRepository(database);
    this.quests = new QuestRepository(database);
    this.adventures = new AdventureRepository(database);
    this.requests = new PendingAiRequestRepository(database);
    this.generations = new GenerationRecordRepository(database);
  }

  public async generateAdventurePlan(
    command: GenerateAdventurePlanCommand,
  ): Promise<AdventureStartState> {
    const campaign = this.campaigns.get(command.campaignId);
    if (campaign === null || campaign.state !== 'TAVERN') {
      throw new AIOrchestrationError(
        'ADVENTURE_NOT_PREPARABLE',
        'Adventure preparation requires TAVERN state',
      );
    }
    const quest = this.requireAcceptedQuest(command.questId, command.campaignId);
    const world = this.requireWorld(command.campaignId);
    const character = this.characters.get(command.playerCharacterId);
    if (character === null || character.campaignId !== command.campaignId) {
      throw new AIOrchestrationError('CHARACTER_NOT_FOUND', 'Campaign player character not found');
    }
    const factsById = new Map(
      this.worlds.listFacts(command.campaignId).map((fact) => [fact.id, fact.statement]),
    );
    const input = GenerateAdventurePlanInputSchema.parse({
      world: worldContext(world),
      quest: {
        id: quest.id,
        content: quest.content,
        risk: quest.risk,
        expectedTurns: quest.expectedTurns,
      },
      playerSummary: `${character.name}: ${character.concept}; ${character.personalGoal}`,
      relevantFacts: quest.relatedFactIds.flatMap((id) => {
        const statement = factsById.get(id);
        return statement === undefined ? [] : [statement];
      }),
    });
    const output = GenerateAdventurePlanOutputSchema.parse(
      await this.generateValidated(command, input),
    );
    validatePlan(output, quest);
    const timestamp = this.now();
    const clues: readonly Clue[] = Object.freeze(
      output.necessaryClues.map((clue, index) =>
        Object.freeze({
          id: this.identities.clue(clue.title, index),
          adventureId: command.adventureId,
          title: clue.title,
          description: clue.description,
          isCore: clue.isCore,
          discoveredInTurnId: null,
        }),
      ),
    );
    const adventure: Adventure = Object.freeze({
      id: command.adventureId,
      campaignId: command.campaignId,
      questId: quest.id,
      state: 'PREPARING',
      plan: Object.freeze({
        adventureId: command.adventureId,
        objective: output.objective,
        risk: output.risk,
        expectedTurns: Object.freeze({ ...output.expectedTurns }),
        coreScenes: Object.freeze([...output.coreScenes]),
        necessaryClueIds: Object.freeze(clues.map(({ id }) => id)),
        majorObstacles: Object.freeze([...output.majorObstacles]),
        possibleEndings: Object.freeze([...output.possibleEndings]),
        failureCost: output.failureCost,
      }),
      currentTurnNumber: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    try {
      this.requests.commitAdventurePlanOnce(command.idempotencyKey, adventure, clues, timestamp);
    } catch (error) {
      this.fail(command, 'COMMIT_FAILED', 'Adventure plan commit failed', false);
      throw new AIOrchestrationError('COMMIT_FAILED', 'Adventure plan commit failed', {
        cause: error,
      });
    }
    return publicState(this.requireAdventure(command.adventureId, command.campaignId));
  }

  public startAdventure(campaignId: CampaignId, adventureId: AdventureId): AdventureStartState {
    try {
      return publicState(this.adventures.startPrepared(adventureId, campaignId, this.now()));
    } catch (error) {
      throw new AIOrchestrationError(
        'ADVENTURE_NOT_STARTABLE',
        'Prepared adventure cannot be started',
        { cause: error },
      );
    }
  }

  private async generateValidated(
    command: GenerateAdventurePlanCommand,
    input: unknown,
  ): Promise<JsonValue> {
    const inputJson = json(input);
    const pending = this.requests.createOrGet({
      id: command.requestId,
      campaignId: command.campaignId,
      turnId: null,
      idempotencyKey: command.idempotencyKey,
      task: 'GENERATE_ADVENTURE_PLAN',
      modelProfileId: command.modelProfileId,
      input: inputJson,
      createdAt: this.now(),
    });
    if (pending.status === 'COMMITTED') {
      const record = this.generations.get(command.generationRecordId);
      if (record === null || record.validatedOutput === null) {
        throw new AIOrchestrationError(
          'GENERATION_RECORD_MISSING',
          'Committed adventure plan has no validated output',
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
    const prompt = formatTaskPrompt('GENERATE_ADVENTURE_PLAN', input, model.capabilities);
    const request: NormalizedAIRequest = {
      requestId: command.requestId,
      task: 'GENERATE_ADVENTURE_PLAN',
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
      task: 'GENERATE_ADVENTURE_PLAN',
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
        validationError: generationError(providerError.code, 'Adventure provider request failed'),
        completedAt: this.now(),
      });
      this.fail(
        command,
        providerError.code,
        'Adventure provider request failed',
        providerError.retryable,
      );
      throw new AIOrchestrationError(providerError.code, 'Adventure provider request failed', {
        cause: providerError,
      });
    }
    const validated = validateAIOutput('GENERATE_ADVENTURE_PLAN', raw);
    if (!validated.ok) {
      this.generations.complete(command.generationRecordId, {
        rawResponseText: raw,
        validatedOutput: null,
        validationError: validated.error,
        completedAt: this.now(),
      });
      this.fail(command, 'INVALID_OUTPUT', 'Adventure plan validation failed', true);
      throw new AIOrchestrationError('INVALID_OUTPUT', 'Adventure plan validation failed');
    }
    this.generations.complete(command.generationRecordId, {
      rawResponseText: raw,
      validatedOutput: validated.validatedOutput,
      validationError: null,
      completedAt: this.now(),
    });
    return validated.validatedOutput;
  }

  private requireAcceptedQuest(id: QuestId, campaignId: CampaignId): Quest {
    const quest = this.quests.get(id);
    if (quest === null || quest.campaignId !== campaignId || quest.status !== 'ACCEPTED') {
      throw new AIOrchestrationError(
        'QUEST_NOT_ACCEPTED',
        'Adventure requires an accepted campaign quest',
      );
    }
    return quest;
  }

  private requireWorld(id: CampaignId): WorldBible {
    const world = this.worlds.getBible(id);
    if (world === null) throw new AIOrchestrationError('WORLD_NOT_FOUND', 'World not found');
    return world;
  }

  private requireAdventure(id: AdventureId, campaignId: CampaignId): Adventure {
    const adventure = this.adventures.get(id);
    if (adventure === null || adventure.campaignId !== campaignId) {
      throw new AIOrchestrationError('ADVENTURE_NOT_FOUND', 'Campaign adventure not found');
    }
    return adventure;
  }

  private fail(
    command: GenerateAdventurePlanCommand,
    code: string,
    message: string,
    retryable: boolean,
  ): void {
    this.requests.fail(command.requestId, { code, message, retryable }, this.now());
  }
}

function validatePlan(
  output: ReturnType<typeof GenerateAdventurePlanOutputSchema.parse>,
  quest: Quest,
): void {
  if (
    output.risk !== quest.risk ||
    output.expectedTurns.min !== quest.expectedTurns.min ||
    output.expectedTurns.max !== quest.expectedTurns.max ||
    output.necessaryClues.filter(({ isCore }) => isCore).length < 3 ||
    output.possibleEndings.length < 2
  ) {
    throw new AIOrchestrationError(
      'ADVENTURE_PLAN_INVALID',
      'Adventure plan must preserve quest risk and length with three core clues and two endings',
    );
  }
}

function publicState(adventure: Adventure): AdventureStartState {
  return Object.freeze({
    adventureId: adventure.id,
    questId: adventure.questId,
    state: adventure.state,
    currentTurnNumber: adventure.currentTurnNumber,
  });
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
