import { invoke } from '@tauri-apps/api/core';

import {
  DialogueSuggestionInputSchema,
  DialogueSuggestionOutputSchema,
  type AIProvider,
} from '@ember-tavern/ai-core';
import {
  aiRequestId,
  campaignId,
  generationRecordId,
  idempotencyKey,
} from '@ember-tavern/contracts';
import {
  desktopAIEngine,
  tauriDesktopAIOrchestrator,
  type DesktopAIEngine,
} from './desktop-ai-orchestrator.js';
import {
  balancedRandomnessTemperatureSource,
  tauriRandomnessTemperatureSource,
  type RandomnessTemperatureSource,
} from './randomness-settings-service.js';

export type DialogueSuggestionScopeKind = 'NPC_DIALOGUE' | 'TAVERN_SCENE';

export interface DialogueSuggestionView {
  readonly id: string;
  readonly text: string;
  readonly addressedNpcId: string | null;
}

export interface DialogueSuggestionSet {
  readonly cacheId: string;
  readonly campaignId: string;
  readonly scopeKind: DialogueSuggestionScopeKind;
  readonly scopeId: string;
  readonly contextDigest: string;
  readonly suggestions: readonly DialogueSuggestionView[];
  readonly source: 'CACHE' | 'GENERATED';
  readonly createdAt: string;
}

interface DialogueSuggestionPreparation {
  readonly input: unknown;
  readonly contextDigest: string;
  readonly cached: unknown | null;
}

interface DialogueSuggestionGateway {
  prepare(
    campaignId: string,
    scopeKind: DialogueSuggestionScopeKind,
    scopeId: string,
  ): Promise<DialogueSuggestionPreparation>;
  commit(command: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export const tauriDialogueSuggestionGateway: DialogueSuggestionGateway = {
  async prepare(campaign, scopeKind, scopeId) {
    return invoke<DialogueSuggestionPreparation>('dialogue_suggestions_prepare', {
      command: { campaignId: campaign, scopeKind, scopeId },
    });
  },
  async commit(command) {
    return invoke<unknown>('dialogue_suggestions_commit', { command });
  },
};

export class WindowsDialogueSuggestionService {
  private readonly ai: DesktopAIEngine;

  public constructor(
    private readonly gateway: DialogueSuggestionGateway = tauriDialogueSuggestionGateway,
    provider?: AIProvider | DesktopAIEngine,
    private readonly randomness: RandomnessTemperatureSource = balancedRandomnessTemperatureSource,
  ) {
    this.ai = desktopAIEngine(provider);
  }

  public async load(
    campaign: string,
    scopeKind: DialogueSuggestionScopeKind,
    scopeId: string,
    signal?: AbortSignal,
  ): Promise<DialogueSuggestionSet> {
    campaignId(campaign);
    requireText(scopeId);
    throwIfAborted(signal);
    let preparation: DialogueSuggestionPreparation;
    try {
      preparation = await this.gateway.prepare(campaign, scopeKind, scopeId);
    } catch (error) {
      throw new DialogueSuggestionServiceError('PREPARE_FAILED', { cause: error });
    }
    throwIfAborted(signal);
    const input = DialogueSuggestionInputSchema.parse(preparation.input);
    const digest = requireDigest(preparation.contextDigest);
    if (preparation.cached !== null)
      return parseSet(preparation.cached, campaign, scopeKind, scopeId);

    const suffix = crypto.randomUUID();
    const requestId = aiRequestId(`dialogue-suggestion-request-${suffix}`);
    let generated: Awaited<ReturnType<DesktopAIEngine['execute']>>;
    try {
      generated = await this.ai.execute('GENERATE_DIALOGUE_SUGGESTIONS', input, {
        requestId,
        temperature: await this.randomness.resolveTemperature(),
        maxOutputTokens: 800,
        timeoutMs: 5_000,
      });
    } catch (error) {
      throw new DialogueSuggestionServiceError('GENERATION_FAILED', { cause: error });
    }
    throwIfAborted(signal);
    let output: ReturnType<typeof DialogueSuggestionOutputSchema.parse>;
    try {
      output = DialogueSuggestionOutputSchema.parse(generated.validatedOutput);
    } catch (error) {
      throw new DialogueSuggestionServiceError('SCHEMA_VALIDATION_FAILED', { cause: error });
    }
    throwIfAborted(signal);
    try {
      return parseSet(
        await this.gateway.commit({
          cacheId: `dialogue-suggestion-cache-${suffix}`,
          campaignId: campaign,
          scopeKind,
          scopeId,
          expectedContextDigest: digest,
          generation: {
            requestId,
            generationRecordId: generationRecordId(`dialogue-suggestion-generation-${suffix}`),
            idempotencyKey: idempotencyKey(`dialogue:suggestions:${scopeKind}:${digest}`),
            promptVersion: generated.request.promptVersion,
            input,
            context: { scopeKind, scopeId, contextDigest: digest },
            request: generated.request,
            rawResponseText: generated.response.content,
            validatedOutput: output,
          },
        }),
        campaign,
        scopeKind,
        scopeId,
      );
    } catch (error) {
      throw new DialogueSuggestionServiceError('COMMIT_FAILED', { cause: error });
    }
  }
}

export const dialogueSuggestionService = new WindowsDialogueSuggestionService(
  tauriDialogueSuggestionGateway,
  tauriDesktopAIOrchestrator,
  tauriRandomnessTemperatureSource,
);

export class DialogueSuggestionServiceError extends Error {
  public constructor(
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super('对话建议暂时无法完成。', options);
    this.name = 'DialogueSuggestionServiceError';
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw new DialogueSuggestionServiceError('CANCELLED');
}

function parseSet(
  value: unknown,
  campaign: string,
  scopeKind: DialogueSuggestionScopeKind,
  scopeId: string,
): DialogueSuggestionSet {
  const record = requireRecord(value);
  if (
    record['campaignId'] !== campaign ||
    record['scopeKind'] !== scopeKind ||
    record['scopeId'] !== scopeId
  ) {
    throw new TypeError('Suggestion set belongs to another scope');
  }
  const suggestions = requireArray(record['suggestions']).map((entry) => {
    const suggestion = requireRecord(entry);
    return Object.freeze({
      id: requireText(suggestion['id']),
      text: requireText(suggestion['text']),
      addressedNpcId:
        suggestion['addressedNpcId'] === null ? null : requireText(suggestion['addressedNpcId']),
    });
  });
  if (suggestions.length < 3 || suggestions.length > 5) {
    throw new TypeError('Suggestion count is invalid');
  }
  const source = record['source'];
  if (source !== 'CACHE' && source !== 'GENERATED')
    throw new TypeError('Suggestion source is invalid');
  return Object.freeze({
    cacheId: requireText(record['cacheId']),
    campaignId: campaign,
    scopeKind,
    scopeId,
    contextDigest: requireDigest(record['contextDigest']),
    suggestions: Object.freeze(suggestions),
    source,
    createdAt: requireText(record['createdAt']),
  });
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Suggestion response must be an object');
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError('Suggestion collection is invalid');
  return value;
}

function requireText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new TypeError('Suggestion text is invalid');
  }
  return value;
}

function requireDigest(value: unknown): string {
  const digest = requireText(value);
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new TypeError('Suggestion digest is invalid');
  return digest;
}
