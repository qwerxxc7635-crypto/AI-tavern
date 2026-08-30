import { invoke } from '@tauri-apps/api/core';

import {
  GenerateQuestInputSchema,
  GenerateQuestOutputSchema,
  hasRepeatedQuestStructure,
  type AIProvider,
} from '@ember-tavern/ai-core';
import {
  DYNAMIC_QUEST_SOURCE_KINDS,
  aiRequestId,
  campaignId,
  generationRecordId,
  idempotencyKey,
  type DynamicQuestPreparation,
  type DynamicQuestSourceKind,
} from '@ember-tavern/contracts';

import {
  desktopAIEngine,
  tauriDesktopAIOrchestrator,
  type DesktopAIEngine,
} from './desktop-ai-orchestrator.js';
import { parseQuestBoardSnapshot, type QuestBoardSnapshot } from './quest-board-service.js';
import {
  balancedRandomnessTemperatureSource,
  tauriRandomnessTemperatureSource,
  type RandomnessTemperatureSource,
} from './randomness-settings-service.js';

interface DynamicQuestIdentity {
  readonly requestId: string;
  readonly generationRecordId: string;
}

interface DynamicQuestSourceCommand {
  readonly campaignId: string;
  readonly sourceKind: DynamicQuestSourceKind;
  readonly occurrenceId: string;
}

export interface DynamicQuestSourceGateway {
  prepare(command: DynamicQuestSourceCommand): Promise<DynamicQuestPreparation>;
  commit(command: Readonly<Record<string, unknown>>): Promise<QuestBoardSnapshot>;
  load(campaignIdValue: string): Promise<QuestBoardSnapshot>;
}

export const tauriDynamicQuestSourceGateway: DynamicQuestSourceGateway = {
  async prepare(command) {
    return parsePreparation(await invoke<unknown>('dynamic_quest_prepare', { command }), command);
  },
  async commit(command) {
    const campaignIdValue = requireText(command['campaignId'], 'Dynamic Quest campaign');
    return parseQuestBoardSnapshot(
      await invoke<unknown>('dynamic_quest_commit', { command }),
      campaignIdValue,
    );
  },
  async load(campaignIdValue) {
    return parseQuestBoardSnapshot(
      await invoke<unknown>('quest_board_get', { campaignId: campaignIdValue }),
      campaignIdValue,
    );
  },
};

export class DynamicQuestSourceService {
  private readonly ai: DesktopAIEngine;
  private readonly active = new Map<string, Promise<QuestBoardSnapshot>>();

  public constructor(
    private readonly gateway: DynamicQuestSourceGateway = tauriDynamicQuestSourceGateway,
    provider?: AIProvider | DesktopAIEngine,
    private readonly createIdentity: () => DynamicQuestIdentity = defaultIdentity,
    private readonly randomness: RandomnessTemperatureSource = balancedRandomnessTemperatureSource,
  ) {
    this.ai = desktopAIEngine(provider);
  }

  public createFromSource(
    campaignIdValue: string,
    sourceKind: DynamicQuestSourceKind,
    occurrenceId: string,
  ): Promise<QuestBoardSnapshot> {
    campaignId(campaignIdValue);
    if (!DYNAMIC_QUEST_SOURCE_KINDS.includes(sourceKind)) {
      throw new DynamicQuestSourceServiceError('SOURCE_KIND_INVALID');
    }
    requireText(occurrenceId, 'Dynamic Quest occurrence');
    if ([...occurrenceId].length > 200) {
      throw new DynamicQuestSourceServiceError('SOURCE_OCCURRENCE_INVALID');
    }
    const key = `${campaignIdValue}:${sourceKind}:${occurrenceId}`;
    const existing = this.active.get(key);
    if (existing !== undefined) return existing;
    const operation = this.perform({
      campaignId: campaignIdValue,
      sourceKind,
      occurrenceId,
    }).finally(() => {
      if (this.active.get(key) === operation) this.active.delete(key);
    });
    this.active.set(key, operation);
    return operation;
  }

  private async perform(command: DynamicQuestSourceCommand): Promise<QuestBoardSnapshot> {
    let prepared: DynamicQuestPreparation;
    try {
      prepared = await this.gateway.prepare(command);
    } catch (error) {
      throw new DynamicQuestSourceServiceError('PREPARE_FAILED', { cause: error });
    }
    if (prepared.existingQuestId !== null) return this.gateway.load(command.campaignId);
    const input = GenerateQuestInputSchema.parse(prepared.input);
    const identity = this.createIdentity();
    let generated: Awaited<ReturnType<DesktopAIEngine['execute']>>;
    try {
      generated = await this.ai.execute('GENERATE_QUEST', input, {
        requestId: identity.requestId,
        temperature: await this.randomness.resolveTemperature(),
        maxOutputTokens: 4_000,
        timeoutMs: 5_000,
      });
    } catch (error) {
      throw new DynamicQuestSourceServiceError('GENERATION_FAILED', { cause: error });
    }
    let output: ReturnType<typeof GenerateQuestOutputSchema.parse>;
    try {
      output = GenerateQuestOutputSchema.parse(generated.validatedOutput);
      if (hasRepeatedQuestStructure(output, input.recentQuestStructures)) {
        throw new DynamicQuestSourceServiceError('REPETITION_DETECTED');
      }
    } catch (error) {
      if (error instanceof DynamicQuestSourceServiceError) throw error;
      throw new DynamicQuestSourceServiceError('SCHEMA_VALIDATION_FAILED', { cause: error });
    }
    try {
      return await this.gateway.commit({
        ...command,
        expectedContextDigest: prepared.contextDigest,
        generation: {
          ...identity,
          idempotencyKey: idempotencyKey(
            `quest:dynamic:${command.sourceKind.toLowerCase()}:${command.occurrenceId}`,
          ),
          promptVersion: generated.request.promptVersion,
          input,
          context: {
            campaignId: command.campaignId,
            sourceKind: command.sourceKind,
            occurrenceId: command.occurrenceId,
            contextDigest: prepared.contextDigest,
          },
          request: generated.request,
          rawResponseText: generated.response.content,
          validatedOutput: output,
        },
      });
    } catch (error) {
      throw new DynamicQuestSourceServiceError('COMMIT_FAILED', { cause: error });
    }
  }
}

export const dynamicQuestSourceService = new DynamicQuestSourceService(
  tauriDynamicQuestSourceGateway,
  tauriDesktopAIOrchestrator,
  defaultIdentity,
  tauriRandomnessTemperatureSource,
);

export class DynamicQuestSourceServiceError extends Error {
  public constructor(
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super('Dynamic Quest source operation failed', options);
    this.name = 'DynamicQuestSourceServiceError';
  }
}

function defaultIdentity(): DynamicQuestIdentity {
  const suffix = crypto.randomUUID();
  return {
    requestId: aiRequestId(`dynamic-quest-request-${suffix}`),
    generationRecordId: generationRecordId(`dynamic-quest-generation-${suffix}`),
  };
}

function parsePreparation(
  value: unknown,
  expected: DynamicQuestSourceCommand,
): DynamicQuestPreparation {
  const record = requireRecord(value);
  if (
    campaignId(requireText(record['campaignId'], 'Dynamic Quest campaign')) !==
      expected.campaignId ||
    requireRecord(record['source'])['kind'] !== expected.sourceKind ||
    requireRecord(record['source'])['occurrenceId'] !== expected.occurrenceId
  ) {
    throw new TypeError('Dynamic Quest preparation belongs to another source');
  }
  const digest = requireText(record['contextDigest'], 'Dynamic Quest context digest');
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new TypeError('Dynamic Quest context digest is invalid');
  }
  GenerateQuestInputSchema.parse(record['input']);
  const existingQuestId = record['existingQuestId'];
  if (existingQuestId !== null) requireText(existingQuestId, 'Dynamic Quest existing quest');
  return value as DynamicQuestPreparation;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Dynamic Quest value must be an object');
  }
  return value as Record<string, unknown>;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
