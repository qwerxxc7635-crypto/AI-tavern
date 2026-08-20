import { FakeAIProvider } from '@ember-tavern/ai-core';
import {
  aiRequestId,
  campaignId,
  createCharacterCreationSession,
  createUniversalCharacterDraft,
  generationRecordId,
  idempotencyKey,
  isoTimestamp,
  playerCharacterId,
  stageQuickCharacterDraft,
  type CharacterCreationSession,
} from '@ember-tavern/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  UniversalCharacterCreationService,
  buildQuickDraft,
  type UniversalCharacterCreationGateway,
  type UniversalCharacterCreationSnapshot,
} from './universal-character-creation-service.js';

const campaignKey = campaignId('campaign-windows-creation-v3');
const characterKey = playerCharacterId('character-windows-creation-v3');
const at = isoTimestamp('2026-08-20T02:00:00.000Z');

describe('UniversalCharacterCreationService', () => {
  it('turns one Quick concept into a complete locally bounded candidate', async () => {
    const gateway = new FakeGateway(quickSnapshot());
    const service = serviceWith(gateway);
    const validation = vi.fn();

    const result = await service.generateQuick(gateway.snapshot, {
      onValidationStarted: validation,
    });

    expect(validation).toHaveBeenCalledOnce();
    expect(result.session).toMatchObject({
      mode: 'QUICK',
      status: 'READY_TO_CONFIRM',
      generationRecordId: 'character-quick-generation-fixed',
      draft: {
        name: 'Mira Vale',
        concept: 'A world-walking scholar.',
        attributes: { physique: 1, agility: 3, knowledge: 4, charisma: 2 },
        wealth: 0,
        skills: [],
        statuses: [],
        equipmentIds: [],
      },
    });
    expect(gateway.quickCommits).toHaveLength(1);
    expect(gateway.quickCommits[0]?.generation.context).toEqual({
      sessionId: 'session-windows-quick',
      characterId: characterKey,
      constitutionRevision: 1,
      lockedFields: [],
    });
  });

  it('switches modes and preserves an edited locked draft through cancel and resume', async () => {
    const gateway = new FakeGateway(advancedSnapshot());
    const service = serviceWith(gateway);
    const session = gateway.snapshot.session;
    if (session === null) throw new Error('Fixture session missing');
    const edited = { ...session.draft, nickname: 'Ember' };

    const saved = await service.saveDraft(gateway.snapshot, edited, ['nickname']);
    const quick = await service.switchMode(saved, 'QUICK', 'A world-walking scholar.');
    const cancelled = await service.cancel(quick);
    const resumed = await service.resume(cancelled);

    expect(resumed.session).toMatchObject({
      mode: 'QUICK',
      status: 'ACTIVE',
      lockedFields: ['nickname'],
      draft: { nickname: 'Ember' },
    });
    expect(gateway.saves).toHaveLength(4);
  });

  it('rejects incomplete Advanced confirmation and does not call the gateway', async () => {
    const gateway = new FakeGateway(advancedSnapshot());
    const service = serviceWith(gateway);

    await expect(service.prepareAdvanced(gateway.snapshot)).rejects.toThrow(/bounded text/);
    expect(gateway.saves).toHaveLength(0);
  });
});

class FakeGateway implements UniversalCharacterCreationGateway {
  public readonly saves: Array<{ expectedRevision: number; session: CharacterCreationSession }> =
    [];
  public readonly quickCommits: Array<{
    expectedRevision: number;
    generation: {
      generationRecordId: string;
      validatedOutput: unknown;
      context: unknown;
    };
  }> = [];

  public constructor(public snapshot: UniversalCharacterCreationSnapshot) {}

  public async load(): Promise<UniversalCharacterCreationSnapshot> {
    return this.snapshot;
  }

  public async start(): Promise<UniversalCharacterCreationSnapshot> {
    return this.snapshot;
  }

  public async save(command: {
    expectedRevision: number;
    session: CharacterCreationSession;
  }): Promise<UniversalCharacterCreationSnapshot> {
    this.saves.push(command);
    this.snapshot = { ...this.snapshot, session: command.session };
    return this.snapshot;
  }

  public async commitQuick(command: {
    expectedRevision: number;
    generation: {
      generationRecordId: string;
      validatedOutput: unknown;
      context: unknown;
    };
  }): Promise<UniversalCharacterCreationSnapshot> {
    this.quickCommits.push(command);
    const session = this.snapshot.session;
    if (session === null) throw new Error('Fixture session missing');
    const output = command.generation.validatedOutput as Parameters<typeof buildQuickDraft>[1];
    const draft = buildQuickDraft(session, output, command.generation.generationRecordId);
    const ready = stageQuickCharacterDraft(
      session,
      draft,
      generationRecordId(command.generation.generationRecordId),
      this.snapshot.extensionDefinitions,
      isoTimestamp('2026-08-20T02:01:00.000Z'),
    );
    this.snapshot = { ...this.snapshot, session: ready };
    return this.snapshot;
  }

  public async confirm(): Promise<UniversalCharacterCreationSnapshot> {
    return this.snapshot;
  }
}

function serviceWith(gateway: FakeGateway) {
  return new UniversalCharacterCreationService(
    gateway,
    new FakeAIProvider(),
    () => ({
      requestId: aiRequestId('character-quick-request-fixed'),
      generationRecordId: generationRecordId('character-quick-generation-fixed'),
      idempotencyKey: idempotencyKey('character:quick:fixed'),
    }),
    { resolveTemperature: async () => 0.7 },
  );
}

function quickSnapshot(): UniversalCharacterCreationSnapshot {
  const base = advancedSnapshot();
  const session = base.session;
  if (session === null) throw new Error('Fixture session missing');
  return {
    ...base,
    session: createCharacterCreationSession(
      {
        id: 'session-windows-quick',
        campaignId: campaignKey,
        characterId: characterKey,
        constitutionRevision: 1,
        mode: 'QUICK',
        conceptInput: 'A world-walking scholar.',
        draft: session.draft,
        createdAt: at,
      },
      [],
    ),
  };
}

function advancedSnapshot(): UniversalCharacterCreationSnapshot {
  const draft = createUniversalCharacterDraft({
    schemaVersion: 1,
    id: characterKey,
    campaignId: campaignKey,
    name: '',
    nickname: null,
    gender: null,
    age: null,
    identity: '',
    ancestry: null,
    birthplace: null,
    socialClass: null,
    faith: null,
    appearance: '',
    personality: '',
    values: [],
    goals: [],
    fears: [],
    secrets: [],
    family: [],
    education: [],
    importantPeople: [],
    enemies: [],
    experiences: [],
    concept: '',
    storyPreferences: [],
    contentBoundaries: {
      allowHorror: true,
      allowPermanentDeath: false,
      allowRomance: true,
      allowBetrayal: true,
      excludedContent: [],
    },
    career: { id: null, displayName: '', legacyArchetype: 'WARRIOR' },
    attributes: { physique: 3, agility: 3, knowledge: 2, charisma: 2 },
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
      birthplace: '',
      formativeExperience: '',
      adventureMotivation: '',
      secret: '',
      importantPerson: '',
      tavernArrivalReason: '',
    },
    extensions: [],
  });
  return {
    campaignState: 'CREATING_CHARACTER',
    constitution: constitution(),
    extensionDefinitions: [],
    session: createCharacterCreationSession(
      {
        id: 'session-windows-advanced',
        campaignId: campaignKey,
        characterId: characterKey,
        constitutionRevision: 1,
        mode: 'ADVANCED',
        conceptInput: null,
        draft,
        createdAt: at,
      },
      [],
    ),
  };
}

function constitution() {
  return {
    schemaVersion: 1,
    worldType: 'Low heroic fantasy',
    era: 'Late medieval sail age',
    technology: 'Late medieval',
    magic: 'Magic always leaves a warm trace.',
    peoples: ['Coastal humans'],
    society: 'Harbor guilds connect isolated settlements.',
    politics: 'Local councils negotiate with navigation guilds.',
    economy: 'Fishing, coastal trade, and beacon tolls.',
    combatScale: 'Personal conflict.',
    deathRules: 'Death is permanent.',
    careerRules: 'Careers arise from local guilds.',
    equipmentRules: 'Equipment follows grounded craft.',
    npcRules: 'NPC motives follow bounded knowledge.',
    traitRules: 'Traits require local validation.',
    taboos: [],
  };
}
