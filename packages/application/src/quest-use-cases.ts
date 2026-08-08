import {
  GenerateQuestInputSchema,
  GenerateQuestOutputSchema,
  standardizeAIError,
  validateAIOutput,
  type AIProvider,
  type NormalizedAIRequest,
  type ProviderConfig,
} from '@ember-tavern/ai-core';
import {
  npcId,
  worldFactId,
  type AiRequestId,
  type Campaign,
  type CampaignId,
  type GenerationRecordId,
  type IdempotencyKey,
  type IsoTimestamp,
  type JsonValue,
  type ModelProfileId,
  type NpcId,
  type NpcProfile,
  type PlayerCharacterId,
  type Quest,
  type QuestId,
  type TavernId,
  type WorldBible,
} from '@ember-tavern/contracts';
import {
  CampaignRepository,
  GenerationRecordRepository,
  NpcRepository,
  PendingAiRequestRepository,
  PlayerCharacterRepository,
  QuestRepository,
  TavernRepository,
  WorldRepository,
  type TransactionalSqliteDatabase,
} from '@ember-tavern/persistence';
import { formatTaskPrompt } from '@ember-tavern/prompts';

import { AIOrchestrationError, type AITurnGenerationOptions } from './ai-turn-orchestrator.js';
import { executePrimaryAITask } from './ai-task-orchestrator.js';

export interface QuestGenerationRequest {
  readonly campaignId: CampaignId;
  readonly requestId: AiRequestId;
  readonly generationRecordId: GenerationRecordId;
  readonly idempotencyKey: IdempotencyKey;
  readonly modelProfileId: ModelProfileId | null;
  readonly modelName: string;
  readonly generationOptions: AITurnGenerationOptions;
}

export interface GenerateQuestCommand extends QuestGenerationRequest {
  readonly questId: QuestId;
  readonly tavernId: TavernId;
  readonly publisherNpcId: NpcId;
  readonly playerCharacterId: PlayerCharacterId;
}

export class QuestUseCases {
  private readonly campaigns: CampaignRepository;
  private readonly worlds: WorldRepository;
  private readonly characters: PlayerCharacterRepository;
  private readonly taverns: TavernRepository;
  private readonly npcs: NpcRepository;
  private readonly quests: QuestRepository;
  private readonly requests: PendingAiRequestRepository;
  private readonly generations: GenerationRecordRepository;

  public constructor(
    database: TransactionalSqliteDatabase,
    private readonly provider: AIProvider,
    private readonly providerConfig: ProviderConfig,
    private readonly now: () => IsoTimestamp,
  ) {
    this.campaigns = new CampaignRepository(database);
    this.worlds = new WorldRepository(database);
    this.characters = new PlayerCharacterRepository(database);
    this.taverns = new TavernRepository(database);
    this.npcs = new NpcRepository(database);
    this.quests = new QuestRepository(database);
    this.requests = new PendingAiRequestRepository(database);
    this.generations = new GenerationRecordRepository(database);
  }

  public async generateQuest(command: GenerateQuestCommand): Promise<Quest> {
    this.requireTavernCampaign(command.campaignId);
    const world = this.requireWorld(command.campaignId);
    const character = this.characters.get(command.playerCharacterId);
    if (character === null || character.campaignId !== command.campaignId) {
      throw new AIOrchestrationError('CHARACTER_NOT_FOUND', 'Campaign player character not found');
    }
    const tavern = this.taverns.get(command.tavernId);
    if (tavern === null || tavern.campaignId !== command.campaignId) {
      throw new AIOrchestrationError('TAVERN_NOT_FOUND', 'Campaign tavern not found');
    }
    const npcIds = [...tavern.residentNpcIds, ...tavern.visitorNpcIds];
    const availableNpcs = npcIds.map((id) => this.requireActiveNpc(id, command.campaignId));
    const publisher = availableNpcs.find(({ id }) => id === command.publisherNpcId);
    if (publisher === undefined) {
      throw new AIOrchestrationError(
        'QUEST_PUBLISHER_INVALID',
        'Quest publisher is not an active tavern NPC',
      );
    }
    const input = GenerateQuestInputSchema.parse({
      world: worldContext(world),
      tavernName: tavern.name,
      publisher: npcBrief(publisher),
      availableNpcs: availableNpcs.map(npcBrief),
      playerConcept: character.concept,
      recentQuestTitles: this.quests
        .listByCampaign(command.campaignId)
        .slice(-20)
        .map(({ content }) => content.title),
    });
    const output = GenerateQuestOutputSchema.parse(await this.generateValidated(command, input));
    if (output.expectedTurns.min < 8 || output.expectedTurns.max > 12) {
      throw new AIOrchestrationError(
        'QUEST_LENGTH_INVALID',
        'Initial quests must target 8 to 12 turns',
      );
    }
    const allowedNpcs = new Set(availableNpcs.map(({ id }) => id));
    const relatedNpcIds = output.relatedNpcIds.map(npcId);
    if (relatedNpcIds.some((id) => !allowedNpcs.has(id))) {
      throw new AIOrchestrationError(
        'QUEST_REFERENCE_INVALID',
        'Quest references an NPC outside the tavern',
      );
    }
    const facts = this.worlds.listFacts(command.campaignId);
    const allowedFacts = new Set(facts.map(({ id }) => id));
    const relatedFactIds = output.relatedFactIds.map(worldFactId);
    if (relatedFactIds.some((id) => !allowedFacts.has(id))) {
      throw new AIOrchestrationError(
        'QUEST_REFERENCE_INVALID',
        'Quest references an unknown world fact',
      );
    }
    const timestamp = this.now();
    const quest: Quest = Object.freeze({
      id: command.questId,
      campaignId: command.campaignId,
      publisherNpcId: publisher.id,
      content: Object.freeze({ ...output.content }),
      status: 'AVAILABLE',
      risk: output.risk,
      recommendedAttributes: Object.freeze([...output.recommendedAttributes]),
      expectedTurns: Object.freeze({ ...output.expectedTurns }),
      rewardTier: output.rewardTier,
      relatedNpcIds: Object.freeze(relatedNpcIds),
      relatedFactIds: Object.freeze(relatedFactIds),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    try {
      this.requests.commitQuestOnce(command.idempotencyKey, quest, timestamp);
    } catch (error) {
      this.fail(command, 'COMMIT_FAILED', 'Quest commit failed', false);
      throw new AIOrchestrationError('COMMIT_FAILED', 'Quest commit failed', { cause: error });
    }
    return this.requireQuest(command.questId, command.campaignId);
  }

  public acceptQuest(campaignId: CampaignId, questId: QuestId): Quest {
    this.requireTavernCampaign(campaignId);
    try {
      return this.quests.acceptAsOnlyMain(questId, campaignId, this.now());
    } catch (error) {
      throw new AIOrchestrationError(
        'QUEST_NOT_ACCEPTABLE',
        'Quest cannot be accepted while another main quest is in progress',
        { cause: error },
      );
    }
  }

  private async generateValidated(
    command: QuestGenerationRequest,
    input: unknown,
  ): Promise<JsonValue> {
    const inputJson = json(input);
    const pending = this.requests.createOrGet({
      id: command.requestId,
      campaignId: command.campaignId,
      turnId: null,
      idempotencyKey: command.idempotencyKey,
      task: 'GENERATE_QUEST',
      modelProfileId: command.modelProfileId,
      input: inputJson,
      createdAt: this.now(),
    });
    if (pending.status === 'COMMITTED') {
      const record = this.generations.get(command.generationRecordId);
      if (record === null || record.validatedOutput === null) {
        throw new AIOrchestrationError(
          'GENERATION_RECORD_MISSING',
          'Committed quest generation has no validated output',
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
    const prompt = formatTaskPrompt('GENERATE_QUEST', input, model.capabilities);
    const request: NormalizedAIRequest = {
      requestId: command.requestId,
      task: 'GENERATE_QUEST',
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
      task: 'GENERATE_QUEST',
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
        validationError: generationError(providerError.code, 'Quest provider request failed'),
        completedAt: this.now(),
      });
      this.fail(
        command,
        providerError.code,
        'Quest provider request failed',
        providerError.retryable,
      );
      throw new AIOrchestrationError(providerError.code, 'Quest provider request failed', {
        cause: providerError,
      });
    }
    const validated = validateAIOutput('GENERATE_QUEST', raw);
    if (!validated.ok) {
      this.generations.complete(command.generationRecordId, {
        rawResponseText: raw,
        validatedOutput: null,
        validationError: validated.error,
        completedAt: this.now(),
      });
      this.fail(command, 'INVALID_OUTPUT', 'Quest output validation failed', true);
      throw new AIOrchestrationError('INVALID_OUTPUT', 'Quest output validation failed');
    }
    this.generations.complete(command.generationRecordId, {
      rawResponseText: raw,
      validatedOutput: validated.validatedOutput,
      validationError: null,
      completedAt: this.now(),
    });
    return validated.validatedOutput;
  }

  private requireTavernCampaign(id: CampaignId): Campaign {
    const campaign = this.campaigns.get(id);
    if (campaign === null) {
      throw new AIOrchestrationError('CAMPAIGN_NOT_FOUND', 'Campaign not found');
    }
    if (campaign.state !== 'TAVERN') {
      throw new AIOrchestrationError('QUESTS_NOT_AVAILABLE', 'Quest actions require TAVERN state');
    }
    return campaign;
  }

  private requireWorld(id: CampaignId): WorldBible {
    const world = this.worlds.getBible(id);
    if (world === null) throw new AIOrchestrationError('WORLD_NOT_FOUND', 'World not found');
    return world;
  }

  private requireActiveNpc(id: NpcId, campaign: CampaignId) {
    const npc = this.npcs.get(id);
    if (npc === null || npc.campaignId !== campaign || npc.currentStatus !== 'ACTIVE') {
      throw new AIOrchestrationError('NPC_NOT_FOUND', 'Active campaign NPC not found');
    }
    return npc;
  }

  private requireQuest(id: QuestId, campaign: CampaignId): Quest {
    const quest = this.quests.get(id);
    if (quest === null || quest.campaignId !== campaign) {
      throw new AIOrchestrationError('QUEST_NOT_FOUND', 'Campaign quest not found');
    }
    return quest;
  }

  private fail(
    command: QuestGenerationRequest,
    code: string,
    message: string,
    retryable: boolean,
  ): void {
    this.requests.fail(command.requestId, { code, message, retryable }, this.now());
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

function npcBrief(npc: NpcProfile) {
  return {
    id: npc.id,
    name: npc.name,
    identity: npc.identity,
    personality: npc.personality,
    goal: npc.goal,
    currentMood: npc.currentMood,
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
