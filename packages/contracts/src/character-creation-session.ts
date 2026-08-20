import type { GenerationRecordId, IsoTimestamp } from './foundation.js';
import { TraitPointError, assertBalancedCharacterTraitPoints } from './trait-points.js';
import {
  UniversalCharacterError,
  createUniversalCharacterProfile,
  projectUniversalCharacterToV02,
  validateCharacterExtensionDraftValues,
  validateCompleteCharacterExtensionValues,
  type UniversalCharacterProfile,
  type WorldCharacterExtensionDefinition,
} from './universal-character.js';

export const CHARACTER_CREATION_SESSION_SCHEMA_VERSION = 1 as const;
export const CHARACTER_CREATION_MODES = ['QUICK', 'ADVANCED'] as const;
export const CHARACTER_CREATION_STATUSES = [
  'ACTIVE',
  'READY_TO_CONFIRM',
  'CANCELLED',
  'CONFIRMED',
] as const;

export type CharacterCreationMode = (typeof CHARACTER_CREATION_MODES)[number];
export type CharacterCreationStatus = (typeof CHARACTER_CREATION_STATUSES)[number];

export type UniversalCharacterDraft = Readonly<
  Omit<UniversalCharacterProfile, 'kind' | 'revision' | 'createdAt' | 'updatedAt'> & {
    readonly kind: 'UNIVERSAL_CHARACTER_DRAFT';
  }
>;

export interface CharacterCreationSession {
  readonly kind: 'CHARACTER_CREATION_SESSION';
  readonly schemaVersion: 1;
  readonly id: string;
  readonly campaignId: UniversalCharacterProfile['campaignId'];
  readonly characterId: UniversalCharacterProfile['id'];
  readonly constitutionRevision: number;
  readonly mode: CharacterCreationMode;
  readonly status: CharacterCreationStatus;
  readonly conceptInput: string | null;
  readonly draft: UniversalCharacterDraft;
  readonly lockedFields: readonly string[];
  readonly generationRecordId: GenerationRecordId | null;
  readonly revision: number;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly cancelledAt: IsoTimestamp | null;
  readonly confirmedAt: IsoTimestamp | null;
}

export interface CreateCharacterCreationSessionInput {
  readonly id: string;
  readonly campaignId: CharacterCreationSession['campaignId'];
  readonly characterId: CharacterCreationSession['characterId'];
  readonly constitutionRevision: number;
  readonly mode: CharacterCreationMode;
  readonly conceptInput: string | null;
  readonly draft: UniversalCharacterDraft;
  readonly createdAt: IsoTimestamp;
}

export class CharacterCreationSessionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CharacterCreationSessionError';
  }
}

const LOCKABLE_CHARACTER_FIELDS = [
  'name',
  'nickname',
  'gender',
  'age',
  'identity',
  'ancestry',
  'birthplace',
  'socialClass',
  'faith',
  'appearance',
  'personality',
  'values',
  'goals',
  'fears',
  'secrets',
  'family',
  'education',
  'importantPeople',
  'enemies',
  'experiences',
  'concept',
  'storyPreferences',
  'contentBoundaries',
  'career',
  'attributes',
  'derivedAttributes',
  'skills',
  'proficiencies',
  'abilities',
  'languages',
  'wealth',
  'equipmentIds',
  'reputations',
  'relationships',
  'traits',
  'statuses',
  'legacyBackground',
] as const;

export function createUniversalCharacterDraft(
  input: Omit<UniversalCharacterDraft, 'kind'>,
): UniversalCharacterDraft {
  const sentinel = '待填写';
  const canonical = createUniversalCharacterProfile({
    ...input,
    name: input.name === '' ? sentinel : input.name,
    identity: input.identity === '' ? sentinel : input.identity,
    concept: input.concept === '' ? sentinel : input.concept,
    career: {
      ...input.career,
      displayName: input.career.displayName === '' ? sentinel : input.career.displayName,
    },
    revision: 1,
    createdAt: '1970-01-01T00:00:00.000Z' as IsoTimestamp,
    updatedAt: '1970-01-01T00:00:00.000Z' as IsoTimestamp,
  });
  const fields = Object.fromEntries(
    Object.entries(canonical).filter(
      ([key]) => !['kind', 'revision', 'createdAt', 'updatedAt'].includes(key),
    ),
  ) as Omit<UniversalCharacterDraft, 'kind'>;
  return Object.freeze({
    ...fields,
    kind: 'UNIVERSAL_CHARACTER_DRAFT',
    name: input.name,
    identity: input.identity,
    concept: input.concept,
    career: Object.freeze({ ...canonical.career, displayName: input.career.displayName }),
  });
}

export function parseUniversalCharacterDraft(value: unknown): UniversalCharacterDraft {
  const record = requireRecord(value, 'Universal character draft');
  requireExactKeys(record, UNIVERSAL_CHARACTER_DRAFT_KEYS, 'Universal character draft');
  if (record['kind'] !== 'UNIVERSAL_CHARACTER_DRAFT') {
    throw new CharacterCreationSessionError('Universal character draft kind is invalid');
  }
  return createUniversalCharacterDraft(record as unknown as Omit<UniversalCharacterDraft, 'kind'>);
}

export function parseCharacterCreationSession(
  value: unknown,
  definitions: readonly WorldCharacterExtensionDefinition[],
): CharacterCreationSession {
  const record = requireRecord(value, 'Character creation session');
  requireExactKeys(record, CHARACTER_CREATION_SESSION_KEYS, 'Character creation session');
  if (record['kind'] !== 'CHARACTER_CREATION_SESSION') {
    throw new CharacterCreationSessionError('Character creation session kind is invalid');
  }
  return restoreCharacterCreationSession(
    {
      ...record,
      draft: parseUniversalCharacterDraft(record['draft']),
    } as unknown as Omit<CharacterCreationSession, 'kind'>,
    definitions,
  );
}

export function createCharacterCreationSession(
  input: CreateCharacterCreationSessionInput,
  definitions: readonly WorldCharacterExtensionDefinition[],
): CharacterCreationSession {
  const draft = createUniversalCharacterDraft(input.draft);
  requireDraftScope(draft, input.campaignId, input.characterId);
  validateCharacterExtensionDraftValues(draft, definitions);
  requireConstitutionRevision(input.constitutionRevision);
  requireDefinitionsBinding(input.campaignId, input.constitutionRevision, definitions);
  requireText(input.id, 'session id', 256);
  requireMode(input.mode);
  const conceptInput = optionalText(input.conceptInput, 'concept input', 4_000);
  if (input.mode === 'QUICK' && conceptInput === null) {
    throw new CharacterCreationSessionError('Quick creation requires a concept input');
  }
  requireTimestamp(input.createdAt, 'createdAt');
  return Object.freeze({
    kind: 'CHARACTER_CREATION_SESSION',
    schemaVersion: 1,
    id: input.id,
    campaignId: input.campaignId,
    characterId: input.characterId,
    constitutionRevision: input.constitutionRevision,
    mode: input.mode,
    status: 'ACTIVE',
    conceptInput,
    draft,
    lockedFields: Object.freeze([]),
    generationRecordId: null,
    revision: 1,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    cancelledAt: null,
    confirmedAt: null,
  });
}

export function restoreCharacterCreationSession(
  input: Omit<CharacterCreationSession, 'kind'>,
  definitions: readonly WorldCharacterExtensionDefinition[],
): CharacterCreationSession {
  if (input.schemaVersion !== 1) {
    throw new CharacterCreationSessionError('Character creation session version is unsupported');
  }
  const draft = createUniversalCharacterDraft(input.draft);
  requireDraftScope(draft, input.campaignId, input.characterId);
  requireConstitutionRevision(input.constitutionRevision);
  requireDefinitionsBinding(input.campaignId, input.constitutionRevision, definitions);
  validateCharacterExtensionDraftValues(draft, definitions);
  requireText(input.id, 'session id', 256);
  requireMode(input.mode);
  requireStatus(input.status);
  requireRevision(input.revision);
  requireTimestamp(input.createdAt, 'createdAt');
  requireTimestamp(input.updatedAt, 'updatedAt');
  const lockedFields = validateCharacterLockedFields(input.lockedFields, definitions);
  const conceptInput = optionalText(input.conceptInput, 'concept input', 4_000);
  const generationRecordId = optionalText(
    input.generationRecordId,
    'generation record id',
    256,
  ) as GenerationRecordId | null;
  const cancelledAt = optionalTimestamp(input.cancelledAt, 'cancelledAt');
  const confirmedAt = optionalTimestamp(input.confirmedAt, 'confirmedAt');
  if (
    (input.status === 'CANCELLED') !== (cancelledAt !== null) ||
    (input.status === 'CONFIRMED') !== (confirmedAt !== null) ||
    (input.status === 'CONFIRMED' && cancelledAt !== null)
  ) {
    throw new CharacterCreationSessionError('Character creation session timestamps disagree');
  }
  if (input.mode === 'QUICK' && conceptInput === null) {
    throw new CharacterCreationSessionError('Quick creation requires a concept input');
  }
  if (
    input.mode === 'QUICK' &&
    (input.status === 'READY_TO_CONFIRM' || input.status === 'CONFIRMED') &&
    generationRecordId === null
  ) {
    throw new CharacterCreationSessionError('Ready Quick creation requires generation provenance');
  }
  if (input.status === 'READY_TO_CONFIRM' || input.status === 'CONFIRMED') {
    materializeUniversalCharacterProfile(
      {
        campaignId: input.campaignId,
        characterId: input.characterId,
        createdAt: input.createdAt,
        draft,
      },
      definitions,
      input.updatedAt,
    );
  }
  return Object.freeze({
    ...input,
    kind: 'CHARACTER_CREATION_SESSION',
    conceptInput,
    draft,
    lockedFields,
    generationRecordId,
    cancelledAt,
    confirmedAt,
  });
}

export function saveCharacterCreationDraft(
  session: CharacterCreationSession,
  draftInput: UniversalCharacterDraft,
  lockedFieldsInput: readonly string[],
  definitions: readonly WorldCharacterExtensionDefinition[],
  updatedAt: IsoTimestamp,
): CharacterCreationSession {
  requireEditable(session);
  const draft = createUniversalCharacterDraft(draftInput);
  requireDraftScope(draft, session.campaignId, session.characterId);
  requireDefinitionsBinding(session.campaignId, session.constitutionRevision, definitions);
  validateCharacterExtensionDraftValues(draft, definitions);
  const lockedFields = validateCharacterLockedFields(lockedFieldsInput, definitions);
  assertLockedValuesPreserved(session.draft, draft, session.lockedFields);
  let status: CharacterCreationStatus = 'ACTIVE';
  if (session.mode === 'QUICK' && session.generationRecordId !== null) {
    try {
      materializeUniversalCharacterProfile({ ...session, draft }, definitions, updatedAt);
      status = 'READY_TO_CONFIRM';
    } catch (error) {
      if (!(
        error instanceof UniversalCharacterError ||
        error instanceof CharacterCreationSessionError ||
        error instanceof TraitPointError
      )) {
        throw error;
      }
    }
  }
  return advance(session, updatedAt, {
    draft,
    lockedFields,
    status,
    cancelledAt: null,
  });
}

export function switchCharacterCreationMode(
  session: CharacterCreationSession,
  mode: CharacterCreationMode,
  conceptInput: string | null,
  updatedAt: IsoTimestamp,
): CharacterCreationSession {
  requireEditable(session);
  requireMode(mode);
  const concept = optionalText(conceptInput, 'concept input', 4_000);
  if (mode === 'QUICK' && concept === null) {
    throw new CharacterCreationSessionError('Quick creation requires a concept input');
  }
  return advance(session, updatedAt, { mode, conceptInput: concept });
}

export function stageQuickCharacterDraft(
  session: CharacterCreationSession,
  generatedDraft: UniversalCharacterDraft,
  generationRecordId: GenerationRecordId,
  definitions: readonly WorldCharacterExtensionDefinition[],
  updatedAt: IsoTimestamp,
): CharacterCreationSession {
  requireEditable(session);
  if (session.mode !== 'QUICK') {
    throw new CharacterCreationSessionError('Quick generation requires Quick mode');
  }
  requireText(generationRecordId, 'generation record id', 256);
  const draft = createUniversalCharacterDraft(generatedDraft);
  requireDraftScope(draft, session.campaignId, session.characterId);
  assertLockedValuesPreserved(session.draft, draft, session.lockedFields);
  const staged = advance(session, updatedAt, {
    draft,
    generationRecordId,
    status: 'READY_TO_CONFIRM',
  });
  materializeUniversalCharacterProfile(staged, definitions, updatedAt);
  return staged;
}

export function prepareAdvancedCharacterDraft(
  session: CharacterCreationSession,
  definitions: readonly WorldCharacterExtensionDefinition[],
  updatedAt: IsoTimestamp,
): CharacterCreationSession {
  requireEditable(session);
  if (session.mode !== 'ADVANCED') {
    throw new CharacterCreationSessionError('Advanced preparation requires Advanced mode');
  }
  const prepared = advance(session, updatedAt, { status: 'READY_TO_CONFIRM' });
  materializeUniversalCharacterProfile(prepared, definitions, updatedAt);
  return prepared;
}

export function cancelCharacterCreationSession(
  session: CharacterCreationSession,
  updatedAt: IsoTimestamp,
): CharacterCreationSession {
  requireEditable(session);
  return advance(session, updatedAt, { status: 'CANCELLED', cancelledAt: updatedAt });
}

export function resumeCharacterCreationSession(
  session: CharacterCreationSession,
  definitions: readonly WorldCharacterExtensionDefinition[],
  updatedAt: IsoTimestamp,
): CharacterCreationSession {
  if (session.status !== 'CANCELLED') {
    throw new CharacterCreationSessionError('Only a cancelled session can resume');
  }
  let status: CharacterCreationStatus = 'ACTIVE';
  try {
    materializeUniversalCharacterProfile(session, definitions, updatedAt);
    status = 'READY_TO_CONFIRM';
  } catch (error) {
    if (!(
      error instanceof UniversalCharacterError ||
      error instanceof CharacterCreationSessionError ||
      error instanceof TraitPointError
    )) {
      throw error;
    }
  }
  return advance(session, updatedAt, { status, cancelledAt: null });
}

export function markCharacterCreationConfirmed(
  session: CharacterCreationSession,
  definitions: readonly WorldCharacterExtensionDefinition[],
  updatedAt: IsoTimestamp,
): CharacterCreationSession {
  if (session.status !== 'READY_TO_CONFIRM') {
    throw new CharacterCreationSessionError('Only a ready session can be confirmed');
  }
  materializeUniversalCharacterProfile(session, definitions, updatedAt);
  return advance(session, updatedAt, { status: 'CONFIRMED', confirmedAt: updatedAt });
}

export function materializeUniversalCharacterProfile(
  session: Pick<CharacterCreationSession, 'campaignId' | 'characterId' | 'draft' | 'createdAt'>,
  definitions: readonly WorldCharacterExtensionDefinition[],
  confirmedAt: IsoTimestamp,
): UniversalCharacterProfile {
  requireTimestamp(confirmedAt, 'confirmedAt');
  const profile = createUniversalCharacterProfile({
    ...session.draft,
    revision: 1,
    createdAt: confirmedAt,
    updatedAt: confirmedAt,
  });
  validateCompleteCharacterExtensionValues(profile, definitions);
  requireCompleteNarrative(profile);
  assertBalancedCharacterTraitPoints(profile.traits);
  if (
    profile.derivedAttributes.length !== 0 ||
    profile.skills.length !== 0 ||
    profile.wealth !== 0 ||
    profile.equipmentIds.length !== 0 ||
    profile.reputations.length !== 0 ||
    profile.relationships.length !== 0 ||
    profile.statuses.length !== 0
  ) {
    throw new CharacterCreationSessionError(
      'Initial rule-owned and entity-owned fields must use local empty defaults',
    );
  }
  projectUniversalCharacterToV02(profile);
  return profile;
}

export function validateCharacterLockedFields(
  values: readonly string[],
  definitions: readonly WorldCharacterExtensionDefinition[],
): readonly string[] {
  if (values.length > 128 || new Set(values).size !== values.length) {
    throw new CharacterCreationSessionError('Locked character fields are invalid');
  }
  const allowed = new Set<string>(LOCKABLE_CHARACTER_FIELDS);
  for (const definition of definitions) {
    for (const field of definition.fields) {
      allowed.add(`extensions.${definition.namespace}.${field.key}`);
    }
  }
  for (const field of values) {
    if (!allowed.has(field)) {
      throw new CharacterCreationSessionError(`Unknown locked character field: ${field}`);
    }
  }
  return Object.freeze([...values].sort());
}

function assertLockedValuesPreserved(
  current: UniversalCharacterDraft,
  next: UniversalCharacterDraft,
  lockedFields: readonly string[],
): void {
  for (const field of lockedFields) {
    if (
      JSON.stringify(readDraftField(current, field)) !== JSON.stringify(readDraftField(next, field))
    ) {
      throw new CharacterCreationSessionError(`Locked character field changed: ${field}`);
    }
  }
}

function readDraftField(draft: UniversalCharacterDraft, field: string): unknown {
  if (!field.startsWith('extensions.')) {
    return draft[field as keyof UniversalCharacterDraft];
  }
  const [, namespace, key] = field.split('.');
  return draft.extensions.find((extension) => extension.namespace === namespace)?.values[key ?? ''];
}

function requireCompleteNarrative(profile: UniversalCharacterProfile): void {
  const required = [
    profile.identity,
    profile.appearance,
    profile.personality,
    profile.career.displayName,
    profile.legacyBackground.birthplace,
    profile.legacyBackground.formativeExperience,
    profile.legacyBackground.adventureMotivation,
    profile.legacyBackground.secret,
    profile.legacyBackground.importantPerson,
    profile.legacyBackground.tavernArrivalReason,
  ];
  if (required.some((value) => value.length === 0) || profile.goals.length === 0) {
    throw new CharacterCreationSessionError('Character draft is not narratively complete');
  }
}

function requireEditable(session: CharacterCreationSession): void {
  if (session.status === 'CANCELLED' || session.status === 'CONFIRMED') {
    throw new CharacterCreationSessionError(`Cannot edit a ${session.status} session`);
  }
}

function advance(
  session: CharacterCreationSession,
  updatedAt: IsoTimestamp,
  patch: Partial<CharacterCreationSession>,
): CharacterCreationSession {
  requireTimestamp(updatedAt, 'updatedAt');
  if (updatedAt < session.updatedAt) {
    throw new CharacterCreationSessionError('Session time cannot move backwards');
  }
  return Object.freeze({
    ...session,
    ...patch,
    kind: 'CHARACTER_CREATION_SESSION',
    schemaVersion: 1,
    revision: session.revision + 1,
    updatedAt,
  });
}

function requireDefinitionsBinding(
  campaignId: CharacterCreationSession['campaignId'],
  constitutionRevision: number,
  definitions: readonly WorldCharacterExtensionDefinition[],
): void {
  for (const definition of definitions) {
    if (
      definition.campaignId !== campaignId ||
      definition.constitutionRevision !== constitutionRevision
    ) {
      throw new CharacterCreationSessionError(
        'Character extension definition does not match the locked Constitution',
      );
    }
  }
}

function requireDraftScope(
  draft: UniversalCharacterDraft,
  campaignId: CharacterCreationSession['campaignId'],
  characterId: CharacterCreationSession['characterId'],
): void {
  if (draft.campaignId !== campaignId || draft.id !== characterId) {
    throw new CharacterCreationSessionError('Character draft scope is invalid');
  }
}

function requireMode(value: CharacterCreationMode): void {
  if (!CHARACTER_CREATION_MODES.includes(value)) {
    throw new CharacterCreationSessionError('Character creation mode is invalid');
  }
}

function requireStatus(value: CharacterCreationStatus): void {
  if (!CHARACTER_CREATION_STATUSES.includes(value)) {
    throw new CharacterCreationSessionError('Character creation status is invalid');
  }
}

function requireConstitutionRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000_000) {
    throw new CharacterCreationSessionError('Constitution revision is invalid');
  }
}

function requireRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000_000) {
    throw new CharacterCreationSessionError('Session revision is invalid');
  }
}

function requireText(value: string, label: string, maximum: number): string {
  if (value.length === 0 || value.trim() !== value || value.length > maximum) {
    throw new CharacterCreationSessionError(`${label} must be canonical bounded text`);
  }
  return value;
}

function optionalText(value: string | null, label: string, maximum: number): string | null {
  return value === null ? null : requireText(value, label, maximum);
}

function requireTimestamp(value: IsoTimestamp, label: string): void {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new CharacterCreationSessionError(`${label} must be an ISO timestamp`);
  }
}

function optionalTimestamp(value: IsoTimestamp | null, label: string): IsoTimestamp | null {
  if (value !== null) requireTimestamp(value, label);
  return value;
}

export const UNIVERSAL_CHARACTER_DRAFT_KEYS = Object.freeze([
  'kind',
  'schemaVersion',
  'id',
  'campaignId',
  'name',
  'nickname',
  'gender',
  'age',
  'identity',
  'ancestry',
  'birthplace',
  'socialClass',
  'faith',
  'appearance',
  'personality',
  'values',
  'goals',
  'fears',
  'secrets',
  'family',
  'education',
  'importantPeople',
  'enemies',
  'experiences',
  'concept',
  'storyPreferences',
  'contentBoundaries',
  'career',
  'attributes',
  'derivedAttributes',
  'skills',
  'proficiencies',
  'abilities',
  'languages',
  'wealth',
  'equipmentIds',
  'reputations',
  'relationships',
  'traits',
  'statuses',
  'legacyBackground',
  'extensions',
] as const);

const CHARACTER_CREATION_SESSION_KEYS = Object.freeze([
  'kind',
  'schemaVersion',
  'id',
  'campaignId',
  'characterId',
  'constitutionRevision',
  'mode',
  'status',
  'conceptInput',
  'draft',
  'lockedFields',
  'generationRecordId',
  'revision',
  'createdAt',
  'updatedAt',
  'cancelledAt',
  'confirmedAt',
] as const);

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CharacterCreationSessionError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(canonical)) {
    throw new CharacterCreationSessionError(`${label} has unknown or missing fields`);
  }
}
