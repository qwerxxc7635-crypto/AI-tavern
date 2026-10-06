use ember_combat_core::{
    AbilityUsageCommitPlan, AcceptedCombatCommand, AcceptedCommandLedger, AcceptedCommandSource,
    CURRENT_COMBAT_VERSIONS, CURRENT_REACTION_SCHEMA_VERSION, CURRENT_STATUS_SCHEMA_VERSION,
    CanonicalDomainValue, CanonicalReactionCore, ClockLifecycleWindow, CombatCommandEnvelope,
    CombatCommandPayload, CombatCommandSource, CombatControlAssignment, CombatControlAuthority,
    CombatCostAsset, CombatCostRequestLine, CombatFixed, CombatReplayError, CombatReplayReceipt,
    CombatReplayRunner, CombatReplayStepTrace, CombatResultType, CombatState,
    CombatSubmissionRequest, CombatSubmissionService, CombatantRuntime, CombatantState,
    ControlCategory, DamageChannelCatalog, DamageChannelId, DamageImmunity, DurationClock,
    EffectAmount, EffectDefinition, EncounterDamageRule, EncounterDamageServices,
    EncounterRuleExecutor, ExecutableRecoveryPath, ExecutionRevalidationOutcome,
    ExecutionRevalidationRequest, ExecutionRevalidationService, GameplayTagCatalog, HookPhase,
    MitigationBalanceConfig, PreconditionFailure, PreconditionFailureCode, PreconditionRule,
    PreconditionRuleSpec, ProvisionalDeltaEntry, ReactionBinding, ReactionDecisionChoice,
    ReactionDefinition, ReactionExecutionMode, ResolutionContextLifecycle, ResolutionRequest,
    ResultCandidate, RuntimeCommitContract, RuntimeFinalizationRequest, ShieldInteraction,
    SoloRecoveryBalanceConfig, StandardLethalPolicy, StatusActivationPolicy, StatusDefinition,
    StatusDurationDefinition, StatusExpiryPhase, StatusRefreshPolicy, StatusStackMode,
    StatusTickPhase, TacticalSettingsProjection, TerminalOutcomeArbitrator, WorldCombatProfileId,
    WorldCombatProfileResolver,
};
#[cfg(test)]
use ember_combat_core::{
    AbilityUsageState, CanonicalEventChainScheduler, CombatPhase, CombatRng, CombatSide,
    EnemyIntentCategory, EnemyIntentPlan, EnemyIntentTelegraphLevel, HardCcDrRuntime,
    ObjectiveRuntimeState, ProvisionalRuntimeDelta, ReactionRouteOutcome,
    ReinforcementRuntimeState, ResourceState, RoundRosterEntry, RoundRosterStatus,
    RoundRuntimeState, ShieldRechargeRuntime, TerminalPriorityPolicy, TimelineEntry,
    UtilityActionCategory,
};
use ember_combat_presentation::{
    AbilityTooltip, CombatAbilityUsageViewModel, CombatActionRuleProjection, CombatActionViewKind,
    CombatCostPreviewRuleProjection, CombatEventLogEntry, CombatEventLogPayload,
    CombatEventLogSnapshot, CombatLogPresentationEntry, CombatLogReactionOutcome,
    CombatLogResolutionOutcome, CombatLogStatusChange, CombatPresentationCatalog,
    CombatReactionModeView, CombatReactionRuleProjection, CombatResourceTransitionRuleProjection,
    CombatRulesPresentationSnapshot, CombatViewModel, CombatViewModelProjector,
    CombatViewModelRequest, CombatantPresentationEntry, StatusPresentationEntry,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use thiserror::Error;

use crate::{
    CampaignStore, CombatCheckpointWrite, CombatLoopGuardContract, CombatPersistenceError,
};

const HERO_ID: &str = "hero";
const ENEMY_ID: &str = "enemy";
const CONTROLLER_ID: &str = "local-player";
const REACTION_ID: &str = "reaction.guard";
const STATUS_ID: &str = "status.marked";
#[cfg(test)]
const SEED: &str = "8417a1f8cb9144e9b4f28f44a91cf101";
const LOOP_GUARD: CombatLoopGuardContract = CombatLoopGuardContract {
    max_trigger_depth: 32,
    max_event_count: 256,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CombatSessionWorld {
    Cultivation,
    Fantasy,
    SciFi,
    Urban,
}

impl CombatSessionWorld {
    fn profile(self) -> WorldCombatProfileId {
        match self {
            Self::Cultivation => WorldCombatProfileId::Cultivation,
            Self::Fantasy => WorldCombatProfileId::Fantasy,
            Self::SciFi => WorldCombatProfileId::SciFi,
            Self::Urban => WorldCombatProfileId::Urban,
        }
    }

    fn slug(self) -> &'static str {
        match self {
            Self::Cultivation => "cultivation",
            Self::Fantasy => "fantasy",
            Self::SciFi => "sci-fi",
            Self::Urban => "urban",
        }
    }

    fn data(self) -> WorldSessionData {
        match self {
            Self::Cultivation => WorldSessionData {
                hero: "云岚剑修",
                enemy: "噬灵傀儡",
                resource_id: "qi",
                ability_id: "ability.qi-strike",
                ability_name: "破妄剑诀",
                reaction_name: "护体罡气",
                status_name: "剑意印记",
                channel: "qi",
            },
            Self::Fantasy => WorldSessionData {
                hero: "余烬法师",
                enemy: "灰烬守卫",
                resource_id: "mana",
                ability_id: "ability.ember-bolt",
                ability_name: "余烬飞弹",
                reaction_name: "奥术屏障",
                status_name: "灼烧印记",
                channel: "arcane",
            },
            Self::SciFi => WorldSessionData {
                hero: "边境特勤",
                enemy: "失控机兵",
                resource_id: "energy",
                ability_id: "ability.plasma-burst",
                ability_name: "等离子齐射",
                reaction_name: "偏转力场",
                status_name: "锁定标记",
                channel: "plasma",
            },
            Self::Urban => WorldSessionData {
                hero: "夜巡调查员",
                enemy: "街巷暴徒",
                resource_id: "focus",
                ability_id: "ability.precise-strike",
                ability_name: "精准制敌",
                reaction_name: "紧急闪避",
                status_name: "破绽标记",
                channel: "physical",
            },
        }
    }
}

#[derive(Clone, Copy)]
struct WorldSessionData {
    hero: &'static str,
    enemy: &'static str,
    resource_id: &'static str,
    ability_id: &'static str,
    ability_name: &'static str,
    reaction_name: &'static str,
    status_name: &'static str,
    channel: &'static str,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatSessionSnapshot {
    pub campaign_id: String,
    pub world: CombatSessionWorld,
    pub persistence_revision: u64,
    pub view_model: CombatViewModel,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CombatSessionCompletion {
    pub result_commit_id: String,
    pub checkpoint_removed: bool,
}

#[derive(Debug, Error)]
pub enum CombatSessionError {
    #[error("combat session input is invalid")]
    InvalidInput,
    #[error("combat session command was rejected")]
    CommandRejected,
    #[error("combat session state is invalid")]
    InvalidState,
    #[error("combat session persistence failed")]
    Persistence(#[from] CombatPersistenceError),
    #[error("combat session replay failed")]
    Replay(#[from] CombatReplayError),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
enum DurableCombatEvent {
    Resolution {
        sequence: u64,
        ability_id: String,
    },
    Damage {
        sequence: u64,
        raw_damage: i64,
        hit_point_damage: i64,
    },
    Status {
        sequence: u64,
    },
    Reaction {
        sequence: u64,
        triggered: bool,
    },
    Result {
        sequence: u64,
    },
}

impl CampaignStore {
    /// Re-executes the accepted player history against InitialState and checks
    /// both state and event history against the durable active checkpoint.
    pub fn replay_active_combat_session(
        &self,
        campaign_id: &str,
        world: CombatSessionWorld,
    ) -> Result<CombatReplayReceipt, CombatSessionError> {
        let combat_id = combat_instance_id(campaign_id, world)?;
        let restored = self.restore_combat_checkpoint(&combat_id)?;
        if restored.campaign_id != campaign_id {
            return Err(CombatSessionError::InvalidState);
        }
        let input = self.load_combat_replay_input(&combat_id)?;
        let mut events = Vec::new();
        let receipt = CombatReplayRunner::run(input, |state, command, visible_ledger| {
            let mut ledger = visible_ledger.clone();
            let envelope = live_envelope_for_replay(command)?;
            apply_session_command(state, &mut ledger, envelope, world, &mut events)?;
            if ledger.commands().last() != Some(command) {
                return Err(CombatSessionError::InvalidState);
            }
            Ok(CombatReplayStepTrace {
                rolls: vec![],
                scheduler_executions: vec![],
            })
        })?;
        if receipt.final_state != restored.state || events != restored.events {
            return Err(CombatSessionError::InvalidState);
        }
        Ok(receipt)
    }

    /// Production read path: a route may restore an already persisted combat,
    /// but cannot create a fixture encounter from its URL parameters.
    pub fn restore_existing_combat_session(
        &self,
        campaign_id: &str,
        world: CombatSessionWorld,
    ) -> Result<CombatSessionSnapshot, CombatSessionError> {
        let combat_id = combat_instance_id(campaign_id, world)?;
        let restored = self.restore_combat_checkpoint(&combat_id)?;
        if restored.campaign_id != campaign_id {
            return Err(CombatSessionError::InvalidState);
        }
        project_snapshot(
            restored.campaign_id,
            world,
            restored.persistence_revision,
            &restored.state,
            &restored.events,
        )
    }

    #[cfg(test)]
    pub fn start_or_restore_combat_session(
        &self,
        campaign_id: &str,
        world: CombatSessionWorld,
    ) -> Result<CombatSessionSnapshot, CombatSessionError> {
        let combat_id = combat_instance_id(campaign_id, world)?;
        match self.restore_combat_checkpoint(&combat_id) {
            Ok(_) => self.restore_existing_combat_session(campaign_id, world),
            Err(CombatPersistenceError::NotFound) => {
                let (initial, ledger) = initial_state(&combat_id, world)?;
                let receipt = self.save_combat_checkpoint(CombatCheckpointWrite {
                    campaign_id,
                    expected_persistence_revision: None,
                    initial_state: &initial,
                    state: &initial,
                    accepted_commands: ledger.commands(),
                    events: &[],
                    loop_guard: LOOP_GUARD,
                })?;
                project_snapshot(
                    campaign_id.to_owned(),
                    world,
                    receipt.persistence_revision,
                    &initial,
                    &[],
                )
            }
            Err(error) => Err(error.into()),
        }
    }

    pub fn submit_combat_session_command(
        &self,
        campaign_id: &str,
        world: CombatSessionWorld,
        envelope: CombatCommandEnvelope,
    ) -> Result<CombatSessionSnapshot, CombatSessionError> {
        let combat_id = combat_instance_id(campaign_id, world)?;
        let restored = self.restore_combat_checkpoint(&combat_id)?;
        if restored.campaign_id != campaign_id
            || envelope.versions != CURRENT_COMBAT_VERSIONS
            || envelope.actor_id != HERO_ID
            || !matches!(envelope.source, CombatCommandSource::Player { ref controller_id } if controller_id == CONTROLLER_ID)
        {
            return Err(CombatSessionError::InvalidInput);
        }
        let mut state = restored.state;
        let mut ledger = AcceptedCommandLedger::restore(restored.accepted_commands)
            .map_err(|_| CombatSessionError::InvalidState)?;
        let mut events = restored.events;

        apply_session_command(&mut state, &mut ledger, envelope, world, &mut events)?;

        let receipt = self.save_combat_checkpoint(CombatCheckpointWrite {
            campaign_id,
            expected_persistence_revision: Some(restored.persistence_revision),
            initial_state: &restored.initial_state,
            state: &state,
            accepted_commands: ledger.commands(),
            events: &events,
            loop_guard: LOOP_GUARD,
        })?;
        project_snapshot(
            campaign_id.to_owned(),
            world,
            receipt.persistence_revision,
            &state,
            &events,
        )
    }

    pub fn complete_combat_session(
        &self,
        campaign_id: &str,
        world: CombatSessionWorld,
    ) -> Result<CombatSessionCompletion, CombatSessionError> {
        let combat_id = combat_instance_id(campaign_id, world)?;
        let restored = self.restore_combat_checkpoint(&combat_id)?;
        if restored.campaign_id != campaign_id || restored.state.confirmed_result.is_none() {
            return Err(CombatSessionError::CommandRejected);
        }
        let precombat = RuntimeCommitContract::capture_precombat_snapshot(
            combat_id,
            restored.initial_state.versions,
            snapshot_entries_for_delta(
                &restored.initial_state,
                &restored.state.provisional_delta.entries,
            )?,
        )
        .map_err(|_| CombatSessionError::InvalidState)?;
        let receipt = self.commit_combat_result_with(
            campaign_id,
            &restored.state,
            &precombat,
            RuntimeFinalizationRequest::default(),
            |_transaction, _plan| Ok(()),
        )?;
        let checkpoint_removed = self.complete_combat_result_cleanup(
            &restored.state.combat_instance_id,
            &receipt.result_commit_id,
        )?;
        Ok(CombatSessionCompletion {
            result_commit_id: receipt.result_commit_id,
            checkpoint_removed,
        })
    }
}

fn live_envelope_for_replay(
    command: &AcceptedCombatCommand,
) -> Result<CombatCommandEnvelope, CombatSessionError> {
    let source = match &command.source {
        AcceptedCommandSource::Player { controller_id } if controller_id == CONTROLLER_ID => {
            CombatCommandSource::Player {
                controller_id: controller_id.clone(),
            }
        }
        _ => return Err(CombatSessionError::CommandRejected),
    };
    if command.actor_id != HERO_ID || command.versions != CURRENT_COMBAT_VERSIONS {
        return Err(CombatSessionError::CommandRejected);
    }
    Ok(CombatCommandEnvelope {
        command_id: command.command_id.clone(),
        source,
        actor_id: command.actor_id.clone(),
        versions: command.versions,
        payload: command.payload.clone(),
    })
}

fn apply_session_command(
    state: &mut CombatState,
    ledger: &mut AcceptedCommandLedger,
    envelope: CombatCommandEnvelope,
    world: CombatSessionWorld,
    events: &mut Vec<Value>,
) -> Result<(), CombatSessionError> {
    match envelope.payload.clone() {
        CombatCommandPayload::ResolveReaction { .. } => {
            resolve_reaction(state, ledger, envelope, events)
        }
        CombatCommandPayload::UseAbility {
            ability_id,
            target_id,
        } if ability_id == world.data().ability_id && target_id.as_deref() == Some(ENEMY_ID) => {
            execute_ability(state, ledger, envelope, world, events)
        }
        _ => Err(CombatSessionError::CommandRejected),
    }
}

fn snapshot_entries_for_delta(
    initial: &CombatState,
    entries: &[ProvisionalDeltaEntry],
) -> Result<Vec<CanonicalDomainValue>, CombatSessionError> {
    let mut seen = BTreeSet::new();
    let mut snapshot = Vec::new();
    for entry in entries {
        let key = match entry {
            ProvisionalDeltaEntry::HitPoints { combatant_id, .. } => format!("hp:{combatant_id}"),
            ProvisionalDeltaEntry::MaxHitPoints { combatant_id, .. } => {
                format!("max-hp:{combatant_id}")
            }
            ProvisionalDeltaEntry::CombatantState { combatant_id, .. } => {
                format!("state:{combatant_id}")
            }
            ProvisionalDeltaEntry::SoloRecoveryAvailable { combatant_id, .. } => {
                format!("recovery:{combatant_id}")
            }
            ProvisionalDeltaEntry::Shield { combatant_id, .. } => format!("shield:{combatant_id}"),
            ProvisionalDeltaEntry::Resource {
                combatant_id,
                resource_id,
                ..
            } => format!("resource:{combatant_id}:{resource_id}"),
            ProvisionalDeltaEntry::ItemQuantity {
                owner_id, item_id, ..
            } => format!("item:{owner_id}:{item_id}"),
            ProvisionalDeltaEntry::StatusPresence {
                combatant_id,
                status_instance_id,
                ..
            } => format!("status:{combatant_id}:{status_instance_id}"),
            ProvisionalDeltaEntry::WorldFact { fact_id, .. } => format!("fact:{fact_id}"),
        };
        if !seen.insert(key) {
            continue;
        }
        snapshot.push(match entry {
            ProvisionalDeltaEntry::HitPoints { combatant_id, .. } => {
                CanonicalDomainValue::HitPoints {
                    combatant_id: combatant_id.clone(),
                    value: initial_combatant(initial, combatant_id)?.hit_points,
                }
            }
            ProvisionalDeltaEntry::MaxHitPoints { combatant_id, .. } => {
                CanonicalDomainValue::MaxHitPoints {
                    combatant_id: combatant_id.clone(),
                    value: initial_combatant(initial, combatant_id)?.max_hit_points,
                }
            }
            ProvisionalDeltaEntry::CombatantState { combatant_id, .. } => {
                CanonicalDomainValue::CombatantState {
                    combatant_id: combatant_id.clone(),
                    value: initial_combatant(initial, combatant_id)?.state,
                }
            }
            ProvisionalDeltaEntry::SoloRecoveryAvailable { combatant_id, .. } => {
                CanonicalDomainValue::SoloRecoveryAvailable {
                    combatant_id: combatant_id.clone(),
                    value: initial_combatant(initial, combatant_id)?.solo_recovery_available,
                }
            }
            ProvisionalDeltaEntry::Shield { combatant_id, .. } => CanonicalDomainValue::Shield {
                combatant_id: combatant_id.clone(),
                value: initial_combatant(initial, combatant_id)?.shield,
            },
            ProvisionalDeltaEntry::Resource {
                combatant_id,
                resource_id,
                ..
            } => {
                let value = initial_combatant(initial, combatant_id)?
                    .resources
                    .iter()
                    .find(|resource| resource.resource_id == *resource_id)
                    .ok_or(CombatSessionError::InvalidState)?
                    .current;
                CanonicalDomainValue::Resource {
                    combatant_id: combatant_id.clone(),
                    resource_id: resource_id.clone(),
                    value,
                }
            }
            ProvisionalDeltaEntry::ItemQuantity {
                owner_id, item_id, ..
            } => {
                let value = initial
                    .combat_inventory
                    .iter()
                    .find(|item| item.owner_id == *owner_id && item.item_id == *item_id)
                    .ok_or(CombatSessionError::InvalidState)?
                    .current_quantity;
                CanonicalDomainValue::ItemQuantity {
                    owner_id: owner_id.clone(),
                    item_id: item_id.clone(),
                    value,
                }
            }
            ProvisionalDeltaEntry::StatusPresence {
                combatant_id,
                status_instance_id,
                ..
            } => CanonicalDomainValue::StatusPresence {
                combatant_id: combatant_id.clone(),
                status_instance_id: status_instance_id.clone(),
                value: initial_combatant(initial, combatant_id)?
                    .statuses
                    .iter()
                    .any(|status| status.status_instance_id == *status_instance_id),
            },
            ProvisionalDeltaEntry::WorldFact {
                fact_id,
                before_digest,
                ..
            } => CanonicalDomainValue::WorldFact {
                fact_id: fact_id.clone(),
                digest: before_digest.clone(),
            },
        });
    }
    Ok(snapshot)
}

fn initial_combatant<'a>(
    state: &'a CombatState,
    id: &str,
) -> Result<&'a CombatantRuntime, CombatSessionError> {
    state
        .combatants
        .iter()
        .find(|combatant| combatant.combatant_id == id)
        .ok_or(CombatSessionError::InvalidState)
}

#[cfg(test)]
fn initial_state(
    combat_id: &str,
    world: CombatSessionWorld,
) -> Result<(CombatState, AcceptedCommandLedger), CombatSessionError> {
    let data = world.data();
    let mut state = CombatState {
        combat_instance_id: combat_id.to_owned(),
        versions: CURRENT_COMBAT_VERSIONS,
        random_seed: SEED.to_owned(),
        revision: 1,
        last_committed_sequence: 1,
        phase: CombatPhase::Action,
        combatants: vec![
            combatant(
                HERO_ID,
                CombatSide::Player,
                24,
                data.resource_id,
                data.ability_id,
                14,
                2,
            ),
            combatant(
                ENEMY_ID,
                CombatSide::Hostile,
                12,
                data.resource_id,
                data.ability_id,
                11,
                1,
            ),
        ],
        formal_party_member_ids: vec![HERO_ID.to_owned()],
        combat_inventory: vec![],
        cost_reservations: vec![],
        resolution_context: None,
        timeline: vec![timeline(HERO_ID, 14, 1), timeline(ENEMY_ID, 11, 2)],
        round: RoundRuntimeState {
            round_number: 1,
            completed_round_count: 0,
            active_combatant_id: Some(HERO_ID.to_owned()),
            extra_turn_resume_phase: None,
            roster: vec![
                RoundRosterEntry {
                    combatant_id: HERO_ID.to_owned(),
                    normal_turn_slot: 0,
                    status: RoundRosterStatus::Pending,
                },
                RoundRosterEntry {
                    combatant_id: ENEMY_ID.to_owned(),
                    normal_turn_slot: 1,
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
        enemy_intents: vec![EnemyIntentPlan {
            enemy_id: ENEMY_ID.to_owned(),
            intent_category: EnemyIntentCategory::Attack,
            preferred_utility_category: UtilityActionCategory::Damage,
            display_label_zh_cn: EnemyIntentCategory::Attack.label_zh_cn().to_owned(),
            target_hint: Some(HERO_ID.to_owned()),
            telegraph_level: EnemyIntentTelegraphLevel::High,
            created_sequence: 1,
            created_round: 1,
            replan_records: vec![],
        }],
        result_candidates: vec![],
        terminal_priority_policy: TerminalPriorityPolicy::default(),
        confirmed_result_candidate_id: None,
        confirmed_result: None,
        rng: CombatRng::new(
            SEED,
            combat_id,
            CURRENT_COMBAT_VERSIONS.rng_contract_version,
        )
        .map_err(|_| CombatSessionError::InvalidState)?
        .snapshot(),
    };
    state
        .validate_for_commit()
        .map_err(|_| CombatSessionError::InvalidState)?;
    let mut ledger = AcceptedCommandLedger::new();
    let accepted = ledger
        .accept_external(CombatCommandEnvelope {
            command_id: "opening-threat".to_owned(),
            source: CombatCommandSource::Player {
                controller_id: CONTROLLER_ID.to_owned(),
            },
            actor_id: HERO_ID.to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            payload: CombatCommandPayload::UseAbility {
                ability_id: data.ability_id.to_owned(),
                target_id: Some(ENEMY_ID.to_owned()),
            },
        })
        .map_err(|_| CombatSessionError::InvalidState)?;
    ResolutionContextLifecycle::create(
        &mut state,
        accepted.command,
        "opening-chain".to_owned(),
        None,
    )
    .map_err(|_| CombatSessionError::InvalidState)?;
    for (from, to) in [
        (HookPhase::PreAction, HookPhase::BeforeRoll),
        (HookPhase::BeforeRoll, HookPhase::AfterRoll),
        (HookPhase::AfterRoll, HookPhase::Outcome),
        (HookPhase::Outcome, HookPhase::PreEffect),
    ] {
        ResolutionContextLifecycle::complete_hook(&mut state, from, to)
            .map_err(|_| CombatSessionError::InvalidState)?;
    }
    CanonicalEventChainScheduler::begin(&mut state, "opening-chain".to_owned(), 32, 256)
        .map_err(|_| CombatSessionError::InvalidState)?;
    let bindings = reaction_bindings();
    CanonicalReactionCore::enqueue_roots(&mut state, &bindings)
        .map_err(|_| CombatSessionError::InvalidState)?;
    CanonicalEventChainScheduler::dequeue_next(&mut state)
        .map_err(|_| CombatSessionError::InvalidState)?;
    if !matches!(
        CanonicalReactionCore::route_current(&mut state, &bindings, &assignments(), None)
            .map_err(|_| CombatSessionError::InvalidState)?,
        ReactionRouteOutcome::AskWindowOpened(_)
    ) {
        return Err(CombatSessionError::InvalidState);
    }
    // The opening reaction is already represented by InitialState. Its
    // deterministic setup command must not be replayed as a player input.
    Ok((state, AcceptedCommandLedger::new()))
}

fn resolve_reaction(
    state: &mut CombatState,
    ledger: &mut AcceptedCommandLedger,
    envelope: CombatCommandEnvelope,
    events: &mut Vec<Value>,
) -> Result<(), CombatSessionError> {
    let triggered = matches!(
        envelope.payload,
        CombatCommandPayload::ResolveReaction {
            choice: ReactionDecisionChoice::Trigger,
            ..
        }
    );
    CanonicalReactionCore::resolve_ask_window(
        state,
        ledger,
        envelope,
        &reaction_bindings(),
        &assignments(),
    )
    .map_err(|_| CombatSessionError::CommandRejected)?;
    CanonicalReactionCore::complete_current_with_children(state, &reaction_bindings())
        .map_err(|_| CombatSessionError::InvalidState)?;
    CanonicalReactionCore::clear_resolved_window(state)
        .map_err(|_| CombatSessionError::InvalidState)?;
    state.resolution_context = None;
    state.scheduler = None;
    state.revision = state
        .revision
        .checked_add(1)
        .ok_or(CombatSessionError::InvalidState)?;
    state
        .validate_for_commit()
        .map_err(|_| CombatSessionError::InvalidState)?;
    push_event(
        events,
        DurableCombatEvent::Reaction {
            sequence: next_event_sequence(events)?,
            triggered,
        },
    )
}

fn execute_ability(
    state: &mut CombatState,
    ledger: &mut AcceptedCommandLedger,
    envelope: CombatCommandEnvelope,
    world: CombatSessionWorld,
    events: &mut Vec<Value>,
) -> Result<(), CombatSessionError> {
    if state.confirmed_result.is_some() || state.pending_reaction.is_some() {
        return Err(CombatSessionError::CommandRejected);
    }
    let data = world.data();
    let request = ability_submission_request(state, envelope.clone(), data);
    let submission = CombatSubmissionService::submit(state, ledger, request)
        .map_err(|_| CombatSessionError::CommandRejected)?;
    ResolutionContextLifecycle::create(
        state,
        submission.command.command,
        format!("chain-{}", envelope.command_id),
        submission
            .reservation
            .as_ref()
            .map(|receipt| receipt.record.reservation_id.clone()),
    )
    .map_err(|_| CombatSessionError::InvalidState)?;
    ResolutionContextLifecycle::complete_hook(state, HookPhase::PreAction, HookPhase::BeforeRoll)
        .map_err(|_| CombatSessionError::InvalidState)?;
    ResolutionContextLifecycle::mark_ready_for_revalidation(state)
        .map_err(|_| CombatSessionError::InvalidState)?;
    let legal_target_ids =
        ability_submission_request(state, envelope.clone(), data).legal_target_ids;
    match ExecutionRevalidationService::revalidate_and_commit(
        state,
        ExecutionRevalidationRequest {
            known_ability_ids: vec![data.ability_id.to_owned()],
            disabled_ability_ids: vec![],
            legal_target_ids,
            entity_tags: vec![],
            ability_preconditions: ability_preconditions(),
            usage_commit: Some(AbilityUsageCommitPlan {
                ability_id: data.ability_id.to_owned(),
                cooldown_turns: None,
                increment_uses_this_normal_owner_turn: true,
                increment_uses_this_battle: true,
                increment_basic_attack_count: false,
                once_counters: vec![],
            }),
        },
    )
    .map_err(|_| CombatSessionError::InvalidState)?
    {
        ExecutionRevalidationOutcome::ReadyForResolution { .. } => {}
        ExecutionRevalidationOutcome::CancelledBeforeResolution { .. } => return Ok(()),
    }

    let channels = DamageChannelCatalog::v0_4_1();
    let profiles = WorldCombatProfileResolver::v0_4_1(&channels)
        .map_err(|_| CombatSessionError::InvalidState)?;
    let profile = profiles.resolve(world.profile());
    let raw_damage = 6;
    let commit = EncounterRuleExecutor::commit_damage(
        state,
        ledger,
        CombatCommandEnvelope {
            command_id: format!("resolve-{}", envelope.command_id),
            source: CombatCommandSource::InternalDeterministic {
                rule_id: "rule.player-ability".to_owned(),
            },
            actor_id: HERO_ID.to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            payload: CombatCommandPayload::InternalRuleAction {
                rule_id: "rule.player-ability".to_owned(),
                target_ids: vec![ENEMY_ID.to_owned()],
            },
        },
        &EffectDefinition::DealDamage {
            channel_id: DamageChannelId::new(data.channel)
                .map_err(|_| CombatSessionError::InvalidState)?,
            raw_damage: CombatFixed::from_integer(raw_damage)
                .map_err(|_| CombatSessionError::InvalidState)?,
        },
        EncounterDamageRule {
            resolution: ResolutionRequest::AutoHit {},
            target_armor: 0,
            armor_penetration_percent: CombatFixed::from_scaled(0),
            armor_penetration_flat: 0,
            base_channel_resistance: CombatFixed::from_scaled(0),
            resistance_penetration: CombatFixed::from_scaled(0),
            immunity: DamageImmunity::NotImmune {},
            shield_interaction: ShieldInteraction::standard(),
            tags: vec!["Ability.Attack".to_owned()],
        },
        EncounterDamageServices {
            profile,
            balance: &MitigationBalanceConfig {
                armor_k: 100,
                max_armor_dr: CombatFixed::from_scaled(900_000),
                max_resistance: CombatFixed::from_scaled(900_000),
                max_weakness: CombatFixed::from_scaled(900_000),
            },
            lethal_resolver: &StandardLethalPolicy {
                solo_recovery: SoloRecoveryBalanceConfig::default(),
                executable_recovery_path: ExecutableRecoveryPath::Unavailable,
            },
        },
    )
    .map_err(|_| CombatSessionError::InvalidState)?;
    let result = &commit.working_results[0].mitigation;
    push_event(
        events,
        DurableCombatEvent::Resolution {
            sequence: next_event_sequence(events)?,
            ability_id: data.ability_id.to_owned(),
        },
    )?;
    push_event(
        events,
        DurableCombatEvent::Damage {
            sequence: next_event_sequence(events)?,
            raw_damage,
            hit_point_damage: result.hp_damage,
        },
    )?;
    state.resolution_context = None;
    state.revision = state
        .revision
        .checked_add(1)
        .ok_or(CombatSessionError::InvalidState)?;
    state
        .validate_for_commit()
        .map_err(|_| CombatSessionError::InvalidState)?;

    if state.combatants.iter().any(|combatant| {
        combatant.combatant_id == ENEMY_ID && combatant.state == CombatantState::Active
    }) {
        apply_status(state, ledger, &envelope.command_id)?;
        push_event(
            events,
            DurableCombatEvent::Status {
                sequence: next_event_sequence(events)?,
            },
        )?;
    } else {
        let sequence = state
            .last_committed_sequence
            .checked_add(1)
            .ok_or(CombatSessionError::InvalidState)?;
        state.result_candidates.push(ResultCandidate {
            candidate_id: "result-victory".to_owned(),
            result_type: CombatResultType::Victory,
            source_kind: "SYSTEM".to_owned(),
            source_id: "hostiles-defeated".to_owned(),
            explicit_priority: None,
            sequence,
        });
        TerminalOutcomeArbitrator::confirm(state).map_err(|_| CombatSessionError::InvalidState)?;
        push_event(
            events,
            DurableCombatEvent::Result {
                sequence: next_event_sequence(events)?,
            },
        )?;
    }
    Ok(())
}

fn ability_preconditions() -> Vec<PreconditionRuleSpec> {
    vec![PreconditionRuleSpec::with_default_timing(
        "ability.cooldown",
        PreconditionRule::CooldownReady,
    )]
}

fn ability_submission_request(
    state: &CombatState,
    envelope: CombatCommandEnvelope,
    data: WorldSessionData,
) -> CombatSubmissionRequest {
    let enemy_active = state
        .combatants
        .iter()
        .any(|value| value.combatant_id == ENEMY_ID && value.state == CombatantState::Active);
    CombatSubmissionRequest {
        envelope,
        control_assignments: assignments(),
        stable_input_point: true,
        utility_ai_evaluation_in_progress: false,
        known_ability_ids: vec![data.ability_id.to_owned()],
        disabled_ability_ids: vec![],
        legal_target_ids: if enemy_active {
            vec![ENEMY_ID.to_owned()]
        } else {
            vec![]
        },
        entity_tags: vec![],
        ability_preconditions: ability_preconditions(),
        costs: vec![
            CombatCostRequestLine {
                cost_id: "action-point".to_owned(),
                asset: CombatCostAsset::ActionPoints {
                    combatant_id: HERO_ID.to_owned(),
                },
                amount: 1,
                consume_cost_on_interrupt: false,
            },
            CombatCostRequestLine {
                cost_id: "world-resource".to_owned(),
                asset: CombatCostAsset::Resource {
                    combatant_id: HERO_ID.to_owned(),
                    resource_id: data.resource_id.to_owned(),
                },
                amount: 2,
                consume_cost_on_interrupt: false,
            },
        ],
        parent_reservation_id: None,
    }
}

fn apply_status(
    state: &mut CombatState,
    ledger: &AcceptedCommandLedger,
    parent_command_id: &str,
) -> Result<(), CombatSessionError> {
    let definition = marked_status_definition();
    let round_number = state.round.round_number;
    let commit = EncounterRuleExecutor::commit_untriggered_status(
        state,
        ledger,
        CombatCommandEnvelope {
            command_id: format!("status-{parent_command_id}"),
            source: CombatCommandSource::InternalDeterministic {
                rule_id: "rule.player-ability-status".to_owned(),
            },
            actor_id: HERO_ID.to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            payload: CombatCommandPayload::InternalRuleAction {
                rule_id: "rule.player-ability-status".to_owned(),
                target_ids: vec![ENEMY_ID.to_owned()],
            },
        },
        &EffectDefinition::ApplyStatus {
            status_definition_id: STATUS_ID.to_owned(),
        },
        &definition,
        &GameplayTagCatalog::v0_4_1(),
        Some(ClockLifecycleWindow {
            clock: DurationClock::Round,
            clock_index: round_number,
            tick_phase_passed: false,
            expiry_phase_passed: false,
        }),
    )
    .map_err(|_| CombatSessionError::InvalidState)?;
    if commit.committed_event.is_none() {
        return Err(CombatSessionError::InvalidState);
    }
    Ok(())
}

fn marked_status_definition() -> StatusDefinition {
    StatusDefinition {
        status_schema_version: CURRENT_STATUS_SCHEMA_VERSION,
        status_definition_id: STATUS_ID.to_owned(),
        tags: vec![],
        stack_group_id: STATUS_ID.to_owned(),
        stack_mode: StatusStackMode::Add,
        max_stacks: 3,
        duration: StatusDurationDefinition {
            clock: DurationClock::Round,
            duration: Some(2),
            activation_policy: StatusActivationPolicy::CurrentClock,
            expiry_phase: StatusExpiryPhase::RoundEnd,
        },
        refresh_policy: StatusRefreshPolicy::RefreshDuration,
        priority: 0,
        control_category: ControlCategory::None,
        tick_phase: StatusTickPhase::None,
        dispel_tags: vec![],
        immunity_tags: vec![],
        effects: vec![],
        triggers: vec![],
        strength_rank: None,
    }
}

fn project_snapshot(
    campaign_id: String,
    world: CombatSessionWorld,
    persistence_revision: u64,
    state: &CombatState,
    events: &[Value],
) -> Result<CombatSessionSnapshot, CombatSessionError> {
    let data = world.data();
    let hero = state
        .combatants
        .iter()
        .find(|value| value.combatant_id == HERO_ID)
        .ok_or(CombatSessionError::InvalidState)?;
    let request = ability_submission_request(
        state,
        CombatCommandEnvelope {
            command_id: format!("preview-{}", state.revision),
            source: CombatCommandSource::Player {
                controller_id: CONTROLLER_ID.to_owned(),
            },
            actor_id: HERO_ID.to_owned(),
            versions: state.versions,
            payload: CombatCommandPayload::UseAbility {
                ability_id: data.ability_id.to_owned(),
                target_id: Some(ENEMY_ID.to_owned()),
            },
        },
        data,
    );
    let preview = CombatSubmissionService::preview(state, &request)
        .map_err(|_| CombatSessionError::InvalidState)?;
    let legal = state.confirmed_result.is_none() && preview.is_legal();
    let usage = hero
        .ability_usage
        .iter()
        .find(|value| value.ability_id == data.ability_id)
        .ok_or(CombatSessionError::InvalidState)?;
    let mut failures = preview.preconditions.failures;
    if preview.input_barrier.is_some() {
        failures.push(PreconditionFailure {
            rule_id: "submission.input-barrier".to_owned(),
            code: PreconditionFailureCode::UnstableInputPoint,
            subject_id: Some(HERO_ID.to_owned()),
        });
    }
    if state.confirmed_result.is_some() {
        failures.push(PreconditionFailure {
            rule_id: "submission.terminal".to_owned(),
            code: PreconditionFailureCode::ActorCannotAct,
            subject_id: Some(HERO_ID.to_owned()),
        });
    }
    let action_point_cost = request
        .costs
        .iter()
        .find_map(|line| match &line.asset {
            CombatCostAsset::ActionPoints { .. } => Some(line.amount),
            _ => None,
        })
        .ok_or(CombatSessionError::InvalidState)?;
    let resource_cost = request
        .costs
        .iter()
        .find_map(|line| match &line.asset {
            CombatCostAsset::Resource { resource_id, .. } if resource_id == data.resource_id => {
                Some(line.amount)
            }
            _ => None,
        })
        .ok_or(CombatSessionError::InvalidState)?;
    let resource = hero
        .resources
        .iter()
        .find(|value| value.resource_id == data.resource_id)
        .ok_or(CombatSessionError::InvalidState)?;
    let rules = CombatRulesPresentationSnapshot {
        state_revision: state.revision,
        actions: vec![CombatActionRuleProjection {
            action_id: data.ability_id.to_owned(),
            display_name_zh_cn: data.ability_name.to_owned(),
            kind: CombatActionViewKind::Ability,
            requires_target: true,
            is_legal: legal,
            legal_target_ids: if legal {
                request.legal_target_ids
            } else {
                vec![]
            },
            failures,
            ability_usage: Some(CombatAbilityUsageViewModel {
                cooldown_remaining: usage.cooldown_remaining,
                uses_this_normal_owner_turn: usage.uses_this_normal_owner_turn,
                max_uses_per_normal_owner_turn: None,
                uses_this_battle: usage.uses_this_battle,
                max_uses_per_battle: None,
            }),
            cost_preview: Some(CombatCostPreviewRuleProjection {
                action_points_before: hero.action_points,
                action_points_after: (hero.action_points - action_point_cost).max(0),
                resource_transitions: vec![CombatResourceTransitionRuleProjection {
                    resource_id: data.resource_id.to_owned(),
                    before: resource.current,
                    after: (resource.current - resource_cost).max(resource.min_value),
                }],
            }),
            tooltip: Some(tooltip(data)?),
        }],
        reactions: vec![CombatReactionRuleProjection {
            reaction_id: REACTION_ID.to_owned(),
            display_name_zh_cn: data.reaction_name.to_owned(),
            cost_summary_zh_cn: "消耗 1 次反应".to_owned(),
            effect_summary_zh_cn: "化解开场威胁".to_owned(),
            mode: CombatReactionModeView::Ask,
        }],
        tactical_settings: TacticalSettingsProjection { companions: vec![] },
    };
    let combat_log = presentation_events(state.revision, events)?;
    let names = [
        CombatantPresentationEntry {
            combatant_id: HERO_ID.to_owned(),
            display_name_zh_cn: data.hero.to_owned(),
        },
        CombatantPresentationEntry {
            combatant_id: ENEMY_ID.to_owned(),
            display_name_zh_cn: data.enemy.to_owned(),
        },
    ];
    let log_names = [
        CombatLogPresentationEntry {
            subject_id: data.ability_id.to_owned(),
            display_name_zh_cn: data.ability_name.to_owned(),
        },
        CombatLogPresentationEntry {
            subject_id: REACTION_ID.to_owned(),
            display_name_zh_cn: data.reaction_name.to_owned(),
        },
        CombatLogPresentationEntry {
            subject_id: STATUS_ID.to_owned(),
            display_name_zh_cn: data.status_name.to_owned(),
        },
    ];
    let view_model = CombatViewModelProjector::new(&CombatPresentationCatalog::v0_4_1())
        .project(&CombatViewModelRequest {
            state,
            rules: &rules,
            combatant_presentations: &names,
            status_presentations: &[StatusPresentationEntry {
                status_definition_id: STATUS_ID.to_owned(),
                display_name_zh_cn: data.status_name.to_owned(),
            }],
            combat_log: &combat_log,
            combat_log_presentations: &log_names,
        })
        .map_err(|_| CombatSessionError::InvalidState)?;
    Ok(CombatSessionSnapshot {
        campaign_id,
        world,
        persistence_revision,
        view_model,
    })
}

fn presentation_events(
    state_revision: u64,
    values: &[Value],
) -> Result<CombatEventLogSnapshot, CombatSessionError> {
    let mut entries = Vec::new();
    for value in values {
        let event: DurableCombatEvent =
            serde_json::from_value(value.clone()).map_err(|_| CombatSessionError::InvalidState)?;
        let (sequence, payload) = match event {
            DurableCombatEvent::Resolution {
                sequence,
                ability_id,
            } => (
                sequence,
                CombatEventLogPayload::AbilityResolution {
                    actor_id: HERO_ID.to_owned(),
                    target_id: ENEMY_ID.to_owned(),
                    ability_id,
                    d20: None,
                    outcome: CombatLogResolutionOutcome::Hit,
                },
            ),
            DurableCombatEvent::Damage {
                sequence,
                raw_damage,
                hit_point_damage,
            } => (
                sequence,
                CombatEventLogPayload::Damage {
                    source_id: HERO_ID.to_owned(),
                    target_id: ENEMY_ID.to_owned(),
                    raw_damage,
                    mitigation: raw_damage - hit_point_damage,
                    shield_absorbed: 0,
                    hit_point_damage,
                },
            ),
            DurableCombatEvent::Status { sequence } => (
                sequence,
                CombatEventLogPayload::Status {
                    target_id: ENEMY_ID.to_owned(),
                    status_id: STATUS_ID.to_owned(),
                    change: CombatLogStatusChange::Applied,
                },
            ),
            DurableCombatEvent::Reaction {
                sequence,
                triggered,
            } => (
                sequence,
                CombatEventLogPayload::Reaction {
                    actor_id: HERO_ID.to_owned(),
                    reaction_id: REACTION_ID.to_owned(),
                    outcome: if triggered {
                        CombatLogReactionOutcome::Triggered
                    } else {
                        CombatLogReactionOutcome::Skipped
                    },
                },
            ),
            DurableCombatEvent::Result { sequence } => (
                sequence,
                CombatEventLogPayload::Result {
                    result: CombatResultType::Victory,
                },
            ),
        };
        entries.push(CombatEventLogEntry {
            event_id: format!("event-{sequence}"),
            sequence,
            payload,
        });
    }
    Ok(CombatEventLogSnapshot {
        state_revision,
        entries,
    })
}

fn tooltip(data: WorldSessionData) -> Result<AbilityTooltip, CombatSessionError> {
    serde_json::from_value(json!({
        "flavor": { "displayName": data.ability_name, "flavorDescription": "以当前世界规则驱动的可靠战技。", "lore": "所有数值均由本地战斗核心结算。" },
        "mechanics": { "abilityId": data.ability_id, "lines": [
            { "kind": "ACTION_POINT", "sourceIds": [], "text": "行动点：1" },
            { "kind": "RESOURCE", "sourceIds": [data.resource_id], "text": "世界资源：2" },
            { "kind": "DAMAGE", "sourceIds": [data.channel], "text": "伤害：6" }
        ] }
    })).map_err(|_| CombatSessionError::InvalidState)
}

fn reaction_bindings() -> Vec<ReactionBinding> {
    vec![ReactionBinding {
        owner_combatant_id: HERO_ID.to_owned(),
        definition: ReactionDefinition {
            reaction_schema_version: CURRENT_REACTION_SCHEMA_VERSION,
            reaction_id: REACTION_ID.to_owned(),
            hook_phase: HookPhase::PreEffect,
            priority: 10,
            mode: ReactionExecutionMode::Ask,
            costs: vec![CombatCostRequestLine {
                cost_id: "reaction-charge".to_owned(),
                asset: CombatCostAsset::ReactionCharge {
                    combatant_id: HERO_ID.to_owned(),
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
            combatant_id: HERO_ID.to_owned(),
            authority: CombatControlAuthority::Player {
                controller_id: CONTROLLER_ID.to_owned(),
            },
        },
        CombatControlAssignment {
            combatant_id: ENEMY_ID.to_owned(),
            authority: CombatControlAuthority::UtilityAi,
        },
    ]
}

#[cfg(test)]
fn combatant(
    id: &str,
    side: CombatSide,
    hp: i64,
    resource_id: &str,
    ability_id: &str,
    initiative: i64,
    order: u32,
) -> CombatantRuntime {
    CombatantRuntime {
        combatant_id: id.to_owned(),
        definition_id: format!("definition.{id}"),
        side,
        state: CombatantState::Active,
        hit_points: hp,
        max_hit_points: hp,
        shield: 0,
        max_shield: 0,
        action_points: 3,
        max_action_points: 3,
        reaction_charges: 1,
        max_reaction_charges: 1,
        resources: if side == CombatSide::Player {
            vec![ResourceState {
                resource_id: resource_id.to_owned(),
                current: 6,
                min_value: 0,
                max_value: 6,
                overheat_threshold: None,
                hard_max_value: None,
            }]
        } else {
            vec![]
        },
        statuses: vec![],
        ability_usage: vec![AbilityUsageState {
            ability_id: ability_id.to_owned(),
            cooldown_remaining: 0,
            uses_this_normal_owner_turn: 0,
            uses_this_battle: 0,
        }],
        basic_attack_count_this_normal_owner_turn: 0,
        once_usage_counters: vec![],
        normal_owner_turn_index: 1,
        hard_cc_dr: HardCcDrRuntime::default(),
        shield_recharge: ShieldRechargeRuntime::default(),
        initiative_result: initiative,
        initiative_base_stat: 2,
        last_committed_timeline_order: Some(order),
        solo_recovery_available: side == CombatSide::Player,
    }
}

#[cfg(test)]
fn timeline(id: &str, initiative: i64, sequence: u64) -> TimelineEntry {
    TimelineEntry {
        combatant_id: id.to_owned(),
        initiative_result: initiative,
        initiative_base_stat: 2,
        is_extra_turn: false,
        source_sequence: sequence,
    }
}

fn combat_instance_id(
    campaign_id: &str,
    world: CombatSessionWorld,
) -> Result<String, CombatSessionError> {
    if campaign_id.is_empty()
        || campaign_id.len() > 128
        || !campaign_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(CombatSessionError::InvalidInput);
    }
    Ok(format!("combat-{campaign_id}-{}", world.slug()))
}

fn next_event_sequence(events: &[Value]) -> Result<u64, CombatSessionError> {
    u64::try_from(events.len())
        .map_err(|_| CombatSessionError::InvalidState)?
        .checked_add(1)
        .ok_or(CombatSessionError::InvalidState)
}

fn push_event(
    events: &mut Vec<Value>,
    event: DurableCombatEvent,
) -> Result<(), CombatSessionError> {
    events.push(serde_json::to_value(event).map_err(|_| CombatSessionError::InvalidState)?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_restore_does_not_create_a_demo_battle_from_url_world() {
        let directory = tempfile::tempdir().unwrap();
        let store = CampaignStore::open(directory.path().join("combat.sqlite")).unwrap();
        let campaign = store.create_campaign().unwrap();
        let world = CombatSessionWorld::Fantasy;
        assert!(matches!(
            store.restore_existing_combat_session(&campaign.id, world),
            Err(CombatSessionError::Persistence(
                CombatPersistenceError::NotFound
            ))
        ));
        let count: i64 = store
            .connect()
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM battle_records WHERE campaign_id=?1",
                [&campaign.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);

        let created_fixture = store
            .start_or_restore_combat_session(&campaign.id, world)
            .unwrap();
        assert!(matches!(
            store.restore_authored_encounter_checkpoint(
                &campaign.id,
                &created_fixture.view_model.combat_instance_id,
            ),
            Err(CombatPersistenceError::InvalidCheckpoint)
        ));
        let restored = store
            .restore_existing_combat_session(&campaign.id, world)
            .unwrap();
        assert_eq!(restored.campaign_id, created_fixture.campaign_id);
        assert_eq!(restored.world, created_fixture.world);
        assert_eq!(
            restored.persistence_revision,
            created_fixture.persistence_revision
        );
        assert_eq!(
            serde_json::to_value(restored.view_model).unwrap(),
            serde_json::to_value(created_fixture.view_model).unwrap()
        );
    }

    #[test]
    fn active_replay_rejects_durable_event_history_that_live_rules_cannot_reproduce() {
        let directory = tempfile::tempdir().unwrap();
        let store = CampaignStore::open(directory.path().join("combat.sqlite")).unwrap();
        let campaign = store.create_campaign().unwrap();
        let world = CombatSessionWorld::Fantasy;
        let initial = store
            .start_or_restore_combat_session(&campaign.id, world)
            .unwrap();
        let restored = store
            .restore_combat_checkpoint(&initial.view_model.combat_instance_id)
            .unwrap();
        let mut events = restored.events.clone();
        events.push(json!({ "kind": "FABRICATED", "sequence": 1 }));
        store
            .save_combat_checkpoint(CombatCheckpointWrite {
                campaign_id: &campaign.id,
                expected_persistence_revision: Some(restored.persistence_revision),
                initial_state: &restored.initial_state,
                state: &restored.state,
                accepted_commands: &restored.accepted_commands,
                events: &events,
                loop_guard: restored.loop_guard,
            })
            .unwrap();
        assert!(matches!(
            store.replay_active_combat_session(&campaign.id, world),
            Err(CombatSessionError::InvalidState)
        ));
    }

    #[test]
    fn projected_ability_respects_core_cooldown_rule() {
        let directory = tempfile::tempdir().unwrap();
        let store = CampaignStore::open(directory.path().join("combat.sqlite")).unwrap();
        let campaign = store.create_campaign().unwrap();
        let world = CombatSessionWorld::Fantasy;
        let initial = store
            .start_or_restore_combat_session(&campaign.id, world)
            .unwrap();
        let reaction = initial.view_model.pending_reaction.as_ref().unwrap();
        let after_reaction = store
            .submit_combat_session_command(
                &campaign.id,
                world,
                envelope(
                    &initial,
                    CombatCommandPayload::ResolveReaction {
                        reaction_window_id: reaction.reaction_window_id.clone(),
                        choice: ReactionDecisionChoice::Trigger,
                        selected_reaction_id: Some(REACTION_ID.to_owned()),
                    },
                ),
            )
            .unwrap();
        let mut restored = store
            .restore_combat_checkpoint(&after_reaction.view_model.combat_instance_id)
            .unwrap();
        restored
            .state
            .combatants
            .iter_mut()
            .find(|value| value.combatant_id == HERO_ID)
            .unwrap()
            .ability_usage[0]
            .cooldown_remaining = 1;
        let projected = project_snapshot(
            campaign.id.clone(),
            world,
            restored.persistence_revision,
            &restored.state,
            &restored.events,
        )
        .unwrap();
        let ability = projected
            .view_model
            .actions
            .iter()
            .find(|value| value.action_id == world.data().ability_id)
            .unwrap();
        assert!(!ability.enabled);
        assert!(
            ability
                .disabled_reasons_zh_cn
                .contains(&"技能仍在冷却".to_owned())
        );
        let request = ability_submission_request(
            &restored.state,
            envelope(
                &after_reaction,
                CombatCommandPayload::UseAbility {
                    ability_id: world.data().ability_id.to_owned(),
                    target_id: Some(ENEMY_ID.to_owned()),
                },
            ),
            world.data(),
        );
        let preview = CombatSubmissionService::preview(&restored.state, &request).unwrap();
        let mut submitted_state = restored.state.clone();
        let mut ledger =
            AcceptedCommandLedger::restore(restored.accepted_commands.clone()).unwrap();
        let ember_combat_core::CombatSubmissionError::PreconditionsFailed(actual) =
            CombatSubmissionService::submit(&mut submitted_state, &mut ledger, request)
                .unwrap_err()
        else {
            panic!("cooldown should reject at the shared submission boundary");
        };
        assert_eq!(actual.failures, preview.preconditions.failures);
        assert_eq!(submitted_state, restored.state);

        let hero = restored
            .state
            .combatants
            .iter_mut()
            .find(|value| value.combatant_id == HERO_ID)
            .unwrap();
        hero.ability_usage[0].cooldown_remaining = 0;
        hero.action_points = 0;
        hero.resources
            .iter_mut()
            .find(|value| value.resource_id == world.data().resource_id)
            .unwrap()
            .current = 0;
        let projected = project_snapshot(
            campaign.id,
            world,
            restored.persistence_revision,
            &restored.state,
            &restored.events,
        )
        .unwrap();
        let ability = projected
            .view_model
            .actions
            .iter()
            .find(|value| value.action_id == world.data().ability_id)
            .unwrap();
        assert!(!ability.enabled);
        assert!(
            ability
                .disabled_reasons_zh_cn
                .contains(&"行动点不足".to_owned())
        );
        assert!(
            ability
                .disabled_reasons_zh_cn
                .contains(&"资源不足".to_owned())
        );
    }

    #[test]
    fn status_commit_rejects_mismatched_effect_and_trigger_without_mutating_state() {
        let (mut state, ledger) =
            initial_state("status-boundary", CombatSessionWorld::Fantasy).unwrap();
        let baseline = state.clone();
        let command = || CombatCommandEnvelope {
            command_id: "status-test-command".to_owned(),
            source: CombatCommandSource::InternalDeterministic {
                rule_id: "rule.status-test".to_owned(),
            },
            actor_id: HERO_ID.to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            payload: CombatCommandPayload::InternalRuleAction {
                rule_id: "rule.status-test".to_owned(),
                target_ids: vec![ENEMY_ID.to_owned()],
            },
        };
        let window = Some(ClockLifecycleWindow {
            clock: DurationClock::Round,
            clock_index: 1,
            tick_phase_passed: false,
            expiry_phase_passed: false,
        });
        let definition = marked_status_definition();
        assert!(
            EncounterRuleExecutor::commit_untriggered_status(
                &mut state,
                &ledger,
                command(),
                &EffectDefinition::ApplyStatus {
                    status_definition_id: "status.wrong".to_owned()
                },
                &definition,
                &GameplayTagCatalog::v0_4_1(),
                window,
            )
            .is_err()
        );
        assert_eq!(state, baseline);

        let mut triggered = definition.clone();
        triggered
            .triggers
            .push(ember_combat_core::StatusTriggerDefinition {
                trigger_id: "trigger.test".to_owned(),
                hook: ember_combat_core::StatusTriggerHook::StatusApplied,
                priority: 0,
                effects: vec![],
            });
        assert!(
            EncounterRuleExecutor::commit_untriggered_status(
                &mut state,
                &ledger,
                command(),
                &EffectDefinition::ApplyStatus {
                    status_definition_id: STATUS_ID.to_owned()
                },
                &triggered,
                &GameplayTagCatalog::v0_4_1(),
                window,
            )
            .is_err()
        );
        assert_eq!(state, baseline);
    }

    #[test]
    fn four_world_sessions_react_spend_apply_status_win_and_restore() {
        for world in [
            CombatSessionWorld::Cultivation,
            CombatSessionWorld::Fantasy,
            CombatSessionWorld::SciFi,
            CombatSessionWorld::Urban,
        ] {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join("combat.sqlite");
            let store = CampaignStore::open(&path).unwrap();
            let campaign = store.create_campaign().unwrap();
            let initial = store
                .start_or_restore_combat_session(&campaign.id, world)
                .unwrap();
            assert!(
                store
                    .load_combat_replay_input(&initial.view_model.combat_instance_id)
                    .unwrap()
                    .accepted_commands
                    .is_empty()
            );
            assert_eq!(
                store
                    .replay_active_combat_session(&campaign.id, world)
                    .unwrap()
                    .final_state,
                store
                    .restore_combat_checkpoint(&initial.view_model.combat_instance_id)
                    .unwrap()
                    .state
            );
            assert!(initial.view_model.pending_reaction.is_some());
            let reaction = initial.view_model.pending_reaction.as_ref().unwrap();
            let after_reaction = store
                .submit_combat_session_command(
                    &campaign.id,
                    world,
                    envelope(
                        &initial,
                        CombatCommandPayload::ResolveReaction {
                            reaction_window_id: reaction.reaction_window_id.clone(),
                            choice: ReactionDecisionChoice::Trigger,
                            selected_reaction_id: Some(REACTION_ID.to_owned()),
                        },
                    ),
                )
                .unwrap();
            assert!(after_reaction.view_model.pending_reaction.is_none());
            let first = store
                .submit_combat_session_command(
                    &campaign.id,
                    world,
                    envelope(
                        &after_reaction,
                        CombatCommandPayload::UseAbility {
                            ability_id: world.data().ability_id.to_owned(),
                            target_id: Some(ENEMY_ID.to_owned()),
                        },
                    ),
                )
                .unwrap();
            assert_eq!(
                first
                    .view_model
                    .combatants
                    .iter()
                    .find(|value| value.combatant_id == HERO_ID)
                    .unwrap()
                    .action_points
                    .current,
                2
            );
            assert_eq!(
                first
                    .view_model
                    .combatants
                    .iter()
                    .find(|value| value.combatant_id == ENEMY_ID)
                    .unwrap()
                    .statuses
                    .len(),
                1
            );
            let first_checkpoint = store
                .restore_combat_checkpoint(&first.view_model.combat_instance_id)
                .unwrap();
            assert_eq!(
                store
                    .replay_active_combat_session(&campaign.id, world)
                    .unwrap()
                    .final_state,
                first_checkpoint.state
            );
            assert!(
                first_checkpoint
                    .state
                    .provisional_delta
                    .entries
                    .iter()
                    .any(|entry| {
                        matches!(entry, ProvisionalDeltaEntry::StatusPresence {
                    combatant_id,
                    before: false,
                    after: true,
                    ..
                } if combatant_id == ENEMY_ID)
                    })
            );
            let first_hero = first_checkpoint
                .state
                .combatants
                .iter()
                .find(|value| value.combatant_id == HERO_ID)
                .unwrap();
            assert_eq!(first_hero.ability_usage[0].uses_this_normal_owner_turn, 1);
            assert_eq!(first_hero.ability_usage[0].uses_this_battle, 1);
            drop(store);
            let reopened = CampaignStore::open(&path).unwrap();
            let restored = reopened
                .start_or_restore_combat_session(&campaign.id, world)
                .unwrap();
            assert_eq!(restored.view_model, first.view_model);
            let final_snapshot = reopened
                .submit_combat_session_command(
                    &campaign.id,
                    world,
                    envelope(
                        &restored,
                        CombatCommandPayload::UseAbility {
                            ability_id: world.data().ability_id.to_owned(),
                            target_id: Some(ENEMY_ID.to_owned()),
                        },
                    ),
                )
                .unwrap();
            assert_eq!(
                final_snapshot.view_model.result.as_ref().unwrap().kind,
                ember_combat_presentation::CombatResultViewKind::Victory
            );
            let final_checkpoint = reopened
                .restore_combat_checkpoint(&final_snapshot.view_model.combat_instance_id)
                .unwrap();
            assert_eq!(
                reopened
                    .replay_active_combat_session(&campaign.id, world)
                    .unwrap()
                    .final_state,
                final_checkpoint.state
            );
            let final_hero = final_checkpoint
                .state
                .combatants
                .iter()
                .find(|value| value.combatant_id == HERO_ID)
                .unwrap();
            assert_eq!(final_hero.ability_usage[0].uses_this_normal_owner_turn, 2);
            assert_eq!(final_hero.ability_usage[0].uses_this_battle, 2);
            assert!(
                final_snapshot
                    .view_model
                    .combat_log
                    .iter()
                    .any(|entry| entry.kind
                        == ember_combat_presentation::CombatLogEntryKind::Reaction)
            );
            assert!(
                final_snapshot.view_model.combat_log.iter().any(
                    |entry| entry.kind == ember_combat_presentation::CombatLogEntryKind::Status
                )
            );
            let completion = reopened
                .complete_combat_session(&campaign.id, world)
                .unwrap();
            assert!(completion.checkpoint_removed);
            assert!(
                reopened
                    .load_combat_replay_input(&final_snapshot.view_model.combat_instance_id)
                    .is_ok()
            );
            assert!(matches!(
                reopened.restore_combat_checkpoint(&final_snapshot.view_model.combat_instance_id),
                Err(CombatPersistenceError::NotFound)
            ));
            let historical = reopened
                .load_combat_replay_input(&final_snapshot.view_model.combat_instance_id)
                .unwrap();
            assert!(matches!(
                reopened.start_or_restore_combat_session(&campaign.id, world),
                Err(CombatSessionError::Persistence(
                    CombatPersistenceError::ResultCommitConflict
                ))
            ));
            assert_eq!(
                reopened
                    .load_combat_replay_input(&final_snapshot.view_model.combat_instance_id)
                    .unwrap(),
                historical
            );
        }
    }

    fn envelope(
        snapshot: &CombatSessionSnapshot,
        payload: CombatCommandPayload,
    ) -> CombatCommandEnvelope {
        CombatCommandEnvelope {
            command_id: format!("command-{}", snapshot.view_model.state_revision),
            source: CombatCommandSource::Player {
                controller_id: CONTROLLER_ID.to_owned(),
            },
            actor_id: HERO_ID.to_owned(),
            versions: snapshot.view_model.versions,
            payload,
        }
    }
}
