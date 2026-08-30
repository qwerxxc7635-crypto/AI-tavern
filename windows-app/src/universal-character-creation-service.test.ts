import {
  FakeAIProvider,
  StandardAIError,
  type AIProvider,
  type NormalizedAIRequest,
  type ProviderConfig,
} from '@ember-tavern/ai-core';
import {
  aiRequestId,
  campaignId,
  careerEvidenceFor,
  careerId,
  createCareerDefinition,
  createCareerPool,
  createCharacterCreationSession,
  createUniversalCharacterDraft,
  generationRecordId,
  idempotencyKey,
  isoTimestamp,
  playerCharacterId,
  stageQuickCharacterDraft,
  type CharacterCreationSession,
  type CareerPool,
  type CareerCandidate,
} from '@ember-tavern/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  CAREER_MAX_OUTPUT_TOKENS,
  CAREER_OPERATION_TIMEOUT_MS,
  CAREER_PROVIDER_IDLE_TIMEOUT_MS,
  UniversalCharacterCreationService,
  buildQuickDraft,
  type UniversalCharacterCreationGateway,
  type UniversalCharacterCreationSnapshot,
} from './universal-character-creation-service.js';

const campaignKey = campaignId('campaign-windows-creation-v3');
const characterKey = playerCharacterId('character-windows-creation-v3');
const at = isoTimestamp('2026-08-20T02:00:00.000Z');

describe('UniversalCharacterCreationService', () => {
  it('generates and commits an initial four-tier Career Pool before character creation', async () => {
    const gateway = new FakeGateway({ ...advancedSnapshot(), careerPool: null, session: null });
    const provider = new CareerPoolProvider();
    const service = serviceWith(gateway, provider);

    const result = await service.generateInitialCareerPool(gateway.snapshot);

    expect(result.careerPool?.careers.map(({ rarity }) => rarity)).toEqual([
      'COMMON',
      'UNCOMMON',
      'RARE',
      'SPECIAL',
    ]);
    expect(gateway.careerCommits).toHaveLength(1);
    expect(gateway.careerCommits[0]).toMatchObject({
      expectedRevision: 0,
      generation: {
        context: {
          campaignId: campaignKey,
          constitutionRevision: 1,
          expectedPoolRevision: 0,
        },
      },
    });
    expect(provider.careerRequests).toHaveLength(1);
    expect(provider.careerRequests[0]).toMatchObject({
      maxOutputTokens: CAREER_MAX_OUTPUT_TOKENS,
      timeoutMs: CAREER_PROVIDER_IDLE_TIMEOUT_MS,
    });
    expect(CAREER_OPERATION_TIMEOUT_MS).toBeGreaterThan(CAREER_PROVIDER_IDLE_TIMEOUT_MS * 2);
  });

  it('fails a timed-out Career Pool closed without attempting a commit', async () => {
    const gateway = new FakeGateway({ ...advancedSnapshot(), careerPool: null, session: null });
    const service = serviceWith(gateway, new TimedOutCareerPoolProvider());

    await expect(service.generateInitialCareerPool(gateway.snapshot)).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    expect(gateway.careerCommits).toHaveLength(0);
    expect(gateway.snapshot.careerPool).toBeNull();
  });

  it('deduplicates concurrent Career Pool intent through the single transaction commit', async () => {
    const gateway = new FakeGateway({ ...advancedSnapshot(), careerPool: null, session: null });
    const provider = new DelayedCareerPoolProvider();
    const service = serviceWith(gateway, provider);

    const [first, second] = await Promise.all([
      service.generateInitialCareerPool(gateway.snapshot),
      service.generateInitialCareerPool(gateway.snapshot),
    ]);

    expect(first.careerPool).toEqual(second.careerPool);
    expect(provider.calls).toBe(1);
    expect(gateway.careerCommits).toHaveLength(1);
  });

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

  it('returns exactly three provisional field candidates and validates them for consistency', async () => {
    const gateway = new FakeGateway(advancedSnapshot());
    const service = serviceWith(gateway);
    const session = gateway.snapshot.session;
    if (session === null) throw new Error('Fixture session missing');

    const candidates = await service.assistField(
      gateway.snapshot,
      session.draft,
      session.lockedFields,
      'identity',
      'OPTIONS',
      new AbortController().signal,
    );

    expect(candidates).toEqual([
      '命运候选一：identity',
      '命运候选二：identity',
      '命运候选三：identity',
    ]);
    expect(gateway.snapshot.session?.draft.identity).toBe('');
  });

  it('fills every empty unlocked narrative field without changing rules-owned state', async () => {
    const gateway = new FakeGateway(advancedSnapshot());
    const provider = new CapturingCharacterProvider();
    const service = serviceWith(gateway, provider);
    const session = gateway.snapshot.session;
    if (session === null) throw new Error('Fixture session missing');

    const preview = await service.generateDraftPreview(
      gateway.snapshot,
      session.draft,
      ['nickname'],
      { scope: 'FILL_EMPTY' },
      new AbortController().signal,
    );

    expect(preview.draft).toMatchObject({
      nickname: null,
      identity: '由命运补全的identity',
      attributes: session.draft.attributes,
      wealth: 0,
      skills: [],
    });
    expect(preview.changedPaths).not.toContain('nickname');
    expect(preview.changedPaths).not.toContain('attributes.knowledge');
    expect(
      provider.requests.find(({ task }) => task === 'EDIT_CHARACTER_DRAFT')?.messages.at(-1)
        ?.content,
    ).toContain('"lockedFields":["nickname"]');
  });

  it('repairs malformed field output once and rejects a semantic contradiction', async () => {
    const repairGateway = new FakeGateway(advancedSnapshot());
    const repairService = serviceWith(repairGateway, new InvalidCharacterEditOnceProvider());
    const repairSession = repairGateway.snapshot.session;
    if (repairSession === null) throw new Error('Fixture session missing');
    await expect(
      repairService.assistField(
        repairGateway.snapshot,
        repairSession.draft,
        repairSession.lockedFields,
        'identity',
        'GENERATE',
        new AbortController().signal,
      ),
    ).resolves.toEqual(['修复后的调查员身份']);

    const contradictionGateway = new FakeGateway(advancedSnapshot());
    const contradictionService = serviceWith(
      contradictionGateway,
      new ContradictingCharacterProvider(),
    );
    const contradictionSession = contradictionGateway.snapshot.session;
    if (contradictionSession === null) throw new Error('Fixture session missing');
    await expect(
      contradictionService.assistField(
        contradictionGateway.snapshot,
        contradictionSession.draft,
        contradictionSession.lockedFields,
        'identity',
        'GENERATE',
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'CHARACTER_CONTRADICTION' });
  });
});

class InvalidCharacterEditOnceProvider extends FakeAIProvider {
  public override async generate(request: NormalizedAIRequest, config: ProviderConfig) {
    if (request.task === 'EDIT_CHARACTER_DRAFT' && !request.requestId.endsWith('-repair')) {
      const response = await super.generate(request, config);
      return { ...response, content: '{}' };
    }
    if (request.task === 'EDIT_CHARACTER_DRAFT') {
      const response = await super.generate({ ...request, task: 'CHECK_CONSISTENCY' }, config);
      return {
        ...response,
        requestId: request.requestId,
        content: JSON.stringify({
          kind: 'DRAFT_PATCH',
          updates: [{ path: 'identity', value: '修复后的调查员身份' }],
        }),
      };
    }
    return super.generate(request, config);
  }
}

class CapturingCharacterProvider extends FakeAIProvider {
  public readonly requests: NormalizedAIRequest[] = [];

  public override generate(request: NormalizedAIRequest, config: ProviderConfig) {
    this.requests.push(request);
    return super.generate(request, config);
  }
}

class ContradictingCharacterProvider extends FakeAIProvider {
  public override async generate(request: NormalizedAIRequest, config: ProviderConfig) {
    const response = await super.generate(request, config);
    return request.task === 'CHECK_CONSISTENCY'
      ? {
          ...response,
          content: JSON.stringify({
            consistent: false,
            issues: [
              { severity: 'ERROR', path: 'identity', message: 'Conflicts with a locked rule.' },
            ],
          }),
        }
      : response;
  }
}

class CareerPoolProvider extends FakeAIProvider {
  public readonly careerRequests: NormalizedAIRequest[] = [];

  public override async generate(request: NormalizedAIRequest, config: ProviderConfig) {
    const response = await super.generate(request, config);
    if (request.task !== 'GENERATE_CAREER_POOL') return response;
    this.careerRequests.push(request);
    return {
      ...response,
      content: JSON.stringify({ schemaVersion: 1, careers: generatedCareerCandidates() }),
    };
  }
}

class TimedOutCareerPoolProvider extends CareerPoolProvider {
  public override async generate(request: NormalizedAIRequest, config: ProviderConfig) {
    if (request.task === 'GENERATE_CAREER_POOL') throw new StandardAIError('TIMEOUT');
    return super.generate(request, config);
  }
}

class DelayedCareerPoolProvider extends CareerPoolProvider {
  public calls = 0;

  public override async generate(request: NormalizedAIRequest, config: ProviderConfig) {
    if (request.task === 'GENERATE_CAREER_POOL') {
      this.calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return super.generate(request, config);
  }
}

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
  public readonly careerCommits: Array<{
    expectedRevision: number;
    generation: { generationRecordId: string; validatedOutput: unknown; context: unknown };
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

  public async commitCareerPool(command: {
    expectedRevision: number;
    generation: { generationRecordId: string; validatedOutput: unknown; context: unknown };
  }): Promise<CareerPool> {
    this.careerCommits.push(command);
    if (this.snapshot.careerPool !== null) return this.snapshot.careerPool;
    const output = command.generation.validatedOutput as {
      readonly careers: readonly CareerCandidate[];
    };
    const careers = output.careers.map((candidate) =>
      createCareerDefinition({
        ...candidate,
        schemaVersion: 1,
        campaignId: campaignKey,
        constitutionRevision: 1,
        source: 'INITIAL_GENERATION',
        generationRecordId: generationRecordId(command.generation.generationRecordId),
        createdAt: at,
      }),
    );
    const pool = createCareerPool({
      schemaVersion: 1,
      campaignId: campaignKey,
      constitutionRevision: 1,
      careers,
      revision: 1,
      createdAt: at,
      updatedAt: at,
    });
    this.snapshot = { ...this.snapshot, careerPool: pool };
    return pool;
  }
}

function serviceWith(gateway: FakeGateway, provider: AIProvider = new FakeAIProvider()) {
  return new UniversalCharacterCreationService(
    gateway,
    provider,
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
    career: {
      id: careerId('career-lantern-warden'),
      displayName: 'Lantern Warden',
      legacyArchetype: 'WARRIOR',
    },
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
    campaignId: campaignKey,
    campaignState: 'CREATING_CHARACTER',
    constitutionRevision: 1,
    constitution: constitution(),
    extensionDefinitions: [],
    careerPool: careerPool(),
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

function careerPool(): CareerPool {
  const content = constitution();
  return createCareerPool({
    schemaVersion: 1,
    campaignId: campaignKey,
    constitutionRevision: 1,
    careers: [
      createCareerDefinition({
        schemaVersion: 1,
        id: careerId('career-lantern-warden'),
        campaignId: campaignKey,
        constitutionRevision: 1,
        name: 'Lantern Warden',
        rarity: 'COMMON',
        role: 'Maintains beacon roads.',
        skills: ['Route keeping'],
        equipmentTags: ['Beacon lantern'],
        socialPosition: 'Licensed guild member',
        relationshipHooks: ['Answers to the Lantern Guild'],
        risks: ['Must answer when a beacon fails'],
        requirements: ['Guild apprenticeship'],
        constitutionEvidence: careerEvidenceFor(content),
        legacyArchetype: 'WARRIOR',
        source: 'INITIAL_GENERATION',
        generationRecordId: generationRecordId('generation-career-pool'),
        createdAt: at,
      }),
    ],
    revision: 1,
    createdAt: at,
    updatedAt: at,
  });
}

function generatedCareerCandidates(): readonly CareerCandidate[] {
  const content = constitution();
  return (['COMMON', 'UNCOMMON', 'RARE', 'SPECIAL'] as const).map((rarity, index) => ({
    id: `career-generated-${index}`,
    name: `Generated Career ${index}`,
    rarity,
    role: `World role ${index}`,
    skills: [`Skill ${index}`],
    equipmentTags: [`Tool ${index}`],
    socialPosition: `Position ${index}`,
    relationshipHooks: [`Hook ${index}`],
    risks: [`Risk ${index}`],
    requirements: [`Requirement ${index}`],
    constitutionEvidence: careerEvidenceFor(content),
    legacyArchetype: ['WARRIOR', 'ROGUE', 'SCHOLAR', 'DIPLOMAT'][index] as
      'WARRIOR' | 'ROGUE' | 'SCHOLAR' | 'DIPLOMAT',
  }));
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
