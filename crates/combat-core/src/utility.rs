use std::{collections::BTreeSet, error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{
    CombatState, CombatStateInvariantValidator, CombatantRuntime, CombatantState, GameplayTagId,
};

const WEIGHT_SCALE: i64 = 100;
const MAX_WEIGHT: i64 = 10_000;
const MAX_ADJUSTMENT: i64 = 10_000;
const MAX_CANDIDATES: usize = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UtilityActionCategory {
    Damage,
    Control,
    Heal,
    Defense,
    Resource,
    Escape,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UtilityWeights {
    pub damage: i64,
    pub kill: i64,
    pub control: i64,
    pub heal: i64,
    pub defense: i64,
    pub resource: i64,
    pub risk: i64,
    pub intent: i64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UtilityWeightAdjustments {
    pub damage: i64,
    pub kill: i64,
    pub control: i64,
    pub heal: i64,
    pub defense: i64,
    pub resource: i64,
    pub risk: i64,
    pub intent: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BaseUtilityProfile {
    pub profile_id: String,
    pub weights: UtilityWeights,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UtilityPersonality {
    pub personality_id: String,
    pub adjustments: UtilityWeightAdjustments,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UtilityStrategy {
    pub strategy_id: String,
    pub adjustments: UtilityWeightAdjustments,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UtilityPreferences {
    pub preferred_tags: Vec<GameplayTagId>,
    pub avoided_tags: Vec<GameplayTagId>,
    pub preferred_tag_bonus: i64,
    pub avoided_tag_penalty: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UtilityIntentConstraints {
    pub allowed_categories: Vec<UtilityActionCategory>,
    pub preferred_category: Option<UtilityActionCategory>,
    pub preferred_category_bonus: i64,
    pub non_preferred_category_penalty: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UtilityCandidateProjection {
    pub damage_amount: i64,
    pub healing_amount: i64,
    pub defense_amount: i64,
    pub resource_amount: i64,
    pub control_basis_points: u32,
    pub risk_basis_points: u32,
    pub base_intent_score: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegalUtilityCommand {
    pub ability_id: String,
    pub target_id: String,
    pub category: UtilityActionCategory,
    pub tags: Vec<GameplayTagId>,
    pub tactical_priority: i64,
    pub projection: UtilityCandidateProjection,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UtilityEvaluationRequest<'a> {
    pub state: &'a CombatState,
    pub actor_id: &'a str,
    pub legal_commands: &'a [LegalUtilityCommand],
    pub base_profile: &'a BaseUtilityProfile,
    pub personality: &'a UtilityPersonality,
    pub strategy: Option<&'a UtilityStrategy>,
    pub preferences: &'a UtilityPreferences,
    pub intent_constraints: &'a UtilityIntentConstraints,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UtilityScoreBreakdown {
    pub damage_score: i64,
    pub kill_score: i64,
    pub control_score: i64,
    pub heal_score: i64,
    pub defense_score: i64,
    pub resource_score: i64,
    pub risk_score: i64,
    pub intent_score: i64,
    pub total_score: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UtilityScoredCommand {
    pub command: LegalUtilityCommand,
    pub score: UtilityScoreBreakdown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UtilityEvaluationResult {
    pub combined_weights: UtilityWeights,
    pub candidates: Vec<UtilityScoredCommand>,
}

pub struct SharedUtilityEvaluator;

impl SharedUtilityEvaluator {
    pub fn evaluate(
        request: &UtilityEvaluationRequest<'_>,
    ) -> Result<UtilityEvaluationResult, UtilityEvaluationError> {
        CombatStateInvariantValidator::validate(request.state).map_err(|_| {
            utility_error(
                UtilityEvaluationErrorCode::InvalidCombatState,
                "combatState",
            )
        })?;
        validate_request(request)?;
        let actor = combatant(request.state, request.actor_id).ok_or_else(|| {
            utility_error(
                UtilityEvaluationErrorCode::UnknownCombatant,
                request.actor_id,
            )
        })?;
        if actor.state != CombatantState::Active {
            return Err(utility_error(
                UtilityEvaluationErrorCode::InactiveActor,
                request.actor_id,
            ));
        }
        let combined_weights = combine_weights(
            request.base_profile.weights,
            request.personality.adjustments,
            request.strategy.map(|value| value.adjustments),
        )?;

        let mut candidates = Vec::with_capacity(request.legal_commands.len());
        let mut identities = BTreeSet::new();
        for command in request.legal_commands {
            validate_command(command)?;
            if !identities.insert((command.ability_id.as_str(), command.target_id.as_str())) {
                return Err(utility_error(
                    UtilityEvaluationErrorCode::DuplicateCandidate,
                    format!("{}:{}", command.ability_id, command.target_id),
                ));
            }
            if !request.intent_constraints.allowed_categories.is_empty()
                && !request
                    .intent_constraints
                    .allowed_categories
                    .contains(&command.category)
            {
                continue;
            }
            let target = combatant(request.state, &command.target_id).ok_or_else(|| {
                utility_error(
                    UtilityEvaluationErrorCode::UnknownCombatant,
                    &command.target_id,
                )
            })?;
            let score = score_command(
                command,
                target,
                combined_weights,
                request.preferences,
                request.intent_constraints,
            )?;
            candidates.push(UtilityScoredCommand {
                command: command.clone(),
                score,
            });
        }

        candidates.sort_by(|left, right| {
            right
                .score
                .total_score
                .cmp(&left.score.total_score)
                .then_with(|| {
                    right
                        .command
                        .tactical_priority
                        .cmp(&left.command.tactical_priority)
                })
                .then_with(|| left.command.ability_id.cmp(&right.command.ability_id))
                .then_with(|| left.command.target_id.cmp(&right.command.target_id))
        });
        Ok(UtilityEvaluationResult {
            combined_weights,
            candidates,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UtilityEvaluationErrorCode {
    InvalidCombatState,
    InvalidProfile,
    InvalidPersonality,
    InvalidStrategy,
    InvalidPreferences,
    InvalidIntentConstraints,
    InvalidCandidate,
    DuplicateCandidate,
    UnknownCombatant,
    InactiveActor,
    NumericOverflow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UtilityEvaluationError {
    pub code: UtilityEvaluationErrorCode,
    pub subject: String,
}

impl fmt::Display for UtilityEvaluationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "utility evaluation failed for {}: {:?}",
            self.subject, self.code
        )
    }
}

impl Error for UtilityEvaluationError {}

fn validate_request(request: &UtilityEvaluationRequest<'_>) -> Result<(), UtilityEvaluationError> {
    if !valid_stable_id(request.actor_id)
        || request.legal_commands.is_empty()
        || request.legal_commands.len() > MAX_CANDIDATES
    {
        return Err(utility_error(
            UtilityEvaluationErrorCode::InvalidCandidate,
            "legalCommands",
        ));
    }
    if !valid_stable_id(&request.base_profile.profile_id)
        || !valid_base_weights(request.base_profile.weights)
    {
        return Err(utility_error(
            UtilityEvaluationErrorCode::InvalidProfile,
            &request.base_profile.profile_id,
        ));
    }
    if !valid_stable_id(&request.personality.personality_id)
        || !valid_adjustments(request.personality.adjustments)
    {
        return Err(utility_error(
            UtilityEvaluationErrorCode::InvalidPersonality,
            &request.personality.personality_id,
        ));
    }
    if request.strategy.is_some_and(|strategy| {
        !valid_stable_id(&strategy.strategy_id) || !valid_adjustments(strategy.adjustments)
    }) {
        return Err(utility_error(
            UtilityEvaluationErrorCode::InvalidStrategy,
            "strategy",
        ));
    }
    validate_preferences(request.preferences)?;
    validate_intent(request.intent_constraints)
}

fn validate_command(command: &LegalUtilityCommand) -> Result<(), UtilityEvaluationError> {
    let projection = &command.projection;
    if !valid_stable_id(&command.ability_id)
        || !valid_stable_id(&command.target_id)
        || command.tactical_priority.unsigned_abs() > MAX_ADJUSTMENT as u64
        || [
            projection.damage_amount,
            projection.healing_amount,
            projection.defense_amount,
            projection.resource_amount,
        ]
        .iter()
        .any(|value| *value < 0)
        || projection.control_basis_points > 10_000
        || projection.risk_basis_points > 10_000
        || projection.base_intent_score.unsigned_abs() > MAX_ADJUSTMENT as u64
        || !canonical_tags(&command.tags)
    {
        return Err(utility_error(
            UtilityEvaluationErrorCode::InvalidCandidate,
            &command.ability_id,
        ));
    }
    Ok(())
}

fn validate_preferences(preferences: &UtilityPreferences) -> Result<(), UtilityEvaluationError> {
    if !canonical_tags(&preferences.preferred_tags)
        || !canonical_tags(&preferences.avoided_tags)
        || preferences.preferred_tag_bonus < 0
        || preferences.preferred_tag_bonus > MAX_ADJUSTMENT
        || preferences.avoided_tag_penalty < 0
        || preferences.avoided_tag_penalty > MAX_ADJUSTMENT
        || preferences
            .preferred_tags
            .iter()
            .any(|tag| preferences.avoided_tags.contains(tag))
    {
        return Err(utility_error(
            UtilityEvaluationErrorCode::InvalidPreferences,
            "preferences",
        ));
    }
    Ok(())
}

fn validate_intent(intent: &UtilityIntentConstraints) -> Result<(), UtilityEvaluationError> {
    if intent
        .allowed_categories
        .windows(2)
        .any(|pair| pair[0] >= pair[1])
        || intent.preferred_category_bonus < 0
        || intent.preferred_category_bonus > MAX_ADJUSTMENT
        || intent.non_preferred_category_penalty < 0
        || intent.non_preferred_category_penalty > MAX_ADJUSTMENT
        || intent.preferred_category.is_some_and(|preferred| {
            !intent.allowed_categories.is_empty() && !intent.allowed_categories.contains(&preferred)
        })
    {
        return Err(utility_error(
            UtilityEvaluationErrorCode::InvalidIntentConstraints,
            "intentConstraints",
        ));
    }
    Ok(())
}

fn score_command(
    command: &LegalUtilityCommand,
    target: &CombatantRuntime,
    weights: UtilityWeights,
    preferences: &UtilityPreferences,
    intent: &UtilityIntentConstraints,
) -> Result<UtilityScoreBreakdown, UtilityEvaluationError> {
    let projection = &command.projection;
    let effective_damage = projection.damage_amount.min(target.hit_points);
    let kill_value = if projection.damage_amount >= target.hit_points && target.hit_points > 0 {
        100
    } else {
        0
    };
    let missing_health = target.max_hit_points - target.hit_points;
    let effective_healing = projection.healing_amount.min(missing_health);
    let missing_shield = target.max_shield - target.shield;
    let effective_defense = projection.defense_amount.min(missing_shield);
    let effective_resource = resource_value(target, projection.resource_amount);
    let control_value = i64::from(projection.control_basis_points / 100);
    let risk_value = -i64::from(projection.risk_basis_points / 100);
    let preference_value = preference_value(command, preferences)?;
    let intent_value = checked_add(
        projection.base_intent_score,
        checked_add(
            preference_value,
            category_intent_value(command.category, intent)?,
        )?,
    )?;

    let damage_score = weighted(effective_damage, weights.damage)?;
    let kill_score = weighted(kill_value, weights.kill)?;
    let control_score = weighted(control_value, weights.control)?;
    let heal_score = weighted(effective_healing, weights.heal)?;
    let defense_score = weighted(effective_defense, weights.defense)?;
    let resource_score = weighted(effective_resource, weights.resource)?;
    let risk_score = weighted(risk_value, weights.risk)?;
    let intent_score = weighted(intent_value, weights.intent)?;
    let total_score = [
        damage_score,
        kill_score,
        control_score,
        heal_score,
        defense_score,
        resource_score,
        risk_score,
        intent_score,
    ]
    .into_iter()
    .try_fold(0_i64, checked_add)?;
    Ok(UtilityScoreBreakdown {
        damage_score,
        kill_score,
        control_score,
        heal_score,
        defense_score,
        resource_score,
        risk_score,
        intent_score,
        total_score,
    })
}

fn resource_value(actor: &CombatantRuntime, projected: i64) -> i64 {
    let largest_missing = actor
        .resources
        .iter()
        .map(|resource| resource.max_value - resource.current)
        .max()
        .unwrap_or(projected);
    projected.min(largest_missing.max(0))
}

fn preference_value(
    command: &LegalUtilityCommand,
    preferences: &UtilityPreferences,
) -> Result<i64, UtilityEvaluationError> {
    let preferred_matches = command
        .tags
        .iter()
        .filter(|tag| preferences.preferred_tags.contains(tag))
        .count();
    let avoided_matches = command
        .tags
        .iter()
        .filter(|tag| preferences.avoided_tags.contains(tag))
        .count();
    let preferred = checked_mul_count(preferences.preferred_tag_bonus, preferred_matches)?;
    let avoided = checked_mul_count(preferences.avoided_tag_penalty, avoided_matches)?;
    checked_add(preferred, -avoided)
}

fn category_intent_value(
    category: UtilityActionCategory,
    intent: &UtilityIntentConstraints,
) -> Result<i64, UtilityEvaluationError> {
    match intent.preferred_category {
        Some(preferred) if preferred == category => Ok(intent.preferred_category_bonus),
        Some(_) => Ok(-intent.non_preferred_category_penalty),
        None => Ok(0),
    }
}

fn combine_weights(
    base: UtilityWeights,
    personality: UtilityWeightAdjustments,
    strategy: Option<UtilityWeightAdjustments>,
) -> Result<UtilityWeights, UtilityEvaluationError> {
    let strategy = strategy.unwrap_or_default();
    Ok(UtilityWeights {
        damage: combined_weight(base.damage, personality.damage, strategy.damage)?,
        kill: combined_weight(base.kill, personality.kill, strategy.kill)?,
        control: combined_weight(base.control, personality.control, strategy.control)?,
        heal: combined_weight(base.heal, personality.heal, strategy.heal)?,
        defense: combined_weight(base.defense, personality.defense, strategy.defense)?,
        resource: combined_weight(base.resource, personality.resource, strategy.resource)?,
        risk: combined_weight(base.risk, personality.risk, strategy.risk)?,
        intent: combined_weight(base.intent, personality.intent, strategy.intent)?,
    })
}

fn combined_weight(base: i64, first: i64, second: i64) -> Result<i64, UtilityEvaluationError> {
    Ok(checked_add(checked_add(base, first)?, second)?.clamp(0, MAX_WEIGHT))
}

fn weighted(value: i64, weight: i64) -> Result<i64, UtilityEvaluationError> {
    let product = i128::from(value) * i128::from(weight);
    i64::try_from(product / i128::from(WEIGHT_SCALE))
        .map_err(|_| utility_error(UtilityEvaluationErrorCode::NumericOverflow, "weightedScore"))
}

fn checked_add(left: i64, right: i64) -> Result<i64, UtilityEvaluationError> {
    left.checked_add(right)
        .ok_or_else(|| utility_error(UtilityEvaluationErrorCode::NumericOverflow, "utilityScore"))
}

fn checked_mul_count(value: i64, count: usize) -> Result<i64, UtilityEvaluationError> {
    let count = i64::try_from(count).map_err(|_| {
        utility_error(
            UtilityEvaluationErrorCode::NumericOverflow,
            "preferenceCount",
        )
    })?;
    value.checked_mul(count).ok_or_else(|| {
        utility_error(
            UtilityEvaluationErrorCode::NumericOverflow,
            "preferenceScore",
        )
    })
}

fn valid_base_weights(weights: UtilityWeights) -> bool {
    [
        weights.damage,
        weights.kill,
        weights.control,
        weights.heal,
        weights.defense,
        weights.resource,
        weights.risk,
        weights.intent,
    ]
    .into_iter()
    .all(|weight| (0..=MAX_WEIGHT).contains(&weight))
}

fn valid_adjustments(adjustments: UtilityWeightAdjustments) -> bool {
    [
        adjustments.damage,
        adjustments.kill,
        adjustments.control,
        adjustments.heal,
        adjustments.defense,
        adjustments.resource,
        adjustments.risk,
        adjustments.intent,
    ]
    .into_iter()
    .all(|weight| weight.unsigned_abs() <= MAX_ADJUSTMENT as u64)
}

fn canonical_tags(tags: &[GameplayTagId]) -> bool {
    tags.windows(2).all(|pair| pair[0] < pair[1])
}

fn combatant<'a>(state: &'a CombatState, id: &str) -> Option<&'a CombatantRuntime> {
    state
        .combatants
        .iter()
        .find(|combatant| combatant.combatant_id == id)
}

fn valid_stable_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b':'))
}

fn utility_error(
    code: UtilityEvaluationErrorCode,
    subject: impl Into<String>,
) -> UtilityEvaluationError {
    UtilityEvaluationError {
        code,
        subject: subject.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CURRENT_COMBAT_VERSIONS, CombatPhase, CombatRng, CombatSide, HardCcDrRuntime,
        ObjectiveRuntimeState, ProvisionalRuntimeDelta, ReinforcementRuntimeState, ResourceState,
        RoundRuntimeState, ShieldRechargeRuntime, TerminalPriorityPolicy,
    };

    const SEED: &str = "00112233445566778899aabbccddeeff";

    #[test]
    fn identical_inputs_produce_identical_scores_order_and_bytes_without_rng_mutation() {
        let state = state();
        let before = serde_json::to_vec(&state).unwrap();
        let mut commands = commands();
        let first = evaluate(&state, &commands, layers()).unwrap();
        commands.reverse();
        let second = evaluate(&state, &commands, layers()).unwrap();
        assert_eq!(first, second);
        assert_eq!(
            serde_json::to_vec(&first).unwrap(),
            serde_json::to_vec(&second).unwrap()
        );
        assert_eq!(serde_json::to_vec(&state).unwrap(), before);
        assert_eq!(first.candidates[0].command.ability_id, "ability.finisher");
    }

    #[test]
    fn state_health_and_shield_gaps_bound_effective_utility() {
        let mut state = state();
        let result = evaluate(&state, &commands(), layers()).unwrap();
        let heal = scored(&result, "ability.heal");
        assert_eq!(heal.score.heal_score, 7);
        let guard = scored(&result, "ability.guard");
        assert_eq!(guard.score.defense_score, 3);

        let ally = state
            .combatants
            .iter_mut()
            .find(|value| value.combatant_id == "ally")
            .unwrap();
        ally.hit_points = ally.max_hit_points;
        ally.shield = ally.max_shield;
        let full = evaluate(&state, &commands(), layers()).unwrap();
        assert_eq!(scored(&full, "ability.heal").score.heal_score, 0);
        assert_eq!(scored(&full, "ability.guard").score.defense_score, 0);
    }

    #[test]
    fn every_weight_layer_preference_and_intent_changes_the_explainable_score() {
        let state = state();
        let (profile, personality, strategy, preferences, intent) = layers();
        let result = evaluate(
            &state,
            &commands(),
            (
                profile.clone(),
                personality.clone(),
                strategy.clone(),
                preferences.clone(),
                intent.clone(),
            ),
        )
        .unwrap();
        assert_eq!(result.combined_weights.damage, 160);
        assert_eq!(result.combined_weights.heal, 140);
        let finisher = scored(&result, "ability.finisher");
        assert_eq!(finisher.score.kill_score, 100);
        assert!(finisher.score.intent_score > 0);

        let mut constrained = intent.clone();
        constrained.allowed_categories = vec![UtilityActionCategory::Heal];
        constrained.preferred_category = Some(UtilityActionCategory::Heal);
        let filtered = evaluate(
            &state,
            &commands(),
            (profile, personality, strategy, preferences, constrained),
        )
        .unwrap();
        assert_eq!(filtered.candidates.len(), 1);
        assert_eq!(
            filtered.candidates[0].command.category,
            UtilityActionCategory::Heal
        );
    }

    #[test]
    fn breakdown_covers_all_eight_frozen_utility_families() {
        let state = state();
        let command = command(
            "ability.composite",
            "ally",
            UtilityActionCategory::Damage,
            UtilityCandidateProjection {
                damage_amount: 5,
                healing_amount: 3,
                defense_amount: 2,
                resource_amount: 4,
                control_basis_points: 2_500,
                risk_basis_points: 1_000,
                base_intent_score: 10,
            },
        );
        let result = evaluate(&state, &[command], layers()).unwrap();
        let score = &result.candidates[0].score;
        assert_eq!(score.damage_score, 8);
        assert_eq!(score.kill_score, 100);
        assert_eq!(score.control_score, 25);
        assert_eq!(score.heal_score, 4);
        assert_eq!(score.defense_score, 2);
        assert_eq!(score.resource_score, 4);
        assert_eq!(score.risk_score, -10);
        assert_eq!(score.intent_score, 60);
        assert_eq!(score.total_score, 193);
    }

    #[test]
    fn exact_ties_use_tactical_priority_then_stable_ability_and_target_ids() {
        let state = state();
        let base = command(
            "ability.zeta",
            "enemy",
            UtilityActionCategory::Damage,
            projection(0, 0, 0),
        );
        let mut tactical = base.clone();
        tactical.ability_id = "ability.tactical".to_owned();
        tactical.tactical_priority = 1;
        let mut alpha = base.clone();
        alpha.ability_id = "ability.alpha".to_owned();
        let result = evaluate(&state, &[base, alpha, tactical], neutral_layers()).unwrap();
        assert_eq!(result.candidates[0].command.ability_id, "ability.tactical");
        assert_eq!(result.candidates[1].command.ability_id, "ability.alpha");
        assert_eq!(result.candidates[2].command.ability_id, "ability.zeta");
    }

    #[test]
    fn malformed_layers_candidates_and_state_fail_closed() {
        let state = state();
        let (mut profile, personality, strategy, preferences, intent) = layers();
        profile.weights.damage = -1;
        assert_eq!(
            evaluate(
                &state,
                &commands(),
                (profile, personality, strategy, preferences, intent)
            )
            .unwrap_err()
            .code,
            UtilityEvaluationErrorCode::InvalidProfile
        );

        let mut duplicate = commands();
        duplicate.push(duplicate[0].clone());
        assert_eq!(
            evaluate(&state, &duplicate, neutral_layers())
                .unwrap_err()
                .code,
            UtilityEvaluationErrorCode::DuplicateCandidate
        );

        let mut invalid_state = state.clone();
        invalid_state.combatants[0].hit_points = -1;
        assert_eq!(
            evaluate(&invalid_state, &commands(), neutral_layers())
                .unwrap_err()
                .code,
            UtilityEvaluationErrorCode::InvalidCombatState
        );
    }

    fn evaluate(
        state: &CombatState,
        commands: &[LegalUtilityCommand],
        layers: (
            BaseUtilityProfile,
            UtilityPersonality,
            UtilityStrategy,
            UtilityPreferences,
            UtilityIntentConstraints,
        ),
    ) -> Result<UtilityEvaluationResult, UtilityEvaluationError> {
        SharedUtilityEvaluator::evaluate(&UtilityEvaluationRequest {
            state,
            actor_id: "ally",
            legal_commands: commands,
            base_profile: &layers.0,
            personality: &layers.1,
            strategy: Some(&layers.2),
            preferences: &layers.3,
            intent_constraints: &layers.4,
        })
    }

    fn layers() -> (
        BaseUtilityProfile,
        UtilityPersonality,
        UtilityStrategy,
        UtilityPreferences,
        UtilityIntentConstraints,
    ) {
        (
            BaseUtilityProfile {
                profile_id: "profile.shared".to_owned(),
                weights: UtilityWeights {
                    damage: 100,
                    kill: 100,
                    control: 100,
                    heal: 100,
                    defense: 100,
                    resource: 100,
                    risk: 100,
                    intent: 100,
                },
            },
            UtilityPersonality {
                personality_id: "personality.bold".to_owned(),
                adjustments: UtilityWeightAdjustments {
                    damage: 20,
                    heal: -10,
                    ..UtilityWeightAdjustments::default()
                },
            },
            UtilityStrategy {
                strategy_id: "strategy.aggressive".to_owned(),
                adjustments: UtilityWeightAdjustments {
                    damage: 40,
                    heal: 50,
                    ..UtilityWeightAdjustments::default()
                },
            },
            UtilityPreferences {
                preferred_tags: vec![GameplayTagId::new("Ability.Attack").unwrap()],
                avoided_tags: vec![GameplayTagId::new("Ability.Defensive").unwrap()],
                preferred_tag_bonus: 20,
                avoided_tag_penalty: 10,
            },
            UtilityIntentConstraints {
                allowed_categories: vec![],
                preferred_category: Some(UtilityActionCategory::Damage),
                preferred_category_bonus: 30,
                non_preferred_category_penalty: 5,
            },
        )
    }

    fn neutral_layers() -> (
        BaseUtilityProfile,
        UtilityPersonality,
        UtilityStrategy,
        UtilityPreferences,
        UtilityIntentConstraints,
    ) {
        let (mut profile, personality, strategy, mut preferences, mut intent) = layers();
        profile.weights = UtilityWeights {
            damage: 0,
            kill: 0,
            control: 0,
            heal: 0,
            defense: 0,
            resource: 0,
            risk: 0,
            intent: 0,
        };
        preferences.preferred_tags.clear();
        preferences.avoided_tags.clear();
        intent.preferred_category = None;
        (profile, personality, strategy, preferences, intent)
    }

    fn commands() -> Vec<LegalUtilityCommand> {
        vec![
            command(
                "ability.heal",
                "ally",
                UtilityActionCategory::Heal,
                projection(0, 10, 0),
            ),
            command(
                "ability.guard",
                "ally",
                UtilityActionCategory::Defense,
                projection(0, 0, 10),
            ),
            command(
                "ability.finisher",
                "enemy",
                UtilityActionCategory::Damage,
                projection(8, 0, 0),
            ),
        ]
    }

    fn command(
        ability_id: &str,
        target_id: &str,
        category: UtilityActionCategory,
        projection: UtilityCandidateProjection,
    ) -> LegalUtilityCommand {
        let tags = match category {
            UtilityActionCategory::Damage => {
                vec![GameplayTagId::new("Ability.Attack").unwrap()]
            }
            UtilityActionCategory::Defense => {
                vec![GameplayTagId::new("Ability.Defensive").unwrap()]
            }
            UtilityActionCategory::Heal => vec![GameplayTagId::new("Ability.Heal").unwrap()],
            UtilityActionCategory::Control
            | UtilityActionCategory::Resource
            | UtilityActionCategory::Escape => vec![],
        };
        LegalUtilityCommand {
            ability_id: ability_id.to_owned(),
            target_id: target_id.to_owned(),
            category,
            tags,
            tactical_priority: 0,
            projection,
        }
    }

    fn projection(
        damage_amount: i64,
        healing_amount: i64,
        defense_amount: i64,
    ) -> UtilityCandidateProjection {
        UtilityCandidateProjection {
            damage_amount,
            healing_amount,
            defense_amount,
            resource_amount: 0,
            control_basis_points: 0,
            risk_basis_points: 0,
            base_intent_score: 0,
        }
    }

    fn state() -> CombatState {
        CombatState {
            combat_instance_id: "combat-utility-fixture".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            random_seed: SEED.to_owned(),
            revision: 1,
            last_committed_sequence: 0,
            phase: CombatPhase::Stable,
            combatants: vec![
                combatant("ally", CombatSide::Companion, 5, 0),
                combatant("enemy", CombatSide::Hostile, 6, 0),
            ],
            formal_party_member_ids: vec!["ally".to_owned()],
            combat_inventory: vec![],
            cost_reservations: vec![],
            resolution_context: None,
            timeline: vec![],
            round: RoundRuntimeState {
                round_number: 1,
                completed_round_count: 0,
                active_combatant_id: None,
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
                "combat-utility-fixture",
                CURRENT_COMBAT_VERSIONS.rng_contract_version,
            )
            .unwrap()
            .snapshot(),
        }
    }

    fn combatant(id: &str, side: CombatSide, hit_points: i64, shield: i64) -> CombatantRuntime {
        CombatantRuntime {
            combatant_id: id.to_owned(),
            definition_id: format!("definition-{id}"),
            side,
            state: CombatantState::Active,
            hit_points,
            max_hit_points: 10,
            shield,
            max_shield: 3,
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

    fn scored<'a>(
        result: &'a UtilityEvaluationResult,
        ability_id: &str,
    ) -> &'a UtilityScoredCommand {
        result
            .candidates
            .iter()
            .find(|candidate| candidate.command.ability_id == ability_id)
            .unwrap()
    }
}
