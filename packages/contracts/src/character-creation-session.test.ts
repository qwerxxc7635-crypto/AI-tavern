import { describe, expect, it } from 'vitest';

import {
  campaignId,
  characterTraitId,
  generationRecordId,
  isoTimestamp,
  playerCharacterId,
} from './foundation.js';
import {
  cancelCharacterCreationSession,
  createCharacterCreationSession,
  createUniversalCharacterDraft,
  markCharacterCreationConfirmed,
  materializeUniversalCharacterProfile,
  prepareAdvancedCharacterDraft,
  restoreCharacterCreationSession,
  resumeCharacterCreationSession,
  saveCharacterCreationDraft,
  stageQuickCharacterDraft,
  switchCharacterCreationMode,
} from './character-creation-session.js';
import { createWorldCharacterExtensionDefinition } from './universal-character.js';

const campaignKey = campaignId('campaign-creation-v3');
const characterKey = playerCharacterId('character-creation-v3');
const at1 = isoTimestamp('2026-08-20T00:00:00.000Z');
const at2 = isoTimestamp('2026-08-20T00:01:00.000Z');
const at3 = isoTimestamp('2026-08-20T00:02:00.000Z');

const definitions = [
  createWorldCharacterExtensionDefinition({
    schemaVersion: 1,
    campaignId: campaignKey,
    namespace: 'cultivation',
    displayName: '修行根基',
    constitutionRevision: 3,
    fields: [
      { key: 'spiritRoot', label: '灵根', type: 'ENUM', required: true, options: ['火', '水'] },
      { key: 'sect', label: '宗门', type: 'TEXT', required: false, maxLength: 120 },
    ],
    revision: 1,
    createdAt: at1,
    updatedAt: at1,
  }),
] as const;

describe('character creation session', () => {
  it('switches Quick and Advanced without losing the draft or locked fields', () => {
    const initial = createCharacterCreationSession(
      {
        id: 'creation-session-1',
        campaignId: campaignKey,
        characterId: characterKey,
        constitutionRevision: 3,
        mode: 'QUICK',
        conceptInput: '被逐出宗门、仍坚持守诺的年轻剑修',
        draft: completeDraft(),
        createdAt: at1,
      },
      definitions,
    );
    const saved = saveCharacterCreationDraft(
      initial,
      { ...initial.draft, nickname: '小烬' },
      ['nickname', 'extensions.cultivation.spiritRoot'],
      definitions,
      at2,
    );
    const advanced = switchCharacterCreationMode(saved, 'ADVANCED', null, at3);

    expect(advanced.mode).toBe('ADVANCED');
    expect(advanced.draft.nickname).toBe('小烬');
    expect(advanced.lockedFields).toEqual(['extensions.cultivation.spiritRoot', 'nickname']);
    expect(advanced.revision).toBe(3);
  });

  it('rejects locked edits and an unknown dynamic extension lock', () => {
    const initial = createCharacterCreationSession(
      {
        id: 'creation-session-2',
        campaignId: campaignKey,
        characterId: characterKey,
        constitutionRevision: 3,
        mode: 'ADVANCED',
        conceptInput: null,
        draft: completeDraft(),
        createdAt: at1,
      },
      definitions,
    );
    const saved = saveCharacterCreationDraft(initial, initial.draft, ['name'], definitions, at2);

    expect(() =>
      saveCharacterCreationDraft(
        saved,
        { ...saved.draft, name: '另一个人' },
        saved.lockedFields,
        definitions,
        at3,
      ),
    ).toThrow(/Locked character field changed/);
    expect(() =>
      saveCharacterCreationDraft(
        initial,
        initial.draft,
        ['extensions.cultivation.unknown'],
        definitions,
        at2,
      ),
    ).toThrow(/Unknown locked character field/);
  });

  it('stages a complete Quick result and rejects incomplete or rule-owned output', () => {
    const initial = createCharacterCreationSession(
      {
        id: 'creation-session-3',
        campaignId: campaignKey,
        characterId: characterKey,
        constitutionRevision: 3,
        mode: 'QUICK',
        conceptInput: '守诺的年轻剑修',
        draft: blankDraft(),
        createdAt: at1,
      },
      definitions,
    );
    const ready = stageQuickCharacterDraft(
      initial,
      completeDraft(),
      generationRecordId('generation-quick-character'),
      definitions,
      at2,
    );

    expect(ready.status).toBe('READY_TO_CONFIRM');
    expect(materializeUniversalCharacterProfile(ready, definitions, at3)).toMatchObject({
      name: '沈烬',
      extensions: [{ namespace: 'cultivation', values: { spiritRoot: '火' } }],
    });
    expect(() =>
      stageQuickCharacterDraft(
        initial,
        { ...completeDraft(), appearance: '' },
        generationRecordId('generation-incomplete'),
        definitions,
        at2,
      ),
    ).toThrow(/not narratively complete/);
    expect(() =>
      stageQuickCharacterDraft(
        initial,
        { ...completeDraft(), wealth: 99 },
        generationRecordId('generation-rule-owned'),
        definitions,
        at2,
      ),
    ).toThrow(/local empty defaults/);
  });

  it('prepares Advanced, cancels, restores, resumes and confirms without losing data', () => {
    const initial = createCharacterCreationSession(
      {
        id: 'creation-session-4',
        campaignId: campaignKey,
        characterId: characterKey,
        constitutionRevision: 3,
        mode: 'ADVANCED',
        conceptInput: null,
        draft: completeDraft(),
        createdAt: at1,
      },
      definitions,
    );
    const ready = prepareAdvancedCharacterDraft(initial, definitions, at2);
    const cancelled = cancelCharacterCreationSession(ready, at3);
    const restored = restoreCharacterCreationSession(cancelled, definitions);
    const resumed = resumeCharacterCreationSession(
      restored,
      definitions,
      isoTimestamp('2026-08-20T00:03:00.000Z'),
    );
    const confirmed = markCharacterCreationConfirmed(
      resumed,
      definitions,
      isoTimestamp('2026-08-20T00:04:00.000Z'),
    );

    expect(restored.draft).toEqual(initial.draft);
    expect(resumed.status).toBe('READY_TO_CONFIRM');
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', revision: 5 });
  });

  it('does not treat a missing required extension namespace as a complete card', () => {
    const initial = createCharacterCreationSession(
      {
        id: 'creation-session-5',
        campaignId: campaignKey,
        characterId: characterKey,
        constitutionRevision: 3,
        mode: 'ADVANCED',
        conceptInput: null,
        draft: { ...completeDraft(), extensions: [] },
        createdAt: at1,
      },
      definitions,
    );

    expect(() => prepareAdvancedCharacterDraft(initial, definitions, at2)).toThrow(
      /Missing field cultivation.spiritRoot/,
    );
  });

  it('accepts an empty Trait collection but rejects any non-zero locally recomputed budget', () => {
    const empty = createCharacterCreationSession(
      {
        id: 'creation-session-empty-traits',
        campaignId: campaignKey,
        characterId: characterKey,
        constitutionRevision: 3,
        mode: 'ADVANCED',
        conceptInput: null,
        draft: { ...completeDraft(), traits: [] },
        createdAt: at1,
      },
      definitions,
    );
    expect(prepareAdvancedCharacterDraft(empty, definitions, at2).status).toBe('READY_TO_CONFIRM');

    const sourceTrait = completeDraft().traits[0];
    if (sourceTrait === undefined) throw new Error('fixture must include one Trait');
    const unbalanced = createCharacterCreationSession(
      {
        id: 'creation-session-unbalanced-traits',
        campaignId: campaignKey,
        characterId: characterKey,
        constitutionRevision: 3,
        mode: 'ADVANCED',
        conceptInput: null,
        draft: {
          ...completeDraft(),
          traits: [
            {
              ...sourceTrait,
              pointProfile: {
                type: 'BUFF',
                positiveEffect: '在黑暗中看清道路。',
                negativeEffect: null,
                buffPoints: -2,
                debuffPoints: 0,
              },
            },
          ],
        },
        createdAt: at1,
      },
      definitions,
    );
    expect(() => prepareAdvancedCharacterDraft(unbalanced, definitions, at2)).toThrow(
      /exactly zero/,
    );
  });
});

function blankDraft() {
  return createUniversalCharacterDraft({
    ...completeDraft(),
    name: '',
    identity: '',
    concept: '',
    appearance: '',
    personality: '',
    goals: [],
    traits: [],
    legacyBackground: {
      birthplace: '',
      formativeExperience: '',
      adventureMotivation: '',
      secret: '',
      importantPerson: '',
      tavernArrivalReason: '',
    },
    extensions: [],
  });
}

function completeDraft() {
  return createUniversalCharacterDraft({
    schemaVersion: 1,
    id: characterKey,
    campaignId: campaignKey,
    name: '沈烬',
    nickname: null,
    gender: null,
    age: 22,
    identity: '被逐出宗门的年轻剑修',
    ancestry: '人族',
    birthplace: '赤霞山脚',
    socialClass: '寒门',
    faith: null,
    appearance: '旧青袍上留着烧灼痕迹。',
    personality: '克制、守诺，但对不公极其固执。',
    values: ['承诺', '公正'],
    goals: ['查清师门旧案'],
    fears: ['再次牵连无辜'],
    secrets: ['曾私放被追捕的妖灵'],
    family: ['养父仍住在山脚村落'],
    education: ['赤霞剑宗外门'],
    importantPeople: ['养父沈伯'],
    enemies: ['戒律堂执事'],
    experiences: ['在禁林中救下一只妖灵'],
    concept: '守诺的流亡剑修',
    storyPreferences: ['调查', '关系抉择'],
    contentBoundaries: {
      allowHorror: true,
      allowPermanentDeath: false,
      allowRomance: true,
      allowBetrayal: true,
      excludedContent: ['虐待儿童'],
    },
    career: { id: null, displayName: '流亡剑修', legacyArchetype: 'WARRIOR' },
    attributes: { physique: 4, agility: 3, knowledge: 2, charisma: 1 },
    derivedAttributes: [],
    skills: [],
    proficiencies: ['剑术'],
    abilities: ['听风辨位'],
    languages: ['通用语'],
    wealth: 0,
    equipmentIds: [],
    reputations: [],
    relationships: [],
    traits: [
      {
        id: characterTraitId('trait-keeps-promises'),
        name: '一诺千金',
        description: '答应的事会尽力做到。',
      },
      {
        id: characterTraitId('trait-stubborn-justice'),
        name: '执拗公正',
        description: '面对不公时很难退让。',
      },
    ],
    statuses: [],
    legacyBackground: {
      birthplace: '赤霞山脚',
      formativeExperience: '因私放妖灵被逐出师门。',
      adventureMotivation: '寻找旧案证据并洗清污名。',
      secret: '妖灵仍会通过梦境联系他。',
      importantPerson: '养父沈伯',
      tavernArrivalReason: '追踪一封匿名信来到余烬酒馆。',
    },
    extensions: [{ namespace: 'cultivation', schemaVersion: 1, values: { spiritRoot: '火' } }],
  });
}
