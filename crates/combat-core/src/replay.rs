use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    AcceptedCombatCommand, AcceptedCommandLedger, CombatResultType, CombatRng, CombatRngSnapshot,
    CombatState, CombatVersionSet, RngChannel,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatReplayInput {
    pub versions: CombatVersionSet,
    pub random_seed: String,
    pub initial_state: CombatState,
    pub accepted_commands: Vec<AcceptedCombatCommand>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatReplayRoll {
    pub roll_id: String,
    pub channel: RngChannel,
    pub sides: u32,
    pub value: u32,
    pub cursor_after: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatReplaySchedulerExecution {
    pub event_chain_id: String,
    pub sequence: u64,
    pub depth: u32,
    pub source_stable_id: String,
    pub effect_stable_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatReplayStepTrace {
    pub rolls: Vec<CombatReplayRoll>,
    pub scheduler_executions: Vec<CombatReplaySchedulerExecution>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatReplayReceipt {
    pub versions: CombatVersionSet,
    pub combat_instance_id: String,
    pub random_seed: String,
    pub initial_state_hash: String,
    pub accepted_command_count: u64,
    pub accepted_commands_digest: String,
    pub step_traces: Vec<CombatReplayStepTrace>,
    pub trace_digest: String,
    pub final_rng: CombatRngSnapshot,
    pub combat_result: Option<CombatResultType>,
    pub final_state_hash: String,
    pub final_state: CombatState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CombatReplayErrorCode {
    InvalidInput,
    IncompatibleVersion,
    InvalidAcceptedHistory,
    ExecutorFailed,
    InvalidStepTrace,
    StateIdentityDrift,
    StateInvariantViolation,
    Serialization,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CombatReplayError {
    pub code: CombatReplayErrorCode,
    pub accepted_sequence: Option<u64>,
    pub subject: String,
}

impl fmt::Display for CombatReplayError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "combat replay failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for CombatReplayError {}

pub struct CombatReplayRunner;

impl CombatReplayRunner {
    /// Replays only the persisted accepted sequence. The caller supplies the
    /// canonical command executor used by live combat; the runner owns history,
    /// identity, RNG-consumption and post-step invariant verification.
    pub fn run<E, F>(
        input: CombatReplayInput,
        mut execute: F,
    ) -> Result<CombatReplayReceipt, CombatReplayError>
    where
        E: fmt::Display,
        F: FnMut(
            &mut CombatState,
            &AcceptedCombatCommand,
            &AcceptedCommandLedger,
        ) -> Result<CombatReplayStepTrace, E>,
    {
        validate_input(&input)?;
        let full_ledger =
            AcceptedCommandLedger::restore(input.accepted_commands.clone()).map_err(|_| {
                replay_error(
                    CombatReplayErrorCode::InvalidAcceptedHistory,
                    None,
                    "acceptedCommands",
                )
            })?;
        let initial_state_hash = input.initial_state.state_hash_sha256().map_err(|_| {
            replay_error(CombatReplayErrorCode::Serialization, None, "initialState")
        })?;
        let accepted_commands_json =
            serde_json::to_vec(&input.accepted_commands).map_err(|_| {
                replay_error(
                    CombatReplayErrorCode::Serialization,
                    None,
                    "acceptedCommands",
                )
            })?;
        let accepted_commands_digest = digest(&accepted_commands_json);
        let mut state = input.initial_state.clone();
        let mut step_traces = Vec::with_capacity(input.accepted_commands.len());

        for (index, command) in input.accepted_commands.iter().enumerate() {
            let sequence = Some(command.accepted_sequence);
            let envelope = command.replay_envelope();
            full_ledger
                .validate_replay(command, &envelope)
                .map_err(|_| {
                    replay_error(
                        CombatReplayErrorCode::InvalidAcceptedHistory,
                        sequence,
                        &command.command_id,
                    )
                })?;
            let visible_ledger = AcceptedCommandLedger::restore(
                input.accepted_commands[..index].to_vec(),
            )
            .map_err(|_| {
                replay_error(
                    CombatReplayErrorCode::InvalidAcceptedHistory,
                    sequence,
                    &command.command_id,
                )
            })?;
            let rng_before = state.rng.clone();
            let scheduler_before = state.scheduler.clone();
            let trace = execute(&mut state, command, &visible_ledger).map_err(|error| {
                replay_error(
                    CombatReplayErrorCode::ExecutorFailed,
                    sequence,
                    error.to_string(),
                )
            })?;
            validate_post_step(
                &input,
                command,
                &rng_before,
                &scheduler_before,
                &state,
                &trace,
            )?;
            step_traces.push(trace);
        }

        let trace_json = serde_json::to_vec(&step_traces)
            .map_err(|_| replay_error(CombatReplayErrorCode::Serialization, None, "stepTraces"))?;
        let final_state_hash = state
            .state_hash_sha256()
            .map_err(|_| replay_error(CombatReplayErrorCode::Serialization, None, "finalState"))?;
        Ok(CombatReplayReceipt {
            versions: input.versions,
            combat_instance_id: state.combat_instance_id.clone(),
            random_seed: input.random_seed,
            initial_state_hash,
            accepted_command_count: input.accepted_commands.len() as u64,
            accepted_commands_digest,
            trace_digest: digest(&trace_json),
            step_traces,
            final_rng: state.rng.clone(),
            combat_result: state.confirmed_result,
            final_state_hash,
            final_state: state,
        })
    }
}

fn validate_input(input: &CombatReplayInput) -> Result<(), CombatReplayError> {
    input
        .versions
        .ensure_supported()
        .map_err(|_| replay_error(CombatReplayErrorCode::IncompatibleVersion, None, "versions"))?;
    if input.random_seed != input.initial_state.random_seed
        || input.versions != input.initial_state.versions
        || input.initial_state.combat_instance_id.is_empty()
    {
        return Err(replay_error(
            CombatReplayErrorCode::InvalidInput,
            None,
            "initialState",
        ));
    }
    validate_state(&input.initial_state, None)
}

fn validate_post_step(
    input: &CombatReplayInput,
    command: &AcceptedCombatCommand,
    rng_before: &CombatRngSnapshot,
    scheduler_before: &Option<crate::EventSchedulerCheckpoint>,
    state: &CombatState,
    trace: &CombatReplayStepTrace,
) -> Result<(), CombatReplayError> {
    let sequence = Some(command.accepted_sequence);
    if command.versions != input.versions
        || state.versions != input.versions
        || state.random_seed != input.random_seed
        || state.combat_instance_id != input.initial_state.combat_instance_id
    {
        return Err(replay_error(
            CombatReplayErrorCode::StateIdentityDrift,
            sequence,
            &command.command_id,
        ));
    }
    validate_state(state, sequence)?;
    validate_rolls(rng_before, &state.rng, &trace.rolls, sequence)?;
    let mut scheduler_keys = Vec::with_capacity(trace.scheduler_executions.len());
    for execution in &trace.scheduler_executions {
        if execution.event_chain_id.is_empty()
            || execution.sequence == 0
            || execution.depth == 0
            || execution.source_stable_id.is_empty()
            || execution.effect_stable_id.is_empty()
        {
            return Err(replay_error(
                CombatReplayErrorCode::InvalidStepTrace,
                sequence,
                "schedulerExecution",
            ));
        }
        let key = (&execution.event_chain_id, execution.sequence);
        if scheduler_keys.contains(&key) {
            return Err(replay_error(
                CombatReplayErrorCode::InvalidStepTrace,
                sequence,
                "schedulerExecution",
            ));
        }
        scheduler_keys.push(key);
    }
    if let Some(after) = &state.scheduler {
        let before_count = scheduler_before
            .as_ref()
            .filter(|before| before.event_chain_id == after.event_chain_id)
            .map_or(0, |before| before.executed_event_count);
        let executed_delta = after
            .executed_event_count
            .checked_sub(before_count)
            .ok_or_else(|| {
                replay_error(
                    CombatReplayErrorCode::InvalidStepTrace,
                    sequence,
                    "schedulerCounter",
                )
            })?;
        let traced_count = trace
            .scheduler_executions
            .iter()
            .filter(|execution| execution.event_chain_id == after.event_chain_id)
            .count() as u64;
        if executed_delta != traced_count {
            return Err(replay_error(
                CombatReplayErrorCode::InvalidStepTrace,
                sequence,
                "schedulerCounter",
            ));
        }
    }
    Ok(())
}

fn validate_rolls(
    before: &CombatRngSnapshot,
    after: &CombatRngSnapshot,
    rolls: &[CombatReplayRoll],
    sequence: Option<u64>,
) -> Result<(), CombatReplayError> {
    CombatRng::restore(after.clone())
        .map_err(|_| replay_error(CombatReplayErrorCode::InvalidStepTrace, sequence, "rng"))?;
    for channel in RngChannel::ALL {
        let before_cursor = before
            .streams
            .iter()
            .find(|stream| stream.channel_id == channel)
            .ok_or_else(|| replay_error(CombatReplayErrorCode::InvalidStepTrace, sequence, "rng"))?
            .cursor;
        let after_cursor = after
            .streams
            .iter()
            .find(|stream| stream.channel_id == channel)
            .ok_or_else(|| replay_error(CombatReplayErrorCode::InvalidStepTrace, sequence, "rng"))?
            .cursor;
        let channel_rolls = rolls
            .iter()
            .filter(|roll| roll.channel == channel)
            .collect::<Vec<_>>();
        let expected = after_cursor.checked_sub(before_cursor).ok_or_else(|| {
            replay_error(
                CombatReplayErrorCode::InvalidStepTrace,
                sequence,
                channel.id(),
            )
        })?;
        if expected != channel_rolls.len() as u64 {
            return Err(replay_error(
                CombatReplayErrorCode::InvalidStepTrace,
                sequence,
                channel.id(),
            ));
        }
        for (offset, roll) in channel_rolls.into_iter().enumerate() {
            if roll.roll_id.is_empty()
                || roll.sides == 0
                || roll.value == 0
                || roll.value > roll.sides
                || roll.cursor_after != before_cursor + offset as u64 + 1
            {
                return Err(replay_error(
                    CombatReplayErrorCode::InvalidStepTrace,
                    sequence,
                    channel.id(),
                ));
            }
        }
    }
    Ok(())
}

fn validate_state(state: &CombatState, sequence: Option<u64>) -> Result<(), CombatReplayError> {
    state.validate_for_commit().map_err(|_| {
        replay_error(
            CombatReplayErrorCode::StateInvariantViolation,
            sequence,
            "combatState",
        )
    })?;
    CombatRng::restore(state.rng.clone()).map_err(|_| {
        replay_error(
            CombatReplayErrorCode::StateInvariantViolation,
            sequence,
            "rng",
        )
    })?;
    Ok(())
}

fn replay_error(
    code: CombatReplayErrorCode,
    accepted_sequence: Option<u64>,
    subject: impl Into<String>,
) -> CombatReplayError {
    CombatReplayError {
        code,
        accepted_sequence,
        subject: subject.into(),
    }
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::*;

    const SEED: &str = "8899aabbccddeeff0011223344556677";

    #[test]
    fn same_fixture_replays_roll_scheduler_ai_command_result_and_final_hash() {
        let input = fixture_input();
        let first = CombatReplayRunner::run(input.clone(), execute_fixture).unwrap();
        let second = CombatReplayRunner::run(input, execute_fixture).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.combat_result, Some(CombatResultType::Aborted));
        assert_eq!(first.accepted_command_count, 2);
        assert_eq!(first.step_traces[0].rolls.len(), 1);
        assert_eq!(first.step_traces[0].scheduler_executions.len(), 1);
        assert_eq!(first.final_rng.streams[1].cursor, 1);
        assert_eq!(first.final_state_hash, second.final_state_hash);
        assert_eq!(first.trace_digest, second.trace_digest);
    }

    #[test]
    fn replay_rejects_unreported_rng_consumption_and_identity_drift() {
        let input = fixture_input();
        let missing_roll = CombatReplayRunner::run(input.clone(), |state, command, ledger| {
            let mut trace = execute_fixture(state, command, ledger)?;
            trace.rolls.clear();
            Ok::<_, &'static str>(trace)
        });
        assert_eq!(
            missing_roll.unwrap_err().code,
            CombatReplayErrorCode::InvalidStepTrace
        );

        let drift = CombatReplayRunner::run(input, |state, _command, _ledger| {
            state.random_seed = "00112233445566778899aabbccddeeff".into();
            Ok::<_, &'static str>(CombatReplayStepTrace {
                rolls: vec![],
                scheduler_executions: vec![],
            })
        });
        assert_eq!(
            drift.unwrap_err().code,
            CombatReplayErrorCode::StateIdentityDrift
        );
    }

    #[test]
    fn accepted_reaction_decision_replays_the_same_suspended_context() {
        let initial = fixture_state();
        let mut ledger = AcceptedCommandLedger::new();
        let opening = ledger
            .accept_external(CombatCommandEnvelope {
                command_id: "reaction-source-command".into(),
                source: CombatCommandSource::Player {
                    controller_id: "controller".into(),
                },
                actor_id: "hero".into(),
                versions: CURRENT_COMBAT_VERSIONS,
                payload: CombatCommandPayload::UseAbility {
                    ability_id: "ability-attack".into(),
                    target_id: Some("enemy".into()),
                },
            })
            .unwrap()
            .command;
        let mut scratch = initial.clone();
        open_reaction(&mut scratch, &opening).unwrap();
        let window_id = scratch.pending_reaction.as_ref().unwrap().window_id.clone();
        ledger
            .accept_external(CombatCommandEnvelope {
                command_id: "reaction-decision-command".into(),
                source: CombatCommandSource::Player {
                    controller_id: "controller".into(),
                },
                actor_id: "hero".into(),
                versions: CURRENT_COMBAT_VERSIONS,
                payload: CombatCommandPayload::ResolveReaction {
                    reaction_window_id: window_id,
                    choice: ReactionDecisionChoice::Trigger,
                    selected_reaction_id: Some("reaction-ask".into()),
                },
            })
            .unwrap();
        let input = CombatReplayInput {
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.into(),
            initial_state: initial,
            accepted_commands: ledger.commands().to_vec(),
        };
        let run = || {
            CombatReplayRunner::run(input.clone(), |state, command, visible| {
                if command.accepted_sequence == 1 {
                    open_reaction(state, command)
                } else {
                    let mut replay_ledger = visible.clone();
                    let outcome = CanonicalReactionCore::resolve_ask_window(
                        state,
                        &mut replay_ledger,
                        external_envelope(command),
                        &reaction_bindings(),
                        &assignments(),
                    )
                    .map_err(|_| "resolve")?;
                    assert_eq!(outcome.status, ReactionDecisionStatus::AcceptedTrigger);
                    let item = outcome.permit.as_ref().ok_or("permit")?.item.clone();
                    Ok(CombatReplayStepTrace {
                        rolls: vec![],
                        scheduler_executions: vec![CombatReplaySchedulerExecution {
                            event_chain_id: item.event_chain_id,
                            sequence: item.sequence,
                            depth: item.depth,
                            source_stable_id: item.source_stable_id,
                            effect_stable_id: item.effect_stable_id,
                        }],
                    })
                }
            })
        };
        let first = run().unwrap();
        let second = run().unwrap();
        assert_eq!(first.final_state_hash, second.final_state_hash);
        assert_eq!(first.trace_digest, second.trace_digest);
        assert_eq!(
            first.final_state.pending_reaction.as_ref().unwrap().status,
            ReactionWindowStatus::ResolvedTrigger
        );
        assert!(
            first
                .final_state
                .resolution_context
                .as_ref()
                .unwrap()
                .suspensions[0]
                .resumed
        );
    }

    fn open_reaction(
        state: &mut CombatState,
        command: &AcceptedCombatCommand,
    ) -> Result<CombatReplayStepTrace, &'static str> {
        ResolutionContextLifecycle::create(state, command.clone(), "reaction-chain".into(), None)
            .map_err(|_| "context")?;
        for (from, to) in [
            (HookPhase::PreAction, HookPhase::BeforeRoll),
            (HookPhase::BeforeRoll, HookPhase::AfterRoll),
            (HookPhase::AfterRoll, HookPhase::Outcome),
            (HookPhase::Outcome, HookPhase::PreEffect),
        ] {
            ResolutionContextLifecycle::complete_hook(state, from, to).map_err(|_| "hook")?;
        }
        CanonicalEventChainScheduler::begin(state, "reaction-chain".into(), 32, 256)
            .map_err(|_| "begin")?;
        CanonicalReactionCore::enqueue_roots(state, &reaction_bindings()).map_err(|_| "enqueue")?;
        CanonicalEventChainScheduler::dequeue_next(state)
            .map_err(|_| "dequeue")?
            .ok_or("item")?;
        assert!(matches!(
            CanonicalReactionCore::route_current(state, &reaction_bindings(), &assignments(), None)
                .map_err(|_| "route")?,
            ReactionRouteOutcome::AskWindowOpened(_)
        ));
        Ok(CombatReplayStepTrace {
            rolls: vec![],
            scheduler_executions: vec![],
        })
    }

    fn reaction_bindings() -> Vec<ReactionBinding> {
        vec![ReactionBinding {
            owner_combatant_id: "hero".into(),
            definition: ReactionDefinition {
                reaction_schema_version: CURRENT_REACTION_SCHEMA_VERSION,
                reaction_id: "reaction-ask".into(),
                hook_phase: HookPhase::PreEffect,
                priority: 10,
                mode: ReactionExecutionMode::Ask,
                costs: vec![CombatCostRequestLine {
                    cost_id: "reaction-charge".into(),
                    asset: CombatCostAsset::ReactionCharge {
                        combatant_id: "hero".into(),
                    },
                    amount: 1,
                    consume_cost_on_interrupt: false,
                }],
                effects: vec![EffectDefinition::Heal {
                    amount: EffectAmount::Flat { amount: 1 },
                }],
            },
        }]
    }

    fn assignments() -> Vec<CombatControlAssignment> {
        vec![
            CombatControlAssignment {
                combatant_id: "hero".into(),
                authority: CombatControlAuthority::Player {
                    controller_id: "controller".into(),
                },
            },
            CombatControlAssignment {
                combatant_id: "companion".into(),
                authority: CombatControlAuthority::UtilityAi,
            },
        ]
    }

    fn external_envelope(command: &AcceptedCombatCommand) -> CombatCommandEnvelope {
        let source = match &command.source {
            AcceptedCommandSource::Player { controller_id } => CombatCommandSource::Player {
                controller_id: controller_id.clone(),
            },
            AcceptedCommandSource::UtilityAi => CombatCommandSource::UtilityAi,
            AcceptedCommandSource::Test { test_case_id } => CombatCommandSource::Test {
                test_case_id: test_case_id.clone(),
            },
        };
        CombatCommandEnvelope {
            command_id: command.command_id.clone(),
            source,
            actor_id: command.actor_id.clone(),
            versions: command.versions,
            payload: command.payload.clone(),
        }
    }

    fn execute_fixture(
        state: &mut CombatState,
        command: &AcceptedCombatCommand,
        visible_ledger: &AcceptedCommandLedger,
    ) -> Result<CombatReplayStepTrace, &'static str> {
        match command.accepted_sequence {
            1 => {
                assert_eq!(command.source, AcceptedCommandSource::UtilityAi);
                let mut rng = CombatRng::restore(state.rng.clone()).map_err(|_| "rng")?;
                let value = rng
                    .roll_die(RngChannel::Resolution, 20)
                    .map_err(|_| "roll")?;
                state.rng = rng.snapshot();
                let cursor_after = state.rng.streams[1].cursor;
                CanonicalEventChainScheduler::begin(state, "replay-chain".into(), 32, 1)
                    .map_err(|_| "begin")?;
                CanonicalEventChainScheduler::enqueue_roots(
                    state,
                    vec![candidate("utility-effect-a")],
                )
                .map_err(|_| "enqueue")?;
                let item = CanonicalEventChainScheduler::dequeue_next(state)
                    .map_err(|_| "dequeue")?
                    .ok_or("item")?;
                assert!(matches!(
                    CanonicalEventChainScheduler::gate_current_for_execution(state, true)
                        .map_err(|_| "gate")?,
                    SchedulerExecutionGateOutcome::ReadyToExecute { resumed: false, .. }
                ));
                CanonicalEventChainScheduler::complete_current(state).map_err(|_| "complete")?;
                Ok(CombatReplayStepTrace {
                    rolls: vec![CombatReplayRoll {
                        roll_id: "utility-attack-roll".into(),
                        channel: RngChannel::Resolution,
                        sides: 20,
                        value,
                        cursor_after,
                    }],
                    scheduler_executions: vec![CombatReplaySchedulerExecution {
                        event_chain_id: item.event_chain_id,
                        sequence: item.sequence,
                        depth: item.depth,
                        source_stable_id: item.source_stable_id,
                        effect_stable_id: item.effect_stable_id,
                    }],
                })
            }
            2 => {
                assert!(matches!(
                    command.payload,
                    CombatCommandPayload::SetTacticalStrategy { .. }
                ));
                let mut applied = visible_ledger.commands().to_vec();
                applied.push(command.clone());
                let applied = AcceptedCommandLedger::restore(applied).map_err(|_| "history")?;
                let projection =
                    TacticalSettingsProjection::project(state, &applied).map_err(|_| "tactical")?;
                assert_eq!(
                    projection.companions[0].strategy,
                    TacticalStrategyPreset::Aggressive
                );
                CanonicalEventChainScheduler::enqueue_roots(
                    state,
                    vec![candidate("overflow-effect")],
                )
                .map_err(|_| "enqueue")?;
                CanonicalEventChainScheduler::dequeue_next(state).map_err(|_| "dequeue")?;
                assert!(matches!(
                    CanonicalEventChainScheduler::gate_current_for_execution(state, true)
                        .map_err(|_| "gate")?,
                    SchedulerExecutionGateOutcome::EngineFailure { .. }
                ));
                Ok(CombatReplayStepTrace {
                    rolls: vec![],
                    scheduler_executions: vec![],
                })
            }
            _ => Err("unexpected command"),
        }
    }

    fn fixture_input() -> CombatReplayInput {
        let state = fixture_state();
        let mut ledger = AcceptedCommandLedger::new();
        ledger
            .accept_external(CombatCommandEnvelope {
                command_id: "utility-command".into(),
                source: CombatCommandSource::UtilityAi,
                actor_id: "companion".into(),
                versions: CURRENT_COMBAT_VERSIONS,
                payload: CombatCommandPayload::UseAbility {
                    ability_id: "ability-attack".into(),
                    target_id: Some("enemy".into()),
                },
            })
            .unwrap();
        ledger
            .accept_external(CombatCommandEnvelope {
                command_id: "strategy-command".into(),
                source: CombatCommandSource::Player {
                    controller_id: "controller".into(),
                },
                actor_id: "hero".into(),
                versions: CURRENT_COMBAT_VERSIONS,
                payload: CombatCommandPayload::SetTacticalStrategy {
                    companion_id: "companion".into(),
                    strategy_id: "AGGRESSIVE".into(),
                },
            })
            .unwrap();
        CombatReplayInput {
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.into(),
            initial_state: state,
            accepted_commands: ledger.commands().to_vec(),
        }
    }

    fn candidate(effect_id: &str) -> SchedulerCandidate {
        SchedulerCandidate {
            kind: SchedulerItemKind::System,
            phase_priority: 1,
            explicit_priority: 0,
            source_stable_id: "companion".into(),
            effect_stable_id: effect_id.into(),
        }
    }

    fn fixture_state() -> CombatState {
        let combatant = |id: &str, side: CombatSide| CombatantRuntime {
            combatant_id: id.into(),
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
            resources: vec![],
            statuses: vec![],
            ability_usage: vec![AbilityUsageState {
                ability_id: "ability-attack".into(),
                cooldown_remaining: 0,
                uses_this_normal_owner_turn: 0,
                uses_this_battle: 0,
            }],
            basic_attack_count_this_normal_owner_turn: 0,
            once_usage_counters: vec![],
            normal_owner_turn_index: 0,
            hard_cc_dr: HardCcDrRuntime::default(),
            shield_recharge: ShieldRechargeRuntime::default(),
            initiative_result: 10,
            initiative_base_stat: 2,
            last_committed_timeline_order: None,
            solo_recovery_available: false,
        };
        CombatState {
            combat_instance_id: "combat-replay-fixture".into(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.into(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::Stable,
            combatants: vec![
                combatant("companion", CombatSide::Companion),
                combatant("enemy", CombatSide::Hostile),
                combatant("hero", CombatSide::Player),
            ],
            formal_party_member_ids: vec!["companion".into(), "hero".into()],
            combat_inventory: vec![],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![
                TimelineEntry {
                    combatant_id: "companion".into(),
                    initiative_result: 10,
                    initiative_base_stat: 2,
                    is_extra_turn: false,
                    source_sequence: 1,
                },
                TimelineEntry {
                    combatant_id: "enemy".into(),
                    initiative_result: 9,
                    initiative_base_stat: 2,
                    is_extra_turn: false,
                    source_sequence: 2,
                },
                TimelineEntry {
                    combatant_id: "hero".into(),
                    initiative_result: 8,
                    initiative_base_stat: 2,
                    is_extra_turn: false,
                    source_sequence: 3,
                },
            ],
            round: RoundRuntimeState {
                round_number: 1,
                completed_round_count: 0,
                active_combatant_id: Some("companion".into()),
                extra_turn_resume_phase: None,
                roster: vec![
                    RoundRosterEntry {
                        combatant_id: "companion".into(),
                        normal_turn_slot: 0,
                        status: RoundRosterStatus::Pending,
                    },
                    RoundRosterEntry {
                        combatant_id: "enemy".into(),
                        normal_turn_slot: 1,
                        status: RoundRosterStatus::Pending,
                    },
                    RoundRosterEntry {
                        combatant_id: "hero".into(),
                        normal_turn_slot: 2,
                        status: RoundRosterStatus::Pending,
                    },
                ],
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
                "combat-replay-fixture",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }
}
