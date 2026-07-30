import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  campaignId,
  characterTraitId,
  createCampaign,
  createNpcKnowledge,
  createNpcRelationship,
  createPlayerAttributes,
  isoTimestamp,
  locationId,
  npcId,
  npcMemoryId,
  playerCharacterId,
  schemaVersion,
  tavernChangeId,
  tavernId,
  turnId,
  worldFactId,
  type NpcProfile,
  type PlayerCharacter,
  type Tavern,
} from '@ember-tavern/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CampaignRepository,
  NpcRepository,
  PersistenceDataError,
  PlayerCharacterRepository,
  TavernRepository,
  type SqliteDatabase,
  type SqliteStatement,
  type SqliteValue,
} from './index.js';
import { applyMigrations } from './migrations.mjs';

const directories: string[] = [];
let database: DatabaseSync;
let sqlite: SqliteDatabase;
const now = isoTimestamp('2026-07-30T17:00:00.000Z');
const campaign = campaignId('campaign-1');
const tavernKey = tavernId('tavern-1');
const ownerKey = npcId('npc-owner');
const residentKey = npcId('npc-resident');
const visitorKey = npcId('npc-visitor');
const characterKey = playerCharacterId('character-1');

beforeEach(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ember-tavern-tavern-npc-'));
  directories.push(directory);
  database = new DatabaseSync(join(directory, 'test.sqlite'));
  await applyMigrations(database);
  sqlite = adaptDatabase(database);
  new CampaignRepository(sqlite).create(
    createCampaign({ id: campaign, schemaVersion: schemaVersion(1), now }),
  );
  new PlayerCharacterRepository(sqlite).create(character());
});

afterEach(async () => {
  database.close();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const tavern: Tavern = {
  id: tavernKey,
  campaignId: campaign,
  locationId: locationId('location-harbor'),
  name: 'The Ember Cup',
  position: 'Beneath the western docks',
  environment: 'Warm brass lamps and airship rigging',
  specialRules: ['No drawn weapons'],
  longTermProblem: 'The foundation is sinking.',
  ownerNpcId: ownerKey,
  residentNpcIds: [ownerKey, residentKey],
  visitorNpcIds: [visitorKey],
  createdAt: now,
  updatedAt: now,
};

function profile(id: ReturnType<typeof npcId>, residency: NpcProfile['residency']): NpcProfile {
  return {
    id,
    campaignId: campaign,
    tavernId: tavernKey,
    residency,
    name: id,
    identity: `${residency} of the tavern`,
    appearance: 'Weathered coat',
    personality: 'Observant',
    goal: 'Protect the harbor',
    secret: 'Knows an old route',
    speechStyle: 'Measured',
    currentMood: 'Alert',
    currentStatus: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  };
}

describe('Tavern and NPC repositories', () => {
  it('restores owner, resident, visitor, visit details, and tavern changes', () => {
    const taverns = new TavernRepository(sqlite);
    const npcs = new NpcRepository(sqlite);
    taverns.create(tavern);
    expect(() => taverns.get(tavern.id)).toThrow(PersistenceDataError);

    npcs.create(profile(ownerKey, 'OWNER'));
    npcs.create(profile(residentKey, 'RESIDENT'));
    const visitor = {
      npcId: visitorKey,
      tavernId: tavernKey,
      visitReason: 'Selling a damaged chart',
      arrivedAt: now,
      plannedDepartureAt: isoTimestamp('2026-07-31T17:00:00.000Z'),
    } as const;
    npcs.create(profile(visitorKey, 'TEMPORARY_VISITOR'), visitor);
    taverns.assignOwner(tavern.id, ownerKey);

    expect(taverns.get(tavern.id)).toEqual(tavern);
    expect(npcs.get(ownerKey)).toEqual(profile(ownerKey, 'OWNER'));
    expect(npcs.getVisitor(visitorKey)).toEqual(visitor);

    const updatedTavern = {
      ...tavern,
      environment: 'Fresh rigging hangs beside the brass lamps',
      updatedAt: isoTimestamp('2026-07-30T17:00:30.000Z'),
    };
    taverns.update(updatedTavern);
    expect(taverns.get(tavern.id)).toEqual(updatedTavern);

    const updatedOwner = {
      ...profile(ownerKey, 'OWNER'),
      currentMood: 'Relieved',
      updatedAt: isoTimestamp('2026-07-30T17:00:40.000Z'),
    };
    npcs.update(updatedOwner);
    expect(npcs.get(ownerKey)).toEqual(updatedOwner);

    const change = {
      id: tavernChangeId('change-1'),
      tavernId: tavernKey,
      kind: 'TROPHY',
      description: 'A stormglass hangs above the hearth.',
      sourceAdventureId: null,
      occurredAt: isoTimestamp('2026-07-30T17:01:00.000Z'),
    } as const;
    taverns.appendChange(change);
    expect(taverns.listChanges(tavern.id)).toEqual([change]);
  });

  it('keeps knowledge and errors isolated between NPCs', () => {
    const taverns = new TavernRepository(sqlite);
    const npcs = new NpcRepository(sqlite);
    taverns.create(tavern);
    npcs.create(profile(ownerKey, 'OWNER'));
    npcs.create(profile(residentKey, 'RESIDENT'));
    taverns.assignOwner(tavern.id, ownerKey);

    const ownerKnowledge = createNpcKnowledge({
      npcId: ownerKey,
      knownFactIds: [worldFactId('fact-owner-known')],
      suspectedFactIds: [],
      falseBeliefFactIds: [worldFactId('fact-owner-false')],
      excludedSecretFactIds: [worldFactId('fact-owner-secret')],
    });
    const residentKnowledge = createNpcKnowledge({
      npcId: residentKey,
      knownFactIds: [worldFactId('fact-resident-known')],
      suspectedFactIds: [worldFactId('fact-resident-suspected')],
      falseBeliefFactIds: [],
      excludedSecretFactIds: [],
    });
    npcs.saveKnowledge(ownerKnowledge, now);
    npcs.saveKnowledge(residentKnowledge, now);

    expect(npcs.getKnowledge(ownerKey)).toEqual(ownerKnowledge);
    expect(npcs.getKnowledge(residentKey)).toEqual(residentKnowledge);
    expect(npcs.getKnowledge(visitorKey)).toBeNull();
    expect(npcs.getKnowledge(ownerKey)?.knownFactIds).not.toContain(
      worldFactId('fact-resident-known'),
    );
  });

  it('round-trips independent relationships and append-only memories', () => {
    const taverns = new TavernRepository(sqlite);
    const npcs = new NpcRepository(sqlite);
    taverns.create(tavern);
    npcs.create(profile(ownerKey, 'OWNER'));
    npcs.create(profile(residentKey, 'RESIDENT'));
    taverns.assignOwner(tavern.id, ownerKey);

    const ownerRelationship = createNpcRelationship({
      npcId: ownerKey,
      playerCharacterId: characterKey,
      trust: 2,
      closeness: 1,
      awe: 0,
      obligation: -1,
    });
    const residentRelationship = createNpcRelationship({
      npcId: residentKey,
      playerCharacterId: characterKey,
      trust: -1,
      closeness: 0,
      awe: 2,
      obligation: 1,
    });
    npcs.saveRelationship(ownerRelationship, now);
    npcs.saveRelationship(residentRelationship, now);
    expect(npcs.getRelationship(ownerKey)).toEqual(ownerRelationship);
    expect(npcs.getRelationship(residentKey)).toEqual(residentRelationship);

    const ownerMemory = {
      id: npcMemoryId('memory-owner'),
      npcId: ownerKey,
      summary: 'The player defended the cellar.',
      sourceTurnIds: [turnId('turn-1')],
      createdAt: now,
    } as const;
    const residentMemory = {
      id: npcMemoryId('memory-resident'),
      npcId: residentKey,
      summary: 'The player asked about the beacon.',
      sourceTurnIds: [turnId('turn-2')],
      createdAt: now,
    } as const;
    npcs.appendMemory(ownerMemory);
    npcs.appendMemory(residentMemory);
    expect(npcs.listMemories(ownerKey)).toEqual([ownerMemory]);
    expect(npcs.listMemories(residentKey)).toEqual([residentMemory]);
    expect(() => npcs.appendMemory(ownerMemory)).toThrow(PersistenceDataError);
  });

  it('rejects visitor/profile mismatches and malformed knowledge JSON', () => {
    const taverns = new TavernRepository(sqlite);
    const npcs = new NpcRepository(sqlite);
    taverns.create(tavern);
    expect(() => npcs.create(profile(visitorKey, 'TEMPORARY_VISITOR'))).toThrow(
      PersistenceDataError,
    );
    npcs.create(profile(ownerKey, 'OWNER'));
    database
      .prepare(
        `INSERT INTO npc_knowledge (
           npc_id, known_fact_ids_json, suspected_fact_ids_json,
           false_belief_fact_ids_json, excluded_secret_fact_ids_json, updated_at
         ) VALUES (?, ?, '[]', '[]', '[]', ?)`,
      )
      .run(ownerKey, '[1]', now);
    expect(() => npcs.getKnowledge(ownerKey)).toThrow(PersistenceDataError);
  });
});

function character(): PlayerCharacter {
  return {
    id: characterKey,
    campaignId: campaign,
    name: 'Mira',
    gender: null,
    age: 27,
    concept: 'Weather scholar',
    storyPreferences: [],
    contentBoundaries: {
      allowHorror: true,
      allowPermanentDeath: false,
      allowRomance: true,
      allowBetrayal: true,
      excludedContent: [],
    },
    classArchetype: 'SCHOLAR',
    classDisplayName: 'Storm Archivist',
    attributes: createPlayerAttributes({ physique: 1, agility: 2, knowledge: 5, charisma: 2 }),
    traits: [
      { id: characterTraitId('trait-1'), name: 'Reader', description: 'Reads storms.' },
      { id: characterTraitId('trait-2'), name: 'Patient', description: 'Waits for clues.' },
    ],
    personalGoal: 'Repair the beacon.',
    background: {
      birthplace: 'Harbor',
      formativeExperience: 'Skyquake',
      adventureMotivation: 'Protect home',
      secret: 'Forbidden chart',
      importantPerson: 'Aven',
      tavernArrivalReason: 'Followed chart',
    },
    initialEquipment: [],
    createdAt: now,
    updatedAt: now,
  };
}

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
