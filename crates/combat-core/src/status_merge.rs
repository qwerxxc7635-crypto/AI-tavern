use std::{error::Error, fmt};

use crate::{
    GameplayTagCatalog, StatusDefinition, StatusRefreshPolicy, StatusRuntime,
    StatusSchemaValidator, StatusStackMode,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusMergeNoOpReason {
    AddAtMaximumWithNoDurationChange,
    ReapplicationChangedNothing,
    CurrentHighestOnlyIsStronger,
    IndependentStacksAtMaximum,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StatusMergeOutcome {
    Applied {
        instance: StatusRuntime,
        existing_instance_id: Option<String>,
        stack_delta: i64,
        duration_changed: bool,
    },
    Replaced {
        removed: StatusRuntime,
        applied: StatusRuntime,
    },
    NoOp {
        reason: StatusMergeNoOpReason,
    },
}

pub struct StatusMergePolicy;

impl StatusMergePolicy {
    pub fn validate_definition(
        definition: &StatusDefinition,
        tag_catalog: &GameplayTagCatalog,
    ) -> Result<(), StatusMergeError> {
        StatusSchemaValidator::validate_definition(definition, tag_catalog).map_err(|error| {
            merge_error(
                StatusMergeErrorCode::InvalidDefinition,
                format!("{}:{:?}", error.subject, error.code),
            )
        })?;
        let valid = match definition.stack_mode {
            StatusStackMode::Add => {
                definition.refresh_policy != StatusRefreshPolicy::IndependentDuration
            }
            StatusStackMode::Replace => {
                definition.max_stacks == 1
                    && definition.refresh_policy == StatusRefreshPolicy::ReplaceDuration
            }
            StatusStackMode::HighestOnly => {
                definition.max_stacks == 1
                    && definition.strength_rank.is_some()
                    && definition.refresh_policy != StatusRefreshPolicy::IndependentDuration
            }
            StatusStackMode::IndependentStacks => {
                definition.refresh_policy == StatusRefreshPolicy::IndependentDuration
            }
        };
        if !valid {
            return Err(merge_error(
                StatusMergeErrorCode::IllegalPolicyCombination,
                &definition.status_definition_id,
            ));
        }
        Ok(())
    }
}

pub struct StatusMergeEngine;

impl StatusMergeEngine {
    pub fn merge(
        definition: &StatusDefinition,
        tag_catalog: &GameplayTagCatalog,
        existing: &[StatusRuntime],
        incoming: StatusRuntime,
    ) -> Result<StatusMergeOutcome, StatusMergeError> {
        StatusMergePolicy::validate_definition(definition, tag_catalog)?;
        validate_incoming(definition, existing, &incoming)?;

        let mut candidates: Vec<_> = existing
            .iter()
            .filter(|instance| instance.stack_group_id == definition.stack_group_id)
            .cloned()
            .collect();
        candidates.sort_by(|left, right| {
            left.application_sequence
                .cmp(&right.application_sequence)
                .then_with(|| left.status_instance_id.cmp(&right.status_instance_id))
        });
        validate_candidates(definition, &candidates)?;

        match definition.stack_mode {
            StatusStackMode::Add => merge_add(definition, candidates, incoming),
            StatusStackMode::Replace => merge_replace(candidates, incoming),
            StatusStackMode::HighestOnly => merge_highest_only(definition, candidates, incoming),
            StatusStackMode::IndependentStacks => {
                merge_independent(definition, candidates, incoming)
            }
        }
    }
}

fn validate_candidates(
    definition: &StatusDefinition,
    candidates: &[StatusRuntime],
) -> Result<(), StatusMergeError> {
    let invalid = match definition.stack_mode {
        StatusStackMode::Add => candidates.iter().any(|instance| {
            instance.stack_count > definition.max_stacks
                || instance.duration_clock != definition.duration.clock
        }),
        StatusStackMode::Replace | StatusStackMode::HighestOnly => {
            candidates.iter().any(|instance| instance.stack_count != 1)
        }
        StatusStackMode::IndependentStacks => {
            candidates.len() > usize::try_from(definition.max_stacks).unwrap_or(usize::MAX)
                || candidates.iter().any(|instance| instance.stack_count != 1)
        }
    };
    if invalid {
        return Err(merge_error(
            StatusMergeErrorCode::InvalidExistingInstance,
            &definition.stack_group_id,
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusMergeErrorCode {
    InvalidDefinition,
    IllegalPolicyCombination,
    InvalidExistingInstance,
    InvalidIncomingInstance,
    IncomingDefinitionMismatch,
    DuplicateInstanceId,
    NonMonotonicApplicationSequence,
    ConflictingExistingInstances,
    DurationMismatch,
    NumericOverflow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusMergeError {
    pub code: StatusMergeErrorCode,
    pub subject: String,
}

impl fmt::Display for StatusMergeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "status merge failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for StatusMergeError {}

fn validate_incoming(
    definition: &StatusDefinition,
    existing: &[StatusRuntime],
    incoming: &StatusRuntime,
) -> Result<(), StatusMergeError> {
    for instance in existing {
        StatusSchemaValidator::validate_runtime(instance).map_err(|error| {
            merge_error(
                StatusMergeErrorCode::InvalidExistingInstance,
                format!("{}:{:?}", error.subject, error.code),
            )
        })?;
    }
    StatusSchemaValidator::validate_runtime(incoming).map_err(|error| {
        merge_error(
            StatusMergeErrorCode::InvalidIncomingInstance,
            format!("{}:{:?}", error.subject, error.code),
        )
    })?;
    if incoming.status_definition_id != definition.status_definition_id
        || incoming.stack_group_id != definition.stack_group_id
        || incoming.duration_clock != definition.duration.clock
        || incoming.remaining_duration != definition.duration.duration
        || incoming.strength_rank != definition.strength_rank
        || incoming.stack_count != 1
    {
        return Err(merge_error(
            StatusMergeErrorCode::IncomingDefinitionMismatch,
            &incoming.status_instance_id,
        ));
    }
    if existing
        .iter()
        .any(|instance| instance.status_instance_id == incoming.status_instance_id)
    {
        return Err(merge_error(
            StatusMergeErrorCode::DuplicateInstanceId,
            &incoming.status_instance_id,
        ));
    }
    if existing
        .iter()
        .map(|instance| instance.application_sequence)
        .max()
        .is_some_and(|maximum| incoming.application_sequence <= maximum)
    {
        return Err(merge_error(
            StatusMergeErrorCode::NonMonotonicApplicationSequence,
            &incoming.status_instance_id,
        ));
    }
    Ok(())
}

fn merge_add(
    definition: &StatusDefinition,
    candidates: Vec<StatusRuntime>,
    incoming: StatusRuntime,
) -> Result<StatusMergeOutcome, StatusMergeError> {
    let Some(mut current) = unique_candidate(candidates)? else {
        return Ok(applied_new(incoming));
    };
    let before_stack = current.stack_count;
    let before_duration = current.remaining_duration;
    current.stack_count = current
        .stack_count
        .checked_add(1)
        .ok_or_else(|| merge_error(StatusMergeErrorCode::NumericOverflow, "stackCount"))?
        .min(definition.max_stacks);
    current.remaining_duration = merge_duration(
        definition.refresh_policy,
        current.remaining_duration,
        incoming.remaining_duration,
    )?;
    let stack_delta = current.stack_count - before_stack;
    let duration_changed = current.remaining_duration != before_duration;
    if stack_delta == 0 && !duration_changed {
        return Ok(StatusMergeOutcome::NoOp {
            reason: StatusMergeNoOpReason::AddAtMaximumWithNoDurationChange,
        });
    }
    Ok(StatusMergeOutcome::Applied {
        existing_instance_id: Some(current.status_instance_id.clone()),
        instance: current,
        stack_delta,
        duration_changed,
    })
}

fn merge_replace(
    candidates: Vec<StatusRuntime>,
    incoming: StatusRuntime,
) -> Result<StatusMergeOutcome, StatusMergeError> {
    match unique_candidate(candidates)? {
        Some(current) => Ok(StatusMergeOutcome::Replaced {
            removed: current,
            applied: incoming,
        }),
        None => Ok(applied_new(incoming)),
    }
}

fn merge_highest_only(
    definition: &StatusDefinition,
    candidates: Vec<StatusRuntime>,
    incoming: StatusRuntime,
) -> Result<StatusMergeOutcome, StatusMergeError> {
    let Some(mut current) = unique_candidate(candidates)? else {
        return Ok(applied_new(incoming));
    };
    let current_rank = current.strength_rank.ok_or_else(|| {
        merge_error(
            StatusMergeErrorCode::InvalidExistingInstance,
            &current.status_instance_id,
        )
    })?;
    let incoming_rank = definition
        .strength_rank
        .expect("policy validation requires rank");
    if current.status_definition_id == incoming.status_definition_id
        && current_rank == incoming_rank
    {
        let before_duration = current.remaining_duration;
        current.remaining_duration = merge_duration(
            definition.refresh_policy,
            current.remaining_duration,
            incoming.remaining_duration,
        )?;
        let duration_changed = current.remaining_duration != before_duration;
        if !duration_changed {
            return Ok(StatusMergeOutcome::NoOp {
                reason: StatusMergeNoOpReason::ReapplicationChangedNothing,
            });
        }
        return Ok(StatusMergeOutcome::Applied {
            existing_instance_id: Some(current.status_instance_id.clone()),
            instance: current,
            stack_delta: 0,
            duration_changed,
        });
    }
    let incoming_is_stronger = incoming_rank > current_rank
        || incoming_rank == current_rank
            && incoming.status_definition_id < current.status_definition_id;
    if incoming_is_stronger {
        Ok(StatusMergeOutcome::Replaced {
            removed: current,
            applied: incoming,
        })
    } else {
        Ok(StatusMergeOutcome::NoOp {
            reason: StatusMergeNoOpReason::CurrentHighestOnlyIsStronger,
        })
    }
}

fn merge_independent(
    definition: &StatusDefinition,
    candidates: Vec<StatusRuntime>,
    incoming: StatusRuntime,
) -> Result<StatusMergeOutcome, StatusMergeError> {
    if i64::try_from(candidates.len()).unwrap_or(i64::MAX) >= definition.max_stacks {
        Ok(StatusMergeOutcome::NoOp {
            reason: StatusMergeNoOpReason::IndependentStacksAtMaximum,
        })
    } else {
        Ok(applied_new(incoming))
    }
}

fn unique_candidate(
    mut candidates: Vec<StatusRuntime>,
) -> Result<Option<StatusRuntime>, StatusMergeError> {
    if candidates.len() > 1 {
        return Err(merge_error(
            StatusMergeErrorCode::ConflictingExistingInstances,
            &candidates[0].stack_group_id,
        ));
    }
    Ok(candidates.pop())
}

fn merge_duration(
    policy: StatusRefreshPolicy,
    existing: Option<i64>,
    incoming: Option<i64>,
) -> Result<Option<i64>, StatusMergeError> {
    if existing.is_none() && incoming.is_none() {
        return Ok(None);
    }
    let (Some(existing), Some(incoming)) = (existing, incoming) else {
        return Err(merge_error(
            StatusMergeErrorCode::DurationMismatch,
            "remainingDuration",
        ));
    };
    match policy {
        StatusRefreshPolicy::KeepExisting => Ok(Some(existing)),
        StatusRefreshPolicy::RefreshDuration => Ok(Some(existing.max(incoming))),
        StatusRefreshPolicy::ExtendDuration => existing
            .checked_add(incoming)
            .map(Some)
            .ok_or_else(|| merge_error(StatusMergeErrorCode::NumericOverflow, "duration")),
        StatusRefreshPolicy::ReplaceDuration => Ok(Some(incoming)),
        StatusRefreshPolicy::IndependentDuration => Err(merge_error(
            StatusMergeErrorCode::IllegalPolicyCombination,
            "independentDuration",
        )),
    }
}

fn applied_new(instance: StatusRuntime) -> StatusMergeOutcome {
    StatusMergeOutcome::Applied {
        instance,
        existing_instance_id: None,
        stack_delta: 1,
        duration_changed: true,
    }
}

fn merge_error(code: StatusMergeErrorCode, subject: impl Into<String>) -> StatusMergeError {
    StatusMergeError {
        code,
        subject: subject.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CURRENT_STATUS_SCHEMA_VERSION, DurationClock, StatusActivationPolicy,
        StatusDurationDefinition, StatusExpiryPhase, StatusTickPhase,
    };

    #[test]
    fn policy_rejects_every_illegal_stack_refresh_cross_product() {
        let catalog = GameplayTagCatalog::v0_4_1();
        let illegal = [
            (
                StatusStackMode::Add,
                StatusRefreshPolicy::IndependentDuration,
                3,
                None,
            ),
            (
                StatusStackMode::Replace,
                StatusRefreshPolicy::KeepExisting,
                1,
                None,
            ),
            (
                StatusStackMode::Replace,
                StatusRefreshPolicy::ReplaceDuration,
                2,
                None,
            ),
            (
                StatusStackMode::HighestOnly,
                StatusRefreshPolicy::KeepExisting,
                2,
                Some(4),
            ),
            (
                StatusStackMode::HighestOnly,
                StatusRefreshPolicy::KeepExisting,
                1,
                None,
            ),
            (
                StatusStackMode::HighestOnly,
                StatusRefreshPolicy::IndependentDuration,
                1,
                Some(4),
            ),
            (
                StatusStackMode::IndependentStacks,
                StatusRefreshPolicy::RefreshDuration,
                3,
                None,
            ),
        ];

        for (mode, refresh, max_stacks, rank) in illegal {
            let definition = definition("status-test", mode, refresh, max_stacks, rank, 4);
            assert_eq!(
                StatusMergePolicy::validate_definition(&definition, &catalog)
                    .unwrap_err()
                    .code,
                StatusMergeErrorCode::IllegalPolicyCombination,
                "unexpectedly accepted {mode:?} + {refresh:?}"
            );
        }
    }

    #[test]
    fn add_uses_one_identity_caps_stacks_and_applies_each_refresh_policy() {
        let catalog = GameplayTagCatalog::v0_4_1();
        let cases = [
            (StatusRefreshPolicy::KeepExisting, 2),
            (StatusRefreshPolicy::RefreshDuration, 4),
            (StatusRefreshPolicy::ExtendDuration, 6),
            (StatusRefreshPolicy::ReplaceDuration, 4),
        ];
        for (refresh, expected_duration) in cases {
            let definition = definition("status-add", StatusStackMode::Add, refresh, 3, None, 4);
            let existing = runtime("old", "status-add", "shared", 1, 2, 2, None);
            let incoming = runtime("new", "status-add", "shared", 2, 1, 4, None);
            let outcome =
                StatusMergeEngine::merge(&definition, &catalog, &[existing], incoming).unwrap();
            let StatusMergeOutcome::Applied {
                instance,
                existing_instance_id,
                stack_delta,
                duration_changed,
            } = outcome
            else {
                panic!("expected applied outcome");
            };
            assert_eq!(instance.status_instance_id, "old");
            assert_eq!(instance.stack_count, 3);
            assert_eq!(instance.remaining_duration, Some(expected_duration));
            assert_eq!(instance.activation_clock_index, 10);
            assert_eq!(existing_instance_id.as_deref(), Some("old"));
            assert_eq!(stack_delta, 1);
            assert_eq!(duration_changed, expected_duration != 2);
        }

        let definition = definition(
            "status-add",
            StatusStackMode::Add,
            StatusRefreshPolicy::KeepExisting,
            3,
            None,
            4,
        );
        let existing = runtime("old", "status-add", "shared", 1, 3, 4, None);
        let incoming = runtime("new", "status-add", "shared", 2, 1, 4, None);
        assert_eq!(
            StatusMergeEngine::merge(&definition, &catalog, &[existing], incoming).unwrap(),
            StatusMergeOutcome::NoOp {
                reason: StatusMergeNoOpReason::AddAtMaximumWithNoDurationChange
            }
        );
    }

    #[test]
    fn m11_long_combat_generated_content_stress_caps_thousands_of_stack_applications() {
        let run = || {
            let catalog = GameplayTagCatalog::v0_4_1();
            let definition = definition(
                "status-stress",
                StatusStackMode::Add,
                StatusRefreshPolicy::RefreshDuration,
                64,
                None,
                4,
            );
            let mut current: Vec<StatusRuntime> = Vec::new();
            for sequence in 1..=4_096 {
                let incoming = runtime(
                    &format!("incoming-{sequence:04}"),
                    "status-stress",
                    "shared",
                    sequence,
                    1,
                    4,
                    None,
                );
                match StatusMergeEngine::merge(&definition, &catalog, &current, incoming).unwrap() {
                    StatusMergeOutcome::Applied { instance, .. } => current = vec![instance],
                    StatusMergeOutcome::NoOp {
                        reason: StatusMergeNoOpReason::AddAtMaximumWithNoDurationChange,
                    } => {}
                    outcome => panic!("unexpected stress merge outcome: {outcome:?}"),
                }
            }
            current
        };

        let first = run();
        let second = run();
        assert_eq!(first, second);
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].stack_count, 64);
        assert_eq!(first[0].remaining_duration, Some(4));
    }

    #[test]
    fn replace_is_atomic_and_uses_the_incoming_identity_and_clocks() {
        let catalog = GameplayTagCatalog::v0_4_1();
        let definition = definition(
            "status-new",
            StatusStackMode::Replace,
            StatusRefreshPolicy::ReplaceDuration,
            1,
            Some(8),
            5,
        );
        let old = runtime("old", "status-old", "shared", 2, 1, 2, Some(3));
        let mut incoming = runtime("new", "status-new", "shared", 3, 1, 5, Some(8));
        incoming.activation_clock_index = 99;
        incoming.tick_eligible_clock_index = 99;

        assert_eq!(
            StatusMergeEngine::merge(
                &definition,
                &catalog,
                std::slice::from_ref(&old),
                incoming.clone(),
            )
            .unwrap(),
            StatusMergeOutcome::Replaced {
                removed: old,
                applied: incoming
            }
        );
    }

    #[test]
    fn highest_only_uses_rank_then_definition_id_and_refreshes_exact_reapplication() {
        let catalog = GameplayTagCatalog::v0_4_1();
        let stronger = definition(
            "status-alpha",
            StatusStackMode::HighestOnly,
            StatusRefreshPolicy::RefreshDuration,
            1,
            Some(7),
            4,
        );
        let current = runtime("old", "status-zeta", "shared", 1, 1, 2, Some(7));
        let incoming = runtime("new", "status-alpha", "shared", 2, 1, 4, Some(7));
        assert!(matches!(
            StatusMergeEngine::merge(&stronger, &catalog, &[current], incoming).unwrap(),
            StatusMergeOutcome::Replaced { .. }
        ));

        let weaker = definition(
            "status-zeta",
            StatusStackMode::HighestOnly,
            StatusRefreshPolicy::RefreshDuration,
            1,
            Some(6),
            4,
        );
        let current = runtime("old", "status-alpha", "shared", 1, 1, 2, Some(7));
        let incoming = runtime("new", "status-zeta", "shared", 2, 1, 4, Some(6));
        assert_eq!(
            StatusMergeEngine::merge(&weaker, &catalog, &[current], incoming).unwrap(),
            StatusMergeOutcome::NoOp {
                reason: StatusMergeNoOpReason::CurrentHighestOnlyIsStronger
            }
        );

        let repeated = definition(
            "status-alpha",
            StatusStackMode::HighestOnly,
            StatusRefreshPolicy::ExtendDuration,
            1,
            Some(7),
            4,
        );
        let current = runtime("old", "status-alpha", "shared", 1, 1, 2, Some(7));
        let incoming = runtime("new", "status-alpha", "shared", 2, 1, 4, Some(7));
        let StatusMergeOutcome::Applied { instance, .. } =
            StatusMergeEngine::merge(&repeated, &catalog, &[current], incoming).unwrap()
        else {
            panic!("expected refresh");
        };
        assert_eq!(instance.status_instance_id, "old");
        assert_eq!(instance.remaining_duration, Some(6));
        assert_eq!(instance.activation_clock_index, 10);
    }

    #[test]
    fn independent_stacks_add_until_maximum_without_eviction_or_refresh() {
        let catalog = GameplayTagCatalog::v0_4_1();
        let definition = definition(
            "status-independent",
            StatusStackMode::IndependentStacks,
            StatusRefreshPolicy::IndependentDuration,
            2,
            None,
            4,
        );
        let first = runtime("first", "status-independent", "shared", 1, 1, 2, None);
        let second = runtime("second", "status-independent", "shared", 2, 1, 4, None);
        assert_eq!(
            StatusMergeEngine::merge(
                &definition,
                &catalog,
                std::slice::from_ref(&first),
                second.clone(),
            )
            .unwrap(),
            applied_new(second.clone())
        );
        let third = runtime("third", "status-independent", "shared", 3, 1, 4, None);
        assert_eq!(
            StatusMergeEngine::merge(&definition, &catalog, &[second, first], third).unwrap(),
            StatusMergeOutcome::NoOp {
                reason: StatusMergeNoOpReason::IndependentStacksAtMaximum
            }
        );
    }

    #[test]
    fn candidate_resolution_is_independent_of_input_order() {
        let catalog = GameplayTagCatalog::v0_4_1();
        let definition = definition(
            "status-add",
            StatusStackMode::Add,
            StatusRefreshPolicy::RefreshDuration,
            3,
            None,
            4,
        );
        let first = runtime("z-id", "status-add", "shared", 4, 1, 2, None);
        let second = runtime("a-id", "status-add", "shared", 4, 1, 3, None);
        let incoming = runtime("new", "status-add", "shared", 5, 1, 4, None);
        let left = StatusMergeEngine::merge(
            &definition,
            &catalog,
            &[first.clone(), second.clone()],
            incoming.clone(),
        )
        .unwrap_err();
        let right = StatusMergeEngine::merge(&definition, &catalog, &[second, first], incoming)
            .unwrap_err();
        assert_eq!(left, right);
        assert_eq!(
            left.code,
            StatusMergeErrorCode::ConflictingExistingInstances
        );
        assert_eq!(left.subject, "shared");
    }

    #[test]
    fn merge_rejects_malformed_incoming_identity_and_non_monotonic_sequence() {
        let catalog = GameplayTagCatalog::v0_4_1();
        let definition = definition(
            "status-add",
            StatusStackMode::Add,
            StatusRefreshPolicy::RefreshDuration,
            3,
            None,
            4,
        );
        let existing = runtime("old", "status-add", "shared", 5, 1, 2, None);
        let wrong_definition = runtime("new", "other-status", "shared", 6, 1, 4, None);
        assert_eq!(
            StatusMergeEngine::merge(
                &definition,
                &catalog,
                std::slice::from_ref(&existing),
                wrong_definition,
            )
            .unwrap_err()
            .code,
            StatusMergeErrorCode::IncomingDefinitionMismatch
        );
        let old_sequence = runtime("new", "status-add", "shared", 5, 1, 4, None);
        assert_eq!(
            StatusMergeEngine::merge(&definition, &catalog, &[existing], old_sequence)
                .unwrap_err()
                .code,
            StatusMergeErrorCode::NonMonotonicApplicationSequence
        );
    }

    #[test]
    fn merge_rejects_over_cap_or_cross_clock_existing_state_instead_of_repairing_it() {
        let catalog = GameplayTagCatalog::v0_4_1();
        let definition = definition(
            "status-add",
            StatusStackMode::Add,
            StatusRefreshPolicy::RefreshDuration,
            3,
            None,
            4,
        );
        let incoming = runtime("new", "status-add", "shared", 8, 1, 4, None);
        let over_cap = runtime("old", "status-add", "shared", 7, 4, 2, None);
        assert_eq!(
            StatusMergeEngine::merge(
                &definition,
                &catalog,
                std::slice::from_ref(&over_cap),
                incoming.clone(),
            )
            .unwrap_err()
            .code,
            StatusMergeErrorCode::InvalidExistingInstance
        );

        let mut cross_clock = runtime("old", "status-add", "shared", 7, 1, 2, None);
        cross_clock.duration_clock = DurationClock::Round;
        assert_eq!(
            StatusMergeEngine::merge(&definition, &catalog, &[cross_clock], incoming)
                .unwrap_err()
                .code,
            StatusMergeErrorCode::InvalidExistingInstance
        );
    }

    fn definition(
        id: &str,
        stack_mode: StatusStackMode,
        refresh_policy: StatusRefreshPolicy,
        max_stacks: i64,
        strength_rank: Option<i64>,
        duration: i64,
    ) -> StatusDefinition {
        StatusDefinition {
            status_schema_version: CURRENT_STATUS_SCHEMA_VERSION,
            status_definition_id: id.into(),
            tags: Vec::new(),
            stack_group_id: "shared".into(),
            stack_mode,
            max_stacks,
            duration: StatusDurationDefinition {
                clock: DurationClock::OwnerTurn,
                duration: Some(duration),
                activation_policy: StatusActivationPolicy::NextClock,
                expiry_phase: StatusExpiryPhase::OwnerTurnEnd,
            },
            refresh_policy,
            priority: 0,
            control_category: crate::ControlCategory::None,
            tick_phase: StatusTickPhase::None,
            dispel_tags: Vec::new(),
            immunity_tags: Vec::new(),
            effects: Vec::new(),
            triggers: Vec::new(),
            strength_rank,
        }
    }

    fn runtime(
        instance_id: &str,
        definition_id: &str,
        stack_group_id: &str,
        sequence: u64,
        stack_count: i64,
        duration: i64,
        strength_rank: Option<i64>,
    ) -> StatusRuntime {
        StatusRuntime {
            status_schema_version: CURRENT_STATUS_SCHEMA_VERSION,
            status_instance_id: instance_id.into(),
            status_definition_id: definition_id.into(),
            source_combatant_id: Some("source".into()),
            stack_group_id: stack_group_id.into(),
            stack_count,
            remaining_duration: Some(duration),
            duration_clock: DurationClock::OwnerTurn,
            application_sequence: sequence,
            activation_clock_index: 10,
            applied_round_index: 1,
            applied_owner_turn_index: Some(1),
            tick_eligible_clock_index: 10,
            last_duration_advanced_clock_index: None,
            strength_rank,
        }
    }
}
