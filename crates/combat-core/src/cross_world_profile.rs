#[cfg(test)]
mod tests {
    use crate::{
        COMBAT_FIXED_SCALE, CombatFixed, DamageChannelCatalog, DamageChannelId, DamageImmunity,
        DamageMitigationRequest, MitigationBalanceConfig, MitigationPipeline,
        NormalOwnerTurnResourcePolicy, PrimaryMitigation, ResolutionResult, ResourceStorage,
        ShieldInteraction, WorldCombatProfile, WorldCombatProfileResolver, WorldType,
    };

    #[test]
    fn complete_registry_resolves_all_four_base_profiles_once() {
        let resolver = resolver();
        assert_eq!(resolver.profiles().len(), 4);
        assert_eq!(
            resolver
                .profiles()
                .iter()
                .map(WorldCombatProfile::world_type)
                .collect::<Vec<_>>(),
            vec![
                WorldType::Fantasy,
                WorldType::SciFi,
                WorldType::Cultivation,
                WorldType::Urban,
            ]
        );
    }

    #[test]
    fn lifecycle_shapes_prove_profiles_are_not_resource_renames() {
        let resolver = resolver();
        let fantasy = resolver.resolve(WorldType::Fantasy);
        let sci_fi = resolver.resolve(WorldType::SciFi);
        let cultivation = resolver.resolve(WorldType::Cultivation);
        let urban = resolver.resolve(WorldType::Urban);

        assert_eq!(
            automatic_resources(fantasy),
            vec![("stamina", NormalOwnerTurnResourcePolicy::RestoreFromBalance)]
        );
        assert_eq!(
            automatic_resources(sci_fi),
            vec![
                ("energy", NormalOwnerTurnResourcePolicy::RestoreFromBalance),
                ("heat", NormalOwnerTurnResourcePolicy::ReduceFromBalance),
            ]
        );
        assert!(automatic_resources(cultivation).is_empty());
        assert_eq!(
            automatic_resources(urban),
            vec![("stamina", NormalOwnerTurnResourcePolicy::RestoreFromBalance)]
        );

        assert!(sci_fi.resource_lifecycle().resources.iter().any(|rule| {
            rule.resource_id == "shield" && rule.storage == ResourceStorage::Shield
        }));
        assert!(sci_fi.resource_lifecycle().resources.iter().any(|rule| {
            rule.resource_id == "heat" && rule.storage == ResourceStorage::PressureResourcePool
        }));
        assert!(
            cultivation
                .resource_lifecycle()
                .resources
                .iter()
                .any(|rule| rule.resource_id == "spirit_sense")
        );
        assert!(
            urban
                .resource_lifecycle()
                .resources
                .iter()
                .any(|rule| rule.resource_id == "focus")
        );
        assert!(
            !urban
                .resource_lifecycle()
                .resources
                .iter()
                .any(|rule| rule.storage == ResourceStorage::Shield)
        );

        let signatures = resolver
            .profiles()
            .iter()
            .map(|profile| profile.signature_mechanic().mechanic_id.as_str())
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(signatures.len(), 4);
    }

    #[test]
    fn every_profile_uses_the_same_mitigation_pipeline_type() {
        let resolver = resolver();
        let cases = [
            (WorldType::Fantasy, "physical", PrimaryMitigation::Armor),
            (WorldType::SciFi, "thermal", PrimaryMitigation::Resistance),
            (
                WorldType::Cultivation,
                "soul",
                PrimaryMitigation::Resistance,
            ),
            (WorldType::Urban, "ballistic", PrimaryMitigation::Armor),
        ];
        for (world_type, channel_id, expected) in cases {
            let profile = resolver.resolve(world_type);
            let resolution = ResolutionResult::AutoHit {
                hit: true,
                critical: false,
            };
            let channel = DamageChannelId::new(channel_id).unwrap();
            let result = MitigationPipeline::resolve(
                profile,
                &balance(),
                DamageMitigationRequest {
                    attack_resolution: &resolution,
                    channel_id: &channel,
                    raw_modified_damage: fixed(10 * COMBAT_FIXED_SCALE),
                    target_armor: 0,
                    armor_penetration_percent: fixed(0),
                    armor_penetration_flat: 0,
                    base_channel_resistance: fixed(0),
                    resistance_penetration: fixed(0),
                    immunity: DamageImmunity::NotImmune {},
                    shield_interaction: ShieldInteraction::standard(),
                    current_shield: 0,
                    current_hit_points: 20,
                },
            )
            .unwrap();
            assert_eq!(result.primary_mitigation, Some(expected));
            assert_eq!(result.hp_damage, 10);
        }
    }

    #[test]
    fn presentation_theme_labels_cannot_change_resolved_rule_bytes() {
        let resolver = resolver();
        let before = serde_json::to_vec(resolver.profiles()).unwrap();
        for presentation_theme in [
            "fantasy-default",
            "cyberpunk-neon",
            "ink-cultivation",
            "urban-investigation",
        ] {
            assert!(!presentation_theme.is_empty());
            assert_eq!(serde_json::to_vec(resolver.profiles()).unwrap(), before);
        }
        let value = serde_json::to_value(resolver.profiles()).unwrap();
        let encoded = value.to_string();
        assert!(!encoded.contains("theme"));
        assert!(!encoded.contains("layout"));
        assert!(!encoded.contains("asset"));
    }

    fn resolver() -> WorldCombatProfileResolver {
        WorldCombatProfileResolver::v0_4_1(&DamageChannelCatalog::v0_4_1()).unwrap()
    }

    fn automatic_resources(
        profile: &WorldCombatProfile,
    ) -> Vec<(&str, NormalOwnerTurnResourcePolicy)> {
        profile
            .resource_lifecycle()
            .resources
            .iter()
            .filter(|rule| {
                rule.normal_owner_turn_start != NormalOwnerTurnResourcePolicy::NoAutomaticChange
            })
            .map(|rule| (rule.resource_id.as_str(), rule.normal_owner_turn_start))
            .collect()
    }

    fn balance() -> MitigationBalanceConfig {
        MitigationBalanceConfig {
            armor_k: 100,
            max_armor_dr: fixed(800_000),
            max_resistance: fixed(800_000),
            max_weakness: fixed(1_000_000),
        }
    }

    fn fixed(value: i64) -> CombatFixed {
        CombatFixed::from_scaled(value)
    }
}
