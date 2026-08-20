import { describe, expect, it } from 'vitest';

import {
  campaignId,
  characterTraitId,
  createUniversalCharacterProfile,
  createWorldCharacterExtensionDefinition,
  isoTimestamp,
  itemId,
  playerCharacterId,
  projectUniversalCharacterToV02,
  validateCharacterExtensionValues,
  validateCharacterExtensionDraftValues,
  validateCompleteCharacterExtensionValues,
  type CharacterExtensionFieldDefinition,
  type JsonValue,
  type UniversalCharacterProfile,
  type WorldCharacterExtensionDefinition,
} from './index.js';

const now = isoTimestamp('2026-08-19T13:00:00.000Z');

const worldFixtures = [
  {
    namespace: 'cultivation',
    displayName: '修仙角色字段',
    fields: [
      enumField('spiritRoot', '灵根', ['金', '木', '水', '火', '土', '变异']),
      enumField('realm', '境界', ['炼气', '筑基', '金丹']),
      textField('sect', '宗门'),
    ],
    values: { spiritRoot: '火', realm: '筑基', sect: '烬霄宗' },
  },
  {
    namespace: 'investigation',
    displayName: '调查角色字段',
    fields: [
      integerField('sanity', '理智', 0, 100),
      integerField('luck', '幸运', 0, 100),
      integerField('credit', '信用', 0, 100),
    ],
    values: { sanity: 63, luck: 47, credit: 35 },
  },
  {
    namespace: 'cyberpunk',
    displayName: '赛博朋克角色字段',
    fields: [
      {
        key: 'cyberware',
        label: '义体',
        required: true,
        type: 'TEXT_LIST',
        maxItems: 16,
        itemMaxLength: 200,
      },
      integerField('neuralLoad', '神经负荷', 0, 100),
      integerField('streetCred', '街头声望', -100, 100),
    ],
    values: { cyberware: ['夜视义眼', '低延迟神经桥'], neuralLoad: 28, streetCred: 12 },
  },
] as const;

describe('Universal Character Schema', () => {
  it.each(worldFixtures)(
    'validates the $namespace world fixture without hard-coding it into core fields',
    (fixture) => {
      const campaign = campaignId(`campaign-${fixture.namespace}`);
      const definition = extension(campaign, fixture);
      const profile = character(campaign, fixture.namespace, fixture.values);

      expect(() => validateCharacterExtensionValues(profile, [definition])).not.toThrow();
      expect(profile.extensions[0]).toEqual({
        namespace: fixture.namespace,
        schemaVersion: 1,
        values: fixture.values,
      });
    },
  );

  it('projects a compatible profile back to the exact V0.2 contract', () => {
    const campaign = campaignId('campaign-v02-projection');
    const profile = character(campaign, 'investigation', { sanity: 70, luck: 50, credit: 25 });
    const projected = projectUniversalCharacterToV02(profile);

    expect(projected).toMatchObject({
      id: profile.id,
      campaignId: campaign,
      name: 'Mira Vale',
      classArchetype: 'SCHOLAR',
      classDisplayName: 'World Walker',
      personalGoal: 'Find the ember road.',
      initialEquipment: [{ itemId: 'item-lantern' }],
    });
    expect(projected.traits).toHaveLength(2);
  });

  it('keeps legacy profiles readable while requiring declared extensions for new confirmation', () => {
    const campaign = campaignId('campaign-extension-compatibility');
    const definition = extension(campaign, worldFixtures[1]);
    const profile = createUniversalCharacterProfile({
      ...character(campaign, 'investigation', { sanity: 70, luck: 50, credit: 25 }),
      extensions: [],
    });

    expect(() => validateCharacterExtensionValues(profile, [definition])).not.toThrow();
    expect(() => validateCompleteCharacterExtensionValues(profile, [definition])).toThrow(
      'Missing field investigation.sanity',
    );
  });

  it('allows an in-progress extension draft to populate one field at a time', () => {
    const campaign = campaignId('campaign-extension-draft');
    const definition = extension(campaign, worldFixtures[1]);
    const partial = character(campaign, 'investigation', { sanity: 70 });

    expect(() => validateCharacterExtensionDraftValues(partial, [definition])).not.toThrow();
    expect(() => validateCharacterExtensionValues(partial, [definition])).toThrow('Missing field');
  });

  it('rejects unknown extension namespaces, versions, fields and values outside definitions', () => {
    const campaign = campaignId('campaign-extension-reject');
    const definition = extension(campaign, worldFixtures[1]);
    expect(() =>
      validateCharacterExtensionValues(character(campaign, 'unknown', { value: true }), [
        definition,
      ]),
    ).toThrow('Unknown character extension');
    expect(() =>
      validateCharacterExtensionValues(
        character(campaign, 'investigation', { sanity: 101, luck: 50, credit: 25 }),
        [definition],
      ),
    ).toThrow('numeric bounds');
    expect(() =>
      validateCharacterExtensionValues(
        character(campaign, 'investigation', { sanity: 70, luck: 50 }),
        [definition],
      ),
    ).toThrow('Missing field');
    expect(() =>
      validateCharacterExtensionValues(
        character(campaign, 'investigation', {
          sanity: 70,
          luck: 50,
          credit: 25,
          hiddenPower: 999,
        }),
        [definition],
      ),
    ).toThrow('Unknown field');
    expect(() =>
      createUniversalCharacterProfile({
        ...character(campaign, 'investigation', { sanity: 70, luck: 50, credit: 25 }),
        schemaVersion: 2,
      } as unknown as Omit<UniversalCharacterProfile, 'kind'>),
    ).toThrow('schema version is unsupported');
  });

  it('enforces collection, field and V0.2 projection resource boundaries', () => {
    const campaign = campaignId('campaign-character-limits');
    const profile = character(campaign, 'investigation', { sanity: 70, luck: 50, credit: 25 });
    expect(() =>
      createUniversalCharacterProfile({
        ...profile,
        skills: Array.from({ length: 129 }, (_, index) => `skill-${index}`),
      }),
    ).toThrow('skills exceeds the limit');
    expect(() =>
      createWorldCharacterExtensionDefinition({
        ...extension(campaign, worldFixtures[1]),
        fields: Array.from({ length: 33 }, (_, index) => textField(`field${index}`, 'Field')),
      }),
    ).toThrow('1 to 32');
    expect(() =>
      projectUniversalCharacterToV02(createUniversalCharacterProfile({ ...profile, traits: [] })),
    ).toThrow('cannot be represented');
  });
});

function character(
  campaign: ReturnType<typeof campaignId>,
  namespace: string,
  values: Readonly<Record<string, JsonValue>>,
): UniversalCharacterProfile {
  return createUniversalCharacterProfile({
    schemaVersion: 1,
    revision: 1,
    id: playerCharacterId(`character-${namespace}`),
    campaignId: campaign,
    name: 'Mira Vale',
    nickname: 'Ember',
    gender: null,
    age: 27,
    identity: 'A scholar following roads between worlds.',
    ancestry: 'Human',
    birthplace: 'Ember Harbor',
    socialClass: 'Wandering scholar',
    faith: null,
    appearance: 'A soot-dark coat and a brass compass.',
    personality: 'Curious, measured, and unwilling to abandon a mystery.',
    values: ['Truth', 'Chosen family'],
    goals: ['Find the ember road.'],
    fears: ['Becoming trapped between worlds.'],
    secrets: ['The compass answers to her blood.'],
    family: ['The Vale household'],
    education: ['Harbor Academy'],
    importantPeople: ['Professor Aven'],
    enemies: ['The Ash Cartographer'],
    experiences: ['Survived a skyquake.'],
    concept: 'A world-walking scholar.',
    storyPreferences: ['Exploration'],
    contentBoundaries: {
      allowHorror: true,
      allowPermanentDeath: false,
      allowRomance: true,
      allowBetrayal: true,
      excludedContent: ['Graphic cruelty'],
    },
    career: { id: null, displayName: 'World Walker', legacyArchetype: 'SCHOLAR' },
    attributes: { physique: 1, agility: 2, knowledge: 5, charisma: 2 },
    derivedAttributes: [{ key: 'resolve', value: 4 }],
    skills: ['Investigation'],
    proficiencies: ['Cartography'],
    abilities: ['Read the road'],
    languages: ['Common'],
    wealth: 12,
    equipmentIds: [itemId('item-lantern')],
    reputations: [{ entityId: 'faction-guild', score: 10, summary: 'Trusted novice.' }],
    relationships: [{ entityId: 'npc-aven', kind: 'MENTOR', summary: 'Missing mentor.' }],
    traits: [
      {
        id: characterTraitId('trait-observant'),
        name: 'Observant',
        description: 'Notices small inconsistencies.',
      },
      {
        id: characterTraitId('trait-restless'),
        name: 'Restless',
        description: 'Cannot leave a mystery alone.',
      },
    ],
    statuses: ['READY'],
    legacyBackground: {
      birthplace: 'Ember Harbor',
      formativeExperience: 'Survived a skyquake.',
      adventureMotivation: 'Find the ember road.',
      secret: 'The compass answers to her blood.',
      importantPerson: 'Professor Aven',
      tavernArrivalReason: 'Following the compass.',
    },
    extensions: [{ namespace, schemaVersion: 1, values }],
    createdAt: now,
    updatedAt: now,
  });
}

function extension(
  campaign: ReturnType<typeof campaignId>,
  fixture: (typeof worldFixtures)[number],
): WorldCharacterExtensionDefinition {
  return createWorldCharacterExtensionDefinition({
    schemaVersion: 1,
    campaignId: campaign,
    namespace: fixture.namespace,
    displayName: fixture.displayName,
    constitutionRevision: 1,
    fields: fixture.fields,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
}

function textField(key: string, label: string): CharacterExtensionFieldDefinition {
  return { key, label, required: true, type: 'TEXT', maxLength: 240 };
}

function integerField(
  key: string,
  label: string,
  minimum: number,
  maximum: number,
): CharacterExtensionFieldDefinition {
  return { key, label, required: true, type: 'INTEGER', minimum, maximum };
}

function enumField(
  key: string,
  label: string,
  options: readonly string[],
): CharacterExtensionFieldDefinition {
  return { key, label, required: true, type: 'ENUM', options };
}
