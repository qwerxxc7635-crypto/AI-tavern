import { describe, expect, it } from 'vitest';

import {
  WindowsCharacterCreationService,
  type CharacterCreationGateway,
  type CharacterCreationSnapshot,
  type CharacterDraft,
} from './character-creation-service.js';

describe('WindowsCharacterCreationService', () => {
  it('validates Fake Provider traits before committing them through the native gateway', async () => {
    const gateway = new FakeCharacterGateway();
    const service = new WindowsCharacterCreationService(gateway, undefined, identityFactory());

    const generated = await service.generateTraits(characterDraft());

    expect(generated.traitCandidates).toHaveLength(6);
    expect(gateway.traitCommits).toHaveLength(1);
    expect(gateway.traitCommits[0]).toMatchObject({
      campaignId: 'campaign-character',
      generation: {
        requestId: 'character-request-1',
        generationRecordId: 'character-generation-1',
        promptVersion: 2,
        context: { character: { name: '林鸦' } },
      },
    });
  });

  it('uses exactly two persisted traits to propose then confirm a complete character', async () => {
    const gateway = new FakeCharacterGateway();
    const service = new WindowsCharacterCreationService(gateway, undefined, identityFactory());
    const traits = await service.generateTraits(characterDraft());

    const completed = await service.complete(
      characterDraft(),
      'character-generation-1',
      traits.traitCandidates.slice(0, 2),
    );

    expect(completed).toMatchObject({
      campaignState: 'CREATING_CHARACTER',
      character: null,
      candidate: {
        kind: 'COMPLETE_CHARACTER',
        selectedTraits: [
          { id: traits.traitCandidates[0]?.id },
          { id: traits.traitCandidates[1]?.id },
        ],
      },
    });
    expect(gateway.completionCommits[0]).toMatchObject({
      traitGenerationRecordId: 'character-generation-1',
      selectedTraits: traits.traitCandidates.slice(0, 2),
      generation: {
        requestId: 'character-request-2',
        promptVersion: 2,
      },
    });
    const committed = await service.confirm('campaign-character', 'candidate-complete');
    expect(committed).toMatchObject({
      campaignState: 'GENERATING_TAVERN',
      candidate: null,
      character: { name: '林鸦' },
    });
  });

  it('rejects an invalid attribute total before contacting persistence', async () => {
    const gateway = new FakeCharacterGateway();
    const service = new WindowsCharacterCreationService(gateway);

    await expect(
      service.generateTraits({
        ...characterDraft(),
        attributes: { physique: 5, agility: 3, knowledge: 2, charisma: 2 },
      }),
    ).rejects.toThrow('Attributes must total 10');
    expect(gateway.traitCommits).toHaveLength(0);
  });
});

class FakeCharacterGateway implements CharacterCreationGateway {
  public snapshot: CharacterCreationSnapshot = {
    campaignState: 'CREATING_CHARACTER',
    draft: null,
    traitGenerationRecordId: null,
    traitCandidates: [],
    candidate: null,
    character: null,
  };
  public readonly traitCommits: Array<Parameters<CharacterCreationGateway['commitTraits']>[0]> = [];
  public readonly completionCommits: Array<
    Parameters<CharacterCreationGateway['commitCompletion']>[0]
  > = [];

  public async load(): Promise<CharacterCreationSnapshot> {
    return this.snapshot;
  }

  public async commitTraits(
    command: Parameters<CharacterCreationGateway['commitTraits']>[0],
  ): Promise<CharacterCreationSnapshot> {
    this.traitCommits.push(command);
    const validated = command.generation.validatedOutput as {
      readonly traits: readonly { readonly name: string; readonly description: string }[];
    };
    this.snapshot = {
      campaignState: 'CREATING_CHARACTER',
      draft: command.character,
      traitGenerationRecordId: command.generation.generationRecordId,
      traitCandidates: validated.traits.map((trait, index) => ({
        id: `${command.generation.generationRecordId}:trait:${index}`,
        ...trait,
      })),
      candidate: {
        id: 'candidate-traits',
        kind: 'CHARACTER_TRAITS',
        draft: command.character,
        traitGenerationRecordId: command.generation.generationRecordId,
        traitCandidates: validated.traits.map((trait, index) => ({
          id: `${command.generation.generationRecordId}:trait:${index}`,
          ...trait,
        })),
        selectedTraits: [],
        background: null,
        initialEquipment: [],
      },
      character: null,
    };
    return this.snapshot;
  }

  public async commitCompletion(
    command: Parameters<CharacterCreationGateway['commitCompletion']>[0],
  ): Promise<CharacterCreationSnapshot> {
    this.completionCommits.push(command);
    const validated = command.generation.validatedOutput as {
      readonly background: {
        readonly birthplace: string;
        readonly formativeExperience: string;
        readonly adventureMotivation: string;
        readonly secret: string;
        readonly importantPerson: string;
        readonly tavernArrivalReason: string;
      };
      readonly initialEquipment: readonly {
        readonly name: string;
        readonly description: string;
      }[];
    };
    this.snapshot = {
      campaignState: 'CREATING_CHARACTER',
      draft: command.character,
      traitGenerationRecordId: command.traitGenerationRecordId,
      traitCandidates: this.snapshot.traitCandidates,
      candidate: {
        id: 'candidate-complete',
        kind: 'COMPLETE_CHARACTER',
        draft: command.character,
        traitGenerationRecordId: command.traitGenerationRecordId,
        traitCandidates: this.snapshot.traitCandidates,
        selectedTraits: command.selectedTraits,
        background: validated.background,
        initialEquipment: validated.initialEquipment.map((item, index) => ({
          id: `item-${index}`,
          ...item,
          effect:
            index === 0
              ? { kind: 'CHECK_MODIFIER', attribute: 'physique', modifier: 1 }
              : { kind: 'NONE' },
        })),
      },
      character: null,
    };
    return this.snapshot;
  }

  public async confirmCandidate(): Promise<CharacterCreationSnapshot> {
    const candidate = this.snapshot.candidate;
    if (candidate === null || candidate.background === null) throw new Error('candidate missing');
    this.snapshot = {
      campaignState: 'GENERATING_TAVERN',
      draft: candidate.draft,
      traitGenerationRecordId: null,
      traitCandidates: [],
      candidate: null,
      character: {
        ...candidate.draft,
        traits: candidate.selectedTraits,
        background: candidate.background,
        initialEquipment: candidate.initialEquipment,
        createdAt: '2026-07-31T12:00:00.000Z',
        updatedAt: '2026-07-31T12:00:00.000Z',
      },
    };
    return this.snapshot;
  }
}

function identityFactory() {
  let sequence = 0;
  return () => {
    sequence += 1;
    return {
      requestId: `character-request-${sequence}`,
      generationRecordId: `character-generation-${sequence}`,
      idempotencyKey: `character-idempotency-${sequence}`,
    };
  };
}

function characterDraft(): CharacterDraft {
  return {
    id: 'character-player',
    campaignId: 'campaign-character',
    name: '林鸦',
    gender: null,
    age: 24,
    concept: '追查失踪商队的荒野向导',
    storyPreferences: ['探索', '谜团'],
    contentBoundaries: {
      allowHorror: false,
      allowPermanentDeath: false,
      allowRomance: true,
      allowBetrayal: true,
      excludedContent: [],
    },
    classArchetype: 'ROGUE',
    classDisplayName: '寻路者',
    attributes: { physique: 2, agility: 4, knowledge: 3, charisma: 1 },
    personalGoal: '找到失踪的姐姐。',
  };
}
