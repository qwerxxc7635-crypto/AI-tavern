import { invoke } from '@tauri-apps/api/core';

import {
  FakeAIProvider,
  GenerateQuestInputSchema,
  GenerateQuestOutputSchema,
  hasRepeatedQuestStructure,
  questStructureSignature,
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

export interface QuestNpcBrief {
  readonly id: string;
  readonly name: string;
  readonly identity: string;
  readonly personality: string;
  readonly goal: string;
  readonly currentMood: string;
}

export interface QuestGenerationSource {
  readonly tavernId: string;
  readonly tavernName: string;
  readonly playerCharacterId: string;
  readonly playerConcept: string;
  readonly world: {
    readonly name: string;
    readonly currentRegion: string;
    readonly summary: string;
    readonly coreConflict: string;
    readonly technologyLevel: string;
    readonly powerRules: readonly string[];
  };
  readonly availableNpcs: readonly QuestNpcBrief[];
  readonly recentQuestTitles: readonly string[];
  readonly recentQuestStructures: readonly string[];
}

export interface QuestView {
  readonly id: string;
  readonly publisherNpcId: string;
  readonly publisherName: string;
  readonly content: {
    readonly title: string;
    readonly summary: string;
    readonly objective: string;
    readonly failureCost: string;
  };
  readonly status: 'AVAILABLE' | 'ACCEPTED' | 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'ABANDONED';
  readonly risk: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME';
  readonly recommendedAttributes: readonly ('physique' | 'agility' | 'knowledge' | 'charisma')[];
  readonly expectedTurnsMin: number;
  readonly expectedTurnsMax: number;
  readonly rewardTier: 'BASIC' | 'NOTABLE' | 'RARE' | 'LEGENDARY';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface QuestBoardSnapshot {
  readonly campaignId: string;
  readonly campaignState: string;
  readonly source: QuestGenerationSource;
  readonly quests: readonly QuestView[];
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

interface QuestGenerationCommit {
  readonly campaignId: string;
  readonly publisherNpcId: string;
  readonly generation: GenerationAudit;
}

export interface QuestBoardGateway {
  load(campaignId: string): Promise<QuestBoardSnapshot>;
  commit(command: QuestGenerationCommit): Promise<QuestBoardSnapshot>;
  accept(campaignId: string, questId: string): Promise<QuestBoardSnapshot>;
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

export const tauriQuestBoardGateway: QuestBoardGateway = {
  async load(id) {
    return parseSnapshot(await invoke<unknown>('quest_board_get', { campaignId: id }), id);
  },
  async commit(command) {
    return parseSnapshot(
      await invoke<unknown>('quest_generation_commit', { command }),
      command.campaignId,
    );
  },
  async accept(id, questId) {
    return parseSnapshot(await invoke<unknown>('quest_accept', { campaignId: id, questId }), id);
  },
};

export class WindowsQuestBoardService {
  private readonly initializations = new Map<string, Promise<QuestBoardSnapshot>>();

  public constructor(
    private readonly gateway: QuestBoardGateway = tauriQuestBoardGateway,
    private readonly provider: AIProvider = new FakeAIProvider(),
    private readonly createIdentity: () => RequestIdentity = defaultIdentity,
    private readonly randomness: RandomnessTemperatureSource = balancedRandomnessTemperatureSource,
  ) {}

  public load(id: string): Promise<QuestBoardSnapshot> {
    campaignId(id);
    return this.gateway.load(id);
  }

  public async initialize(id: string): Promise<QuestBoardSnapshot> {
    campaignId(id);
    const existing = this.initializations.get(id);
    if (existing !== undefined) return existing;
    const operation = this.initializeOnce(id);
    this.initializations.set(id, operation);
    try {
      return await operation;
    } finally {
      if (this.initializations.get(id) === operation) this.initializations.delete(id);
    }
  }

  public accept(id: string, questId: string): Promise<QuestBoardSnapshot> {
    campaignId(id);
    requireText(questId);
    return this.gateway.accept(id, questId);
  }

  private async initializeOnce(id: string): Promise<QuestBoardSnapshot> {
    let snapshot = await this.gateway.load(id);
    if (snapshot.campaignState !== 'TAVERN') {
      throw new QuestBoardServiceError('CAMPAIGN_STATE_INVALID');
    }
    while (snapshot.quests.length < 2) {
      const publisher =
        snapshot.source.availableNpcs[
          snapshot.quests.length % snapshot.source.availableNpcs.length
        ];
      if (publisher === undefined) throw new QuestBoardServiceError('QUEST_PUBLISHER_MISSING');
      const input = GenerateQuestInputSchema.parse({
        world: snapshot.source.world,
        tavernName: snapshot.source.tavernName,
        publisher,
        availableNpcs: snapshot.source.availableNpcs,
        playerConcept: snapshot.source.playerConcept,
        recentQuestTitles: snapshot.source.recentQuestTitles,
        recentQuestStructures: snapshot.source.recentQuestStructures,
      });
      snapshot = await this.gateway.commit({
        campaignId: id,
        publisherNpcId: publisher.id,
        generation: await this.generate(input, snapshot.source, publisher.id),
      });
    }
    return snapshot;
  }

  private async generate(
    input: unknown,
    source: QuestGenerationSource,
    publisherNpcId: string,
  ): Promise<GenerationAudit> {
    const identity = this.createIdentity();
    const model = (await this.provider.listModels()).find(({ name }) => name === 'ember-fake-v1');
    if (model === undefined) throw new QuestBoardServiceError('MODEL_NOT_FOUND');
    const prompt = formatTaskPrompt('GENERATE_QUEST', input, model.capabilities);
    const temperature = await this.randomness.resolveTemperature();
    const request: NormalizedAIRequest = {
      requestId: aiRequestId(identity.requestId),
      task: 'GENERATE_QUEST',
      promptVersion: prompt.promptVersion,
      modelName: model.name,
      messages: prompt.messages,
      responseFormat: prompt.responseFormat,
      temperature,
      maxOutputTokens: 4_000,
      timeoutMs: 5_000,
    };
    const response = await this.provider.generate(request, PROVIDER_CONFIG);
    if (response.requestId !== request.requestId || response.modelName !== request.modelName) {
      throw new QuestBoardServiceError('PROVIDER_IDENTITY_MISMATCH');
    }
    const validated = validateAIOutput('GENERATE_QUEST', response.content);
    if (!validated.ok) throw new QuestBoardServiceError(validated.error.code);
    const output = GenerateQuestOutputSchema.parse(validated.validatedOutput);
    const sourceInput = GenerateQuestInputSchema.parse(input);
    if (hasRepeatedQuestStructure(output, sourceInput.recentQuestStructures)) {
      throw new QuestBoardServiceError('REPETITION_DETECTED');
    }
    return {
      ...identity,
      promptVersion: request.promptVersion,
      input,
      context: {
        tavernId: source.tavernId,
        playerCharacterId: source.playerCharacterId,
        publisherNpcId,
      },
      request,
      rawResponseText: response.content,
      validatedOutput: output,
    };
  }
}

export const windowsQuestBoardService = new WindowsQuestBoardService(
  tauriQuestBoardGateway,
  new FakeAIProvider(),
  defaultIdentity,
  tauriRandomnessTemperatureSource,
);

export class QuestBoardServiceError extends Error {
  public constructor(public readonly code: string) {
    super('Quest board operation failed');
    this.name = 'QuestBoardServiceError';
  }
}

function defaultIdentity(): RequestIdentity {
  const suffix = crypto.randomUUID();
  return {
    requestId: aiRequestId(`quest-request-${suffix}`),
    generationRecordId: generationRecordId(`quest-generation-${suffix}`),
    idempotencyKey: idempotencyKey(`quest:generate:${suffix}`),
  };
}

function parseSnapshot(value: unknown, expectedCampaignId: string): QuestBoardSnapshot {
  const record = requireRecord(value);
  const source = parseSource(record['source']);
  const quests = Object.freeze(requireArray(record['quests']).map(parseQuest));
  const storedCampaignId = campaignId(requireText(record['campaignId']));
  if (storedCampaignId !== expectedCampaignId) {
    throw new TypeError('Quest board belongs to another campaign');
  }
  const expectedStructures = quests.slice(-20).map((quest) =>
    questStructureSignature({
      risk: quest.risk,
      rewardTier: quest.rewardTier,
      expectedTurns: { min: quest.expectedTurnsMin, max: quest.expectedTurnsMax },
      recommendedAttributes: quest.recommendedAttributes,
    }),
  );
  if (JSON.stringify(source.recentQuestStructures) !== JSON.stringify(expectedStructures)) {
    throw new TypeError('Quest repetition history is inconsistent');
  }
  return Object.freeze({
    campaignId: storedCampaignId,
    campaignState: requireText(record['campaignState']),
    source,
    quests,
  });
}

function parseSource(value: unknown): QuestGenerationSource {
  const record = requireRecord(value);
  const world = requireRecord(record['world']);
  return Object.freeze({
    tavernId: requireText(record['tavernId']),
    tavernName: requireText(record['tavernName']),
    playerCharacterId: requireText(record['playerCharacterId']),
    playerConcept: requireText(record['playerConcept']),
    world: Object.freeze({
      name: requireText(world['name']),
      currentRegion: requireText(world['currentRegion']),
      summary: requireText(world['summary']),
      coreConflict: requireText(world['coreConflict']),
      technologyLevel: requireText(world['technologyLevel']),
      powerRules: Object.freeze(requireArray(world['powerRules']).map(requireText)),
    }),
    availableNpcs: Object.freeze(requireArray(record['availableNpcs']).map(parseNpc)),
    recentQuestTitles: Object.freeze(requireArray(record['recentQuestTitles']).map(requireText)),
    recentQuestStructures: Object.freeze(
      requireArray(record['recentQuestStructures']).map(requireText),
    ),
  });
}

function parseNpc(value: unknown): QuestNpcBrief {
  const record = requireRecord(value);
  return Object.freeze({
    id: requireText(record['id']),
    name: requireText(record['name']),
    identity: requireText(record['identity']),
    personality: requireText(record['personality']),
    goal: requireText(record['goal']),
    currentMood: requireText(record['currentMood']),
  });
}

function parseQuest(value: unknown): QuestView {
  const record = requireRecord(value);
  const content = requireRecord(record['content']);
  const status = enumValue(
    ['AVAILABLE', 'ACCEPTED', 'ACTIVE', 'COMPLETED', 'FAILED', 'ABANDONED'] as const,
    record['status'],
  );
  const risk = enumValue(['LOW', 'MODERATE', 'HIGH', 'EXTREME'] as const, record['risk']);
  const rewardTier = enumValue(
    ['BASIC', 'NOTABLE', 'RARE', 'LEGENDARY'] as const,
    record['rewardTier'],
  );
  const expectedTurnsMin = positiveInteger(record['expectedTurnsMin']);
  const expectedTurnsMax = positiveInteger(record['expectedTurnsMax']);
  if (expectedTurnsMin < 8 || expectedTurnsMax > 12 || expectedTurnsMax < expectedTurnsMin) {
    throw new TypeError('Quest length is invalid');
  }
  return Object.freeze({
    id: requireText(record['id']),
    publisherNpcId: requireText(record['publisherNpcId']),
    publisherName: requireText(record['publisherName']),
    content: Object.freeze({
      title: requireText(content['title']),
      summary: requireText(content['summary']),
      objective: requireText(content['objective']),
      failureCost: requireText(content['failureCost']),
    }),
    status,
    risk,
    recommendedAttributes: Object.freeze(
      requireArray(record['recommendedAttributes']).map((attribute) =>
        enumValue(['physique', 'agility', 'knowledge', 'charisma'] as const, attribute),
      ),
    ),
    expectedTurnsMin,
    expectedTurnsMax,
    rewardTier,
    createdAt: isoTimestamp(requireText(record['createdAt'])),
    updatedAt: isoTimestamp(requireText(record['updatedAt'])),
  });
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Native quest response must be an object');
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError('Native quest collection is invalid');
  return value;
}

function requireText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new TypeError('Quest text is invalid');
  }
  return value;
}

function positiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError('Quest number is invalid');
  }
  return value;
}

function enumValue<const Values extends readonly string[]>(
  values: Values,
  value: unknown,
): Values[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new TypeError('Quest enum is invalid');
  }
  return value;
}
