import {
  campaignId,
  createUniversalCharacterDraft,
  createWorldCharacterExtensionDefinition,
  isoTimestamp,
  playerCharacterId,
} from '@ember-tavern/contracts';
import { describe, expect, it } from 'vitest';

import {
  applyCharacterAIUpdates,
  characterAIFields,
  isCharacterAIFieldLocked,
} from './universal-character-ai.js';

const campaign = campaignId('campaign-character-ai');
const character = playerCharacterId('character-character-ai');
const now = isoTimestamp('2026-08-20T08:00:00.000Z');
const definition = createWorldCharacterExtensionDefinition({
  schemaVersion: 1,
  campaignId: campaign,
  namespace: 'investigation',
  displayName: '调查',
  constitutionRevision: 1,
  fields: [
    { key: 'calling', label: '执念', required: false, type: 'TEXT', maxLength: 200 },
    { key: 'sanity', label: '理智', required: true, type: 'INTEGER', minimum: 0, maximum: 100 },
  ],
  revision: 1,
  createdAt: now,
  updatedAt: now,
});

describe('universal character AI patch boundary', () => {
  it('covers every common narrative field and only narrative extension types', () => {
    const paths = characterAIFields([definition]).map(({ path }) => path);
    expect(paths).toContain('name');
    expect(paths).toContain('traits.1.description');
    expect(paths).toContain('legacyBackground.tavernArrivalReason');
    expect(paths).toContain('extensions.investigation.calling');
    expect(paths).not.toContain('attributes.knowledge');
    expect(paths).not.toContain('extensions.investigation.sanity');
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('applies narrative updates while preserving every Rules-owned value', () => {
    const draft = fixture();
    const next = applyCharacterAIUpdates(
      draft,
      [
        { path: 'identity', value: 'A patient investigator.' },
        { path: 'goals', value: ['Find the vanished mentor'] },
        { path: 'traits.0.name', value: 'Observant' },
        { path: 'extensions.investigation.calling', value: 'Never abandon a cold trail.' },
      ],
      [definition],
      [],
    );
    expect(next).toMatchObject({
      identity: 'A patient investigator.',
      goals: ['Find the vanished mentor'],
      traits: [{ name: 'Observant' }],
      attributes: draft.attributes,
      wealth: 0,
      skills: [],
      extensions: [
        {
          namespace: 'investigation',
          values: { calling: 'Never abandon a cold trail.', sanity: 70 },
        },
      ],
    });
  });

  it('rejects locked, unknown, duplicate and rule-owned patch attempts', () => {
    const draft = fixture();
    expect(isCharacterAIFieldLocked('career.displayName', ['career'])).toBe(true);
    expect(() =>
      applyCharacterAIUpdates(
        draft,
        [{ path: 'career.displayName', value: 'Seer' }],
        [definition],
        ['career'],
      ),
    ).toThrow(/LOCKED_FIELD_CHANGED/);
    expect(() =>
      applyCharacterAIUpdates(
        draft,
        [{ path: 'attributes.knowledge', value: '5' }],
        [definition],
        [],
      ),
    ).toThrow(/FIELD_NOT_EDITABLE/);
    expect(() =>
      applyCharacterAIUpdates(
        draft,
        [
          { path: 'identity', value: 'One' },
          { path: 'identity', value: 'Two' },
        ],
        [definition],
        [],
      ),
    ).toThrow(/PATCH_PATH_DUPLICATE/);
  });
});

function fixture() {
  return createUniversalCharacterDraft({
    schemaVersion: 1,
    id: character,
    campaignId: campaign,
    name: 'Mira',
    nickname: null,
    gender: null,
    age: 29,
    identity: 'Investigator',
    ancestry: null,
    birthplace: null,
    socialClass: null,
    faith: null,
    appearance: 'Dark coat.',
    personality: 'Patient.',
    values: ['Truth'],
    goals: ['Find a mentor'],
    fears: [],
    secrets: [],
    family: [],
    education: [],
    importantPeople: [],
    enemies: [],
    experiences: [],
    concept: 'An investigator.',
    storyPreferences: [],
    contentBoundaries: {
      allowHorror: true,
      allowPermanentDeath: false,
      allowRomance: true,
      allowBetrayal: true,
      excludedContent: [],
    },
    career: { id: null, displayName: 'Investigator', legacyArchetype: 'SCHOLAR' },
    attributes: { physique: 1, agility: 2, knowledge: 5, charisma: 2 },
    derivedAttributes: [],
    skills: [],
    proficiencies: [],
    abilities: [],
    languages: [],
    wealth: 0,
    equipmentIds: [],
    reputations: [],
    relationships: [],
    traits: [],
    statuses: [],
    legacyBackground: {
      birthplace: 'Ash Harbor',
      formativeExperience: 'Lost a mentor.',
      adventureMotivation: 'Find the truth.',
      secret: 'Carries a forbidden map.',
      importantPerson: 'Professor Aven',
      tavernArrivalReason: 'Following the last clue.',
    },
    extensions: [{ namespace: 'investigation', schemaVersion: 1, values: { sanity: 70 } }],
  });
}
