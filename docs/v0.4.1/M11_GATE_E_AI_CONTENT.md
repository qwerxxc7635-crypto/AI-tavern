# M11 Gate E — AI Combat Content Evidence

状态：PASS

采集日期：2026-09-13（Asia/Shanghai）

被测实现提交：`26fea13`（Gate A–D PASS）

## 执行门禁

```text
vitest run packages/ai-core/src/task-schemas.test.ts packages/application/src/combat-content-candidate-policy.test.ts windows-app/src/desktop-ai-orchestrator.test.ts
cargo test -p ember-combat-core --lib
cargo test -p ember-combat-presentation --lib
```

Gate 同时覆盖 untrusted provider output、local mapping/budget/validation、Candidate commit policy 与 programmatic presentation；AI response 不直接进入规则状态。

## SOT 条款映射

| Gate E 条款 | 主要可执行证据 |
|---|---|
| AI 不输出/执行任意代码 | `task-schemas.test.ts` 的 `keeps Combat Concept structured, untrusted, and free of final numeric mechanics` 拒绝 executable/handler 字段；`mechanical_intent::tests::strict_wire_shape_rejects_unknown_fields` 只接受封闭 wire shape；`effect::tests::exact_tagged_unions_reject_runtime_code_and_unknown_semantics` 拒绝 runtime code |
| AI 不决定 final numeric | 同一 Task Schema test 拒绝 final numeric mechanics；`power_budget::tests::generates_numbers_after_budget_and_verifies_the_receipt` 由本地 balance 生成数字；`power_budget::tests::tampered_numbers_and_receipts_fail_recalculation` 拒绝篡改数字 |
| Mapping 仅进入 canonical handlers/catalog/封闭 Resolution/允许的 typed override | `mechanical_intent::tests::maps_to_canonical_authorities_and_is_order_independent`；`mechanical_intent::tests::maps_only_the_existing_local_typed_override_types`；`ai_mechanical_exposure::tests::every_local_override_is_developer_only_for_ordinary_ai`；`ai_mechanical_exposure::tests::cross_profile_and_noncanonical_inputs_fail_closed` |
| Mechanical Tooltip 全由程序生成 | `combat-presentation::tests::projects_every_required_mechanical_family_from_the_approved_definition`；`combat-presentation::tests::composition_keeps_ai_flavor_and_programmatic_mechanics_as_separate_fields`；`combat-presentation::tests::rejects_obvious_text_conflicts_without_changing_mechanics` |
| 玩家可见 AI 战斗文本为中文 | `combat-presentation::tests::rejects_non_chinese_and_natural_language_mechanical_copies`；`view_model::tests::invalid_state_or_missing_non_chinese_presentation_data_is_rejected`；仓库 `check-player-language` 静态 gate |
| invalid / exploit / budget failure 不进入 Canonical World State | `combat-content-candidate-policy.test.ts` 的 invalid/incomplete rejection 与 background transaction rollback；`exploit_validator::tests::require_valid_prevents_rejected_build_from_advancing`；`power_budget::tests::malformed_config_level_rarity_and_cost_intent_fail_closed` |
| User-requested 与 background commit policy | `combat-content-candidate-policy.test.ts` 的 explicit confirm flow、background automatic idempotent transaction、policy-specific action revalidation；未确认 candidate 不写 domain state |
| Provider orchestration 仍走结构验证/repair | `desktop-ai-orchestrator.test.ts` 的 combat selected-provider pipeline、invalid proposal repair、final-numeric proposal repair tests |

## 结论

M11 Gate E = PASS。AI 只生成不可信 Concept/flavor；规则映射、数值、验证、持久化与 tooltip 均由本地程序拥有。
