use std::{collections::BTreeSet, error::Error, fmt};

use crate::{
    AcceptedCommandLedger, BaseUtilityProfile, CombatCommandEnvelope, CombatCommandPayload,
    CombatCommandSource, CombatCostRequestLine, CombatRng, CombatRngError, CombatState,
    CombatSubmissionAccepted, CombatSubmissionError, CombatSubmissionRequest,
    CombatSubmissionService, EntityTagFacts, LegalUtilityCommand, PreconditionRuleSpec, RngChannel,
    SharedUtilityEvaluator, UtilityEvaluationError, UtilityEvaluationRequest,
    UtilityEvaluationResult, UtilityIntentConstraints, UtilityPersonality, UtilityPreferences,
    UtilityScoredCommand, UtilityStrategy,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnemyAiSubmissionFacts {
    pub known_ability_ids: Vec<String>,
    pub disabled_ability_ids: Vec<String>,
    pub legal_target_ids: Vec<String>,
    pub entity_tags: Vec<EntityTagFacts>,
    pub ability_preconditions: Vec<PreconditionRuleSpec>,
    pub costs: Vec<CombatCostRequestLine>,
    pub parent_reservation_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnemyAiLegalCommand {
    pub command_id: String,
    pub utility: LegalUtilityCommand,
    pub submission: EnemyAiSubmissionFacts,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnemyAiDecisionRequest<'a> {
    pub actor_id: &'a str,
    pub legal_commands: &'a [EnemyAiLegalCommand],
    pub base_profile: &'a BaseUtilityProfile,
    pub personality: &'a UtilityPersonality,
    pub strategy: Option<&'a UtilityStrategy>,
    pub preferences: &'a UtilityPreferences,
    pub intent_constraints: &'a UtilityIntentConstraints,
    pub random_equal_score_tie_break: bool,
}

#[derive(Debug)]
pub struct EnemyAiDecision {
    pub evaluation: UtilityEvaluationResult,
    pub selected: UtilityScoredCommand,
    pub accepted: CombatSubmissionAccepted,
    pub used_random_tie_break: bool,
}

#[derive(Debug)]
pub enum EnemyAiDecisionError {
    InvalidLegalCommands { subject: String },
    NoLegalCommand,
    Utility(UtilityEvaluationError),
    Rng(CombatRngError),
    Submission(CombatSubmissionError),
}

impl fmt::Display for EnemyAiDecisionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("enemy AI decision failed")
    }
}

impl Error for EnemyAiDecisionError {}

pub struct EnemyAiController;

impl EnemyAiController {
    pub fn decide_and_submit(
        state: &mut CombatState,
        accepted_commands: &mut AcceptedCommandLedger,
        request: EnemyAiDecisionRequest<'_>,
    ) -> Result<EnemyAiDecision, EnemyAiDecisionError> {
        validate_legal_commands(&request)?;
        let utility_commands: Vec<_> = request
            .legal_commands
            .iter()
            .map(|candidate| candidate.utility.clone())
            .collect();
        let evaluation = SharedUtilityEvaluator::evaluate(&UtilityEvaluationRequest {
            state,
            actor_id: request.actor_id,
            legal_commands: &utility_commands,
            base_profile: request.base_profile,
            personality: request.personality,
            strategy: request.strategy,
            preferences: request.preferences,
            intent_constraints: request.intent_constraints,
        })
        .map_err(EnemyAiDecisionError::Utility)?;
        let first = evaluation
            .candidates
            .first()
            .ok_or(EnemyAiDecisionError::NoLegalCommand)?;
        let tied_count = evaluation
            .candidates
            .iter()
            .take_while(|candidate| {
                candidate.score.total_score == first.score.total_score
                    && candidate.command.tactical_priority == first.command.tactical_priority
            })
            .count();

        let mut advanced_rng = None;
        let selected_index = if request.random_equal_score_tie_break && tied_count > 1 {
            let mut rng =
                CombatRng::restore(state.rng.clone()).map_err(EnemyAiDecisionError::Rng)?;
            let upper = u32::try_from(tied_count).map_err(|_| {
                EnemyAiDecisionError::InvalidLegalCommands {
                    subject: "tieGroup".to_owned(),
                }
            })?;
            let index = rng
                .draw_bounded(RngChannel::UtilityTieBreak, upper)
                .map_err(EnemyAiDecisionError::Rng)?;
            advanced_rng = Some(rng.snapshot());
            index as usize
        } else {
            0
        };
        let selected = evaluation.candidates[selected_index].clone();
        let legal = request
            .legal_commands
            .iter()
            .find(|candidate| candidate.utility == selected.command)
            .ok_or_else(|| EnemyAiDecisionError::InvalidLegalCommands {
                subject: "selectedCommand".to_owned(),
            })?;

        let accepted = CombatSubmissionService::submit(
            state,
            accepted_commands,
            CombatSubmissionRequest {
                envelope: CombatCommandEnvelope {
                    command_id: legal.command_id.clone(),
                    source: CombatCommandSource::UtilityAi,
                    actor_id: request.actor_id.to_owned(),
                    versions: state.versions,
                    payload: CombatCommandPayload::UseAbility {
                        ability_id: selected.command.ability_id.clone(),
                        target_id: Some(selected.command.target_id.clone()),
                    },
                },
                control_assignments: vec![crate::CombatControlAssignment {
                    combatant_id: request.actor_id.to_owned(),
                    authority: crate::CombatControlAuthority::UtilityAi,
                }],
                stable_input_point: true,
                known_ability_ids: legal.submission.known_ability_ids.clone(),
                disabled_ability_ids: legal.submission.disabled_ability_ids.clone(),
                legal_target_ids: legal.submission.legal_target_ids.clone(),
                entity_tags: legal.submission.entity_tags.clone(),
                ability_preconditions: legal.submission.ability_preconditions.clone(),
                costs: legal.submission.costs.clone(),
                parent_reservation_id: legal.submission.parent_reservation_id.clone(),
            },
        )
        .map_err(EnemyAiDecisionError::Submission)?;
        let used_random_tie_break = advanced_rng.is_some();
        if let Some(snapshot) = advanced_rng {
            state.rng = snapshot;
        }
        Ok(EnemyAiDecision {
            evaluation,
            selected,
            accepted,
            used_random_tie_break,
        })
    }
}

fn validate_legal_commands(
    request: &EnemyAiDecisionRequest<'_>,
) -> Result<(), EnemyAiDecisionError> {
    let mut command_ids = BTreeSet::new();
    for candidate in request.legal_commands {
        if !valid_stable_id(&candidate.command_id)
            || !command_ids.insert(candidate.command_id.as_str())
            || !candidate
                .submission
                .known_ability_ids
                .contains(&candidate.utility.ability_id)
            || candidate
                .submission
                .disabled_ability_ids
                .contains(&candidate.utility.ability_id)
            || !candidate
                .submission
                .legal_target_ids
                .contains(&candidate.utility.target_id)
        {
            return Err(EnemyAiDecisionError::InvalidLegalCommands {
                subject: candidate.command_id.clone(),
            });
        }
    }
    Ok(())
}

fn valid_stable_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b':'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CURRENT_COMBAT_VERSIONS, CombatCostAsset, CombatPhase, CombatSide, CombatantRuntime,
        CombatantState, HardCcDrRuntime, ObjectiveRuntimeState, ProvisionalRuntimeDelta,
        ReinforcementRuntimeState, ResourceState, RoundRuntimeState, ShieldRechargeRuntime,
        TerminalPriorityPolicy, UtilityActionCategory, UtilityCandidateProjection,
        UtilityWeightAdjustments, UtilityWeights,
    };

    const SEED: &str = "11223344556677889900aabbccddeeff";

    #[test]
    fn selects_stable_best_legal_command_and_records_replayable_utility_source() {
        let mut state = state();
        let before_rng = state.rng.clone();
        let mut ledger = AcceptedCommandLedger::new();
        let commands = vec![
            candidate("command-z", "ability.z", 5),
            candidate("command-a", "ability.a", 5),
        ];
        let layers = layers();
        let decision = EnemyAiController::decide_and_submit(
            &mut state,
            &mut ledger,
            request(&commands, &layers, false),
        )
        .unwrap();

        assert_eq!(decision.selected.command.ability_id, "ability.a");
        assert!(!decision.used_random_tie_break);
        assert_eq!(state.rng, before_rng);
        assert_eq!(
            ledger.commands(),
            std::slice::from_ref(&decision.accepted.command.command)
        );
        assert_eq!(decision.accepted.command.command.command_id, "command-a");
        assert_eq!(
            decision.accepted.command.command.source,
            crate::AcceptedCommandSource::UtilityAi
        );
        ledger
            .validate_replay(
                &decision.accepted.command.command,
                &decision.accepted.command.command.replay_envelope(),
            )
            .unwrap();
    }

    #[test]
    fn explicit_random_equal_score_uses_only_utility_tie_break_after_stable_sort() {
        let mut state = state();
        let before = state.rng.clone();
        let mut ledger = AcceptedCommandLedger::new();
        let commands = vec![
            candidate("command-z", "ability.z", 5),
            candidate("command-a", "ability.a", 5),
        ];
        let layers = layers();
        let decision = EnemyAiController::decide_and_submit(
            &mut state,
            &mut ledger,
            request(&commands, &layers, true),
        )
        .unwrap();

        assert!(decision.used_random_tie_break);
        assert_eq!(state.rng.streams[0], before.streams[0]);
        assert_eq!(state.rng.streams[1], before.streams[1]);
        assert_eq!(state.rng.streams[2].cursor, before.streams[2].cursor + 1);
        assert!(matches!(
            decision.selected.command.ability_id.as_str(),
            "ability.a" | "ability.z"
        ));

        let mut reversed_state = self::state();
        let mut reversed_ledger = AcceptedCommandLedger::new();
        let mut reversed_commands = commands.clone();
        reversed_commands.reverse();
        let reversed = EnemyAiController::decide_and_submit(
            &mut reversed_state,
            &mut reversed_ledger,
            request(&reversed_commands, &layers, true),
        )
        .unwrap();
        assert_eq!(reversed.selected, decision.selected);
        assert_eq!(reversed_state.rng, state.rng);
    }

    #[test]
    fn different_scores_never_consume_rng_even_when_profile_allows_random_ties() {
        let mut state = state();
        let before = state.rng.clone();
        let mut ledger = AcceptedCommandLedger::new();
        let commands = vec![
            candidate("command-low", "ability.low", 1),
            candidate("command-high", "ability.high", 8),
        ];
        let layers = layers();
        let decision = EnemyAiController::decide_and_submit(
            &mut state,
            &mut ledger,
            request(&commands, &layers, true),
        )
        .unwrap();
        assert_eq!(decision.selected.command.ability_id, "ability.high");
        assert!(!decision.used_random_tie_break);
        assert_eq!(state.rng, before);
    }

    #[test]
    fn submission_revalidation_failure_is_atomic_including_rng_cursor() {
        let mut state = state();
        state.combatants[0].action_points = 0;
        let before = state.clone();
        let mut ledger = AcceptedCommandLedger::new();
        let mut commands = vec![
            candidate("command-a", "ability.a", 5),
            candidate("command-z", "ability.z", 5),
        ];
        for candidate in &mut commands {
            candidate.submission.costs = vec![CombatCostRequestLine {
                cost_id: "enemy-ap".to_owned(),
                asset: CombatCostAsset::ActionPoints {
                    combatant_id: "enemy".to_owned(),
                },
                amount: 1,
                consume_cost_on_interrupt: false,
            }];
        }
        let layers = layers();
        assert!(matches!(
            EnemyAiController::decide_and_submit(
                &mut state,
                &mut ledger,
                request(&commands, &layers, true),
            ),
            Err(EnemyAiDecisionError::Submission(
                CombatSubmissionError::PreconditionsFailed(_)
            ))
        ));
        assert_eq!(state, before);
        assert!(ledger.commands().is_empty());
    }

    #[test]
    fn filtered_or_empty_candidate_set_fails_without_acceptance() {
        let mut state = state();
        let before = state.clone();
        let mut ledger = AcceptedCommandLedger::new();
        let commands = vec![candidate("command-a", "ability.a", 5)];
        let mut layers = layers();
        layers.4.allowed_categories = vec![UtilityActionCategory::Heal];
        assert!(matches!(
            EnemyAiController::decide_and_submit(
                &mut state,
                &mut ledger,
                request(&commands, &layers, false),
            ),
            Err(EnemyAiDecisionError::NoLegalCommand)
        ));
        assert_eq!(state, before);
        assert!(ledger.commands().is_empty());
    }

    type Layers = (
        BaseUtilityProfile,
        UtilityPersonality,
        UtilityStrategy,
        UtilityPreferences,
        UtilityIntentConstraints,
    );

    fn request<'a>(
        commands: &'a [EnemyAiLegalCommand],
        layers: &'a Layers,
        random: bool,
    ) -> EnemyAiDecisionRequest<'a> {
        EnemyAiDecisionRequest {
            actor_id: "enemy",
            legal_commands: commands,
            base_profile: &layers.0,
            personality: &layers.1,
            strategy: Some(&layers.2),
            preferences: &layers.3,
            intent_constraints: &layers.4,
            random_equal_score_tie_break: random,
        }
    }

    fn candidate(command_id: &str, ability_id: &str, damage: i64) -> EnemyAiLegalCommand {
        EnemyAiLegalCommand {
            command_id: command_id.to_owned(),
            utility: LegalUtilityCommand {
                ability_id: ability_id.to_owned(),
                target_id: "hero".to_owned(),
                category: UtilityActionCategory::Damage,
                tags: vec![],
                tactical_priority: 0,
                projection: UtilityCandidateProjection {
                    damage_amount: damage,
                    healing_amount: 0,
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
                legal_target_ids: vec!["hero".to_owned()],
                entity_tags: vec![],
                ability_preconditions: vec![],
                costs: vec![],
                parent_reservation_id: None,
            },
        }
    }

    fn layers() -> Layers {
        (
            BaseUtilityProfile {
                profile_id: "profile.enemy".to_owned(),
                weights: UtilityWeights {
                    damage: 100,
                    kill: 0,
                    control: 0,
                    heal: 0,
                    defense: 0,
                    resource: 0,
                    risk: 0,
                    intent: 0,
                },
            },
            UtilityPersonality {
                personality_id: "personality.enemy".to_owned(),
                adjustments: UtilityWeightAdjustments::default(),
            },
            UtilityStrategy {
                strategy_id: "strategy.none".to_owned(),
                adjustments: UtilityWeightAdjustments::default(),
            },
            UtilityPreferences {
                preferred_tags: vec![],
                avoided_tags: vec![],
                preferred_tag_bonus: 0,
                avoided_tag_penalty: 0,
            },
            UtilityIntentConstraints {
                allowed_categories: vec![],
                preferred_category: None,
                preferred_category_bonus: 0,
                non_preferred_category_penalty: 0,
            },
        )
    }

    fn state() -> CombatState {
        let rng = CombatRng::new(
            SEED,
            "combat-enemy-ai",
            CURRENT_COMBAT_VERSIONS.rng_contract_version,
        )
        .unwrap()
        .snapshot();
        CombatState {
            combat_instance_id: "combat-enemy-ai".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.to_owned(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::Stable,
            combatants: vec![
                combatant("enemy", CombatSide::Hostile, 10),
                combatant("hero", CombatSide::Player, 10),
            ],
            formal_party_member_ids: vec!["hero".to_owned()],
            combat_inventory: vec![],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![],
            round: RoundRuntimeState {
                round_number: 1,
                completed_round_count: 0,
                active_combatant_id: Some("enemy".to_owned()),
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
            rng,
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
