# M11 Gate G — Persistence / Replay / Compatibility Evidence

状态：Persistence / Release suite PASS；M11 Final certification 仍等待 M11-T08/T09/T10

采集日期：2026-09-13（Asia/Shanghai）

被测实现提交：`32e6b6d`（Gate A–F PASS）

## 执行门禁

```text
cargo test -p ember-combat-core --lib
cargo test -p ember-native-bridge combat_persistence::tests
cargo test -p ember-native-bridge save_archive::tests
vitest run packages/persistence/src/save-export.test.ts windows-app/src/save-home-page.test.tsx
pnpm archive:interop
```

## SOT 条款映射

| Gate G 条款 | 主要可执行证据 |
|---|---|
| Ordinary Defeat / Aborted rollback 与 Victory / Escape commit | `runtime_commit` 的 ordinary defeat、loop-guard aborted、victory canonical delta tests；native `every_combat_result_applies_its_persistence_policy_in_the_canonical_transaction` 覆盖六类 Result 与三种 Scripted policy 的真实 SQLite matrix |
| strategy / preference stable input barrier replay | `tactical::tests::strategy_and_every_preference_are_structured_accepted_commands`；`tactical::tests::duplicate_command_id_is_idempotent_and_projection_is_replay_derived`；`replay::tests::same_fixture_replays_roll_scheduler_ai_command_result_and_final_hash` |
| Loop Guard checkpoint exact resume | `scheduler::tests::engine_failure_checkpoint_is_terminal_and_tampering_is_rejected`；native `loop_guard_limits_are_frozen_instead_of_replaced_by_current_defaults` 与 `repeated_save_advances_only_persistence_revision_and_rejects_tampering` |
| Objective / Protect Removed 与 Reinforcement save/replay | typed ActiveCombatSave partition/hash restore 对 objective runtime、failed objectives、reinforcement deployment/stored initiative 逐项交叉复验；Core objective/reinforcement monotonic tests 与 archive active-checkpoint roundtrip 同时执行 |
| CombatResult exactly-once 与 crash window | native `result_commit_survives_crash_before_cleanup_without_reapplying_domain_delta`；`failed_domain_transaction_rolls_back_effect_and_result_marker_together`；BattleRecord marker、domain mutation 与 finished ledger 同事务，cleanup 独立幂等 |
| Scripted persistence policy | `runtime_commit::tests::scripted_result_requires_and_obeys_an_explicit_persistence_policy`；native matrix + `scripted_result_without_explicit_policy_writes_nothing` |
| Active checkpoint + per-channel RNG | native `crash_resume_preserves_pending_reaction_and_continues_deterministically`；Core RNG snapshot/channel isolation；checkpoint restore 拒绝分区/hash/cursor 漂移 |
| Tactical / Reaction external-input replay | `replay::tests::accepted_reaction_decision_replays_the_same_suspended_context`；tactical accepted-command tests；PendingReaction native crash-resume exactly once |
| Replay / version compatibility | BattleRecord replay input只取 versions/seed/InitialState/AcceptedCommands；portable v1/v2/v3 historical fixtures、current v4 TS↔Rust interop、unsupported combat version atomic rejection 与中文 Compatibility Gate |

## Stress sequencing boundary

V5.2 Gate G 的最终列表还包含 long-combat / trigger-depth / generated-content stress。任务清单把该工作明确安排为依赖 Gate A–G suites 的 M11-T09，因此本任务不提前实现或伪造压力结果。这里的 Gate G 表示 M11-T07 所定义的 Persistence / Release suite 已通过；只有 M11-T09 完成且 M11-T10 四世界 production playtest 通过后，才允许形成 M11 Final certification。当前不得使用 `v0.4 Combat Development Complete` 结论。

## 结论

M11-T07 Gate G Persistence / Release suite = PASS。所有 durable state 继续以 SQLite 为唯一真源，AI/UI 不参与恢复解释或 canonical mutation。
