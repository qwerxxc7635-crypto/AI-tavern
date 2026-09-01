# Ember Tavern v0.4.1 范围与发布门

状态：FROZEN

冻结日期：2026-09-01

适用范围：v0.4.1 Combat System 的实现、测试、集成、审计与 Release Candidate 准备

## 1. 文档用途

本文是后续开发会话的范围入口，只回答“本版本做什么、明确不做什么、遇到规格冲突如何处理、何时允许发布”。本文不复制战斗规则，也不成为第二份 Combat Product Rules Source of Truth。

任何具体战斗语义、数值顺序、RNG 消费、状态机、持久化或 UI 合同都必须回到 V5.2 对应章节确认；任何任务的依赖、交付物和 Definition of Done 都必须回到 `V0.4.1_TASKS_FINAL.md` 确认。

## 2. 权威来源与优先级

权威优先级固定为：

1. `V0.4_COMBAT_SYSTEM_FINAL_DEVELOPMENT_DOCUMENT_V5.2（2）.md`；
2. `V0.4.1_TASKS_FINAL.md`；
3. 当前真实仓库实现；
4. 历史规格、旧 TASKS、旧审计、注释与实现草稿。

本次交付输入已按字节身份记录：

| Input | SHA-256 / identity |
|---|---|
| V5.2 Combat Source of Truth | `f0d38e3ab772817f8a0bde3409d2b5fdac5f6e922c22aa9703988807470ec07c` |
| v0.4.1 TASKS FINAL | `7e31d914bb303ad5c8cbf2a24bf75da4e11d2724313eb01967371115692b954b` |
| Runtime Combat Assets | `SHA256SUMS.txt` 全项校验 PASS；包声明 119 个 Runtime Assets |

文件名中的 `v0.4`、`v0.4.1` 或括号字符差异不改变权威内容：本轮产品版本统一为 **v0.4.1 — Combat System**。不得创建 V5.3，不得使用 V5/V5.1 覆盖 V5.2。

## 3. v0.4.1 范围

本版本只交付冻结的 Combat System：

- 确定性 Combat Core、版本、Seed/RNG channels、Command、State、Invariant 与统一规则边界；
- 3 AP + Reaction、Initiative/Timeline、D20 Resolution、Cost/Usage、Scheduler/Loop Guard；
- Ability、Effect、Gameplay Tag、Status、Reaction、Damage/Defense、Downed/Revive/Solo Recovery；
- CombatObjective、CombatResult、Runtime rollback/commit contract；
- 四套 WorldCombatProfile：Cultivation、Fantasy、Sci-Fi、Urban；
- 复用既有 AI Orchestrator/Candidate/Provider/Domain Transaction 的 Combat Content 管线；
- 确定性 Utility AI、Tactical Strategy、Enemy Intent；
- 单一 CombatScreen、全简体中文 Presentation、四主题与正式 Runtime Asset 接入；
- 复用既有 SQLite、Save、Event Ledger 与 Domain Transaction 的 Save/Resume/Replay/Exactly-once；
- v0.3 Character/Save compatibility、自动测试、压力测试、四世界完整战斗验证、跨平台证据与独立审计。

实现必须复用当前 v0.3 的 Character Domain、SQLite、Persistence、Event Ledger、Domain Transaction、AI Task Orchestrator、Candidate、Provider abstraction、credential/retry/repair/cache metrics。不得建立平行基础设施。

## 4. 明确不在范围内

v0.4.1 不实现或提前接入：

- World Map、Region/Location Navigation、地图移动或 NPC 地图位置；
- v0.4.2 Map System、v0.4.3 Dialogue System、v0.4.4 World Generation & Integration；
- Grid/Hex、自由移动、高低差、Cover、Surface、Knockback、Pull；
- 普通 MultiTarget Ability、普通空间 AOE、普通 Spawn/Summon Ability Runtime；
- 完整 Boss Editor、实时 LLM Combat Judge；
- 第二套 Character Attribute、AI Pipeline、Provider、Credential、Event Ledger、Persistence 或 Domain Transaction；
- Generic Rule Engine、Universal Capability System、通用 Runtime DSL、动态 Plugin Registry 或 Full ECS Rewrite；
- 真实大模型回合内裁决或未经明确授权的付费 Provider 调用；
- iOS 全面开发。

相邻版本只能通过冻结的 Encounter、CombatResult 与 Canonical World Delta 边界与 Combat 集成，不得借相邻版本需求反向扩大 v0.4.1。

## 5. 架构与数据红线

- 本地 SQLite 仍是游戏状态的唯一真实数据源；AI 输出只能成为受验证候选。
- AI 不得生成或执行 JavaScript、Rust、任意表达式或 Runtime Code，也不得决定最终权威数值。
- 封闭权威语义使用 Enum/Tagged Union；开放内容词汇使用 Stable ID + Static Catalog；可执行 Effect 使用 typed static handler；特例归所属子系统的 local typed override。
- 不建立 giant enum、万能 registry、Boolean Flag Soup、per-ability special code 或跨 Core/UI/AI/Tooltip 重复解释规则的 distributed semantic switch。
- `DamageChannelCatalog` 只拥有 channel 身份；World-specific primary mitigation 只由 `WorldCombatProfile` 拥有。
- UI 不直接写 CombatState，不复制 target legality；合法目标只来自 `GetLegalTargets()` 或同语义权威 API。
- 所有会改变确定性未来的外部输入都通过统一 Command Boundary 和 `acceptedSequence`。
- API Key 不得进入代码、普通配置、日志、存档、导出或测试证据。

## 6. SPEC BLOCKER 流程

只有当两个合理解释会导致不同的权威结果时，才登记 `SPEC BLOCKER`：

- 不同 CombatState；
- 不同 RNG roll、cursor 或 consumption order；
- 不同 scheduler ordering 或 committed event；
- 不同 CombatResult；
- 不同 canonical persistence、Save/Load/Replay 或 exactly-once 结果。

登记必须包含：涉及章节、最小复现、两个可能解释、各自的权威输出差异、受影响任务链。只暂停受影响链路，不自行发明规则，也不把未受影响工作一并停止。

不满足上述门槛的问题必须归类为 `Implementation Bug`、`Test Bug`、`Data / Asset Bug` 或 `Polish`，按根因修复并增加回归证据。

## 7. 执行与证据规则

- 严格按 `V0.4.1_TASKS_FINAL.md` 的 `DependsOn` 顺序从 M0-T01 到 M12-T07；不自动进入 v0.4.2。
- 每个 Task 必须完成：对应 V5.2 复核、真实仓库调查、最小实现、测试、diff review、根因修复、TASKS/DEVELOPMENT_LOG 更新和独立 commit。
- 测试状态只使用 `PASS / FAIL / BLOCKED / NOT_RUN`。Fake Provider、fixture 或 simulation 必须明确标记，不能替代真实 Provider 结论。
- 当前环境无法执行的 Windows、签名、notarization、真实 Credential 或外部 Provider Gate 必须保留为 `NOT_RUN / BLOCKED / REQUIRED`。
- 不通过删除测试、降低 Schema/Validation、吞错、任意 fallback 或修改冻结规则获得绿色结果。

## 8. Release Gate

只有以下证据全部真实 PASS，才允许写出 `v0.4.1 COMBAT SYSTEM — RELEASE READY`：

- V5.2 compliance 与 M0–M12 所有 required tasks；
- Gate A Deterministic Core；
- Gate B Resolution / Effect；
- Gate C Status / Reaction；
- Gate D Four World Profiles；
- Gate E AI Content；
- Gate F UI / Theme / 119 Runtime Assets；
- Gate G Persistence / Release；
- required automated tests、long-combat/generated-content stress、四世界真实 UI playtest；
- v0.3 Character/Save compatibility；
- macOS 与 Windows required evidence；
- P0=0、P1=0、P2=0；
- 无 unresolved SPEC BLOCKER、重复基础设施、任意 AI Runtime Code 或玩家可见英文功能性文字。

任何一项证据缺失、未运行或受外部环境阻塞，都必须保持对应的 `NOT_RUN / BLOCKED / REQUIRED`，不得降低 Release Gate。

## 9. M0-T01 结论

- v0.4.1 与后续 0.4.2/0.4.3/0.4.4 的边界明确；
- V5.2 与 TASKS 的权威关系明确；
- Runtime Asset Source 及其完整性证据明确；
- SPEC BLOCKER 判定和停止范围明确；
- 当前未发现需要重新开放产品规则的 Scope 冲突。

M0-T01：**PASS**。下一任务严格为 M0-T02 — Repository Baseline Audit。
