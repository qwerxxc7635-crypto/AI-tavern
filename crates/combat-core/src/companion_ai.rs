use std::{error::Error, fmt};

use crate::{
    AcceptedCommandLedger, BaseUtilityProfile, CombatSide, CombatState, EnemyAiController,
    EnemyAiDecision, EnemyAiDecisionError, EnemyAiDecisionRequest, EnemyAiLegalCommand,
    UtilityIntentConstraints, UtilityPersonality, UtilityPreferences, UtilityStrategy,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompanionAiActorKind {
    FormalCompanion,
    ExistingSummon,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompanionAiDecisionRequest<'a> {
    pub actor_id: &'a str,
    pub actor_kind: CompanionAiActorKind,
    pub legal_commands: &'a [EnemyAiLegalCommand],
    pub base_profile: &'a BaseUtilityProfile,
    pub personality: &'a UtilityPersonality,
    pub strategy: Option<&'a UtilityStrategy>,
    pub preferences: &'a UtilityPreferences,
    pub intent_constraints: &'a UtilityIntentConstraints,
    pub random_equal_score_tie_break: bool,
}

#[derive(Debug)]
pub enum CompanionAiDecisionError {
    InvalidActorContract { actor_id: String },
    UtilityDecision(EnemyAiDecisionError),
}

impl fmt::Display for CompanionAiDecisionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("companion AI decision failed")
    }
}

impl Error for CompanionAiDecisionError {}

pub struct CompanionAiController;

impl CompanionAiController {
    pub fn decide_and_submit(
        state: &mut CombatState,
        accepted_commands: &mut AcceptedCommandLedger,
        request: CompanionAiDecisionRequest<'_>,
    ) -> Result<EnemyAiDecision, CompanionAiDecisionError> {
        let Some(actor) = state
            .combatants
            .iter()
            .find(|combatant| combatant.combatant_id == request.actor_id)
        else {
            return Err(invalid_actor(request.actor_id));
        };
        let is_formal = state
            .formal_party_member_ids
            .iter()
            .any(|member_id| member_id == request.actor_id);
        let valid_contract = match request.actor_kind {
            CompanionAiActorKind::FormalCompanion => {
                actor.side == CombatSide::Companion && is_formal && request.strategy.is_some()
            }
            CompanionAiActorKind::ExistingSummon => {
                actor.side == CombatSide::Companion && !is_formal && request.strategy.is_none()
            }
        };
        if !valid_contract {
            return Err(invalid_actor(request.actor_id));
        }

        EnemyAiController::decide_utility_and_submit(
            state,
            accepted_commands,
            EnemyAiDecisionRequest {
                actor_id: request.actor_id,
                legal_commands: request.legal_commands,
                base_profile: request.base_profile,
                personality: request.personality,
                strategy: request.strategy,
                preferences: request.preferences,
                intent_constraints: request.intent_constraints,
                random_equal_score_tie_break: request.random_equal_score_tie_break,
            },
        )
        .map_err(CompanionAiDecisionError::UtilityDecision)
    }
}

fn invalid_actor(actor_id: &str) -> CompanionAiDecisionError {
    CompanionAiDecisionError::InvalidActorContract {
        actor_id: actor_id.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CURRENT_COMBAT_VERSIONS, CombatPhase, CombatRng, CombatSide, CombatantRuntime,
        CombatantState, EnemyAiSubmissionFacts, HardCcDrRuntime, LegalUtilityCommand,
        ObjectiveRuntimeState, ProvisionalRuntimeDelta, ReinforcementRuntimeState, ResourceState,
        RoundRuntimeState, ShieldRechargeRuntime, TerminalPriorityPolicy, UtilityActionCategory,
        UtilityCandidateProjection, UtilityWeightAdjustments, UtilityWeights,
    };
    use std::sync::LazyLock;

    const SEED: &str = "22334455667788990011aabbccddeeff";

    #[test]
    fn personality_layers_produce_distinct_formal_companion_actions() {
        let commands = commands();
        let mut aggressive_state = state(true);
        let mut aggressive_ledger = AcceptedCommandLedger::new();
        let aggressive = CompanionAiController::decide_and_submit(
            &mut aggressive_state,
            &mut aggressive_ledger,
            request(&commands, &personality(200, 0), Some(&strategy(0, 0))),
        )
        .unwrap();

        let mut healer_state = state(true);
        let mut healer_ledger = AcceptedCommandLedger::new();
        let healer = CompanionAiController::decide_and_submit(
            &mut healer_state,
            &mut healer_ledger,
            request(&commands, &personality(0, 200), Some(&strategy(0, 0))),
        )
        .unwrap();
        assert_eq!(aggressive.selected.command.ability_id, "ability.attack");
        assert_eq!(healer.selected.command.ability_id, "ability.heal");
    }

    #[test]
    fn player_tactical_strategy_changes_future_formal_companion_scoring() {
        let commands = commands();
        let neutral_personality = personality(0, 0);
        let aggressive_strategy = strategy(200, 0);
        let support_strategy = strategy(0, 200);

        let mut attack_state = state(true);
        let mut attack_ledger = AcceptedCommandLedger::new();
        let attack = CompanionAiController::decide_and_submit(
            &mut attack_state,
            &mut attack_ledger,
            request(&commands, &neutral_personality, Some(&aggressive_strategy)),
        )
        .unwrap();
        let mut support_state = state(true);
        let mut support_ledger = AcceptedCommandLedger::new();
        let support = CompanionAiController::decide_and_submit(
            &mut support_state,
            &mut support_ledger,
            request(&commands, &neutral_personality, Some(&support_strategy)),
        )
        .unwrap();

        assert_eq!(attack.selected.command.ability_id, "ability.attack");
        assert_eq!(support.selected.command.ability_id, "ability.heal");
        assert_eq!(
            attack_ledger.commands()[0].source,
            crate::AcceptedCommandSource::UtilityAi
        );
        assert_eq!(
            support_ledger.commands()[0].source,
            crate::AcceptedCommandSource::UtilityAi
        );
    }

    #[test]
    fn formal_companion_requires_strategy_and_existing_summon_excludes_player_strategy() {
        let commands = commands();
        let personality = personality(0, 0);
        let mut formal_state = state(true);
        let formal_before = formal_state.clone();
        let mut formal_ledger = AcceptedCommandLedger::new();
        assert!(matches!(
            CompanionAiController::decide_and_submit(
                &mut formal_state,
                &mut formal_ledger,
                request_for_kind(
                    &commands,
                    &personality,
                    None,
                    CompanionAiActorKind::FormalCompanion,
                ),
            ),
            Err(CompanionAiDecisionError::InvalidActorContract { .. })
        ));
        assert_eq!(formal_state, formal_before);
        assert!(formal_ledger.commands().is_empty());

        let mut summon_state = state(false);
        let mut summon_ledger = AcceptedCommandLedger::new();
        let summon = CompanionAiController::decide_and_submit(
            &mut summon_state,
            &mut summon_ledger,
            request_for_kind(
                &commands,
                &personality,
                None,
                CompanionAiActorKind::ExistingSummon,
            ),
        )
        .unwrap();
        assert_eq!(summon_ledger.commands()[0], summon.accepted.command.command);

        let mut invalid_summon_state = state(false);
        let before = invalid_summon_state.clone();
        let mut invalid_summon_ledger = AcceptedCommandLedger::new();
        let tactical_strategy = strategy(100, 0);
        assert!(matches!(
            CompanionAiController::decide_and_submit(
                &mut invalid_summon_state,
                &mut invalid_summon_ledger,
                request_for_kind(
                    &commands,
                    &personality,
                    Some(&tactical_strategy),
                    CompanionAiActorKind::ExistingSummon,
                ),
            ),
            Err(CompanionAiDecisionError::InvalidActorContract { .. })
        ));
        assert_eq!(invalid_summon_state, before);
        assert!(invalid_summon_ledger.commands().is_empty());
    }

    #[test]
    fn player_or_hostile_actor_cannot_enter_companion_ai_route() {
        let commands = commands();
        let personality = personality(0, 0);
        let tactical_strategy = strategy(0, 0);
        for actor_id in ["hero", "enemy"] {
            let mut state = state(true);
            let before = state.clone();
            let mut ledger = AcceptedCommandLedger::new();
            let mut request = request(&commands, &personality, Some(&tactical_strategy));
            request.actor_id = actor_id;
            assert!(matches!(
                CompanionAiController::decide_and_submit(&mut state, &mut ledger, request),
                Err(CompanionAiDecisionError::InvalidActorContract { .. })
            ));
            assert_eq!(state, before);
            assert!(ledger.commands().is_empty());
        }
    }

    fn request<'a>(
        commands: &'a [EnemyAiLegalCommand],
        personality: &'a UtilityPersonality,
        strategy: Option<&'a UtilityStrategy>,
    ) -> CompanionAiDecisionRequest<'a> {
        request_for_kind(
            commands,
            personality,
            strategy,
            CompanionAiActorKind::FormalCompanion,
        )
    }

    fn request_for_kind<'a>(
        commands: &'a [EnemyAiLegalCommand],
        personality: &'a UtilityPersonality,
        strategy: Option<&'a UtilityStrategy>,
        actor_kind: CompanionAiActorKind,
    ) -> CompanionAiDecisionRequest<'a> {
        CompanionAiDecisionRequest {
            actor_id: "companion",
            actor_kind,
            legal_commands: commands,
            base_profile: &BASE_PROFILE,
            personality,
            strategy,
            preferences: &NO_PREFERENCES,
            intent_constraints: &NO_INTENT,
            random_equal_score_tie_break: false,
        }
    }

    static BASE_PROFILE: LazyLock<BaseUtilityProfile> = LazyLock::new(|| BaseUtilityProfile {
        profile_id: "profile.companion".to_owned(),
        weights: UtilityWeights {
            damage: 100,
            kill: 0,
            control: 0,
            heal: 100,
            defense: 0,
            resource: 0,
            risk: 0,
            intent: 0,
        },
    });
    static NO_PREFERENCES: LazyLock<UtilityPreferences> = LazyLock::new(|| UtilityPreferences {
        preferred_tags: vec![],
        avoided_tags: vec![],
        preferred_tag_bonus: 0,
        avoided_tag_penalty: 0,
    });
    static NO_INTENT: LazyLock<UtilityIntentConstraints> =
        LazyLock::new(|| UtilityIntentConstraints {
            allowed_categories: vec![],
            preferred_category: None,
            preferred_category_bonus: 0,
            non_preferred_category_penalty: 0,
        });

    fn personality(damage: i64, heal: i64) -> UtilityPersonality {
        UtilityPersonality {
            personality_id: "personality.fixture".to_owned(),
            adjustments: UtilityWeightAdjustments {
                damage,
                heal,
                ..UtilityWeightAdjustments::default()
            },
        }
    }

    fn strategy(damage: i64, heal: i64) -> UtilityStrategy {
        UtilityStrategy {
            strategy_id: "strategy.fixture".to_owned(),
            adjustments: UtilityWeightAdjustments {
                damage,
                heal,
                ..UtilityWeightAdjustments::default()
            },
        }
    }

    fn commands() -> Vec<EnemyAiLegalCommand> {
        vec![
            command(
                "command-attack",
                "ability.attack",
                "enemy",
                UtilityActionCategory::Damage,
                8,
                0,
            ),
            command(
                "command-heal",
                "ability.heal",
                "companion",
                UtilityActionCategory::Heal,
                0,
                6,
            ),
        ]
    }

    fn command(
        command_id: &str,
        ability_id: &str,
        target_id: &str,
        category: UtilityActionCategory,
        damage_amount: i64,
        healing_amount: i64,
    ) -> EnemyAiLegalCommand {
        EnemyAiLegalCommand {
            command_id: command_id.to_owned(),
            utility: LegalUtilityCommand {
                ability_id: ability_id.to_owned(),
                target_id: target_id.to_owned(),
                category,
                tags: vec![],
                tactical_priority: 0,
                projection: UtilityCandidateProjection {
                    damage_amount,
                    healing_amount,
                    defense_amount: 0,
                    resource_amount: 0,
                    control_basis_points: 0,
                    risk_basis_points: 0,
                    base_intent_score: 0,
                },
            },
            submission: EnemyAiSubmissionFacts {
                known_ability_ids: vec![ability_id.to_owned()],
                disabled_ability_ids: vec![],
                legal_target_ids: vec![target_id.to_owned()],
                entity_tags: vec![],
                ability_preconditions: vec![],
                costs: vec![],
                parent_reservation_id: None,
            },
        }
    }

    fn state(formal: bool) -> CombatState {
        CombatState {
            combat_instance_id: "combat-companion-ai".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.to_owned(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::Stable,
            combatants: vec![
                combatant("companion", CombatSide::Companion, 4),
                combatant("enemy", CombatSide::Hostile, 10),
                combatant("hero", CombatSide::Player, 10),
            ],
            formal_party_member_ids: if formal {
                vec!["companion".to_owned(), "hero".to_owned()]
            } else {
                vec!["hero".to_owned()]
            },
            combat_inventory: vec![],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![],
            round: RoundRuntimeState {
                round_number: 1,
                completed_round_count: 0,
                active_combatant_id: Some("companion".to_owned()),
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
            enemy_intents: vec![],
            result_candidates: vec![],
            terminal_priority_policy: TerminalPriorityPolicy::default(),
            confirmed_result_candidate_id: None,
            confirmed_result: None,
            rng: CombatRng::new(
                SEED,
                "combat-companion-ai",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }

    fn combatant(id: &str, side: CombatSide, hit_points: i64) -> CombatantRuntime {
        CombatantRuntime {
            combatant_id: id.to_owned(),
            definition_id: format!("definition-{id}"),
            side,
            state: CombatantState::Active,
            hit_points,
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
