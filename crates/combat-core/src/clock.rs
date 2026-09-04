use std::{error::Error, fmt};

use crate::{
    DurationClock, StatusActivationPolicy, StatusDefinition, StatusExpiryPhase, StatusRuntime,
    StatusSchemaValidator, StatusTickPhase,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClockLifecycleWindow {
    pub clock: DurationClock,
    pub clock_index: u64,
    pub tick_phase_passed: bool,
    pub expiry_phase_passed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StatusApplicationClockContext {
    pub round_index: u64,
    pub owner_turn_index: u64,
    pub current_window: Option<ClockLifecycleWindow>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StatusClockAssignment {
    pub applied_round_index: u64,
    pub applied_owner_turn_index: u64,
    pub activation_clock_index: u64,
    pub tick_eligible_clock_index: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StatusClockObservation {
    pub round_index: u64,
    pub owner_turn_index: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StatusDurationAdvancePoint {
    OwnerTurnEnd {
        owner_turn_index: u64,
    },
    RoundEnd {
        round_index: u64,
    },
    ExplicitRuleHook {
        hook_id: String,
        round_index: u64,
        owner_turn_index: u64,
    },
    ExtraTurn,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusTickDecision {
    Eligible,
    NotScheduledForPhase,
    NotYetActive,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StatusDurationTransition {
    Unchanged,
    Advanced { instance: StatusRuntime },
    Expired { status_instance_id: String },
}

pub struct StatusClockPolicy;

impl StatusClockPolicy {
    pub fn validate_definition(definition: &StatusDefinition) -> Result<(), StatusClockError> {
        let valid_expiry = match definition.duration.clock {
            DurationClock::OwnerTurn => matches!(
                definition.duration.expiry_phase,
                StatusExpiryPhase::OwnerTurnEnd | StatusExpiryPhase::ExplicitRuleHook { .. }
            ),
            DurationClock::Round => matches!(
                definition.duration.expiry_phase,
                StatusExpiryPhase::RoundEnd | StatusExpiryPhase::ExplicitRuleHook { .. }
            ),
            DurationClock::Permanent => true,
        };
        if !valid_expiry
            || definition.duration.clock == DurationClock::Permanent
                && definition.duration.activation_policy == StatusActivationPolicy::CurrentClock
        {
            return Err(clock_error(
                StatusClockErrorCode::IllegalClockPolicy,
                &definition.status_definition_id,
            ));
        }
        Ok(())
    }
}

pub struct StatusClockEngine;

impl StatusClockEngine {
    pub fn assign_application(
        definition: &StatusDefinition,
        context: StatusApplicationClockContext,
    ) -> Result<StatusClockAssignment, StatusClockError> {
        StatusClockPolicy::validate_definition(definition)?;
        let (activation_clock_index, tick_eligible_clock_index) = match definition
            .duration
            .activation_policy
        {
            StatusActivationPolicy::NextClock => {
                let activation = match definition.duration.clock {
                    DurationClock::OwnerTurn => context.owner_turn_index.checked_add(1),
                    DurationClock::Round => context.round_index.checked_add(1),
                    DurationClock::Permanent => Some(0),
                }
                .ok_or_else(|| {
                    clock_error(
                        StatusClockErrorCode::NumericOverflow,
                        "activationClockIndex",
                    )
                })?;
                (activation, activation)
            }
            StatusActivationPolicy::CurrentClock => {
                let window = context.current_window.ok_or_else(|| {
                    clock_error(
                        StatusClockErrorCode::CurrentClockContextRequired,
                        &definition.status_definition_id,
                    )
                })?;
                let expected_index = match definition.duration.clock {
                    DurationClock::OwnerTurn => context.owner_turn_index,
                    DurationClock::Round => context.round_index,
                    DurationClock::Permanent => unreachable!("policy rejects current permanent"),
                };
                if window.clock != definition.duration.clock
                    || window.clock_index != expected_index
                    || window.expiry_phase_passed
                {
                    return Err(clock_error(
                        StatusClockErrorCode::InvalidCurrentClockContext,
                        &definition.status_definition_id,
                    ));
                }
                let tick_eligible =
                    if window.tick_phase_passed && definition.tick_phase != StatusTickPhase::None {
                        window.clock_index.checked_add(1).ok_or_else(|| {
                            clock_error(
                                StatusClockErrorCode::NumericOverflow,
                                "tickEligibleClockIndex",
                            )
                        })?
                    } else {
                        window.clock_index
                    };
                (window.clock_index, tick_eligible)
            }
        };

        Ok(StatusClockAssignment {
            applied_round_index: context.round_index,
            applied_owner_turn_index: context.owner_turn_index,
            activation_clock_index,
            tick_eligible_clock_index,
        })
    }

    pub fn apply_assignment(instance: &mut StatusRuntime, assignment: StatusClockAssignment) {
        instance.applied_round_index = assignment.applied_round_index;
        instance.applied_owner_turn_index = Some(assignment.applied_owner_turn_index);
        instance.activation_clock_index = assignment.activation_clock_index;
        instance.tick_eligible_clock_index = assignment.tick_eligible_clock_index;
        instance.last_duration_advanced_clock_index = None;
    }

    pub fn tick_decision(
        instance: &StatusRuntime,
        definition: &StatusDefinition,
        phase: StatusTickPhase,
        observation: StatusClockObservation,
    ) -> Result<StatusTickDecision, StatusClockError> {
        validate_pair(instance, definition)?;
        if phase == StatusTickPhase::None || definition.tick_phase != phase {
            return Ok(StatusTickDecision::NotScheduledForPhase);
        }
        let clock_index = observed_clock_index(instance.duration_clock, observation);
        if clock_index < instance.activation_clock_index
            || clock_index < instance.tick_eligible_clock_index
        {
            return Ok(StatusTickDecision::NotYetActive);
        }
        Ok(StatusTickDecision::Eligible)
    }

    pub fn advance_duration(
        instance: &StatusRuntime,
        definition: &StatusDefinition,
        point: &StatusDurationAdvancePoint,
    ) -> Result<StatusDurationTransition, StatusClockError> {
        validate_pair(instance, definition)?;
        let Some(clock_index) = matching_advance_clock_index(definition, point) else {
            return Ok(StatusDurationTransition::Unchanged);
        };
        if instance.duration_clock == DurationClock::Permanent
            || clock_index < instance.activation_clock_index
            || instance
                .last_duration_advanced_clock_index
                .is_some_and(|last| last >= clock_index)
        {
            return Ok(StatusDurationTransition::Unchanged);
        }
        let remaining = instance.remaining_duration.ok_or_else(|| {
            clock_error(
                StatusClockErrorCode::InvalidRuntimeInstance,
                &instance.status_instance_id,
            )
        })?;
        let next = remaining.checked_sub(1).ok_or_else(|| {
            clock_error(StatusClockErrorCode::NumericOverflow, "remainingDuration")
        })?;
        if next == 0 {
            return Ok(StatusDurationTransition::Expired {
                status_instance_id: instance.status_instance_id.clone(),
            });
        }
        let mut advanced = instance.clone();
        advanced.remaining_duration = Some(next);
        advanced.last_duration_advanced_clock_index = Some(clock_index);
        Ok(StatusDurationTransition::Advanced { instance: advanced })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusClockErrorCode {
    IllegalClockPolicy,
    CurrentClockContextRequired,
    InvalidCurrentClockContext,
    InvalidRuntimeInstance,
    DefinitionRuntimeMismatch,
    NumericOverflow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusClockError {
    pub code: StatusClockErrorCode,
    pub subject: String,
}

impl fmt::Display for StatusClockError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "status clock failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for StatusClockError {}

fn validate_pair(
    instance: &StatusRuntime,
    definition: &StatusDefinition,
) -> Result<(), StatusClockError> {
    StatusClockPolicy::validate_definition(definition)?;
    StatusSchemaValidator::validate_runtime(instance).map_err(|error| {
        clock_error(
            StatusClockErrorCode::InvalidRuntimeInstance,
            format!("{}:{:?}", error.subject, error.code),
        )
    })?;
    if instance.status_definition_id != definition.status_definition_id
        || instance.stack_group_id != definition.stack_group_id
        || instance.duration_clock != definition.duration.clock
    {
        return Err(clock_error(
            StatusClockErrorCode::DefinitionRuntimeMismatch,
            &instance.status_instance_id,
        ));
    }
    Ok(())
}

fn observed_clock_index(clock: DurationClock, observation: StatusClockObservation) -> u64 {
    match clock {
        DurationClock::OwnerTurn => observation.owner_turn_index,
        DurationClock::Round => observation.round_index,
        DurationClock::Permanent => 0,
    }
}

fn matching_advance_clock_index(
    definition: &StatusDefinition,
    point: &StatusDurationAdvancePoint,
) -> Option<u64> {
    match (&definition.duration.expiry_phase, point) {
        (
            StatusExpiryPhase::OwnerTurnEnd,
            StatusDurationAdvancePoint::OwnerTurnEnd { owner_turn_index },
        ) if definition.duration.clock == DurationClock::OwnerTurn => Some(*owner_turn_index),
        (StatusExpiryPhase::RoundEnd, StatusDurationAdvancePoint::RoundEnd { round_index })
            if definition.duration.clock == DurationClock::Round =>
        {
            Some(*round_index)
        }
        (
            StatusExpiryPhase::ExplicitRuleHook { hook_id: expected },
            StatusDurationAdvancePoint::ExplicitRuleHook {
                hook_id,
                round_index,
                owner_turn_index,
            },
        ) if expected == hook_id => Some(match definition.duration.clock {
            DurationClock::OwnerTurn => *owner_turn_index,
            DurationClock::Round => *round_index,
            DurationClock::Permanent => 0,
        }),
        _ => None,
    }
}

fn clock_error(code: StatusClockErrorCode, subject: impl Into<String>) -> StatusClockError {
    StatusClockError {
        code,
        subject: subject.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CURRENT_STATUS_SCHEMA_VERSION, StatusDurationDefinition, StatusRefreshPolicy,
        StatusStackMode,
    };

    #[test]
    fn next_owner_clock_is_immediate_for_rules_but_ticks_and_expires_on_next_full_turn() {
        let definition = definition(
            "stun",
            DurationClock::OwnerTurn,
            StatusActivationPolicy::NextClock,
            StatusTickPhase::OwnerTurnStart,
            StatusExpiryPhase::OwnerTurnEnd,
            1,
        );
        let assignment = StatusClockEngine::assign_application(
            &definition,
            StatusApplicationClockContext {
                round_index: 7,
                owner_turn_index: 3,
                current_window: None,
            },
        )
        .unwrap();
        assert_eq!(assignment.activation_clock_index, 4);
        assert_eq!(assignment.tick_eligible_clock_index, 4);

        let mut status = runtime(&definition, 1);
        StatusClockEngine::apply_assignment(&mut status, assignment);
        assert_eq!(
            tick(&status, &definition, StatusTickPhase::OwnerTurnStart, 7, 3),
            StatusTickDecision::NotYetActive
        );
        assert_eq!(
            tick(&status, &definition, StatusTickPhase::OwnerTurnStart, 8, 4),
            StatusTickDecision::Eligible
        );
        assert_eq!(
            StatusClockEngine::advance_duration(
                &status,
                &definition,
                &StatusDurationAdvancePoint::OwnerTurnEnd {
                    owner_turn_index: 4
                }
            )
            .unwrap(),
            StatusDurationTransition::Expired {
                status_instance_id: "instance".to_owned()
            }
        );
    }

    #[test]
    fn round_clock_ticks_exactly_twice_before_expiring_after_second_tick() {
        let definition = definition(
            "burning",
            DurationClock::Round,
            StatusActivationPolicy::NextClock,
            StatusTickPhase::RoundEnd,
            StatusExpiryPhase::RoundEnd,
            2,
        );
        let assignment = StatusClockEngine::assign_application(
            &definition,
            StatusApplicationClockContext {
                round_index: 2,
                owner_turn_index: 1,
                current_window: None,
            },
        )
        .unwrap();
        let mut status = runtime(&definition, 2);
        StatusClockEngine::apply_assignment(&mut status, assignment);

        assert_eq!(
            tick(&status, &definition, StatusTickPhase::RoundStart, 3, 1),
            StatusTickDecision::NotScheduledForPhase
        );
        assert_eq!(
            tick(&status, &definition, StatusTickPhase::RoundEnd, 3, 1),
            StatusTickDecision::Eligible
        );
        let StatusDurationTransition::Advanced { instance } = StatusClockEngine::advance_duration(
            &status,
            &definition,
            &StatusDurationAdvancePoint::RoundEnd { round_index: 3 },
        )
        .unwrap() else {
            panic!("first round must advance without expiring");
        };
        assert_eq!(instance.remaining_duration, Some(1));
        assert_eq!(instance.last_duration_advanced_clock_index, Some(3));
        assert_eq!(
            StatusClockEngine::advance_duration(
                &instance,
                &definition,
                &StatusDurationAdvancePoint::RoundEnd { round_index: 3 }
            )
            .unwrap(),
            StatusDurationTransition::Unchanged
        );
        assert_eq!(
            tick(&instance, &definition, StatusTickPhase::RoundEnd, 4, 1),
            StatusTickDecision::Eligible
        );
        assert!(matches!(
            StatusClockEngine::advance_duration(
                &instance,
                &definition,
                &StatusDurationAdvancePoint::RoundEnd { round_index: 4 }
            )
            .unwrap(),
            StatusDurationTransition::Expired { .. }
        ));
    }

    #[test]
    fn current_clock_requires_a_matching_unexpired_window_and_never_backfills_ticks() {
        let definition = definition(
            "rule-status",
            DurationClock::OwnerTurn,
            StatusActivationPolicy::CurrentClock,
            StatusTickPhase::OwnerTurnStart,
            StatusExpiryPhase::OwnerTurnEnd,
            1,
        );
        let context = |tick_phase_passed, expiry_phase_passed| StatusApplicationClockContext {
            round_index: 5,
            owner_turn_index: 2,
            current_window: Some(ClockLifecycleWindow {
                clock: DurationClock::OwnerTurn,
                clock_index: 2,
                tick_phase_passed,
                expiry_phase_passed,
            }),
        };
        let before_tick =
            StatusClockEngine::assign_application(&definition, context(false, false)).unwrap();
        assert_eq!(before_tick.activation_clock_index, 2);
        assert_eq!(before_tick.tick_eligible_clock_index, 2);

        let after_tick =
            StatusClockEngine::assign_application(&definition, context(true, false)).unwrap();
        assert_eq!(after_tick.activation_clock_index, 2);
        assert_eq!(after_tick.tick_eligible_clock_index, 3);
        let mut status = runtime(&definition, 1);
        StatusClockEngine::apply_assignment(&mut status, after_tick);
        let restored: StatusRuntime =
            serde_json::from_str(&serde_json::to_string(&status).unwrap()).unwrap();
        assert_eq!(
            tick(
                &restored,
                &definition,
                StatusTickPhase::OwnerTurnStart,
                5,
                2
            ),
            StatusTickDecision::NotYetActive
        );
        assert!(matches!(
            StatusClockEngine::advance_duration(
                &restored,
                &definition,
                &StatusDurationAdvancePoint::OwnerTurnEnd {
                    owner_turn_index: 2
                }
            )
            .unwrap(),
            StatusDurationTransition::Expired { .. }
        ));

        assert_eq!(
            StatusClockEngine::assign_application(&definition, context(false, true))
                .unwrap_err()
                .code,
            StatusClockErrorCode::InvalidCurrentClockContext
        );
        assert_eq!(
            StatusClockEngine::assign_application(
                &definition,
                StatusApplicationClockContext {
                    round_index: 5,
                    owner_turn_index: 2,
                    current_window: None,
                }
            )
            .unwrap_err()
            .code,
            StatusClockErrorCode::CurrentClockContextRequired
        );
    }

    #[test]
    fn permanent_status_never_advances_and_current_permanent_is_illegal() {
        let permanent = definition(
            "aura",
            DurationClock::Permanent,
            StatusActivationPolicy::NextClock,
            StatusTickPhase::None,
            StatusExpiryPhase::RoundEnd,
            0,
        );
        let assignment = StatusClockEngine::assign_application(
            &permanent,
            StatusApplicationClockContext {
                round_index: 1,
                owner_turn_index: 0,
                current_window: None,
            },
        )
        .unwrap();
        assert_eq!(assignment.activation_clock_index, 0);
        let mut status = runtime(&permanent, 0);
        StatusClockEngine::apply_assignment(&mut status, assignment);
        assert_eq!(
            StatusClockEngine::advance_duration(
                &status,
                &permanent,
                &StatusDurationAdvancePoint::RoundEnd { round_index: 99 }
            )
            .unwrap(),
            StatusDurationTransition::Unchanged
        );

        let mut illegal = permanent;
        illegal.duration.activation_policy = StatusActivationPolicy::CurrentClock;
        assert_eq!(
            StatusClockPolicy::validate_definition(&illegal)
                .unwrap_err()
                .code,
            StatusClockErrorCode::IllegalClockPolicy
        );
    }

    #[test]
    fn wrong_expiry_phase_and_extra_turn_do_not_advance_duration() {
        let definition = definition(
            "ward",
            DurationClock::OwnerTurn,
            StatusActivationPolicy::NextClock,
            StatusTickPhase::OwnerTurnEnd,
            StatusExpiryPhase::OwnerTurnEnd,
            2,
        );
        let mut status = runtime(&definition, 2);
        status.activation_clock_index = 1;
        status.tick_eligible_clock_index = 1;
        assert_eq!(
            StatusClockEngine::advance_duration(
                &status,
                &definition,
                &StatusDurationAdvancePoint::RoundEnd { round_index: 1 }
            )
            .unwrap(),
            StatusDurationTransition::Unchanged
        );
        assert_eq!(
            StatusClockEngine::advance_duration(
                &status,
                &definition,
                &StatusDurationAdvancePoint::ExtraTurn
            )
            .unwrap(),
            StatusDurationTransition::Unchanged
        );
    }

    #[test]
    fn explicit_expiry_hook_is_exact_and_advances_at_most_once_per_clock() {
        let definition = definition(
            "scripted",
            DurationClock::Round,
            StatusActivationPolicy::NextClock,
            StatusTickPhase::None,
            StatusExpiryPhase::ExplicitRuleHook {
                hook_id: "hook-expire".to_owned(),
            },
            3,
        );
        let mut status = runtime(&definition, 3);
        status.activation_clock_index = 2;
        status.tick_eligible_clock_index = 2;
        let wrong = StatusDurationAdvancePoint::ExplicitRuleHook {
            hook_id: "wrong".to_owned(),
            round_index: 2,
            owner_turn_index: 1,
        };
        assert_eq!(
            StatusClockEngine::advance_duration(&status, &definition, &wrong).unwrap(),
            StatusDurationTransition::Unchanged
        );
        let exact = StatusDurationAdvancePoint::ExplicitRuleHook {
            hook_id: "hook-expire".to_owned(),
            round_index: 2,
            owner_turn_index: 1,
        };
        let StatusDurationTransition::Advanced { instance } =
            StatusClockEngine::advance_duration(&status, &definition, &exact).unwrap()
        else {
            panic!("exact hook must advance");
        };
        assert_eq!(instance.remaining_duration, Some(2));
        assert_eq!(
            StatusClockEngine::advance_duration(&instance, &definition, &exact).unwrap(),
            StatusDurationTransition::Unchanged
        );
    }

    fn tick(
        status: &StatusRuntime,
        definition: &StatusDefinition,
        phase: StatusTickPhase,
        round_index: u64,
        owner_turn_index: u64,
    ) -> StatusTickDecision {
        StatusClockEngine::tick_decision(
            status,
            definition,
            phase,
            StatusClockObservation {
                round_index,
                owner_turn_index,
            },
        )
        .unwrap()
    }

    fn definition(
        id: &str,
        clock: DurationClock,
        activation_policy: StatusActivationPolicy,
        tick_phase: StatusTickPhase,
        expiry_phase: StatusExpiryPhase,
        duration: i64,
    ) -> StatusDefinition {
        StatusDefinition {
            status_schema_version: CURRENT_STATUS_SCHEMA_VERSION,
            status_definition_id: id.to_owned(),
            tags: Vec::new(),
            stack_group_id: id.to_owned(),
            stack_mode: StatusStackMode::Add,
            max_stacks: 1,
            duration: StatusDurationDefinition {
                clock,
                duration: (clock != DurationClock::Permanent).then_some(duration),
                activation_policy,
                expiry_phase,
            },
            refresh_policy: StatusRefreshPolicy::KeepExisting,
            priority: 0,
            tick_phase,
            dispel_tags: Vec::new(),
            immunity_tags: Vec::new(),
            effects: Vec::new(),
            triggers: Vec::new(),
            strength_rank: None,
        }
    }

    fn runtime(definition: &StatusDefinition, duration: i64) -> StatusRuntime {
        StatusRuntime {
            status_schema_version: CURRENT_STATUS_SCHEMA_VERSION,
            status_instance_id: "instance".to_owned(),
            status_definition_id: definition.status_definition_id.clone(),
            source_combatant_id: Some("source".to_owned()),
            stack_group_id: definition.stack_group_id.clone(),
            stack_count: 1,
            remaining_duration: (definition.duration.clock != DurationClock::Permanent)
                .then_some(duration),
            duration_clock: definition.duration.clock,
            application_sequence: 1,
            activation_clock_index: 0,
            applied_round_index: 0,
            applied_owner_turn_index: Some(0),
            tick_eligible_clock_index: 0,
            last_duration_advanced_clock_index: None,
            strength_rank: None,
        }
    }
}
