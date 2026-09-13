# M11 Gate D — Four World Profiles Evidence

状态：PASS

采集日期：2026-09-13（Asia/Shanghai）

被测实现提交：`171ebda`（Gate A–C PASS）

## 执行门禁

```text
cargo test -p ember-combat-core --lib
```

结果：PASS，338 passed，0 failed，0 ignored。四个 Profile 的规则测试与跨世界 composition tests 在同一权威 Core suite 中执行。

## 四世界真实机制证据

| WorldProfile | Resource lifecycle / recovery | Defense / signature mechanics |
|---|---|---|
| Fantasy | `fantasy::tests::normal_owner_turn_restores_only_stamina_and_caps_at_maximum`；`fantasy::tests::real_cost_commits_produce_a_mana_stamina_dual_loop` | `fantasy::tests::resolved_profile_freezes_fantasy_resources_channels_and_mitigation`；`fantasy::tests::extra_turn_never_receives_normal_turn_stamina_recovery` |
| Cultivation | `cultivation::tests::spending_spirit_sense_changes_a_real_mental_save_outcome` | `cultivation::tests::resolved_profile_freezes_resources_channels_and_single_mitigation`；`cultivation::tests::soul_opposed_check_uses_both_spirit_sense_values_but_not_qi`；`cultivation::tests::developer_subprofiles_select_only_their_fixed_module` |
| Sci-Fi | `sci_fi::tests::owner_turn_recovers_energy_cools_heat_and_changes_overheat_gate`；`sci_fi::tests::committed_hostile_damage_resets_delay_then_two_quiet_rounds_recharge` | `sci_fi::tests::resolved_profile_freezes_resources_channels_and_mitigation`；`sci_fi::tests::miss_nonhostile_and_never_policy_do_not_interrupt_recharge` |
| Urban | `urban::tests::normal_owner_turn_restores_only_stamina_without_health_focus_or_shield`；`urban::tests::aim_brace_and_observe_restore_focus_only_as_explicit_actions`；`urban::tests::limited_healing_rejects_passive_and_automatic_layer_recharge` | `urban::tests::base_profile_has_no_shield_or_optional_channels`；`urban::tests::psychic_and_occult_channels_require_their_fixed_subprofile` |

Cross-profile tests additionally prove completeness and shared architecture without collapsing semantics: `cross_world_profile::tests::complete_registry_resolves_all_four_base_profiles_once`、`cross_world_profile::tests::lifecycle_shapes_prove_profiles_are_not_resource_renames`、`cross_world_profile::tests::every_profile_uses_the_same_mitigation_pipeline_type`、`cross_world_profile::tests::presentation_theme_labels_cannot_change_resolved_rule_bytes`。

每个世界还有 malformed balance/resource fail-closed tests；Gate 不依赖名称或主题差异来声称机制差异。

## 结论

M11 Gate D = PASS。四种基础 WorldProfile 均至少有一组真实资源循环、防御/恢复和 signature mechanics 测试，证明并非只替换资源名称。
