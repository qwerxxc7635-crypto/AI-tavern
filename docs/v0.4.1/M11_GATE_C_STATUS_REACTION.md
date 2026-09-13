# M11 Gate C — Status / Reaction Evidence

状态：PASS

采集日期：2026-09-13（Asia/Shanghai）

被测实现提交：`cb52330`（Gate A/B PASS）

## 执行门禁

```text
cargo test -p ember-combat-core --lib
cargo test -p ember-native-bridge combat_persistence::tests::crash_resume_preserves_pending_reaction_and_continues_deterministically
```

Core 结果：PASS，338 passed，0 failed，0 ignored。原生 SQLite crash-resume 结果：PASS，1 passed，0 failed/ignored。

## SOT 条款映射

| Gate C 条款 | 主要可执行证据 |
|---|---|
| StackMode × RefreshPolicy 唯一确定合并 | `status_merge::tests::policy_rejects_every_illegal_stack_refresh_cross_product`；`status_merge::tests::add_uses_one_identity_caps_stacks_and_applies_each_refresh_policy`；`status_merge::tests::replace_is_atomic_and_uses_the_incoming_identity_and_clocks`；`status_merge::tests::highest_only_uses_rank_then_definition_id_and_refreshes_exact_reapplication`；`status_merge::tests::independent_stacks_add_until_maximum_without_eviction_or_refresh` |
| Status commit 后规则效果立即生效，DurationStartPolicy 只管 clock | `trigger::tests::calculated_and_committed_hooks_are_separate_and_invalid_fact_is_atomic`；`clock::tests::next_owner_clock_is_immediate_for_rules_but_ticks_and_expires_on_next_full_turn` |
| CURRENT_CLOCK 合法上下文唯一 | `clock::tests::current_clock_requires_a_matching_unexpired_window_and_never_backfills_ticks`；`clock::tests::permanent_status_never_advances_and_current_permanent_is_illegal` |
| Auto + Ask + ReactionCharges>1 共用 Canonical Scheduler | `reaction::tests::auto_reaction_enters_scheduler_commits_charge_then_releases_effects`；`reaction::tests::auto_then_ask_share_canonical_queue_and_consume_two_available_charges`；`reaction::tests::multi_ask_snapshot_continues_deterministically_and_accepts_trigger_exactly_once` |
| OWNER_TURN / ROUND / PERMANENT 与 NEXT_CLOCK | `turn::tests::round_and_normal_owner_turn_start_advance_only_their_owned_clocks`；`clock::tests::round_clock_ticks_exactly_twice_before_expiring_after_second_tick`；`clock::tests::permanent_status_never_advances_and_current_permanent_is_illegal`；`clock::tests::next_owner_clock_is_immediate_for_rules_but_ticks_and_expires_on_next_full_turn` |
| Stun 完整 Turn Lifecycle | `turn::tests::active_controlled_actor_keeps_full_lifecycle_but_downed_during_start_skips_action`；`turn::tests::normal_lifecycle_is_fixed_and_defeated_or_removed_slots_do_not_block_round_end` |
| Control Resistance / HARD_CC DR 单次 ceil 与 quiet reset | `control::tests::duration_combines_resistance_and_dr_before_the_only_ceil`；`control::tests::hard_cc_uses_pre_application_level_then_commits_dr_only_after_status_apply`；`control::tests::quiet_counter_resets_only_after_two_complete_normal_owner_turns`；`turn::tests::hard_cc_quiet_reset_counts_controlled_full_turn_but_not_extra_or_skipped_slot` |
| Player Ask 与 Utility AI Reaction ownership | `reaction::tests::utility_owned_ask_never_opens_player_window_and_requires_typed_decision`；`reaction::tests::companion_cannot_gain_player_prompt_through_a_bad_player_assignment`；`reaction::tests::utility_execution_resume_does_not_request_a_second_decision` |
| ResolveReaction / PendingReaction crash-resume exactly once | `reaction::tests::ask_window_suspends_and_restores_exact_context_queue_and_rng`；`reaction::tests::tampered_pending_item_shape_and_selected_identity_fail_restore`；`combat_persistence::tests::crash_resume_preserves_pending_reaction_and_continues_deterministically` |

## 结论

M11 Gate C = PASS。Pending Reaction 的内存确定性与真实 SQLite 关闭/重开恢复均受检；没有新增 skip/ignore 或以重建当前默认值代替 checkpoint。
