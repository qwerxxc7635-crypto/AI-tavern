import {
  characterTraitPointNet,
  characterTraitId,
  validateCharacterExtensionDraftValues,
  type UniversalCharacterDraft,
  type WorldCharacterExtensionDefinition,
} from '@ember-tavern/contracts';

export const CHARACTER_AI_SECTIONS = [
  'IDENTITY',
  'INNER_LIFE',
  'CAREER',
  'TRAITS',
  'BACKGROUND',
  'BOUNDARIES',
  'EXTENSIONS',
] as const;

export type CharacterAISection = (typeof CHARACTER_AI_SECTIONS)[number];
export type CharacterAIFieldKind = 'TEXT' | 'TEXT_LIST';

export interface CharacterAIFieldDefinition {
  readonly path: string;
  readonly label: string;
  readonly kind: CharacterAIFieldKind;
  readonly section: CharacterAISection;
}

export interface CharacterAIUpdate {
  readonly path: string;
  readonly value: string | readonly string[];
}

const fields = (
  section: CharacterAISection,
  kind: CharacterAIFieldKind,
  values: readonly (readonly [path: string, label: string])[],
): readonly CharacterAIFieldDefinition[] =>
  values.map(([path, label]) => Object.freeze({ path, label, kind, section }));

export const UNIVERSAL_CHARACTER_AI_FIELDS = Object.freeze([
  ...fields('IDENTITY', 'TEXT', [
    ['name', '姓名'],
    ['nickname', '昵称'],
    ['gender', '性别'],
    ['identity', '身份'],
    ['ancestry', '种族 / 族群'],
    ['birthplace', '出生地'],
    ['socialClass', '阶层'],
    ['faith', '信仰'],
    ['appearance', '外貌'],
    ['personality', '性格'],
    ['concept', '角色概念'],
  ]),
  ...fields('INNER_LIFE', 'TEXT_LIST', [
    ['values', '价值观'],
    ['goals', '目标'],
    ['fears', '恐惧'],
    ['secrets', '秘密'],
    ['family', '家庭'],
    ['education', '教育'],
    ['importantPeople', '重要人物'],
    ['enemies', '敌人'],
    ['experiences', '经历'],
    ['storyPreferences', '故事偏好'],
  ]),
  ...fields('CAREER', 'TEXT_LIST', [
    ['proficiencies', '熟练'],
    ['abilities', '能力'],
    ['languages', '语言'],
  ]),
  ...fields('TRAITS', 'TEXT', [
    ['traits.0.name', '特质 1 名称'],
    ['traits.0.description', '特质 1 描述'],
    ['traits.1.name', '特质 2 名称'],
    ['traits.1.description', '特质 2 描述'],
  ]),
  ...fields('BACKGROUND', 'TEXT', [
    ['legacyBackground.birthplace', '兼容出生地'],
    ['legacyBackground.formativeExperience', '成长经历'],
    ['legacyBackground.adventureMotivation', '冒险动机'],
    ['legacyBackground.secret', '背景秘密'],
    ['legacyBackground.importantPerson', '背景重要人物'],
    ['legacyBackground.tavernArrivalReason', '来到酒馆的原因'],
  ]),
  ...fields('BOUNDARIES', 'TEXT_LIST', [['contentBoundaries.excludedContent', '排除内容']]),
]);

export const UNIVERSAL_CHARACTER_TRAIT_EFFECT_AI_FIELDS = Object.freeze(
  fields('TRAITS', 'TEXT', [
    ['traits.0.pointProfile.positiveEffect', '特质 1 正面效果'],
    ['traits.0.pointProfile.negativeEffect', '特质 1 负面效果'],
    ['traits.1.pointProfile.positiveEffect', '特质 2 正面效果'],
    ['traits.1.pointProfile.negativeEffect', '特质 2 负面效果'],
  ]),
);

export function characterAIFields(
  definitions: readonly WorldCharacterExtensionDefinition[],
  draft?: UniversalCharacterDraft,
): readonly CharacterAIFieldDefinition[] {
  const dynamic = definitions.flatMap((definition) =>
    definition.fields.flatMap((field) =>
      field.type === 'TEXT' || field.type === 'TEXT_LIST'
        ? [
            Object.freeze({
              path: `extensions.${definition.namespace}.${field.key}`,
              label: `${definition.displayName} · ${field.label}`,
              kind: field.type,
              section: 'EXTENSIONS' as const,
            }),
          ]
        : [],
    ),
  );
  const traitEffects = UNIVERSAL_CHARACTER_TRAIT_EFFECT_AI_FIELDS.filter(({ path }) => {
    if (draft === undefined) return true;
    const [, indexValue, , effect] = path.split('.');
    const trait = draft.traits[Number(indexValue)];
    if (trait === undefined) return false;
    const type = trait.pointProfile?.type ?? 'NARRATIVE';
    return effect === 'positiveEffect'
      ? type === 'BUFF' || type === 'MIXED'
      : type === 'DEBUFF' || type === 'MIXED';
  });
  return Object.freeze([...UNIVERSAL_CHARACTER_AI_FIELDS, ...traitEffects, ...dynamic]);
}

export function requireCharacterAIField(
  definitions: readonly WorldCharacterExtensionDefinition[],
  path: string,
  draft?: UniversalCharacterDraft,
): CharacterAIFieldDefinition {
  const field = characterAIFields(definitions, draft).find((candidate) => candidate.path === path);
  if (field === undefined) throw new CharacterDraftAIError('FIELD_NOT_EDITABLE');
  return field;
}

export function characterAIValue(
  draft: UniversalCharacterDraft,
  field: CharacterAIFieldDefinition,
): string | readonly string[] {
  const value = readPath(draft, field.path);
  if (field.kind === 'TEXT_LIST') {
    if (value === undefined || value === null) return Object.freeze([]);
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      throw new CharacterDraftAIError('FIELD_VALUE_INVALID');
    }
    return Object.freeze([...value]);
  }
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new CharacterDraftAIError('FIELD_VALUE_INVALID');
  return value;
}

export function isCharacterAIFieldEmpty(
  draft: UniversalCharacterDraft,
  field: CharacterAIFieldDefinition,
): boolean {
  const value = characterAIValue(draft, field);
  return typeof value === 'string' ? value.trim().length === 0 : value.length === 0;
}

export function isCharacterAIFieldLocked(path: string, lockedFields: readonly string[]): boolean {
  return lockedFields.some((locked) => path === locked || path.startsWith(`${locked}.`));
}

export function applyCharacterAIUpdates(
  draft: UniversalCharacterDraft,
  updates: readonly CharacterAIUpdate[],
  definitions: readonly WorldCharacterExtensionDefinition[],
  lockedFields: readonly string[],
): UniversalCharacterDraft {
  if (updates.length === 0 || updates.length > 64) {
    throw new CharacterDraftAIError('PATCH_SIZE_INVALID');
  }
  if (new Set(updates.map(({ path }) => path)).size !== updates.length) {
    throw new CharacterDraftAIError('PATCH_PATH_DUPLICATE');
  }
  const mutable = cloneRecord(draft);
  for (const update of updates) {
    const field = requireCharacterAIField(definitions, update.path, draft);
    if (isCharacterAIFieldLocked(update.path, lockedFields)) {
      throw new CharacterDraftAIError('LOCKED_FIELD_CHANGED');
    }
    validateUpdateValue(field, update.value);
    writePath(mutable, update.path, update.value, draft.id);
  }
  let next: UniversalCharacterDraft;
  try {
    next = Object.freeze({
      kind: 'UNIVERSAL_CHARACTER_DRAFT',
      ...mutable,
    }) as unknown as UniversalCharacterDraft;
    validateCharacterExtensionDraftValues(next, definitions);
    characterTraitPointNet(next.traits);
  } catch (cause) {
    throw new CharacterDraftAIError('PATCH_INVALID', { cause });
  }
  assertRuleAuthorityPreserved(draft, next, definitions);
  return next;
}

export class CharacterDraftAIError extends Error {
  public constructor(
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super(`Character draft AI operation rejected: ${code}`, options);
    this.name = 'CharacterDraftAIError';
  }
}

function validateUpdateValue(
  field: CharacterAIFieldDefinition,
  value: string | readonly string[],
): void {
  if (field.kind === 'TEXT') {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 4_000) {
      throw new CharacterDraftAIError('PATCH_VALUE_INVALID');
    }
    return;
  }
  if (
    !Array.isArray(value) ||
    value.length > 30 ||
    value.some(
      (entry) =>
        typeof entry !== 'string' ||
        entry.trim().length === 0 ||
        entry.trim() !== entry ||
        entry.length > 4_000,
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new CharacterDraftAIError('PATCH_VALUE_INVALID');
  }
}

function cloneRecord(value: unknown): Record<string, unknown> {
  const cloned: unknown = JSON.parse(JSON.stringify(value));
  if (!isRecord(cloned)) throw new CharacterDraftAIError('DRAFT_INVALID');
  delete cloned['kind'];
  return cloned;
}

function readPath(draft: UniversalCharacterDraft, path: string): unknown {
  if (path.startsWith('extensions.')) {
    const [, namespace, key] = path.split('.');
    return draft.extensions.find((extension) => extension.namespace === namespace)?.values[
      key ?? ''
    ];
  }
  let current: unknown = draft;
  for (const segment of path.split('.')) {
    if (Array.isArray(current)) current = current[Number(segment)];
    else if (isRecord(current)) current = current[segment];
    else return undefined;
  }
  return current;
}

function writePath(
  draft: Record<string, unknown>,
  path: string,
  value: string | readonly string[],
  characterId: string,
): void {
  if (path.startsWith('extensions.')) {
    const [, namespace, key] = path.split('.');
    if (namespace === undefined || key === undefined)
      throw new CharacterDraftAIError('PATH_INVALID');
    const extensions = Array.isArray(draft['extensions']) ? draft['extensions'] : [];
    let extension = extensions.find(
      (candidate) => isRecord(candidate) && candidate['namespace'] === namespace,
    );
    if (!isRecord(extension)) {
      extension = { namespace, schemaVersion: 1, values: {} };
      extensions.push(extension);
      draft['extensions'] = extensions;
    }
    const values = isRecord(extension['values']) ? extension['values'] : {};
    values[key] = Array.isArray(value) ? [...value] : value;
    extension['values'] = values;
    return;
  }
  const segments = path.split('.');
  if (segments[0] === 'traits') {
    const index = Number(segments[1]);
    const key = segments[2];
    const pointEffect = key === 'pointProfile' ? segments[3] : undefined;
    if (
      ![0, 1].includes(index) ||
      (!['name', 'description'].includes(key ?? '') &&
        !['positiveEffect', 'negativeEffect'].includes(pointEffect ?? ''))
    ) {
      throw new CharacterDraftAIError('PATH_INVALID');
    }
    const traits = Array.isArray(draft['traits']) ? draft['traits'] : [];
    while (traits.length <= index) {
      const traitIndex = traits.length;
      traits.push({
        id: characterTraitId(`draft-trait-${characterId}-${traitIndex + 1}`),
        name: '',
        description: '',
      });
    }
    const trait = traits[index];
    if (!isRecord(trait) || key === undefined) throw new CharacterDraftAIError('PATH_INVALID');
    if (key === 'pointProfile') {
      const pointProfile = trait['pointProfile'];
      if (!isRecord(pointProfile) || pointEffect === undefined) {
        throw new CharacterDraftAIError('PATH_INVALID');
      }
      pointProfile[pointEffect] = value;
    } else trait[key] = value;
    draft['traits'] = traits.slice(0, 2);
    return;
  }
  let current = draft;
  for (const segment of segments.slice(0, -1)) {
    const child = current[segment];
    if (!isRecord(child)) throw new CharacterDraftAIError('PATH_INVALID');
    current = child;
  }
  const final = segments.at(-1);
  if (final === undefined) throw new CharacterDraftAIError('PATH_INVALID');
  current[final] = Array.isArray(value) ? [...value] : value;
}

function assertRuleAuthorityPreserved(
  before: UniversalCharacterDraft,
  after: UniversalCharacterDraft,
  definitions: readonly WorldCharacterExtensionDefinition[],
): void {
  const protectedValues = (draft: UniversalCharacterDraft) => ({
    age: draft.age,
    boundaryRules: {
      allowHorror: draft.contentBoundaries.allowHorror,
      allowPermanentDeath: draft.contentBoundaries.allowPermanentDeath,
      allowRomance: draft.contentBoundaries.allowRomance,
      allowBetrayal: draft.contentBoundaries.allowBetrayal,
    },
    career: { id: draft.career.id, legacyArchetype: draft.career.legacyArchetype },
    attributes: draft.attributes,
    derivedAttributes: draft.derivedAttributes,
    skills: draft.skills,
    wealth: draft.wealth,
    equipmentIds: draft.equipmentIds,
    reputations: draft.reputations,
    relationships: draft.relationships,
    statuses: draft.statuses,
    nonNarrativeExtensions: definitions.map((definition) => ({
      namespace: definition.namespace,
      values: Object.fromEntries(
        definition.fields
          .filter(({ type }) => type !== 'TEXT' && type !== 'TEXT_LIST')
          .map(({ key }) => [
            key,
            draft.extensions.find(({ namespace }) => namespace === definition.namespace)?.values[
              key
            ],
          ]),
      ),
    })),
  });
  if (JSON.stringify(protectedValues(before)) !== JSON.stringify(protectedValues(after))) {
    throw new CharacterDraftAIError('RULE_AUTHORITY_CHANGED');
  }
  assertTraitPointAuthorityPreserved(before, after);
}

function assertTraitPointAuthorityPreserved(
  before: UniversalCharacterDraft,
  after: UniversalCharacterDraft,
): void {
  const ruleProfile = (trait: UniversalCharacterDraft['traits'][number]) => {
    const profile = trait.pointProfile;
    if (profile === undefined) {
      return {
        type: 'NARRATIVE',
        buffPoints: 0,
        debuffPoints: 0,
        positiveBalance: null,
        negativeBalance: null,
      };
    }
    return {
      type: profile.type,
      buffPoints: profile.buffPoints,
      debuffPoints: profile.debuffPoints,
      positiveBalance: profile.positiveBalance ?? null,
      negativeBalance: profile.negativeBalance ?? null,
    };
  };
  for (const trait of after.traits) {
    const previous = before.traits.find(({ id }) => id === trait.id);
    const expected =
      previous === undefined
        ? {
            type: 'NARRATIVE',
            buffPoints: 0,
            debuffPoints: 0,
            positiveBalance: null,
            negativeBalance: null,
          }
        : ruleProfile(previous);
    if (JSON.stringify(ruleProfile(trait)) !== JSON.stringify(expected)) {
      throw new CharacterDraftAIError('RULE_AUTHORITY_CHANGED');
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
