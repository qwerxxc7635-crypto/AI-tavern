use std::{collections::BTreeMap, error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{
    COMBAT_FIXED_SCALE, CURRENT_COMBAT_VERSIONS, CombatResultType, CombatRng, CombatRngError,
    CombatRngSnapshot, CombatSide,
};

const SIMULATOR_VERSION: u32 = 1;
const MAX_SIMULATION_RUNS: u32 = 100_000;
const MAX_OBSERVATIONS_PER_RUN: usize = 1_000_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatSimulationConfig {
    pub simulation_id: String,
    pub base_seed: String,
    pub run_count: u32,
    pub max_rounds_per_run: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatSimulationRunContext {
    pub run_index: u32,
    pub combat_instance_id: String,
    pub max_rounds: u32,
    pub initial_rng: CombatRngSnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum CombatSimulationObservation {
    DamageApplied {
        source_side: CombatSide,
        amount: i64,
    },
    HealingApplied {
        source_side: CombatSide,
        amount: i64,
    },
    ResourceCommitted {
        source_side: CombatSide,
        amount: i64,
        effective_output: i64,
    },
    ControlOpportunity {
        target_side: CombatSide,
        controlled: bool,
    },
    CombatantDefeated {
        side: CombatSide,
        combatant_id: String,
    },
    UtilityDecision {
        actor_side: CombatSide,
        actor_id: String,
        ability_id: String,
        target_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatSimulationRunTrace {
    pub result: CombatResultType,
    pub completed_rounds: u32,
    pub initial_party_size: u32,
    pub final_rng: CombatRngSnapshot,
    pub observations: Vec<CombatSimulationObservation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatSimulationDecisionCount {
    pub actor_side: CombatSide,
    pub actor_id: String,
    pub ability_id: String,
    pub target_id: String,
    pub count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatSimulationRunSummary {
    pub run_index: u32,
    pub combat_instance_id: String,
    pub result: CombatResultType,
    pub completed_rounds: u32,
    pub initial_party_size: u32,
    pub party_damage: i64,
    pub party_healing: i64,
    pub party_resource_spent: i64,
    pub party_resource_effective_output: i64,
    pub hostile_control_opportunities: u64,
    pub hostile_controlled_opportunities: u64,
    pub party_deaths: u32,
    pub decision_counts: Vec<CombatSimulationDecisionCount>,
    pub final_rng: CombatRngSnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatSimulationOutcomeCounts {
    pub victory: u32,
    pub defeat: u32,
    pub escape: u32,
    pub scripted_victory: u32,
    pub scripted_defeat: u32,
    pub aborted: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatSimulationMetrics {
    pub rate_scale: i64,
    pub run_count: u32,
    pub outcome_counts: CombatSimulationOutcomeCounts,
    pub win_rate_scaled: i64,
    pub total_rounds: u64,
    pub average_rounds_scaled: i64,
    pub total_party_damage: i64,
    pub party_damage_per_round_scaled: i64,
    pub total_party_healing: i64,
    pub party_healing_per_round_scaled: i64,
    pub total_party_resource_spent: i64,
    pub total_party_resource_effective_output: i64,
    pub resource_efficiency_scaled: i64,
    pub hostile_control_opportunities: u64,
    pub hostile_controlled_opportunities: u64,
    pub control_uptime_scaled: i64,
    pub runs_with_party_death: u32,
    pub total_party_deaths: u64,
    pub total_initial_party_members: u64,
    pub party_death_incidence_scaled: i64,
    pub party_casualty_rate_scaled: i64,
    pub total_decisions: u64,
    pub distinct_decisions: u64,
    pub decision_variety_scaled: i64,
    pub decision_counts: Vec<CombatSimulationDecisionCount>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatSimulationReport {
    pub simulator_version: u32,
    pub config: CombatSimulationConfig,
    pub runs: Vec<CombatSimulationRunSummary>,
    pub metrics: CombatSimulationMetrics,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CombatSimulationErrorCode {
    InvalidConfig,
    RngInitialization,
    ExecutorFailed,
    InvalidRunTrace,
    ArithmeticOverflow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CombatSimulationError {
    pub code: CombatSimulationErrorCode,
    pub run_index: Option<u32>,
    pub subject: String,
}

impl fmt::Display for CombatSimulationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "combat simulation failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for CombatSimulationError {}

pub struct LightweightCombatSimulator;

impl LightweightCombatSimulator {
    pub fn run<E, F>(
        config: CombatSimulationConfig,
        mut execute: F,
    ) -> Result<CombatSimulationReport, CombatSimulationError>
    where
        E: fmt::Display,
        F: FnMut(&CombatSimulationRunContext) -> Result<CombatSimulationRunTrace, E>,
    {
        validate_config(&config)?;
        let mut summaries = Vec::with_capacity(config.run_count as usize);
        for run_index in 0..config.run_count {
            let combat_instance_id = format!("{}.simulation.{run_index}", config.simulation_id);
            let initial_rng = CombatRng::new(
                &config.base_seed,
                &combat_instance_id,
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .map_err(|error| rng_error(run_index, error))?
            .snapshot();
            let context = CombatSimulationRunContext {
                run_index,
                combat_instance_id,
                max_rounds: config.max_rounds_per_run,
                initial_rng,
            };
            let trace = execute(&context).map_err(|error| CombatSimulationError {
                code: CombatSimulationErrorCode::ExecutorFailed,
                run_index: Some(run_index),
                subject: error.to_string(),
            })?;
            summaries.push(summarize_run(&context, trace)?);
        }
        let metrics = aggregate_metrics(&summaries)?;
        Ok(CombatSimulationReport {
            simulator_version: SIMULATOR_VERSION,
            config,
            runs: summaries,
            metrics,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct DecisionKey {
    side_order: u8,
    actor_id: String,
    ability_id: String,
    target_id: String,
}

#[derive(Default)]
struct RunCounters {
    party_damage: i64,
    party_healing: i64,
    party_resource_spent: i64,
    party_resource_effective_output: i64,
    hostile_control_opportunities: u64,
    hostile_controlled_opportunities: u64,
    party_deaths: u32,
    decision_counts: BTreeMap<DecisionKey, u64>,
}

fn validate_config(config: &CombatSimulationConfig) -> Result<(), CombatSimulationError> {
    if !valid_id(&config.simulation_id)
        || config.run_count == 0
        || config.run_count > MAX_SIMULATION_RUNS
        || config.max_rounds_per_run == 0
    {
        return Err(simulation_error(
            CombatSimulationErrorCode::InvalidConfig,
            None,
            "config",
        ));
    }
    CombatRng::new(
        &config.base_seed,
        &config.simulation_id,
        CURRENT_COMBAT_VERSIONS.rng_contract_version,
    )
    .map_err(|_| simulation_error(CombatSimulationErrorCode::InvalidConfig, None, "baseSeed"))?;
    Ok(())
}

fn summarize_run(
    context: &CombatSimulationRunContext,
    trace: CombatSimulationRunTrace,
) -> Result<CombatSimulationRunSummary, CombatSimulationError> {
    if trace.observations.len() > MAX_OBSERVATIONS_PER_RUN
        || trace.initial_party_size == 0
        || trace.completed_rounds > context.max_rounds
        || (trace.completed_rounds == 0 && trace.result != CombatResultType::Aborted)
        || CombatRng::restore(trace.final_rng.clone()).is_err()
    {
        return Err(simulation_error(
            CombatSimulationErrorCode::InvalidRunTrace,
            Some(context.run_index),
            "trace",
        ));
    }
    let mut counters = RunCounters::default();
    let mut defeated_ids = BTreeMap::<String, CombatSide>::new();
    for observation in trace.observations {
        match observation {
            CombatSimulationObservation::DamageApplied {
                source_side,
                amount,
            } => {
                ensure_nonnegative(context.run_index, amount, "damage")?;
                if is_party(source_side) {
                    counters.party_damage = checked_i64_add(
                        counters.party_damage,
                        amount,
                        context.run_index,
                        "partyDamage",
                    )?;
                }
            }
            CombatSimulationObservation::HealingApplied {
                source_side,
                amount,
            } => {
                ensure_nonnegative(context.run_index, amount, "healing")?;
                if is_party(source_side) {
                    counters.party_healing = checked_i64_add(
                        counters.party_healing,
                        amount,
                        context.run_index,
                        "partyHealing",
                    )?;
                }
            }
            CombatSimulationObservation::ResourceCommitted {
                source_side,
                amount,
                effective_output,
            } => {
                ensure_nonnegative(context.run_index, amount, "resourceAmount")?;
                ensure_nonnegative(context.run_index, effective_output, "effectiveOutput")?;
                if is_party(source_side) {
                    counters.party_resource_spent = checked_i64_add(
                        counters.party_resource_spent,
                        amount,
                        context.run_index,
                        "partyResourceSpent",
                    )?;
                    counters.party_resource_effective_output = checked_i64_add(
                        counters.party_resource_effective_output,
                        effective_output,
                        context.run_index,
                        "partyResourceEffectiveOutput",
                    )?;
                }
            }
            CombatSimulationObservation::ControlOpportunity {
                target_side,
                controlled,
            } => {
                if target_side == CombatSide::Hostile {
                    counters.hostile_control_opportunities = counters
                        .hostile_control_opportunities
                        .checked_add(1)
                        .ok_or_else(|| overflow(context.run_index, "controlOpportunities"))?;
                    if controlled {
                        counters.hostile_controlled_opportunities = counters
                            .hostile_controlled_opportunities
                            .checked_add(1)
                            .ok_or_else(|| {
                                overflow(context.run_index, "controlledOpportunities")
                            })?;
                    }
                }
            }
            CombatSimulationObservation::CombatantDefeated { side, combatant_id } => {
                if !valid_id(&combatant_id) || defeated_ids.insert(combatant_id, side).is_some() {
                    return Err(simulation_error(
                        CombatSimulationErrorCode::InvalidRunTrace,
                        Some(context.run_index),
                        "defeatedCombatant",
                    ));
                }
                if is_party(side) {
                    counters.party_deaths = counters
                        .party_deaths
                        .checked_add(1)
                        .ok_or_else(|| overflow(context.run_index, "partyDeaths"))?;
                }
            }
            CombatSimulationObservation::UtilityDecision {
                actor_side,
                actor_id,
                ability_id,
                target_id,
            } => {
                if actor_side == CombatSide::Neutral
                    || !valid_id(&actor_id)
                    || !valid_id(&ability_id)
                    || !valid_id(&target_id)
                {
                    return Err(simulation_error(
                        CombatSimulationErrorCode::InvalidRunTrace,
                        Some(context.run_index),
                        "utilityDecision",
                    ));
                }
                let key = DecisionKey {
                    side_order: side_order(actor_side),
                    actor_id,
                    ability_id,
                    target_id,
                };
                let count = counters.decision_counts.entry(key).or_default();
                *count = count
                    .checked_add(1)
                    .ok_or_else(|| overflow(context.run_index, "decisionCount"))?;
            }
        }
    }
    if counters.party_deaths > trace.initial_party_size {
        return Err(simulation_error(
            CombatSimulationErrorCode::InvalidRunTrace,
            Some(context.run_index),
            "partyDeaths",
        ));
    }
    Ok(CombatSimulationRunSummary {
        run_index: context.run_index,
        combat_instance_id: context.combat_instance_id.clone(),
        result: trace.result,
        completed_rounds: trace.completed_rounds,
        initial_party_size: trace.initial_party_size,
        party_damage: counters.party_damage,
        party_healing: counters.party_healing,
        party_resource_spent: counters.party_resource_spent,
        party_resource_effective_output: counters.party_resource_effective_output,
        hostile_control_opportunities: counters.hostile_control_opportunities,
        hostile_controlled_opportunities: counters.hostile_controlled_opportunities,
        party_deaths: counters.party_deaths,
        decision_counts: decision_counts(counters.decision_counts),
        final_rng: trace.final_rng,
    })
}

fn aggregate_metrics(
    summaries: &[CombatSimulationRunSummary],
) -> Result<CombatSimulationMetrics, CombatSimulationError> {
    let mut outcomes = CombatSimulationOutcomeCounts {
        victory: 0,
        defeat: 0,
        escape: 0,
        scripted_victory: 0,
        scripted_defeat: 0,
        aborted: 0,
    };
    let mut total_rounds = 0_u64;
    let mut damage = 0_i64;
    let mut healing = 0_i64;
    let mut resource_spent = 0_i64;
    let mut resource_output = 0_i64;
    let mut control_opportunities = 0_u64;
    let mut controlled_opportunities = 0_u64;
    let mut runs_with_party_death = 0_u32;
    let mut party_deaths = 0_u64;
    let mut initial_party_members = 0_u64;
    let mut decisions = BTreeMap::<DecisionKey, u64>::new();
    for run in summaries {
        increment_outcome(&mut outcomes, run.result)?;
        total_rounds = checked_u64_add(total_rounds, u64::from(run.completed_rounds), "rounds")?;
        damage = checked_total_i64(damage, run.party_damage, "damage")?;
        healing = checked_total_i64(healing, run.party_healing, "healing")?;
        resource_spent = checked_total_i64(resource_spent, run.party_resource_spent, "resource")?;
        resource_output = checked_total_i64(
            resource_output,
            run.party_resource_effective_output,
            "resourceOutput",
        )?;
        control_opportunities = checked_u64_add(
            control_opportunities,
            run.hostile_control_opportunities,
            "controlOpportunities",
        )?;
        controlled_opportunities = checked_u64_add(
            controlled_opportunities,
            run.hostile_controlled_opportunities,
            "controlledOpportunities",
        )?;
        if run.party_deaths > 0 {
            runs_with_party_death = runs_with_party_death
                .checked_add(1)
                .ok_or_else(|| aggregate_overflow("deathIncidence"))?;
        }
        party_deaths = checked_u64_add(party_deaths, u64::from(run.party_deaths), "partyDeaths")?;
        initial_party_members = checked_u64_add(
            initial_party_members,
            u64::from(run.initial_party_size),
            "initialPartyMembers",
        )?;
        for count in &run.decision_counts {
            let key = DecisionKey {
                side_order: side_order(count.actor_side),
                actor_id: count.actor_id.clone(),
                ability_id: count.ability_id.clone(),
                target_id: count.target_id.clone(),
            };
            let total = decisions.entry(key).or_default();
            *total = total
                .checked_add(count.count)
                .ok_or_else(|| aggregate_overflow("decisionCount"))?;
        }
    }
    let total_decisions = decisions.values().try_fold(0_u64, |total, count| {
        total
            .checked_add(*count)
            .ok_or_else(|| aggregate_overflow("totalDecisions"))
    })?;
    let distinct_decisions =
        u64::try_from(decisions.len()).map_err(|_| aggregate_overflow("distinctDecisions"))?;
    let wins = u64::from(outcomes.victory) + u64::from(outcomes.scripted_victory);
    let run_count = u64::try_from(summaries.len()).map_err(|_| aggregate_overflow("runCount"))?;
    Ok(CombatSimulationMetrics {
        rate_scale: COMBAT_FIXED_SCALE,
        run_count: u32::try_from(run_count).map_err(|_| aggregate_overflow("runCount"))?,
        outcome_counts: outcomes,
        win_rate_scaled: scaled_ratio(wins, run_count, "winRate")?,
        total_rounds,
        average_rounds_scaled: scaled_ratio(total_rounds, run_count, "averageRounds")?,
        total_party_damage: damage,
        party_damage_per_round_scaled: scaled_ratio_i64(damage, total_rounds, "damagePerRound")?,
        total_party_healing: healing,
        party_healing_per_round_scaled: scaled_ratio_i64(healing, total_rounds, "healingPerRound")?,
        total_party_resource_spent: resource_spent,
        total_party_resource_effective_output: resource_output,
        resource_efficiency_scaled: scaled_ratio_i64(
            resource_output,
            u64::try_from(resource_spent).map_err(|_| aggregate_overflow("resourceSpent"))?,
            "resourceEfficiency",
        )?,
        hostile_control_opportunities: control_opportunities,
        hostile_controlled_opportunities: controlled_opportunities,
        control_uptime_scaled: scaled_ratio(
            controlled_opportunities,
            control_opportunities,
            "controlUptime",
        )?,
        runs_with_party_death,
        total_party_deaths: party_deaths,
        total_initial_party_members: initial_party_members,
        party_death_incidence_scaled: scaled_ratio(
            u64::from(runs_with_party_death),
            run_count,
            "deathIncidence",
        )?,
        party_casualty_rate_scaled: scaled_ratio(
            party_deaths,
            initial_party_members,
            "casualtyRate",
        )?,
        total_decisions,
        distinct_decisions,
        decision_variety_scaled: scaled_ratio(
            distinct_decisions,
            total_decisions,
            "decisionVariety",
        )?,
        decision_counts: decision_counts(decisions),
    })
}

fn decision_counts(counts: BTreeMap<DecisionKey, u64>) -> Vec<CombatSimulationDecisionCount> {
    counts
        .into_iter()
        .map(|(key, count)| CombatSimulationDecisionCount {
            actor_side: side_from_order(key.side_order),
            actor_id: key.actor_id,
            ability_id: key.ability_id,
            target_id: key.target_id,
            count,
        })
        .collect()
}

fn increment_outcome(
    counts: &mut CombatSimulationOutcomeCounts,
    result: CombatResultType,
) -> Result<(), CombatSimulationError> {
    let slot = match result {
        CombatResultType::Victory => &mut counts.victory,
        CombatResultType::Defeat => &mut counts.defeat,
        CombatResultType::Escape => &mut counts.escape,
        CombatResultType::ScriptedVictory => &mut counts.scripted_victory,
        CombatResultType::ScriptedDefeat => &mut counts.scripted_defeat,
        CombatResultType::Aborted => &mut counts.aborted,
    };
    *slot = slot
        .checked_add(1)
        .ok_or_else(|| aggregate_overflow("outcomeCount"))?;
    Ok(())
}

fn scaled_ratio(
    numerator: u64,
    denominator: u64,
    subject: &str,
) -> Result<i64, CombatSimulationError> {
    if denominator == 0 {
        return Ok(0);
    }
    let scaled = i128::from(numerator)
        .checked_mul(i128::from(COMBAT_FIXED_SCALE))
        .ok_or_else(|| aggregate_overflow(subject))?
        / i128::from(denominator);
    i64::try_from(scaled).map_err(|_| aggregate_overflow(subject))
}

fn scaled_ratio_i64(
    numerator: i64,
    denominator: u64,
    subject: &str,
) -> Result<i64, CombatSimulationError> {
    let numerator = u64::try_from(numerator).map_err(|_| aggregate_overflow(subject))?;
    scaled_ratio(numerator, denominator, subject)
}

fn checked_total_i64(left: i64, right: i64, subject: &str) -> Result<i64, CombatSimulationError> {
    left.checked_add(right)
        .ok_or_else(|| aggregate_overflow(subject))
}

fn checked_i64_add(
    left: i64,
    right: i64,
    run_index: u32,
    subject: &str,
) -> Result<i64, CombatSimulationError> {
    left.checked_add(right)
        .ok_or_else(|| overflow(run_index, subject))
}

fn checked_u64_add(left: u64, right: u64, subject: &str) -> Result<u64, CombatSimulationError> {
    left.checked_add(right)
        .ok_or_else(|| aggregate_overflow(subject))
}

fn ensure_nonnegative(
    run_index: u32,
    value: i64,
    subject: &str,
) -> Result<(), CombatSimulationError> {
    if value < 0 {
        Err(simulation_error(
            CombatSimulationErrorCode::InvalidRunTrace,
            Some(run_index),
            subject,
        ))
    } else {
        Ok(())
    }
}

fn is_party(side: CombatSide) -> bool {
    matches!(side, CombatSide::Player | CombatSide::Companion)
}

const fn side_order(side: CombatSide) -> u8 {
    match side {
        CombatSide::Player => 0,
        CombatSide::Companion => 1,
        CombatSide::Hostile => 2,
        CombatSide::Neutral => 3,
    }
}

const fn side_from_order(order: u8) -> CombatSide {
    match order {
        0 => CombatSide::Player,
        1 => CombatSide::Companion,
        2 => CombatSide::Hostile,
        _ => CombatSide::Neutral,
    }
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value.trim() == value
        && !value.chars().any(char::is_control)
}

fn rng_error(run_index: u32, error: CombatRngError) -> CombatSimulationError {
    simulation_error(
        CombatSimulationErrorCode::RngInitialization,
        Some(run_index),
        error.to_string(),
    )
}

fn overflow(run_index: u32, subject: &str) -> CombatSimulationError {
    simulation_error(
        CombatSimulationErrorCode::ArithmeticOverflow,
        Some(run_index),
        subject,
    )
}

fn aggregate_overflow(subject: &str) -> CombatSimulationError {
    simulation_error(CombatSimulationErrorCode::ArithmeticOverflow, None, subject)
}

fn simulation_error(
    code: CombatSimulationErrorCode,
    run_index: Option<u32>,
    subject: impl Into<String>,
) -> CombatSimulationError {
    CombatSimulationError {
        code,
        run_index,
        subject: subject.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::RngChannel;

    const SEED: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn batches_runs_and_reports_every_required_metric_with_exact_fixed_point_values() {
        let report = LightweightCombatSimulator::run(config(2), |context| {
            let mut rng = CombatRng::restore(context.initial_rng.clone()).unwrap();
            rng.roll_die(RngChannel::Resolution, 20).unwrap();
            let first = context.run_index == 0;
            Ok::<_, &'static str>(CombatSimulationRunTrace {
                result: if first {
                    CombatResultType::Victory
                } else {
                    CombatResultType::Defeat
                },
                completed_rounds: if first { 2 } else { 3 },
                initial_party_size: 2,
                final_rng: rng.snapshot(),
                observations: vec![
                    CombatSimulationObservation::DamageApplied {
                        source_side: CombatSide::Player,
                        amount: if first { 30 } else { 20 },
                    },
                    CombatSimulationObservation::HealingApplied {
                        source_side: CombatSide::Companion,
                        amount: 5,
                    },
                    CombatSimulationObservation::ResourceCommitted {
                        source_side: CombatSide::Player,
                        amount: 2,
                        effective_output: 3,
                    },
                    CombatSimulationObservation::ControlOpportunity {
                        target_side: CombatSide::Hostile,
                        controlled: first,
                    },
                    CombatSimulationObservation::UtilityDecision {
                        actor_side: CombatSide::Hostile,
                        actor_id: "enemy-a".to_owned(),
                        ability_id: if first { "attack" } else { "guard" }.to_owned(),
                        target_id: "hero".to_owned(),
                    },
                    CombatSimulationObservation::UtilityDecision {
                        actor_side: CombatSide::Hostile,
                        actor_id: "enemy-a".to_owned(),
                        ability_id: "attack".to_owned(),
                        target_id: "hero".to_owned(),
                    },
                    CombatSimulationObservation::CombatantDefeated {
                        side: if first {
                            CombatSide::Hostile
                        } else {
                            CombatSide::Player
                        },
                        combatant_id: if first { "enemy-a" } else { "hero" }.to_owned(),
                    },
                ],
            })
        })
        .unwrap();

        assert_eq!(report.simulator_version, 1);
        assert_eq!(report.runs.len(), 2);
        assert_eq!(report.metrics.outcome_counts.victory, 1);
        assert_eq!(report.metrics.outcome_counts.defeat, 1);
        assert_eq!(report.metrics.win_rate_scaled, 500_000);
        assert_eq!(report.metrics.total_rounds, 5);
        assert_eq!(report.metrics.average_rounds_scaled, 2_500_000);
        assert_eq!(report.metrics.total_party_damage, 50);
        assert_eq!(report.metrics.party_damage_per_round_scaled, 10_000_000);
        assert_eq!(report.metrics.total_party_healing, 10);
        assert_eq!(report.metrics.party_healing_per_round_scaled, 2_000_000);
        assert_eq!(report.metrics.resource_efficiency_scaled, 1_500_000);
        assert_eq!(report.metrics.control_uptime_scaled, 500_000);
        assert_eq!(report.metrics.party_death_incidence_scaled, 500_000);
        assert_eq!(report.metrics.party_casualty_rate_scaled, 250_000);
        assert_eq!(report.metrics.total_decisions, 4);
        assert_eq!(report.metrics.distinct_decisions, 2);
        assert_eq!(report.metrics.decision_variety_scaled, 500_000);
        assert_eq!(report.metrics.decision_counts[0].ability_id, "attack");
        assert_eq!(report.metrics.decision_counts[0].count, 3);
        assert_eq!(report.metrics.decision_counts[1].ability_id, "guard");
    }

    #[test]
    fn same_config_and_rules_trace_are_byte_identical_and_observation_order_is_normalized() {
        let run = |reverse: bool| {
            LightweightCombatSimulator::run(config(3), |context| {
                let mut observations = vec![
                    CombatSimulationObservation::UtilityDecision {
                        actor_side: CombatSide::Hostile,
                        actor_id: "enemy".to_owned(),
                        ability_id: "ability-b".to_owned(),
                        target_id: "hero".to_owned(),
                    },
                    CombatSimulationObservation::UtilityDecision {
                        actor_side: CombatSide::Hostile,
                        actor_id: "enemy".to_owned(),
                        ability_id: "ability-a".to_owned(),
                        target_id: "hero".to_owned(),
                    },
                ];
                if reverse {
                    observations.reverse();
                }
                Ok::<_, &'static str>(CombatSimulationRunTrace {
                    result: CombatResultType::Victory,
                    completed_rounds: 1,
                    initial_party_size: 1,
                    final_rng: context.initial_rng.clone(),
                    observations,
                })
            })
            .unwrap()
        };
        let forward = run(false);
        let reverse = run(true);
        assert_eq!(forward, reverse);
        assert_eq!(
            serde_json::to_vec(&forward).unwrap(),
            serde_json::to_vec(&reverse).unwrap()
        );
    }

    #[test]
    fn each_run_receives_an_isolated_zero_cursor_rng_without_harness_draws() {
        let report = LightweightCombatSimulator::run(config(4), |context| {
            assert!(
                context
                    .initial_rng
                    .streams
                    .iter()
                    .all(|stream| stream.cursor == 0)
            );
            Ok::<_, &'static str>(CombatSimulationRunTrace {
                result: CombatResultType::Aborted,
                completed_rounds: 0,
                initial_party_size: 1,
                final_rng: context.initial_rng.clone(),
                observations: vec![],
            })
        })
        .unwrap();
        let ids: std::collections::BTreeSet<_> = report
            .runs
            .iter()
            .map(|run| run.combat_instance_id.as_str())
            .collect();
        let states: std::collections::BTreeSet<_> = report
            .runs
            .iter()
            .map(|run| run.final_rng.streams[0].state_hex.as_str())
            .collect();
        assert_eq!(ids.len(), 4);
        assert_eq!(states.len(), 4);
    }

    #[test]
    fn invalid_config_and_invalid_trace_fail_closed() {
        let mut invalid = config(0);
        invalid.base_seed = "bad".to_owned();
        let error = LightweightCombatSimulator::run::<&'static str, _>(invalid, |_| unreachable!())
            .unwrap_err();
        assert_eq!(error.code, CombatSimulationErrorCode::InvalidConfig);
        assert_eq!(error.run_index, None);

        let error = LightweightCombatSimulator::run(config(1), |context| {
            Ok::<_, &'static str>(CombatSimulationRunTrace {
                result: CombatResultType::Victory,
                completed_rounds: context.max_rounds + 1,
                initial_party_size: 1,
                final_rng: context.initial_rng.clone(),
                observations: vec![],
            })
        })
        .unwrap_err();
        assert_eq!(error.code, CombatSimulationErrorCode::InvalidRunTrace);
        assert_eq!(error.run_index, Some(0));
    }

    #[test]
    fn malformed_observations_and_duplicate_defeats_are_rejected() {
        let trace = |context: &CombatSimulationRunContext| CombatSimulationRunTrace {
            result: CombatResultType::Defeat,
            completed_rounds: 1,
            initial_party_size: 1,
            final_rng: context.initial_rng.clone(),
            observations: vec![
                CombatSimulationObservation::CombatantDefeated {
                    side: CombatSide::Player,
                    combatant_id: "hero".to_owned(),
                },
                CombatSimulationObservation::CombatantDefeated {
                    side: CombatSide::Player,
                    combatant_id: "hero".to_owned(),
                },
            ],
        };
        let error = LightweightCombatSimulator::run(config(1), |context| {
            Ok::<_, &'static str>(trace(context))
        })
        .unwrap_err();
        assert_eq!(error.code, CombatSimulationErrorCode::InvalidRunTrace);

        let error = LightweightCombatSimulator::run(config(1), |context| {
            Ok::<_, &'static str>(CombatSimulationRunTrace {
                result: CombatResultType::Victory,
                completed_rounds: 1,
                initial_party_size: 1,
                final_rng: context.initial_rng.clone(),
                observations: vec![CombatSimulationObservation::DamageApplied {
                    source_side: CombatSide::Player,
                    amount: -1,
                }],
            })
        })
        .unwrap_err();
        assert_eq!(error.code, CombatSimulationErrorCode::InvalidRunTrace);
    }

    #[test]
    fn executor_failure_is_attributed_and_stops_the_batch() {
        let mut calls = 0;
        let error = LightweightCombatSimulator::run(config(5), |context| {
            calls += 1;
            if context.run_index == 2 {
                return Err("engine stopped");
            }
            Ok(CombatSimulationRunTrace {
                result: CombatResultType::Victory,
                completed_rounds: 1,
                initial_party_size: 1,
                final_rng: context.initial_rng.clone(),
                observations: vec![],
            })
        })
        .unwrap_err();
        assert_eq!(calls, 3);
        assert_eq!(error.code, CombatSimulationErrorCode::ExecutorFailed);
        assert_eq!(error.run_index, Some(2));
        assert_eq!(error.subject, "engine stopped");
    }

    fn config(run_count: u32) -> CombatSimulationConfig {
        CombatSimulationConfig {
            simulation_id: "balance-smoke".to_owned(),
            base_seed: SEED.to_owned(),
            run_count,
            max_rounds_per_run: 20,
        }
    }
}
