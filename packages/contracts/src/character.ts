import type {
  CampaignId,
  CharacterTraitId,
  IsoTimestamp,
  ItemId,
  PlayerCharacterId,
} from './foundation.js';

export const CHARACTER_ATTRIBUTE_NAMES = ['physique', 'agility', 'knowledge', 'charisma'] as const;
export type CharacterAttributeName = (typeof CHARACTER_ATTRIBUTE_NAMES)[number];

export interface PlayerAttributes {
  readonly physique: number;
  readonly agility: number;
  readonly knowledge: number;
  readonly charisma: number;
}

export type PlayerAttributesInput = Record<CharacterAttributeName, number>;

export class AttributeAllocationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AttributeAllocationError';
  }
}

export function createPlayerAttributes(input: PlayerAttributesInput): PlayerAttributes {
  for (const name of CHARACTER_ATTRIBUTE_NAMES) {
    const value = input[name];
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      throw new AttributeAllocationError(`${name} must be an integer from 1 to 5`);
    }
  }

  const total = CHARACTER_ATTRIBUTE_NAMES.reduce((sum, name) => sum + input[name], 0);
  if (total !== 10) {
    throw new AttributeAllocationError('Attributes must total 10 points (base 4 plus 6 allocated)');
  }

  return Object.freeze({ ...input });
}

export const CLASS_ARCHETYPES = ['WARRIOR', 'ROGUE', 'SCHOLAR', 'DIPLOMAT'] as const;
export type ClassArchetype = (typeof CLASS_ARCHETYPES)[number];

export interface CharacterTrait {
  readonly id: CharacterTraitId;
  readonly name: string;
  readonly description: string;
}

export interface CharacterBackground {
  readonly birthplace: string;
  readonly formativeExperience: string;
  readonly adventureMotivation: string;
  readonly secret: string;
  readonly importantPerson: string;
  readonly tavernArrivalReason: string;
}

export interface ContentBoundaries {
  readonly allowHorror: boolean;
  readonly allowPermanentDeath: boolean;
  readonly allowRomance: boolean;
  readonly allowBetrayal: boolean;
  readonly excludedContent: readonly string[];
}

export interface InitialEquipmentReference {
  readonly itemId: ItemId;
}

export interface PlayerCharacter {
  readonly id: PlayerCharacterId;
  readonly campaignId: CampaignId;
  readonly name: string;
  readonly gender: string | null;
  readonly age: number | null;
  readonly concept: string;
  readonly storyPreferences: readonly string[];
  readonly contentBoundaries: ContentBoundaries;
  readonly classArchetype: ClassArchetype;
  readonly classDisplayName: string;
  readonly attributes: PlayerAttributes;
  readonly traits: readonly [CharacterTrait, CharacterTrait];
  readonly personalGoal: string;
  readonly background: CharacterBackground;
  readonly initialEquipment: readonly InitialEquipmentReference[];
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}
