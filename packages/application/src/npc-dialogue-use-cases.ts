import {
  ExtractMemoriesInputSchema,
  ExtractMemoriesOutputSchema,
  NpcReplyOutputSchema,
  buildNpcDialogueContext,
  compressContextHistory,
  contextBudgetForTask,
  findRepeatedPhrase,
  standardizeAIError,
  validateAIOutput,
  type AIProvider,
  type AITask,
  type NormalizedAIRequest,
  type ProviderConfig,
} from '@ember-tavern/ai-core';
import {
  turnId,
  type AiRequestId,
  type Campaign,
  type CampaignId,
  type Conversation,
  type ConversationId,
  type GenerationRecordId,
  type IdempotencyKey,
  type IsoTimestamp,
  type JsonValue,
  type Message,
  type MessageId,
  type ModelProfileId,
  type NpcId,
  type NpcMemory,
  type NpcMemoryId,
  type NpcProfile,
  type NpcRelationship,
  type TurnId,
} from '@ember-tavern/contracts';
import { applyRelationshipPatch, type RelationshipPatch } from '@ember-tavern/domain';
import {
  CampaignRepository,
  ConversationRepository,
  GenerationRecordRepository,
  NpcRepository,
  PendingAiRequestRepository,
  WorldRepository,
  type TransactionalSqliteDatabase,
} from '@ember-tavern/persistence';
import { formatTaskPrompt } from '@ember-tavern/prompts';

import { AIOrchestrationError, type AITurnGenerationOptions } from './ai-turn-orchestrator.js';
import { executePrimaryAITask } from './ai-task-orchestrator.js';

export interface DialogueIdentityFactory {
  memory(summary: string, index: number): NpcMemoryId;
}

export interface DialogueGenerationRequest {
  readonly campaignId: CampaignId;
  readonly requestId: AiRequestId;
  readonly generationRecordId: GenerationRecordId;
  readonly idempotencyKey: IdempotencyKey;
  readonly modelProfileId: ModelProfileId | null;
  readonly modelName: string;
  readonly generationOptions: AITurnGenerationOptions;
}

export interface TalkToNpcCommand extends DialogueGenerationRequest {
  readonly conversationId: ConversationId;
  readonly playerMessageId: MessageId;
  readonly npcMessageId: MessageId;
  readonly npcId: NpcId;
  readonly playerMessage: string;
}

export interface ExtractMemoriesCommand extends DialogueGenerationRequest {
  readonly conversationId: ConversationId;
  readonly npcId: NpcId;
  readonly sourceTurnIds: readonly TurnId[];
}

export interface NpcDialogueResult {
  readonly conversation: Conversation;
  readonly messages: readonly Message[];
  readonly npc: NpcProfile;
  readonly relationship: NpcRelationship;
}

export class NpcDialogueUseCases {
  private readonly campaigns: CampaignRepository;
  private readonly conversations: ConversationRepository;
  private readonly npcs: NpcRepository;
  private readonly worlds: WorldRepository;
  private readonly requests: PendingAiRequestRepository;
  private readonly generations: GenerationRecordRepository;

  public constructor(
    database: TransactionalSqliteDatabase,
    private readonly provider: AIProvider,
    private readonly providerConfig: ProviderConfig,
    private readonly identities: DialogueIdentityFactory,
    private readonly now: () => IsoTimestamp,
  ) {
    this.campaigns = new CampaignRepository(database);
    this.conversations = new ConversationRepository(database);
    this.npcs = new NpcRepository(database);
    this.worlds = new WorldRepository(database);
    this.requests = new PendingAiRequestRepository(database);
    this.generations = new GenerationRecordRepository(database);
  }

  public async talkToNpc(command: TalkToNpcCommand): Promise<NpcDialogueResult> {
    const prior = this.requests.getByIdempotencyKey(command.idempotencyKey);
    if (prior?.status === 'COMMITTED') return this.loadDialogue(command);
    const campaign = this.requireTavernCampaign(command.campaignId);
    const world = this.worlds.getBible(command.campaignId);
    if (world === null) throw new AIOrchestrationError('WORLD_NOT_FOUND', 'World not found');
    const npc = this.requireNpc(command.npcId, command.campaignId);
    if (npc.currentStatus !== 'ACTIVE') {
      throw new AIOrchestrationError('NPC_UNAVAILABLE', 'NPC is not available for conversation');
    }
    const knowledge = this.npcs.getKnowledge(npc.id);
    const relationship = this.npcs.getRelationship(npc.id);
    if (knowledge === null || relationship === null) {
      throw new AIOrchestrationError(
        'NPC_CONTEXT_INCOMPLETE',
        'NPC knowledge or relationship is missing',
      );
    }
    const existing = this.conversations.get(command.conversationId);
    if (
      existing !== null &&
      (existing.campaignId !== campaign.id || existing.kind !== 'NPC' || existing.npcId !== npc.id)
    ) {
      throw new AIOrchestrationError(
        'CONVERSATION_SCOPE_MISMATCH',
        'Conversation belongs to another scope',
      );
    }
    const messages =
      existing === null ? Object.freeze([]) : this.conversations.listMessages(existing.id);
    const input = buildNpcDialogueContext(
      {
        world,
        npc,
        knowledge,
        relationship,
        facts: this.worlds.listFacts(campaign.id),
        messages,
        memories: this.npcs.listMemories(npc.id),
        playerMessage: command.playerMessage,
      },
      contextBudgetForTask('NPC_REPLY'),
    );
    const output = NpcReplyOutputSchema.parse(
      await this.generateValidated('NPC_REPLY', command, input),
    );
    const repeatedPhrase = findRepeatedPhrase(
      [output.reply, ...output.suggestedTopics, output.memoryCandidate ?? ''],
      messages.filter(({ role }) => role === 'NPC').map(({ content }) => content),
    );
    if (repeatedPhrase !== null) {
      this.fail(command, 'REPETITION_DETECTED', 'NPC reply repeats recent generated text', false);
      throw new AIOrchestrationError(
        'REPETITION_DETECTED',
        'NPC reply repeats recent generated text',
      );
    }
    const timestamp = this.now();
    const conversation: Conversation =
      existing ??
      Object.freeze({
        id: command.conversationId,
        campaignId: campaign.id,
        kind: 'NPC',
        npcId: npc.id,
        adventureId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    const playerMessage: Message = Object.freeze({
      id: command.playerMessageId,
      conversationId: conversation.id,
      sequenceNumber: messages.length + 1,
      role: 'PLAYER',
      speakerNpcId: null,
      content: command.playerMessage,
      generationRecordId: null,
      createdAt: timestamp,
    });
    const npcMessage: Message = Object.freeze({
      id: command.npcMessageId,
      conversationId: conversation.id,
      sequenceNumber: messages.length + 2,
      role: 'NPC',
      speakerNpcId: npc.id,
      content: output.reply,
      generationRecordId: command.generationRecordId,
      createdAt: timestamp,
    });
    const relationshipPatch = definedRelationshipPatch(output.relationshipProposal);
    const nextRelationship =
      Object.keys(relationshipPatch).length === 0
        ? relationship
        : applyRelationshipPatch(relationship, relationshipPatch);
    const nextNpc: NpcProfile = Object.freeze({
      ...npc,
      currentMood: output.mood,
      updatedAt: timestamp,
    });
    try {
      this.requests.commitNpcReplyOnce(
        command.idempotencyKey,
        { ...conversation, updatedAt: timestamp },
        playerMessage,
        npcMessage,
        nextNpc,
        nextRelationship,
        timestamp,
      );
    } catch (error) {
      this.fail(command, 'COMMIT_FAILED', 'NPC reply commit failed', false);
      throw new AIOrchestrationError('COMMIT_FAILED', 'NPC reply commit failed', { cause: error });
    }
    return this.loadDialogue(command);
  }

  public async extractMemories(command: ExtractMemoriesCommand): Promise<readonly NpcMemory[]> {
    this.requireTavernCampaign(command.campaignId);
    const npc = this.requireNpc(command.npcId, command.campaignId);
    const conversation = this.conversations.get(command.conversationId);
    if (
      conversation === null ||
      conversation.campaignId !== command.campaignId ||
      conversation.npcId !== npc.id
    ) {
      throw new AIOrchestrationError('CONVERSATION_NOT_FOUND', 'NPC conversation not found');
    }
    const transcriptHistory = this.conversations
      .listMessages(conversation.id)
      .map(({ role, content }) => `${role}: ${content}`);
    if (transcriptHistory.length === 0 || command.sourceTurnIds.length === 0) {
      throw new AIOrchestrationError(
        'MEMORY_SOURCE_EMPTY',
        'Memory extraction requires transcript and source turn IDs',
      );
    }
    const budget = contextBudgetForTask('EXTRACT_MEMORIES');
    const transcript = compressContextHistory(
      transcriptHistory,
      budget.recentMessageLimit,
      budget.historicalSummaryMaxCharacters,
    );
    const sourceTurnIds = command.sourceTurnIds.slice(-Math.min(50, budget.recentTurnLimit));
    const input = ExtractMemoriesInputSchema.parse({
      npc: {
        id: npc.id,
        name: npc.name,
        identity: npc.identity,
        personality: npc.personality,
        goal: npc.goal,
        currentMood: npc.currentMood,
      },
      turnIds: sourceTurnIds,
      transcript,
    });
    const output = ExtractMemoriesOutputSchema.parse(
      await this.generateValidated('EXTRACT_MEMORIES', command, input),
    );
    const allowed = new Set(sourceTurnIds);
    const timestamp = this.now();
    const memories: readonly NpcMemory[] = Object.freeze(
      output.memories.map((memory, index) => {
        const sourceTurnIds = memory.sourceTurnIds.map(turnId);
        if (sourceTurnIds.some((id) => !allowed.has(id))) {
          throw new AIOrchestrationError(
            'MEMORY_SOURCE_INVALID',
            'Generated memory references an unknown source turn',
          );
        }
        return Object.freeze({
          id: this.identities.memory(memory.summary, index),
          npcId: npc.id,
          summary: memory.summary,
          sourceTurnIds: Object.freeze(sourceTurnIds),
          createdAt: timestamp,
        });
      }),
    );
    try {
      this.requests.commitMemoriesOnce(
        command.idempotencyKey,
        command.campaignId,
        memories,
        timestamp,
      );
    } catch (error) {
      this.fail(command, 'COMMIT_FAILED', 'NPC memory commit failed', false);
      throw new AIOrchestrationError('COMMIT_FAILED', 'NPC memory commit failed', {
        cause: error,
      });
    }
    const ids = new Set(memories.map(({ id }) => id));
    return this.npcs.listMemories(npc.id).filter(({ id }) => ids.has(id));
  }

  private async generateValidated(
    task: Extract<AITask, 'NPC_REPLY' | 'EXTRACT_MEMORIES'>,
    command: DialogueGenerationRequest,
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
          'Committed dialogue generation has no validated output',
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
        validationError: generationError(providerError.code, 'Dialogue provider request failed'),
        completedAt: this.now(),
      });
      this.fail(
        command,
        providerError.code,
        'Dialogue provider request failed',
        providerError.retryable,
      );
      throw new AIOrchestrationError(providerError.code, 'Dialogue provider request failed', {
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
      this.fail(command, 'INVALID_OUTPUT', 'Dialogue output validation failed', true);
      throw new AIOrchestrationError('INVALID_OUTPUT', 'Dialogue output validation failed');
    }
    this.generations.complete(command.generationRecordId, {
      rawResponseText: raw,
      validatedOutput: validated.validatedOutput,
      validationError: null,
      completedAt: this.now(),
    });
    return validated.validatedOutput;
  }

  private loadDialogue(command: TalkToNpcCommand): NpcDialogueResult {
    const conversation = this.conversations.get(command.conversationId);
    if (conversation === null) {
      throw new AIOrchestrationError('CONVERSATION_NOT_FOUND', 'NPC conversation not found');
    }
    const npc = this.requireNpc(command.npcId, command.campaignId);
    const relationship = this.npcs.getRelationship(npc.id);
    if (relationship === null) {
      throw new AIOrchestrationError('NPC_CONTEXT_INCOMPLETE', 'NPC relationship is missing');
    }
    return Object.freeze({
      conversation,
      messages: this.conversations.listMessages(conversation.id),
      npc,
      relationship,
    });
  }

  private requireTavernCampaign(id: CampaignId): Campaign {
    const campaign = this.campaigns.get(id);
    if (campaign === null) {
      throw new AIOrchestrationError('CAMPAIGN_NOT_FOUND', 'Campaign not found');
    }
    if (campaign.state !== 'TAVERN') {
      throw new AIOrchestrationError(
        'DIALOGUE_NOT_AVAILABLE',
        'NPC dialogue requires TAVERN state',
      );
    }
    return campaign;
  }

  private requireNpc(id: NpcId, campaign: CampaignId): NpcProfile {
    const npc = this.npcs.get(id);
    if (npc === null || npc.campaignId !== campaign) {
      throw new AIOrchestrationError('NPC_NOT_FOUND', 'Campaign NPC not found');
    }
    return npc;
  }

  private fail(
    command: DialogueGenerationRequest,
    code: string,
    message: string,
    retryable: boolean,
  ): void {
    this.requests.fail(command.requestId, { code, message, retryable }, this.now());
  }
}

function generationError(code: string, message: string) {
  return Object.freeze({
    code,
    issues: Object.freeze([Object.freeze({ path: Object.freeze([]), code, message })]),
  });
}

function definedRelationshipPatch(
  proposal: Readonly<{
    trust?: number | null | undefined;
    closeness?: number | null | undefined;
    awe?: number | null | undefined;
    obligation?: number | null | undefined;
  }>,
): RelationshipPatch {
  const patch: {
    trust?: number;
    closeness?: number;
    awe?: number;
    obligation?: number;
  } = {};
  if (proposal.trust != null) patch.trust = proposal.trust;
  if (proposal.closeness != null) patch.closeness = proposal.closeness;
  if (proposal.awe != null) patch.awe = proposal.awe;
  if (proposal.obligation != null) patch.obligation = proposal.obligation;
  return patch;
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
