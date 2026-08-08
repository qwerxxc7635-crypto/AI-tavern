import {
  routeModel,
  StandardAIError,
  standardizeAIError,
  validateAIOutput,
  type AIProvider,
  type AITask,
  type ModelCapabilities,
  type NormalizedAIRequest,
  type ProviderConfig,
} from '@ember-tavern/ai-core';
import {
  type AiOperationId,
  type AiRequestError,
  type AiRequestId,
  type CampaignId,
  type GenerationRecordId,
  type IdempotencyKey,
  type IsoTimestamp,
  type JsonValue,
  type ModelProfileId,
  type TurnId,
} from '@ember-tavern/contracts';
import { DomainPatchValidationError } from '@ember-tavern/domain';
import {
  GenerationRecordRepository,
  ModelProfileRepository,
  PendingAiRequestRepository,
  type IdempotentCommitResult,
  type TransactionalSqliteDatabase,
  type TurnCommit,
} from '@ember-tavern/persistence';
import { formatTaskPrompt, type FormattedTaskPrompt } from '@ember-tavern/prompts';

import { AITaskOrchestrator, type AIRouteKind } from './ai-task-orchestrator.js';

export interface AITurnGenerationOptions {
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly minimumContextTokens?: number;
  readonly streaming?: boolean;
  readonly allowTextFallback?: boolean;
}

export interface ExecuteAITurn {
  readonly operationId: AiOperationId;
  readonly requestId: AiRequestId;
  readonly generationRecordId: GenerationRecordId;
  readonly campaignId: CampaignId;
  readonly turnId: TurnId;
  readonly idempotencyKey: IdempotencyKey;
  readonly task: AITask;
  readonly modelProfileId: ModelProfileId | null;
  readonly modelName: string;
  readonly requireSelectedModelProfile?: boolean;
  readonly repairSourceRequestId?: AiRequestId;
  readonly routeKind?: AIRouteKind;
  readonly routeAttempt?: number;
  readonly input: JsonValue;
  readonly generationOptions: AITurnGenerationOptions;
  readonly buildContext: () => unknown | Promise<unknown>;
  readonly formatPrompt?: (
    context: JsonValue,
    capabilities: ModelCapabilities,
  ) => FormattedTaskPrompt;
  readonly validateDomainAndBuildCommit: (output: JsonValue) => TurnCommit | Promise<TurnCommit>;
}

export class AIOrchestrationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AIOrchestrationError';
  }
}

export class AITurnOrchestrator {
  private readonly requests: PendingAiRequestRepository;
  private readonly generations: GenerationRecordRepository;
  private readonly modelProfiles: ModelProfileRepository;

  public constructor(
    database: TransactionalSqliteDatabase,
    private readonly provider: AIProvider,
    private readonly providerConfig: ProviderConfig,
    private readonly now: () => IsoTimestamp,
  ) {
    this.requests = new PendingAiRequestRepository(database);
    this.generations = new GenerationRecordRepository(database);
    this.modelProfiles = new ModelProfileRepository(database);
  }

  public async execute(command: ExecuteAITurn): Promise<IdempotentCommitResult> {
    const pending = this.requests.createOrGet({
      id: command.requestId,
      campaignId: command.campaignId,
      turnId: command.turnId,
      idempotencyKey: command.idempotencyKey,
      task: command.task,
      modelProfileId: command.modelProfileId,
      input: command.input,
      createdAt: this.now(),
    });
    if (pending.status === 'COMMITTED') return 'ALREADY_COMMITTED';
    if (pending.status !== 'CREATED') {
      throw new AIOrchestrationError(
        'REQUEST_NOT_READY',
        `Pending AI request cannot start from ${pending.status}`,
      );
    }

    let context: JsonValue;
    try {
      context = toJsonValue(await command.buildContext(), '$context');
      this.requests.setContext(command.requestId, context, this.now());
    } catch (error) {
      this.failPending(command.requestId, {
        code: 'CONTEXT_BUILD_FAILED',
        message: 'AI context construction failed',
        retryable: false,
      });
      throw new AIOrchestrationError('CONTEXT_BUILD_FAILED', 'AI context construction failed', {
        cause: error,
      });
    }

    let request: NormalizedAIRequest;
    let selectedModelProfileId: ModelProfileId;
    try {
      const enabledProfiles = this.modelProfiles.listEnabled(this.providerConfig.id);
      const profiles = command.requireSelectedModelProfile
        ? enabledProfiles.filter((profile) => profile.id === command.modelProfileId)
        : enabledProfiles;
      const ordered = [...profiles].sort((left, right) => {
        const leftPreferred =
          left.id === command.modelProfileId || left.modelName === command.modelName;
        const rightPreferred =
          right.id === command.modelProfileId || right.modelName === command.modelName;
        return Number(rightPreferred) - Number(leftPreferred);
      });
      let decision: ReturnType<typeof routeModel>;
      try {
        decision = routeModel(
          ordered.map((profile) => ({
            name: profile.modelName,
            displayName: profile.displayName,
            capabilities: profile.capabilities,
          })),
          {
            minimumContextTokens: command.generationOptions.minimumContextTokens ?? 0,
            streaming: command.generationOptions.streaming ?? false,
            structuredOutput: true,
            allowTextFallback: command.generationOptions.allowTextFallback ?? true,
          },
        );
      } catch (error) {
        if (error instanceof RangeError) {
          throw new AIOrchestrationError(
            'NO_MODEL_CANDIDATE',
            'No registered model satisfies the AI task requirements',
            { cause: error },
          );
        }
        throw error;
      }
      const selectedProfile = ordered.find((profile) => profile.modelName === decision.model.name);
      if (selectedProfile === undefined) {
        throw new AIOrchestrationError(
          'MODEL_PROFILE_MISSING',
          'The routed model profile is unavailable',
        );
      }
      selectedModelProfileId = selectedProfile.id;
      const formatted =
        command.formatPrompt?.(context, decision.model.capabilities) ??
        formatTaskPrompt(command.task, context, decision.model.capabilities);
      request = Object.freeze({
        requestId: command.requestId,
        task: command.task,
        promptVersion: formatted.promptVersion,
        modelName: decision.model.name,
        messages: formatted.messages,
        responseFormat: formatted.responseFormat,
        temperature: command.generationOptions.temperature,
        maxOutputTokens: command.generationOptions.maxOutputTokens,
        timeoutMs: command.generationOptions.timeoutMs,
      });
    } catch (error) {
      this.failPending(command.requestId, {
        code: error instanceof AIOrchestrationError ? error.code : 'PROMPT_BUILD_FAILED',
        message: 'AI request preparation failed',
        retryable: false,
      });
      if (error instanceof AIOrchestrationError) throw error;
      throw new AIOrchestrationError('PROMPT_BUILD_FAILED', 'AI request preparation failed', {
        cause: error,
      });
    }

    this.generations.create({
      id: command.generationRecordId,
      campaignId: command.campaignId,
      requestId: command.requestId,
      task: command.task,
      modelProfileId: selectedModelProfileId,
      promptVersion: request.promptVersion,
      request: requestJson(
        request,
        context,
        command.operationId,
        command.routeKind ?? 'PRIMARY',
        command.routeAttempt ?? 1,
        command.repairSourceRequestId,
      ),
      startedAt: this.now(),
    });
    this.requests.startAttempt(command.requestId, this.now());

    let rawResponseText: string;
    try {
      const response = (
        await new AITaskOrchestrator(this.provider, this.providerConfig).execute({
          operationId: command.operationId,
          requestId: command.requestId,
          taskType: command.task,
          campaignId: command.campaignId,
          actorId: null,
          route: {
            kind: command.routeKind ?? 'PRIMARY',
            attempt: command.routeAttempt ?? 1,
            providerId: this.providerConfig.id,
            modelProfileId: selectedModelProfileId,
            modelName: request.modelName,
          },
          providerRequest: request,
        })
      ).response;
      rawResponseText = response.content;
      this.requests.markReceived(command.requestId, this.now());
      this.requests.markValidating(command.requestId, this.now());
    } catch (error) {
      const providerError = standardizeAIError(error);
      const validationError = generationError(providerError.code, 'Provider request failed');
      this.generations.complete(command.generationRecordId, {
        rawResponseText: null,
        validatedOutput: null,
        validationError,
        completedAt: this.now(),
      });
      this.failPending(command.requestId, {
        code: providerError.code,
        message: 'Provider request failed',
        retryable: providerError.retryable,
      });
      throw new AIOrchestrationError(providerError.code, 'Provider request failed', {
        cause: providerError,
      });
    }

    const structural = validateAIOutput(command.task, rawResponseText);
    if (!structural.ok) {
      const outputError = new StandardAIError('INVALID_OUTPUT');
      this.generations.complete(command.generationRecordId, {
        rawResponseText,
        validatedOutput: null,
        validationError: structural.error,
        completedAt: this.now(),
      });
      this.failPending(command.requestId, {
        code: outputError.code,
        message: 'AI output structure validation failed',
        retryable: outputError.retryable,
      });
      throw new AIOrchestrationError(outputError.code, 'AI output structure validation failed', {
        cause: outputError,
      });
    }

    let commit: TurnCommit;
    try {
      commit = await command.validateDomainAndBuildCommit(structural.validatedOutput);
    } catch (error) {
      const validationError =
        error instanceof DomainPatchValidationError
          ? {
              code: error.code,
              issues: [
                {
                  path: [error.patchIndex, ...error.path],
                  code: error.code,
                  message: error.message,
                },
              ],
            }
          : generationError('DOMAIN_VALIDATION_FAILED', 'Domain validation failed');
      this.generations.complete(command.generationRecordId, {
        rawResponseText,
        validatedOutput: null,
        validationError,
        completedAt: this.now(),
      });
      this.failPending(command.requestId, {
        code: 'DOMAIN_VALIDATION_FAILED',
        message: 'AI domain validation failed',
        retryable: false,
      });
      throw new AIOrchestrationError('DOMAIN_VALIDATION_FAILED', 'AI domain validation failed', {
        cause: error,
      });
    }

    this.generations.complete(command.generationRecordId, {
      rawResponseText,
      validatedOutput: structural.validatedOutput,
      validationError: null,
      completedAt: this.now(),
    });
    try {
      return this.requests.commitTurnOnce(command.idempotencyKey, commit, this.now());
    } catch (error) {
      this.failPending(command.requestId, {
        code: 'COMMIT_FAILED',
        message: 'Validated AI turn commit failed',
        retryable: false,
      });
      throw new AIOrchestrationError('COMMIT_FAILED', 'Validated AI turn commit failed', {
        cause: error,
      });
    }
  }

  private failPending(id: AiRequestId, error: AiRequestError): void {
    this.requests.fail(id, error, this.now());
  }
}

function requestJson(
  request: NormalizedAIRequest,
  context: JsonValue,
  operationId: AiOperationId,
  routeKind: AIRouteKind,
  routeAttempt: number,
  repairSourceRequestId: AiRequestId | undefined,
): JsonValue {
  return Object.freeze({
    requestId: request.requestId,
    operationId,
    routeKind,
    routeAttempt,
    task: request.task,
    promptVersion: request.promptVersion,
    modelName: request.modelName,
    messages: request.messages.map(({ role, content }) => ({ role, content })),
    responseFormat:
      request.responseFormat.kind === 'JSON_SCHEMA'
        ? {
            kind: request.responseFormat.kind,
            name: request.responseFormat.name,
            schema: request.responseFormat.schema,
          }
        : { kind: request.responseFormat.kind },
    temperature: request.temperature,
    maxOutputTokens: request.maxOutputTokens,
    timeoutMs: request.timeoutMs,
    context,
    ...(repairSourceRequestId === undefined ? {} : { repairSourceRequestId }),
  });
}

function generationError(code: string, message: string) {
  return Object.freeze({
    code,
    issues: Object.freeze([
      Object.freeze({
        path: Object.freeze([]),
        code,
        message,
      }),
    ]),
  });
}

function toJsonValue(value: unknown, path: string): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry, index) => toJsonValue(entry, `${path}[${index}]`)));
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must contain plain JSON objects`);
    }
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, toJsonValue(entry, `${path}.${key}`)]),
      ),
    );
  }
  throw new TypeError(`${path} must contain only finite JSON values`);
}
