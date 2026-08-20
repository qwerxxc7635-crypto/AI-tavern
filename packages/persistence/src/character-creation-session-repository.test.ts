import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  DEFAULT_TRAIT_EFFECT_BALANCE_DECLARATION,
  campaignId,
  characterTraitId,
  createCampaign,
  createCharacterCreationSession,
  createUniversalCharacterDraft,
  createWorldCharacterExtensionDefinition,
  generationRecordId,
  isoTimestamp,
  playerCharacterId,
  prepareAdvancedCharacterDraft,
  saveCharacterCreationDraft,
  schemaVersion,
  stageQuickCharacterDraft,
} from '@ember-tavern/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CampaignRepository,
  CharacterCreationSessionRepository,
  UniversalCharacterRepository,
  WorldConstitutionRepository,
  type SqliteStatement,
  type SqliteValue,
  type TransactionalSqliteDatabase,
} from './index.js';
import { applyMigrations } from './migrations.mjs';

const directories: string[] = [];
const at1 = isoTimestamp('2026-08-20T01:00:00.000Z');
const at2 = isoTimestamp('2026-08-20T01:01:00.000Z');
const at3 = isoTimestamp('2026-08-20T01:02:00.000Z');
const at4 = isoTimestamp('2026-08-20T01:03:00.000Z');

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('CharacterCreationSessionRepository', () => {
  it('round-trips an Advanced draft, resumes after cancellation and atomically confirms facts', async () => {
    const { database, path } = await createDatabase('advanced');
    let active: DatabaseSync | null = database;
    try {
      const sqlite = adaptDatabase(database);
      const fixture = seedCreationCampaign(sqlite, 'advanced');
      const repository = new CharacterCreationSessionRepository(sqlite);
      const initial = createCharacterCreationSession(
        {
          id: 'session-advanced',
          campaignId: fixture.campaign,
          characterId: fixture.character,
          constitutionRevision: 1,
          mode: 'ADVANCED',
          conceptInput: null,
          draft: balancedPointDraft(fixture.campaign, fixture.character),
          createdAt: at1,
        },
        fixture.definitions,
      );
      expect(repository.create(initial)).toEqual(initial);
      const saved = saveCharacterCreationDraft(
        initial,
        { ...initial.draft, nickname: '小烬' },
        ['nickname'],
        fixture.definitions,
        at2,
      );
      repository.save(saved, 1);
      database.close();
      active = null;

      const reopened = new DatabaseSync(path);
      active = reopened;
      await applyMigrations(reopened);
      const durableDb = adaptDatabase(reopened);
      const durable = new CharacterCreationSessionRepository(durableDb);
      expect(durable.requireByCampaign(fixture.campaign)).toEqual(saved);
      const ready = prepareAdvancedCharacterDraft(saved, fixture.definitions, at3);
      durable.save(ready, 2);
      const result = durable.confirm(fixture.campaign, 3, at4);

      expect(result.session).toMatchObject({ status: 'CONFIRMED', revision: 4 });
      expect(result.character).toMatchObject({
        revision: 2,
        nickname: '小烬',
        name: '沈烬',
        extensions: [{ namespace: 'cultivation', values: { spiritRoot: '火' } }],
        traits: [
          {
            pointProfile: {
              type: 'BUFF',
              buffPoints: -2,
              debuffPoints: 0,
              positiveBalance: { mechanicTags: ['寻路'], frequency: 'CONSTANT' },
              negativeBalance: null,
            },
          },
          {
            pointProfile: {
              type: 'DEBUFF',
              buffPoints: 0,
              debuffPoints: 2,
              positiveBalance: null,
              negativeBalance: { mechanicTags: ['救援冲动'], frequency: 'CONSTANT' },
            },
          },
        ],
      });
      expect(new UniversalCharacterRepository(durableDb).requireProfile(fixture.character)).toEqual(
        result.character,
      );
      expect(
        durableDb.prepare('SELECT state FROM campaigns WHERE id = ?').get(fixture.campaign),
      ).toMatchObject({ state: 'GENERATING_TAVERN' });
      expect(durable.confirm(fixture.campaign, 3, at4)).toEqual(result);
    } finally {
      active?.close();
    }
  });

  it('requires validated Quick provenance and rolls back confirmation when it is absent', async () => {
    const { database } = await createDatabase('quick');
    try {
      const sqlite = adaptDatabase(database);
      const fixture = seedCreationCampaign(sqlite, 'quick');
      const repository = new CharacterCreationSessionRepository(sqlite);
      const initial = createCharacterCreationSession(
        {
          id: 'session-quick',
          campaignId: fixture.campaign,
          characterId: fixture.character,
          constitutionRevision: 1,
          mode: 'QUICK',
          conceptInput: '守诺的流亡剑修',
          draft: blankDraft(fixture.campaign, fixture.character),
          createdAt: at1,
        },
        fixture.definitions,
      );
      repository.create(initial);
      const ready = stageQuickCharacterDraft(
        initial,
        completeDraft(fixture.campaign, fixture.character),
        generationRecordId('generation-quick-missing'),
        fixture.definitions,
        at2,
      );
      repository.save(ready, 1);

      expect(() => repository.confirm(fixture.campaign, 2, at3)).toThrow(
        /generation record is missing/,
      );
      expect(repository.requireByCampaign(fixture.campaign).status).toBe('READY_TO_CONFIRM');
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM player_characters').get()).toMatchObject(
        { count: 0 },
      );
    } finally {
      database.close();
    }
  });

  it('rejects revision drift, direct SQL transition bypasses and a modified locked field', async () => {
    const { database } = await createDatabase('guards');
    try {
      const sqlite = adaptDatabase(database);
      const fixture = seedCreationCampaign(sqlite, 'guards');
      const repository = new CharacterCreationSessionRepository(sqlite);
      const initial = createCharacterCreationSession(
        {
          id: 'session-guards',
          campaignId: fixture.campaign,
          characterId: fixture.character,
          constitutionRevision: 1,
          mode: 'ADVANCED',
          conceptInput: null,
          draft: completeDraft(fixture.campaign, fixture.character),
          createdAt: at1,
        },
        fixture.definitions,
      );
      repository.create(initial);
      const saved = saveCharacterCreationDraft(
        initial,
        initial.draft,
        ['name'],
        fixture.definitions,
        at2,
      );
      repository.save(saved, 1);
      expect(() => repository.save({ ...saved, revision: 4 }, 2)).toThrow(/advance by one/);
      expect(() =>
        saveCharacterCreationDraft(
          saved,
          { ...saved.draft, name: '篡改姓名' },
          saved.lockedFields,
          fixture.definitions,
          at3,
        ),
      ).toThrow(/Locked character field changed/);
      expect(() =>
        sqlite
          .prepare(
            `UPDATE character_creation_sessions
             SET revision = revision + 2, updated_at = ? WHERE campaign_id = ?`,
          )
          .run(at3, fixture.campaign),
      ).toThrow(/revision must advance by one/);
      expect(repository.requireByCampaign(fixture.campaign)).toEqual(saved);
    } finally {
      database.close();
    }
  });
});

function seedCreationCampaign(database: TransactionalSqliteDatabase, suffix: string) {
  const campaign = campaignId(`campaign-creation-${suffix}`);
  const character = playerCharacterId(`character-creation-${suffix}`);
  new CampaignRepository(database).create(
    createCampaign({ id: campaign, schemaVersion: schemaVersion(1), now: at1 }),
  );
  const constitutions = new WorldConstitutionRepository(database);
  constitutions.saveDraft(campaign, constitution(), at1);
  constitutions.lock(campaign, 1, at1);
  database
    .prepare("UPDATE campaigns SET state = 'CREATING_CHARACTER', updated_at = ? WHERE id = ?")
    .run(at1, campaign);
  const definition = createWorldCharacterExtensionDefinition({
    schemaVersion: 1,
    campaignId: campaign,
    namespace: 'cultivation',
    displayName: '修行根基',
    constitutionRevision: 1,
    fields: [
      { key: 'spiritRoot', label: '灵根', required: true, type: 'ENUM', options: ['火', '水'] },
    ],
    revision: 1,
    createdAt: at1,
    updatedAt: at1,
  });
  new UniversalCharacterRepository(database).saveExtensionDefinition(definition, 0);
  return { campaign, character, definitions: [definition] as const };
}

function blankDraft(
  campaign: ReturnType<typeof campaignId>,
  character: ReturnType<typeof playerCharacterId>,
) {
  return createUniversalCharacterDraft({
    ...completeDraft(campaign, character),
    name: '',
    identity: '',
    concept: '',
    appearance: '',
    personality: '',
    goals: [],
    traits: [],
    extensions: [],
  });
}

function completeDraft(
  campaign: ReturnType<typeof campaignId>,
  character: ReturnType<typeof playerCharacterId>,
) {
  return createUniversalCharacterDraft({
    schemaVersion: 1,
    id: character,
    campaignId: campaign,
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
    values: ['承诺'],
    goals: ['查清师门旧案'],
    fears: ['再次牵连无辜'],
    secrets: ['曾私放被追捕的妖灵'],
    family: ['养父仍住在山脚村落'],
    education: ['赤霞剑宗外门'],
    importantPeople: ['养父沈伯'],
    enemies: ['戒律堂执事'],
    experiences: ['在禁林中救下一只妖灵'],
    concept: '守诺的流亡剑修',
    storyPreferences: ['调查'],
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
        id: characterTraitId(`trait-keeps-promises-${character}`),
        name: '一诺千金',
        description: '答应的事会尽力做到。',
      },
      {
        id: characterTraitId(`trait-stubborn-justice-${character}`),
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

function balancedPointDraft(
  campaign: ReturnType<typeof campaignId>,
  character: ReturnType<typeof playerCharacterId>,
) {
  const draft = completeDraft(campaign, character);
  const [firstTrait, secondTrait] = draft.traits;
  if (firstTrait === undefined || secondTrait === undefined) {
    throw new Error('fixture must include two Traits');
  }
  return createUniversalCharacterDraft({
    ...draft,
    traits: [
      {
        ...firstTrait,
        pointProfile: {
          type: 'BUFF',
          positiveEffect: '能在烟尘中辨认道路。',
          negativeEffect: null,
          buffPoints: -2,
          debuffPoints: 0,
          positiveBalance: {
            ...DEFAULT_TRAIT_EFFECT_BALANCE_DECLARATION,
            frequency: 'CONSTANT',
            environment: 'BROAD',
            mechanicTags: ['寻路'],
            requiresTags: ['烟尘'],
          },
          negativeBalance: null,
        },
      },
      {
        ...secondTrait,
        pointProfile: {
          type: 'DEBUFF',
          positiveEffect: null,
          negativeEffect: '无法忽视被困在烟火中的陌生人。',
          buffPoints: 0,
          debuffPoints: 2,
          positiveBalance: null,
          negativeBalance: {
            ...DEFAULT_TRAIT_EFFECT_BALANCE_DECLARATION,
            frequency: 'CONSTANT',
            environment: 'BROAD',
            mechanicTags: ['救援冲动'],
            requiresTags: ['受困者'],
          },
        },
      },
    ],
  });
}

function constitution() {
  return {
    worldType: '低魔修行世界',
    era: '宗门与城邦并立',
    technology: '手工业',
    magic: '修行受灵根和境界约束',
    peoples: ['人族'],
    society: '宗门与地方宗族共同维持秩序。',
    politics: '城邦向宗门交换资源与保护。',
    economy: '灵石稀缺且由本地规则裁决。',
    combatScale: '个人冲突',
    deathRules: '死亡不可轻易逆转。',
    careerRules: '职业必须符合修行背景。',
    equipmentRules: '装备不能凭描述增加数值。',
    npcRules: 'NPC知识受边界约束。',
    traitRules: 'Trait需本地验证。',
    taboos: ['无代价复活'],
  };
}

async function createDatabase(prefix: string): Promise<{ database: DatabaseSync; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), `character-creation-session-${prefix}-`));
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
