# Ember Tavern v0.2.0 — TASKS（架构优化版）

> 权威执行清单  
> 平台：Windows + macOS  
> 正式发布：Windows  
> macOS：一等开发/测试环境  
> iOS：DEFERRED  
> 版本：0.2.0

## 当前执行状态（2026-08-11）

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
- `V02-M5-T02`：DONE；根版本自动同步到npm/Tauri/Cargo/Changelog/release-info，生成玩家可读发布摘要，只读漂移检查已接入双平台CI。
- `V02-M5-T03`：DONE；建立单一`zh-CN`类型安全资源入口，应用根语言、导航壳层、全局状态和原生存档对话框已接入且无静默英文fallback。
- `V02-M5-T04`：DONE；存档、世界、车卡、酒馆、NPC、任务、冒险/D20、档案、恢复、模型/API/隐私与更新记录完成中文覆盖，机器状态不再直接展示。
- `V02-M5-T05`：DONE；AST门禁检查渲染文案、玩家属性、状态/确认消息、zh-CN资源及更新日志，仅放行文档定义的技术专名并已接入双平台CI。
- `V02-M6-T01`：DONE；车卡拥有独立100dvh纵向滚动、无横向溢出、900px单/双栏断点、低高度压缩和安全区sticky主操作，12组尺寸/缩放合同与交互测试通过。
- `V02-M6-T02`：DONE；已确认角色卡固定呈现summary、basics、attributes、background、personality、traits、equipment、AI controls八区，复用现有持久字段且无schema迁移。
- `V02-M6-T03`：DONE；纯状态机与UI显式覆盖idle/generating/validating/preview/editing/confirming/committed，以revision+operation拒绝编辑后的迟到结果并显示中文状态。
- `V02-M6-T04`：DONE；特质与完整角色均以可恢复Candidate暂存，未确认不写角色/装备/生成事实或推进Campaign，确认在单一SQLite事务原子提交并支持幂等重放。
- `V02-M7-T01`：DONE；Adventure使用独立SQLite SceneFrame投影，完整回合与场景ledger原子更新，恢复点锚定可移植game event，`.emtavern` schema 2携带投影并兼容读取schema 1。
- `V02-M7-T02`：DONE；冒险输入显式支持ACTION/DIALOGUE/OBSERVE，意图贯通UI、原生命令、SQLite恢复视图和AI上下文，旧回合按ACTION兼容。
- `V02-M7-T03`：DONE；活动场景严格生成3至5条不重复建议，结局不生成建议；输入显式携带scene、quest、character、known facts及按NPC隔离的knowledge。
- `V02-M7-T04`：DONE；每个可行动场景都保留独立可编辑的自由输入，建议仅用于填充而非门禁，提交失败保留原文供编辑或重试。
- `V02-M7-T05`：DONE；显式回合状态机覆盖draft→submitted→generating→validating→resolving→committed→narrating，按阶段分类失败，以operation/revision拒绝迟到事件并从SQLite待处理回合恢复。
- `V02-M7-T06`：DONE；程序在叙事/动画前固定raw、modifier、total、DC、result，使用无偏D20取样和安全整数运算，持久化/UI/档案读取均拒绝矛盾结果。
- `V02-M7-T07`：DONE；D20动画只消费SQLite中已锁定的硬结果，支持跳过、减少动态效果、中断/刷新恢复及重复点击合并，任何展示路径都不会重骰。
- `V02-M8-T01`：DONE；共享领域合同以独立判别模型区分WorldTruth、Claim、actor-scoped Knowledge与Memory，并验证truth/event→claim/knowledge→memory的单向来源边界。
- `V02-M8-T02`：DONE；NPC_REPLY只接收当前Actor获准的Truth/Claim知识投影、同Actor消息/记忆与自身角色卡，缺失、重复、跨Actor错误认知或客户端篡改均fail closed。
- `V02-M8-T03`：DONE；schema 7在既有NPC Knowledge权威行记录source、event、learned_at与confidence，旧数据库/存档确定性回填，双实现读取均验证Actor、状态与事件边界。
- `V02-M8-T04`：DONE；酒馆传闻作为带独立claimId、NPC来源、传播方式、confidence和revision的轻量Claim兼容投影持久化，玩家只见来源而不见隐藏真实性。
- `V02-M8-T05`：DONE；设备级生成偏好提供稳健、平衡、高随机与0至2自定义温度，七条Windows AI生成路径在请求前读取并冻结实际值，本地D20不受影响。
- `V02-M8-T06`：DONE；生成结果在写入前检测规范化重复长句、最近任务结构签名和NPC身份/性格原型签名，命中即拒绝且不产生部分写入。
- `V02-M8-T07`：DONE；所有Windows Provider调用前执行任务级字符预算，历史型Schema固定数量上限，长历史只保留最新窗口与带总数的有损抽样摘要。
- `V02-M8-T08`：DONE；“我的/上下文”显示最近实际请求的block、token、来源、revision、stability、纳入/省略、hash前缀与会话缓存状态，且不显示内容或secret来源。
- `V02-M9-T01`：DONE；本地共享门禁统一覆盖发布元数据、玩家语言、Prettier、ESLint、TypeScript、Vitest/Node、rustfmt、Clippy、Rust workspace与跨语言存档互操作，并保留结构化UTF-8证据。
- `V02-M9-T02`：DONE；Windows x64托管实机完成Credential Manager、WebView2、v0.2.0 NSIS、当前用户静默安装、启动存活、静默卸载与应用数据保留验收，结构化artifact与安装器SHA-256已归档。
- `V02-M9-T03`：DONE；macOS arm64托管实机完成Keychain、系统WebKit/WKWebView、v0.2.0 `.app`、19秒启动存活与PlatformPaths实际数据库落点验收，并安全清理临时应用路径。
- `V02-M9-T04`：DONE；12个核心页面在860x600、1180x760、1366x768、1920x1080完成48组最终截图、控制台/溢出/裁切检查和逐张视觉复核，4项缺陷全部修复并保留前后证据。
- `V02-M9-T05`：DONE；单一SQLite存档完成首次启动至导出/删除/导入/继续的完整纵向链，覆盖中断请求恢复，并以隔离原生`.app`、18张截图和SHA-256清单关闭SR2-010；实机发现的WKWebView删除确认缺陷已修复并回归锁定。
- `V02-M10-T01`：DONE；权威Windows x64 runner基于HEAD `20ae2f5`生成0.2.0当前用户NSIS，纵向E2E、Credential Manager、WebView2、静默安装/启动/卸载和数据保留全绿，安装器已落盘`release/v0.2/`并三方复核大小与SHA-256。
- `V02-M10-T02`：DONE；`release/v0.2/`已生成五个精确基名的SHA256SUMS、ARTIFACT_MANIFEST、BUILD_INFO、RELEASE_NOTES和KNOWN_LIMITATIONS，绑定源HEAD/CI/未签名边界并通过哈希、JSON及秘密样式扫描。
- `V02-M10-T03`：DONE；macOS arm64开发`.app`已记录runner/本地证据路径、三项bundle文件哈希、构建环境与Keychain/WKWebView/PlatformPaths/17秒启动结果，并明确仅有ad-hoc签名、非正式发布。
- 下一执行项严格进入 `V02-M10-T04` Review Package。

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

状态：DONE。

检测：

- repeated phrase
- repeated quest structure
- repeated NPC archetype

当前实现使用可审计的确定性签名：长句按标点分段、大小写和标点规范化且至少含12个字母或数字；任务结构由风险、奖励档、预期回合区间和排序后的推荐属性组成；NPC原型由identity与personality组成。三类结果均在TypeScript与原生SQLite提交边界复核，命中后fail closed且不写入候选游戏状态。

---

## V02-M8-T07 [P1] Context Budget

状态：DONE。

禁止全量世界 history 进入 Prompt。

当前实现对15类AI任务配置12,000至22,000字符预算；七条Windows生成Service在Prompt格式化前统一失败关闭。NPC消息最多12条、长期记忆为8条最新项加1条有损旧史摘要、冒险回合最多8条、世界事件最多10条、结算回合为8条最新项加1条摘要。超过四项的旧史摘要只抽样最早两项和最晚两项并记录被压缩总数，不逐条携带完整历史。

---

## V02-M8-T08 [P2] Context Inspector

状态：DONE。

显示：

- block
- token
- source
- revision
- stability
- included/omitted
- hash
- cache

当前Windows实现记录本次应用会话最近一次真实AI任务的ContextManifest投影，并在“我的/上下文”以只读表格展示。Manifest补齐stability字段且Provider前复核；secret来源统一显示为“已遮罩”，hash只显示12位前缀，任何ContextBlock内容、完整系统Prompt、未公开世界真相与凭据都不进入Inspector快照。cache表示同一会话是否已观察到相同type/source/revision/version/hash组合，不冒充Provider账单缓存数据。

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

当前macOS开发环境已通过统一`pnpm check:shared`：Prettier、release metadata、zh-CN玩家语言、ESLint、TypeScript、82个Vitest文件/461项、23项Node测试、rustfmt、全target/feature Clippy、87项Rust测试及TypeScript/Rust存档双向互操作全部成功。SQLite、Provider、Context、Orchestrator与Security由对应TypeScript/Node/Rust测试组覆盖；结构化证据与类别映射见`docs/audit/V0_2_SHARED_GATE.md`。本任务不冒充Windows安装或macOS应用包验收，平台专属证据仍分别属于T02与T03。

---

## V02-M9-T02 [P0] Windows Gate

- Credential Manager
- WebView2
- NSIS
- install
- launch
- uninstall

GitHub托管Windows x64权威流水线已通过上述全部门禁：Credential Manager往返后无秘密遗留，应用启动产生新WebView2进程，v0.2.0 NSIS静默安装/启动/卸载成功，卸载注册与安装目录移除且应用数据保留。原始artifact、命令退出码、环境、哈希与失败修复链见`docs/audit/V0_2_WINDOWS_GATE.md`。

---

## V02-M9-T03 [P0] macOS Gate

- Keychain
- WKWebView
- .app
- launch
- PlatformPaths

GitHub托管macOS arm64权威流水线已通过上述全部门禁：Keychain真实往返后无秘密遗留，`.app`版本0.2.0并链接系统WebKit，启动产生新WebKit进程且存活19秒，SQLite实际创建于macOS Application Support路径。原始artifact、路径、安全清理与哈希见`docs/audit/V0_2_MACOS_GATE.md`。

---

## V02-M9-T04 [P0] UI 4-resolution Gate

全部核心页面截图。

已完成存档、世界、车卡、酒馆、NPC、任务、冒险、角色卡、档案、我的、设置、恢复12个核心页面在860x600、1180x760、1366x768、1920x1080的48组最终截图。每次加载均等待页面专用就绪选择器，并检查控制台、document/main横向溢出与裁切后代；最终结果全部为0。修复了模型设置标题、纸张主题对比度、侧栏感知断点和“我的”页最小宽度布局4项问题，审计、修复前后证据及52张PNG哈希见`docs/audit/V0_2_UI_4_RESOLUTION_GATE.md`。

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

已完成单一持久SQLite Campaign的可执行纵向测试和隔离bundle ID原生`.app`验证。流程覆盖首次空状态、我的/API、世界确认、车卡、酒馆、NPC、任务、冒险、本地D20、结算、崩溃/恢复、导出、删除、导入与继续；恢复会取消未完成请求并原子回到最近完整阶段。WKWebView实测发现`window.confirm`未展示即删除的问题，已改为应用内二次确认并验证取消后存档保留。审计、18张PNG及SHA-256见`docs/audit/V0_2_VERTICAL_FLOW_GATE.md`。

---

# M10 — Release

## V02-M10-T01 [P0] Windows v0.2 Build

输出：

`release/v0.2/`

已从权威PR CI run `31503183202`下载当前HEAD的Windows x64 NSIS到`release/v0.2/Ember Tavern_0.2.0_x64-setup.exe`。产物为5,220,387 bytes，SHA-256为`1674ffa788316c196ed11147090d281ec68e2ee4b4865a7319c4efe53dde10ca`；CI文件清单、安装生命周期证据和下载后本机复算一致。详细记录见`docs/audit/V0_2_WINDOWS_BUILD.md`。

---

## V02-M10-T02 [P0] Artifact Hash / Manifest

- SHA256SUMS
- ARTIFACT_MANIFEST
- BUILD_INFO
- RELEASE_NOTES
- KNOWN_LIMITATIONS

已在`release/v0.2/`生成五个要求文件。`SHA256SUMS`复算安装器为`1674ffa788316c196ed11147090d281ec68e2ee4b4865a7319c4efe53dde10ca`；JSON manifest/build info绑定源HEAD、CI run/job、Windows x64、NSIS、构建命令、生命周期和未签名状态；发布说明与限制明确Fake Provider、数据保留、WebView2、无自动更新/iOS及外发签名边界。完整记录见`docs/audit/V0_2_ARTIFACT_MANIFEST.md`。

---

## V02-M10-T03 [P0] macOS Dev Build Record

记录：

- app path
- hash
- environment
- test result

不作为正式发布。

已记录权威run `31503183202`在macOS arm64生成的`Ember Tavern.app`：主可执行文件21,614,912 bytes，SHA-256为`d7c5e45776f70fca26a003f36a56bae4651590c644f75ffdd7ec40bf09210dc5`。Keychain、系统WebKit/WKWebView、PlatformPaths真实SQLite落点和17秒启动均通过；下载后本机复算三项bundle文件哈希一致。包仅有ad-hoc linker signature，无Developer ID、公证或分发授权。完整记录见`docs/audit/V0_2_MACOS_DEV_BUILD.md`。

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
