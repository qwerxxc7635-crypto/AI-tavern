import {
  TraitBalanceError,
  buildTraitGenerationFeedback,
  createTraitWorldRuleKey,
  evaluateCharacterTraitBalance,
  evaluateCharacterTraitSynergy,
  type CharacterTrait,
  type TraitBalanceReport,
  type TraitGenerationFeedback,
  type TraitSynergyReport,
} from '@ember-tavern/contracts';

export interface TraitValidationWorldRules {
  readonly scope: string;
  readonly revision: number;
}

export class TraitBalanceValidator {
  public validate(
    traits: readonly CharacterTrait[],
    worldRules: TraitValidationWorldRules,
  ): TraitBalanceReport {
    return evaluateCharacterTraitBalance(traits, worldRuleKey(worldRules));
  }

  public assertValid(
    traits: readonly CharacterTrait[],
    worldRules: TraitValidationWorldRules,
  ): TraitBalanceReport {
    const report = this.validate(traits, worldRules);
    if (!report.valid) {
      throw new TraitBalanceError(
        'TRAIT_BALANCE_REJECTED',
        `Trait balance rejected with ${report.issues.length} explainable issue(s)`,
        { issues: report.issues },
      );
    }
    return report;
  }
}

export class TraitSynergyValidator {
  public validate(
    traits: readonly CharacterTrait[],
    worldRules: TraitValidationWorldRules,
  ): TraitSynergyReport {
    return evaluateCharacterTraitSynergy(traits, worldRuleKey(worldRules));
  }

  public assertValid(
    traits: readonly CharacterTrait[],
    worldRules: TraitValidationWorldRules,
  ): TraitSynergyReport {
    const report = this.validate(traits, worldRules);
    if (!report.valid) {
      throw new TraitBalanceError(
        'TRAIT_BALANCE_REJECTED',
        `Trait synergy rejected with ${report.issues.length} explainable issue(s)`,
        { issues: report.issues },
      );
    }
    return report;
  }
}

export function traitGenerationFeedback(
  traits: readonly CharacterTrait[],
  worldRules: TraitValidationWorldRules,
): TraitGenerationFeedback {
  const balance = new TraitBalanceValidator().validate(traits, worldRules);
  const synergy = new TraitSynergyValidator().validate(traits, worldRules);
  return buildTraitGenerationFeedback(balance, synergy);
}

function worldRuleKey(worldRules: TraitValidationWorldRules): string {
  return createTraitWorldRuleKey(worldRules.scope, worldRules.revision);
}
