# Ember Tavern V0.3 执行任务

版本：V0.3 Design Freeze

依据：`docs/V0.3_SPEC.md`

执行原则：严格按任务顺序；每次只关闭当前任务，不提前实现后续范围。

## 0. 通用完成标准

每个任务必须包含并满足以下六项：

- **Status**：`TODO`、`IN PROGRESS`、`BLOCKED` 或 `DONE`，关闭时记录日期。
- **Dependency**：所有依赖均为 `DONE` 才可开始。
- **Deliverable**：真实代码、迁移、文档或可复现证据，禁止空实现和写死结果。
- **Acceptance**：逐项核对规格与业务边界。
- **Tests**：执行与风险相称的自动测试；仅文档任务至少执行格式、链接/结构检查和 diff 自审。
- **Do Not**：禁止提前接入未来阶段、削弱验证、覆盖用户修改、把 AI/React 状态当事实源。

每个任务结束时必须更新 `docs/DEVELOPMENT_LOG.md`；重大决定更新 `docs/DECISIONS.md`；形成独立本地 commit。未经授权不 push、不 merge。

---

# M0 — Design Freeze & Reference Audit

## M0-T01 V0.3 规格冻结

- **Status**：DONE（2026-08-13）
- **Dependency**：V0.2 基线和 Repo/Git audit。
- **Deliverable**：`docs/V0.3_SPEC.md`；本 V0.3 任务序列；README、Decision、Development Log 的版本入口。
- **Acceptance**：附件中的产品目标、硬原则、范围、非目标、数据/安全边界和最终验收均被无歧义固化；每个 V0.3 Task 均含六项标准。
- **Tests**：Prettier；文档必需章节/Task 字段脚本检查；Git diff 与链接检查。
- **Do Not**：不研究性复制第三方实现；不修改产品代码；不开始 M0-T02。

## M0-T02 SillyTavern 功能审计

- **Status**：DONE（2026-08-13）
- **Dependency**：M0-T01。
- **Deliverable**：`docs/V0.3_ST_FEATURE_MATRIX.md`。
- **Acceptance**：覆盖 Character Card、Persona、World Info/Lorebook、Prompt Manager、Preset、Chat、Group Chat、Context、Memory、Branch/Checkpoint、Model Settings、Import/Export、Extension、Roleplay UX 和生成交互；逐项标记已有/缺失/采用/不采用/后续。
- **Tests**：来源链接、版本/访问日期、License 与矩阵分类完整性检查；文档格式检查。
- **Do Not**：不复制品牌、图标、素材、CSS、文案或大段源码；不因功能相似就承诺采用。

## M0-T03 GitHub Reference Audit

- **Status**：DONE（2026-08-13）
- **Dependency**：M0-T02。
- **Deliverable**：`docs/V0.3_REFERENCE_AUDIT.md`。
- **Acceptance**：针对 AI Roleplay、RPG/TRPG、Tauri、offline SQLite、Prompt/Context、规则/状态机、Quest、Design System/插件选择多个成熟项目；记录 URL、License、模块、优缺点、适用性、采用判断和拒绝原因。
- **Tests**：官方仓库/License 可访问；审计至少跨多个子系统和多个项目；格式检查。
- **Do Not**：不复制 License 不兼容实现；不把 Star 数当架构证据；不改产品代码。

---

# M1 — 基础稳定性整改

## M1-T01 Credential Lifecycle

- **Status**：DONE（2026-08-13）
- **Dependency**：M0-T03。
- **Deliverable**：页面无关的设备 Provider/Credential 生命周期；回归测试和安全审计记录。
- **Acceptance**：设置 Key 后穿越世界、车卡、NPC、任务、冒险、D20、保存、退出、重启、继续仍可用；Key 不进入 SQLite、日志、配置、Inspector 或导出。
- **Tests**：secure store contract；全链生命周期；删除/替换/缺失/重启；秘密扫描；平台适配测试。
- **Do Not**：不让 React 状态成为凭据真源；不读取或提交正式用户 Key；不扩展 Provider 厂商范围。

## M1-T02 Unified Navigation

- **Status**：DONE（2026-08-13）
- **Dependency**：M1-T01。
- **Deliverable**：统一 Router、history/back、breadcrumb 规则与迁移后的页面导航。
- **Acceptance**：所有层级页面自然返回；刷新、深链和恢复保持 Campaign/实体上下文；页面不再自建互相冲突的返回逻辑。
- **Tests**：路由、back/deep-link、恢复、无 Campaign/非法参数、桌面视口回归。
- **Do Not**：不重做视觉系统；不新增业务页面；不把路由状态当存档。

## M1-T03 Error Architecture

- **Status**：DONE（2026-08-13）
- **Dependency**：M1-T02。
- **Deliverable**：六类统一错误合同、映射、UI actions 和页面错误状态。
- **Acceptance**：Retry/Cancel/Fallback/Toast/Error State 与可恢复性一致；认证、额度、验证和规则错误不触发错误的静默 fallback。
- **Tests**：每类错误的 TS/Rust 映射、retry eligibility、UI action、pending 幂等和无部分写入。
- **Do Not**：不吞错、不用通用“失败”替代可操作原因、不降低 Provider/Schema 校验。

## M1-T04 Performance Baseline

- **Status**：DONE（2026-08-13）
- **Dependency**：M1-T03。
- **Deliverable**：可重复基线工具与 `docs/V0.3_PERFORMANCE_BASELINE.md`。
- **Acceptance**：记录 world/NPC/quest/action/D20 latency、queue wait、prompt/output tokens、cache、retry；Fake 与真实 Provider 证据明确区分。
- **Tests**：指标 schema、上限/隐私、重复运行、失败记录和报告一致性。
- **Do Not**：不先优化再补基线；不保存 Prompt、秘密或玩家全文到遥测。

---

# M2 — Design System / UI / UX

## M2-T01 Design Tokens

- **Status**：DONE（2026-08-13）
- **Dependency**：M1-T04。
- **Deliverable**：正式 color/type/spacing/radius/shadow/motion/layer tokens 和旧样式迁移策略。
- **Acceptance**：核心页面使用语义 token；主题对比度和减少动态效果有明确合同；显著减少任意 hard-code。
- **Tests**：token 静态检查、主题对比度、四分辨率 smoke、visual evidence。
- **Do Not**：不一次重写所有页面；不改变游戏逻辑；不引入无必要 CSS 框架迁移。

## M2-T02 UI Primitives

- **Status**：DONE（2026-08-13）
- **Dependency**：M2-T01。
- **Deliverable**：Button/Input/Textarea/Select/Card/Modal/Drawer/Tabs/Tooltip/Toast/Skeleton/Progress/Empty/Error primitives。
- **Acceptance**：键盘、焦点、disabled/loading/error 和可访问名称一致；页面可渐进迁移。
- **Tests**：组件行为、键盘/焦点、ARIA、主题、snapshot/visual tests。
- **Do Not**：不在 primitives 内写业务逻辑；不复制第三方视觉资产。

## M2-T03 Game Components

- **Status**：DONE（2026-08-13）
- **Dependency**：M2-T02。
- **Deliverable**：九类共享 Game Components 及核心页面迁移。
- **Acceptance**：同类卡片、对话、状态和生成交互不重复；组件仅接收明确 view model/actions。
- **Tests**：渲染、空/错/加载态、交互、窄窗口与回归。
- **Do Not**：不让组件直连 SQLite/Provider；不提前实现动态实体规则。

## M2-T04 AI Field Assist

- **Status**：DONE（2026-08-13）
- **Dependency**：M2-T03。
- **Deliverable**：所有自然语言字段的统一生成/完善/候选/扩写/缩写/锁定交互合同和组件。
- **Acceptance**：现有自然语言输入无遗漏；采用、撤销、取消、重试、字段锁定和并发状态一致。
- **Tests**：字段清单审计、state machine、cancel/race、locked field、不合规输出。
- **Do Not**：不让 AI 直接保存字段；不在游戏开始后刷新已锁定世界事实。

## M2-T05 Action Composer

- **Status**：DONE（2026-08-13）
- **Dependency**：M2-T04。
- **Deliverable**：统一对话/行动 Composer，3–5 候选和永久自由输入。
- **Acceptance**：候选与自由输入走同一合法性/持久化路径；键盘、streaming、取消和错误状态一致。
- **Tests**：候选数量、自由输入、切换、重复提交、恢复、NPC/冒险/调查集成。
- **Do Not**：不把候选做成唯一动作；不赋予候选额外规则权限。

## 未完成 UI 任务的全局视觉实现标准

- **规范来源**：`docs/EMBER_TAVERN_VISUAL_STYLE_GUIDE_V1.md`；迁移清单与视觉债务见 `docs/V0.3_VISUAL_MIGRATION.md`。
- **适用任务**：M5-T02～M5-T05、M6 各实体 UI、M7 酒馆/对话、M8 Quest UI、M10-T03 Streaming/Loading/Provider 状态、M10-T05 恢复 UI、M10-T07 视觉收敛，以及 M11/M12 的可玩性与审查证据。
- **Implementation**：新增或自然修改到的 UI 必须复用现有 Design Tokens、UI Primitives 和 Game Components；AIFieldAssist、ActionComposer、CharacterCard、NpcCard、QuestCard、Trait、D20、Narrative、Adventure 继续沿用既有合同和组件边界。不得新建平行组件体系，不得重复硬编码近似颜色、字体、间距、Border、Radius、Shadow 或 Motion。
- **Acceptance**：页面保持“黑暗奇幻酒馆 × TRPG 冒险手册 × 现代桌面游戏 HUD”的信息层级；正文可读、键盘/焦点/减少动态效果符合既有无障碍门禁；不以颜色单独表达状态；AI 身份采用命运/世界生成语言且不抢占游戏内容。
- **Boundary**：当前业务任务只迁移其新增或自然触及范围。若完整视觉落实会扩大任务，不提前返工已完成页面，登记视觉债务并由 M10-T07 收敛；功能、数据合同、存档兼容性和已验证状态机优先。

---

# M3 — AI Generation Infrastructure

## M3-T01 Generator Framework

- **Status**：DONE（2026-08-13）
- **Dependency**：M2-T05。
- **Deliverable**：`Generator<T>` 生命周期、共享基类/组合器和首个迁移切片。
- **Acceptance**：Context、Prompt、Provider、parse/validate/repair/rules/persist/events 边界可替换且可审计；旧桌面编排能力不回退。
- **Tests**：阶段顺序、失败短路、repair、规则拒绝、事务 rollback、幂等事件。
- **Do Not**：不一次迁移全部生成器；不建立第二套 Provider 栈；不直接写 DB。

## M3-T02 Generation Queue

- **Status**：DONE（2026-08-14）
- **Dependency**：M3-T01。
- **Deliverable**：P0/P1/P2 队列、并发、取消、超时、重试、fallback、去重和指标。
- **Acceptance**：P0 不被后台任务饿死；相同意图去重；取消/超时无部分事实；硬结果 retry 不变。
- **Tests**：priority/fairness、concurrency、cancel race、timeout、dedupe、fallback policy、metrics。
- **Do Not**：不启用无限后台生成；不绕过现有错误和凭据边界。

## M3-T03 Structured Entity Schemas

- **Status**：DONE（2026-08-14）
- **Dependency**：M3-T02。
- **Deliverable**：V0.3 重要实体的版本化输入/输出 Schema 与 registry。
- **Acceptance**：World Constitution、Career、Trait、Item、Location、Faction、NPC LOD、Quest/Graph、Director action 均非纯长文本；TS/Rust 关键边界一致。
- **Tests**：有效/缺失/越界/未知版本/资源上限/cross-language fixtures。
- **Do Not**：不把 schema parse 当业务验证；不静默丢弃未知数据。

## M3-T04 AI Inspector

- **Status**：DONE（2026-08-14）
- **Dependency**：M3-T03。
- **Deliverable**：开发/高级 Inspector 的 generation、provider、latency、cache、tokens、context、prompt、raw/parsed/validation/repair 视图。
- **Acceptance**：默认遮罩秘密和未授权 truth；失败也可定位；Inspector 不成为事实源。
- **Tests**：redaction、权限/模式、空与失败记录、上限、无 API Key/Authorization。
- **Do Not**：不默认暴露 Core Prompt、秘密或完整数据库；不让 Inspector 编辑正式事实。

---

# M4 — World Constitution + Rules

## M4-T01 World Constitution

- **Status**：DONE
- **Dependency**：M3-T04。
- **Deliverable**：合同、Generator、SQLite migration/repository、确认 UI 和下游约束入口。
- **Acceptance**：必需字段齐全、版本化、锁定后不可随意改写；生成内容违反 Constitution 时拒绝/repair。
- **Tests**：三种 Constitution、revision、locked mutation、下游 mismatch、save/reload/migration。
- **Do Not**：不把 Constitution 只存 Prompt；不一次生成完整世界。

## M4-T02 World Seed

- **Status**：DONE
- **Dependency**：M4-T01。
- **Deliverable**：持久 Seed、可注入程序随机流和确定性抽样工具。
- **Acceptance**：相同 Seed/状态得到相同程序选择；事实写入后以 SQLite 为准；D20 保持独立受信随机边界。
- **Tests**：repeatability、stream isolation、save/reload、migration、D20 independence。
- **Do Not**：不宣称 LLM 完全 deterministic；不允许用户用 Seed 重投硬结果。

## M4-T03 Rules Engine Expansion

- **Status**：DONE
- **Dependency**：M4-T02。
- **Deliverable**：属性/技能/HP/状态/装备/钱/时间/Trait/Quest/资源的规则合同与 validator。
- **Acceptance**：所有数值状态由本地规则裁决，AI proposal 无直接写入口；事务和事件可审计。
- **Tests**：边界、组合、非法 patch、rollback、idempotency、property-based tests（适用时）。
- **Do Not**：不复制完整 DND/COC 规则；不让叙事文本反解析为数值。

## M4-T04 Knowledge Boundary

- **Status**：DONE
- **Dependency**：M4-T03。
- **Deliverable**：World/NPC/Player Knowledge 持久模型、provenance、上下文投影和授权规则。
- **Acceptance**：NPC 不获得无权事实；Player Knowledge 独立；Memory/Claim 不升级 Truth；多 NPC 场景按 Actor 投影。
- **Tests**：secret isolation、claim/truth、learn/forget/update、provenance、save/import、prompt leakage。
- **Do Not**：不把完整 WorldTruth 发给 NPC；不靠 Prompt 单独保证知识边界。

---

# M5 — Character Creation 2.0 + Trait

## M5-T01 Universal Character Schema

- **Status**：DONE
- **Dependency**：M4-T04。
- **Deliverable**：通用角色合同、世界扩展定义、V0.2 兼容投影与存储迁移。
- **Acceptance**：规格字段可表达；修仙/调查/Cyberpunk 扩展示例可验证；未知扩展安全保留或明确拒绝。
- **Tests**：三世界 fixtures、schema version、migration、round-trip、资源上限。
- **Do Not**：不把所有世界字段硬编码进核心类型；不丢 V0.2 角色。

## M5-T02 Quick / Advanced Creation

- **Status**：DONE
- **Dependency**：M5-T01。
- **Deliverable**：两种车卡流程和共享草稿/锁定/确认状态机。
- **Acceptance**：Quick 一句生成完整合法卡；Advanced 全字段可编辑；切换模式不丢已锁内容；只有确认后写正式事实。
- **Tests**：quick/advanced、mode switch、invalid fields、cancel/resume、save/reload。
- **Do Not**：不让页面草稿成为正式角色；不先实现 Trait 点数 UI。

## M5-T03 Character AI Everywhere

- **Status**：DONE
- **Dependency**：M5-T02。
- **Deliverable**：单字段、3 候选、补空、区域、整卡、未锁重生能力。
- **Acceptance**：每个自然语言字段均接入统一 AIFieldAssist；生成读取锁定上下文并通过角色一致性校验。
- **Tests**：字段覆盖、locked preservation、contradiction、concurrency、repair、undo。
- **Do Not**：不改数值规则字段；不绕过世界 Constitution。

## M5-T04 Trait Point System

- **Status**：DONE
- **Dependency**：M5-T03。
- **Deliverable**：Buff/Debuff/Mixed/Narrative Trait 合同、点数计算、规则 UI。
- **Acceptance**：空集合和严格净 0 可开始；非零禁止；点值只由本地规则确认。
- **Tests**：所有 Trait 类型、-5..+5、mixed、empty、strict zero、serialization。
- **Do Not**：不以 UI 显示值代替规则重算；不允许 AI 自批点数。

## M5-T05 Trait Balance & Synergy

- **Status**：DONE
- **Dependency**：M5-T04。
- **Deliverable**：`TraitBalanceValidator`、`TraitSynergyValidator`、解释性错误和生成反馈。
- **Acceptance**：覆盖十项平衡维度并能拒绝明显组合套利；相同世界规则下结果可重复审计。
- **Tests**：公平/不公平/条件/永久/环境/组合套利、三世界 cases、false-positive baseline。
- **Do Not**：不把平衡交给 LLM 最终决定；不做无法解释的黑盒评分。

---

# M6 — Dynamic World Entities

## M6-T01 Dynamic Career Pool

- **Status**：DONE（2026-08-20）
- **Dependency**：M5-T05。
- **Deliverable**：Career schema/generator/pool/repository/character integration。
- **Acceptance**：按 Constitution 生成 rarity 分层和结构字段；运行中新职业合法持久化；三世界明显不同。
- **Tests**：constitution compliance、rarity、requirements、dedupe、save/reload、V0.2 mapping。
- **Do Not**：不以固定四职业作为玩家可见核心；不让职业直接修改角色数值。

## M6-T02 Semantic Equipment

- **Status**：DONE（2026-08-20）
- **Dependency**：M6-T01。
- **Deliverable**：AI 语义 + Rules 数值的装备模型、Generator、平衡与触发器。
- **Acceptance**：名称/历史/来源/剧情能力与 damage/defense/price 等物理分离；可绑定 Quest/NPC/Fact。
- **Tests**：balance、rarity/price、trigger、no inflation、dedupe、save/import。
- **Do Not**：不从描述解析数值；不生成无来源高阶装备。
- **Implementation reference**：[`V0.3_SEMANTIC_EQUIPMENT.md`](V0.3_SEMANTIC_EQUIPMENT.md)。

## M6-T03 NPC LOD

- **Status**：DONE（2026-08-20）
- **Dependency**：M6-T02。
- **Deliverable**：LOD0–3 合同、升级规则、Generator 和持久化。
- **Acceptance**：世界创建不全量生成 NPC；互动提升细节且延续身份；升级幂等并保留知识边界。
- **Tests**：each LOD、upgrade/downgrade rejection、concurrency、identity continuity、save/reload。
- **Do Not**：不生成全世界人口；不让 LOD 升级改写既有事实。
- **Implementation reference**：[`V0.3_NPC_LOD.md`](V0.3_NPC_LOD.md)。

## M6-T04 Dynamic Locations

- **Status**：DONE（2026-08-20）
- **Dependency**：M6-T03。
- **Deliverable**：层级地点、按需具体化、移动和持久化规则。
- **Acceptance**：多尺度地点可表达；玩家离开预设城市仍可继续；地点事实服从 Constitution。
- **Tests**：hierarchy、travel、lazy generation、invalid topology、save/reload。
- **Do Not**：不实现格子地图/战棋；不一次生成完整地图。
- **Implementation reference**：[`V0.3_DYNAMIC_LOCATIONS.md`](V0.3_DYNAMIC_LOCATIONS.md)。

## M6-T05 Active Factions

- **Status**：DONE（2026-08-20）
- **Dependency**：M6-T04。
- **Deliverable**：Faction 结构、行动规则、关系和世界事件接口。
- **Acceptance**：八项字段完整；势力可通过规则验证的行动改变实体/Quest；玩家关系持久化。
- **Tests**：ally/enemy、territory/resource、action legality、consequence、save/reload。
- **Do Not**：不让 AI 越过 Director budget；不预写固定势力剧情。
- **Implementation reference**：[`V0.3_ACTIVE_FACTIONS.md`](V0.3_ACTIVE_FACTIONS.md)。

---

# M7 — Tavern Rebuild

## M7-T01 Dynamic Tavern Population

- **Status**：DONE（2026-08-24）
- **Dependency**：M6-T05。
- **Deliverable**：按世界/地点/时间/势力/事件/历史投影酒馆 NPC 和机会。
- **Acceptance**：不依赖固定 NPC；重要互动实体持久化；重开后身份/关系/历史一致。
- **Tests**：context factors、LOD promotion、time/event changes、save/reopen、empty state。
- **Do Not**：不每次进酒馆重生所有 NPC；不让临时 UI 列表成为事实。
- **Implementation reference**：[`V0.3_DYNAMIC_TAVERN_POPULATION.md`](V0.3_DYNAMIC_TAVERN_POPULATION.md)。

## M7-T02 Multi-NPC Scene

- **Status**：DONE（2026-08-24）
- **Dependency**：M7-T01。
- **Deliverable**：场景参与者、speaker/action proposal、turn arbitration 和 UI。
- **Acceptance**：说话/打断/沉默/偷听/离开/介入由知识与目标驱动，不机械轮流；每个 Actor 只获授权 Context。
- **Tests**：speaker selection、silence/leave/interruption、knowledge leakage、concurrency、persistence。
- **Do Not**：不把多个 NPC 合成全知 Agent；不固定轮询。
- **Implementation reference**：[`V0.3_MULTI_NPC_SCENE.md`](V0.3_MULTI_NPC_SCENE.md)。

## M7-T03 Immutable NPC Timeline

- **Status**：DONE（2026-08-24）
- **Dependency**：M7-T02。
- **Deliverable**：正式回复锁定、技术 Retry、事实冲突修复和 UI 规则。
- **Acceptance**：无普通 Swipe；成功回复不能刷新；技术 Retry 使用同一意图/硬结果且不重复提交。
- **Tests**：success lock、network/schema/fact retry、duplicate、crash recovery、multi-NPC ordering。
- **Do Not**：不删除既有消息换新结果；不让 Retry 重投 D20。
- **Implementation reference**：[`V0.3_IMMUTABLE_NPC_TIMELINE.md`](V0.3_IMMUTABLE_NPC_TIMELINE.md)。

## M7-T04 Dialogue Suggestions

- **Status**：DONE（2026-08-24）
- **Dependency**：M7-T03。
- **Deliverable**：3–5 对话建议接入 Action Composer 与候选缓存/失效规则。
- **Acceptance**：建议符合当前 NPC/场景且自由输入永久存在；世界变化后旧建议失效。
- **Tests**：count、relevance inputs、free input、cache invalidation、cancel/error。
- **Do Not**：不自动发送建议；不把建议持久化为玩家行动。
- **Implementation reference**：[`V0.3_DIALOGUE_SUGGESTIONS.md`](V0.3_DIALOGUE_SUGGESTIONS.md)。

## M7-T05 Prompt Manager

- **Status**：DONE（2026-08-24）
- **Dependency**：M7-T04。
- **Deliverable**：User Editable 与 Core Rule Prompt 分层、preset/version/import/export（无秘密）。
- **Acceptance**：用户调整风格不破坏规则、知识边界或 Schema；错误配置可恢复默认。
- **Tests**：merge/order、core immutability、version、import/export、secret scan、cache revision。
- **Do Not**：不提供覆盖系统安全/规则 Prompt 的入口；不复制 SillyTavern UI。
- **Implementation reference**：[`V0.3_PROMPT_MANAGER.md`](V0.3_PROMPT_MANAGER.md)。

---

# M8 — Quest Graph + World Director

## M8-T01 Multi-Quest Pool

- **Status**：DONE（2026-08-24）
- **Dependency**：M7-T05。
- **Deliverable**：完整 Quest 状态机、类型、Repository 和多任务 UI。
- **Acceptance**：多任务并存且合法迁移；玩家介入可激活；失败/过期/放弃不可被生成抹掉。
- **Tests**：all states/transitions、multiple active、implicit activation、save/reload/migration。
- **Do Not**：不保留 `currentQuest` 为唯一真源；不强制接受按钮。
- **Implementation reference**：[`V0.3_MULTI_QUEST_POOL.md`](V0.3_MULTI_QUEST_POOL.md)。

## M8-T02 Quest Graph

- **Status**：DONE（2026-08-24）
- **Dependency**：M8-T01。
- **Deliverable**：事实/实体/前置/后果边、依赖重评估和可视/调试投影。
- **Acceptance**：Quest A 的事实变化能确定性更新 B/C；循环和悬空引用被拒绝；事件可审计。
- **Tests**：chain/branch/cycle、NPC death/faction/location consequences、rollback、reload。
- **Do Not**：不让每个任务成为隔离故事；不由 LLM 自行宣告依赖状态。
- **Implementation reference**：[`V0.3_QUEST_GRAPH.md`](V0.3_QUEST_GRAPH.md)。

## M8-T03 Dynamic Quest Sources

- **Status**：DONE（2026-08-24）
- **Dependency**：M8-T02。
- **Deliverable**：NPC/Faction/Event/Discovery/Player Action/Consequence 的 Quest generation adapters。
- **Acceptance**：来源与 provenance 持久化；任务符合世界和预算；自由行为可产生任务。
- **Tests**：each source、dedupe、constitution、knowledge visibility、budget rejection。
- **Do Not**：不为每个行为强行创建任务；不暴露隐藏任务。
- **Implementation reference**：[`V0.3_DYNAMIC_QUEST_SOURCES.md`](V0.3_DYNAMIC_QUEST_SOURCES.md)。

## M8-T04 World Director

- **Status**：DONE（2026-08-24）
- **Dependency**：M8-T03。
- **Deliverable**：节奏评估、实体行动提案、调度和可解释决策记录。
- **Acceptance**：Director 只提议何时/谁/什么需变化，Rules/Generator 决定合法内容；无固定主线。
- **Tests**：quiet/overload/foreshadow/pressure/expiry、deterministic rules、failure safety。
- **Do Not**：不让 Director 直接写事实；不后台无限调用模型。
- **Implementation reference**：[`V0.3_WORLD_DIRECTOR.md`](V0.3_WORLD_DIRECTOR.md)。

## M8-T05 Director Budget

- **Status**：TODO
- **Dependency**：M8-T04。
- **Deliverable**：Active Quest、每日事件、紧急事件、NPC 主动和后台变化预算/冷却。
- **Acceptance**：超预算请求延后/拒绝且可观察；预算持久化并随游戏时间恢复。
- **Tests**：limits、cooldown、day rollover、priority、starvation、save/reload。
- **Do Not**：不靠 Prompt 自律控制数量；不丢弃 P0 玩家操作。

---

# M9 — Context / Memory / World Info

## M9-T01 Unified Context Builder

- **Status**：TODO
- **Dependency**：M8-T05。
- **Deliverable**：统一分层 Context Builder，迁移所有重要 Generator。
- **Acceptance**：只注入 Constitution、相关 Lore/Location/Player/Actor Knowledge/Quest/State/Memory/Recent/Action；无全库 dump。
- **Tests**：relevance、ordering、secret isolation、budget、omission、all generator integrations。
- **Do Not**：不为每个页面建独立上下文栈；不把完整 DB 序列化进 Prompt。

## M9-T02 Memory Layers

- **Status**：TODO
- **Dependency**：M9-T01。
- **Deliverable**：Structured Fact、Recent、Summary、Long-term Memory、World Lore 的合同、生成、验证和存储。
- **Acceptance**：摘要可追溯且不升级 Truth；长期记忆有来源/Actor/时间；旧史可压缩但 SQLite 原记录保留。
- **Tests**：promotion rules、summary drift、actor isolation、source deletion/update、save/import。
- **Do Not**：不把摘要作为唯一历史；不提前引入向量数据库。

## M9-T03 Retrieval Interface & World Info

- **Status**：TODO
- **Dependency**：M9-T02。
- **Deliverable**：结构化相关性检索接口、Lore 条目触发/优先级/预算和未来 RAG port。
- **Acceptance**：无向量服务也可工作；触发规则可解释；稳定结果可缓存。
- **Tests**：keyword/entity/location/quest triggers、priority、budget、false match、cache invalidation。
- **Do Not**：不把外部向量服务设为 V0.3 前置；不复制 Lorebook 实现。

---

# M10 — Lazy Generation / Performance / Persistence

## M10-T01 Lazy World Generation

- **Status**：TODO
- **Dependency**：M9-T03。
- **Deliverable**：核心骨架启动、按需具体化和后台生成计划。
- **Acceptance**：新世界不等待全量 NPC/职业/Quest/地点；骨架足以安全进入；需要时幂等具体化。
- **Tests**：cold start、partial failure、cancel/reopen、dedupe、no full-world generation。
- **Do Not**：不以占位假数据冒充生成；不让后台失败破坏核心存档。

## M10-T02 Prefetch

- **Status**：TODO
- **Dependency**：M10-T01。
- **Deliverable**：Director 预测、P1/P2 预取、失效和命中指标。
- **Acceptance**：预取不阻塞 P0、不提交未采用玩家行为、不泄露隐藏信息。
- **Tests**：prediction hit/miss、priority、cancel/invalidate、budget、privacy。
- **Do Not**：不无限猜测玩家路线；不将预取候选当事实。

## M10-T03 Streaming

- **Status**：TODO
- **Dependency**：M10-T02。
- **Deliverable**：NPC/介绍等可取消流式 UX、原生传输和提交边界。
- **Acceptance**：流中断不产生正式消息；完整结果验证后一次提交；重开可辨 pending/failed/committed。
- **Tests**：chunk order、unicode、cancel/timeout、malformed final、retry、no partial commit。
- **Do Not**：不逐 chunk 修改世界状态；不把 streaming 作为 Provider 必需能力。

## M10-T04 Cache Optimization

- **Status**：TODO
- **Dependency**：M10-T03。
- **Deliverable**：Constitution/Rules/Prompt 稳定前缀、动态尾部、指标和基线对比。
- **Acceptance**：相同稳定输入字节一致；动态行动不污染前缀；真实 Provider 指标与会话观察明确区分。
- **Tests**：byte stability、revision invalidation、privacy、metric cap、real-provider test opt-in。
- **Do Not**：不为命中牺牲正确上下文；不虚报 Provider cache。

## M10-T05 V0.3 Save Schema & Migration

- **Status**：TODO
- **Dependency**：M10-T04。
- **Deliverable**：save/world schema version、SQLite migrations、V0.2→V0.3 转换、导入导出升级和恢复 UI。
- **Acceptance**：迁移前备份、隔离副本、完整性/领域重载、原子切换；无法转换时原件不变且明确提示。
- **Tests**：all historical fixtures、cross-language、interrupted/corrupt/future version、secret scan、round-trip。
- **Do Not**：不静默丢字段或覆盖原档；不删除历史 migrations/fixtures。

## M10-T06 Performance Regression Gate

- **Status**：TODO
- **Dependency**：M10-T05。
- **Deliverable**：与 M1-T04 对比的自动性能门和更新报告。
- **Acceptance**：核心延迟、queue、token、cache、长期 DB/Context 增长有阈值和解释；回归必须修复或明确接受并记录决定。
- **Tests**：repeatability、warm/cold、long-save、threshold failure、report generation。
- **Do Not**：不以单次最快值为结论；不降低门槛掩盖回归。

## M10-T07 Visual System Convergence

- **Status**：TODO
- **Dependency**：M10-T06。
- **Deliverable**：按 `Design Tokens → UI Primitives → Game Components → Feature Pages → Legacy UI Migration → Visual Consistency Audit` 完成 V0.3 桌面 UI 收敛，关闭 `docs/V0.3_VISUAL_MIGRATION.md` 中适用视觉债务并形成视觉证据。
- **Acceptance**：Typography、Color、Spacing、Radius、Border、Shadow、Motion 均由 Design Token 唯一供值；既有共享 primitive/game component 被复用而无第二套体系；Character/NPC/Quest/Trait/D20/Narrative/Adventure/Tavern/Settings 等功能页符合视觉手册、信息层级和 AI 身份；四个既定桌面视口无溢出，WCAG AA、键盘焦点、非颜色状态、reduced-motion 与可跳过 D20 动画通过；逐页视觉一致性审查无未记录差异。
- **Tests**：raw visual value/token 静态门、组件复用清单、页面/状态矩阵、四视口真实截图、contrast/focus/reduced-motion、loading/streaming/toast/empty/error、视觉债务复算与回归 build。
- **Do Not**：不改变业务语义、状态机、数据合同或存档；不大规模一次性重写前端；不复制现有组件制造平行体系；不以换色/背景替代完整收敛；不使用大量金边、火焰、Emoji、巨大圆角、聊天气泡或 SaaS Dashboard 布局。

---

# M11 — Playability

## M11-T01 Three-World Test Harness

- **Status**：TODO
- **Dependency**：M10-T07。
- **Deliverable**：奇幻、调查/COC、Cyberpunk 三世界的隔离测试配置、行为脚本和证据格式。
- **Acceptance**：三世界 Constitution/职业/装备/Trait/NPC/Quest/扩展字段明显不同；不使用正式用户数据。
- **Tests**：fixture validity、isolation、reset/replay、secret scan。
- **Do Not**：不把三个世界做成换名 fixture；不预判测试结果。

## M11-T02 Fantasy Long Playtest

- **Status**：TODO
- **Dependency**：M11-T01。
- **Deliverable**：30–50 个有效行为、自动/人工证据、发现与修复。
- **Acceptance**：覆盖完整 V0.3 核心功能、保存重启、知识/一致性/性能观察。
- **Tests**：全量适用门禁 + 该世界回归。
- **Do Not**：不只点候选；不忽略失败发现。

## M11-T03 Investigation Long Playtest

- **Status**：TODO
- **Dependency**：M11-T02。
- **Deliverable**：30–50 个调查世界行为、证据、发现与修复。
- **Acceptance**：理智/幸运/信用等扩展、有限认知、误导信息、失败推进和多 Quest 一致。
- **Tests**：全量适用门禁 + 该世界回归。
- **Do Not**：不复制 COC 受版权保护文本/规则；不让一次失败锁死线索。

## M11-T04 Cyberpunk Long Playtest

- **Status**：TODO
- **Dependency**：M11-T03。
- **Deliverable**：30–50 个科幻世界行为、证据、发现与修复。
- **Acceptance**：义体/负荷/声望、动态势力、经济/装备平衡、跨地点和多任务后果稳定。
- **Tests**：全量适用门禁 + 该世界回归。
- **Do Not**：不把奇幻内容换皮；不允许数值膨胀。

## M11-T05 Free-Input Stress Test

- **Status**：TODO
- **Dependency**：M11-T04。
- **Deliverable**：至少八类非推荐行为的跨世界压力证据与修复。
- **Acceptance**：系统可合理成功/失败/拒绝，但不崩溃、丢档、跳过后果或强迫预设路线。
- **Tests**：拒绝/欺骗/购买/偷窃/离城/路人长期交流/卖任务道具/投敌；重开与一致性。
- **Do Not**：不为测试写死结果；不把“无法解析”当默认回应。

## M11-T06 Playability Report

- **Status**：TODO
- **Dependency**：M11-T05。
- **Deliverable**：`docs/V0.3_PLAYABILITY_REPORT.md`。
- **Acceptance**：逐世界记录行为数、模型、延迟、知识/人格/Quest/World/Trait/Equipment/Director/Context、发现/修复/剩余和评分。
- **Tests**：证据链接与统计复算；报告格式；最终回归。
- **Do Not**：不把 Fake 测试冒充真实模型；不省略失败或 BLOCKED。

---

# M12 — Audit & Release

## M12-T01 First Full Audit

- **Status**：TODO
- **Dependency**：M11-T06。
- **Deliverable**：Architecture、Code、Security、Credential、Provider、AI、Rules、SQLite、Save/Migration、Performance/Cache、UI/UX/A11y、Regression、Playability 的 findings ledger。
- **Acceptance**：每项含证据、P0–P3、状态、影响、修复建议；不采信 DONE 标签本身。UI/UX 审查必须逐页复核视觉手册、Token 唯一来源、共享组件复用、Feature/Legacy 迁移完成度和视觉一致性，不得把“已换色”视为通过。
- **Tests**：全量静态/动态检查和证据复核；视觉部分复算 M10-T07 页面/状态/视口矩阵并抽查原始视觉值、对比度、焦点与 reduced-motion。
- **Do Not**：不边审边降低标准；不遗漏外部环境限制。

## M12-T02 Fix Audit Findings

- **Status**：TODO
- **Dependency**：M12-T01。
- **Deliverable**：逐项修复、回归、Decision/Log 更新和原子 commits。
- **Acceptance**：P0/P1 全部关闭；P2/P3 明确关闭、延期理由和风险；无新回归。
- **Tests**：每项定向回归 + 全量质量门 + 适用 build。
- **Do Not**：不删测试/跳验证/吞错误使门禁通过；不将 BLOCKED 写成 VERIFIED。

## M12-T03 Release Gates

- **Status**：TODO
- **Dependency**：M12-T02。
- **Deliverable**：Formatter、lint、typecheck、TS/Node/Rust、rustfmt/clippy、interop、desktop/release build、平台适用门禁和结构化证据。
- **Acceptance**：所有适用门禁通过；平台不可用项明确 BLOCKED；产物来源 commit 与哈希可追溯。
- **Tests**：门禁本身的自测、产物哈希、秘密扫描。
- **Do Not**：不复用旧版本证据冒充 V0.3；不签名/发布/push，除非用户授权。

## M12-T04 Reports & Final Verdict

- **Status**：TODO
- **Dependency**：M12-T03。
- **Deliverable**：`docs/V0.3_FIRST_AUDIT_REPORT.md`、最终版 Playability Report、README/Tasks/Log/Decisions 和完整 Final Verdict。
- **Acceptance**：明确 P0/P1/P2/P3、评分、测试、真实模型、性能、缓存、起止 commit、新增 commits、branch/status/clean、push/merge、Remaining Risks 和 `READY FOR SECOND AUDIT` 判断。
- **Tests**：报告统计与证据一致；文档/链接/格式；最终 `git diff`/status/secret review。
- **Do Not**：P0/P1 未清零时不得判定 READY；不隐瞒 dirty tree 或用户原有修改；不自动开始第二轮审计。
