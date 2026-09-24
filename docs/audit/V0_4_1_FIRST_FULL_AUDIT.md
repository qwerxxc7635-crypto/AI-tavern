# Ember Tavern v0.4.1 — M12-T01 First Independent Full Audit

审计日期：2026-09-24。冻结源码：`beff8f3f4904c9ce9c7dfb360b9d5e89573aaef6`。

规则来源：外部 V5.2 Final Development Document（SHA-256 `f0d38e3ab772817f8a0bde3409d2b5fdac5f6e922c22aa9703988807470ec07c`）优先于外部 `V0.4.1_TASKS_FINAL.md`（SHA-256 `7e31d914bb303ad5c8cbf2a24bf75da4e11d2724313eb01967371115692b954b`），再对照仓库 `docs/spec.md`、`AGENTS.md`、源码与门禁证据。三个隔离上下文的只读审计分别覆盖 Core/SQLite、UI/Theme/AI/Security、SOT/任务/发布证据；主线程复核了全部阻断项的调用链。审计期间未修改被审源码。

## 判定

**审计任务完成；发布判定 FAIL。** P0=0，P1=10，P2=4，P3=0。M11-T10 的实机操作记录证明固定示例可在四个 release shell 中运行，却不能证明真实 Campaign/Encounter 战斗已接入。原 M11 Final Gate PASS 同时缺少新增生产集成在 Windows 上的证据，故该 Gate 应恢复为 FAIL，不能据此宣称 Release Candidate 或 Release Ready。M12-T02 只处理下列 finding，修复后重新执行受影响的 M11 门禁。

严重级别：P1 为阻断战斗正确性、数据一致性或发布门禁的缺陷；P2 为必须在 RC 前闭环的合同/覆盖缺口。每条 finding 的状态在本次审计基线均为 `OPEN`，后续修复不得删除原始证据。

| ID | 级别 | 范围 | 发现 |
| --- | --- | --- | --- |
| M12-041-001 | P1 | 生产接入 | 战斗从固定角色/敌人和 URL 世界枚举生成，与 Campaign/Encounter 数据脱节 |
| M12-041-002 | P1 | Command | 生产技能跳过 Execution Revalidation 与原子 usage commit |
| M12-041-003 | P1 | Effect | 状态直接写入 CombatState，绕过统一 Effect/Trigger 路径 |
| M12-041-004 | P1 | Objective | 清空目标并按固定敌人退场直接判 Victory |
| M12-041-005 | P1 | Domain Transaction | 结果以空 callback 标记已提交，未应用领域 delta |
| M12-041-006 | P1 | Battle identity | 同一 Campaign/World 的后续战斗复用身份并污染历史 |
| M12-041-007 | P1 | Checkpoint | 并发旧快照可覆盖较新的命令/RNG/调度状态 |
| M12-041-008 | P1 | Theme / Assets | 生产页绕开 Theme Loader，119 张素材未实际绑定 |
| M12-041-009 | P1 | AI Content | Gate E 组件没有生产 validator/候选提交调用链 |
| M12-041-010 | P1 | Release evidence | 新生产集成没有同源码 Windows 门禁；M11 Final PASS 不成立 |
| M12-041-011 | P2 | Replay | 生产 AcceptedCommands 没有对应的 canonical replay executor |
| M12-041-012 | P2 | Events | Bridge 自建事件并重建固定 HIT/VICTORY 语义 |
| M12-041-013 | P2 | Presentation | UI legality/cost 在编排层重新计算 |
| M12-041-014 | P2 | Localization | 中文检查允许混合英文的运行时 ViewModel 文本 |

## 阻断 Findings

### M12-041-001 — 生产战斗未从存档中的角色和 Encounter 建立

- 证据：[`combat_session.rs`](../../crates/native-bridge/src/combat_session.rs) 第 42–47、81–123、451–545 行固定 `hero/enemy`、seed、24/12 HP、资源、先攻、一个意图及空目标；第 248–260 行只接受一个技能打一个目标或固定开场反应。[`combat-page.tsx`](../../windows-app/src/combat-page.tsx) 第 22–35、47–54 行从 URL 读取 `world`，Tauri 原样转发；`start_or_restore_combat_session` 第 191–223 行不读取 Campaign Constitution、角色或 Encounter。仓库非测试入口没有从 Adventure/Encounter 导向 Combat 的链接。UI 的 EndTurn 只有投影该 action 时才出现，而本 Session 不投影它。
- 影响：用户可在同一存档通过修改 URL 选择四种规则世界；真实角色属性、装备、战斗遭遇和世界事实不参与战斗。四世界实机记录运行的是同一个两次固定攻击的示例，无法完成真实 Encounter 的 EndTurn/Escape/队友等流程。
- 依据：V5.2 §4.5.2.1、§11、§18.3；外部 TASKS M8-T04、M11-T10；`AGENTS.md` 的 SQLite 唯一事实源和禁止伪实现规则。

### M12-041-002 — 生产技能执行跳过统一复验与使用次数提交

- 证据：[`combat_session.rs`](../../crates/native-bridge/src/combat_session.rs) 第 651–690 行仅调用 Submission Validation 后直接提交成本，第 692–743 行进入伤害结算；未调用 [`execution.rs`](../../crates/combat-core/src/execution.rs) 第 74–77 行的 `ExecutionRevalidationService::revalidate_and_commit`。Ability usage 在 Session 第 1183–1188 行初始化为零，随后只投影、不推进。
- 影响：PreAction 后的沉默/目标变化不能按共用前置条件取消；Cooldown、每回合/每战使用次数和成本不再原子提交，生产路径与 Core 测试语义分叉。
- 依据：V5.2 §11.0/§11.0.4；外部 TASKS M2-T04、Gate A。

### M12-041-003 — 状态写入绕过 typed Effect pipeline

- 证据：[`combat_session.rs`](../../crates/native-bridge/src/combat_session.rs) 第 795–885 行在 Native 编排层构造状态定义、调用 merge、直接替换/追加 `target.statuses` 并手动增加 revision/sequence；第 764–770 行另行生成桥接事件。它没有执行 `ApplyStatus` handler 的 WorkingState、Hook/Trigger、提交事件及 provisional delta 路径。
- 影响：Status 可在生产战斗中出现，但相关触发、反应、回放和领域 delta 语义不具备与 Core 相同的保证。
- 依据：V5.2 §6.2、§9、§11；外部 TASKS §1.3、M3-T06、Gate B。

### M12-041-004 — 胜利绕开 CombatObjectiveSet

- 证据：[`combat_session.rs`](../../crates/native-bridge/src/combat_session.rs) 第 506–513 行将 Objectives 固定为空；第 761–790 行只要固定敌人不再 Active 就加入 Victory 候选；第 1079–1083 行日志结果也固定为 Victory。
- 影响：Survive、Protect、DefeatTarget、Escape、Scripted、增援和同时终局无法决定实际结果。
- 依据：V5.2 结论 14、§11.4 明令禁止将“所有敌人 HP=0”写死为唯一结束条件；外部 TASKS M2-T08/T09。

### M12-041-005 — 战斗结果事务不应用领域变化

- 证据：[`combat_session.rs`](../../crates/native-bridge/src/combat_session.rs) 第 290–305 行以 `|_transaction, _plan| Ok(())` 调用 `commit_combat_result_with`；[`combat_persistence.rs`](../../crates/native-bridge/src/combat_persistence.rs) 第 405–430 行随后写入 BattleRecord result marker 与 `COMBAT_FINISHED`，第 441–466 行清理活跃存档。
- 影响：任何应保留的角色、背包、奖励或世界变化均未写入 SQLite，却已被 exactly-once marker 认定完成；重试不能补写。
- 依据：V5.2 §11.2.1/§11.2.2；外部 TASKS M10-T04/T06、Gate G；仓库禁止空实现。

### M12-041-006 — 第二场同世界战斗复用旧 BattleRecord

- 证据：[`combat_session.rs`](../../crates/native-bridge/src/combat_session.rs) 第 1211–1224 行仅用 Campaign ID 和 World 构造 Combat ID；完成后只删除活跃存档，下一次 Start 在第 197–215 行使用同 ID。[`combat_persistence.rs`](../../crates/native-bridge/src/combat_persistence.rs) 第 156–176 行对旧 BattleRecord upsert 命令/事件但保留 result marker，第 361–385 行把它当作 AlreadyCommitted 或冲突。
- 影响：下一场战斗不能成为独立记录；旧历史可被改写，结果提交可被误判为上场的幂等重试。
- 依据：V5.2 §11.2.2 每场战斗独立稳定身份；外部 TASKS M10-T01/T04、Gate G。

### M12-041-007 — 旧 Checkpoint 写入可覆盖较新的确定性历史

- 证据：[`combat_persistence.rs`](../../crates/native-bridge/src/combat_persistence.rs) 第 108–148 行 `save_combat_checkpoint` 无 expected revision，只读取当前 revision 并加一；第 156–223 行无条件更新命令、事件、当前状态、RNG、Scheduler、Reaction 与成本。Session 第 228–270 行执行恢复→变更→保存，未携带并发比较。`ensure_monotonic` 仅比较 Objective/Reinforcement（第 864–895 行）。
- 影响：两个并发提交者都基于 revision N 计算时，后写者可抹掉前写者的 AcceptedCommand/RNG/Reaction 历史而仍取得更高持久化 revision。
- 依据：V5.2 §10.2、§17 的 deterministic checkpoint/AcceptedCommands 合同；外部 TASKS M10-T02。

### M12-041-008 — 生产 Theme 未加载 FINAL 包

- 证据：[`combat-page.tsx`](../../windows-app/src/combat-page.tsx) 第 119–123 行直接调用 `combatThemeForWorld`；[`combat-theme-binding.ts`](../../windows-app/src/combat-theme-binding.ts) 第 13–28 行返回非合同 `TACTICAL_DUEL` preset、非 `*-default` ID、两个色值及空 warnings。真正的 Loader/Resolver 在 [`combat-theme-service.ts`](../../windows-app/src/combat-theme-service.ts) 第 13–85 行，素材 slot→CSS 绑定在 `combat-theme-binding.ts` 第 31–51 行，均无生产调用；合同合法 preset 见 [`combat-theme.ts`](../../packages/contracts/src/combat-theme.ts) 第 7–15 行。
- 影响：生产页的 `--combat-asset-*` 变量为空，119 张素材虽通过完整性门禁却未用于实战，世界 preset CSS 也不匹配。
- 依据：V5.2 §25.1/§25.3；外部 TASKS M9-T02..T08、Gate F。

### M12-041-009 — AI Combat 候选管线只在组件/测试中存在

- 证据：[`combat-content-candidate-policy.ts`](../../packages/application/src/combat-content-candidate-policy.ts) 第 38–40 行只有 validator 接口，第 87–210 行是可注入 policy；非测试源码中没有该 policy 的构造或 `CombatCandidateValidator` 的具体实现。生产 Session 第 1098–1106 行使用固定 tooltip/flavor。
- 影响：当前产品不能将 Combat Concept 经本地 Mapping/Budget/Validation 后作为真实 Candidate 确认并提交；已有 Gate E 测试只覆盖孤立合同，且接口允许仅凭检查名字符串宣称通过。
- 依据：V5.2 §14、Gate E；外部 TASKS M6-T01..T08、M11-T05。

### M12-041-010 — M11 Final Gate 缺少最终源码的 Windows 证据

- 证据：[`M11-T08 manifest`](evidence/v0.4.1/M11-T08-a5d5e4c/manifest.json) 仅证明旧提交 `a5d5e4c` 的 Core exact fixtures；生产 Native/Tauri/UI 代码在后来的 `5040736` 引入。[`M11-T10 manifest`](evidence/v0.4.1/M11-T10-5040736/manifest.json) 只有 macOS arm64 shell 与本地命令，无该源码的 Windows build/runner/实机收据。此前 [`TASKS.md`](../TASKS.md) 和 [`M11 playtest`](../v0.4.1/M11_FOUR_WORLD_PRODUCTION_PLAYTEST.md) 将 Final Gate 写作 PASS。
- 影响：Windows 优先的生产集成没有在 Windows 运行或构建证据；四个 shell binary 与原始 UI/SQLite trace 也未随审计仓库保存，收据不能独立重演。M11-T10 的“完整真实战斗”结论还受到 Findings 001–005、008 的反证。
- 依据：外部 TASKS M11-T08/T10 与全局 DoD：缺失平台必须 `NOT_RUN/BLOCKED`，Gate A–G 全部 PASS 后才进 M12。

## P2 Findings

### M12-041-011 — 生产历史没有 replay executor

- 证据：[`replay.rs`](../../crates/combat-core/src/replay.rs) 第 95–111 行的 runner 需要调用方执行 closure；[`combat_persistence.rs`](../../crates/native-bridge/src/combat_persistence.rs) 第 260–300 行只读取四项 Replay 输入。仓库非测试代码没有 `CombatReplayRunner::run` 的调用，生产 Session 也没有共用 live/replay executor。
- 影响：BattleRecord 能读取 AcceptedCommands，却不能以生产规则路径重演并比对结果；现有 replay 测试使用 fixture closure。
- 依据：V5.2 §17、Gate A；外部 TASKS M10-T03。

### M12-041-012 — Bridge 事件重建固定结果语义

- 证据：[`combat_session.rs`](../../crates/native-bridge/src/combat_session.rs) 第 167–189 行另定义 `DurableCombatEvent`，第 1019–1096 行将其转换为 Presentation payload 并固定每次 Resolution 为 HIT、Result 为 VICTORY，平行于 Core committed event 类型。
- 影响：非固定内容的 miss、save、shield、defeat 等真实已提交事实无法从该事件合同如实投影。
- 依据：V5.2 §11.1、§39；外部 TASKS §1.3/§1.8 禁止第二套事件语义。

### M12-041-013 — Presentation 编排层重复判定合法性与成本

- 证据：[`combat_session.rs`](../../crates/native-bridge/src/combat_session.rs) 第 895–962 行根据 result/reaction/enemy/AP/resource 手写 `legal`、目标列表与成本预览；这些值不是唯一 Precondition/GetLegalTargets 输出。
- 影响：Cooldown、状态、标签或复杂目标条件引入后，UI 提示与提交判定可分歧。
- 依据：V5.2 §4.2、§6.1.1；外部 TASKS M8-T05、架构冻结清单。

### M12-041-014 — 中文门禁无法阻止混合英文文本

- 证据：[`player-language.mjs`](../../scripts/player-language.mjs) 第 62–88 行未扫描 Rust/运行时 ViewModel；[`view_model.rs`](../../crates/combat-presentation/src/view_model.rs) 第 1332–1345 行只要求可见文本包含至少一个汉字，`胜利 MISS` 可通过；相关 reaction/action/name 使用该判定。
- 影响：带汉字前缀的内部英文结果或 Enum 文本可能进入玩家 Combat UI，同时静态语言门禁保持绿色。
- 依据：V5.2 §18.1.1；外部 TASKS M8-T09。

## 已核验的范围与限制

- 独立审计运行 Core 344/344、Native Combat 17/17、UI/Theme/Tauri 定向 95/95、`pnpm i18n:check`、`pnpm assets:check`（119/119）、Windows 前端生产 build、`pnpm release:check`、CI/版本 Node 测试 11/11，均通过。完整 `pnpm check` 由规范审计会话启动；其 Rust workspace 阶段在该会话报告时仍运行，故本报告不把该次执行记为已完成 PASS。M11-T10 先前完整本地门禁的收据仍为历史记录。
- Canonical Core Scheduler/Loop Guard、fixed-point/RNG、Status/Reaction 核心模块、四世界 Profile/Primary Mitigation 所有权、migrations/portable archive 的已审范围未发现独立缺陷；问题主要在生产连接层。
- 已检查范围内未发现任意 AI 代码执行、Runtime Rule Plugin、第二个 Provider/密钥库/SQLite、全局 boolean flag soup、提交的真实 API Key、生产 `eval`/`new Function`/`dangerouslySetInnerHTML`。静态素材身份和 manifest digest 正确；“素材未用于生产”另见 Finding 008。
- 发布元数据目前统一为 `0.3.0`，v0.4.1 身份冻结属于 M12-T06，不记作本任务 finding。真实 Provider 付费调用未运行，也不被记作 PASS。

下一步为 M12-T02：逐 finding 修复、记录 root cause / fix commit / regression test / closure；所有 P1/P2 闭环后，才允许 M12-T03 从 clean baseline 再独立审计。
