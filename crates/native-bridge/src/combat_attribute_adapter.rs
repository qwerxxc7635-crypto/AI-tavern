use std::collections::BTreeMap;

use ember_combat_core::{
    CombatAttributeProfile, CombatAttributeResolver, CombatAttributeResolverError,
    CombatAttributeRole, CombatVersionSet, LegacyAttributeModifier, LegacyAttributeModifierKind,
    ResolvedCombatAttributes, V03BaseAttributes, V03CombatAttributeSource, V03HitPoints,
    V03PlayerCombatSource, V03RuleSkill, V03UniversalAttributeProjection,
};
use rusqlite::{OptionalExtension, TransactionBehavior};
use serde::de::DeserializeOwned;
use thiserror::Error;

use crate::{
    CampaignStore, CampaignStoreError, CharacterAttributes, TraitTargetKind, load_state,
    validate_id,
};

#[derive(Debug, Error)]
pub enum CombatAttributeAdapterError {
    #[error("character combat source could not be loaded")]
    Store(#[from] CampaignStoreError),
    #[error("character combat attributes are incompatible")]
    Resolver(#[from] CombatAttributeResolverError),
}

impl CampaignStore {
    /// Reads every v0.3 player attribute projection in one SQLite snapshot and
    /// delegates all mapping and arithmetic to the pure Combat Core.
    pub fn resolve_player_combat_attributes(
        &self,
        player_character_id: &str,
        versions: CombatVersionSet,
        profile: &CombatAttributeProfile,
    ) -> Result<ResolvedCombatAttributes, CombatAttributeAdapterError> {
        validate_id(player_character_id)?;
        let mut connection = self.connect()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Deferred)
            .map_err(CampaignStoreError::from)?;
        let rules =
            load_state(&transaction, player_character_id)?.ok_or(CampaignStoreError::NotFound)?;
        let player_attributes_json = transaction
            .query_row(
                "SELECT attributes_json FROM player_characters
                 WHERE id = ?1 AND campaign_id = ?2",
                [player_character_id, rules.campaign_id.as_str()],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(CampaignStoreError::from)?
            .ok_or(CampaignStoreError::NotFound)?;
        let player_attributes: CharacterAttributes = parse_json(&player_attributes_json)?;
        let universal = transaction
            .query_row(
                "SELECT schema_version, revision,
                        json_extract(profile_json, '$.attributes'),
                        json_extract(profile_json, '$.proficiencies')
                 FROM universal_character_profiles
                 WHERE player_character_id = ?1 AND campaign_id = ?2",
                [player_character_id, rules.campaign_id.as_str()],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(CampaignStoreError::from)?
            .map(
                |(
                    schema_version,
                    revision,
                    attributes_json,
                    proficiencies_json,
                )|
                 -> Result<V03UniversalAttributeProjection, CampaignStoreError> {
                    Ok(V03UniversalAttributeProjection {
                        schema_version: u32::try_from(schema_version)
                            .map_err(|_| CampaignStoreError::InvalidData)?,
                        revision: u64::try_from(revision)
                            .map_err(|_| CampaignStoreError::InvalidData)?,
                        attributes: attributes(parse_json(&attributes_json)?),
                        textual_proficiencies: parse_json(&proficiencies_json)?,
                    })
                },
            )
            .transpose()?;

        let mut legacy_attribute_modifiers = Vec::new();
        for status in &rules.statuses {
            for (attribute, amount) in &status.attribute_modifiers {
                legacy_attribute_modifiers.push(LegacyAttributeModifier {
                    kind: LegacyAttributeModifierKind::Status,
                    source_id: status.id.clone(),
                    role: role(attribute)?,
                    amount: *amount,
                });
            }
        }
        for modifier in &rules.trait_modifiers {
            if modifier.target.kind == TraitTargetKind::Attribute {
                legacy_attribute_modifiers.push(LegacyAttributeModifier {
                    kind: LegacyAttributeModifierKind::Trait,
                    source_id: modifier.trait_id.clone(),
                    role: role(&modifier.target.key)?,
                    amount: modifier.modifier,
                });
            }
        }

        let mut skill_trait_totals = BTreeMap::<&str, i64>::new();
        for modifier in &rules.trait_modifiers {
            if modifier.target.kind == TraitTargetKind::Skill {
                let total = skill_trait_totals.entry(&modifier.target.key).or_insert(0);
                *total = total
                    .checked_add(modifier.modifier)
                    .ok_or(CampaignStoreError::InvalidData)?;
            }
        }
        let rule_skills = rules
            .skills
            .iter()
            .map(|skill| V03RuleSkill {
                key: skill.key.clone(),
                value: skill.value,
                trait_modifier_total: skill_trait_totals
                    .get(skill.key.as_str())
                    .copied()
                    .unwrap_or(0),
            })
            .collect();
        let source = V03CombatAttributeSource::Player(Box::new(V03PlayerCombatSource {
            player_character_id: rules.player_character_id,
            rule_schema_version: u32::try_from(rules.schema_version)
                .map_err(|_| CampaignStoreError::InvalidData)?,
            source_revision: u64::try_from(rules.revision)
                .map_err(|_| CampaignStoreError::InvalidData)?,
            rule_base_attributes: attributes(rules.base_attributes),
            player_attributes: attributes(player_attributes),
            universal_projection: universal,
            hit_points: V03HitPoints {
                current: rules.hit_points.current,
                max: rules.hit_points.max,
            },
            rule_skills,
            legacy_attribute_modifiers,
        }));
        let resolved = CombatAttributeResolver::resolve(versions, source, profile)?;
        transaction.commit().map_err(CampaignStoreError::from)?;
        Ok(resolved)
    }
}

fn attributes(value: CharacterAttributes) -> V03BaseAttributes {
    V03BaseAttributes {
        physique: value.physique,
        agility: value.agility,
        knowledge: value.knowledge,
        charisma: value.charisma,
    }
}

fn role(value: &str) -> Result<CombatAttributeRole, CampaignStoreError> {
    match value {
        "physique" => Ok(CombatAttributeRole::Body),
        "agility" => Ok(CombatAttributeRole::Finesse),
        "knowledge" => Ok(CombatAttributeRole::Intellect),
        "charisma" => Ok(CombatAttributeRole::Presence),
        _ => Err(CampaignStoreError::InvalidData),
    }
}

fn parse_json<T: DeserializeOwned>(value: &str) -> Result<T, CampaignStoreError> {
    serde_json::from_str(value).map_err(|_| CampaignStoreError::InvalidData)
}

#[cfg(test)]
mod tests {
    use ember_combat_core::{
        CURRENT_COMBAT_VERSIONS, CombatAttributeResolverErrorCode, CombatProficiencyDefinition,
        CombatSaveType, WorldCombatProfileId,
    };
    use rusqlite::params;

    use super::*;

    const CAMPAIGN_ID: &str = "campaign-combat-attribute-v03";
    const CHARACTER_ID: &str = "character-combat-attribute-v03";
    const NOW: &str = "2026-09-01T12:00:00.000Z";

    #[test]
    fn real_v03_sqlite_fixture_resolves_all_profiles_and_survives_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("combat-attribute.sqlite");
        let store = CampaignStore::open(&path).unwrap();
        seed_v03_fixture(&store);

        let mut fantasy = None;
        for profile_id in [
            WorldCombatProfileId::Fantasy,
            WorldCombatProfileId::SciFi,
            WorldCombatProfileId::Cultivation,
            WorldCombatProfileId::Urban,
        ] {
            let resolved = store
                .resolve_player_combat_attributes(
                    CHARACTER_ID,
                    CURRENT_COMBAT_VERSIONS,
                    &profile(profile_id),
                )
                .unwrap();
            assert_eq!(resolved.base_attributes.physique, 3);
            assert_eq!(resolved.effective_attributes.physique, 5);
            assert_eq!(resolved.effective_attributes.agility, 3);
            assert_eq!(resolved.resolve_save_attribute(CombatSaveType::Mental), 2);
            assert_eq!(resolved.resolve_initiative_modifier().unwrap(), 4);
            assert_eq!(resolved.resolve_proficiency("weapon.blades").unwrap(), 5);
            if profile_id == WorldCombatProfileId::Fantasy {
                fantasy = Some(resolved);
            }
        }
        let fantasy = fantasy.unwrap();
        drop(store);

        let reopened = CampaignStore::open(&path).unwrap();
        assert_eq!(
            reopened
                .resolve_player_combat_attributes(
                    CHARACTER_ID,
                    CURRENT_COMBAT_VERSIONS,
                    &profile(WorldCombatProfileId::Fantasy),
                )
                .unwrap(),
            fantasy
        );
    }

    #[test]
    fn unknown_universal_text_cannot_change_numeric_output() {
        let directory = tempfile::tempdir().unwrap();
        let store = CampaignStore::open(directory.path().join("unknown-text.sqlite")).unwrap();
        seed_v03_fixture(&store);
        let profile = profile(WorldCombatProfileId::Fantasy);
        let before = store
            .resolve_player_combat_attributes(CHARACTER_ID, CURRENT_COMBAT_VERSIONS, &profile)
            .unwrap();

        let connection = store.connect().unwrap();
        connection
            .execute(
                "UPDATE universal_character_profiles
                 SET profile_json = json_set(
                       profile_json,
                       '$.revision', revision + 1,
                       '$.proficiencies', json(?1),
                       '$.derivedAttributes', json(?2),
                       '$.career.displayName', 'Legendary omnipotent warlord',
                       '$.updatedAt', ?3
                     ),
                     revision = revision + 1,
                     updated_at = ?3
                 WHERE player_character_id = ?4",
                params![
                    r#"["Blade Training","Arcane Scholar","master of every weapon"]"#,
                    r#"[{"key":"untrustedPower","value":999999}]"#,
                    "2026-09-01T12:01:00.000Z",
                    CHARACTER_ID
                ],
            )
            .unwrap();
        let after = store
            .resolve_player_combat_attributes(CHARACTER_ID, CURRENT_COMBAT_VERSIONS, &profile)
            .unwrap();
        assert_eq!(after.effective_attributes, before.effective_attributes);
        assert_eq!(after.proficiencies, before.proficiencies);
        assert_ne!(
            after.universal_source_revision,
            before.universal_source_revision
        );
    }

    #[test]
    fn valid_but_drifting_player_projection_is_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let store = CampaignStore::open(directory.path().join("projection-drift.sqlite")).unwrap();
        seed_v03_fixture(&store);
        let connection = store.connect().unwrap();
        connection
            .execute_batch("DROP TRIGGER player_character_base_attributes_immutable")
            .unwrap();
        connection
            .execute(
                "UPDATE player_characters
                 SET attributes_json = '{\"physique\":3,\"agility\":3,\"knowledge\":2,\"charisma\":2}'
                 WHERE id = ?1",
                [CHARACTER_ID],
            )
            .unwrap();

        let error = store
            .resolve_player_combat_attributes(
                CHARACTER_ID,
                CURRENT_COMBAT_VERSIONS,
                &profile(WorldCombatProfileId::Fantasy),
            )
            .unwrap_err();
        assert!(matches!(
            error,
            CombatAttributeAdapterError::Resolver(CombatAttributeResolverError {
                code: CombatAttributeResolverErrorCode::ProjectionDrift,
                ..
            })
        ));
    }

    fn profile(profile_id: WorldCombatProfileId) -> CombatAttributeProfile {
        CombatAttributeProfile {
            world_profile_id: profile_id,
            world_profile_version: CURRENT_COMBAT_VERSIONS.world_profile_version,
            base_defense: 10,
            initiative_modifier: 1,
            proficiency_definitions: vec![
                CombatProficiencyDefinition {
                    proficiency_id: "weapon.blades".to_owned(),
                    numeric_skill_key: "combat.blades".to_owned(),
                    textual_aliases: vec!["Blade Training".to_owned()],
                    textual_baseline: 2,
                },
                CombatProficiencyDefinition {
                    proficiency_id: "arcane.lore".to_owned(),
                    numeric_skill_key: "combat.arcane".to_owned(),
                    textual_aliases: vec!["Arcane Scholar".to_owned()],
                    textual_baseline: 2,
                },
            ],
        }
    }

    fn seed_v03_fixture(store: &CampaignStore) {
        let connection = store.connect().unwrap();
        connection
            .execute(
                "INSERT INTO campaigns (
                   id, schema_version, state, task_model_overrides_json, model_switch_policy,
                   created_at, updated_at
                 ) VALUES (?1, 1, 'ADVENTURE', '{}', 'ASK', ?2, ?2)",
                params![CAMPAIGN_ID, NOW],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO player_characters (
                   id, campaign_id, name, gender, age, concept, story_preferences_json,
                   content_boundaries_json, class_archetype, class_display_name,
                   attributes_json, traits_json, personal_goal, background_json,
                   initial_equipment_ids_json, created_at, updated_at
                 ) VALUES (
                   ?1, ?2, 'Mira', NULL, NULL, 'A disciplined scout', '[]',
                   '{\"allowHorror\":true,\"allowPermanentDeath\":false,\"allowRomance\":false,\"allowBetrayal\":true,\"excludedContent\":[]}',
                   'ROGUE', 'Scout',
                   '{\"physique\":3,\"agility\":2,\"knowledge\":3,\"charisma\":2}',
                   '[]', 'Protect the tavern',
                   '{\"birthplace\":\"Harbor\",\"formativeExperience\":\"Patrol\",\"adventureMotivation\":\"Duty\",\"secret\":\"\",\"importantPerson\":\"\",\"tavernArrivalReason\":\"Rest\"}',
                   '[]', ?3, ?3
                 )",
                params![CHARACTER_ID, CAMPAIGN_ID, NOW],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE character_rule_states
                 SET skills_json = ?1,
                     hp_current = 8,
                     hp_max = 12,
                     statuses_json = ?2,
                     trait_modifiers_json = ?3,
                     revision = 2,
                     updated_at = ?4
                 WHERE player_character_id = ?5",
                params![
                    r#"[{"key":"combat.blades","value":4}]"#,
                    r#"[{"id":"status-agile","kind":"BUFF","label":"迅捷","attributeModifiers":{"agility":1},"expiresAtGameMinute":120}]"#,
                    r#"[{"traitId":"trait-sturdy","target":{"kind":"ATTRIBUTE","key":"physique"},"modifier":2},{"traitId":"trait-blades","target":{"kind":"SKILL","key":"combat.blades"},"modifier":1}]"#,
                    "2026-09-01T12:00:30.000Z",
                    CHARACTER_ID
                ],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE universal_character_profiles
                 SET profile_json = json_set(
                       profile_json,
                       '$.revision', revision + 1,
                       '$.proficiencies', json(?1),
                       '$.updatedAt', ?2
                     ),
                     revision = revision + 1,
                     updated_at = ?2
                 WHERE player_character_id = ?3",
                params![
                    r#"["Blade Training","Arcane Scholar","unmapped narrative mastery"]"#,
                    "2026-09-01T12:00:45.000Z",
                    CHARACTER_ID
                ],
            )
            .unwrap();
    }
}
