# M11 Gate B — Resolution / Effect Evidence

状态：PASS

采集日期：2026-09-13（Asia/Shanghai）

被测实现提交：`df1eb88`（Gate A PASS）

## 执行门禁

```text
cargo test -p ember-combat-core --lib
```

结果：PASS，338 passed，0 failed，0 ignored。Resolution、Effect、Mitigation、Shield、DamageBundle、Lethal 与 Encounter 均在完整权威 Core suite 内执行。

## SOT 条款映射

| Gate B 条款 | 主要可执行证据 |
|---|---|
| Attack / Save / Opposed / Critical 边界 | `resolution::tests::attack_natural_twenty_and_one_override_total_and_only_a_hitting_range_crit_counts`；`resolution::tests::non_attack_natural_extremes_are_only_numbers_in_the_declared_formula`；`resolution::tests::opposed_tie_defaults_to_defender_and_only_typed_override_changes_it`；`attack::tests::critical_doubles_only_eligible_dice_and_never_fixed_bonus` |
| fixed-point Armor / Resistance / percent recovery | `mitigation::tests::armor_formula_uses_only_armor_penetration_then_rounds_once_and_spills`；`mitigation::tests::resistance_formula_ignores_armor_and_penetration_never_creates_weakness`；`effect::tests::revive_requires_positive_recovery_and_uses_minimum_one_percent_term`；`numeric::tests::shared_exact_value_fixture_locks_every_rounding_contract` |
| Status / Effect 致命修改使用原子 LethalResolution | `lethal::tests::status_tick_and_reflection_use_the_same_atomic_lethal_closure`；`lethal::tests::invalid_pending_outcome_and_mutation_roll_back_without_committed_facts` |
| predeclared Reinforcement 激活不绕过状态转换 | `encounter::tests::reinforcement_activation_uses_preallocated_order_and_joins_next_round`；`encounter::tests::reinforcement_registry_invariant_rejects_aliases_and_live_undeployed_units` |
| Armor / Resistance / Weakness / Penetration | `mitigation::tests::armor_formula_uses_only_armor_penetration_then_rounds_once_and_spills`；`mitigation::tests::resistance_caps_and_preserves_existing_weakness_under_penetration`；`mitigation::tests::explicit_immunity_is_distinct_from_resistance_and_preserves_state` |
| Damage rounding / Shield spillover exact values | `shield::tests::standard_and_emp_multipliers_follow_frozen_integer_equations`；`shield::tests::insufficient_fractional_shield_is_consumed_without_absorbing_damage`；`mitigation::tests::no_mitigation_uses_default_shield_equations_and_preserves_exact_identity` |
| DamageBundle stable order 与单次 atomic lethal closure | `damage_bundle::tests::unsorted_components_use_index_order_and_inherit_working_shield_and_hp`；`damage_bundle::tests::lethal_resolution_runs_once_only_after_every_normal_component`；`damage_bundle::tests::lethal_or_invariant_failure_leaves_original_state_byte_identical` |
| committed damage / shield break / defeat event 语义 | `damage_bundle::tests::committed_damage_facts_drive_recharge_for_shield_hit_and_bypass`；`damage_bundle::tests::shield_break_and_defeat_events_follow_committed_order_without_second_kill_credit`；`damage_bundle::tests::miss_immunity_and_zero_damage_do_not_interrupt_default_recharge` |
| Encounter / System action 复用 Effect Engine | `encounter::tests::internal_encounter_damage_reuses_effect_resolution_lethal_and_atomic_commit`；`encounter::tests::recovery_uses_shared_effect_handler_and_recovery_commit`；`encounter::tests::player_or_ability_payload_cannot_enter_encounter_rule_path` |
| Revive 状态转换 | `effect::tests::revive_requires_positive_recovery_and_uses_minimum_one_percent_term`；`lethal::tests::recovered_and_downed_pending_outcomes_are_not_defeat_events` |
| 数值路径拒绝非法范围、overflow 与负值 | `numeric::tests::arithmetic_rejects_negative_division_bounds_and_overflow_instead_of_wrapping`；`resolution::tests::malformed_roll_range_and_overflow_fail_as_structured_errors`；`effect::tests::collections_ids_resources_and_percent_references_fail_closed`；`damage_bundle::tests::duplicate_indices_non_damage_effects_and_bad_tags_fail_before_commit` |

映射仅用于审计定位；Gate 实际执行全部 338 项 Core tests，因此共享管线、输入校验与跨模块 invariant 同时受检。

## 结论

M11 Gate B = PASS。没有新增 skip/ignore，没有改变计算公式、rounding point、事件语义或验证阈值。跨平台 exact-value 比较仍由 M11-T08 独立提供。
