import {
  CompleteCharacterBackgroundInputSchema,
  CompleteCharacterBackgroundOutputSchema,
  GenerateCharacterTraitsInputSchema,
  GenerateCharacterTraitsOutputSchema,
  standardizeAIError,
  validateAIOutput,
  type AIProvider,
  type AITask,
  type NormalizedAIRequest,
  type ProviderConfig,
} from '@ember-tavern/ai-core';
import {
  createPlayerAttributes,
  transitionCampaign,
  type AiRequestId,
  type Campaign,
  type CampaignId,
  type CharacterAttributeName,
  type CharacterTrait,
  type CharacterTraitId,
  type ClassArchetype,
  type ContentBoundaries,
  type GenerationRecordId,
  type IdempotencyKey,
  type IsoTimestamp,
  type Item,
  type ItemId,
  type JsonValue,
  type ModelProfileId,
  type PlayerAttributesInput,
  type PlayerCharacter,
  type PlayerCharacterId,
} from '@ember-tavern/contracts';
import {
  CampaignRepository,
  GenerationRecordRepository,
  PendingAiRequestRepository,
  PlayerCharacterRepository,
  type TransactionalSqliteDatabase,
} from '@ember-tavern/persistence';
import { formatTaskPrompt } from '@ember-tavern/prompts';

import { AIOrchestrationError, type AITurnGenerationOptions } from './ai-turn-orchestrator.js';
import { executePrimaryAITask } from './ai-task-orchestrator.js';

export interface CharacterIdentityFactory {
  trait(name: string, index: number): CharacterTraitId;
  item(name: string, index: number): ItemId;
}

export interface CreateCharacterCommand {
  readonly id: PlayerCharacterId;
  readonly campaignId: CampaignId;
  readonly name: string;
  readonly gender: string | null;
  readonly age: number | null;
  readonly concept: string;
  readonly storyPreferences: readonly string[];
  readonly contentBoundaries: ContentBoundaries;
  readonly classArchetype: ClassArchetype;
  readonly classDisplayName: string;
  readonly attributes: PlayerAttributesInput;
  readonly personalGoal: string;
}

export interface CharacterDraft extends CreateCharacterCommand {
  readonly attributes: PlayerCharacter['attributes'];
  readonly createdAt: IsoTimestamp;
}

export interface CharacterGenerationRequest {
  readonly campaignId: CampaignId;
  readonly requestId: AiRequestId;
  readonly generationRecordId: GenerationRecordId;
  readonly idempotencyKey: IdempotencyKey;
  readonly modelProfileId: ModelProfileId | null;
  readonly modelName: string;
  readonly generationOptions: AITurnGenerationOptions;
}

export interface GenerateCharacterTraitsCommand extends CharacterGenerationRequest {
  readonly character: CharacterDraft;
}

export interface CompleteCharacterBackgroundCommand extends CharacterGenerationRequest {
  readonly character: CharacterDraft;
  readonly selectedTraits: readonly [CharacterTrait, CharacterTrait];
}

export class CharacterCreationUseCases {
  private readonly campaigns: CampaignRepository;
  private readonly characters: PlayerCharacterRepository;
  private readonly requests: PendingAiRequestRepository;
  private readonly generations: GenerationRecordRepository;

  public constructor(
    database: TransactionalSqliteDatabase,
    private readonly provider: AIProvider,
    private readonly providerConfig: ProviderConfig,
    private readonly identities: CharacterIdentityFactory,
    private readonly now: () => IsoTimestamp,
  ) {
    this.campaigns = new CampaignRepository(database);
    this.characters = new PlayerCharacterRepository(database);
    this.requests = new PendingAiRequestRepository(database);
    this.generations = new GenerationRecordRepository(database);
  }

  public createCharacter(command: CreateCharacterCommand): CharacterDraft {
    const campaign = this.requireCampaign(command.campaignId);
    if (campaign.state !== 'CREATING_CHARACTER') {
      throw new AIOrchestrationError(
        'CHARACTER_NOT_CREATABLE',
        'Character creation requires CREATING_CHARACTER',
      );
    }
    if (this.characters.get(command.id) !== null) {
      throw new AIOrchestrationError('CHARACTER_ALREADY_EXISTS', 'Character already exists');
    }
    const age = command.age;
    if (age !== null && (!Number.isSafeInteger(age) || age < 0)) {
      throw new AIOrchestrationError('INVALID_CHARACTER', 'Age must be a non-negative integer');
    }
    const createdAt = this.now();
    return Object.freeze({
      ...command,
      name: canonical(command.name, 'name'),
      gender: command.gender === null ? null : canonical(command.gender, 'gender'),
      concept: canonical(command.concept, 'concept'),
      storyPreferences: Object.freeze(
        command.storyPreferences.map((value) => canonical(value, 'story preference')),
      ),
      contentBoundaries: Object.freeze({
        ...command.contentBoundaries,
        excludedContent: Object.freeze(
          command.contentBoundaries.excludedContent.map((value) =>
            canonical(value, 'excluded content'),
          ),
        ),
      }),
      classDisplayName: canonical(command.classDisplayName, 'class display name'),
      attributes: createPlayerAttributes(command.attributes),
      personalGoal: canonical(command.personalGoal, 'personal goal'),
      createdAt,
    });
  }

  public async generateCharacterTraits(
    command: GenerateCharacterTraitsCommand,
  ): Promise<readonly CharacterTrait[]> {
    this.requireDraftCampaign(command);
    const input = GenerateCharacterTraitsInputSchema.parse({
      concept: command.character.concept,
      classArchetype: command.character.classArchetype,
      personalGoal: command.character.personalGoal,
      storyPreferences: command.character.storyPreferences,
    });
    const output = GenerateCharacterTraitsOutputSchema.parse(
      await this.generateValidated('GENERATE_CHARACTER_TRAITS', command, input),
    );
    const traits = Object.freeze(
      output.traits.map((trait, index) =>
        Object.freeze({
          id: this.identities.trait(trait.name, index),
          name: trait.name,
          description: trait.description,
        }),
      ),
    );
    try {
      this.requests.commitContentOnce(command.idempotencyKey, command.campaignId, this.now());
    } catch (error) {
      this.fail(command, 'COMMIT_FAILED', 'Character trait generation commit failed', false);
      throw new AIOrchestrationError('COMMIT_FAILED', 'Character trait generation commit failed', {
        cause: error,
      });
    }
    return traits;
  }

  public async completeCharacterBackground(
    command: CompleteCharacterBackgroundCommand,
  ): Promise<PlayerCharacter> {
    const prior = this.requests.getByIdempotencyKey(command.idempotencyKey);
    if (prior?.status === 'COMMITTED') return this.requireCharacter(command.character.id);
    this.requireDraftCampaign(command);
    validateSelectedTraits(command.selectedTraits);
    const input = CompleteCharacterBackgroundInputSchema.parse({
      name: command.character.name,
      concept: command.character.concept,
      classDisplayName: command.character.classDisplayName,
      personalGoal: command.character.personalGoal,
      traits: command.selectedTraits.map(({ name, description }) => ({ name, description })),
    });
    const output = CompleteCharacterBackgroundOutputSchema.parse(
      await this.generateValidated('COMPLETE_CHARACTER_BACKGROUND', command, input),
    );
    const timestamp = this.now();
    const items = output.initialEquipment.map(({ name, description }, index): Item =>
      Object.freeze({
        id: this.identities.item(name, index),
        campaignId: command.campaignId,
        content: Object.freeze({ name, description }),
        rewardTier: 'BASIC',
        effect:
          index === 0
            ? Object.freeze({
                kind: 'CHECK_MODIFIER',
                attribute: primaryAttribute(command.character.classArchetype),
                modifier: 1,
              })
            : Object.freeze({ kind: 'NONE' }),
        createdAt: timestamp,
      }),
    );
    const selectedTraits: readonly [CharacterTrait, CharacterTrait] = Object.freeze([
      command.selectedTraits[0],
      command.selectedTraits[1],
    ]);
    const character: PlayerCharacter = Object.freeze({
      ...command.character,
      traits: selectedTraits,
      background: Object.freeze({
        birthplace: output.birthplace,
        formativeExperience: output.formativeExperience,
        adventureMotivation: output.adventureMotivation,
        secret: output.secret,
        importantPerson: output.importantPerson,
        tavernArrivalReason: output.tavernArrivalReason,
      }),
      initialEquipment: Object.freeze(items.map(({ id }) => Object.freeze({ itemId: id }))),
      updatedAt: timestamp,
    });
    const campaign = transitionCampaign(
      this.requireCampaign(command.campaignId),
      'GENERATING_TAVERN',
      timestamp,
    );
    try {
      this.requests.commitCharacterOnce(
        command.idempotencyKey,
        campaign,
        character,
        items,
        timestamp,
      );
    } catch (error) {
      this.fail(command, 'COMMIT_FAILED', 'Character commit failed', false);
      throw new AIOrchestrationError('COMMIT_FAILED', 'Character commit failed', { cause: error });
    }
    return this.requireCharacter(character.id);
  }

  private async generateValidated(
    task: Extract<AITask, 'GENERATE_CHARACTER_TRAITS' | 'COMPLETE_CHARACTER_BACKGROUND'>,
    command: CharacterGenerationRequest,
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
      if (record?.validatedOutput === null || record === null) {
        throw new AIOrchestrationError(
          'GENERATION_RECORD_MISSING',
          'Committed character generation has no validated output',
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
        validationError: validationError(providerError.code, 'Character provider request failed'),
        completedAt: this.now(),
      });
      this.fail(
        command,
        providerError.code,
        'Character provider request failed',
        providerError.retryable,
      );
      throw new AIOrchestrationError(providerError.code, 'Character provider request failed', {
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
      this.fail(command, 'INVALID_OUTPUT', 'Character output validation failed', true);
      throw new AIOrchestrationError('INVALID_OUTPUT', 'Character output validation failed');
    }
    this.generations.complete(command.generationRecordId, {
      rawResponseText: raw,
      validatedOutput: validated.validatedOutput,
      validationError: null,
      completedAt: this.now(),
    });
    return validated.validatedOutput;
  }

  private requireDraftCampaign(command: {
    readonly campaignId: CampaignId;
    readonly character: CharacterDraft;
  }): void {
    if (command.character.campaignId !== command.campaignId) {
      throw new AIOrchestrationError(
        'CHARACTER_CAMPAIGN_MISMATCH',
        'Character draft belongs to another campaign',
      );
    }
    if (this.requireCampaign(command.campaignId).state !== 'CREATING_CHARACTER') {
      throw new AIOrchestrationError(
        'CHARACTER_NOT_CREATABLE',
        'Character creation requires CREATING_CHARACTER',
      );
    }
  }

  private fail(
    command: CharacterGenerationRequest,
    code: string,
    message: string,
    retryable: boolean,
  ): void {
    this.requests.fail(command.requestId, { code, message, retryable }, this.now());
  }

  private requireCampaign(id: CampaignId): Campaign {
    const campaign = this.campaigns.get(id);
    if (campaign === null) {
      throw new AIOrchestrationError('CAMPAIGN_NOT_FOUND', 'Campaign not found');
    }
    return campaign;
  }

  private requireCharacter(id: PlayerCharacterId): PlayerCharacter {
    const character = this.characters.get(id);
    if (character === null) {
      throw new AIOrchestrationError('CHARACTER_NOT_FOUND', 'Character not found');
    }
    return character;
  }
}

function validateSelectedTraits(traits: readonly [CharacterTrait, CharacterTrait]): void {
  if (traits.length !== 2 || traits[0].id === traits[1].id || traits[0].name === traits[1].name) {
    throw new AIOrchestrationError(
      'INVALID_TRAIT_SELECTION',
      'Exactly two distinct character traits must be selected',
    );
  }
}

function primaryAttribute(archetype: ClassArchetype): CharacterAttributeName {
  const attributes: Readonly<Record<ClassArchetype, CharacterAttributeName>> = {
    WARRIOR: 'physique',
    ROGUE: 'agility',
    SCHOLAR: 'knowledge',
    DIPLOMAT: 'charisma',
  };
  return attributes[archetype];
}

function canonical(value: string, label: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new AIOrchestrationError(
      'INVALID_CHARACTER',
      `${label} must be non-empty canonical text`,
    );
  }
  return value;
}

function validationError(code: string, message: string) {
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
