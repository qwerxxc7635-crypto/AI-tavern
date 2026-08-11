import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  campaignId,
  claimId,
  characterTraitId,
  createCampaign,
  createPlayerAttributes,
  factionId,
  isoTimestamp,
  itemId,
  locationId,
  npcId,
  playerCharacterId,
  schemaVersion,
  worldFactId,
  type PlayerCharacter,
  type WorldBible,
  type WorldFact,
} from '@ember-tavern/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CampaignRepository,
  PersistenceDataError,
  PlayerCharacterNotFoundError,
  PlayerCharacterRepository,
  WorldRepository,
  type SqliteDatabase,
  type SqliteStatement,
  type SqliteValue,
} from './index.js';
import { applyMigrations } from './migrations.mjs';

const directories: string[] = [];
let database: DatabaseSync;
let sqlite: SqliteDatabase;
const now = isoTimestamp('2026-07-30T16:00:00.000Z');
const campaign = campaignId('campaign-1');
const guild = factionId('faction-guild');
const council = factionId('faction-council');
const harbor = locationId('location-harbor');

beforeEach(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ember-tavern-world-character-'));
  directories.push(directory);
  database = new DatabaseSync(join(directory, 'test.sqlite'));
  await applyMigrations(database);
  sqlite = adaptDatabase(database);
  new CampaignRepository(sqlite).create(
    createCampaign({ id: campaign, schemaVersion: schemaVersion(1), now }),
  );
});

afterEach(async () => {
  database.close();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const world: WorldBible = {
  campaignId: campaign,
  schemaVersion: schemaVersion(1),
  name: 'Cloudbound Isles',
  currentRegion: 'Ember Harbor',
  summary: 'Floating islands linked by living airships.',
  coreConflict: 'A weather engine is destabilizing the archipelago.',
  technologyLevel: 'Arcane age of sail',
  powerRules: ['Magic alters nearby weather.'],
  factions: [
    {
      id: guild,
      name: 'Skyfarers Guild',
      description: 'Pilots and navigators.',
      goals: ['Keep trade routes open.'],
      relations: [
        {
          factionId: council,
          disposition: 'FRIENDLY',
          summary: 'They cooperate uneasily.',
        },
      ],
    },
    {
      id: council,
      name: 'Harbor Council',
      description: 'The elected port authority.',
      goals: ['Protect the harbor.'],
      relations: [],
    },
  ],
  locations: [
    {
      id: harbor,
      name: 'Ember Harbor',
      description: 'A port beneath a red cloud.',
      parentLocationId: null,
      factionIds: [guild, council],
    },
    {
      id: locationId('location-beacon'),
      name: 'Western Beacon',
      description: 'A storm-battered navigation tower.',
      parentLocationId: harbor,
      factionIds: [guild],
    },
  ],
  narrativeStyle: 'Hopeful adventure',
  forbiddenElements: ['Graphic cruelty'],
  tavernReason: 'Neutral ground for sky crews.',
  storyHooks: ['The western beacon has gone dark.'],
  lockedFields: ['coreConflict', 'powerRules'],
  createdAt: now,
  updatedAt: now,
};

const baseFact = {
  campaignId: campaign,
  locationId: harbor,
  factionIds: [guild],
  createdAt: now,
} as const;

const facts: readonly WorldFact[] = [
  {
    ...baseFact,
    id: worldFactId('fact-rule'),
    kind: 'LOCKED_RULE',
    field: 'powerRules',
    statement: 'Magic changes local weather.',
  },
  {
    ...baseFact,
    id: worldFactId('fact-developing-original'),
    kind: 'DEVELOPING_FACT',
    supersedesFactId: null,
    statement: 'The beacon is failing.',
  },
  {
    ...baseFact,
    id: worldFactId('fact-developing-changed'),
    kind: 'DEVELOPING_FACT',
    supersedesFactId: worldFactId('fact-developing-original'),
    statement: 'The beacon has gone dark.',
  },
  {
    ...baseFact,
    id: worldFactId('fact-temporary'),
    kind: 'TEMPORARY_NARRATIVE',
    expiresAt: isoTimestamp('2026-07-31T16:00:00.000Z'),
    statement: 'A storm covers the harbor.',
  },
  {
    ...baseFact,
    id: worldFactId('fact-rumor'),
    kind: 'RUMOR',
    claimId: claimId('claim-rumor'),
    sourceNpcId: npcId('npc-captain'),
    sourceBasis: 'FACTION_MESSAGE',
    confidence: 0.6,
    claimRevision: 1,
    veracity: 'PARTIAL',
    statement: 'The guild caused the failure.',
  },
  {
    ...baseFact,
    id: worldFactId('fact-belief'),
    kind: 'FALSE_BELIEF',
    believedByNpcIds: [npcId('npc-captain')],
    statement: 'The beacon cannot be repaired.',
  },
];

const character: PlayerCharacter = {
  id: playerCharacterId('character-1'),
  campaignId: campaign,
  name: 'Mira Vale',
  gender: null,
  age: 27,
  concept: 'A weather scholar seeking a missing mentor.',
  storyPreferences: ['Exploration', 'Found family'],
  contentBoundaries: {
    allowHorror: true,
    allowPermanentDeath: false,
    allowRomance: true,
    allowBetrayal: true,
    excludedContent: ['Graphic cruelty'],
  },
  classArchetype: 'SCHOLAR',
  classDisplayName: 'Storm Archivist',
  attributes: createPlayerAttributes({ physique: 1, agility: 2, knowledge: 5, charisma: 2 }),
  traits: [
    {
      id: characterTraitId('trait-observant'),
      name: 'Storm Reader',
      description: 'Recognizes subtle weather changes.',
    },
    {
      id: characterTraitId('trait-stubborn'),
      name: 'Unyielding Curiosity',
      description: 'Keeps investigating.',
    },
  ],
  personalGoal: 'Repair the western beacon.',
  background: {
    birthplace: 'Ember Harbor',
    formativeExperience: 'Survived a skyquake.',
    adventureMotivation: 'Prevent another island from falling.',
    secret: 'Owns a forbidden chart.',
    importantPerson: 'Professor Aven',
    tavernArrivalReason: 'Following the chart.',
  },
  initialEquipment: [{ itemId: itemId('item-weather-compass') }],
  createdAt: now,
  updatedAt: now,
};

describe('WorldRepository', () => {
  it('round-trips all WorldBible JSON fields and locked fields', () => {
    const repository = new WorldRepository(sqlite);
    repository.saveBible(world);
    expect(repository.getBible(campaign)).toEqual(world);

    const updated: WorldBible = {
      ...world,
      storyHooks: [...world.storyHooks, 'A councilor vanished.'],
      lockedFields: [...world.lockedFields, 'technologyLevel'],
      updatedAt: isoTimestamp('2026-07-30T16:01:00.000Z'),
    };
    repository.saveBible(updated);
    expect(repository.getBible(campaign)).toEqual(updated);
  });

  it('round-trips all five WorldFact variants and preserves the append-only chain', () => {
    const repository = new WorldRepository(sqlite);
    database.exec(`
      INSERT INTO taverns (
        id, campaign_id, location_id, name, position, environment, special_rules_json,
        long_term_problem, changes_json, created_at, updated_at
      ) VALUES (
        'tavern-facts', 'campaign-1', 'location-harbor', 'Ember', 'Harbor', 'Warm',
        '[]', 'None', '[]', '2026-07-30T10:00:00.000Z', '2026-07-30T10:00:00.000Z'
      );
      INSERT INTO npcs (
        id, campaign_id, tavern_id, residency, name, identity, appearance, personality,
        goal, secret, speech_style, current_mood, current_status, memories_json, created_at, updated_at
      ) VALUES (
        'npc-captain', 'campaign-1', 'tavern-facts', 'OWNER', 'Captain', 'Sailor', 'Coat',
        'Watchful', 'Protect', 'None', 'Brief', 'Calm', 'ACTIVE', '[]',
        '2026-07-30T10:00:00.000Z', '2026-07-30T10:00:00.000Z'
      );
    `);
    for (const fact of facts) repository.addFact(fact);
    expect(repository.listFacts(campaign)).toEqual(
      [...facts].sort((left, right) => left.id.localeCompare(right.id)),
    );
    const changed = facts.find(({ id }) => id === worldFactId('fact-developing-changed'));
    const duplicate = facts.find(({ id }) => id === worldFactId('fact-rule'));
    if (changed === undefined || duplicate === undefined) {
      throw new Error('Expected WorldFact fixtures are missing');
    }
    expect(repository.getFact(changed.id)).toEqual(changed);
    expect(() => repository.addFact(duplicate)).toThrow();
    expect(repository.getFact(worldFactId('missing'))).toBeNull();
  });

  it('rejects an unknown locked field read from SQLite', () => {
    const repository = new WorldRepository(sqlite);
    repository.saveBible(world);
    database
      .prepare('UPDATE world_bibles SET locked_fields_json = ? WHERE campaign_id = ?')
      .run('["future-unvalidated-field"]', campaign);
    expect(() => repository.getBible(campaign)).toThrow(PersistenceDataError);
  });
});

describe('PlayerCharacterRepository', () => {
  it('round-trips and updates every character JSON aggregate', () => {
    const repository = new PlayerCharacterRepository(sqlite);
    repository.create(character);
    expect(repository.get(character.id)).toEqual(character);

    const updated: PlayerCharacter = {
      ...character,
      storyPreferences: [...character.storyPreferences, 'Mystery'],
      personalGoal: 'Repair the beacon and find the mentor.',
      updatedAt: isoTimestamp('2026-07-30T16:02:00.000Z'),
    };
    repository.update(updated);
    expect(repository.get(character.id)).toEqual(updated);
  });

  it('rejects missing updates and malformed character JSON', () => {
    const repository = new PlayerCharacterRepository(sqlite);
    expect(() => repository.update(character)).toThrow(PlayerCharacterNotFoundError);
    repository.create(character);
    database
      .prepare('UPDATE player_characters SET traits_json = ? WHERE id = ?')
      .run('[]', character.id);
    expect(() => repository.get(character.id)).toThrow(PersistenceDataError);
    expect(repository.get(playerCharacterId('missing'))).toBeNull();
  });
});

function adaptDatabase(value: DatabaseSync): SqliteDatabase {
  return {
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
