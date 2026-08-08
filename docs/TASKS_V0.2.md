# Ember Tavern v0.2.0 — TASKS（架构优化版）

> 权威执行清单  
> 平台：Windows + macOS  
> 正式发布：Windows  
> macOS：一等开发/测试环境  
> iOS：DEFERRED  
> 版本：0.2.0

## 当前执行状态（2026-08-08）

- `V02-M0-T01`～`V02-M0-T03`：DONE；起始证据、PlatformPaths 与跨平台脚本验证见 `docs/V0_2_BASELINE.md`。
- `V02-COMP-T01`～`V02-COMP-T07`：DONE；三仓库固定 SHA、源码可用性、矩阵、Gap、Borrow/Reject 均已记录在 `docs/research/`。
- `V02-ARCH-T01`～`V02-ARCH-T09`：DESIGN DONE / GATE PASS；实现约束见 `docs/architecture/`。Gate 通过只批准实现，不把 M0/M1/M2 代码任务标为完成。
- `V02-M1-T01`：DONE；完整特殊用途地址矩阵与证据见 `docs/audit/V0_2_SECOND_ROUND_FIXES.md`。
- `V02-M1-T02`：DONE；Windows Credential Manager、macOS Keychain、KEEP/REPLACE/CLEAR、持久清理队列、重启恢复和 health check 已通过回归测试。
- `V02-M1-T03`：DONE；archive/expanded/entry/ratio/JSON/record 全部硬上限及逐条目有界解压已在 TypeScript/Rust 双实现完成。
- `V02-M1-T04`：DONE；字段名/值、纯文本、请求响应错误审计、数据文件和最终ZIP字节均执行高置信秘密扫描，并提供诊断redaction路径。
- `V02-M1-T05`：DONE；Provider探测回执绑定规范化端点、模型、能力来源与能力指纹，端点切换会原子禁用旧模型并清理默认/备用引用。
- `V02-M1-T06`：DONE；跨进程操作锁、桌面单实例锁与SQLite data-version重确认共同关闭备份后删除/覆盖的并发窗口。
- `V02-M1-T07`：DONE；`pnpm archive:interop`从当前双实现生成归档、交叉导入、校验来源清单并对提交夹具执行逐条目regenerate-and-diff，CI已接入。
- `V02-M1-T08`：DONE；CI共享门禁覆盖Windows/macOS，Windows构建NSIS并跑纵向测试，macOS构建app；关键命令和产物均输出结构化UTF-8证据与SHA-256。
- `V02-M2-T01`：DONE；所有应用层AI生成统一经过AITaskOrchestrator，冻结task/request/operation/route身份，显式区分primary/retry/fallback/repair，归一usage与稳定错误分类。
- `V02-M2-T02`：DONE；ContextBlock装配支持stable/semi-stable/dynamic、任务顺序、相关性、块/总预算、SHA-256与不含内容的provenance manifest；所有Provider执行均强制携带并复核装配结果。
- `V02-M2-T03`：DONE；请求开始前冻结endpoint、credential ref、Provider options、model/capability、generation、prompt/cache profile并计算SHA-256，Provider只接收冻结投影，repair漂移fail closed。
- `V02-M2-T04`：DONE；migration 4与通用Candidate服务实现propose/preview/edit-regenerate/supersede/reject/confirm，并以expected revision在同一SQLite事务原子提交领域写入和ACCEPTED状态。
- `V02-M2-T05`：DONE；migration 5最小Event Ledger注册character/quest/turn/dice/scene/knowledge/snapshot/recovery，数据库强制operation幂等、连续revision、版本、来源和数据库时间戳。
- `V02-M3-T01`：DONE；存档首页和共享侧栏均提供无需Campaign的“我的”入口，独立`/my`页面清楚区分设备设置与SQLite游戏事实，并保留现有模型设置深链。
- `V02-M3-T02`：DONE；“我的”页面建立API、默认/备用、生成参数、DeepSeek缓存、上下文、隐私、版本/更新记录七分区，具备响应式分区导航且不伪造未接线状态值。
- `V02-M3-T03`：DONE；模型设置以单一闭集支持DeepSeek、Qwen、OpenRouter、Ollama与OpenAI-Compatible，固定/可配置端点和凭据模式显式化，已保存项显示Profile与实际端点。
- `V02-M3-T04`：DONE；API Binding显式覆盖editing/testing/choosing_model/saving/saved/failed，以revision+operation拒绝配置/Key变化后的迟到结果，并支持测试超时、取消与保存失败重试。
- `V02-M3-T05`：DONE；Credential UI区分新建/替换、清空未保存Key、删除已保存引用、待清理重试与保守健康状态，Key始终不回显且不进入SQLite/日志。
- `V02-M4-T01`：DONE；DeepSeek Flash Profile固定API ID `deepseek-v4-flash`与UI名`DeepSeek-V4-Flash-0731`分离，原生探测、新保存及旧本地显示均使用规范展示名。
- `V02-M4-T02`：DONE；版本化Stable Prompt Profile固定System Contract、Game Rules、Output Schema、Prompt Profile、Stable World Truths五段顺序并拒绝易变请求元数据。
- `V02-M4-T03`：DONE；Prompt与Context hash共享canonical JSON，稳定keys/whitespace/enums/numbers/LF并保留数组语义顺序，拒绝非有限数与Unicode等价重复key。
- `V02-M4-T04`：DONE；Cache Layout固定summary、lore/knowledge为semi-stable，history、scene/state、action为dynamic，五段位于TASK_INPUT前且层级/未知类型fail closed。
- `V02-M4-T05`：DONE；解析DeepSeek hit/miss tokens，本地有界记录task、hit/miss、计算ratio、cacheable prefix hash和时间，严格排除完整Prompt/上下文/请求ID/credential。
- `V02-M4-T06`：DONE；字节回归锁定相同稳定语义得到相同prefix，action只改变dynamic tail，Prompt Profile版本更新必改变prefix hash，并排除随机block/source ID间接扰动。
- `V02-M5-T01`：DONE；根`package.json.version=0.2.0`为产品权威源，Rust crates继承单一workspace版本，Tauri/npm manifests对齐，运行时“我的”从Tauri metadata显示版本。
- 下一执行项严格进入 `V02-M5-T02` Changelog Automation。

研究分类已经映射进本清单：MUST 对应 M0～M10 的现有任务，SHOULD 对应 `V02-M4-T05/T06`、`V02-M8-T08` 等增强验收；完整分支、MultiChat、World Voices、插件市场、AI Companion、iOS 与完整 Event Sourcing 不得插入当前序列。

---

# 一、完成定义

v0.2 只有满足以下条件才能 DONE：

- v0.1 第二轮 P1/P2 全部关闭；
- Windows + macOS 共享开发/test gate 通过；
- Windows 实机 release gate 通过；
- macOS `.app` 可构建、启动并完成核心流程；
- AI UI 不直接调用 Provider；
- 所有 AI task 走 AI Task Orchestrator；
- Context 统一使用 ContextBlock；
- Provider 使用 ConnectionProfile → ResolvedModelConfig → ProviderRequest；
- 关键结构化 AI 生成使用 Candidate Pattern；
- Hard Logic 全部本地；
- 关键流程使用显式状态机；
- Event Ledger 最小版本可用；
- NPC knowledge 不再等同于 world truth；
- “我的/API”、DeepSeek cache、中文化、版本/更新日志、车卡 AI、冒险建议、D20、随机性全部完成；
- `.emtavern` 安全与 TS/Rust 双向门禁通过；
- review_v0.2_to_chatgpt_*.zip 完整；
- final worktree clean。

---

# M0 — Git / 双平台基线

## V02-M0-T01 [P0] 仓库与工作区保护

验收：

- 自动定位 repo；
- 保存 start HEAD；
- 保存 git status / diff / untracked；
- dirty worktree 先备份；
- 禁止 destructive git。

---

## V02-M0-T02 [P0] 跨平台路径治理

建立：

- PlatformPaths port；
- Windows adapter；
- macOS adapter。

验收：

- 无业务层硬编码路径；
- 测试数据目录可隔离；
- Windows/macOS 都可运行。

---

## V02-M0-T03 [P1] 双平台脚本治理

目标：

优先 Node/Rust 跨平台脚本。

验收：

- 核心 build/test/release metadata 脚本非 PowerShell-only；
- Windows/macOS 都可运行共享脚本；
- 平台专属脚本有清晰边界。

---

# M0.5 — Competitor Research

## V02-COMP-T01 [P1] clone 与 baseline

clone：

- RePoG
- TavernAI
- SillyTavern

到：

`.local/research/third_party`

生成：

`docs/research/THIRD_PARTY_BASELINES.md`

记录：

- URL
- branch
- SHA
- license
- date
- source availability

---

## V02-COMP-T02 [P1] RePoG 分析

重点：

- GM causal flow
- player authorship
- NPC knowledge boundary
- hot/cold memory
- distill
- snapshot
- replay protection
- scene frame
- World Voices
- Session 0
- continuity

输出：

`REPOG_ANALYSIS.md`

---

## V02-COMP-T03 [P1] TavernAI 分析

必须先判断：

核心源码是否公开存在。

若无：

记录：

`SOURCE_NOT_PUBLIC_IN_THIS_REPO`

重点：

- Prompt Manager
- branch
- prompt preview
- role / placement
- token counter
- per-character prompt
- MultiChat
- local/remote model UX
- locales

输出：

`TAVERNAI_ANALYSIS.md`

---

## V02-COMP-T04 [P1] SillyTavern 源码分析

重点：

- connection manager
- world info
- persona
- provider
- generation settings
- localization
- extensions

输出：

`SILLYTAVERN_ANALYSIS.md`

---

## V02-COMP-T05 [P1] 横向矩阵

输出：

`COMPETITOR_MATRIX.md`

维度至少：

- Provider
- Prompt
- Context
- Lore
- Memory
- Character
- NPC
- Knowledge
- Branch
- GM
- Dice
- State
- Recovery
- Localization
- Extensibility
- Security
- UX complexity
- cross-platform

---

## V02-COMP-T06 [P1] Ember Gap Analysis

输出：

`EMBER_TAVERN_GAP_ANALYSIS.md`

每项分类：

- MUST_V0_2
- SHOULD_V0_2
- LATER
- REJECT

---

## V02-COMP-T07 [P1] Borrow / Reject

输出：

- `V0_2_BORROW_PLAN.md`
- `V0_2_REJECTED_IDEAS.md`

默认 Reject：

- full plugin marketplace
- full MultiChat
- full World Voices
- AI Companion
- browser server replacement
- replacing SQLite with Markdown/YAML

---

# M0.6 — Architecture Gate

## V02-ARCH-T01 [P0] 目标架构文档

创建：

- V0_2_TARGET_ARCHITECTURE.md
- AI_PIPELINE.md
- CONTEXT_MEMORY_MODEL.md
- STATE_AND_EVENTS.md

---

## V02-ARCH-T02 [P0] AI Task Orchestrator 设计

必须定义：

```text
UI
→ Application
→ AI Task Orchestrator
→ Context
→ Router
→ Provider
→ Schema
→ Domain
→ Candidate/Narrative
```

禁止 UI 直连 Provider。

---

## V02-ARCH-T03 [P0] ContextBlock Schema

字段至少：

- id
- type
- content
- source_id
- source_revision
- stability
- priority
- token_budget
- privacy_class
- version
- content_hash

---

## V02-ARCH-T04 [P1] Event Ledger 最小模型

定义：

- event type
- operation id
- aggregate id
- revision
- payload
- source

不做完整 Event Sourcing。

---

## V02-ARCH-T05 [P1] Knowledge 模型

正式定义：

- WorldTruth
- Claim
- Knowledge
- Memory

---

## V02-ARCH-T06 [P1] SceneFrame

字段：

- scene id
- location
- participants
- pressure
- affordances
- pending consequence
- return point
- revision

---

## V02-ARCH-T07 [P0] Provider 三层

固定：

- ConnectionProfile
- ResolvedModelConfig
- ProviderRequest

---

## V02-ARCH-T08 [P0] Ports & Adapters

ports：

- SecureVault
- PlatformPaths
- FileDialog
- AppInstanceLock
- AppLifecycle
- ReleaseMetadata

---

## V02-ARCH-T09 [P0] Architecture Gate Review

必须逐项证明：

- UI 无 Provider 直连；
- Domain 不依赖平台；
- AI 不直接写状态；
- Context 统一；
- Hard Logic 本地；
- Provider config frozen；
- knowledge 与 truth 分离；
- 新架构不过度扩大 scope。

通过后才进入 M1。

---

# M1 — v0.1 第二轮修复

## V02-M1-T01 [P0] SSRF IPv4/IPv6

覆盖：

- special-use
- mapped
- NAT64
- 6to4
- Teredo
- mixed DNS
- rebinding
- redirects

---

## V02-M1-T02 [P0] SecureVault

Windows：

Credential Manager

macOS：

Keychain

必须：

- add
- replace
- clear
- remove
- cleanup queue
- restart recovery
- health check

---

## V02-M1-T03 [P0] `.emtavern` resource limits

覆盖：

- archive size
- expanded size
- entry size
- compression ratio
- JSON depth
- array length
- string length
- record count

---

## V02-M1-T04 [P0] Secret scanning

扫描：

- field names
- field values
- plain text
- request/response debug data
- export bytes

---

## V02-M1-T05 [P0] Provider consistency

增加：

- fingerprint
- capability source
- endpoint normalization
- old model cleanup
- default/fallback atomic cleanup

---

## V02-M1-T06 [P0] Destructive transaction lock

覆盖：

- permanent delete
- overwrite import
- backup
- app lock
- multi-store concurrency

---

## V02-M1-T07 [P0] TS/Rust bidirectional archive

当前 exporter：

- TS → Rust
- Rust → TS

加入 CI。

---

## V02-M1-T08 [P1] CI / evidence

Windows + macOS。

结构化 UTF-8 logs。

---

# M2 — Core AI Architecture

## V02-M2-T01 [P0] AI Task Orchestrator

统一：

- task type
- request id
- operation id
- route
- retry
- fallback
- repair
- usage
- error taxonomy

---

## V02-M2-T02 [P0] Context Assembly Pipeline

ContextBlock only。

必须：

- stable
- semi-stable
- dynamic
- deterministic order
- relevance
- budget
- provenance

---

## V02-M2-T03 [P1] ResolvedModelConfig

请求开始前冻结：

- endpoint
- model
- credential ref
- generation params
- capability
- prompt profile
- fingerprint

---

## V02-M2-T04 [P1] AI Candidate Infrastructure

统一：

Generate
→ Validate
→ Preview
→ Edit/Regenerate
→ Confirm
→ Commit

---

## V02-M2-T05 [P1] Event Ledger

实现最小事件账本。

先覆盖：

- character
- quest
- turn
- dice
- scene
- knowledge
- snapshot
- recovery

---

# M3 — 我的 / API

## V02-M3-T01 [P1] 我的入口

首页新增：

“我的”。

---

## V02-M3-T02 [P1] 我的页面信息架构

包含：

- API
- default/fallback
- generation
- DeepSeek cache
- context
- privacy
- version/changelog

---

## V02-M3-T03 [P1] Connection Profiles

支持：

- DeepSeek
- Qwen
- OpenRouter
- Ollama
- OpenAI-Compatible

---

## V02-M3-T04 [P1] API Binding State Machine

状态至少：

- editing
- testing
- choosing_model
- saving
- saved
- failed

测试：

- timeout
- cancel
- config changed
- key replaced
- save failed

---

## V02-M3-T05 [P1] Credential UI

- replace
- clear
- remove
- cleanup pending
- health

---

# M4 — DeepSeek Cache

## V02-M4-T01 [P1] DeepSeek Profile

API ID：

`deepseek-v4-flash`

UI：

`DeepSeek-V4-Flash-0731`

---

## V02-M4-T02 [P1] Stable Prompt Profile

固定：

- system
- rules
- schema
- profile
- world truths

---

## V02-M4-T03 [P1] Deterministic Serialization

稳定：

- keys
- arrays
- whitespace
- enums
- numbers
- newlines

---

## V02-M4-T04 [P1] Context Cache Layout

Semi-stable：

- summary
- lore
- knowledge

Dynamic：

- recent history
- scene
- state
- action

---

## V02-M4-T05 [P1] Cache Metrics

记录：

- hit tokens
- miss tokens
- ratio
- prefix hash
- task type

不记录完整 Prompt。

---

## V02-M4-T06 [P1] Cache Regression

验证：

- same stable input => identical prefix bytes
- current action changes tail only
- profile update changes version/hash

---

# M5 — Version / Changelog / zh-CN

## V02-M5-T01 [P1] Single Version Source

版本：

0.2.0

---

## V02-M5-T02 [P1] Changelog Automation

建立：

- CHANGELOG
- release-info
- sync/check scripts

---

## V02-M5-T03 [P1] zh-CN Resource Layer

全部玩家文案集中。

---

## V02-M5-T04 [P1] Core UI Localization

覆盖所有游戏流程。

---

## V02-M5-T05 [P1] English Regression Gate

仅允许：

- provider
- model id
- API fields
- URL
- names

---

# M6 — Character Card

## V02-M6-T01 [P1] Scroll / Layout

验收：

- 860×600
- 1180×760
- 1366×768
- 1920×1080
- 125% / 150%

---

## V02-M6-T02 [P1] Character Structure

分区：

- summary
- basics
- attributes
- background
- personality
- traits
- equipment
- AI controls

---

## V02-M6-T03 [P1] AI Character State Machine

状态：

idle
→ generating
→ validating
→ preview
→ editing
→ confirming
→ committed

---

## V02-M6-T04 [P1] AI Character Candidate

结构化生成。

未确认不落库。

---

# M7 — Adventure / Scene / D20

## V02-M7-T01 [P1] SceneFrame

Adventure 使用 SceneFrame。

---

## V02-M7-T02 [P1] Action Modes

- 行动
- 对话
- 观察

---

## V02-M7-T03 [P1] Action Suggestions

3~5 个。

必须基于：

- scene
- quest
- character
- known facts
- NPC knowledge

---

## V02-M7-T04 [P1] Free Input

永远可用。

---

## V02-M7-T05 [P1] Adventure Turn State Machine

至少：

draft
→ submitted
→ generating
→ validating
→ resolving
→ committed
→ narrating

错误和恢复路径明确。

---

## V02-M7-T06 [P1] D20 Hard Logic

先确定：

- raw
- modifier
- total
- DC
- result

再动画。

---

## V02-M7-T07 [P1] D20 Animation

支持：

- skip
- reduce motion
- interruption
- refresh
- repeat click

不得重骰。

---

# M8 — NPC / Memory / Randomness

## V02-M8-T01 [P1] WorldTruth / Claim / Knowledge / Memory

实现最小可用模型。

---

## V02-M8-T02 [P1] NPC Knowledge Boundary

NPC Prompt 只接收允许知道的信息。

---

## V02-M8-T03 [P1] Knowledge Provenance

记录：

- source
- event
- learned_at
- confidence

---

## V02-M8-T04 [P2] Rumor / Claim

酒馆传闻轻量来源化。

不做完整 World Voices。

---

## V02-M8-T05 [P1] Randomness Profiles

- 稳健
- 平衡
- 高随机
- 自定义

---

## V02-M8-T06 [P1] Repetition Reduction

检测：

- repeated phrase
- repeated quest structure
- repeated NPC archetype

---

## V02-M8-T07 [P1] Context Budget

禁止全量世界 history 进入 Prompt。

---

## V02-M8-T08 [P2] Context Inspector

显示：

- block
- token
- source
- revision
- stability
- included/omitted
- hash
- cache

---

# M9 — 双平台验收

## V02-M9-T01 [P0] Shared Gate

必须：

- formatting
- lint
- TS
- Vitest
- Rust
- SQLite
- Provider
- archive
- context
- orchestrator
- security

---

## V02-M9-T02 [P0] Windows Gate

- Credential Manager
- WebView2
- NSIS
- install
- launch
- uninstall

---

## V02-M9-T03 [P0] macOS Gate

- Keychain
- WKWebView
- .app
- launch
- PlatformPaths

---

## V02-M9-T04 [P0] UI 4-resolution Gate

全部核心页面截图。

---

## V02-M9-T05 [P0] Vertical Flow

首次启动
→ 我的/API
→ 世界
→ 车卡
→ 酒馆
→ NPC
→ Quest
→ Adventure
→ D20
→ Settlement
→ Crash/Recovery
→ Export
→ Delete
→ Import
→ Continue

---

# M10 — Release

## V02-M10-T01 [P0] Windows v0.2 Build

输出：

`release/v0.2/`

---

## V02-M10-T02 [P0] Artifact Hash / Manifest

- SHA256SUMS
- ARTIFACT_MANIFEST
- BUILD_INFO
- RELEASE_NOTES
- KNOWN_LIMITATIONS

---

## V02-M10-T03 [P0] macOS Dev Build Record

记录：

- app path
- hash
- environment
- test result

不作为正式发布。

---

## V02-M10-T04 [P0] Review Package

生成：

`review_v0.2_to_chatgpt_YYYYMMDD_HHMM.zip`

必须包含：

- competitor research
- architecture docs
- final tasks
- audit fixes
- tests
- screenshots
- git data
- source archive
- installer
- hashes
- risks

---

# 默认延期

LATER / DEFERRED：

- iOS
- plugin marketplace
- full MultiChat
- full World Voices
- AI Companion
- online multiplayer
- full VTT map engine
- official macOS release
- store distribution

---

# 提交要求

推荐：

- `docs(v0.2): integrate competitor research into roadmap`
- `arch(v0.2): define AI orchestration boundaries`
- `fix(v0.2): close SSRF and credential gaps`
- `feat(v0.2): introduce context blocks`
- `feat(v0.2): add event ledger`
- `feat(v0.2): add API connection profiles`
- `perf(v0.2): stabilize DeepSeek cache prefix`
- `i18n(v0.2): localize player-facing UI`
- `feat(v0.2): add AI-assisted character creation`
- `feat(v0.2): add scene actions and dice animation`
- `feat(v0.2): enforce NPC knowledge boundaries`
- `release(v0.2): build Windows candidate`

每个任务提交前：

```bash
git diff --check
git status --short
git diff --stat
git diff
git diff --cached
```

不得混入：

- third_party repo
- node_modules
- target cache
- real user data
- real key
- build caches
