# M11 Gate A — Deterministic Core Evidence

状态：PASS

采集日期：2026-09-13（Asia/Shanghai）

被测实现提交：`a469f67`（M10 Gate PASS）

## 执行门禁

```text
cargo test -p ember-combat-core --lib
```

结果：PASS，338 passed，0 failed，0 ignored。Gate 使用完整 Core suite，不以 mock、固定 PASS receipt 或跳过测试代替执行。

## SOT 条款映射

| Gate A 条款 | 主要可执行证据 |
|---|---|
| 相同 Versions + Seed + InitialState + AcceptedCommands 得到相同 roll、event order 与 final hash | `replay::tests::same_fixture_replays_roll_scheduler_ai_command_result_and_final_hash`；`version::tests::shared_fixture_round_trips_the_exact_current_wire_shape` |
| Canonical Scheduler sibling / child / Reaction 顺序及 resolution RNG 一致 | `scheduler::tests::same_key_sibling_runs_before_child_because_child_uses_later_sequence`；`scheduler::tests::higher_priority_child_reenters_same_queue_and_may_preempt_a_sibling`；`reaction::tests::ask_window_suspends_and_restores_exact_context_queue_and_rng` |
| Loop Guard depth、executedEventCount、resume counter exact，并统一 Aborted rollback | `scheduler::tests::depth_limit_allows_exact_n_and_aborts_on_n_plus_one_without_rng`；`scheduler::tests::event_count_limit_counts_only_first_n_eligible_executions`；`scheduler::tests::engine_failure_checkpoint_is_terminal_and_tampering_is_rejected`；`runtime_commit::tests::loop_guard_aborted_uses_overflow_sequence_and_never_commits_runtime_delta` |
| fixed-point exact values | `numeric::tests::shared_exact_value_fixture_locks_every_rounding_contract`；`numeric::tests::hard_cc_combines_all_multipliers_before_its_only_ceil` |
| Objective 在 Reinforcement / Removed / Survive / Protect 下唯一，committed Removed 不可逆 | `objective::tests::initialization_sorts_and_freezes_valid_definitions_and_rejects_ambiguous_shapes`；`objective::tests::eliminate_uses_frozen_tracked_ids_including_undeployed_reinforcement`；`objective::tests::survive_completes_only_after_the_nth_committed_round_end`；`objective::tests::protect_removed_is_committed_monotonic_and_cannot_be_undone_by_reactivation` |
| Usage commit 在 Cancel / Miss / Save / Immunity 下唯一 | `execution::tests::dynamic_failure_cancels_releases_cost_and_never_commits_usage_or_rng`；`execution::tests::pass_atomically_commits_cost_cooldown_usage_map_and_once_counters_before_rng`；`execution::tests::committed_costs_remain_for_miss_save_success_and_post_resolution_immunity` |
| initiative / resolution / utilityTieBreak RNG 隔离且 checkpoint 可恢复 | `rng::tests::channels_have_independent_cursors_and_values`；`rng::tests::snapshot_restore_resumes_exact_state_and_is_read_only`；`rng::tests::restore_rejects_wrong_order_bad_state_cursor_and_unknown_fields` |
| Submission validation 与 execution revalidation 边界 | `submission::tests::authority_stability_actor_ability_and_target_failures_are_structured_and_atomic`；`execution::tests::redirected_target_is_revalidated_against_current_legal_targets`；`enemy_ai::tests::submission_revalidation_failure_is_atomic_including_rng_cursor` |
| Cost reservation / resume 不双扣 | `cost::tests::nested_reaction_reservations_share_available_balances_and_release_cleanly`；`cost::tests::active_reservation_survives_save_and_tampered_ledger_fails_restore`；`submission::tests::reservation_conflict_rolls_back_command_acceptance_and_rng` |
| Working State 在 commit 前完成 LethalResolution | `damage_bundle::tests::lethal_or_invariant_failure_leaves_original_state_byte_identical`；`damage_bundle::tests::lethal_resolution_runs_once_only_after_every_normal_component`；`runtime_commit::tests::max_hit_points_and_combatant_state_share_canonical_delta_contract` |
| CombatState invariant 全覆盖 | `invariant::tests::rejects_every_bounded_combatant_value_outside_its_range`；`invariant::tests::working_state_may_be_temporarily_invalid_but_commit_validation_rejects_it`；`invariant::tests::hash_valid_save_restore_still_rejects_invalid_committed_state` |
| simultaneous terminal outcome 可重复且 exactly once | `terminal::tests::simultaneous_victory_defeat_and_escape_confirm_exactly_one_defeat`；`terminal::tests::confirmation_is_exactly_once_and_tampering_fails_closed` |

以上测试均位于 `ember-combat-core` 的权威规则模块内并由同一次完整 suite 执行。条款映射是审计索引，不缩小完整 338 项门禁范围。

## 平台边界

本次 Gate A 在 macOS arm64 本地执行并证明 deterministic Core suite 通过。Windows 上相同 fixtures 的 rolls、events digest、state hash、result 与 fixed-point exact values 尚未在本任务执行，因此不在此标记为 PASS；该双平台 required evidence 严格属于依赖 Gate A–G 的 M11-T08。

## 结论

M11 Gate A = PASS。没有新增 skip/ignore，没有改变规则、阈值或校验标准。
