# Ember Tavern v0.4.1 Repository Mapping

状态：M0-T02 PASS

审计日期：2026-09-01

基线：`210e699d0aba355b5f00fd4bf6ed777e6977356d`（`v0.3.0`）

## 1. 目的与边界

本文记录 v0.3 真实仓库中可供 v0.4.1 Combat 复用的模块、生产数据路径和已确认缺口。它是只读 baseline audit，不决定 M0-T03 的最终 Combat 目录映射，不修改 V5.2 规则，也不顺手重构现有模块。

审计覆盖 workspace、Rust/Tauri、React/TypeScript、SQLite/migration、Domain Transaction、Event Ledger、AI Orchestrator、Candidate、Provider、Character Domain、Save/Import、Tests 与 CI。

## 2. Repository / Toolchain Baseline

| Item | Current state |
|---|---|
| Repository | `/Users/mac/Desktop/item/4D` |
| Baseline branch / tag | `main` / `v0.3.0` |
| Baseline HEAD | `210e699d0aba355b5f00fd4bf6ed777e6977356d` |
| v0.4.1 task branch | `task/M0-T02-repository-baseline` |
| Node / package manager | Node `v26.7.0`; pnpm `11.9.0`（项目锁定 `pnpm@11.9.0`） |
| Rust | rustc/cargo `1.97.1`; Cargo workspace resolver 2, edition 2024 crates |
| Desktop | React 19 + Vite 7 + Tauri 2；Windows vertical slice 优先，macOS 共用质量/构建门 |
| Database | SQLite via `rusqlite` bundled；migration 1–32；`LATEST_SCHEMA_VERSION=32` |
| Working tree exception | 用户已有 `.gitignore` 的 `.gstack/` 变更；不属于 v0.4.1 task commits |

修改前完整 `pnpm check` PASS：Vitest 189 files / 1091 tests，另 2 files / 6 tests 合同 skip；Node 33/33；Rust workspace 全绿，1 个真实 DeepSeek Credential 测试 ignored。Windows CI/发布生命周期在当前 macOS 主机 `NOT_RUN`。

## 3. Workspace 与依赖方向

### 3.1 TypeScript workspace

| Package | Existing responsibility | Combat reuse boundary |
|---|---|---|
| `@ember-tavern/contracts` | 版本化 DTO、stable IDs、Character/World/Rules/Event/Candidate contracts | 新增 Combat 的跨层数据合同；不得放执行逻辑 |
| `@ember-tavern/domain` | 纯本地规则、D20、validator、deterministic policies | Combat Core/validation 的自然归属；保持无 Tauri/SQLite/HTTP 依赖 |
| `@ember-tavern/application` | use cases、AI task orchestration、candidate confirm、domain transaction coordination | Combat application commands、AI content task 与 durable commit 协调 |
| `@ember-tavern/ai-core` | Provider-neutral protocol、task schemas、context、queue、generator lifecycle、router、repair/validation | 扩展 Combat content task；禁止第二套 orchestrator/provider/repair |
| `@ember-tavern/prompts` | 稳定 prompt profile、task prompts、cache layout | 仅 Combat content/flavor prompt；不承载 Runtime rules |
| `@ember-tavern/persistence` | TS repositories、transaction ports、migration/startup、portable save/import | Combat persistence contract/interop 与 repository tests；生产写入仍需 Rust bridge |
| `@ember-tavern/test-fixtures` | Fake playtest、性能与跨世界 fixture | Combat deterministic/stress/four-world harness 可复用 |
| `@ember-tavern/ui-kit` | 当前为空壳 package；共享 UI 实际位于 desktop app 的 `src/ui` | 不为 Combat 另造第二套设计系统 |
| `windows-app` | React pages/services/localization、Tauri command gateways | CombatScreen、ViewModel、commands、zh-CN 与 Theme 的生产 UI |
| `ios-app` | 非当前生产范围 | v0.4.1 不全面开发 iOS |

TypeScript 依赖方向为 `contracts <- domain <- ai-core/prompts <- application -> persistence`，desktop UI 依赖 contracts/domain/ai-core/prompts。`windows-app` 当前没有依赖 `@ember-tavern/persistence`。

### 3.2 Rust workspace

| Crate | Existing responsibility | Combat reuse boundary |
|---|---|---|
| `ember-native-bridge` | `CampaignStore`、migration、production SQLite、domain-specific atomic commits、save archive、E2E | Combat durable production adapter 与 Tauri-facing service 的既有宿主 |
| `ember-platform-services` | 平台路径、文件锁、跨实例协调 | DB lifecycle/backup/lock 复用 |
| `ember-provider-openai-compatible` | OpenAI-compatible provider、presets、normalized request/response、credential ref | Combat AI content 走同一 Provider；Combat turn runtime 不调用它 |
| `ember-secure-http` | SSRF/endpoint policy、TLS、timeout/cancel、bounded streaming | 不新增 Combat 网络路径 |
| `ember-secure-secrets` | Windows Credential Manager / macOS Keychain opaque refs | 不新增 Combat credential system |
| `ember-tavern-windows` | Tauri command registration、native error→中文安全消息、UI bridge | 增加 Combat command/query boundary，保持 WebView 无直接 DB/HTTP 权限 |

## 4. 真实生产数据路径

当前桌面生产路径是：

```text
React page/service
  -> typed Tauri gateway (`invoke`)
  -> `windows-app/src-tauri/src/lib.rs` command
  -> `ember_native_bridge::CampaignStore`
  -> short `TransactionBehavior::Immediate` transaction
  -> SQLite aggregate/projection + audit rows
  -> typed receipt
  -> frontend parser/validator
  -> React projection
```

AI 生成路径是：

```text
React service
  -> DesktopAIOrchestrator / GeneratorRunner
  -> unified context + frozen model config + task schema
  -> Tauri `ai_generate` / `ai_generate_stream`
  -> existing native Provider + OS credential ref
  -> parse/schema/domain validation
  -> domain-specific Tauri commit command
  -> CampaignStore immediate transaction
```

`DesktopStructuredGenerator` 使用 `NOOP_GENERATOR_TRANSACTION`，因为生成阶段不能写正式事实；正式提交发生在后续 domain-specific native command。Combat AI Content 必须沿用这个分离，不得把 Provider response 直接写 Combat State。

## 5. SQLite、Migration 与事务

- `database/migrations/0001_initial.sql` 到 `0032_save_schema.sql` 是唯一 migration 序列；Rust `CampaignStore` 以 `include_str!` 嵌入全部 migration，最新 schema 为 32。
- 当前 migration 共定义 82 张表。`save_schema_version=3`、`world_schema_version=1`；portable schema 3 列出 69 张 Campaign-scoped 表。
- `CampaignStore::open` 负责备份、隔离 migration、integrity/foreign-key validation 与原子替换；不能另建 Combat database/startup path。
- production mutations 普遍使用短 `TransactionBehavior::Immediate`；跨备份/导入/删除还复用 `AppInstanceLock` 和 data-version concurrency check。
- TypeScript 侧已有 `TransactionalSqliteDatabase`、`TurnTransaction`、`RulesEngineRepository`、`AICandidateUseCases` 等原子边界与 rollback tests；它们是合同/互操作能力，不替代 production Rust commit。
- v0.4.1 M2/M4 只应定义可序列化 Runtime Snapshot；Combat durable tables/migration 和 Active Save 接入按 TASKS 留到 M10。
- Pending Ask Reaction 等待用户时不得保持 SQLite transaction；只在 checkpoint 写入和恢复时使用短事务。

## 6. Event / Audit 边界

仓库已有三种不同用途的数据：

| Existing store | Purpose | Combat rule |
|---|---|---|
| Aggregate/projection tables | 当前可查询游戏事实；启动直接读取 | Combat canonical state/save 仍以 SQLite projection 为真源 |
| `game_events` | 既有业务事件投影 | 不直接塞入所有高频 Combat runtime events |
| `event_ledger` | 最小审计/幂等/连续性层，不是完整 Event Sourcing | M10 只写 selected committed Combat facts；不建第二 ledger |
| `rules_events` | Character Rules command 的 before/after append-only audit | 可复用其 revision/idempotency 思路，但不能把旧 Rules Engine 当完整 Combat Engine |

`EventLedgerRepository` 已提供版本化 payload、stable aggregate revision、secret scan 和确定性 `ORDER BY`；migration 5 通过唯一键和 trigger 保证 operation tuple 与 revision 连续。现有 ledger event/aggregate type 是封闭 union，尚无 Combat 类型，扩展只能在 M10 按 selected facts 进行。

## 7. AI Orchestrator、Candidate 与 Provider

可直接复用：

- `AITaskOrchestrator`：单一 Provider execution envelope、route/config/context fingerprint 与稳定错误分类；
- `GeneratorRunner`：`BUILD_CONTEXT -> BUILD_PROMPT -> GENERATE -> PARSE -> VALIDATE -> REPAIR -> RULES_CHECK -> PERSIST -> EMIT_EVENTS`；
- `AI_TASKS`、`AI_TASK_SCHEMAS`、`validateAIOutput`、`buildUnifiedTaskContext`、Generation Queue；
- `AICandidateRepository` / `AICandidateUseCases`：PROPOSED/ACCEPTED/REJECTED/SUPERSEDED、expected revision、同事务 confirm；
- existing model settings、fallback policy、OS credential、secure HTTP、streaming、cache metrics 与 Inspector privacy boundary；
- `generation_records` provenance 和 current domain-specific native generation audits。

Combat gap：当前没有 Combat content task types、Concept/Mechanical Intent schemas、Power Budget、primitive mapping、Combat candidate payload、approved-definition persistence 或 programmatic tooltip projection。M6 必须扩展现有路径，不能新建 Provider/queue/repair/candidate store。

## 8. Character Domain

当前唯一基础属性集合是：

```text
physique / agility / knowledge / charisma
```

它们是 1–5 的整数且总和固定为 10；`player_characters.attributes_json` 和 `character_rule_states.base_attributes_json` 均由 SQLite trigger 保证不可变。

`CharacterRuleState` 已提供：

- `hitPoints.current/max`；
- skills；
- status projection；
- equipped item IDs；
- money/game time；
- trait modifiers；
- open stable-key resources；
- revision/idempotent Rules command audit。

`UniversalCharacterProfile` 已提供 career、attributes、derivedAttributes、skills、abilities、traits、statuses、equipment IDs、world extension values 与 revision；Repository 要求其数值投影与 Rules state 一致。

Combat gap：没有 Initiative/Attack/Defense/Save/Mental 等 derived combat stats，也没有 NPC/敌方统一 Combatant adapter。M0-T04 必须基于上述真实字段建立 `CombatAttributeResolver` Mapping Matrix；禁止新建 Strength/Agility/Focus 等平行基础属性表。

## 9. World、Randomness 与装备

- `WorldConstitution.worldType` 当前是开放字符串，不是 v0.4.1 的封闭 `WorldType`；它同时保存 combatScale/deathRules/equipmentRules 等自然语言 constitution facts。
- `WorldSeed` 使用 `EMBER_STREAM_V1`，`world_random_streams` 保存独立 stream cursor。现有 Adventure D20 是本地硬逻辑。
- Combat 需要自己的版本化 `initiative/resolution/utilityTieBreak` channels 与 battle seed contract；不得直接复用 UI randomness 或让 world stream 的额外消费改变 Combat future。
- Semantic Equipment 已将叙事与 programmatic `damage/defense/numericEffect/balance` 分开并验证 AI 不能决定数值；Combat Equipment Ability 可以复用这一权威分层和既有 item identity/ownership，不能建平行 inventory。

World gap：需要一个本地、版本化、可验证的 `WorldType -> WorldCombatProfile` 解析边界，处理当前开放 worldType 文本与四个冻结 Combat profiles 的关系；不得在 Core/UI/AI 各写一份 world switch。

## 10. Save / Import / Recovery

- production `crates/native-bridge/src/save_archive.rs` 与 TS `save-export.ts` / `save-import.ts` 共享 `.emtavern` format 1、portable schema 3 和 cross-language fixtures。
- archive 有 canonical JSON、SHA-256、CRC/resource limits、secret scan、foreign-key/domain reload、overwrite backup 与 atomic restore。
- internal snapshots、Campaign recovery、pending AI request cancellation 和 DB full backups 已存在；save/import 不包含 device credential/config。
- CI 的 `archive:interop` 同时验证 TS→Rust 与 Rust→TS。

Combat gap：portable table list、Rust archive table metadata、resource limits、restore order、domain reload 和 cross-language fixtures 尚无 BattleRecord/ActiveCombatSave。M10 必须同步扩展两端并验证旧 v0.3 archive；不得只修改 migration 或只修改一个语言实现。

## 11. React / Tauri / UI

- `windows-app/src/routes.tsx` 是 HashRouter 页面入口；production UI 已有共享 `src/ui/primitives.tsx`、`game-components.tsx` 和三层 design tokens/CSS。
- `windows-app/src/localization/zh-CN.ts` 与 `scripts/check-player-language.mjs` 提供玩家中文门禁。
- 每个 domain 使用 `*-service.ts` 封装 Tauri invoke、解析 native receipt 并提供页面状态；UI 不直接访问 SQLite。
- Tauri 目前注册 campaign/world/character/tavern/NPC/quest/adventure/rules/save/provider 等命令，没有 Combat command/query。
- Tauri capability 保持最小 core/dialog 权限，WebView 没有任意 SQL/HTTP/secret 权限。

Combat gap：没有 Combat route、screen、service/gateway、ViewModel、legal target API、reaction resume、theme resolver、asset manifest loader 或 zh-CN Combat strings。M8/M9 必须复用共享 primitives/tokens 与现有 service pattern。

## 12. Tests / CI / Evidence

现有测试层：

- Vitest：contracts/domain/application/ai-core/persistence/windows React/service；
- Node test：migration、backup、release metadata、CI/policy/language scripts；
- Rust unit/integration：native production SQLite、Provider/security/platform/Tauri；
- Windows production vertical slice 与三世界/自由输入 playtest harness；
- TypeScript/Rust archive interoperability；
- performance baseline/regression 与 evidence hashing。

`.github/workflows/ci.yml`：

- `quality` 在 `windows-latest` 与 `macos-latest` 执行 frozen install、format、release metadata、zh-CN、lint、typecheck、TS/Node tests、rustfmt/clippy/Rust tests、archive interop；
- `windows-release` 构建 NSIS，并验证 Credential Manager、WebView2、install/launch/uninstall；
- `macos-build` 构建 `.app`，并验证 Keychain、WKWebView、launch、PlatformPaths；
- Actions 使用固定 commit SHA，checkout 不保留 credential。

Combat 必须在同一矩阵增加 deterministic fixtures/digests、Gate A–G、assets、stress 与 four-world evidence。macOS 本地结果不能替代 Windows CI 证据。

## 13. Confirmed Schema / API Gaps

以下均为 M0-T02 发现，不在本任务实现：

1. 无 Combat contracts、aggregate、commands、versions、fixed-point numeric 或 deterministic hash API；
2. 无 battle seed/RNG channels/cursors/checkpoint；
3. 无 canonical scheduler、loop guard、ResolutionContext、cost reservation/usage commit；
4. 无 Ability/Effect/Tag/Status/Reaction/Objective/Result runtime；
5. 无 WorldCombatProfile 与当前开放 `worldType: string` 的版本化解析；
6. 无 CombatAttributeResolver 和 NPC/敌人 Combatant mapping；
7. 无 Combat AI content task、budget/validator/candidate persistence/tooltip projection；
8. 无 Utility AI/Tactical Strategy/Enemy Intent accepted-command path；
9. 无 Combat UI/ViewModel/legal-target gateway/theme/assets；
10. 无 BattleRecord/ActiveCombatSave/migration/archive/replay/exactly-once Combat result commit；
11. 无 Combat CI gates、cross-platform digest、long stress 或四世界 Combat playtest。

这些缺口与 `V0.4.1_TASKS_FINAL.md` 的 M1–M11 一致，未发现必须新建第二套基础设施的理由。

## 14. Reuse / Do-Not-Duplicate Register

| Need | Must reuse | Forbidden duplicate |
|---|---|---|
| Game truth | SQLite + CampaignStore | Combat-only database |
| Atomic state change | existing short domain transaction pattern | long-lived Reaction transaction |
| Audit | existing Event Ledger selected facts | second Combat ledger |
| Character | Player/Universal Character + Rules state | parallel attributes/inventory |
| AI execution | AITaskOrchestrator + DesktopAIOrchestrator | second AI pipeline |
| Model access | existing Provider/router/settings | Combat provider adapter |
| Credentials | secure-secrets opaque ref | API key config/log/save |
| Generated content | Generator/Candidate/validation/confirm | direct AI state mutation |
| Save | migration 33+ through existing startup/archive | standalone Combat save file |
| UI | existing React/Tauri service + primitives/tokens | four CombatScreen implementations |
| Localization | existing zh-CN resources/language gate | raw enum/error rendering |
| Test evidence | Vitest/Node/Rust/CI/evidence scripts | unverified prose-only PASS |

## 15. M0-T02 Verdict

M0-T02：**PASS**。

- 仓库真实生产路径、复用模块和禁止重复项已定位；
- 关键 Schema/API gaps 已记录，没有顺手重构；
- 未发现立即 SPEC BLOCKER；
- 下一任务严格为 M0-T03 — Combat Module Mapping。
