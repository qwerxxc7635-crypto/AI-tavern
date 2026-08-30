import type {
  CampaignId,
  WorldConstitution,
  WorldConstitutionContent,
} from '@ember-tavern/contracts';

export interface ConstitutionBoundContent {
  readonly campaignId: CampaignId;
  readonly constitutionRevision: number;
}

export interface ConstitutionWorldProjection {
  readonly technologyLevel: string;
  readonly powerRules: readonly string[];
  readonly forbiddenElements: readonly string[];
}

export class WorldConstitutionRuleError extends Error {
  public constructor(
    public readonly code:
      | 'CONSTITUTION_NOT_LOCKED'
      | 'CONSTITUTION_REVISION_MISMATCH'
      | 'CONSTITUTION_CAMPAIGN_MISMATCH'
      | 'CONSTITUTION_WORLD_MISMATCH',
    public readonly paths: readonly string[],
  ) {
    super('World Constitution rule rejected content');
    this.name = 'WorldConstitutionRuleError';
  }
}

export function assertConstitutionBinding(
  constitution: WorldConstitution,
  content: ConstitutionBoundContent,
): void {
  if (constitution.status !== 'LOCKED') {
    throw new WorldConstitutionRuleError('CONSTITUTION_NOT_LOCKED', ['status']);
  }
  if (constitution.campaignId !== content.campaignId) {
    throw new WorldConstitutionRuleError('CONSTITUTION_CAMPAIGN_MISMATCH', ['campaignId']);
  }
  if (constitution.revision !== content.constitutionRevision) {
    throw new WorldConstitutionRuleError('CONSTITUTION_REVISION_MISMATCH', [
      'constitutionRevision',
    ]);
  }
}

export function assertWorldConstitutionCompliance(
  constitution: WorldConstitutionContent,
  world: ConstitutionWorldProjection,
): void {
  const mismatches: string[] = [];
  if (world.technologyLevel !== constitution.technology) mismatches.push('technologyLevel');
  if (!world.powerRules.includes(constitution.magic)) mismatches.push('powerRules');
  for (const taboo of constitution.taboos) {
    if (!world.forbiddenElements.includes(taboo)) mismatches.push('forbiddenElements');
  }
  if (mismatches.length > 0) {
    throw new WorldConstitutionRuleError(
      'CONSTITUTION_WORLD_MISMATCH',
      Object.freeze([...new Set(mismatches)]),
    );
  }
}
