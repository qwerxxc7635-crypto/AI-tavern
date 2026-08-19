import {
  CLASS_ARCHETYPES,
  createPlayerAttributes,
  type CharacterBackground,
  type CharacterTrait,
  type ClassArchetype,
  type ContentBoundaries,
  type PlayerAttributes,
  type PlayerCharacter,
} from './character.js';
import type { CampaignId, IsoTimestamp, ItemId, PlayerCharacterId } from './foundation.js';
import type { JsonValue } from './pending-ai-request.js';

export const UNIVERSAL_CHARACTER_SCHEMA_VERSION = 1 as const;
export const WORLD_CHARACTER_EXTENSION_SCHEMA_VERSION = 1 as const;

export const CHARACTER_EXTENSION_FIELD_TYPES = [
  'TEXT',
  'INTEGER',
  'NUMBER',
  'BOOLEAN',
  'ENUM',
  'TEXT_LIST',
] as const;
export type CharacterExtensionFieldType = (typeof CHARACTER_EXTENSION_FIELD_TYPES)[number];

interface CharacterExtensionFieldBase {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
}

export type CharacterExtensionFieldDefinition =
  | (CharacterExtensionFieldBase & {
      readonly type: 'TEXT';
      readonly maxLength: number;
    })
  | (CharacterExtensionFieldBase & {
      readonly type: 'INTEGER' | 'NUMBER';
      readonly minimum: number;
      readonly maximum: number;
    })
  | (CharacterExtensionFieldBase & { readonly type: 'BOOLEAN' })
  | (CharacterExtensionFieldBase & {
      readonly type: 'ENUM';
      readonly options: readonly string[];
    })
  | (CharacterExtensionFieldBase & {
      readonly type: 'TEXT_LIST';
      readonly maxItems: number;
      readonly itemMaxLength: number;
    });

export interface WorldCharacterExtensionDefinition {
  readonly kind: 'WORLD_CHARACTER_EXTENSION_DEFINITION';
  readonly schemaVersion: 1;
  readonly campaignId: CampaignId;
  readonly namespace: string;
  readonly displayName: string;
  readonly constitutionRevision: number;
  readonly fields: readonly CharacterExtensionFieldDefinition[];
  readonly revision: number;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface CharacterExtensionValueSet {
  readonly namespace: string;
  readonly schemaVersion: 1;
  readonly values: Readonly<Record<string, JsonValue>>;
}

export interface NamedCharacterValue {
  readonly key: string;
  readonly value: number;
}

export interface CharacterReputation {
  readonly entityId: string;
  readonly score: number;
  readonly summary: string;
}

export interface CharacterRelationshipSummary {
  readonly entityId: string;
  readonly kind: string;
  readonly summary: string;
}

export interface UniversalCharacterCareer {
  readonly id: string | null;
  readonly displayName: string;
  readonly legacyArchetype: ClassArchetype | null;
}

export interface UniversalCharacterProfile {
  readonly kind: 'UNIVERSAL_CHARACTER_PROFILE';
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly id: PlayerCharacterId;
  readonly campaignId: CampaignId;
  readonly name: string;
  readonly nickname: string | null;
  readonly gender: string | null;
  readonly age: number | null;
  readonly identity: string;
  readonly ancestry: string | null;
  readonly birthplace: string | null;
  readonly socialClass: string | null;
  readonly faith: string | null;
  readonly appearance: string;
  readonly personality: string;
  readonly values: readonly string[];
  readonly goals: readonly string[];
  readonly fears: readonly string[];
  readonly secrets: readonly string[];
  readonly family: readonly string[];
  readonly education: readonly string[];
  readonly importantPeople: readonly string[];
  readonly enemies: readonly string[];
  readonly experiences: readonly string[];
  readonly concept: string;
  readonly storyPreferences: readonly string[];
  readonly contentBoundaries: ContentBoundaries;
  readonly career: UniversalCharacterCareer;
  readonly attributes: PlayerAttributes;
  readonly derivedAttributes: readonly NamedCharacterValue[];
  readonly skills: readonly string[];
  readonly proficiencies: readonly string[];
  readonly abilities: readonly string[];
  readonly languages: readonly string[];
  readonly wealth: number;
  readonly equipmentIds: readonly ItemId[];
  readonly reputations: readonly CharacterReputation[];
  readonly relationships: readonly CharacterRelationshipSummary[];
  readonly traits: readonly CharacterTrait[];
  readonly statuses: readonly string[];
  readonly legacyBackground: CharacterBackground;
  readonly extensions: readonly CharacterExtensionValueSet[];
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export class UniversalCharacterError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'UniversalCharacterError';
  }
}

export function createWorldCharacterExtensionDefinition(
  input: Omit<WorldCharacterExtensionDefinition, 'kind'>,
): WorldCharacterExtensionDefinition {
  requireVersion(input.schemaVersion, 'World character extension');
  requireRevision(input.constitutionRevision, 'constitutionRevision');
  requireRevision(input.revision, 'revision');
  requireTimestamp(input.createdAt, 'createdAt');
  requireTimestamp(input.updatedAt, 'updatedAt');
  requireText(input.campaignId, 'campaignId', 256);
  const fields = input.fields.map((field, index) => validateField(field, index));
  if (fields.length === 0 || fields.length > 32) {
    throw new UniversalCharacterError('Extension fields must contain 1 to 32 definitions');
  }
  requireUnique(
    fields.map(({ key }) => key),
    'Extension field keys',
  );
  return Object.freeze({
    ...input,
    kind: 'WORLD_CHARACTER_EXTENSION_DEFINITION',
    namespace: requireNamespace(input.namespace),
    displayName: requireText(input.displayName, 'displayName', 120),
    fields: Object.freeze(fields),
  });
}

export function createUniversalCharacterProfile(
  input: Omit<UniversalCharacterProfile, 'kind'>,
): UniversalCharacterProfile {
  requireVersion(input.schemaVersion, 'Universal character');
  requireRevision(input.revision, 'revision');
  requireTimestamp(input.createdAt, 'createdAt');
  requireTimestamp(input.updatedAt, 'updatedAt');
  requireText(input.id, 'id', 256);
  requireText(input.campaignId, 'campaignId', 256);
  if (
    input.age !== null &&
    (!Number.isSafeInteger(input.age) || input.age < 0 || input.age > 10_000)
  ) {
    throw new UniversalCharacterError('age must be null or an integer from 0 to 10000');
  }
  if (!Number.isSafeInteger(input.wealth) || input.wealth < 0 || input.wealth > 1_000_000_000) {
    throw new UniversalCharacterError('wealth must be an integer from 0 to 1000000000');
  }
  const extensions = input.extensions.map((value, index) =>
    validateExtensionValueSet(value, index),
  );
  if (extensions.length > 16) throw new UniversalCharacterError('extensions exceed the limit');
  requireUnique(
    extensions.map(({ namespace }) => namespace),
    'Extension namespaces',
  );
  const traits = input.traits.map((trait, index) =>
    Object.freeze({
      id: trait.id,
      name: requireText(trait.name, `traits[${index}].name`, 120),
      description: requireText(trait.description, `traits[${index}].description`, 4_000),
    }),
  );
  if (traits.length > 32) throw new UniversalCharacterError('traits exceed the limit');
  requireUnique(
    traits.map(({ id }) => id),
    'Trait ids',
  );
  return Object.freeze({
    ...input,
    kind: 'UNIVERSAL_CHARACTER_PROFILE',
    name: requireText(input.name, 'name', 120),
    nickname: requireOptionalText(input.nickname, 'nickname', 120),
    gender: requireOptionalText(input.gender, 'gender', 120),
    identity: requireText(input.identity, 'identity', 1_000),
    ancestry: requireOptionalText(input.ancestry, 'ancestry', 240),
    birthplace: requireOptionalText(input.birthplace, 'birthplace', 240),
    socialClass: requireOptionalText(input.socialClass, 'socialClass', 240),
    faith: requireOptionalText(input.faith, 'faith', 240),
    appearance: requireText(input.appearance, 'appearance', 4_000, true),
    personality: requireText(input.personality, 'personality', 4_000, true),
    values: freezeTextList(input.values, 'values', 32),
    goals: freezeTextList(input.goals, 'goals', 32),
    fears: freezeTextList(input.fears, 'fears', 32),
    secrets: freezeTextList(input.secrets, 'secrets', 32),
    family: freezeTextList(input.family, 'family', 32),
    education: freezeTextList(input.education, 'education', 32),
    importantPeople: freezeTextList(input.importantPeople, 'importantPeople', 64),
    enemies: freezeTextList(input.enemies, 'enemies', 64),
    experiences: freezeTextList(input.experiences, 'experiences', 64),
    concept: requireText(input.concept, 'concept', 4_000),
    storyPreferences: freezeTextList(input.storyPreferences, 'storyPreferences', 32),
    contentBoundaries: freezeContentBoundaries(input.contentBoundaries),
    career: freezeCareer(input.career),
    attributes: createPlayerAttributes(input.attributes),
    derivedAttributes: freezeNamedValues(input.derivedAttributes, 'derivedAttributes', 64),
    skills: freezeTextList(input.skills, 'skills', 128),
    proficiencies: freezeTextList(input.proficiencies, 'proficiencies', 128),
    abilities: freezeTextList(input.abilities, 'abilities', 128),
    languages: freezeTextList(input.languages, 'languages', 64),
    equipmentIds: freezeIds(input.equipmentIds, 'equipmentIds', 256),
    reputations: freezeReputations(input.reputations),
    relationships: freezeRelationships(input.relationships),
    traits: Object.freeze(traits),
    statuses: freezeTextList(input.statuses, 'statuses', 128),
    legacyBackground: freezeBackground(input.legacyBackground),
    extensions: Object.freeze(extensions),
  });
}

export function validateCharacterExtensionValues(
  profile: UniversalCharacterProfile,
  definitions: readonly WorldCharacterExtensionDefinition[],
): void {
  const byNamespace = new Map(definitions.map((definition) => [definition.namespace, definition]));
  for (const extension of profile.extensions) {
    const definition = byNamespace.get(extension.namespace);
    if (definition === undefined) {
      throw new UniversalCharacterError(`Unknown character extension: ${extension.namespace}`);
    }
    if (definition.campaignId !== profile.campaignId) {
      throw new UniversalCharacterError('Character extension belongs to another campaign');
    }
    if (definition.schemaVersion !== extension.schemaVersion) {
      throw new UniversalCharacterError(`Unsupported extension schema: ${extension.namespace}`);
    }
    const fields = new Map(definition.fields.map((field) => [field.key, field]));
    for (const key of Object.keys(extension.values)) {
      if (!fields.has(key)) {
        throw new UniversalCharacterError(`Unknown field ${extension.namespace}.${key}`);
      }
    }
    for (const field of definition.fields) {
      const value = extension.values[field.key];
      if (value === undefined) {
        if (field.required) {
          throw new UniversalCharacterError(`Missing field ${extension.namespace}.${field.key}`);
        }
        continue;
      }
      validateFieldValue(field, value, extension.namespace);
    }
  }
}

export function projectUniversalCharacterToV02(
  profile: UniversalCharacterProfile,
): PlayerCharacter {
  const archetype = profile.career.legacyArchetype;
  const firstTrait = profile.traits[0];
  const secondTrait = profile.traits[1];
  if (
    archetype === null ||
    profile.traits.length !== 2 ||
    firstTrait === undefined ||
    secondTrait === undefined
  ) {
    throw new UniversalCharacterError('Character cannot be represented by the V0.2 schema');
  }
  return Object.freeze({
    id: profile.id,
    campaignId: profile.campaignId,
    name: profile.name,
    gender: profile.gender,
    age: profile.age,
    concept: profile.concept,
    storyPreferences: profile.storyPreferences,
    contentBoundaries: profile.contentBoundaries,
    classArchetype: archetype,
    classDisplayName: profile.career.displayName,
    attributes: profile.attributes,
    traits: Object.freeze([firstTrait, secondTrait] as const),
    personalGoal: profile.goals[0] ?? profile.concept,
    background: profile.legacyBackground,
    initialEquipment: Object.freeze(
      profile.equipmentIds.map((itemId) => Object.freeze({ itemId })),
    ),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  });
}

function validateField(
  field: CharacterExtensionFieldDefinition,
  index: number,
): CharacterExtensionFieldDefinition {
  const base = {
    key: requireFieldKey(field.key),
    label: requireText(field.label, `fields[${index}].label`, 120),
    required: requireBoolean(field.required, `fields[${index}].required`),
  };
  if (field.type === 'TEXT') {
    return Object.freeze({
      ...base,
      type: field.type,
      maxLength: requireRangeInteger(field.maxLength, 1, 4_000, 'maxLength'),
    });
  }
  if (field.type === 'INTEGER' || field.type === 'NUMBER') {
    if (
      !Number.isFinite(field.minimum) ||
      !Number.isFinite(field.maximum) ||
      field.minimum > field.maximum
    ) {
      throw new UniversalCharacterError(`fields[${index}] numeric bounds are invalid`);
    }
    return Object.freeze({
      ...base,
      type: field.type,
      minimum: field.minimum,
      maximum: field.maximum,
    });
  }
  if (field.type === 'BOOLEAN') return Object.freeze({ ...base, type: field.type });
  if (field.type === 'ENUM') {
    const options = freezeTextList(field.options, `fields[${index}].options`, 64, 120);
    if (options.length < 2) throw new UniversalCharacterError('ENUM requires at least two options');
    return Object.freeze({ ...base, type: field.type, options });
  }
  if (field.type === 'TEXT_LIST') {
    return Object.freeze({
      ...base,
      type: field.type,
      maxItems: requireRangeInteger(field.maxItems, 1, 128, 'maxItems'),
      itemMaxLength: requireRangeInteger(field.itemMaxLength, 1, 4_000, 'itemMaxLength'),
    });
  }
  throw new UniversalCharacterError(`fields[${index}].type is unsupported`);
}

function validateFieldValue(
  field: CharacterExtensionFieldDefinition,
  value: JsonValue,
  namespace: string,
): void {
  const label = `${namespace}.${field.key}`;
  if (field.type === 'TEXT') {
    if (typeof value !== 'string' || value.length === 0 || value.length > field.maxLength) {
      throw new UniversalCharacterError(`${label} must be bounded text`);
    }
    return;
  }
  if (field.type === 'INTEGER' || field.type === 'NUMBER') {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < field.minimum ||
      value > field.maximum ||
      (field.type === 'INTEGER' && !Number.isSafeInteger(value))
    ) {
      throw new UniversalCharacterError(`${label} is outside its numeric bounds`);
    }
    return;
  }
  if (field.type === 'BOOLEAN') {
    if (typeof value !== 'boolean') throw new UniversalCharacterError(`${label} must be boolean`);
    return;
  }
  if (field.type === 'ENUM') {
    if (typeof value !== 'string' || !field.options.includes(value)) {
      throw new UniversalCharacterError(`${label} is not an allowed enum value`);
    }
    return;
  }
  if (field.type !== 'TEXT_LIST') {
    throw new UniversalCharacterError(`${label} has an unsupported field type`);
  }
  if (
    !Array.isArray(value) ||
    value.length > field.maxItems ||
    value.some(
      (item) => typeof item !== 'string' || item.length === 0 || item.length > field.itemMaxLength,
    )
  ) {
    throw new UniversalCharacterError(`${label} must be a bounded text list`);
  }
}

function validateExtensionValueSet(
  value: CharacterExtensionValueSet,
  index: number,
): CharacterExtensionValueSet {
  requireVersion(value.schemaVersion, `extensions[${index}]`);
  const entries = Object.entries(value.values);
  if (entries.length > 32)
    throw new UniversalCharacterError(`extensions[${index}] has too many values`);
  const values = Object.fromEntries(
    entries.map(([key, entry]) => [
      requireFieldKey(key),
      freezeJson(entry, `extensions[${index}].${key}`),
    ]),
  );
  return Object.freeze({
    namespace: requireNamespace(value.namespace),
    schemaVersion: 1,
    values: Object.freeze(values),
  });
}

function freezeCareer(value: UniversalCharacterCareer): UniversalCharacterCareer {
  if (value.legacyArchetype !== null && !CLASS_ARCHETYPES.includes(value.legacyArchetype)) {
    throw new UniversalCharacterError('career.legacyArchetype is invalid');
  }
  return Object.freeze({
    id: requireOptionalText(value.id, 'career.id', 256),
    displayName: requireText(value.displayName, 'career.displayName', 240),
    legacyArchetype: value.legacyArchetype,
  });
}

function freezeNamedValues(
  values: readonly NamedCharacterValue[],
  label: string,
  max: number,
): readonly NamedCharacterValue[] {
  if (values.length > max) throw new UniversalCharacterError(`${label} exceeds the limit`);
  requireUnique(
    values.map(({ key }) => key),
    `${label} keys`,
  );
  return Object.freeze(
    values.map(({ key, value }, index) => {
      if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000)
        throw new UniversalCharacterError(`${label}[${index}].value is invalid`);
      return Object.freeze({ key: requireFieldKey(key), value });
    }),
  );
}

function freezeReputations(values: readonly CharacterReputation[]): readonly CharacterReputation[] {
  if (values.length > 128) throw new UniversalCharacterError('reputations exceed the limit');
  requireUnique(
    values.map(({ entityId }) => entityId),
    'Reputation entity ids',
  );
  return Object.freeze(
    values.map((value, index) => {
      if (!Number.isInteger(value.score) || value.score < -100 || value.score > 100)
        throw new UniversalCharacterError(`reputations[${index}].score is invalid`);
      return Object.freeze({
        entityId: requireText(value.entityId, `reputations[${index}].entityId`, 256),
        score: value.score,
        summary: requireText(value.summary, `reputations[${index}].summary`, 1_000, true),
      });
    }),
  );
}

function freezeRelationships(
  values: readonly CharacterRelationshipSummary[],
): readonly CharacterRelationshipSummary[] {
  if (values.length > 128) throw new UniversalCharacterError('relationships exceed the limit');
  return Object.freeze(
    values.map((value, index) =>
      Object.freeze({
        entityId: requireText(value.entityId, `relationships[${index}].entityId`, 256),
        kind: requireText(value.kind, `relationships[${index}].kind`, 120),
        summary: requireText(value.summary, `relationships[${index}].summary`, 1_000, true),
      }),
    ),
  );
}

function freezeContentBoundaries(value: ContentBoundaries): ContentBoundaries {
  const keys = [
    'allowHorror',
    'allowPermanentDeath',
    'allowRomance',
    'allowBetrayal',
    'excludedContent',
  ] as const;
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) {
    throw new UniversalCharacterError('contentBoundaries has unknown or missing fields');
  }
  requireBoolean(value.allowHorror, 'contentBoundaries.allowHorror');
  requireBoolean(value.allowPermanentDeath, 'contentBoundaries.allowPermanentDeath');
  requireBoolean(value.allowRomance, 'contentBoundaries.allowRomance');
  requireBoolean(value.allowBetrayal, 'contentBoundaries.allowBetrayal');
  return Object.freeze({
    ...value,
    excludedContent: freezeTextList(
      value.excludedContent,
      'contentBoundaries.excludedContent',
      128,
    ),
  });
}

function freezeBackground(value: CharacterBackground): CharacterBackground {
  return Object.freeze({
    birthplace: requireText(value.birthplace, 'legacyBackground.birthplace', 1_000, true),
    formativeExperience: requireText(
      value.formativeExperience,
      'legacyBackground.formativeExperience',
      4_000,
      true,
    ),
    adventureMotivation: requireText(
      value.adventureMotivation,
      'legacyBackground.adventureMotivation',
      4_000,
      true,
    ),
    secret: requireText(value.secret, 'legacyBackground.secret', 4_000, true),
    importantPerson: requireText(
      value.importantPerson,
      'legacyBackground.importantPerson',
      1_000,
      true,
    ),
    tavernArrivalReason: requireText(
      value.tavernArrivalReason,
      'legacyBackground.tavernArrivalReason',
      4_000,
      true,
    ),
  });
}

function freezeIds<Value extends string>(
  values: readonly Value[],
  label: string,
  max: number,
): readonly Value[] {
  if (values.length > max) throw new UniversalCharacterError(`${label} exceeds the limit`);
  requireUnique(values, label);
  return Object.freeze(
    values.map((value, index) => requireText(value, `${label}[${index}]`, 256) as Value),
  );
}

function freezeTextList(
  values: readonly string[],
  label: string,
  max: number,
  maxLength = 4_000,
): readonly string[] {
  if (values.length > max) throw new UniversalCharacterError(`${label} exceeds the limit`);
  const result = values.map((value, index) => requireText(value, `${label}[${index}]`, maxLength));
  requireUnique(result, label);
  return Object.freeze(result);
}

function requireText(value: string, label: string, max: number, allowEmpty = false): string {
  if ((!allowEmpty && value.length === 0) || value.trim() !== value || value.length > max) {
    throw new UniversalCharacterError(
      `${label} must be bounded text without surrounding whitespace`,
    );
  }
  return value;
}

function requireOptionalText(value: string | null, label: string, max: number): string | null {
  return value === null ? null : requireText(value, label, max);
}

function requireNamespace(value: string): string {
  if (!/^[a-z][a-z0-9.-]{0,63}$/u.test(value))
    throw new UniversalCharacterError('Extension namespace is invalid');
  return value;
}

function requireFieldKey(value: string): string {
  if (!/^[a-z][A-Za-z0-9]{0,63}$/u.test(value))
    throw new UniversalCharacterError(`Extension field key is invalid: ${value}`);
  return value;
}

function requireRevision(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000_000)
    throw new UniversalCharacterError(`${label} must be a positive revision`);
}

function requireVersion(value: number, label: string): void {
  if (value !== 1) throw new UniversalCharacterError(`${label} schema version is unsupported`);
}

function requireTimestamp(value: IsoTimestamp, label: string): void {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value)
    throw new UniversalCharacterError(`${label} must be an ISO timestamp`);
}

function requireRangeInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new UniversalCharacterError(`${label} is outside its bounds`);
  return value;
}

function requireBoolean(value: boolean, label: string): boolean {
  if (typeof value !== 'boolean') throw new UniversalCharacterError(`${label} must be boolean`);
  return value;
}

function requireUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length)
    throw new UniversalCharacterError(`${label} must be unique`);
}

function freezeJson(value: JsonValue, label: string, seen = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new UniversalCharacterError(`${label} contains a non-finite number`);
    return value;
  }
  if (seen.has(value)) throw new UniversalCharacterError(`${label} contains a cycle`);
  seen.add(value);
  if (Array.isArray(value))
    return Object.freeze(
      value.map((entry, index) => freezeJson(entry, `${label}[${index}]`, seen)),
    );
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        freezeJson(entry, `${label}.${key}`, seen),
      ]),
    ),
  );
}
