import type { AITask, ProviderConfig } from '@ember-tavern/ai-core';
import {
  type AiRequestId,
  type GenerationRecordId,
  type IdempotencyKey,
  type JsonValue,
} from '@ember-tavern/contracts';
import {
  GenerationRecordRepository,
  ModelProfileRepository,
  PendingAiRequestRepository,
  type IdempotentCommitResult,
  type TransactionalSqliteDatabase,
  type TurnCommit,
} from '@ember-tavern/persistence';
import { formatOutputRepairPrompt } from '@ember-tavern/prompts';

import {
  AIOrchestrationError,
  type AITurnGenerationOptions,
  type AITurnOrchestrator,
} from './ai-turn-orchestrator.js';

export interface RepairStructuredTurnOutputCommand {
  readonly sourceRequestId: AiRequestId;
  readonly requestId: AiRequestId;
  readonly generationRecordId: GenerationRecordId;
  readonly idempotencyKey: IdempotencyKey;
  readonly task: AITask;
  readonly generationOptions: AITurnGenerationOptions;
  readonly validateDomainAndBuildCommit: (output: JsonValue) => TurnCommit | Promise<TurnCommit>;
}

export class StructuredOutputRepairUseCases {
  private readonly requests: PendingAiRequestRepository;
  private readonly generations: GenerationRecordRepository;
  private readonly profiles: ModelProfileRepository;

  public constructor(
    database: TransactionalSqliteDatabase,
    private readonly originalModelOrchestrator: AITurnOrchestrator,
    private readonly originalProvider: ProviderConfig,
  ) {
    this.requests = new PendingAiRequestRepository(database);
    this.generations = new GenerationRecordRepository(database);
    this.profiles = new ModelProfileRepository(database);
  }

  public async repairTurn(
    command: RepairStructuredTurnOutputCommand,
  ): Promise<IdempotentCommitResult> {
    const source = this.requests.get(command.sourceRequestId);
    const sourceGeneration = this.generations.getByRequestId(command.sourceRequestId);
    if (
      source === null ||
      source.status !== 'FAILED' ||
      source.turnId === null ||
      source.context === null ||
      source.task !== command.task ||
      source.lastError?.code !== 'INVALID_OUTPUT' ||
      sourceGeneration === null ||
      sourceGeneration.rawResponseText === null ||
      sourceGeneration.validationError === null ||
      sourceGeneration.modelProfileId === null ||
      sourceGeneration.campaignId !== source.campaignId ||
      sourceGeneration.task !== source.task ||
      !['INVALID_JSON', 'SCHEMA_VALIDATION_FAILED'].includes(sourceGeneration.validationError.code)
    ) {
      throw new AIOrchestrationError(
        'STRUCTURE_REPAIR_NOT_AVAILABLE',
        'A failed structured turn output is required for repair',
      );
    }
    const invalidOutput = sourceGeneration.rawResponseText;
    const validationError = sourceGeneration.validationError;
    const existingRepair = this.generations.getRepairBySourceRequestId(source.id);
    if (existingRepair !== null && existingRepair.requestId !== command.requestId) {
      throw new AIOrchestrationError(
        'STRUCTURE_REPAIR_ALREADY_ATTEMPTED',
        'Structured output repair is limited to one attempt',
      );
    }

    const profile = this.profiles.getEnabled(sourceGeneration.modelProfileId);
    if (
      profile === null ||
      profile.providerConfigId !== this.originalProvider.id ||
      profile.providerPresetKey !== this.originalProvider.presetKey ||
      profile.providerType !== this.originalProvider.providerType
    ) {
      throw new AIOrchestrationError(
        'ORIGINAL_MODEL_UNAVAILABLE',
        'The original model profile is unavailable for structure repair',
      );
    }

    return await this.originalModelOrchestrator.execute({
      requestId: command.requestId,
      generationRecordId: command.generationRecordId,
      campaignId: source.campaignId,
      turnId: source.turnId,
      idempotencyKey: command.idempotencyKey,
      task: command.task,
      modelProfileId: profile.id,
      modelName: profile.modelName,
      requireSelectedModelProfile: true,
      repairSourceRequestId: source.id,
      input: source.input,
      generationOptions: command.generationOptions,
      buildContext: () => source.context,
      formatPrompt: (context, capabilities) =>
        formatOutputRepairPrompt(
          command.task,
          context,
          invalidOutput,
          validationError,
          capabilities,
        ),
      validateDomainAndBuildCommit: command.validateDomainAndBuildCommit,
    });
  }
}
