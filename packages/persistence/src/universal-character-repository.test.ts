import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  campaignId,
  characterTraitId,
  createCampaign,
  createUniversalCharacterProfile,
  createWorldCharacterExtensionDefinition,
  isoTimestamp,
  itemId,
  playerCharacterId,
  schemaVersion,
  type CharacterExtensionFieldDefinition,
  type PlayerCharacter,
} from '@ember-tavern/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CampaignRepository,
  PlayerCharacterRepository,
  UniversalCharacterRepository,
  WorldConstitutionRepository,
  type SqliteStatement,
  type SqliteValue,
  type TransactionalSqliteDatabase,
} from './index.js';
import { applyMigrations } from './migrations.mjs';

const directories: string[] = [];
const firstAt = isoTimestamp('2026-08-19T13:00:00.000Z');
const secondAt = isoTimestamp('2026-08-19T13:05:00.000Z');

const fixtures = [
  {
    namespace: 'cultivation',
    displayName: '修仙角色字段',
    fields: [
      enumField('spiritRoot', '灵根', ['金', '木', '水', '火', '土']),
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
    values: { cyberware: ['夜视义眼'], neuralLoad: 28, streetCred: 12 },
  },
] as const;

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('UniversalCharacterRepository', () => {
  it.each(fixtures)(
    'round-trips the $namespace fixture and V0.2 projection across reopen',
    async (fixture) => {
      const { database, path } = await createDatabase(fixture.namespace);
      let activeDatabase: DatabaseSync | null = database;
      try {
        const sqlite = adaptDatabase(database);
        const campaign = campaignId(`campaign-${fixture.namespace}`);
        const legacy = legacyCharacter(campaign, fixture.namespace);
        seedCampaignAndConstitution(sqlite, campaign);
        new PlayerCharacterRepository(sqlite).create(legacy);
        const repository = new UniversalCharacterRepository(sqlite);
        const migrated = repository.requireProfile(legacy.id);
        expect(repository.projectV02(legacy.id)).toEqual(legacy);
        const definition = createWorldCharacterExtensionDefinition({
          schemaVersion: 1,
          campaignId: campaign,
          namespace: fixture.namespace,
          displayName: fixture.displayName,
          constitutionRevision: 1,
          fields: fixture.fields,
          revision: 1,
          createdAt: firstAt,
          updatedAt: firstAt,
        });
        repository.saveExtensionDefinition(definition, 0);
        const updated = createUniversalCharacterProfile({
          ...migrated,
          revision: 2,
          identity: `${migrated.identity} with a complete V0.3 profile.`,
          nickname: 'Ember',
          appearance: 'A soot-dark coat and a brass compass.',
          personality: 'Curious and measured.',
          values: ['Truth'],
          fears: ['Being trapped between worlds.'],
          family: ['The Vale household'],
          education: ['Harbor Academy'],
          enemies: ['The Ash Cartographer'],
          derivedAttributes: [{ key: 'resolve', value: 4 }],
          skills: [],
          proficiencies: ['Cartography'],
          abilities: ['Read the road'],
          languages: ['Common'],
          reputations: [{ entityId: 'faction-guild', score: 10, summary: 'Trusted novice.' }],
          relationships: [{ entityId: 'npc-aven', kind: 'MENTOR', summary: 'Missing mentor.' }],
          statuses: [],
          extensions: [{ namespace: fixture.namespace, schemaVersion: 1, values: fixture.values }],
          updatedAt: secondAt,
        });
        expect(repository.saveProfile(updated, 1)).toEqual(updated);
        database.close();
        activeDatabase = null;

        const reopened = new DatabaseSync(path);
        activeDatabase = reopened;
        await applyMigrations(reopened);
        const durable = new UniversalCharacterRepository(adaptDatabase(reopened));
        expect(durable.requireProfile(legacy.id)).toEqual(updated);
        expect(durable.listExtensionDefinitions(campaign)).toEqual([definition]);
        expect(durable.projectV02(legacy.id)).toMatchObject({
          name: legacy.name,
          classArchetype: legacy.classArchetype,
          traits: legacy.traits,
        });
      } finally {
        activeDatabase?.close();
      }
    },
  );

  it('rejects unlocked definitions, unknown values, revision drift and base-attribute changes atomically', async () => {
    const { database } = await createDatabase('reject');
    try {
      const sqlite = adaptDatabase(database);
      const campaign = campaignId('campaign-character-reject');
      new CampaignRepository(sqlite).create(
        createCampaign({ id: campaign, schemaVersion: schemaVersion(1), now: firstAt }),
      );
      new WorldConstitutionRepository(sqlite).saveDraft(campaign, constitution(), firstAt);
      const legacy = legacyCharacter(campaign, 'reject');
      new PlayerCharacterRepository(sqlite).create(legacy);
      const repository = new UniversalCharacterRepository(sqlite);
      const definition = createWorldCharacterExtensionDefinition({
        schemaVersion: 1,
        campaignId: campaign,
        namespace: 'investigation',
        displayName: '调查字段',
        constitutionRevision: 1,
        fields: fixtures[1].fields,
        revision: 1,
        createdAt: firstAt,
        updatedAt: firstAt,
      });
      expect(() => repository.saveExtensionDefinition(definition, 0)).toThrow('transaction failed');
      expect(repository.listExtensionDefinitions(campaign)).toEqual([]);
      new WorldConstitutionRepository(sqlite).lock(campaign, 1, firstAt);
      repository.saveExtensionDefinition(definition, 0);
      const current = repository.requireProfile(legacy.id);
      const unknown = createUniversalCharacterProfile({
        ...current,
        revision: 2,
        extensions: [{ namespace: 'unknown', schemaVersion: 1, values: { value: true } }],
        updatedAt: secondAt,
      });
      expect(() => repository.saveProfile(unknown, 1)).toThrow('Unknown character extension');
      expect(repository.requireProfile(legacy.id)).toEqual(current);
      const invalidAttributes = createUniversalCharacterProfile({
        ...current,
        revision: 2,
        attributes: { physique: 2, agility: 1, knowledge: 5, charisma: 2 },
        updatedAt: secondAt,
      });
      expect(() => repository.saveProfile(invalidAttributes, 1)).toThrow('base attributes');
      const invalidRulesProjection = createUniversalCharacterProfile({
        ...current,
        revision: 2,
        wealth: 1,
        updatedAt: secondAt,
      });
      expect(() => repository.saveProfile(invalidRulesProjection, 1)).toThrow(
        'Rules Engine projection',
      );
      expect(() => repository.saveProfile({ ...current, revision: 3 }, 1)).toThrow(
        'does not follow',
      );
      expect(repository.requireProfile(legacy.id)).toEqual(current);
    } finally {
      database.close();
    }
  });

  it('keeps legacy updates synchronized without discarding V0.3-only fields', async () => {
    const { database } = await createDatabase('legacy-sync');
    try {
      const sqlite = adaptDatabase(database);
      const campaign = campaignId('campaign-legacy-sync');
      seedCampaignAndConstitution(sqlite, campaign);
      const legacy = legacyCharacter(campaign, 'legacy-sync');
      const legacyRepository = new PlayerCharacterRepository(sqlite);
      legacyRepository.create(legacy);
      const repository = new UniversalCharacterRepository(sqlite);
      const migrated = repository.requireProfile(legacy.id);
      const before = repository.saveProfile(
        createUniversalCharacterProfile({
          ...migrated,
          revision: 2,
          name: 'Mira Profile Vale',
          goals: ['Follow the profile road.'],
          nickname: 'Ember',
          appearance: 'A soot-dark coat.',
          updatedAt: secondAt,
        }),
        1,
      );
      expect(legacyRepository.get(legacy.id)).toMatchObject({
        name: 'Mira Profile Vale',
        personalGoal: 'Follow the profile road.',
      });
      const changed: PlayerCharacter = {
        ...legacy,
        name: 'Mira Ember Vale',
        personalGoal: 'Map the ember road.',
        updatedAt: secondAt,
      };
      legacyRepository.update(changed);
      const afterLegacy = repository.requireProfile(legacy.id);
      expect(afterLegacy).toMatchObject({
        name: changed.name,
        goals: [changed.personalGoal],
        nickname: 'Ember',
        appearance: 'A soot-dark coat.',
        revision: before.revision + 1,
        updatedAt: secondAt,
      });
      expect(repository.projectV02(legacy.id)).toEqual(changed);
      database
        .prepare(
          `UPDATE character_rule_states SET
             skills_json = ?, money = ?, statuses_json = ?, revision = revision + 1,
             updated_at = ?
           WHERE player_character_id = ?`,
        )
        .run(
          '[{"name":"Investigation","value":2}]',
          12,
          '[{"kind":"CONDITION","sourceId":"test","description":"Ready"}]',
          secondAt,
          legacy.id,
        );
      expect(repository.requireProfile(legacy.id)).toMatchObject({
        skills: ['Investigation'],
        wealth: 12,
        statuses: ['CONDITION'],
        nickname: 'Ember',
        appearance: 'A soot-dark coat.',
        revision: afterLegacy.revision + 1,
      });
    } finally {
      database.close();
    }
  });
});

function seedCampaignAndConstitution(
  database: TransactionalSqliteDatabase,
  campaign: ReturnType<typeof campaignId>,
): void {
  new CampaignRepository(database).create(
    createCampaign({ id: campaign, schemaVersion: schemaVersion(1), now: firstAt }),
  );
  const constitutions = new WorldConstitutionRepository(database);
  constitutions.saveDraft(campaign, constitution(), firstAt);
  constitutions.lock(campaign, 1, firstAt);
}

function legacyCharacter(campaign: ReturnType<typeof campaignId>, suffix: string): PlayerCharacter {
  return {
    id: playerCharacterId(`character-${suffix}`),
    campaignId: campaign,
    name: 'Mira Vale',
    gender: null,
    age: 27,
    concept: 'A world-walking scholar.',
    storyPreferences: ['Exploration'],
    contentBoundaries: {
      allowHorror: true,
      allowPermanentDeath: false,
      allowRomance: true,
      allowBetrayal: true,
      excludedContent: ['Graphic cruelty'],
    },
    classArchetype: 'SCHOLAR',
    classDisplayName: 'World Walker',
    attributes: { physique: 1, agility: 2, knowledge: 5, charisma: 2 },
    traits: [
      {
        id: characterTraitId(`trait-observant-${suffix}`),
        name: 'Observant',
        description: 'Notices small inconsistencies.',
      },
      {
        id: characterTraitId(`trait-restless-${suffix}`),
        name: 'Restless',
        description: 'Cannot leave a mystery alone.',
      },
    ],
    personalGoal: 'Find the ember road.',
    background: {
      birthplace: 'Ember Harbor',
      formativeExperience: 'Survived a skyquake.',
      adventureMotivation: 'Find the ember road.',
      secret: 'The compass answers to her blood.',
      importantPerson: 'Professor Aven',
      tavernArrivalReason: 'Following the compass.',
    },
    initialEquipment: [{ itemId: itemId(`item-lantern-${suffix}`) }],
    createdAt: firstAt,
    updatedAt: firstAt,
  };
}

function constitution() {
  return {
    worldType: 'Cross-world fantasy',
    era: 'Variable',
    technology: 'Constitution-defined technology',
    magic: 'Constitution-defined supernatural rules',
    peoples: ['Humans'],
    society: 'Communities follow local obligations.',
    politics: 'Factions negotiate authority.',
    economy: 'Resources remain locally adjudicated.',
    combatScale: 'Personal conflict.',
    deathRules: 'Death follows local rules.',
    careerRules: 'Careers are generated from this Constitution.',
    equipmentRules: 'Equipment follows world constraints.',
    npcRules: 'NPC knowledge remains bounded.',
    traitRules: 'Traits require local validation.',
    taboos: ['Graphic torture'],
  };
}

async function createDatabase(prefix: string): Promise<{ database: DatabaseSync; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), `universal-character-${prefix}-`));
  directories.push(directory);
  const path = join(directory, 'test.sqlite');
  const database = new DatabaseSync(path);
  await applyMigrations(database);
  return { database, path };
}

function adaptDatabase(value: DatabaseSync): TransactionalSqliteDatabase {
  return {
    exec(sql) {
      value.exec(sql);
    },
    prepare(sql): SqliteStatement {
      return adaptStatement(value.prepare(sql));
    },
  };
}

function adaptStatement(statement: StatementSync): SqliteStatement {
  return {
    run(...values: SqliteValue[]) {
      return statement.run(...values);
    },
    get(...values: SqliteValue[]) {
      return statement.get(...values);
    },
    all(...values: SqliteValue[]) {
      return statement.all(...values);
    },
  };
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
