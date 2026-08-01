import { isoTimestamp, type IsoTimestamp } from '@ember-tavern/contracts';

import { AI_TASK_SCHEMAS } from './task-schema-registry.js';
import { FAKE_TASK_OUTPUTS } from './fake-task-outputs.js';
import type {
  AIProvider,
  ModelInfo,
  NormalizedAIRequest,
  NormalizedAIResponse,
  ProviderConfig,
  TestResult,
} from './protocol.js';

const deterministicTime = isoTimestamp('2000-01-01T00:00:00.000Z');
const fakeModel = Object.freeze({
  name: 'ember-fake-v1',
  displayName: 'Ember Fake v1',
  capabilities: Object.freeze({
    text: true,
    streaming: false,
    systemMessages: true,
    jsonMode: true,
    jsonSchema: true,
    toolCalling: false,
    reasoning: false,
    contextWindowTokens: 32_768,
    costStatus: 'FREE',
    checkedAt: deterministicTime,
  }),
}) satisfies ModelInfo;

export class FakeAIProviderError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'FakeAIProviderError';
  }
}

export class FakeAIProvider implements AIProvider {
  public readonly id = 'fake';

  public constructor(private readonly now: () => IsoTimestamp = () => deterministicTime) {}

  public async listModels(): Promise<readonly ModelInfo[]> {
    return [fakeModel];
  }

  public async testConnection(config: ProviderConfig): Promise<TestResult> {
    if (!config.enabled) {
      return {
        ok: false,
        latencyMs: 0,
        errorCode: 'UNSUPPORTED',
        message: 'Fake provider config is disabled',
      };
    }
    return { ok: true, latencyMs: 0 };
  }

  public async generate(
    request: NormalizedAIRequest,
    config: ProviderConfig,
  ): Promise<NormalizedAIResponse> {
    if (!config.enabled) throw new FakeAIProviderError('Fake provider config is disabled');
    if (request.modelName !== fakeModel.name) {
      throw new FakeAIProviderError(`Unknown fake model: ${request.modelName}`);
    }
    const output = AI_TASK_SCHEMAS[request.task].output.parse(fakeOutput(request));
    return Object.freeze({
      requestId: request.requestId,
      providerRequestId: `fake:${request.requestId}`,
      modelName: fakeModel.name,
      content: JSON.stringify(output),
      finishReason: 'STOP',
      usage: Object.freeze({
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      }),
      receivedAt: this.now(),
    });
  }
}

function fakeOutput(request: NormalizedAIRequest): unknown {
  const base = FAKE_TASK_OUTPUTS[request.task];
  if (request.task !== 'GENERATE_ADVENTURE_TURN') return base;
  const adventureBase = FAKE_TASK_OUTPUTS.GENERATE_ADVENTURE_TURN;
  const input = taskInput(request);
  if (input === undefined) return base;
  const currentTurnNumber = input['currentTurnNumber'];
  const plan = input['adventurePlan'];
  const planRecord = isRecord(plan) ? plan : undefined;
  const expectedTurns = isRecord(planRecord?.['expectedTurns'])
    ? planRecord['expectedTurns']
    : undefined;
  const minimumTurns = expectedTurns === undefined ? undefined : expectedTurns['min'];
  if (typeof currentTurnNumber !== 'number' || typeof minimumTurns !== 'number') return base;
  const nextTurnNumber = currentTurnNumber + 1;
  if (nextTurnNumber < minimumTurns) {
    const requiresCheck = [1, 3, 6].includes(nextTurnNumber);
    const clueByTurn: Readonly<Record<number, string>> = {
      1: 'Scorched Lens',
      3: 'Tide Ledger',
      6: 'Keeper Signet',
    };
    return requiresCheck
      ? {
          ...adventureBase,
          discoveredClues:
            clueByTurn[nextTurnNumber] === undefined ? [] : [clueByTurn[nextTurnNumber]],
          statePatchProposals: nextTurnNumber === 1 ? adventureBase.statePatchProposals : [],
        }
      : {
          ...adventureBase,
          sceneText: 'The trail opens onto a quiet landing where careful observation is enough.',
          checkRequest: null,
          discoveredClues: [],
          statePatchProposals: [],
          adventureState: 'SCENE',
        };
  }
  return {
    ...adventureBase,
    sceneText: 'The beacon catches and holds as the storm breaks beyond the harbor wall.',
    suggestedActions: [],
    checkRequest: null,
    discoveredClues: [],
    statePatchProposals: [],
    adventureState: 'ENDING',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function taskInput(request: NormalizedAIRequest): Record<string, unknown> | undefined {
  const message = [...request.messages].reverse().find(({ role }) => role === 'USER');
  if (message === undefined) return undefined;
  const marker = 'Task input JSON:\n';
  const offset = message.content.lastIndexOf(marker);
  if (offset < 0) return undefined;
  const value: unknown = JSON.parse(message.content.slice(offset + marker.length));
  if (!isRecord(value)) {
    throw new FakeAIProviderError('Fake task input must be an object');
  }
  return value;
}
