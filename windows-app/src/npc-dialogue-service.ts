import { invoke } from '@tauri-apps/api/core';

import {
  FakeAIProvider,
  NpcReplyInputSchema,
  NpcReplyOutputSchema,
  validateAIOutput,
  type AIProvider,
  type NormalizedAIRequest,
  type ProviderConfig,
} from '@ember-tavern/ai-core';
import {
  aiRequestId,
  campaignId,
  generationRecordId,
  idempotencyKey,
  isoTimestamp,
} from '@ember-tavern/contracts';
import { formatTaskPrompt } from '@ember-tavern/prompts';
import {
  balancedRandomnessTemperatureSource,
  tauriRandomnessTemperatureSource,
  type RandomnessTemperatureSource,
} from './randomness-settings-service.js';

export interface DialogueNpcView {
  readonly id: string;
  readonly name: string;
  readonly identity: string;
  readonly appearance: string;
  readonly personality: string;
  readonly currentMood: string;
}

export interface DialogueRelationshipView {
  readonly trust: number;
  readonly closeness: number;
  readonly awe: number;
  readonly obligation: number;
}

export interface DialogueMessageView {
  readonly id: string;
  readonly sequenceNumber: number;
  readonly role: 'PLAYER' | 'NPC';
  readonly content: string;
  readonly createdAt: string;
}

export interface NpcDialogueSnapshot {
  readonly campaignId: string;
  readonly conversationId: string | null;
  readonly npc: DialogueNpcView;
  readonly relationship: DialogueRelationshipView;
  readonly messages: readonly DialogueMessageView[];
  readonly suggestedTopics: readonly string[];
  readonly generationContext: Readonly<Record<string, unknown>>;
}

interface GenerationAudit {
  readonly requestId: string;
  readonly generationRecordId: string;
  readonly idempotencyKey: string;
  readonly promptVersion: number;
  readonly input: unknown;
  readonly context: unknown;
  readonly request: unknown;
  readonly rawResponseText: string;
  readonly validatedOutput: unknown;
}

interface DialogueCommit {
  readonly campaignId: string;
  readonly npcId: string;
  readonly playerMessage: string;
  readonly generation: GenerationAudit;
}

export interface NpcDialogueGateway {
  load(campaignId: string, npcId: string): Promise<NpcDialogueSnapshot>;
  commit(command: DialogueCommit): Promise<NpcDialogueSnapshot>;
}

interface RequestIdentity {
  readonly requestId: string;
  readonly generationRecordId: string;
  readonly idempotencyKey: string;
}

const PROVIDER_CONFIG: ProviderConfig = Object.freeze({
  id: 'windows-offline-fake',
  providerType: 'LOCAL_OPENAI_COMPATIBLE',
  presetKey: 'custom',
  displayName: 'Ember Fake',
  baseUrl: null,
  credentialRef: null,
  options: {},
  enabled: true,
});

export const tauriNpcDialogueGateway: NpcDialogueGateway = {
  async load(campaign, npc) {
    return parseSnapshot(
      await invoke<unknown>('npc_dialogue_get', { campaignId: campaign, npcId: npc }),
      campaign,
      npc,
    );
  },
  async commit(command) {
    return parseSnapshot(
      await invoke<unknown>('npc_dialogue_commit', { command }),
      command.campaignId,
      command.npcId,
    );
  },
};

export class WindowsNpcDialogueService {
  public constructor(
    private readonly gateway: NpcDialogueGateway = tauriNpcDialogueGateway,
    private readonly provider: AIProvider = new FakeAIProvider(),
    private readonly createIdentity: () => RequestIdentity = defaultIdentity,
    private readonly randomness: RandomnessTemperatureSource = balancedRandomnessTemperatureSource,
  ) {}

  public load(campaign: string, npc: string): Promise<NpcDialogueSnapshot> {
    campaignId(campaign);
    requireText(npc);
    return this.gateway.load(campaign, npc);
  }

  public async send(
    campaign: string,
    npc: string,
    playerMessage: string,
  ): Promise<NpcDialogueSnapshot> {
    const snapshot = await this.load(campaign, npc);
    const input = NpcReplyInputSchema.parse({
      ...snapshot.generationContext,
      playerMessage,
    });
    const identity = this.createIdentity();
    const model = (await this.provider.listModels()).find(({ name }) => name === 'ember-fake-v1');
    if (model === undefined) throw new NpcDialogueServiceError('MODEL_NOT_FOUND');
    const prompt = formatTaskPrompt('NPC_REPLY', input, model.capabilities);
    const temperature = await this.randomness.resolveTemperature();
    const request: NormalizedAIRequest = {
      requestId: aiRequestId(identity.requestId),
      task: 'NPC_REPLY',
      promptVersion: prompt.promptVersion,
      modelName: model.name,
      messages: prompt.messages,
      responseFormat: prompt.responseFormat,
      temperature,
      maxOutputTokens: 2_000,
      timeoutMs: 5_000,
    };
    const response = await this.provider.generate(request, PROVIDER_CONFIG);
    if (response.requestId !== request.requestId || response.modelName !== request.modelName) {
      throw new NpcDialogueServiceError('PROVIDER_IDENTITY_MISMATCH');
    }
    const validated = validateAIOutput('NPC_REPLY', response.content);
    if (!validated.ok) throw new NpcDialogueServiceError(validated.error.code);
    const output = NpcReplyOutputSchema.parse(validated.validatedOutput);
    return this.gateway.commit({
      campaignId: campaign,
      npcId: npc,
      playerMessage: input.playerMessage,
      generation: {
        ...identity,
        promptVersion: request.promptVersion,
        input,
        context: { npcId: npc },
        request,
        rawResponseText: response.content,
        validatedOutput: output,
      },
    });
  }
}

export const windowsNpcDialogueService = new WindowsNpcDialogueService(
  tauriNpcDialogueGateway,
  new FakeAIProvider(),
  defaultIdentity,
  tauriRandomnessTemperatureSource,
);

export class NpcDialogueServiceError extends Error {
  public constructor(public readonly code: string) {
    super('NPC dialogue operation failed');
    this.name = 'NpcDialogueServiceError';
  }
}

function defaultIdentity(): RequestIdentity {
  const suffix = crypto.randomUUID();
  return {
    requestId: aiRequestId(`dialogue-request-${suffix}`),
    generationRecordId: generationRecordId(`dialogue-generation-${suffix}`),
    idempotencyKey: idempotencyKey(`dialogue:npc-reply:${suffix}`),
  };
}

function parseSnapshot(
  value: unknown,
  expectedCampaignId: string,
  expectedNpcId: string,
): NpcDialogueSnapshot {
  const record = requireRecord(value);
  const npc = requireRecord(record['npc']);
  const relationship = requireRecord(record['relationship']);
  const storedCampaign = campaignId(requireText(record['campaignId']));
  const storedNpc = requireText(npc['id']);
  if (storedCampaign !== expectedCampaignId || storedNpc !== expectedNpcId) {
    throw new TypeError('Dialogue belongs to another scope');
  }
  return Object.freeze({
    campaignId: storedCampaign,
    conversationId: nullableText(record['conversationId']),
    npc: Object.freeze({
      id: storedNpc,
      name: requireText(npc['name']),
      identity: requireText(npc['identity']),
      appearance: requireText(npc['appearance']),
      personality: requireText(npc['personality']),
      currentMood: requireText(npc['currentMood']),
    }),
    relationship: Object.freeze({
      trust: score(relationship['trust']),
      closeness: score(relationship['closeness']),
      awe: score(relationship['awe']),
      obligation: score(relationship['obligation']),
    }),
    messages: Object.freeze(requireArray(record['messages']).map(parseMessage)),
    suggestedTopics: Object.freeze(requireArray(record['suggestedTopics']).map(requireText)),
    generationContext: Object.freeze({ ...requireRecord(record['generationContext']) }),
  });
}

function parseMessage(value: unknown): DialogueMessageView {
  const record = requireRecord(value);
  const role = requireText(record['role']);
  if (role !== 'PLAYER' && role !== 'NPC') throw new TypeError('Dialogue role is invalid');
  const sequenceNumber = integer(record['sequenceNumber']);
  if (sequenceNumber < 1) throw new TypeError('Dialogue sequence is invalid');
  return Object.freeze({
    id: requireText(record['id']),
    sequenceNumber,
    role,
    content: requireText(record['content']),
    createdAt: isoTimestamp(requireText(record['createdAt'])),
  });
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Native dialogue response must be an object');
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError('Native dialogue collection is invalid');
  return value;
}

function requireText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new TypeError('Dialogue text is invalid');
  }
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : requireText(value);
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError('Dialogue number is invalid');
  }
  return value;
}

function score(value: unknown): number {
  const parsed = integer(value);
  if (parsed < -5 || parsed > 5) throw new TypeError('Relationship score is invalid');
  return parsed;
}
