use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    CanonicalEventChainScheduler, CombatState, EffectDefinition, SchedulerCandidate,
    SchedulerExecutionGateOutcome, SchedulerItem, SchedulerItemKind, StatusDefinition,
    StatusRuntime, StatusTriggerDefinition, StatusTriggerHook, TargetDefeatedFact,
};

pub const TRIGGER_PHASE_PRIORITY_CONTRACT_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LifecycleTriggerHook {
    BattleStart,
    RoundStart,
    TurnStart,
    BeforeAction,
    AfterAction,
    BeforeRoll,
    AfterRoll,
    BeforeDamage,
    BeforeStatusApply,
    TurnEnd,
    RoundEnd,
    BattleEnd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CalculatedTriggerHook {
    HitConfirmed,
    MissConfirmed,
    CriticalConfirmed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum CommittedTriggerEvent {
    DamageApplied {
        target_combatant_id: String,
        event_chain_id: String,
        committed_sequence: u64,
    },
    StatusApplied {
        target_combatant_id: String,
        status_instance_id: String,
        event_chain_id: String,
        committed_sequence: u64,
    },
    StatusRemoved {
        target_combatant_id: String,
        status_instance_id: String,
        event_chain_id: String,
        committed_sequence: u64,
    },
    TargetDefeated(TargetDefeatedFact),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TriggerSignal {
    Lifecycle(LifecycleTriggerHook),
    Calculated(CalculatedTriggerHook),
    Committed(CommittedTriggerEvent),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScheduledTriggerPermit {
    pub item: SchedulerItem,
    pub owner_combatant_id: String,
    pub status_instance_id: String,
    pub status_definition_id: String,
    pub trigger_id: String,
    pub hook: StatusTriggerHook,
    pub effects: Vec<EffectDefinition>,
    pub resumed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TriggerDispatchOutcome {
    Skipped { item: SchedulerItem },
    ReadyToExecute(ScheduledTriggerPermit),
    EngineFailure(crate::LoopGuardEngineFailure),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TriggerPipelineErrorCode {
    InvalidSignal,
    MissingStatusDefinition,
    DuplicateStatusDefinition,
    WrongSchedulerItemKind,
    SchedulerFailure,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TriggerPipelineError {
    pub code: TriggerPipelineErrorCode,
    pub subject_id: String,
}

impl fmt::Display for TriggerPipelineError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "trigger pipeline failed for {}: {:?}",
            self.subject_id, self.code
        )
    }
}

impl Error for TriggerPipelineError {}

pub struct CanonicalTriggerPipeline;

impl CanonicalTriggerPipeline {
    pub fn enqueue_roots(
        state: &mut CombatState,
        definitions: &[StatusDefinition],
        signal: &TriggerSignal,
    ) -> Result<Vec<SchedulerItem>, TriggerPipelineError> {
        let candidates = collect_candidates(state, definitions, signal)?;
        CanonicalEventChainScheduler::enqueue_roots(state, candidates).map_err(|error| {
            pipeline_error(TriggerPipelineErrorCode::SchedulerFailure, error.subject_id)
        })
    }

    pub fn complete_current_with_children(
        state: &mut CombatState,
        definitions: &[StatusDefinition],
        signal: &TriggerSignal,
    ) -> Result<Vec<SchedulerItem>, TriggerPipelineError> {
        let candidates = collect_candidates(state, definitions, signal)?;
        CanonicalEventChainScheduler::complete_current_with_children(state, candidates).map_err(
            |error| pipeline_error(TriggerPipelineErrorCode::SchedulerFailure, error.subject_id),
        )
    }

    pub fn gate_current(
        state: &mut CombatState,
        definitions: &[StatusDefinition],
    ) -> Result<TriggerDispatchOutcome, TriggerPipelineError> {
        validate_definition_catalog(definitions)?;
        let current = state
            .scheduler
            .as_ref()
            .and_then(|scheduler| scheduler.current_item.clone())
            .ok_or_else(|| {
                pipeline_error(TriggerPipelineErrorCode::SchedulerFailure, "current-item")
            })?;
        if current.kind != SchedulerItemKind::Trigger {
            return Err(pipeline_error(
                TriggerPipelineErrorCode::WrongSchedulerItemKind,
                &current.effect_stable_id,
            ));
        }

        let matched = find_scheduled_trigger(state, definitions, &current).map(|matched| {
            (
                matched.owner_combatant_id.to_owned(),
                matched.status.status_instance_id.clone(),
                matched.definition.status_definition_id.clone(),
                matched.trigger.trigger_id.clone(),
                matched.trigger.hook,
                matched.trigger.effects.clone(),
            )
        });
        let gate =
            CanonicalEventChainScheduler::gate_current_for_execution(state, matched.is_some())
                .map_err(|error| {
                    pipeline_error(TriggerPipelineErrorCode::SchedulerFailure, error.subject_id)
                })?;
        match gate {
            SchedulerExecutionGateOutcome::Skipped { item } => {
                Ok(TriggerDispatchOutcome::Skipped { item })
            }
            SchedulerExecutionGateOutcome::EngineFailure { failure } => {
                Ok(TriggerDispatchOutcome::EngineFailure(failure))
            }
            SchedulerExecutionGateOutcome::ReadyToExecute { item, resumed } => {
                let (owner_id, instance_id, definition_id, trigger_id, hook, effects) =
                    matched.expect("eligible trigger was matched before scheduler gate");
                Ok(TriggerDispatchOutcome::ReadyToExecute(
                    ScheduledTriggerPermit {
                        item,
                        owner_combatant_id: owner_id,
                        status_instance_id: instance_id,
                        status_definition_id: definition_id,
                        trigger_id,
                        hook,
                        effects,
                        resumed,
                    },
                ))
            }
        }
    }
}

struct MatchedTrigger<'a> {
    owner_combatant_id: &'a str,
    status: &'a StatusRuntime,
    definition: &'a StatusDefinition,
    trigger: &'a StatusTriggerDefinition,
}

fn collect_candidates(
    state: &CombatState,
    definitions: &[StatusDefinition],
    signal: &TriggerSignal,
) -> Result<Vec<SchedulerCandidate>, TriggerPipelineError> {
    validate_definition_catalog(definitions)?;
    let hooks = signal_hooks(state, signal)?;
    let mut candidates = Vec::new();
    for combatant in &state.combatants {
        for status in &combatant.statuses {
            let definition = definition_for(definitions, &status.status_definition_id)?;
            for trigger in &definition.triggers {
                if !hooks.contains(&trigger.hook)
                    || (trigger.hook == StatusTriggerHook::OnKill
                        && !on_kill_is_legal(signal, &combatant.combatant_id))
                {
                    continue;
                }
                candidates.push(SchedulerCandidate {
                    kind: SchedulerItemKind::Trigger,
                    phase_priority: phase_priority(trigger.hook),
                    explicit_priority: trigger.priority,
                    source_stable_id: combatant.combatant_id.clone(),
                    effect_stable_id: scheduled_effect_id(
                        &combatant.combatant_id,
                        status,
                        definition,
                        trigger,
                    ),
                });
            }
        }
    }
    Ok(candidates)
}

fn find_scheduled_trigger<'a>(
    state: &'a CombatState,
    definitions: &'a [StatusDefinition],
    item: &SchedulerItem,
) -> Option<MatchedTrigger<'a>> {
    let combatant = state
        .combatants
        .iter()
        .find(|value| value.combatant_id == item.source_stable_id)?;
    for status in &combatant.statuses {
        let definition = definitions
            .iter()
            .find(|value| value.status_definition_id == status.status_definition_id)?;
        for trigger in &definition.triggers {
            if item.effect_stable_id
                == scheduled_effect_id(&combatant.combatant_id, status, definition, trigger)
                && item.phase_priority == phase_priority(trigger.hook)
                && item.explicit_priority == trigger.priority
            {
                return Some(MatchedTrigger {
                    owner_combatant_id: &combatant.combatant_id,
                    status,
                    definition,
                    trigger,
                });
            }
        }
    }
    None
}

fn validate_definition_catalog(
    definitions: &[StatusDefinition],
) -> Result<(), TriggerPipelineError> {
    for (index, definition) in definitions.iter().enumerate() {
        if definitions[..index]
            .iter()
            .any(|prior| prior.status_definition_id == definition.status_definition_id)
        {
            return Err(pipeline_error(
                TriggerPipelineErrorCode::DuplicateStatusDefinition,
                &definition.status_definition_id,
            ));
        }
    }
    Ok(())
}

fn definition_for<'a>(
    definitions: &'a [StatusDefinition],
    definition_id: &str,
) -> Result<&'a StatusDefinition, TriggerPipelineError> {
    definitions
        .iter()
        .find(|value| value.status_definition_id == definition_id)
        .ok_or_else(|| {
            pipeline_error(
                TriggerPipelineErrorCode::MissingStatusDefinition,
                definition_id,
            )
        })
}

fn signal_hooks(
    state: &CombatState,
    signal: &TriggerSignal,
) -> Result<Vec<StatusTriggerHook>, TriggerPipelineError> {
    let hooks = match signal {
        TriggerSignal::Lifecycle(hook) => vec![lifecycle_hook(*hook)],
        TriggerSignal::Calculated(hook) => vec![calculated_hook(*hook)],
        TriggerSignal::Committed(event) => {
            validate_committed_event(state, event)?;
            match event {
                CommittedTriggerEvent::DamageApplied { .. } => {
                    vec![StatusTriggerHook::DamageApplied]
                }
                CommittedTriggerEvent::StatusApplied { .. } => {
                    vec![StatusTriggerHook::StatusApplied]
                }
                CommittedTriggerEvent::StatusRemoved { .. } => {
                    vec![StatusTriggerHook::StatusRemoved]
                }
                CommittedTriggerEvent::TargetDefeated(_) => {
                    vec![StatusTriggerHook::TargetDefeated, StatusTriggerHook::OnKill]
                }
            }
        }
    };
    Ok(hooks)
}

fn validate_committed_event(
    state: &CombatState,
    event: &CommittedTriggerEvent,
) -> Result<(), TriggerPipelineError> {
    let (sequence, event_chain_id, ids): (u64, &str, Vec<&str>) = match event {
        CommittedTriggerEvent::DamageApplied {
            target_combatant_id,
            event_chain_id,
            committed_sequence,
        } => (
            *committed_sequence,
            event_chain_id,
            vec![target_combatant_id],
        ),
        CommittedTriggerEvent::StatusApplied {
            target_combatant_id,
            status_instance_id,
            event_chain_id,
            committed_sequence,
        }
        | CommittedTriggerEvent::StatusRemoved {
            target_combatant_id,
            status_instance_id,
            event_chain_id,
            committed_sequence,
        } => (
            *committed_sequence,
            event_chain_id,
            vec![target_combatant_id, status_instance_id],
        ),
        CommittedTriggerEvent::TargetDefeated(fact) => (
            fact.committed_sequence,
            &fact.event_chain_id,
            vec![fact.target_combatant_id.as_str()],
        ),
    };
    let active_chain_id = state
        .scheduler
        .as_ref()
        .map(|scheduler| scheduler.event_chain_id.as_str());
    if sequence == 0
        || sequence != state.last_committed_sequence
        || active_chain_id != Some(event_chain_id)
        || ids.into_iter().any(|id| id.is_empty())
    {
        return Err(pipeline_error(
            TriggerPipelineErrorCode::InvalidSignal,
            "committed-event",
        ));
    }
    Ok(())
}

fn on_kill_is_legal(signal: &TriggerSignal, owner_combatant_id: &str) -> bool {
    matches!(
        signal,
        TriggerSignal::Committed(CommittedTriggerEvent::TargetDefeated(fact))
            if fact.source_combatant_id.as_deref() == Some(owner_combatant_id)
    )
}

fn scheduled_effect_id(
    owner_combatant_id: &str,
    status: &StatusRuntime,
    definition: &StatusDefinition,
    trigger: &StatusTriggerDefinition,
) -> String {
    let mut hasher = Sha256::new();
    append_hash_part(&mut hasher, owner_combatant_id.as_bytes());
    append_hash_part(&mut hasher, status.status_instance_id.as_bytes());
    append_hash_part(&mut hasher, definition.status_definition_id.as_bytes());
    append_hash_part(&mut hasher, trigger.trigger_id.as_bytes());
    append_hash_part(&mut hasher, hook_id(trigger.hook).as_bytes());
    format!("trigger:{:x}", hasher.finalize())
}

fn append_hash_part(hasher: &mut Sha256, value: &[u8]) {
    hasher.update(u64::try_from(value.len()).unwrap_or(u64::MAX).to_be_bytes());
    hasher.update(value);
}

const fn phase_priority(hook: StatusTriggerHook) -> i32 {
    match hook {
        StatusTriggerHook::BattleStart => 100,
        StatusTriggerHook::RoundStart => 200,
        StatusTriggerHook::TurnStart => 300,
        StatusTriggerHook::BeforeAction => 400,
        StatusTriggerHook::BeforeRoll => 500,
        StatusTriggerHook::AfterRoll => 600,
        StatusTriggerHook::HitConfirmed
        | StatusTriggerHook::MissConfirmed
        | StatusTriggerHook::CriticalConfirmed => 700,
        StatusTriggerHook::BeforeDamage | StatusTriggerHook::BeforeStatusApply => 800,
        StatusTriggerHook::DamageApplied
        | StatusTriggerHook::StatusApplied
        | StatusTriggerHook::StatusRemoved
        | StatusTriggerHook::TargetDefeated
        | StatusTriggerHook::OnKill => 900,
        StatusTriggerHook::AfterAction => 1_000,
        StatusTriggerHook::TurnEnd => 1_100,
        StatusTriggerHook::RoundEnd => 1_200,
        StatusTriggerHook::BattleEnd => 1_300,
    }
}

const fn lifecycle_hook(hook: LifecycleTriggerHook) -> StatusTriggerHook {
    match hook {
        LifecycleTriggerHook::BattleStart => StatusTriggerHook::BattleStart,
        LifecycleTriggerHook::RoundStart => StatusTriggerHook::RoundStart,
        LifecycleTriggerHook::TurnStart => StatusTriggerHook::TurnStart,
        LifecycleTriggerHook::BeforeAction => StatusTriggerHook::BeforeAction,
        LifecycleTriggerHook::AfterAction => StatusTriggerHook::AfterAction,
        LifecycleTriggerHook::BeforeRoll => StatusTriggerHook::BeforeRoll,
        LifecycleTriggerHook::AfterRoll => StatusTriggerHook::AfterRoll,
        LifecycleTriggerHook::BeforeDamage => StatusTriggerHook::BeforeDamage,
        LifecycleTriggerHook::BeforeStatusApply => StatusTriggerHook::BeforeStatusApply,
        LifecycleTriggerHook::TurnEnd => StatusTriggerHook::TurnEnd,
        LifecycleTriggerHook::RoundEnd => StatusTriggerHook::RoundEnd,
        LifecycleTriggerHook::BattleEnd => StatusTriggerHook::BattleEnd,
    }
}

const fn calculated_hook(hook: CalculatedTriggerHook) -> StatusTriggerHook {
    match hook {
        CalculatedTriggerHook::HitConfirmed => StatusTriggerHook::HitConfirmed,
        CalculatedTriggerHook::MissConfirmed => StatusTriggerHook::MissConfirmed,
        CalculatedTriggerHook::CriticalConfirmed => StatusTriggerHook::CriticalConfirmed,
    }
}

const fn hook_id(hook: StatusTriggerHook) -> &'static str {
    match hook {
        StatusTriggerHook::BattleStart => "BATTLE_START",
        StatusTriggerHook::RoundStart => "ROUND_START",
        StatusTriggerHook::TurnStart => "TURN_START",
        StatusTriggerHook::BeforeAction => "BEFORE_ACTION",
        StatusTriggerHook::AfterAction => "AFTER_ACTION",
        StatusTriggerHook::BeforeRoll => "BEFORE_ROLL",
        StatusTriggerHook::AfterRoll => "AFTER_ROLL",
        StatusTriggerHook::HitConfirmed => "HIT_CONFIRMED",
        StatusTriggerHook::MissConfirmed => "MISS_CONFIRMED",
        StatusTriggerHook::CriticalConfirmed => "CRITICAL_CONFIRMED",
        StatusTriggerHook::BeforeDamage => "BEFORE_DAMAGE",
        StatusTriggerHook::BeforeStatusApply => "BEFORE_STATUS_APPLY",
        StatusTriggerHook::DamageApplied => "DAMAGE_APPLIED",
        StatusTriggerHook::StatusApplied => "STATUS_APPLIED",
        StatusTriggerHook::StatusRemoved => "STATUS_REMOVED",
        StatusTriggerHook::TargetDefeated => "TARGET_DEFEATED",
        StatusTriggerHook::OnKill => "ON_KILL",
        StatusTriggerHook::TurnEnd => "TURN_END",
        StatusTriggerHook::RoundEnd => "ROUND_END",
        StatusTriggerHook::BattleEnd => "BATTLE_END",
    }
}

fn pipeline_error(
    code: TriggerPipelineErrorCode,
    subject_id: impl Into<String>,
) -> TriggerPipelineError {
    TriggerPipelineError {
        code,
        subject_id: subject_id.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AbilityUsageState, CURRENT_COMBAT_VERSIONS, CURRENT_STATUS_SCHEMA_VERSION, CombatPhase,
        CombatRng, CombatSide, CombatantRuntime, CombatantState, ControlCategory, DurationClock,
        EffectAmount, GameplayTagId, ObjectiveRuntimeState, ProvisionalRuntimeDelta,
        ReinforcementRuntimeState, RoundRuntimeState, StatusActivationPolicy,
        StatusDurationDefinition, StatusExpiryPhase, StatusRefreshPolicy, StatusStackMode,
        StatusTickPhase, TimelineEntry,
    };

    const SEED: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn typed_hook_collects_only_matching_triggers_in_canonical_order() {
        let mut state = fixture_state();
        state.combatants[0].statuses = vec![runtime("instance-a", "status-a", 1)];
        state.combatants[1].statuses = vec![runtime("instance-b", "status-b", 1)];
        let definitions = vec![
            definition(
                "status-b",
                vec![trigger("b", StatusTriggerHook::TurnStart, 5)],
            ),
            definition(
                "status-a",
                vec![
                    trigger("ignored", StatusTriggerHook::RoundStart, 99),
                    trigger("a", StatusTriggerHook::TurnStart, 5),
                ],
            ),
        ];
        begin(&mut state);

        let items = CanonicalTriggerPipeline::enqueue_roots(
            &mut state,
            &definitions,
            &TriggerSignal::Lifecycle(LifecycleTriggerHook::TurnStart),
        )
        .unwrap();

        assert_eq!(items.len(), 2);
        assert_eq!(items[0].source_stable_id, "actor-a");
        assert_eq!(items[1].source_stable_id, "actor-b");
        assert!(
            items.iter().all(|item| {
                item.kind == SchedulerItemKind::Trigger && item.phase_priority == 300
            })
        );
    }

    #[test]
    fn calculated_and_committed_hooks_are_separate_and_invalid_fact_is_atomic() {
        let mut state = fixture_state();
        state.combatants[0].statuses = vec![runtime("instance-a", "status-a", 1)];
        let definition = definition(
            "status-a",
            vec![
                trigger("hit", StatusTriggerHook::HitConfirmed, 1),
                trigger("damage", StatusTriggerHook::DamageApplied, 1),
            ],
        );
        begin(&mut state);
        let hit = CanonicalTriggerPipeline::enqueue_roots(
            &mut state,
            std::slice::from_ref(&definition),
            &TriggerSignal::Calculated(CalculatedTriggerHook::HitConfirmed),
        )
        .unwrap();
        assert_eq!(hit.len(), 1);
        drain_one(&mut state);

        let before = state.clone();
        let error = CanonicalTriggerPipeline::enqueue_roots(
            &mut state,
            &[definition],
            &TriggerSignal::Committed(CommittedTriggerEvent::DamageApplied {
                target_combatant_id: "actor-b".into(),
                event_chain_id: "chain-1".into(),
                committed_sequence: 0,
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, TriggerPipelineErrorCode::InvalidSignal);
        assert_eq!(state, before);
    }

    #[test]
    fn on_kill_is_derived_only_for_the_committed_causal_source() {
        let mut state = fixture_state();
        for (index, combatant) in state.combatants.iter_mut().enumerate() {
            combatant.statuses = vec![runtime(
                &format!("instance-{index}"),
                &format!("status-{index}"),
                1,
            )];
        }
        let triggers = |prefix: &str| {
            vec![
                trigger(
                    &format!("{prefix}-defeat"),
                    StatusTriggerHook::TargetDefeated,
                    1,
                ),
                trigger(&format!("{prefix}-kill"), StatusTriggerHook::OnKill, 1),
            ]
        };
        let definitions = vec![
            definition("status-0", triggers("a")),
            definition("status-1", triggers("b")),
        ];
        state.last_committed_sequence = 1;
        begin(&mut state);
        let items = CanonicalTriggerPipeline::enqueue_roots(
            &mut state,
            &definitions,
            &TriggerSignal::Committed(CommittedTriggerEvent::TargetDefeated(TargetDefeatedFact {
                target_combatant_id: "actor-b".into(),
                source_combatant_id: Some("actor-a".into()),
                source_command_id: Some("command-1".into()),
                event_chain_id: "chain-1".into(),
                committed_sequence: 1,
            })),
        )
        .unwrap();
        assert_eq!(items.len(), 3);
        assert_eq!(
            items
                .iter()
                .filter(|item| item.source_stable_id == "actor-a")
                .count(),
            2
        );
        assert_eq!(
            items
                .iter()
                .filter(|item| item.source_stable_id == "actor-b")
                .count(),
            1
        );
    }

    #[test]
    fn effects_are_released_only_after_dequeue_legality_and_loop_guard_gate() {
        let mut state = fixture_state();
        state.combatants[0].statuses = vec![runtime("instance-a", "status-a", 1)];
        let definitions = vec![definition(
            "status-a",
            vec![trigger("turn", StatusTriggerHook::TurnStart, 1)],
        )];
        begin(&mut state);
        CanonicalTriggerPipeline::enqueue_roots(
            &mut state,
            &definitions,
            &TriggerSignal::Lifecycle(LifecycleTriggerHook::TurnStart),
        )
        .unwrap();
        CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();

        let TriggerDispatchOutcome::ReadyToExecute(permit) =
            CanonicalTriggerPipeline::gate_current(&mut state, &definitions).unwrap()
        else {
            panic!("expected execution permit")
        };
        assert_eq!(permit.trigger_id, "turn");
        assert_eq!(permit.effects.len(), 1);
        assert!(!permit.resumed);
        assert_eq!(state.scheduler.as_ref().unwrap().executed_event_count, 1);
    }

    #[test]
    fn dequeue_recheck_skips_a_status_removed_by_an_earlier_item_without_counting() {
        let mut state = fixture_state();
        state.combatants[0].statuses = vec![runtime("instance-a", "status-a", 1)];
        let definitions = vec![definition(
            "status-a",
            vec![trigger("turn", StatusTriggerHook::TurnStart, 1)],
        )];
        begin(&mut state);
        CanonicalTriggerPipeline::enqueue_roots(
            &mut state,
            &definitions,
            &TriggerSignal::Lifecycle(LifecycleTriggerHook::TurnStart),
        )
        .unwrap();
        let queued = CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();
        state.combatants[0].statuses.clear();

        assert_eq!(
            CanonicalTriggerPipeline::gate_current(&mut state, &definitions).unwrap(),
            TriggerDispatchOutcome::Skipped { item: queued }
        );
        assert_eq!(state.scheduler.as_ref().unwrap().executed_event_count, 0);
    }

    #[test]
    fn child_signal_reuses_the_same_queue_and_resume_preserves_execution_count() {
        let mut state = fixture_state();
        state.combatants[0].statuses = vec![runtime("instance-a", "status-a", 1)];
        let definitions = vec![definition(
            "status-a",
            vec![
                trigger("turn", StatusTriggerHook::TurnStart, 1),
                trigger("damage", StatusTriggerHook::DamageApplied, 2),
            ],
        )];
        begin(&mut state);
        CanonicalTriggerPipeline::enqueue_roots(
            &mut state,
            &definitions,
            &TriggerSignal::Lifecycle(LifecycleTriggerHook::TurnStart),
        )
        .unwrap();
        CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();
        CanonicalTriggerPipeline::gate_current(&mut state, &definitions).unwrap();
        state.last_committed_sequence = 1;
        let children = CanonicalTriggerPipeline::complete_current_with_children(
            &mut state,
            &definitions,
            &TriggerSignal::Committed(CommittedTriggerEvent::DamageApplied {
                target_combatant_id: "actor-b".into(),
                event_chain_id: "chain-1".into(),
                committed_sequence: 1,
            }),
        )
        .unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].depth, 2);

        CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();
        CanonicalTriggerPipeline::gate_current(&mut state, &definitions).unwrap();
        let restored = state.snapshot().unwrap().verify_and_restore().unwrap();
        state = restored;
        let TriggerDispatchOutcome::ReadyToExecute(permit) =
            CanonicalTriggerPipeline::gate_current(&mut state, &definitions).unwrap()
        else {
            panic!("expected resumed permit")
        };
        assert!(permit.resumed);
        assert_eq!(permit.item.depth, 2);
        assert_eq!(state.scheduler.as_ref().unwrap().executed_event_count, 2);
    }

    #[test]
    fn trigger_pipeline_returns_engine_failure_instead_of_effects_on_overflow() {
        let mut state = fixture_state();
        state.combatants[0].statuses = vec![runtime("instance-a", "status-a", 1)];
        let definitions = vec![definition(
            "status-a",
            vec![trigger("turn", StatusTriggerHook::TurnStart, 1)],
        )];
        CanonicalEventChainScheduler::begin(&mut state, "chain-1".into(), 32, 0).unwrap();
        CanonicalTriggerPipeline::enqueue_roots(
            &mut state,
            &definitions,
            &TriggerSignal::Lifecycle(LifecycleTriggerHook::TurnStart),
        )
        .unwrap();
        CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();

        assert!(matches!(
            CanonicalTriggerPipeline::gate_current(&mut state, &definitions).unwrap(),
            TriggerDispatchOutcome::EngineFailure(_)
        ));
        assert_eq!(state.scheduler.as_ref().unwrap().executed_event_count, 0);
        assert_eq!(
            state.confirmed_result,
            Some(crate::CombatResultType::Aborted)
        );
    }

    #[test]
    fn trigger_gate_rejects_other_scheduler_kinds_without_mutation() {
        let mut state = fixture_state();
        begin(&mut state);
        CanonicalEventChainScheduler::enqueue_roots(
            &mut state,
            vec![SchedulerCandidate {
                kind: SchedulerItemKind::Reaction,
                phase_priority: 300,
                explicit_priority: 1,
                source_stable_id: "actor-a".into(),
                effect_stable_id: "reaction-a".into(),
            }],
        )
        .unwrap();
        CanonicalEventChainScheduler::dequeue_next(&mut state)
            .unwrap()
            .unwrap();
        let before = state.clone();

        let error = CanonicalTriggerPipeline::gate_current(&mut state, &[]).unwrap_err();
        assert_eq!(error.code, TriggerPipelineErrorCode::WrongSchedulerItemKind);
        assert_eq!(state, before);
    }

    fn begin(state: &mut CombatState) {
        CanonicalEventChainScheduler::begin(state, "chain-1".into(), 32, 256).unwrap();
    }

    fn drain_one(state: &mut CombatState) {
        CanonicalEventChainScheduler::dequeue_next(state)
            .unwrap()
            .unwrap();
        CanonicalTriggerPipeline::gate_current(state, &definitions_for_state(state)).unwrap();
        CanonicalEventChainScheduler::complete_current(state).unwrap();
    }

    fn definitions_for_state(state: &CombatState) -> Vec<StatusDefinition> {
        state
            .combatants
            .iter()
            .flat_map(|combatant| &combatant.statuses)
            .map(|status| {
                definition(
                    &status.status_definition_id,
                    vec![trigger("hit", StatusTriggerHook::HitConfirmed, 1)],
                )
            })
            .collect()
    }

    fn trigger(id: &str, hook: StatusTriggerHook, priority: i32) -> StatusTriggerDefinition {
        StatusTriggerDefinition {
            trigger_id: id.into(),
            hook,
            priority,
            effects: vec![EffectDefinition::Heal {
                amount: EffectAmount::Flat { amount: 1 },
            }],
        }
    }

    fn definition(id: &str, mut triggers: Vec<StatusTriggerDefinition>) -> StatusDefinition {
        triggers.sort_by(|left, right| left.trigger_id.cmp(&right.trigger_id));
        StatusDefinition {
            status_schema_version: CURRENT_STATUS_SCHEMA_VERSION,
            status_definition_id: id.into(),
            tags: Vec::<GameplayTagId>::new(),
            stack_group_id: id.into(),
            stack_mode: StatusStackMode::Add,
            max_stacks: 3,
            duration: StatusDurationDefinition {
                clock: DurationClock::OwnerTurn,
                duration: Some(2),
                activation_policy: StatusActivationPolicy::NextClock,
                expiry_phase: StatusExpiryPhase::OwnerTurnEnd,
            },
            refresh_policy: StatusRefreshPolicy::RefreshDuration,
            priority: 0,
            control_category: ControlCategory::None,
            tick_phase: StatusTickPhase::None,
            dispel_tags: vec![],
            immunity_tags: vec![],
            effects: vec![],
            triggers,
            strength_rank: None,
        }
    }

    fn runtime(instance_id: &str, definition_id: &str, sequence: u64) -> StatusRuntime {
        StatusRuntime {
            status_schema_version: CURRENT_STATUS_SCHEMA_VERSION,
            status_instance_id: instance_id.into(),
            status_definition_id: definition_id.into(),
            source_combatant_id: Some("actor-a".into()),
            stack_group_id: definition_id.into(),
            stack_count: 1,
            remaining_duration: Some(2),
            duration_clock: DurationClock::OwnerTurn,
            application_sequence: sequence,
            activation_clock_index: 1,
            applied_round_index: 1,
            applied_owner_turn_index: Some(0),
            tick_eligible_clock_index: 1,
            last_duration_advanced_clock_index: None,
            strength_rank: None,
        }
    }

    fn fixture_state() -> CombatState {
        let combatant = |id: &str| CombatantRuntime {
            combatant_id: id.into(),
            definition_id: format!("definition-{id}"),
            side: CombatSide::Player,
            state: CombatantState::Active,
            hit_points: 10,
            max_hit_points: 10,
            shield: 0,
            max_shield: 0,
            action_points: 3,
            max_action_points: 3,
            reaction_charges: 1,
            max_reaction_charges: 1,
            resources: vec![],
            statuses: vec![],
            ability_usage: vec![AbilityUsageState {
                ability_id: "ability-a".into(),
                cooldown_remaining: 0,
                uses_this_normal_owner_turn: 0,
                uses_this_battle: 0,
            }],
            basic_attack_count_this_normal_owner_turn: 0,
            once_usage_counters: vec![],
            normal_owner_turn_index: 0,
            hard_cc_dr: crate::HardCcDrRuntime::default(),
            initiative_result: 10,
            initiative_base_stat: 2,
            last_committed_timeline_order: None,
            solo_recovery_available: false,
        };
        CombatState {
            combat_instance_id: "combat-trigger-fixture".into(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.into(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::Action,
            combatants: vec![combatant("actor-a"), combatant("actor-b")],
            formal_party_member_ids: vec![],
            combat_inventory: vec![],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![
                TimelineEntry {
                    combatant_id: "actor-a".into(),
                    initiative_result: 10,
                    initiative_base_stat: 2,
                    is_extra_turn: false,
                    source_sequence: 1,
                },
                TimelineEntry {
                    combatant_id: "actor-b".into(),
                    initiative_result: 9,
                    initiative_base_stat: 2,
                    is_extra_turn: false,
                    source_sequence: 2,
                },
            ],
            round: RoundRuntimeState {
                round_number: 1,
                completed_round_count: 0,
                active_combatant_id: Some("actor-a".into()),
                extra_turn_resume_phase: None,
                roster: vec![crate::RoundRosterEntry {
                    combatant_id: "actor-a".into(),
                    normal_turn_slot: 0,
                    status: crate::RoundRosterStatus::Pending,
                }],
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
            terminal_priority_policy: crate::TerminalPriorityPolicy::default(),
            confirmed_result_candidate_id: None,
            confirmed_result: None,
            rng: CombatRng::new(
                SEED,
                "combat-trigger-fixture",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }
}
