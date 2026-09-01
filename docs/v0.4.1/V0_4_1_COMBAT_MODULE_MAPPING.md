# Ember Tavern v0.4.1 Combat Module Mapping

状态：M0-T03 PASS

日期：2026-09-01

依据：V5.2、`V0.4.1_TASKS_FINAL.md`、[`V0_4_1_REPOSITORY_MAPPING.md`](V0_4_1_REPOSITORY_MAPPING.md)

## 1. Mapping 结论

v0.4.1 不创建一套与现有 workspace 平行的“Combat 应用”。映射采用：

```text
TypeScript contracts / AI orchestration / React presentation
                         |
                         v
                  typed Tauri commands
                         |
                         v
              pure Rust authoritative Combat Core
                         |
                         v
          existing Rust CampaignStore persistence adapter
                         |
                         v
                     SQLite
```

唯一权威 Combat Runtime 规则实现在纯 Rust `ember-combat-core` crate。TypeScript 不再实现第二套可执行 Combat Engine；它只承载序列化 contract、AI 生成编排、frontend gateway/ViewModel 和 programmatic presentation。Rust core 同时服务 Windows/macOS Tauri、deterministic tests、replay 与 simulator，避免 TS/Rust 双核心产生不同 State/RNG/Result。

新 crate 的理由仅是建立可编译验证的纯 Core 边界：它不得依赖 Tauri、rusqlite、HTTP、Provider、系统时间或 UI。除此之外不新增 Combat package、plugin framework、DSL、registry framework 或第二套基础设施。

## 2. Physical Mapping

以下路径是后续任务的目标归属；M0-T03 只冻结映射，不预建空目录或伪实现。

| V5.2 logical area | Authoritative implementation | Existing integration point | Notes |
|---|---|---|---|
| `core` | `crates/combat-core/src/` | Cargo workspace；`ember-native-bridge` depends on core | Pure deterministic state machine；无 DB/UI/AI |
| `abilities` | `crates/combat-core/src/ability.rs` | serialized definitions in contracts/native DTO | Stable ability IDs + typed definitions；无 per-ability code |
| `effects` | `crates/combat-core/src/effect.rs` | native content validation/commit facade | Static typed handler dispatch；非 runtime plugin registry |
| `statuses` | `crates/combat-core/src/status.rs` | core scheduler/turn clocks | Stack/refresh/duration 唯一解释位置 |
| `tags` | `crates/combat-core/src/tag.rs` | content mapping + legal rules | Stable ID + static catalog；Tag 不执行代码 |
| `reactions` | `crates/combat-core/src/reaction.rs` | same core scheduler/checkpoint | 不建第二队列或第二 RNG |
| `ai/runtime` | `crates/combat-core/src/utility_ai.rs` | command boundary | Enemy/companion utility only；turn 内无 LLM |
| `ai/content` | existing `packages/ai-core`, `packages/prompts`, `packages/application` + native combat validation facade | `AI_TASKS`, task schemas, GeneratorRunner, DesktopAIOrchestrator, Candidate | AI 只生成 concept/flavor；native core/balance 决定 mechanics/numbers |
| `balance` | `crates/combat-core/src/balance.rs` | native Combat content commit | Power budget/program numbers/exploit checks；不塞进 effect handler |
| `profiles` | `crates/combat-core/src/profile.rs` | native world-profile resolver reads locked Constitution | four profiles compose developer modules；唯一 primary mitigation owner |
| `persistence` | `crates/native-bridge/src/combat_persistence.rs` + existing migration/archive machinery | `CampaignStore`, migration 33+, TS/Rust archive interop | M10 才创建 durable schema；core 不依赖 adapter |
| `presentation` | `windows-app/src/combat/` + existing localization/UI primitives/tokens | React routes/services, `playerText`, language gate | ViewModel/tooltip/theme only；不推导 rules |
| cross-layer contracts | `packages/contracts/src/combat.ts` and Rust serde DTOs | Tauri command/receipt fixture parity | Wire format only；不放 semantic execution |
| application commands | existing `windows-app` service pattern and Tauri command module | `invoke -> src-tauri -> CampaignStore` | All external inputs become accepted commands |

## 3. Authoritative Rust Core Layout

`crates/combat-core` 只按已证明的规则子系统拆分，不为每个 Task 建一个文件。预计最小布局：

```text
crates/combat-core/
├── Cargo.toml
└── src/
    ├── lib.rs
    ├── version.rs
    ├── numeric.rs
    ├── rng.rs
    ├── state.rs
    ├── invariant.rs
    ├── command.rs
    ├── preconditions.rs
    ├── resolution.rs
    ├── scheduler.rs
    ├── turn.rs
    ├── objective.rs
    ├── ability.rs
    ├── effect.rs
    ├── tag.rs
    ├── status.rs
    ├── reaction.rs
    ├── profile.rs
    ├── balance.rs
    └── utility_ai.rs
```

文件只有在对应 Task 有真实类型/行为/测试时才创建。若一个模块在实现时很小，允许合并到最接近的权威模块；不得为满足目录图制造空文件。

### 3.1 Core public facade

Core 对外只暴露有限 typed API，预期包括同语义接口：

- `start_combat(version_set, seed, initial_state, encounter)`；
- `submit_command(state, command)`；
- `resolve_reaction(state, resolve_reaction_command)`；
- `get_legal_targets(state, actor_id, ability_id)`；
- `preview_cost(state, actor_id, ability_id, target_id?)`；
- `snapshot(state)` / `restore(snapshot)`；
- `replay(versions, seed, initial_state, accepted_commands)`；
- `mechanical_projection(definition, state?)`；
- `utility_command(state, actor_id, strategy)`。

实际命名可遵循 Rust convention，但语义所有权不变。UI、AI content 和 persistence 均不得绕过 facade 直接拼出权威状态变化。

### 3.2 Core dependency prohibition

`ember-combat-core` 禁止依赖：

- `rusqlite`、filesystem、Tauri 或 platform services；
- Provider、HTTP、credential 或 prompt；
- React/localization/theme/assets；
- system time、`Math.random()` 等非版本化随机源；
- runtime dynamic registration、arbitrary script/DSL。

允许的外部输入只能是显式参数、版本化 definitions、accepted commands 和保存的 checkpoint。

## 4. Contract Mapping

`packages/contracts/src/combat.ts` 负责前端需要的 wire DTO：

- stable IDs 与 version set；
- serialized command envelope / accepted command receipt；
- read-only Combat snapshot/checkpoint/pending reaction DTO；
- legal target/cost preview/mechanical fact projections；
- Combat result/view data/error reason codes。

Rust serde DTO 是生产来源。TypeScript contract 与 Rust 必须通过固定 JSON fixture、unknown-field/version rejection 和 round-trip tests 证明字节语义兼容。

以下不进入 TypeScript contract：

- handler function；
- scheduler comparator implementation；
- damage/status/objective calculation；
- world profile rule execution；
- AI numeric generation；
- direct mutable `CombatState` API。

## 5. Native Bridge / Tauri Mapping

### 5.1 `ember-native-bridge`

新增的 Combat native facade 负责：

- 从现有 Character/Rules/Item/World/Encounter SQLite facts 组装 initial input；
- 调用 `ember-combat-core`；
- 在 stable point 写短事务 checkpoint/accepted command（M10）；
- 将 confirmed CombatResult 通过现有 domain transaction exactly once 应用到 inventory/world/quest/selected ledger facts；
- 对 AI Combat definitions 执行 core schema/rule/balance validation 后才持久化；
- 输出 typed query/command receipts。

它不得重新实现 core 算法，也不得在 SQL/Tauri command 中复制 scheduler、damage、target legality 或 objective logic。

### 5.2 Tauri commands

按现有 domain gateway pattern 提供最小 command/query surface，例如：

```text
combat_start
combat_get
combat_legal_targets_get
combat_cost_preview_get
combat_command_submit
combat_reaction_resolve
combat_resume
```

名称可在实现时微调。每个 mutate command 必须返回 stable receipt/sequence/state hash；重复 commandId 走幂等语义。不得向 WebView 暴露 SQL、Provider 或 mutable state handle。

## 6. AI Content Mapping

Combat Content 作为现有 AI task family 扩展：

```text
AI_TASKS / task schema
  -> unified context
  -> existing DesktopAIOrchestrator + Provider
  -> concept / mechanical intent candidate
  -> native Combat mapping + program numbers + budget + validation
  -> AICandidate preview/confirm policy
  -> existing CampaignStore transaction
  -> approved definition
  -> optional AI Chinese flavor task
```

归属：

- task enum/schema/output parse：`packages/ai-core`；
- prompts/flavor constraints：`packages/prompts`；
- USER_REQUESTED/BACKGROUND policy 与 candidate orchestration：`packages/application` / desktop service；
- allowed mechanics mapping、numbers、budget、exploit validation：Rust Combat Core/native facade；
- durable approved definition：existing SQLite/migration path；
- mechanical tooltip：native structured facts -> frontend presentation，不由 AI 编写。

AI exposure allowlist 是 balance/content adapter 的单一 policy，不复制到 effect catalog、prompt 和 UI 三处。

## 7. World Profile Mapping

当前 `WorldConstitution.worldType` 是开放字符串。v0.4.1 不把所有世界描述硬编码进 giant enum；在 native application boundary 增加版本化 resolver：

```text
locked World Constitution + explicit profile binding
  -> WorldCombatProfileId
  -> ember-combat-core developer-defined profile
```

四个 closed profile IDs 是 Cultivation/Fantasy/Sci-Fi/Urban。新战斗创建时必须持久化 resolved profile/version，Replay 不重新从后来修改的文本猜测。

`profile.rs` 唯一拥有：resource lifecycle、defense behavior、`primaryMitigationByChannel`、recovery、signature module、supported channels。Core 其他位置不得散落 `switch(worldType)`；DamageChannel catalog 不再存一份 primary mitigation。

如何把现有/旧存档开放 worldType 绑定到四类 profile 属于 M5/M10 的显式 compatibility policy，不在 M0-T03 猜测映射。

## 8. Character / Encounter Mapping

native adapter 从现有 facts 读取：

- `player_characters` / `universal_character_profiles`；
- `character_rule_states` 的 HP/resources/status/equipment/revision；
- NPC/Enemy identity、traits、equipment 与 Encounter predeclared roster；
- locked Constitution/profile binding。

`CombatAttributeResolver` 的字段矩阵由 M0-T04 冻结。Core 只消费 resolved combatant stats，不读取 SQLite 字段名，也不直接引用任意 Character JSON。

普通 Combatant 与 predeclared reinforcement 共用一个 stable definition。M0-T03 不引入普通 Spawn/Summon schema。

## 9. Persistence Mapping

Core 只定义 stable serializable values：

- Runtime state/hash input；
- RNG streams/cursors；
- SchedulerCheckpoint；
- ResolutionContext/PendingReaction/Cost snapshots；
- objective/reinforcement runtime；
- canonical delta/result identity。

M10 的 adapter 才负责：

- migration、BattleRecord、ActiveCombatSave；
- save/load/crash resume/replay；
- exactly-once result commit；
- selected Event Ledger facts；
- TS/Rust portable archive metadata、restore order、resource limits、interop fixtures。

不创建 Combat 专用 SQLite connection、database file、migration runner、event ledger 或 transaction manager。

## 10. Presentation Mapping

预计 `windows-app/src/combat/`：

```text
combat-service.ts          # typed Tauri gateway + receipt validation
combat-view-model.ts       # read-only state/mechanical facts -> UI projection
combat-page.tsx            # one CombatScreen
combat-components.tsx      # timeline/stage/HUD/action/target/reaction/log/result
combat-theme.ts            # manifest/slot/theme resolver, presentation only
combat-localization.ts     # stable reason/fact IDs -> zh-CN via playerText
```

这些文件按 M8/M9 实际需要创建，不提前建空壳。共享 Button/Card/Overlay/Status 等继续来自现有 `src/ui` 与 design tokens。

Dependency rule：

```text
presentation -> contracts + service/query output
native adapter -> combat core
combat core -X-> presentation / Tauri / SQLite / AI / assets
```

UI 只提交 Command；legal targets、disabled reason、cost preview、mechanical facts 来自 Core query/projection。Combat Log 只渲染 committed runtime events，不自行重算。

## 11. Test Mapping

| Test scope | Location / runner |
|---|---|
| Core exact-value/determinism/property fixtures | `crates/combat-core` unit/integration tests |
| Native SQLite/transaction/reopen/replay | `crates/native-bridge` tests |
| Rust↔TS contract serialization | contracts fixtures + native schema contract tests |
| AI task/schema/prompt/candidate policy | `packages/ai-core`, `prompts`, `application` tests |
| React/ViewModel/zh-CN/theme/fallback | `windows-app` Vitest/Testing Library |
| archive interop | existing `pnpm archive:interop` extended at M10 |
| production vertical slice/stress | native E2E + v0.4.1 fixture/evidence runners |
| Windows/macOS deterministic digest | CI quality matrix with identical fixtures |

Preview, UI, logs, serialization tests must assert RNG cursor unchanged where applicable.

## 12. Ownership Checklist

| Semantic question | Single owner |
|---|---|
| command legality / legal targets | Combat Core preconditions |
| RNG consumption | Combat Core RNG + scheduler |
| scheduler order / loop guard | Combat Core scheduler |
| damage / mitigation / lethal | Combat Core resolution/effect |
| status stack/clock | Combat Core status |
| reaction order/resume | Combat Core reaction + same scheduler |
| objective/result | Combat Core objective/commit |
| world primary mitigation | Combat Core WorldCombatProfile |
| programmatic combat numbers | Combat Core balance |
| AI call/retry/repair | existing AI orchestrator |
| durable transaction | existing CampaignStore adapter |
| selected historical facts | existing Event Ledger adapter |
| Chinese wording/layout/theme | frontend presentation/localization |

任何新实现如果在第二位置重新解释表中语义，M0-T05/M12 review 必须拒绝。

## 13. M0-T03 Verdict

M0-T03：**PASS**。

- V5.2 logical modules 已映射到真实 workspace、crate、native adapter、Tauri 和 React 边界；
- Presentation 不被 Core 反向依赖；
- 没有机械创建空目录或重复基础设施；
- 权威 Runtime 只有一套 Rust Core；
- 未发现 SPEC BLOCKER。

下一项依赖满足的任务为 M0-T04 — v0.3 Character Schema Discovery。
