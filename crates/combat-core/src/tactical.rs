use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{
    AcceptedCommandLedger, AcceptedCommandSource, CombatCommandEnvelope, CombatCommandPayload,
    CombatCommandSource, CombatControlAssignment, CombatControlAuthority, CombatSide, CombatState,
    CombatSubmissionAccepted, CombatSubmissionError, CombatSubmissionRequest,
    CombatSubmissionService, TacticalPreferenceValue, UtilityStrategy, UtilityWeightAdjustments,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TacticalStrategyPreset {
    Balanced,
    Aggressive,
    Defensive,
    Support,
    Conservative,
}

impl TacticalStrategyPreset {
    #[must_use]
    pub const fn id(self) -> &'static str {
        match self {
            Self::Balanced => "BALANCED",
            Self::Aggressive => "AGGRESSIVE",
            Self::Defensive => "DEFENSIVE",
            Self::Support => "SUPPORT",
            Self::Conservative => "CONSERVATIVE",
        }
    }

    #[must_use]
    pub fn utility_strategy(self) -> UtilityStrategy {
        let adjustments = match self {
            Self::Balanced => UtilityWeightAdjustments::default(),
            Self::Aggressive => UtilityWeightAdjustments {
                damage: 50,
                kill: 30,
                heal: -20,
                defense: -20,
                risk: -30,
                ..UtilityWeightAdjustments::default()
            },
            Self::Defensive => UtilityWeightAdjustments {
                damage: -20,
                defense: 50,
                risk: 50,
                ..UtilityWeightAdjustments::default()
            },
            Self::Support => UtilityWeightAdjustments {
                damage: -20,
                control: 20,
                heal: 60,
                resource: 20,
                ..UtilityWeightAdjustments::default()
            },
            Self::Conservative => UtilityWeightAdjustments {
                damage: -30,
                defense: 30,
                resource: 20,
                risk: 80,
                ..UtilityWeightAdjustments::default()
            },
        };
        UtilityStrategy {
            strategy_id: format!("strategy.{}", self.id().to_ascii_lowercase()),
            adjustments,
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "BALANCED" => Some(Self::Balanced),
            "AGGRESSIVE" => Some(Self::Aggressive),
            "DEFENSIVE" => Some(Self::Defensive),
            "SUPPORT" => Some(Self::Support),
            "CONSERVATIVE" => Some(Self::Conservative),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UltimatePolicy {
    FreeUse,
    EliteBossPriority,
    Hold,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConsumablePolicy {
    Allow,
    EmergencyOnly,
    Disabled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProtectMainCharacterPriority {
    Low,
    Normal,
    High,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TacticalPreferenceSet {
    pub healing_threshold_percent: u8,
    pub ultimate_policy: UltimatePolicy,
    pub consumable_policy: ConsumablePolicy,
    pub protect_main_character: ProtectMainCharacterPriority,
}

impl Default for TacticalPreferenceSet {
    fn default() -> Self {
        Self {
            healing_threshold_percent: 50,
            ultimate_policy: UltimatePolicy::EliteBossPriority,
            consumable_policy: ConsumablePolicy::EmergencyOnly,
            protect_main_character: ProtectMainCharacterPriority::Normal,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompanionTacticalSettings {
    pub companion_id: String,
    pub strategy: TacticalStrategyPreset,
    pub preferences: TacticalPreferenceSet,
    pub last_applied_sequence: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TacticalSettingsProjection {
    pub companions: Vec<CompanionTacticalSettings>,
}

impl TacticalSettingsProjection {
    pub fn project(
        state: &CombatState,
        ledger: &AcceptedCommandLedger,
    ) -> Result<Self, TacticalCommandError> {
        let mut companions = Vec::new();
        for companion_id in &state.formal_party_member_ids {
            let Some(combatant) = state
                .combatants
                .iter()
                .find(|combatant| combatant.combatant_id == *companion_id)
            else {
                return Err(invalid("formalPartyMemberIds"));
            };
            if combatant.side == CombatSide::Companion {
                companions.push(CompanionTacticalSettings {
                    companion_id: companion_id.clone(),
                    strategy: TacticalStrategyPreset::Balanced,
                    preferences: TacticalPreferenceSet::default(),
                    last_applied_sequence: 0,
                });
            }
        }
        for command in ledger.commands() {
            match &command.payload {
                CombatCommandPayload::SetTacticalStrategy {
                    companion_id,
                    strategy_id,
                } => {
                    ensure_player_source(&command.source)?;
                    let settings = find_settings(&mut companions, companion_id)?;
                    settings.strategy = TacticalStrategyPreset::parse(strategy_id)
                        .ok_or_else(|| invalid("strategyId"))?;
                    settings.last_applied_sequence = command.accepted_sequence;
                }
                CombatCommandPayload::SetTacticalPreference {
                    companion_id,
                    preference_key,
                    structured_value,
                } => {
                    ensure_player_source(&command.source)?;
                    let settings = find_settings(&mut companions, companion_id)?;
                    apply_preference(&mut settings.preferences, preference_key, structured_value)?;
                    settings.last_applied_sequence = command.accepted_sequence;
                }
                _ => {}
            }
        }
        Ok(Self { companions })
    }

    #[must_use]
    pub fn settings_for(&self, companion_id: &str) -> Option<&CompanionTacticalSettings> {
        self.companions
            .iter()
            .find(|settings| settings.companion_id == companion_id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TacticalCommandRequest {
    pub command_id: String,
    pub controller_id: String,
    pub actor_id: String,
    pub payload: CombatCommandPayload,
    pub stable_input_point: bool,
}

#[derive(Debug)]
pub struct TacticalCommandAccepted {
    pub submission: CombatSubmissionAccepted,
    pub projection: TacticalSettingsProjection,
}

#[derive(Debug)]
pub enum TacticalCommandError {
    InvalidCommand { path: String },
    Submission(CombatSubmissionError),
}

impl fmt::Display for TacticalCommandError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("tactical command failed")
    }
}

impl Error for TacticalCommandError {}

pub struct TacticalCommandService;

impl TacticalCommandService {
    pub fn submit(
        state: &mut CombatState,
        accepted_commands: &mut AcceptedCommandLedger,
        request: TacticalCommandRequest,
    ) -> Result<TacticalCommandAccepted, TacticalCommandError> {
        validate_requested_change(state, &request.payload)?;
        let mut projected = TacticalSettingsProjection::project(state, accepted_commands)?;
        apply_unsequenced_payload(&mut projected, &request.payload)?;

        let submission = CombatSubmissionService::submit(
            state,
            accepted_commands,
            CombatSubmissionRequest {
                envelope: CombatCommandEnvelope {
                    command_id: request.command_id,
                    source: CombatCommandSource::Player {
                        controller_id: request.controller_id.clone(),
                    },
                    actor_id: request.actor_id.clone(),
                    versions: state.versions,
                    payload: request.payload,
                },
                control_assignments: vec![CombatControlAssignment {
                    combatant_id: request.actor_id,
                    authority: CombatControlAuthority::Player {
                        controller_id: request.controller_id,
                    },
                }],
                stable_input_point: request.stable_input_point,
                known_ability_ids: vec![],
                disabled_ability_ids: vec![],
                legal_target_ids: vec![],
                entity_tags: vec![],
                ability_preconditions: vec![],
                costs: vec![],
                parent_reservation_id: None,
            },
        )
        .map_err(TacticalCommandError::Submission)?;
        let companion_id = payload_companion_id(&submission.command.command.payload)?;
        find_settings(&mut projected.companions, companion_id)?.last_applied_sequence =
            submission.command.command.accepted_sequence;
        Ok(TacticalCommandAccepted {
            submission,
            projection: projected,
        })
    }
}

fn payload_companion_id(payload: &CombatCommandPayload) -> Result<&str, TacticalCommandError> {
    match payload {
        CombatCommandPayload::SetTacticalStrategy { companion_id, .. }
        | CombatCommandPayload::SetTacticalPreference { companion_id, .. } => Ok(companion_id),
        _ => Err(invalid("payload.kind")),
    }
}

fn validate_requested_change(
    state: &CombatState,
    payload: &CombatCommandPayload,
) -> Result<(), TacticalCommandError> {
    let companion_id = match payload {
        CombatCommandPayload::SetTacticalStrategy {
            companion_id,
            strategy_id,
        } => {
            TacticalStrategyPreset::parse(strategy_id).ok_or_else(|| invalid("strategyId"))?;
            companion_id
        }
        CombatCommandPayload::SetTacticalPreference {
            companion_id,
            preference_key,
            structured_value,
        } => {
            let mut preferences = TacticalPreferenceSet::default();
            apply_preference(&mut preferences, preference_key, structured_value)?;
            companion_id
        }
        _ => return Err(invalid("payload.kind")),
    };
    if !state
        .formal_party_member_ids
        .iter()
        .any(|member_id| member_id == companion_id)
        || !state.combatants.iter().any(|combatant| {
            combatant.combatant_id == *companion_id && combatant.side == CombatSide::Companion
        })
    {
        return Err(invalid("companionId"));
    }
    Ok(())
}

fn apply_unsequenced_payload(
    projection: &mut TacticalSettingsProjection,
    payload: &CombatCommandPayload,
) -> Result<(), TacticalCommandError> {
    match payload {
        CombatCommandPayload::SetTacticalStrategy {
            companion_id,
            strategy_id,
        } => {
            find_settings(&mut projection.companions, companion_id)?.strategy =
                TacticalStrategyPreset::parse(strategy_id).ok_or_else(|| invalid("strategyId"))?;
            Ok(())
        }
        CombatCommandPayload::SetTacticalPreference {
            companion_id,
            preference_key,
            structured_value,
        } => apply_preference(
            &mut find_settings(&mut projection.companions, companion_id)?.preferences,
            preference_key,
            structured_value,
        ),
        _ => Err(invalid("payload.kind")),
    }
}

fn find_settings<'a>(
    companions: &'a mut [CompanionTacticalSettings],
    companion_id: &str,
) -> Result<&'a mut CompanionTacticalSettings, TacticalCommandError> {
    companions
        .iter_mut()
        .find(|settings| settings.companion_id == companion_id)
        .ok_or_else(|| invalid("companionId"))
}

fn ensure_player_source(source: &AcceptedCommandSource) -> Result<(), TacticalCommandError> {
    if matches!(source, AcceptedCommandSource::Player { .. }) {
        Ok(())
    } else {
        Err(invalid("source.kind"))
    }
}

fn apply_preference(
    preferences: &mut TacticalPreferenceSet,
    key: &str,
    value: &TacticalPreferenceValue,
) -> Result<(), TacticalCommandError> {
    match (key, value) {
        ("healingThreshold", TacticalPreferenceValue::Integer(value))
            if matches!(value, 30 | 50 | 70) =>
        {
            preferences.healing_threshold_percent = *value as u8;
        }
        ("ultimatePolicy", TacticalPreferenceValue::StableId(value)) => {
            preferences.ultimate_policy = match value.as_str() {
                "FREE_USE" => UltimatePolicy::FreeUse,
                "ELITE_BOSS_PRIORITY" => UltimatePolicy::EliteBossPriority,
                "HOLD" => UltimatePolicy::Hold,
                _ => return Err(invalid("structuredValue")),
            };
        }
        ("consumablePolicy", TacticalPreferenceValue::StableId(value)) => {
            preferences.consumable_policy = match value.as_str() {
                "ALLOW" => ConsumablePolicy::Allow,
                "EMERGENCY_ONLY" => ConsumablePolicy::EmergencyOnly,
                "DISABLED" => ConsumablePolicy::Disabled,
                _ => return Err(invalid("structuredValue")),
            };
        }
        ("protectMainCharacter", TacticalPreferenceValue::StableId(value)) => {
            preferences.protect_main_character = match value.as_str() {
                "LOW" => ProtectMainCharacterPriority::Low,
                "NORMAL" => ProtectMainCharacterPriority::Normal,
                "HIGH" => ProtectMainCharacterPriority::High,
                _ => return Err(invalid("structuredValue")),
            };
        }
        _ => return Err(invalid("preferenceKey")),
    }
    Ok(())
}

fn invalid(path: &str) -> TacticalCommandError {
    TacticalCommandError::InvalidCommand {
        path: path.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CURRENT_COMBAT_VERSIONS, CombatPhase, CombatRng, CombatantRuntime, CombatantState,
        HardCcDrRuntime, ObjectiveRuntimeState, ProvisionalRuntimeDelta, ReinforcementRuntimeState,
        ResourceState, RoundRuntimeState, ShieldRechargeRuntime, TerminalPriorityPolicy,
    };

    const SEED: &str = "33445566778899001122aabbccddeeff";

    #[test]
    fn five_frozen_presets_have_distinct_typed_weight_layers() {
        let presets = [
            TacticalStrategyPreset::Balanced,
            TacticalStrategyPreset::Aggressive,
            TacticalStrategyPreset::Defensive,
            TacticalStrategyPreset::Support,
            TacticalStrategyPreset::Conservative,
        ];
        let strategies: Vec<_> = presets
            .into_iter()
            .map(TacticalStrategyPreset::utility_strategy)
            .collect();
        assert_eq!(strategies.len(), 5);
        for (index, strategy) in strategies.iter().enumerate() {
            assert!(
                strategies[..index]
                    .iter()
                    .all(|previous| previous.adjustments != strategy.adjustments)
            );
        }
    }

    #[test]
    fn strategy_and_every_preference_are_structured_accepted_commands() {
        let mut state = state();
        let mut ledger = AcceptedCommandLedger::new();
        let changes = vec![
            CombatCommandPayload::SetTacticalStrategy {
                companion_id: "companion".to_owned(),
                strategy_id: "SUPPORT".to_owned(),
            },
            preference("healingThreshold", TacticalPreferenceValue::Integer(70)),
            preference(
                "ultimatePolicy",
                TacticalPreferenceValue::StableId("HOLD".to_owned()),
            ),
            preference(
                "consumablePolicy",
                TacticalPreferenceValue::StableId("DISABLED".to_owned()),
            ),
            preference(
                "protectMainCharacter",
                TacticalPreferenceValue::StableId("HIGH".to_owned()),
            ),
        ];
        let mut accepted = None;
        for (index, payload) in changes.into_iter().enumerate() {
            accepted = Some(
                TacticalCommandService::submit(
                    &mut state,
                    &mut ledger,
                    request(&format!("tactical-{index}"), payload, true),
                )
                .unwrap(),
            );
        }
        let settings = accepted
            .unwrap()
            .projection
            .settings_for("companion")
            .unwrap()
            .clone();
        assert_eq!(ledger.commands().len(), 5);
        assert_eq!(settings.strategy, TacticalStrategyPreset::Support);
        assert_eq!(settings.preferences.healing_threshold_percent, 70);
        assert_eq!(settings.preferences.ultimate_policy, UltimatePolicy::Hold);
        assert_eq!(
            settings.preferences.consumable_policy,
            ConsumablePolicy::Disabled
        );
        assert_eq!(
            settings.preferences.protect_main_character,
            ProtectMainCharacterPriority::High
        );
        assert_eq!(settings.last_applied_sequence, 5);
    }

    #[test]
    fn later_change_never_rewrites_an_already_accepted_utility_command() {
        let mut state = state();
        let mut ledger = AcceptedCommandLedger::new();
        let actual = ledger
            .accept_external(CombatCommandEnvelope {
                command_id: "companion-action-1".to_owned(),
                source: CombatCommandSource::UtilityAi,
                actor_id: "companion".to_owned(),
                versions: CURRENT_COMBAT_VERSIONS,
                payload: CombatCommandPayload::UseAbility {
                    ability_id: "ability.attack".to_owned(),
                    target_id: Some("enemy".to_owned()),
                },
            })
            .unwrap()
            .command;
        let changed = TacticalCommandService::submit(
            &mut state,
            &mut ledger,
            request(
                "tactical-after-action",
                CombatCommandPayload::SetTacticalStrategy {
                    companion_id: "companion".to_owned(),
                    strategy_id: "DEFENSIVE".to_owned(),
                },
                true,
            ),
        )
        .unwrap();

        assert_eq!(ledger.commands()[0], actual);
        assert_eq!(ledger.commands()[0].accepted_sequence, 1);
        assert_eq!(changed.submission.command.command.accepted_sequence, 2);
        assert_eq!(
            changed
                .projection
                .settings_for("companion")
                .unwrap()
                .last_applied_sequence,
            2
        );
    }

    #[test]
    fn invalid_values_non_formal_targets_and_closed_input_point_are_atomic() {
        let cases = vec![
            request(
                "bad-strategy",
                CombatCommandPayload::SetTacticalStrategy {
                    companion_id: "companion".to_owned(),
                    strategy_id: "BERSERK".to_owned(),
                },
                true,
            ),
            request(
                "bad-target",
                CombatCommandPayload::SetTacticalStrategy {
                    companion_id: "enemy".to_owned(),
                    strategy_id: "BALANCED".to_owned(),
                },
                true,
            ),
            request(
                "bad-preference",
                preference("healingThreshold", TacticalPreferenceValue::Integer(60)),
                true,
            ),
            request(
                "closed-barrier",
                CombatCommandPayload::SetTacticalStrategy {
                    companion_id: "companion".to_owned(),
                    strategy_id: "BALANCED".to_owned(),
                },
                false,
            ),
        ];
        for request in cases {
            let mut state = state();
            let before = state.clone();
            let mut ledger = AcceptedCommandLedger::new();
            assert!(TacticalCommandService::submit(&mut state, &mut ledger, request).is_err());
            assert_eq!(state, before);
            assert!(ledger.commands().is_empty());
        }
    }

    #[test]
    fn duplicate_command_id_is_idempotent_and_projection_is_replay_derived() {
        let mut state = state();
        let mut ledger = AcceptedCommandLedger::new();
        let command = request(
            "tactical-idempotent",
            CombatCommandPayload::SetTacticalStrategy {
                companion_id: "companion".to_owned(),
                strategy_id: "AGGRESSIVE".to_owned(),
            },
            true,
        );
        let first =
            TacticalCommandService::submit(&mut state, &mut ledger, command.clone()).unwrap();
        let retry = TacticalCommandService::submit(&mut state, &mut ledger, command).unwrap();
        assert_eq!(ledger.commands().len(), 1);
        assert_eq!(
            first.submission.command.command,
            retry.submission.command.command
        );
        assert_eq!(first.projection, retry.projection);
        assert_eq!(
            TacticalSettingsProjection::project(&state, &ledger).unwrap(),
            retry.projection
        );
    }

    fn preference(key: &str, value: TacticalPreferenceValue) -> CombatCommandPayload {
        CombatCommandPayload::SetTacticalPreference {
            companion_id: "companion".to_owned(),
            preference_key: key.to_owned(),
            structured_value: value,
        }
    }

    fn request(
        command_id: &str,
        payload: CombatCommandPayload,
        stable_input_point: bool,
    ) -> TacticalCommandRequest {
        TacticalCommandRequest {
            command_id: command_id.to_owned(),
            controller_id: "controller-main".to_owned(),
            actor_id: "hero".to_owned(),
            payload,
            stable_input_point,
        }
    }

    fn state() -> CombatState {
        CombatState {
            combat_instance_id: "combat-tactical".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.to_owned(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::Stable,
            combatants: vec![
                combatant("companion", CombatSide::Companion),
                combatant("enemy", CombatSide::Hostile),
                combatant("hero", CombatSide::Player),
            ],
            formal_party_member_ids: vec!["companion".to_owned(), "hero".to_owned()],
            combat_inventory: vec![],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![],
            round: RoundRuntimeState {
                round_number: 1,
                completed_round_count: 0,
                active_combatant_id: Some("hero".to_owned()),
                extra_turn_resume_phase: None,
                roster: vec![],
            },
            objectives: ObjectiveRuntimeState {
                objectives: vec![],
                required_objective_ids: vec![],
                completed_objective_ids: vec![],
                failed_objective_ids: vec![],
                committed_signals: vec![],
                failure_records: vec![],
            },
            reinforcements: ReinforcementRuntimeState {
                reinforcements: vec![],
            },
            provisional_delta: ProvisionalRuntimeDelta {
                revision: 0,
                entries: vec![],
            },
            scheduler: None,
            pending_reaction: None,
            result_candidates: vec![],
            terminal_priority_policy: TerminalPriorityPolicy::default(),
            confirmed_result_candidate_id: None,
            confirmed_result: None,
            rng: CombatRng::new(
                SEED,
                "combat-tactical",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }

    fn combatant(id: &str, side: CombatSide) -> CombatantRuntime {
        CombatantRuntime {
            combatant_id: id.to_owned(),
            definition_id: format!("definition-{id}"),
            side,
            state: CombatantState::Active,
            hit_points: 10,
            max_hit_points: 10,
            shield: 0,
            max_shield: 0,
            action_points: 3,
            max_action_points: 3,
            reaction_charges: 1,
            max_reaction_charges: 1,
            resources: vec![ResourceState {
                resource_id: "energy".to_owned(),
                current: 5,
                min_value: 0,
                max_value: 10,
                overheat_threshold: None,
                hard_max_value: None,
            }],
            statuses: vec![],
            ability_usage: vec![],
            basic_attack_count_this_normal_owner_turn: 0,
            once_usage_counters: vec![],
            normal_owner_turn_index: 0,
            hard_cc_dr: HardCcDrRuntime::default(),
            shield_recharge: ShieldRechargeRuntime::default(),
            initiative_result: 10,
            initiative_base_stat: 2,
            last_committed_timeline_order: None,
            solo_recovery_available: false,
        }
    }
}
