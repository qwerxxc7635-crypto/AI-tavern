import { invoke } from '@tauri-apps/api/core';

import {
  CheckConsistencyOutputSchema,
  EditCharacterDraftInputSchema,
  EditCharacterDraftOutputSchema,
  GenerateQuickCharacterInputSchema,
  GenerateQuickCharacterOutputSchema,
} from '@ember-tavern/ai-core';
import {
  aiRequestId,
  campaignId,
  cancelCharacterCreationSession,
  characterTraitId,
  createUniversalCharacterDraft,
  createWorldCharacterExtensionDefinition,
  generationRecordId,
  idempotencyKey,
  parseCharacterCreationSession,
  playerCharacterId,
  prepareAdvancedCharacterDraft,
  resumeCharacterCreationSession,
  saveCharacterCreationDraft,
  stageQuickCharacterDraft,
  switchCharacterCreationMode,
  validateCharacterLockedFields,
  type CharacterAttributeName,
  type CharacterCreationMode,
  type CharacterCreationSession,
  type ContentBoundaries,
  type AiRequestId,
  type GenerationRecordId,
  type IdempotencyKey,
  type UniversalCharacterDraft,
  type WorldCharacterExtensionDefinition,
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
import type { FieldAssistOperation } from './ai-field-assist-state.js';
import {
  CharacterDraftAIError,
  applyCharacterAIUpdates,
  characterAIFields,
  characterAIValue,
  isCharacterAIFieldEmpty,
  isCharacterAIFieldLocked,
  requireCharacterAIField,
  type CharacterAIFieldDefinition,
  type CharacterAISection,
} from './universal-character-ai.js';

export interface UniversalCharacterCreationSnapshot {
  readonly campaignState: string;
  readonly constitution: unknown;
  readonly extensionDefinitions: readonly WorldCharacterExtensionDefinition[];
  readonly session: CharacterCreationSession | null;
}

export interface StartUniversalCharacterCreation {
  readonly campaignId: string;
  readonly mode: CharacterCreationMode;
  readonly conceptInput: string | null;
  readonly storyPreferences: readonly string[];
  readonly contentBoundaries: ContentBoundaries;
}

export interface UniversalCharacterGenerationObserver {
  onValidationStarted(): void;
}

export interface CharacterDraftAIPreview {
  readonly draft: UniversalCharacterDraft;
  readonly changedPaths: readonly string[];
}

export type CharacterDraftAIBulkCommand =
  | { readonly scope: 'FILL_EMPTY' | 'WHOLE' | 'REGENERATE_UNLOCKED' }
  | { readonly scope: 'SECTION'; readonly section: CharacterAISection };

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

interface UniversalCharacterCreationGateway {
  load(campaignId: string): Promise<UniversalCharacterCreationSnapshot>;
  start(command: {
    readonly sessionId: string;
    readonly characterId: string;
    readonly campaignId: string;
    readonly mode: CharacterCreationMode;
    readonly conceptInput: string | null;
    readonly storyPreferences: readonly string[];
    readonly contentBoundaries: ContentBoundaries;
  }): Promise<UniversalCharacterCreationSnapshot>;
  save(command: {
    readonly campaignId: string;
    readonly expectedRevision: number;
    readonly session: CharacterCreationSession;
  }): Promise<UniversalCharacterCreationSnapshot>;
  commitQuick(command: {
    readonly campaignId: string;
    readonly expectedRevision: number;
    readonly generation: GenerationAudit;
  }): Promise<UniversalCharacterCreationSnapshot>;
  confirm(command: {
    readonly campaignId: string;
    readonly expectedRevision: number;
  }): Promise<UniversalCharacterCreationSnapshot>;
}

interface RequestIdentity {
  readonly requestId: AiRequestId;
  readonly generationRecordId: GenerationRecordId;
  readonly idempotencyKey: IdempotencyKey;
}

export const tauriUniversalCharacterCreationGateway: UniversalCharacterCreationGateway = {
  async load(id) {
    return parseSnapshot(await invoke<unknown>('universal_character_creation_get', { id }), id);
  },
  async start(command) {
    return parseSnapshot(
      await invoke<unknown>('universal_character_creation_start', { command }),
      command.campaignId,
    );
  },
  async save(command) {
    return parseSnapshot(
      await invoke<unknown>('universal_character_creation_save', { command }),
      command.campaignId,
    );
  },
  async commitQuick(command) {
    return parseSnapshot(
      await invoke<unknown>('universal_character_quick_commit', { command }),
      command.campaignId,
    );
  },
  async confirm(command) {
    return parseSnapshot(
      await invoke<unknown>('universal_character_creation_confirm', { command }),
      command.campaignId,
    );
  },
};

export class UniversalCharacterCreationService {
  private readonly ai: DesktopAIEngine;

  public constructor(
    private readonly gateway: UniversalCharacterCreationGateway = tauriUniversalCharacterCreationGateway,
    provider?: Parameters<typeof desktopAIEngine>[0],
    private readonly createIdentity: () => RequestIdentity = defaultIdentity,
    private readonly randomness: RandomnessTemperatureSource = balancedRandomnessTemperatureSource,
  ) {
    this.ai = desktopAIEngine(provider);
  }

  public load(campaignIdValue: string): Promise<UniversalCharacterCreationSnapshot> {
    campaignId(campaignIdValue);
    return this.gateway.load(campaignIdValue);
  }

  public start(
    command: StartUniversalCharacterCreation,
  ): Promise<UniversalCharacterCreationSnapshot> {
    const campaign = campaignId(command.campaignId);
    const suffix = crypto.randomUUID();
    return this.gateway.start({
      ...command,
      campaignId: campaign,
      sessionId: `character-session-${suffix}`,
      characterId: playerCharacterId(`character-${suffix}`),
    });
  }

  public async saveDraft(
    snapshot: UniversalCharacterCreationSnapshot,
    draft: UniversalCharacterDraft,
    lockedFields: readonly string[],
  ): Promise<UniversalCharacterCreationSnapshot> {
    const session = requireSession(snapshot);
    const next = saveCharacterCreationDraft(
      session,
      draft,
      lockedFields,
      snapshot.extensionDefinitions,
      clientTimestamp(),
    );
    return this.gateway.save({
      campaignId: session.campaignId,
      expectedRevision: session.revision,
      session: next,
    });
  }

  public async switchMode(
    snapshot: UniversalCharacterCreationSnapshot,
    mode: CharacterCreationMode,
    conceptInput: string | null,
  ): Promise<UniversalCharacterCreationSnapshot> {
    const session = requireSession(snapshot);
    const next = switchCharacterCreationMode(session, mode, conceptInput, clientTimestamp());
    return this.gateway.save({
      campaignId: session.campaignId,
      expectedRevision: session.revision,
      session: next,
    });
  }

  public async prepareAdvanced(
    snapshot: UniversalCharacterCreationSnapshot,
  ): Promise<UniversalCharacterCreationSnapshot> {
    const session = requireSession(snapshot);
    const next = prepareAdvancedCharacterDraft(
      session,
      snapshot.extensionDefinitions,
      clientTimestamp(),
    );
    return this.gateway.save({
      campaignId: session.campaignId,
      expectedRevision: session.revision,
      session: next,
    });
  }

  public async cancel(
    snapshot: UniversalCharacterCreationSnapshot,
  ): Promise<UniversalCharacterCreationSnapshot> {
    const session = requireSession(snapshot);
    const next = cancelCharacterCreationSession(session, clientTimestamp());
    return this.gateway.save({
      campaignId: session.campaignId,
      expectedRevision: session.revision,
      session: next,
    });
  }

  public async resume(
    snapshot: UniversalCharacterCreationSnapshot,
  ): Promise<UniversalCharacterCreationSnapshot> {
    const session = requireSession(snapshot);
    const next = resumeCharacterCreationSession(
      session,
      snapshot.extensionDefinitions,
      clientTimestamp(),
    );
    return this.gateway.save({
      campaignId: session.campaignId,
      expectedRevision: session.revision,
      session: next,
    });
  }

  public async generateQuick(
    snapshot: UniversalCharacterCreationSnapshot,
    observer?: UniversalCharacterGenerationObserver,
  ): Promise<UniversalCharacterCreationSnapshot> {
    const session = requireSession(snapshot);
    if (session.mode !== 'QUICK' || session.conceptInput === null) {
      throw new UniversalCharacterCreationServiceError('MODE_INVALID');
    }
    const input = GenerateQuickCharacterInputSchema.parse({
      concept: session.conceptInput,
      storyPreferences: session.draft.storyPreferences,
      contentBoundaries: session.draft.contentBoundaries,
      constitution: snapshot.constitution,
      extensionDefinitions: snapshot.extensionDefinitions.map((definition) => ({
        namespace: definition.namespace,
        displayName: definition.displayName,
        schemaVersion: definition.schemaVersion,
        fields: definition.fields,
      })),
    });
    const identity = this.createIdentity();
    const temperature = await this.randomness.resolveTemperature();
    const generated = await this.ai.execute('GENERATE_QUICK_CHARACTER', input, {
      requestId: identity.requestId,
      temperature,
      maxOutputTokens: 8_000,
      timeoutMs: 8_000,
    });
    observer?.onValidationStarted();
    const output = GenerateQuickCharacterOutputSchema.parse(generated.validatedOutput);
    const expectedDraft = buildQuickDraft(session, output, identity.generationRecordId);
    // Local validation proves the provider output can become a complete candidate before crossing IPC.
    const expected = stageQuickCharacterDraft(
      session,
      expectedDraft,
      generationRecordId(identity.generationRecordId),
      snapshot.extensionDefinitions,
      clientTimestamp(),
    );
    if (expected.status !== 'READY_TO_CONFIRM') {
      throw new UniversalCharacterCreationServiceError('INVALID_OUTPUT');
    }
    return this.gateway.commitQuick({
      campaignId: session.campaignId,
      expectedRevision: session.revision,
      generation: {
        ...identity,
        promptVersion: generated.request.promptVersion,
        input,
        context: {
          sessionId: session.id,
          characterId: session.characterId,
          constitutionRevision: session.constitutionRevision,
          lockedFields: session.lockedFields,
        },
        request: generated.request,
        rawResponseText: generated.response.content,
        validatedOutput: output,
      },
    });
  }

  public async assistField(
    snapshot: UniversalCharacterCreationSnapshot,
    draft: UniversalCharacterDraft,
    lockedFields: readonly string[],
    path: string,
    operation: FieldAssistOperation,
    signal: AbortSignal,
  ): Promise<readonly string[]> {
    requireEditableSession(snapshot);
    const locks = validateCharacterLockedFields(lockedFields, snapshot.extensionDefinitions);
    const field = requireCharacterAIField(snapshot.extensionDefinitions, path);
    if (isCharacterAIFieldLocked(path, locks)) {
      throw new CharacterDraftAIError('FIELD_LOCKED');
    }
    assertNotAborted(signal);
    const input = buildCharacterEditInput(snapshot, draft, locks, {
      scope: 'FIELD',
      fieldOperation: operation,
      section: null,
      fieldPath: path,
      fields: [field],
    });
    const identity = this.createIdentity();
    const output = await this.executeCharacterEdit(input, identity.requestId);
    assertNotAborted(signal);
    if (operation === 'OPTIONS') {
      if (output.kind !== 'FIELD_CANDIDATES' || output.fieldPath !== path) {
        throw new CharacterDraftAIError('CANDIDATE_OUTPUT_INVALID');
      }
      const candidates = output.candidates.map((candidate) => {
        applyCharacterAIUpdates(
          draft,
          [{ path, value: candidate }],
          snapshot.extensionDefinitions,
          locks,
        );
        return displayFieldValue(candidate);
      });
      await this.requireCharacterConsistency(
        snapshot,
        draft,
        locks,
        { path, candidates },
        identity.requestId,
      );
      assertNotAborted(signal);
      return Object.freeze(candidates);
    }
    if (
      output.kind !== 'DRAFT_PATCH' ||
      output.updates.length !== 1 ||
      output.updates[0]?.path !== path
    ) {
      throw new CharacterDraftAIError('FIELD_PATCH_INVALID');
    }
    const update = output.updates[0];
    const next = applyCharacterAIUpdates(draft, [update], snapshot.extensionDefinitions, locks);
    await this.requireCharacterConsistency(snapshot, next, locks, output, identity.requestId);
    assertNotAborted(signal);
    return Object.freeze([displayFieldValue(update.value)]);
  }

  public async generateDraftPreview(
    snapshot: UniversalCharacterCreationSnapshot,
    draft: UniversalCharacterDraft,
    lockedFields: readonly string[],
    command: CharacterDraftAIBulkCommand,
    signal: AbortSignal,
  ): Promise<CharacterDraftAIPreview> {
    requireEditableSession(snapshot);
    const locks = validateCharacterLockedFields(lockedFields, snapshot.extensionDefinitions);
    const available = characterAIFields(snapshot.extensionDefinitions).filter(
      ({ path }) => !isCharacterAIFieldLocked(path, locks),
    );
    const targets = available.filter((field) => {
      if (command.scope === 'FILL_EMPTY') return isCharacterAIFieldEmpty(draft, field);
      if (command.scope === 'SECTION') return field.section === command.section;
      return true;
    });
    if (targets.length === 0) throw new CharacterDraftAIError('NO_TARGET_FIELDS');
    assertNotAborted(signal);
    const input = buildCharacterEditInput(snapshot, draft, locks, {
      scope: command.scope,
      fieldOperation: null,
      section: command.scope === 'SECTION' ? command.section : null,
      fieldPath: null,
      fields: targets,
    });
    const identity = this.createIdentity();
    const output = await this.executeCharacterEdit(input, identity.requestId);
    assertNotAborted(signal);
    if (output.kind !== 'DRAFT_PATCH') throw new CharacterDraftAIError('BULK_PATCH_INVALID');
    const expected = new Set(targets.map(({ path }) => path));
    if (
      output.updates.length !== expected.size ||
      output.updates.some(({ path }) => !expected.has(path))
    ) {
      throw new CharacterDraftAIError('BULK_PATCH_INVALID');
    }
    const next = applyCharacterAIUpdates(
      draft,
      output.updates,
      snapshot.extensionDefinitions,
      locks,
    );
    await this.requireCharacterConsistency(snapshot, next, locks, output, identity.requestId);
    assertNotAborted(signal);
    return Object.freeze({ draft: next, changedPaths: Object.freeze([...expected]) });
  }

  private async executeCharacterEdit(input: unknown, requestId: string) {
    const temperature = await this.randomness.resolveTemperature();
    const generated = await this.ai.execute('EDIT_CHARACTER_DRAFT', input, {
      requestId,
      temperature,
      maxOutputTokens: 8_000,
      timeoutMs: 8_000,
    });
    return EditCharacterDraftOutputSchema.parse(generated.validatedOutput);
  }

  private async requireCharacterConsistency(
    snapshot: UniversalCharacterCreationSnapshot,
    draft: UniversalCharacterDraft,
    lockedFields: readonly string[],
    proposedContent: unknown,
    sourceRequestId: string,
  ): Promise<void> {
    requireEditableSession(snapshot);
    const generated = await this.ai.execute(
      'CHECK_CONSISTENCY',
      {
        world: constitutionWorldContext(snapshot.constitution),
        lockedRules: chunkFacts(constitutionRules(snapshot.constitution)),
        knownFacts: chunkFacts(
          lockedFields.map((path) => {
            const field = characterAIFields(snapshot.extensionDefinitions).find(
              (candidate) => candidate.path === path || candidate.path.startsWith(`${path}.`),
            );
            return field === undefined
              ? `Locked field: ${path}`
              : `${field.path}: ${JSON.stringify(characterAIValue(draft, field))}`;
          }),
        ),
        proposedContent: JSON.stringify(proposedContent),
      },
      {
        requestId: `${sourceRequestId}-consistency`,
        temperature: 0,
        maxOutputTokens: 2_000,
        timeoutMs: 8_000,
      },
    );
    const result = CheckConsistencyOutputSchema.parse(generated.validatedOutput);
    if (!result.consistent) {
      throw new CharacterDraftAIError('CHARACTER_CONTRADICTION');
    }
  }

  public confirm(
    snapshot: UniversalCharacterCreationSnapshot,
  ): Promise<UniversalCharacterCreationSnapshot> {
    const session = requireSession(snapshot);
    return this.gateway.confirm({
      campaignId: session.campaignId,
      expectedRevision: session.revision,
    });
  }
}

export const universalCharacterCreationService = new UniversalCharacterCreationService(
  tauriUniversalCharacterCreationGateway,
  tauriDesktopAIOrchestrator,
  defaultIdentity,
  tauriRandomnessTemperatureSource,
);

export class UniversalCharacterCreationServiceError extends Error {
  public constructor(
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super('Universal character creation operation failed', options);
    this.name = 'UniversalCharacterCreationServiceError';
  }
}

type QuickOutput = ReturnType<typeof GenerateQuickCharacterOutputSchema.parse>;

export function buildQuickDraft(
  session: CharacterCreationSession,
  output: QuickOutput,
  generationId: string,
): UniversalCharacterDraft {
  generationRecordId(generationId);
  const score = (attribute: CharacterAttributeName) =>
    4 - output.attributePriority.indexOf(attribute);
  const attributes = {
    physique: score('physique'),
    agility: score('agility'),
    knowledge: score('knowledge'),
    charisma: score('charisma'),
  };
  return createUniversalCharacterDraft({
    schemaVersion: 1,
    id: session.characterId,
    campaignId: session.campaignId,
    name: output.name,
    nickname: output.nickname,
    gender: output.gender,
    age: output.age,
    identity: output.identity,
    ancestry: output.ancestry,
    birthplace: output.birthplace ?? output.legacyBackground.birthplace,
    socialClass: output.socialClass,
    faith: output.faith,
    appearance: output.appearance,
    personality: output.personality,
    values: output.values,
    goals: output.goals,
    fears: output.fears,
    secrets: output.secrets,
    family: output.family,
    education: output.education,
    importantPeople: output.importantPeople,
    enemies: output.enemies,
    experiences: output.experiences,
    concept: session.conceptInput ?? session.draft.concept,
    storyPreferences: session.draft.storyPreferences,
    contentBoundaries: session.draft.contentBoundaries,
    career: { id: null, ...output.career },
    attributes,
    derivedAttributes: [],
    skills: [],
    proficiencies: output.proficiencies,
    abilities: output.abilities,
    languages: output.languages,
    wealth: 0,
    equipmentIds: [],
    reputations: [],
    relationships: [],
    traits: output.traits.map((trait, index) => ({
      id: characterTraitId(`quick-trait-${generationId}-${index + 1}`),
      ...trait,
    })),
    statuses: [],
    legacyBackground: output.legacyBackground,
    extensions: output.extensions,
  });
}

function parseSnapshot(
  value: unknown,
  expectedCampaignId: string,
): UniversalCharacterCreationSnapshot {
  const record = requireRecord(value, 'creation snapshot');
  const definitionValues = requireArray(record['extensionDefinitions'], 'extensionDefinitions');
  const definitions = definitionValues.map((entry, index) => parseDefinition(entry, index));
  const rawSession = record['session'];
  const session =
    rawSession === null ? null : parseCharacterCreationSession(rawSession, definitions);
  if (session !== null && session.campaignId !== expectedCampaignId) {
    throw new UniversalCharacterCreationServiceError('CAMPAIGN_MISMATCH');
  }
  const campaignState = requireString(record['campaignState'], 'campaignState');
  if (campaignState.length === 0) {
    throw new UniversalCharacterCreationServiceError('SNAPSHOT_INVALID');
  }
  return Object.freeze({
    campaignState,
    constitution: requireRecord(record['constitution'], 'constitution'),
    extensionDefinitions: Object.freeze(definitions),
    session,
  });
}

function parseDefinition(value: unknown, index: number): WorldCharacterExtensionDefinition {
  const record = requireRecord(value, `extensionDefinitions[${index}]`);
  const expected = [
    'kind',
    'schemaVersion',
    'campaignId',
    'namespace',
    'displayName',
    'constitutionRevision',
    'fields',
    'revision',
    'createdAt',
    'updatedAt',
  ];
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(expected.sort())) {
    throw new UniversalCharacterCreationServiceError('EXTENSION_DEFINITION_INVALID');
  }
  return createWorldCharacterExtensionDefinition(
    record as unknown as Omit<WorldCharacterExtensionDefinition, 'kind'>,
  );
}

function requireSession(snapshot: UniversalCharacterCreationSnapshot): CharacterCreationSession {
  if (snapshot.session === null) {
    throw new UniversalCharacterCreationServiceError('SESSION_NOT_FOUND');
  }
  return snapshot.session;
}

function requireEditableSession(
  snapshot: UniversalCharacterCreationSnapshot,
): CharacterCreationSession {
  const session = requireSession(snapshot);
  if (session.status === 'CANCELLED' || session.status === 'CONFIRMED') {
    throw new CharacterDraftAIError('SESSION_NOT_EDITABLE');
  }
  return session;
}

function buildCharacterEditInput(
  snapshot: UniversalCharacterCreationSnapshot,
  draft: UniversalCharacterDraft,
  lockedFields: readonly string[],
  command: {
    readonly scope: 'FIELD' | 'FILL_EMPTY' | 'SECTION' | 'WHOLE' | 'REGENERATE_UNLOCKED';
    readonly fieldOperation: FieldAssistOperation | null;
    readonly section: CharacterAISection | null;
    readonly fieldPath: string | null;
    readonly fields: readonly CharacterAIFieldDefinition[];
  },
) {
  requireEditableSession(snapshot);
  return EditCharacterDraftInputSchema.parse({
    scope: command.scope,
    fieldOperation: command.fieldOperation,
    section: command.section,
    fieldPath: command.fieldPath,
    targetPaths: command.fields.map(({ path }) => path),
    fieldKinds: Object.fromEntries(command.fields.map(({ path, kind }) => [path, kind])),
    draft,
    lockedFields,
    constitution: snapshot.constitution,
    extensionDefinitions: snapshot.extensionDefinitions,
  });
}

function displayFieldValue(value: string | readonly string[]): string {
  return typeof value === 'string' ? value : value.join('\n');
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new CharacterDraftAIError('GENERATION_CANCELLED');
}

function constitutionWorldContext(value: unknown) {
  const constitution = requireRecord(value, 'constitution');
  return {
    name: constitutionText(constitution, 'worldType'),
    currentRegion: constitutionText(constitution, 'era'),
    summary: constitutionText(constitution, 'society'),
    coreConflict: constitutionText(constitution, 'politics'),
    technologyLevel: constitutionText(constitution, 'technology'),
    powerRules: [
      constitutionText(constitution, 'magic'),
      constitutionText(constitution, 'deathRules'),
      constitutionText(constitution, 'careerRules'),
      constitutionText(constitution, 'traitRules'),
    ],
  };
}

function constitutionRules(value: unknown): readonly string[] {
  const constitution = requireRecord(value, 'constitution');
  return [
    'worldType',
    'era',
    'technology',
    'magic',
    'society',
    'politics',
    'economy',
    'combatScale',
    'deathRules',
    'careerRules',
    'equipmentRules',
    'npcRules',
    'traitRules',
  ].map((key) => `${key}: ${constitutionText(constitution, key)}`);
}

function constitutionText(value: Record<string, unknown>, key: string): string {
  const text = value[key];
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > 4_000) {
    throw new CharacterDraftAIError('CONSTITUTION_INVALID');
  }
  return text;
}

function chunkFacts(facts: readonly string[]): readonly string[] {
  const chunks: string[] = [];
  let active = '';
  for (const fact of facts) {
    if (fact.length > 3_800) throw new CharacterDraftAIError('CONSISTENCY_CONTEXT_TOO_LARGE');
    const candidate = active.length === 0 ? fact : `${active}\n${fact}`;
    if (candidate.length <= 3_800) active = candidate;
    else {
      chunks.push(active);
      active = fact;
    }
  }
  if (active.length > 0) chunks.push(active);
  if (chunks.length > 30) throw new CharacterDraftAIError('CONSISTENCY_CONTEXT_TOO_LARGE');
  return Object.freeze(chunks);
}

function defaultIdentity(): RequestIdentity {
  const suffix = crypto.randomUUID();
  return {
    requestId: aiRequestId(`character-quick-request-${suffix}`),
    generationRecordId: generationRecordId(`character-quick-generation-${suffix}`),
    idempotencyKey: idempotencyKey(`character:quick:${suffix}`),
  };
}

function clientTimestamp() {
  return new Date().toISOString() as CharacterCreationSession['updatedAt'];
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new UniversalCharacterCreationServiceError('SNAPSHOT_INVALID', {
      cause: new TypeError(`${label} must be an object`),
    });
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new UniversalCharacterCreationServiceError('SNAPSHOT_INVALID', {
      cause: new TypeError(`${label} must be an array`),
    });
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new UniversalCharacterCreationServiceError('SNAPSHOT_INVALID', {
      cause: new TypeError(`${label} must be text`),
    });
  }
  return value;
}

export type { UniversalCharacterCreationGateway };
