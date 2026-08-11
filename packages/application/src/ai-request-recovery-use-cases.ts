import type { AITask, ProviderConfig } from '@ember-tavern/ai-core';
import {
  aiOperationId,
  schemaVersion,
  type AiRequestId,
  type GameEventId,
  type GenerationRecordId,
  type IdempotencyKey,
  type IsoTimestamp,
  type ModelProfileId,
} from '@ember-tavern/contracts';
import {
  GenerationRecordRepository,
  ModelProfileRepository,
  PendingAiRequestRepository,
  type IdempotentCommitResult,
  type TransactionalSqliteDatabase,
  type TurnCommit,
} from '@ember-tavern/persistence';

import {
  AIOrchestrationError,
  type AITurnGenerationOptions,
  type AITurnOrchestrator,
} from './ai-turn-orchestrator.js';

const RECOVERABLE_FAILURES = new Set([
  'APP_INTERRUPTED',
  'QUOTA_EXCEEDED',
  'AUTHENTICATION_FAILED',
  'RATE_LIMITED',
  'TIMEOUT',
  'MODEL_NOT_FOUND',
  'NETWORK_FAILED',
]);

export interface RecoverAITurnCommand {
  readonly sourceRequestId: AiRequestId;
  readonly requestId: AiRequestId;
  readonly generationRecordId: GenerationRecordId;
  readonly idempotencyKey: IdempotencyKey;
  readonly task: AITask;
  readonly targetModelProfileId: ModelProfileId;
  readonly targetModelName: string;
  readonly selection: 'RETRY_SELECTED_MODEL' | 'CONFIGURED_FALLBACK';
  readonly crossProviderDisclosureAccepted: boolean;
  readonly modelSwitchedEventId: GameEventId;
  readonly generationOptions: AITurnGenerationOptions;
  readonly validateDomainAndBuildCommit: (output: unknown) => TurnCommit | Promise<TurnCommit>;
}

export class AIRequestRecoveryUseCases {
  private readonly requests: PendingAiRequestRepository;
  private readonly generations: GenerationRecordRepository;
  private readonly profiles: ModelProfileRepository;

  public constructor(
    database: TransactionalSqliteDatabase,
    private readonly targetOrchestrator: AITurnOrchestrator,
    private readonly targetProvider: ProviderConfig,
    private readonly now: () => IsoTimestamp,
  ) {
    this.requests = new PendingAiRequestRepository(database);
    this.generations = new GenerationRecordRepository(database);
    this.profiles = new ModelProfileRepository(database);
  }

  public async recoverTurn(command: RecoverAITurnCommand): Promise<IdempotentCommitResult> {
    const source = this.requests.get(command.sourceRequestId);
    if (
      source === null ||
      source.status !== 'FAILED' ||
      source.turnId === null ||
      source.context === null ||
      source.lastError === null
    ) {
      throw new AIOrchestrationError(
        'FAILED_REQUEST_NOT_RECOVERABLE',
        'A failed turn request with persisted context is required',
      );
    }
    if (source.task !== command.task || !RECOVERABLE_FAILURES.has(source.lastError.code)) {
      throw new AIOrchestrationError(
        'FAILED_REQUEST_NOT_RECOVERABLE',
        'The failed request is not eligible for model retry',
      );
    }

    const sourceGeneration = this.generations.getByRequestId(source.id);
    const sourceProfile =
      sourceGeneration?.modelProfileId === null || sourceGeneration === null
        ? null
        : this.profiles.get(sourceGeneration.modelProfileId);
    const targetProfile = this.profiles.getEnabled(command.targetModelProfileId);
    if (sourceProfile === null || targetProfile === null) {
      throw new AIOrchestrationError(
        'MODEL_PROFILE_MISSING',
        'The source or target model profile is unavailable',
      );
    }
    if (
      targetProfile.providerConfigId !== this.targetProvider.id ||
      targetProfile.providerPresetKey !== this.targetProvider.presetKey ||
      targetProfile.providerType !== this.targetProvider.providerType ||
      targetProfile.modelName !== command.targetModelName
    ) {
      throw new AIOrchestrationError(
        'TARGET_MODEL_MISMATCH',
        'The selected fallback model does not match the target provider',
      );
    }
    if (
      command.selection === 'CONFIGURED_FALLBACK' &&
      this.profiles.getConfiguredFallback()?.id !== targetProfile.id
    ) {
      throw new AIOrchestrationError(
        'FALLBACK_MODEL_MISMATCH',
        'The selected model is not the configured fallback model',
      );
    }
    if (command.selection === 'RETRY_SELECTED_MODEL' && sourceProfile.id !== targetProfile.id) {
      throw new AIOrchestrationError(
        'RETRY_MODEL_MISMATCH',
        'A same-model retry must use the original model profile',
      );
    }

    const switched = sourceProfile.id !== targetProfile.id;
    const crossProvider =
      sourceProfile.providerPresetKey !== targetProfile.providerPresetKey ||
      ((sourceProfile.providerPresetKey === 'custom' ||
        targetProfile.providerPresetKey === 'custom') &&
        sourceProfile.providerConfigId !== targetProfile.providerConfigId);
    if (crossProvider && !command.crossProviderDisclosureAccepted) {
      throw new AIOrchestrationError(
        'CROSS_PROVIDER_DISCLOSURE_REQUIRED',
        'Cross-provider retry requires data-transfer disclosure acceptance',
      );
    }

    return this.targetOrchestrator.execute({
      operationId: aiOperationId(command.idempotencyKey),
      requestId: command.requestId,
      generationRecordId: command.generationRecordId,
      campaignId: source.campaignId,
      turnId: source.turnId,
      idempotencyKey: command.idempotencyKey,
      task: command.task,
      modelProfileId: targetProfile.id,
      modelName: targetProfile.modelName,
      requireSelectedModelProfile: true,
      routeKind: switched ? 'FALLBACK' : 'RETRY',
      routeAttempt: switched ? 1 : 2,
      input: source.input,
      generationOptions: command.generationOptions,
      buildContext: () => source.context,
      validateDomainAndBuildCommit: async (output) => {
        const commit = await command.validateDomainAndBuildCommit(output);
        if (!switched) return commit;
        return {
          ...commit,
          events: [
            ...commit.events,
            {
              id: command.modelSwitchedEventId,
              campaignId: source.campaignId,
              schemaVersion: schemaVersion(1),
              type: 'MODEL_SWITCHED',
              payload: {
                previous: {
                  providerKey: sourceProfile.providerPresetKey,
                  modelName: sourceProfile.modelName,
                },
                current: {
                  providerKey: targetProfile.providerPresetKey,
                  modelName: targetProfile.modelName,
                },
              },
              occurredAt: this.now(),
            },
          ],
        };
      },
    });
  }
}
