import type { PlayerAttributes } from './character.js';
import type {
  CampaignId,
  CharacterTraitId,
  IdempotencyKey,
  IsoTimestamp,
  ItemId,
  PlayerCharacterId,
  QuestId,
  RulesEventId,
  SchemaVersion,
} from './foundation.js';
import type { QuestStatus } from './quest.js';

export const RULE_COMMAND_AUTHORITIES = ['LOCAL_RULE', 'PLAYER_ACTION', 'SYSTEM'] as const;
export type RuleCommandAuthority = (typeof RULE_COMMAND_AUTHORITIES)[number];

export const RULE_STATUS_KINDS = ['BUFF', 'DEBUFF', 'NEUTRAL'] as const;
export type RuleStatusKind = (typeof RULE_STATUS_KINDS)[number];

export interface RuleSkill {
  readonly key: string;
  readonly value: number;
}

export interface RuleStatus {
  readonly id: string;
  readonly kind: RuleStatusKind;
  readonly label: string;
  readonly attributeModifiers: Partial<Readonly<Record<keyof PlayerAttributes, number>>>;
  readonly expiresAtGameMinute: number | null;
}

export interface RuleResource {
  readonly key: string;
  readonly current: number;
  readonly max: number;
}

export type TraitModifierTarget =
  | Readonly<{ kind: 'ATTRIBUTE'; key: keyof PlayerAttributes }>
  | Readonly<{ kind: 'SKILL'; key: string }>
  | Readonly<{ kind: 'RESOURCE'; key: string }>;

export interface TraitRuleModifier {
  readonly traitId: CharacterTraitId;
  readonly target: TraitModifierTarget;
  readonly modifier: number;
}

export interface CharacterRuleState {
  readonly schemaVersion: SchemaVersion;
  readonly campaignId: CampaignId;
  readonly playerCharacterId: PlayerCharacterId;
  readonly baseAttributes: PlayerAttributes;
  readonly skills: readonly RuleSkill[];
  readonly hitPoints: Readonly<{ current: number; max: number }>;
  readonly statuses: readonly RuleStatus[];
  readonly equippedItemIds: readonly ItemId[];
  readonly money: number;
  readonly gameTimeMinutes: number;
  readonly traitModifiers: readonly TraitRuleModifier[];
  readonly resources: readonly RuleResource[];
  readonly revision: number;
  readonly updatedAt: IsoTimestamp;
}

interface RuleCommandBase {
  readonly campaignId: CampaignId;
  readonly playerCharacterId: PlayerCharacterId;
  readonly authority: RuleCommandAuthority;
}

export type RulesCommand =
  | (RuleCommandBase & Readonly<{ kind: 'TAKE_DAMAGE'; amount: number }>)
  | (RuleCommandBase & Readonly<{ kind: 'RECOVER_HP'; amount: number }>)
  | (RuleCommandBase & Readonly<{ kind: 'DEFINE_SKILL'; skill: RuleSkill }>)
  | (RuleCommandBase & Readonly<{ kind: 'CHANGE_SKILL'; skillKey: string; delta: number }>)
  | (RuleCommandBase & Readonly<{ kind: 'ADD_STATUS'; status: RuleStatus }>)
  | (RuleCommandBase & Readonly<{ kind: 'REMOVE_STATUS'; statusId: string }>)
  | (RuleCommandBase & Readonly<{ kind: 'EQUIP_ITEM'; itemId: ItemId }>)
  | (RuleCommandBase & Readonly<{ kind: 'UNEQUIP_ITEM'; itemId: ItemId }>)
  | (RuleCommandBase & Readonly<{ kind: 'CHANGE_MONEY'; delta: number }>)
  | (RuleCommandBase & Readonly<{ kind: 'ADVANCE_TIME'; minutes: number }>)
  | (RuleCommandBase & Readonly<{ kind: 'DEFINE_RESOURCE'; resource: RuleResource }>)
  | (RuleCommandBase & Readonly<{ kind: 'CHANGE_RESOURCE'; resourceKey: string; delta: number }>)
  | (RuleCommandBase &
      Readonly<{
        kind: 'SET_TRAIT_MODIFIER';
        traitId: CharacterTraitId;
        target: TraitModifierTarget;
        modifier: number;
      }>)
  | (RuleCommandBase & Readonly<{ kind: 'REMOVE_TRAIT_MODIFIER'; traitId: CharacterTraitId }>)
  | (RuleCommandBase &
      Readonly<{ kind: 'TRANSITION_QUEST'; questId: QuestId; status: QuestStatus }>);

export type RulesCommandKind = RulesCommand['kind'];

export interface RulesEvent {
  readonly id: RulesEventId;
  readonly campaignId: CampaignId;
  readonly playerCharacterId: PlayerCharacterId;
  readonly idempotencyKey: IdempotencyKey;
  readonly command: RulesCommand;
  readonly beforeRevision: number;
  readonly afterRevision: number;
  readonly stateBefore: CharacterRuleState;
  readonly stateAfter: CharacterRuleState;
  readonly questBeforeStatus: QuestStatus | null;
  readonly questAfterStatus: QuestStatus | null;
  readonly occurredAt: IsoTimestamp;
}
