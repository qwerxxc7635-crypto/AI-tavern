use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::CombatVersionSet;

const MAX_SAFE_SEQUENCE: u64 = 9_007_199_254_740_991;
const MAX_INTERNAL_TARGETS: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AcceptedCommandSource {
    Player { controller_id: String },
    UtilityAi,
    Test { test_case_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CombatCommandSource {
    Player {
        controller_id: String,
    },
    UtilityAi,
    Replay {
        original_source: AcceptedCommandSource,
    },
    Test {
        test_case_id: String,
    },
    InternalDeterministic {
        rule_id: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReactionDecisionChoice {
    Trigger,
    Skip,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "valueType",
    content = "value",
    rename_all = "SCREAMING_SNAKE_CASE"
)]
pub enum TacticalPreferenceValue {
    Boolean(bool),
    Integer(i64),
    StableId(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CombatCommandPayload {
    UseAbility {
        ability_id: String,
        target_id: Option<String>,
    },
    EndTurn,
    AttemptEscape,
    SetTacticalStrategy {
        companion_id: String,
        strategy_id: String,
    },
    SetTacticalPreference {
        companion_id: String,
        preference_key: String,
        structured_value: TacticalPreferenceValue,
    },
    ResolveReaction {
        reaction_window_id: String,
        choice: ReactionDecisionChoice,
        selected_reaction_id: Option<String>,
    },
    InternalRuleAction {
        rule_id: String,
        target_ids: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CombatCommandEnvelope {
    pub command_id: String,
    pub source: CombatCommandSource,
    pub actor_id: String,
    pub versions: CombatVersionSet,
    pub payload: CombatCommandPayload,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptedCombatCommand {
    pub accepted_sequence: u64,
    pub command_id: String,
    pub source: AcceptedCommandSource,
    pub actor_id: String,
    pub versions: CombatVersionSet,
    pub payload: CombatCommandPayload,
}

impl AcceptedCombatCommand {
    #[must_use]
    pub fn replay_envelope(&self) -> CombatCommandEnvelope {
        CombatCommandEnvelope {
            command_id: self.command_id.clone(),
            source: CombatCommandSource::Replay {
                original_source: self.source.clone(),
            },
            actor_id: self.actor_id.clone(),
            versions: self.versions,
            payload: self.payload.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandAcceptanceStatus {
    Accepted,
    AlreadyAccepted,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcceptedCommandReceipt {
    pub status: CommandAcceptanceStatus,
    pub command: AcceptedCombatCommand,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InternalCombatCommand {
    pub command_id: String,
    pub rule_id: String,
    pub actor_id: String,
    pub target_ids: Vec<String>,
    pub versions: CombatVersionSet,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AcceptedCommandLedger {
    commands: Vec<AcceptedCombatCommand>,
}

impl AcceptedCommandLedger {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn restore(
        commands: Vec<AcceptedCombatCommand>,
    ) -> Result<Self, CombatCommandBoundaryError> {
        let mut ledger = Self::new();
        for command in commands {
            let expected_sequence = ledger.next_sequence()?;
            if command.accepted_sequence != expected_sequence {
                return Err(boundary_error(
                    CombatCommandBoundaryErrorCode::InvalidAcceptedHistory,
                    "acceptedSequence",
                ));
            }
            validate_accepted_command(&command)?;
            if ledger
                .commands
                .iter()
                .any(|existing| existing.command_id == command.command_id)
            {
                return Err(boundary_error(
                    CombatCommandBoundaryErrorCode::InvalidAcceptedHistory,
                    "commandId",
                ));
            }
            ledger.commands.push(command);
        }
        Ok(ledger)
    }

    pub fn accept_external(
        &mut self,
        envelope: CombatCommandEnvelope,
    ) -> Result<AcceptedCommandReceipt, CombatCommandBoundaryError> {
        validate_envelope(&envelope)?;
        let source = accepted_source(&envelope.source)?;
        validate_external_source_for_payload(&source, &envelope.payload)?;
        if let Some(existing) = self
            .commands
            .iter()
            .find(|command| command.command_id == envelope.command_id)
        {
            if equivalent_to_envelope(existing, &envelope, &source) {
                return Ok(AcceptedCommandReceipt {
                    status: CommandAcceptanceStatus::AlreadyAccepted,
                    command: existing.clone(),
                });
            }
            return Err(boundary_error(
                CombatCommandBoundaryErrorCode::IdempotencyConflict,
                "commandId",
            ));
        }
        let command = AcceptedCombatCommand {
            accepted_sequence: self.next_sequence()?,
            command_id: envelope.command_id,
            source,
            actor_id: envelope.actor_id,
            versions: envelope.versions,
            payload: envelope.payload,
        };
        self.commands.push(command.clone());
        Ok(AcceptedCommandReceipt {
            status: CommandAcceptanceStatus::Accepted,
            command,
        })
    }

    pub fn validate_replay(
        &self,
        command: &AcceptedCombatCommand,
        envelope: &CombatCommandEnvelope,
    ) -> Result<(), CombatCommandBoundaryError> {
        validate_envelope(envelope)?;
        let CombatCommandSource::Replay { original_source } = &envelope.source else {
            return Err(boundary_error(
                CombatCommandBoundaryErrorCode::ReplaySourceRequired,
                "source",
            ));
        };
        if original_source != &command.source
            || envelope.command_id != command.command_id
            || envelope.actor_id != command.actor_id
            || envelope.versions != command.versions
            || envelope.payload != command.payload
            || !self.commands.iter().any(|value| value == command)
        {
            return Err(boundary_error(
                CombatCommandBoundaryErrorCode::ReplayMismatch,
                "acceptedCommand",
            ));
        }
        Ok(())
    }

    pub fn validate_internal(
        &self,
        envelope: CombatCommandEnvelope,
    ) -> Result<InternalCombatCommand, CombatCommandBoundaryError> {
        validate_envelope(&envelope)?;
        let CombatCommandSource::InternalDeterministic { rule_id } = envelope.source else {
            return Err(boundary_error(
                CombatCommandBoundaryErrorCode::InternalSourceRequired,
                "source",
            ));
        };
        let CombatCommandPayload::InternalRuleAction {
            rule_id: payload_rule_id,
            target_ids,
        } = envelope.payload
        else {
            return Err(boundary_error(
                CombatCommandBoundaryErrorCode::InvalidSourceForPayload,
                "payload.kind",
            ));
        };
        if rule_id != payload_rule_id {
            return Err(boundary_error(
                CombatCommandBoundaryErrorCode::InvalidSourceForPayload,
                "payload.ruleId",
            ));
        }
        Ok(InternalCombatCommand {
            command_id: envelope.command_id,
            rule_id,
            actor_id: envelope.actor_id,
            target_ids,
            versions: envelope.versions,
        })
    }

    #[must_use]
    pub fn commands(&self) -> &[AcceptedCombatCommand] {
        &self.commands
    }

    #[must_use]
    pub fn last_accepted_sequence(&self) -> u64 {
        self.commands
            .last()
            .map_or(0, |command| command.accepted_sequence)
    }

    fn next_sequence(&self) -> Result<u64, CombatCommandBoundaryError> {
        let last = self.last_accepted_sequence();
        if last >= MAX_SAFE_SEQUENCE {
            return Err(boundary_error(
                CombatCommandBoundaryErrorCode::SequenceExhausted,
                "acceptedSequence",
            ));
        }
        Ok(last + 1)
    }
}

fn validate_envelope(envelope: &CombatCommandEnvelope) -> Result<(), CombatCommandBoundaryError> {
    envelope.versions.ensure_supported().map_err(|error| {
        boundary_error(
            CombatCommandBoundaryErrorCode::UnsupportedVersion,
            error.field.wire_name(),
        )
    })?;
    validate_stable_id(&envelope.command_id, "commandId")?;
    validate_stable_id(&envelope.actor_id, "actorId")?;
    match &envelope.source {
        CombatCommandSource::Player { controller_id } => {
            validate_stable_id(controller_id, "source.controllerId")?;
        }
        CombatCommandSource::Test { test_case_id } => {
            validate_stable_id(test_case_id, "source.testCaseId")?;
        }
        CombatCommandSource::InternalDeterministic { rule_id } => {
            validate_stable_id(rule_id, "source.ruleId")?;
        }
        CombatCommandSource::Replay { original_source } => {
            validate_accepted_source(original_source)?;
        }
        CombatCommandSource::UtilityAi => {}
    }
    validate_payload(&envelope.payload)
}

fn validate_accepted_command(
    command: &AcceptedCombatCommand,
) -> Result<(), CombatCommandBoundaryError> {
    if command.accepted_sequence == 0 || command.accepted_sequence > MAX_SAFE_SEQUENCE {
        return Err(boundary_error(
            CombatCommandBoundaryErrorCode::InvalidAcceptedHistory,
            "acceptedSequence",
        ));
    }
    validate_stable_id(&command.command_id, "commandId")?;
    validate_stable_id(&command.actor_id, "actorId")?;
    command.versions.ensure_supported().map_err(|error| {
        boundary_error(
            CombatCommandBoundaryErrorCode::UnsupportedVersion,
            error.field.wire_name(),
        )
    })?;
    validate_accepted_source(&command.source)?;
    validate_payload(&command.payload)?;
    if matches!(
        command.payload,
        CombatCommandPayload::InternalRuleAction { .. }
    ) {
        return Err(boundary_error(
            CombatCommandBoundaryErrorCode::InternalCommandCannotBeAccepted,
            "payload.kind",
        ));
    }
    validate_external_source_for_payload(&command.source, &command.payload)
}

fn validate_accepted_source(
    source: &AcceptedCommandSource,
) -> Result<(), CombatCommandBoundaryError> {
    match source {
        AcceptedCommandSource::Player { controller_id } => {
            validate_stable_id(controller_id, "source.controllerId")
        }
        AcceptedCommandSource::Test { test_case_id } => {
            validate_stable_id(test_case_id, "source.testCaseId")
        }
        AcceptedCommandSource::UtilityAi => Ok(()),
    }
}

fn accepted_source(
    source: &CombatCommandSource,
) -> Result<AcceptedCommandSource, CombatCommandBoundaryError> {
    match source {
        CombatCommandSource::Player { controller_id } => Ok(AcceptedCommandSource::Player {
            controller_id: controller_id.clone(),
        }),
        CombatCommandSource::UtilityAi => Ok(AcceptedCommandSource::UtilityAi),
        CombatCommandSource::Test { test_case_id } => Ok(AcceptedCommandSource::Test {
            test_case_id: test_case_id.clone(),
        }),
        CombatCommandSource::Replay { .. } => Err(boundary_error(
            CombatCommandBoundaryErrorCode::ReplayCannotBeAcceptedAgain,
            "source.kind",
        )),
        CombatCommandSource::InternalDeterministic { .. } => Err(boundary_error(
            CombatCommandBoundaryErrorCode::InternalCommandCannotBeAccepted,
            "source.kind",
        )),
    }
}

fn validate_external_source_for_payload(
    source: &AcceptedCommandSource,
    payload: &CombatCommandPayload,
) -> Result<(), CombatCommandBoundaryError> {
    if matches!(payload, CombatCommandPayload::InternalRuleAction { .. }) {
        return Err(boundary_error(
            CombatCommandBoundaryErrorCode::InternalCommandCannotBeAccepted,
            "payload.kind",
        ));
    }
    if matches!(source, AcceptedCommandSource::UtilityAi)
        && matches!(
            payload,
            CombatCommandPayload::SetTacticalStrategy { .. }
                | CombatCommandPayload::SetTacticalPreference { .. }
                | CombatCommandPayload::ResolveReaction { .. }
        )
    {
        return Err(boundary_error(
            CombatCommandBoundaryErrorCode::InvalidSourceForPayload,
            "source.kind",
        ));
    }
    Ok(())
}

fn validate_payload(payload: &CombatCommandPayload) -> Result<(), CombatCommandBoundaryError> {
    match payload {
        CombatCommandPayload::UseAbility {
            ability_id,
            target_id,
        } => {
            validate_stable_id(ability_id, "payload.abilityId")?;
            if let Some(target_id) = target_id {
                validate_stable_id(target_id, "payload.targetId")?;
            }
        }
        CombatCommandPayload::SetTacticalStrategy {
            companion_id,
            strategy_id,
        } => {
            validate_stable_id(companion_id, "payload.companionId")?;
            validate_stable_id(strategy_id, "payload.strategyId")?;
        }
        CombatCommandPayload::SetTacticalPreference {
            companion_id,
            preference_key,
            structured_value,
        } => {
            validate_stable_id(companion_id, "payload.companionId")?;
            validate_stable_id(preference_key, "payload.preferenceKey")?;
            if let TacticalPreferenceValue::StableId(value) = structured_value {
                validate_stable_id(value, "payload.structuredValue.value")?;
            }
        }
        CombatCommandPayload::ResolveReaction {
            reaction_window_id,
            choice,
            selected_reaction_id,
        } => {
            validate_stable_id(reaction_window_id, "payload.reactionWindowId")?;
            match (choice, selected_reaction_id) {
                (ReactionDecisionChoice::Trigger, Some(reaction_id)) => {
                    validate_stable_id(reaction_id, "payload.selectedReactionId")?;
                }
                (ReactionDecisionChoice::Skip, None) => {}
                (ReactionDecisionChoice::Trigger, None)
                | (ReactionDecisionChoice::Skip, Some(_)) => {
                    return Err(boundary_error(
                        CombatCommandBoundaryErrorCode::InvalidPayload,
                        "payload.selectedReactionId",
                    ));
                }
            }
        }
        CombatCommandPayload::InternalRuleAction {
            rule_id,
            target_ids,
        } => {
            validate_stable_id(rule_id, "payload.ruleId")?;
            if target_ids.len() > MAX_INTERNAL_TARGETS {
                return Err(boundary_error(
                    CombatCommandBoundaryErrorCode::InvalidPayload,
                    "payload.targetIds",
                ));
            }
            let mut previous: Option<&str> = None;
            for (index, target_id) in target_ids.iter().enumerate() {
                validate_stable_id(target_id, &format!("payload.targetIds[{index}]"))?;
                if previous.is_some_and(|value| value >= target_id.as_str()) {
                    return Err(boundary_error(
                        CombatCommandBoundaryErrorCode::InvalidPayload,
                        "payload.targetIds",
                    ));
                }
                previous = Some(target_id);
            }
        }
        CombatCommandPayload::EndTurn | CombatCommandPayload::AttemptEscape => {}
    }
    Ok(())
}

fn equivalent_to_envelope(
    accepted: &AcceptedCombatCommand,
    envelope: &CombatCommandEnvelope,
    source: &AcceptedCommandSource,
) -> bool {
    accepted.command_id == envelope.command_id
        && &accepted.source == source
        && accepted.actor_id == envelope.actor_id
        && accepted.versions == envelope.versions
        && accepted.payload == envelope.payload
}

fn validate_stable_id(value: &str, path: &str) -> Result<(), CombatCommandBoundaryError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
    {
        return Err(boundary_error(
            CombatCommandBoundaryErrorCode::InvalidStableId,
            path,
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CombatCommandBoundaryErrorCode {
    UnsupportedVersion,
    InvalidStableId,
    InvalidPayload,
    InvalidSourceForPayload,
    ReplayCannotBeAcceptedAgain,
    ReplaySourceRequired,
    ReplayMismatch,
    InternalCommandCannotBeAccepted,
    InternalSourceRequired,
    IdempotencyConflict,
    SequenceExhausted,
    InvalidAcceptedHistory,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CombatCommandBoundaryError {
    pub code: CombatCommandBoundaryErrorCode,
    pub path: String,
}

impl fmt::Display for CombatCommandBoundaryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "combat command boundary rejected {}: {:?}",
            self.path, self.code
        )
    }
}

impl Error for CombatCommandBoundaryError {}

fn boundary_error(code: CombatCommandBoundaryErrorCode, path: &str) -> CombatCommandBoundaryError {
    CombatCommandBoundaryError {
        code,
        path: path.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;
    use crate::CURRENT_COMBAT_VERSIONS;

    const SHARED_FIXTURE: &str =
        include_str!("../../../packages/contracts/src/combat-command-contract.fixture.json");

    #[test]
    fn shared_accepted_command_fixture_has_exact_wire_shape() {
        let command: AcceptedCombatCommand = serde_json::from_str(SHARED_FIXTURE).unwrap();
        validate_accepted_command(&command).unwrap();
        assert_eq!(command.accepted_sequence, 1);
        assert!(matches!(
            command.payload,
            CombatCommandPayload::SetTacticalStrategy { .. }
        ));
        let value: Value = serde_json::from_str(SHARED_FIXTURE).unwrap();
        assert_eq!(serde_json::to_value(command).unwrap(), value);
    }

    #[test]
    fn every_external_payload_crosses_one_idempotent_sequence_boundary() {
        let mut ledger = AcceptedCommandLedger::new();
        let payloads = vec![
            CombatCommandPayload::UseAbility {
                ability_id: "ability-strike".to_owned(),
                target_id: Some("combatant-enemy".to_owned()),
            },
            CombatCommandPayload::EndTurn,
            CombatCommandPayload::AttemptEscape,
            CombatCommandPayload::SetTacticalStrategy {
                companion_id: "combatant-companion".to_owned(),
                strategy_id: "BALANCED".to_owned(),
            },
            CombatCommandPayload::SetTacticalPreference {
                companion_id: "combatant-companion".to_owned(),
                preference_key: "risk.level".to_owned(),
                structured_value: TacticalPreferenceValue::StableId("CONSERVATIVE".to_owned()),
            },
            CombatCommandPayload::ResolveReaction {
                reaction_window_id: "reaction-window-1".to_owned(),
                choice: ReactionDecisionChoice::Trigger,
                selected_reaction_id: Some("reaction-block".to_owned()),
            },
        ];
        for (index, payload) in payloads.into_iter().enumerate() {
            let envelope = player_envelope(&format!("command-{index}"), payload);
            let first = ledger.accept_external(envelope.clone()).unwrap();
            let duplicate = ledger.accept_external(envelope).unwrap();
            assert_eq!(first.status, CommandAcceptanceStatus::Accepted);
            assert_eq!(duplicate.status, CommandAcceptanceStatus::AlreadyAccepted);
            assert_eq!(first.command, duplicate.command);
            assert_eq!(first.command.accepted_sequence, index as u64 + 1);
        }
        assert_eq!(ledger.commands().len(), 6);
    }

    #[test]
    fn duplicate_command_id_with_different_identity_is_rejected_without_advancing_sequence() {
        let mut ledger = AcceptedCommandLedger::new();
        ledger
            .accept_external(player_envelope(
                "command-idempotent",
                CombatCommandPayload::EndTurn,
            ))
            .unwrap();
        let error = ledger
            .accept_external(player_envelope(
                "command-idempotent",
                CombatCommandPayload::AttemptEscape,
            ))
            .unwrap_err();
        assert_eq!(
            error.code,
            CombatCommandBoundaryErrorCode::IdempotencyConflict
        );
        assert_eq!(ledger.last_accepted_sequence(), 1);
    }

    #[test]
    fn utility_ai_and_player_ownership_are_distinct_at_the_boundary() {
        let mut ledger = AcceptedCommandLedger::new();
        let utility = CombatCommandEnvelope {
            command_id: "command-utility".to_owned(),
            source: CombatCommandSource::UtilityAi,
            actor_id: "combatant-companion".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            payload: CombatCommandPayload::UseAbility {
                ability_id: "ability-companion-strike".to_owned(),
                target_id: Some("combatant-enemy".to_owned()),
            },
        };
        assert!(ledger.accept_external(utility).is_ok());

        let utility_reaction = CombatCommandEnvelope {
            command_id: "command-utility-reaction".to_owned(),
            source: CombatCommandSource::UtilityAi,
            actor_id: "combatant-companion".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            payload: CombatCommandPayload::ResolveReaction {
                reaction_window_id: "reaction-window-1".to_owned(),
                choice: ReactionDecisionChoice::Skip,
                selected_reaction_id: None,
            },
        };
        assert_eq!(
            ledger.accept_external(utility_reaction).unwrap_err().code,
            CombatCommandBoundaryErrorCode::InvalidSourceForPayload
        );
    }

    #[test]
    fn replay_uses_recorded_sequence_and_source_without_accepting_again() {
        let fixture: AcceptedCombatCommand = serde_json::from_str(SHARED_FIXTURE).unwrap();
        let ledger = AcceptedCommandLedger::restore(vec![fixture.clone()]).unwrap();
        let replay = fixture.replay_envelope();
        ledger.validate_replay(&fixture, &replay).unwrap();
        assert_eq!(ledger.last_accepted_sequence(), 1);

        let mut live = ledger.clone();
        assert_eq!(
            live.accept_external(replay).unwrap_err().code,
            CombatCommandBoundaryErrorCode::ReplayCannotBeAcceptedAgain
        );

        let mut tampered = fixture.replay_envelope();
        tampered.actor_id = "combatant-other".to_owned();
        assert_eq!(
            ledger
                .validate_replay(&fixture, &tampered)
                .unwrap_err()
                .code,
            CombatCommandBoundaryErrorCode::ReplayMismatch
        );
    }

    #[test]
    fn internal_deterministic_action_uses_envelope_but_never_accepted_history() {
        let ledger = AcceptedCommandLedger::new();
        let internal = CombatCommandEnvelope {
            command_id: "internal-command-1".to_owned(),
            source: CombatCommandSource::InternalDeterministic {
                rule_id: "encounter-storm".to_owned(),
            },
            actor_id: "encounter-system".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            payload: CombatCommandPayload::InternalRuleAction {
                rule_id: "encounter-storm".to_owned(),
                target_ids: vec!["combatant-a".to_owned(), "combatant-b".to_owned()],
            },
        };
        let validated = ledger.validate_internal(internal.clone()).unwrap();
        assert_eq!(validated.target_ids.len(), 2);
        assert!(ledger.commands().is_empty());

        let mut live = ledger;
        assert_eq!(
            live.accept_external(internal).unwrap_err().code,
            CombatCommandBoundaryErrorCode::InternalCommandCannotBeAccepted
        );
    }

    #[test]
    fn malformed_ids_reaction_choices_versions_and_history_fail_closed() {
        let invalid_id = player_envelope("command with spaces", CombatCommandPayload::EndTurn);
        assert_eq!(
            AcceptedCommandLedger::new()
                .accept_external(invalid_id)
                .unwrap_err()
                .code,
            CombatCommandBoundaryErrorCode::InvalidStableId
        );

        for payload in [
            CombatCommandPayload::ResolveReaction {
                reaction_window_id: "reaction-window-1".to_owned(),
                choice: ReactionDecisionChoice::Trigger,
                selected_reaction_id: None,
            },
            CombatCommandPayload::ResolveReaction {
                reaction_window_id: "reaction-window-1".to_owned(),
                choice: ReactionDecisionChoice::Skip,
                selected_reaction_id: Some("reaction-block".to_owned()),
            },
        ] {
            assert_eq!(
                AcceptedCommandLedger::new()
                    .accept_external(player_envelope("command-reaction", payload))
                    .unwrap_err()
                    .code,
                CombatCommandBoundaryErrorCode::InvalidPayload
            );
        }

        let mut future = player_envelope("command-future", CombatCommandPayload::EndTurn);
        future.versions = serde_json::from_value(json!({
            "combatSchemaVersion": 2,
            "rulesetVersion": 1,
            "balanceVersion": 1,
            "engineVersion": 1,
            "worldProfileVersion": 1,
            "attributeMappingVersion": 1,
            "rngContractVersion": 1
        }))
        .unwrap();
        assert_eq!(
            AcceptedCommandLedger::new()
                .accept_external(future)
                .unwrap_err()
                .code,
            CombatCommandBoundaryErrorCode::UnsupportedVersion
        );

        let fixture: AcceptedCombatCommand = serde_json::from_str(SHARED_FIXTURE).unwrap();
        let mut gap = fixture.clone();
        gap.accepted_sequence = 2;
        assert_eq!(
            AcceptedCommandLedger::restore(vec![gap]).unwrap_err().code,
            CombatCommandBoundaryErrorCode::InvalidAcceptedHistory
        );

        let mut unknown: Value = serde_json::from_str(SHARED_FIXTURE).unwrap();
        unknown["uiTimestamp"] = json!(123);
        assert!(serde_json::from_value::<AcceptedCombatCommand>(unknown).is_err());
    }

    fn player_envelope(command_id: &str, payload: CombatCommandPayload) -> CombatCommandEnvelope {
        CombatCommandEnvelope {
            command_id: command_id.to_owned(),
            source: CombatCommandSource::Player {
                controller_id: "player-main".to_owned(),
            },
            actor_id: "combatant-player".to_owned(),
            versions: CURRENT_COMBAT_VERSIONS,
            payload,
        }
    }
}
