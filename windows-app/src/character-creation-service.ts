import { invoke } from '@tauri-apps/api/core';

import {
  CompleteCharacterBackgroundInputSchema,
  CompleteCharacterBackgroundOutputSchema,
  FakeAIProvider,
  GenerateCharacterTraitsInputSchema,
  GenerateCharacterTraitsOutputSchema,
  validateAIOutput,
  type AIProvider,
  type AITask,
  type NormalizedAIRequest,
  type ProviderConfig,
} from '@ember-tavern/ai-core';
import {
  aiRequestId,
  campaignId,
  characterTraitId,
  createPlayerAttributes,
  generationRecordId,
  idempotencyKey,
  isoTimestamp,
  itemId,
  playerCharacterId,
  type ClassArchetype,
  type ContentBoundaries,
  type PlayerAttributesInput,
} from '@ember-tavern/contracts';
import { formatTaskPrompt } from '@ember-tavern/prompts';

export interface CharacterDraft {
  readonly id: string;
  readonly campaignId: string;
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

export interface CharacterTraitView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

export interface CharacterBackgroundView {
  readonly birthplace: string;
  readonly formativeExperience: string;
  readonly adventureMotivation: string;
  readonly secret: string;
  readonly importantPerson: string;
  readonly tavernArrivalReason: string;
}

export interface EquipmentView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly effect:
    | { readonly kind: 'NONE' }
    | {
        readonly kind: 'CHECK_MODIFIER';
        readonly attribute: 'physique' | 'agility' | 'knowledge' | 'charisma';
        readonly modifier: number;
      };
}

export interface PlayerCharacterView extends CharacterDraft {
  readonly traits: readonly CharacterTraitView[];
  readonly background: CharacterBackgroundView;
  readonly initialEquipment: readonly EquipmentView[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CharacterCandidateView {
  readonly id: string;
  readonly kind: 'CHARACTER_TRAITS' | 'COMPLETE_CHARACTER';
  readonly draft: CharacterDraft;
  readonly traitGenerationRecordId: string;
  readonly traitCandidates: readonly CharacterTraitView[];
  readonly selectedTraits: readonly CharacterTraitView[];
  readonly background: CharacterBackgroundView | null;
  readonly initialEquipment: readonly EquipmentView[];
}

export interface CharacterCreationSnapshot {
  readonly campaignState: string;
  readonly draft: CharacterDraft | null;
  readonly traitGenerationRecordId: string | null;
  readonly traitCandidates: readonly CharacterTraitView[];
  readonly candidate: CharacterCandidateView | null;
  readonly character: PlayerCharacterView | null;
}

export interface CharacterGenerationObserver {
  onValidationStarted(): void;
}

export interface CharacterCreationGateway {
  load(campaignId: string): Promise<CharacterCreationSnapshot>;
  commitTraits(command: CharacterTraitCommit): Promise<CharacterCreationSnapshot>;
  commitCompletion(command: CharacterCompletionCommit): Promise<CharacterCreationSnapshot>;
  confirmCandidate(campaignId: string, candidateId: string): Promise<CharacterCreationSnapshot>;
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

interface CharacterTraitCommit {
  readonly campaignId: string;
  readonly character: CharacterDraft;
  readonly generation: GenerationAudit;
}

interface CharacterCompletionCommit extends CharacterTraitCommit {
  readonly traitGenerationRecordId: string;
  readonly selectedTraits: readonly CharacterTraitView[];
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

export const tauriCharacterCreationGateway: CharacterCreationGateway = {
  async load(id) {
    return parseSnapshot(await invoke<unknown>('character_creation_get', { id }), id);
  },
  async commitTraits(command) {
    return parseSnapshot(
      await invoke<unknown>('character_traits_commit', { command }),
      command.campaignId,
    );
  },
  async commitCompletion(command) {
    return parseSnapshot(
      await invoke<unknown>('character_completion_commit', { command }),
      command.campaignId,
    );
  },
  async confirmCandidate(campaignIdValue, candidateId) {
    return parseSnapshot(
      await invoke<unknown>('character_candidate_confirm', {
        command: { campaignId: campaignIdValue, candidateId },
      }),
      campaignIdValue,
    );
  },
};

export class WindowsCharacterCreationService {
  public constructor(
    private readonly gateway: CharacterCreationGateway = tauriCharacterCreationGateway,
    private readonly provider: AIProvider = new FakeAIProvider(),
    private readonly createIdentity: (task: CharacterTask) => RequestIdentity = defaultIdentity,
  ) {}

  public load(campaignIdValue: string): Promise<CharacterCreationSnapshot> {
    campaignId(campaignIdValue);
    return this.gateway.load(campaignIdValue);
  }

  public async generateTraits(
    draft: CharacterDraft,
    observer?: CharacterGenerationObserver,
  ): Promise<CharacterCreationSnapshot> {
    const character = validateDraft(draft);
    const input = GenerateCharacterTraitsInputSchema.parse({
      concept: character.concept,
      classArchetype: character.classArchetype,
      personalGoal: character.personalGoal,
      storyPreferences: character.storyPreferences,
    });
    const generated = await this.generate(
      'GENERATE_CHARACTER_TRAITS',
      input,
      { character },
      observer,
    );
    GenerateCharacterTraitsOutputSchema.parse(generated.validatedOutput);
    return this.gateway.commitTraits({
      campaignId: character.campaignId,
      character,
      generation: generated,
    });
  }

  public async complete(
    draft: CharacterDraft,
    traitGenerationRecordId: string,
    selectedTraits: readonly CharacterTraitView[],
    observer?: CharacterGenerationObserver,
  ): Promise<CharacterCreationSnapshot> {
    const character = validateDraft(draft);
    generationRecordId(traitGenerationRecordId);
    if (selectedTraits.length !== 2 || selectedTraits[0]?.id === selectedTraits[1]?.id) {
      throw new TypeError('Exactly two distinct traits are required');
    }
    const input = CompleteCharacterBackgroundInputSchema.parse({
      name: character.name,
      concept: character.concept,
      classDisplayName: character.classDisplayName,
      personalGoal: character.personalGoal,
      traits: selectedTraits.map(({ name, description }) => ({ name, description })),
    });
    const generated = await this.generate(
      'COMPLETE_CHARACTER_BACKGROUND',
      input,
      {
        character,
        selectedTraits,
        traitGenerationRecordId,
      },
      observer,
    );
    CompleteCharacterBackgroundOutputSchema.parse(generated.validatedOutput);
    return this.gateway.commitCompletion({
      campaignId: character.campaignId,
      character,
      traitGenerationRecordId,
      selectedTraits,
      generation: generated,
    });
  }

  public confirm(campaignIdValue: string, candidateId: string): Promise<CharacterCreationSnapshot> {
    campaignId(campaignIdValue);
    if (candidateId.length === 0 || candidateId.trim() !== candidateId) {
      throw new TypeError('Character candidate id is invalid');
    }
    return this.gateway.confirmCandidate(campaignIdValue, candidateId);
  }

  private async generate(
    task: CharacterTask,
    input: unknown,
    context: unknown,
    observer?: CharacterGenerationObserver,
  ): Promise<GenerationAudit> {
    const identity = this.createIdentity(task);
    const model = (await this.provider.listModels()).find(({ name }) => name === 'ember-fake-v1');
    if (model === undefined) throw new CharacterCreationServiceError('MODEL_NOT_FOUND');
    const prompt = formatTaskPrompt(task, input, model.capabilities);
    const request: NormalizedAIRequest = {
      requestId: aiRequestId(identity.requestId),
      task,
      promptVersion: prompt.promptVersion,
      modelName: model.name,
      messages: prompt.messages,
      responseFormat: prompt.responseFormat,
      temperature: 0,
      maxOutputTokens: 4_000,
      timeoutMs: 5_000,
    };
    const response = await this.provider.generate(request, PROVIDER_CONFIG);
    if (response.requestId !== request.requestId || response.modelName !== request.modelName) {
      throw new CharacterCreationServiceError('PROVIDER_IDENTITY_MISMATCH');
    }
    observer?.onValidationStarted();
    const validated = validateAIOutput(task, response.content);
    if (!validated.ok) throw new CharacterCreationServiceError(validated.error.code);
    return {
      ...identity,
      promptVersion: request.promptVersion,
      input,
      context,
      request,
      rawResponseText: response.content,
      validatedOutput: validated.validatedOutput,
    };
  }
}

export const windowsCharacterCreationService = new WindowsCharacterCreationService();

export class CharacterCreationServiceError extends Error {
  public constructor(public readonly code: string) {
    super('Character creation operation failed');
    this.name = 'CharacterCreationServiceError';
  }
}

type CharacterTask = Extract<AITask, 'GENERATE_CHARACTER_TRAITS' | 'COMPLETE_CHARACTER_BACKGROUND'>;

function defaultIdentity(task: CharacterTask): RequestIdentity {
  const suffix = crypto.randomUUID();
  return {
    requestId: aiRequestId(`character-request-${suffix}`),
    generationRecordId: generationRecordId(`character-generation-${suffix}`),
    idempotencyKey: idempotencyKey(`character:${task.toLowerCase()}:${suffix}`),
  };
}

function validateDraft(value: CharacterDraft): CharacterDraft {
  playerCharacterId(value.id);
  campaignId(value.campaignId);
  const canonical = (text: string, label: string) => {
    if (text.length === 0 || text.trim() !== text) throw new TypeError(`${label} is invalid`);
    return text;
  };
  const age = value.age;
  if (age !== null && (!Number.isSafeInteger(age) || age < 0)) {
    throw new TypeError('Character age is invalid');
  }
  if (!['WARRIOR', 'ROGUE', 'SCHOLAR', 'DIPLOMAT'].includes(value.classArchetype)) {
    throw new TypeError('Character class is invalid');
  }
  return Object.freeze({
    ...value,
    name: canonical(value.name, 'name'),
    gender: value.gender === null ? null : canonical(value.gender, 'gender'),
    concept: canonical(value.concept, 'concept'),
    storyPreferences: Object.freeze(
      value.storyPreferences.map((entry) => canonical(entry, 'story preference')),
    ),
    contentBoundaries: Object.freeze({
      ...value.contentBoundaries,
      excludedContent: Object.freeze(
        value.contentBoundaries.excludedContent.map((entry) =>
          canonical(entry, 'excluded content'),
        ),
      ),
    }),
    classDisplayName: canonical(value.classDisplayName, 'class display name'),
    attributes: createPlayerAttributes(value.attributes),
    personalGoal: canonical(value.personalGoal, 'personal goal'),
  });
}

function parseSnapshot(value: unknown, expectedCampaignId: string): CharacterCreationSnapshot {
  const record = requireRecord(value);
  const rawTraits = record['traitCandidates'];
  if (!Array.isArray(rawTraits)) throw new TypeError('Trait candidates must be an array');
  const traitCandidates = Object.freeze(rawTraits.map(parseTrait));
  const traitRecord = record['traitGenerationRecordId'];
  if (traitRecord !== null && typeof traitRecord !== 'string') {
    throw new TypeError('Trait generation record is invalid');
  }
  const rawCharacter = record['character'];
  const character = rawCharacter === null ? null : parseCharacter(rawCharacter, expectedCampaignId);
  const rawDraft = record['draft'];
  const draft = rawDraft === null ? null : parseDraft(rawDraft, expectedCampaignId);
  const rawCandidate = record['candidate'];
  const candidate = rawCandidate === null ? null : parseCandidate(rawCandidate, expectedCampaignId);
  return Object.freeze({
    campaignState: requireString(record['campaignState']),
    draft,
    traitGenerationRecordId: traitRecord === null ? null : generationRecordId(traitRecord),
    traitCandidates,
    candidate,
    character,
  });
}

function parseCandidate(value: unknown, expectedCampaignId: string): CharacterCandidateView {
  const record = requireRecord(value);
  const kind = requireString(record['kind']);
  if (kind !== 'CHARACTER_TRAITS' && kind !== 'COMPLETE_CHARACTER') {
    throw new TypeError('Character candidate kind is invalid');
  }
  const traitCandidates = record['traitCandidates'];
  const selectedTraits = record['selectedTraits'];
  const equipment = record['initialEquipment'];
  if (
    !Array.isArray(traitCandidates) ||
    !Array.isArray(selectedTraits) ||
    !Array.isArray(equipment)
  ) {
    throw new TypeError('Character candidate collections are invalid');
  }
  const background = record['background'];
  return Object.freeze({
    id: requireString(record['id']),
    kind,
    draft: parseDraft(record['draft'], expectedCampaignId),
    traitGenerationRecordId: generationRecordId(requireString(record['traitGenerationRecordId'])),
    traitCandidates: Object.freeze(traitCandidates.map(parseTrait)),
    selectedTraits: Object.freeze(selectedTraits.map(parseTrait)),
    background: background === null ? null : parseBackground(background),
    initialEquipment: Object.freeze(equipment.map(parseEquipment)),
  });
}

function parseBackground(value: unknown): CharacterBackgroundView {
  const background = requireRecord(value);
  return Object.freeze({
    birthplace: requireString(background['birthplace']),
    formativeExperience: requireString(background['formativeExperience']),
    adventureMotivation: requireString(background['adventureMotivation']),
    secret: requireString(background['secret']),
    importantPerson: requireString(background['importantPerson']),
    tavernArrivalReason: requireString(background['tavernArrivalReason']),
  });
}

function parseTrait(value: unknown): CharacterTraitView {
  const record = requireRecord(value);
  return Object.freeze({
    id: characterTraitId(requireString(record['id'])),
    name: requireString(record['name']),
    description: requireString(record['description']),
  });
}

function parseCharacter(value: unknown, expectedCampaignId: string): PlayerCharacterView {
  const record = requireRecord(value);
  const draft = parseDraft(value, expectedCampaignId);
  const traits = record['traits'];
  const equipment = record['initialEquipment'];
  if (!Array.isArray(traits) || traits.length !== 2 || !Array.isArray(equipment)) {
    throw new TypeError('Character collections are invalid');
  }
  const background = parseBackground(record['background']);
  const createdAt = isoTimestamp(requireString(record['createdAt']));
  const updatedAt = isoTimestamp(requireString(record['updatedAt']));
  if (updatedAt < createdAt) throw new TypeError('Character timestamps are out of order');
  return Object.freeze({
    ...draft,
    traits: Object.freeze(traits.map(parseTrait)),
    personalGoal: requireString(record['personalGoal']),
    background,
    initialEquipment: Object.freeze(equipment.map(parseEquipment)),
    createdAt,
    updatedAt,
  });
}

function parseDraft(value: unknown, expectedCampaignId: string): CharacterDraft {
  const record = requireRecord(value);
  const campaign = campaignId(requireString(record['campaignId']));
  if (campaign !== expectedCampaignId) throw new TypeError('Character belongs to another campaign');
  const attributesRecord = requireRecord(record['attributes']);
  const content = requireRecord(record['contentBoundaries']);
  const classArchetype = requireString(record['classArchetype']);
  if (!['WARRIOR', 'ROGUE', 'SCHOLAR', 'DIPLOMAT'].includes(classArchetype)) {
    throw new TypeError('Character class is invalid');
  }
  return Object.freeze({
    id: playerCharacterId(requireString(record['id'])),
    campaignId: campaign,
    name: requireString(record['name']),
    gender: nullableString(record['gender']),
    age: nullableNumber(record['age']),
    concept: requireString(record['concept']),
    storyPreferences: stringArray(record['storyPreferences']),
    contentBoundaries: {
      allowHorror: requireBoolean(content['allowHorror']),
      allowPermanentDeath: requireBoolean(content['allowPermanentDeath']),
      allowRomance: requireBoolean(content['allowRomance']),
      allowBetrayal: requireBoolean(content['allowBetrayal']),
      excludedContent: stringArray(content['excludedContent']),
    },
    classArchetype: classArchetype as ClassArchetype,
    classDisplayName: requireString(record['classDisplayName']),
    attributes: createPlayerAttributes({
      physique: requireNumber(attributesRecord['physique']),
      agility: requireNumber(attributesRecord['agility']),
      knowledge: requireNumber(attributesRecord['knowledge']),
      charisma: requireNumber(attributesRecord['charisma']),
    }),
    personalGoal: requireString(record['personalGoal']),
  });
}

function parseEquipment(value: unknown): EquipmentView {
  const record = requireRecord(value);
  const effect = requireRecord(record['effect']);
  const kind = requireString(effect['kind']);
  const parsedEffect =
    kind === 'NONE'
      ? ({ kind } as const)
      : {
          kind: 'CHECK_MODIFIER' as const,
          attribute: requireAttribute(effect['attribute']),
          modifier: requireNumber(effect['modifier']),
        };
  if (kind !== 'NONE' && kind !== 'CHECK_MODIFIER') {
    throw new TypeError('Equipment effect is invalid');
  }
  return Object.freeze({
    id: itemId(requireString(record['id'])),
    name: requireString(record['name']),
    description: requireString(record['description']),
    effect: parsedEffect,
  });
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Native character response must be an object');
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new TypeError('Native character text is invalid');
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : requireString(value);
}

function requireNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError('Native character number is invalid');
  }
  return value;
}

function nullableNumber(value: unknown): number | null {
  return value === null ? null : requireNumber(value);
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError('Native character flag is invalid');
  return value;
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError('Native character list is invalid');
  return Object.freeze(value.map(requireString));
}

function requireAttribute(value: unknown): 'physique' | 'agility' | 'knowledge' | 'charisma' {
  if (
    typeof value !== 'string' ||
    !['physique', 'agility', 'knowledge', 'charisma'].includes(value)
  ) {
    throw new TypeError('Equipment attribute is invalid');
  }
  return value as 'physique' | 'agility' | 'knowledge' | 'charisma';
}
