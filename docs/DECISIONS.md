# Ember Tavern 架构与产品决策记录

仅记录会长期影响实现、数据或验收口径的决定。新增决定采用递增编号，保留历史。

## DEC-001：酒馆老板计入三名常驻 NPC

- 日期：2026-07-30
- 状态：已采纳
- 依据：`docs/spec.md` 第 9.1、35.2 节；`docs/TASKS.md` 的 `M4-T03`

### 背景

规格的初始内容列出一名老板、两名常驻 NPC 和一名临时访客；总体验收与任务拆分要求三名常驻 NPC 和一名临时访客。

### 决定

老板是三名常驻 NPC 之一。因此初始酒馆包含一名老板、另外两名常驻 NPC 和一名临时访客。

### 影响

该解释同时满足两处数量要求，不新增 NPC，不改变 v0.1 产品范围。后续协议、Fake Provider 和验收数据应沿用此口径。

## DEC-002：Cargo workspace 动态验证延后至首个真实 crate

- 日期：2026-07-30
- 状态：已采纳
- 依据：`docs/TASKS.md` 的 `M0-T02`、`M0-T03`

### 背景

根 `Cargo.toml` 是 virtual workspace，成员配置为 `crates/*`。在 `M0-T03` 创建首个真实 crate 前，workspace 没有实际成员；Cargo 1.97.1 因此无法成功执行 `cargo metadata --format-version 1` 或 `cargo test --workspace`。将成员设为空也不能使无成员的 virtual workspace 通过动态验证。

### 决定

`M0-T02` 负责创建并静态检查 pnpm 与 Cargo workspace 配置，不创建无意义、临时或后续需要删除的占位 crate。`cargo metadata --format-version 1` 和 `cargo test --workspace` 延后到 `M0-T03` 创建首个真实 crate 后执行；两项命令成功且根 workspace 能识别该 crate，才可关闭 `M0-T03`。

### 影响

该决定只调整 Cargo 动态验证的执行时机，不取消验证，也不降低项目整体测试标准。`M0-T02` 可在配置静态检查通过后完成，`M0-T03` 仍按原任务范围创建首个真实 crate，并承担 workspace 动态验证。

## DEC-003：基础协议采用不透明 ID 与可保留未知值的序列化类型

- 日期：2026-07-30
- 状态：已采纳
- 依据：`docs/TASKS.md` 的 `M1-T01`

### 背景

共享协议会同时被 UI、领域层、SQLite、导入导出和 AI 上下文使用。裸字符串 ID 容易跨实体误传；非规范时间和未知枚举值若被静默转换，会破坏跨版本恢复。

### 可选方案

- 继续使用裸字符串或数字，由调用方自行约定。
- 使用运行时 class 包装所有值。
- 使用 TypeScript brand 提供编译期隔离，并用构造器执行边界验证。

### 决定与理由

采用 brand：ID 保留可序列化字符串形态但在类型层互不兼容；时间戳必须等于 `Date.toISOString()` 产生的 canonical UTC 字符串；Schema 与 Prompt 版本为正安全整数；枚举解码返回已知值或保留原始未知字符串。该方案简单、无运行时对象开销，且不会静默丢失未来版本数据。

### 影响

后续实体字段必须引用对应 brand 类型，外部字符串只能通过构造器进入领域协议。读取未知枚举时必须显式处理 `unknown` 分支。

### 可逆性

可逆，但改变序列化规则或 brand 构造约束需要 Schema 兼容评估和迁移；因此应在新增持久化数据前完成调整。

## DEC-004：Campaign 异常状态保存并限制恢复阶段

- 日期：2026-07-30
- 状态：已采纳
- 依据：`docs/spec.md` 第 21.1 节；`docs/TASKS.md` 的 `M1-T02`

### 背景

规格列出三个可恢复异常状态，但仅用状态枚举无法知道异常前处于哪个正常阶段。若异常状态允许恢复到任意阶段，可能跳过世界确认、车卡或结算。

### 可选方案

- 异常状态允许回到任意正常状态。
- 为每一种正常阶段复制一组异常枚举。
- Campaign 在异常状态下保存一个 `resumeState`，恢复时只允许回到该阶段。

### 决定与理由

采用 `resumeState`。进入 `GENERATION_FAILED`、`WAITING_FOR_MODEL` 或 `RECOVERY_REQUIRED` 时记录当前正常阶段；异常之间切换保留该值；回到正常流程时只能恢复该阶段。`ARCHIVED` 不参与恢复且为终态。该方案避免状态爆炸并能阻止跳阶段。

### 影响

持久化 Campaign 时必须同时保存状态和可空恢复阶段，并校验二者一致性。后续恢复中心只能提交状态机允许的迁移。

### 可逆性

可逆，但一旦数据库 Schema 持久化该字段，替换模型需要提供迁移并保持旧存档可恢复。

## DEC-005：世界事实以分类联合和替代链记录演进

- 日期：2026-07-30
- 状态：已采纳
- 依据：`docs/spec.md` 第 4.4、7.3 节；`docs/TASKS.md` 的 `M1-T03`

### 背景

世界既包含不可随意推翻的规则，也包含会变化的事实、临时叙述、真假未定的传闻和 NPC 错误认知。将它们存成同一种无分类文本，会让验证器无法决定哪些内容可修改。

### 可选方案

- 使用单一文本表并依赖提示词解释含义。
- 为每类事实建立完全独立且互不兼容的存储模型。
- 使用共享基础字段和判别联合，并让发展事实引用被替代事实。

### 决定与理由

采用判别联合：`LOCKED_RULE`、`DEVELOPING_FACT`、`TEMPORARY_NARRATIVE`、`RUMOR`、`FALSE_BELIEF` 各自携带所需字段。发展事实通过 `supersedesFactId` 追加新记录，保留旧事实；传闻显式保存真实性状态，错误认知显式保存认知者。该方案可验证、可追溯且不依赖模型记忆。

### 影响

后续数据库和状态补丁验证器必须保留事实类别及替代链，不能直接覆盖锁定规则或删除历史事实来表达变化。

### 可逆性

分类命名可通过 Schema 迁移调整；替代链一旦形成应保持可追溯，不应降级为覆盖式更新。

## DEC-006：AI 创作字段与程序规则字段在协议中物理分离

- 日期：2026-07-30
- 状态：已采纳
- 依据：`docs/spec.md` 第 4.2、12、15 节；`docs/TASKS.md` 的 `M1-T06`

### 背景

模型可以创作任务和物品文本，但风险、状态、奖励等级和实际效果必须由程序控制。若名称、描述和规则混在自由 JSON 中，业务层容易错误信任模型给出的数值。

### 可选方案

- 从 AI 名称和描述中解析规则效果。
- 让 AI 返回完整 Item/Quest 并直接使用。
- 将创作文本放入 `content`，规则字段使用封闭枚举和判别联合独立保存。

### 决定与理由

采用物理分离。Rumor、Quest、Item 的玩家可见文本位于 `content`；Quest 状态、风险、预计回合和奖励等级以及 ItemEffect 均为程序字段。相同文本可以对应不同规则效果，程序不得从文本反推效果。

### 影响

后续 AI Schema 只可提出创作内容和受限建议；应用层必须映射并验证程序字段后才能提交 SQLite。

### 可逆性

字段组织可通过 Schema 迁移调整，但“AI文本不能决定规则效果”的边界不可撤销。

## DEC-007：D20领域规则通过接口注入随机源

- 日期：2026-07-30
- 状态：已采纳
- 依据：`docs/spec.md` 第13.4节；`docs/TASKS.md` 的 `M1-T08`

### 背景

骰子必须由本地程序生成，AI不能决定结果；同时领域测试需要完全可重复，未来Windows/iOS可能使用不同安全随机实现。

### 可选方案

- 领域函数内部直接调用 `Math.random()`。
- 将骰面作为普通输入，不区分其来源。
- 注入只提供 `nextD20()` 的随机源接口，由领域层校验骰面并计算结果。

### 决定与理由

采用最小随机源接口。领域层调用接口取得骰面，强制为1至20整数，再计算属性、装备、状态修正和难度结果。测试使用固定源，生产环境后续由原生适配器提供随机实现。该设计可测试且不让AI或UI传入未经区分的最终结果。

### 影响

所有实际掷骰必须通过D20引擎和受信随机源；AI只接收已结算结果。平台随机实现可替换，不改变领域公式。

### 可逆性

随机源实现可随时替换；接口语义和本地结算边界不应撤销。

## DEC-008：关系与世界时钟补丁采用单步原子规则

- 日期：2026-07-30
- 状态：已采纳
- 依据：`docs/spec.md` 第10.2、14、27.2节；`docs/TASKS.md` 的 `M1-T09`

### 背景

规格要求程序限制单回合关系变化和世界时钟推进幅度，但没有给出具体数值。若允许一次补丁跨越多个关系等级或时钟阶段，模型建议可能绕过渐进变化；若逐字段写入后才发现其他字段非法，又会留下部分状态。

### 可选方案

- 仅限制最终关系值与时钟范围，不限制单次幅度。
- 为不同来源或场景配置不同幅度。
- 采用统一最小步长：关系每个维度每回合最多变化1，世界时钟每次推进1，并对补丁执行整体校验。

### 决定与理由

采用统一最小步长。关系补丁中的每个维度只能使用-1、0或1，应用后仍须位于-5至5；世界时钟只能从0至最大值之间前进1格。推进后返回本次跨越的阶段。所有输入先在内存中完整校验，成功时返回新对象，任一规则失败时不改变原对象。

### 影响

后续AI状态补丁验证器和应用用例必须调用这些领域规则，不能直接写关系值或时钟进度。SQLite事务仍在后续持久化与用例任务实现；本决定只定义可提交补丁的领域边界。

### 可逆性

未来如规格明确要求不同幅度，可将上限改为受程序控制的策略参数；原子校验、最终范围和AI不得直接写状态的边界不应撤销。

## DEC-009：GameEvent使用带版本公共信封的判别联合

- 日期：2026-07-30
- 状态：已采纳
- 依据：`docs/spec.md` 第28.3、30节；`docs/TASKS.md` 的 `M1-T10`

### 背景

事件既要写入SQLite，也会进入NDJSON存档。若事件类型和payload分别使用无关联的字符串与通用JSON，编译器无法阻止骰子事件携带任务payload，后续导入和迁移也无法判断协议版本。

### 可选方案

- 使用单一事件接口，payload类型为未知JSON。
- 为每个事件声明完全独立且重复公共字段的接口。
- 使用公共审计信封、按事件类型索引的payload映射和判别联合。

### 决定与理由

采用判别联合。每个事件共享不透明事件ID、CampaignId、SchemaVersion和规范UTC时间；`type`只能取规格事件日志列出的封闭集合，并在类型层唯一决定payload。事件payload保存完成审计所需的实体引用和结果，不承担SQLite写入或状态变更职责。

### 影响

持久化层可以按公共信封建立索引并将payload序列化为JSON；应用层创建事件时必须提供对应类型的精确payload。新增事件类型需要显式扩展映射、测试和兼容策略，不能静默写入任意结构。

### 可逆性

存储形态可在数据库设计阶段调整，但事件类型与payload关联、Schema版本和不透明ID应保持，以支持导入、迁移与审计。

## DEC-010：按规格核心表持久化根实体，受限聚合使用受验证JSON

- 日期：2026-07-30
- 状态：已采纳
- 依据：`docs/spec.md` 第24、28、30节；`docs/TASKS.md` 的 `M2-T01`

### 背景

规格固定列出22张SQLite核心表，而M1协议还包含Faction、Location、Clue、NpcMemory等嵌套对象。为每个嵌套对象增建表会扩大规格表面并增加首版迁移复杂度；把所有内容塞入单一JSON又会失去常用状态、关系和时间查询的数据库约束。

### 可选方案

- 每个协议对象和数组元素都建立独立表。
- 每个Campaign只保存一个完整状态JSON。
- 规格列出的根实体和高频关系使用规范列/外键，边界明确且随父实体加载的受限聚合使用已验证JSON。

### 决定与理由

采用混合模型。Campaign、事实、角色、NPC、关系、任务、冒险、回合、消息、物品、时钟、事件和AI生命周期等核心状态使用独立表和可查询列；Faction/Location、角色背景、线索、NPC记忆等有明确父对象的聚合使用带 `json_valid` 的JSON列，并由Repository按M1协议验证。API Key始终只在安全存储中，数据库仅保存 `credential_ref`。

### 影响

首版迁移必须准确创建规格22张核心表，不额外引入无需求的业务表。JSON内部ID无法由SQLite外键直接约束，因此Repository必须验证同Campaign引用和完整结构；常用筛选字段不得埋入JSON。未来如果某个聚合出现独立查询需求，可通过迁移规范化。

### 可逆性

JSON聚合可通过数据迁移拆分成表，或将低频子表合并回JSON；根实体ID、审计事件、外键边界和秘密不入库原则应保持。

## DEC-011：SQLite迁移按版本记录并在单一事务中应用

- 日期：2026-07-30
- 状态：已采纳
- 依据：`docs/TASKS.md` 的 `M2-T02`；`docs/spec.md` 第28、29节

### 背景

仅在每条DDL上使用 `IF NOT EXISTS` 无法证明数据库处于完整版本：进程可能在迁移中途失败，后续启动又会静默跳过已创建部分。导入、恢复和未来Schema升级都需要知道已完整提交的迁移版本。

### 可选方案

- 每次启动无条件重放所有DDL并忽略“已存在”错误。
- 只使用 `CREATE TABLE IF NOT EXISTS`，不记录版本。
- 使用 `schema_migrations` 记录已成功版本，每个未应用迁移在单一SQLite事务中执行。

### 决定与理由

采用版本表和事务。执行器先启用外键并创建基础设施表 `schema_migrations`；只对未记录版本执行SQL，在DDL全部成功后才于同一事务记录版本。任何语句失败即回滚，版本保持未应用，后续启动可以安全重试。重复启动按版本跳过，不靠吞掉错误实现幂等。

### 影响

每个迁移文件必须有唯一递增版本并保持不可变。迁移测试使用真实SQLite文件验证首次执行、重复启动、表覆盖和代表性约束。Node内置SQLite当前仅承担共享迁移执行与自动测试；平台数据库连接仍由后续原生适配层决定。

### 可逆性

迁移执行器可移植到Rust或平台原生层，但版本表结构、事务提交语义和已发布迁移不可改写原则应保持。

## DEC-012：共享Repository依赖最小SQLite端口

- 日期：2026-07-30
- 状态：已采纳
- 依据：`docs/spec.md` 第18.1、24.1节；`docs/TASKS.md` 的 `M2-T03`

### 背景

Windows和iOS各自拥有本地SQLite，但平台连接方式不同。若共享Repository直接导入Node SQLite、Tauri命令或iOS数据库库，领域持久化逻辑会绑定单一运行时，难以在另一平台复用和进行真实文件测试。

### 可选方案

- Repository直接依赖Node 24 `DatabaseSync`。
- 每个平台各写一套完整Repository。
- Repository只依赖prepare/run/get/all组成的最小同步SQLite端口，由平台或测试提供适配器。

### 决定与理由

采用最小SQLite端口。Repository拥有SQL、行映射和持久化错误语义；连接建立、文件路径和具体驱动由外部适配。当前测试用Node 24内置SQLite做薄适配并执行真实文件重连，不把Node类型泄漏到生产Repository接口。

### 影响

后续Repository复用同一端口；Windows/iOS原生桥只需实现该受限语义或提供等价适配。数据库读取结果一律视为 `unknown`，必须经过运行时验证后才能构造M1品牌类型，不能使用 `any` 或直接断言为领域对象。

### 可逆性

端口可扩展事务或批量能力，也可替换为异步版本；Repository SQL和行校验可迁移，平台隔离边界应保持。

## DEC-013：幂等AI结算以请求状态和游戏补丁同事务提交

- 日期：2026-07-31
- 状态：已采纳
- 依据：`docs/spec.md` 第25、28节；`docs/TASKS.md` 的 `M2-T08`

### 背景

AI请求可能因超时、应用重启或用户重试而以同一逻辑意图重复到达。若奖励和世界状态先提交、pending请求稍后才标记完成，进程在两步之间崩溃会让重试再次发放奖励或推进回合。只依赖内存去重也无法跨重启生效。

### 可选方案

- UI或内存记录最近请求并跳过重复操作。
- 先写游戏状态，再独立更新请求状态。
- 以数据库唯一幂等键定位请求，在同一SQLite事务内提交游戏补丁、GameEvent和 `COMMITTED` 状态。

### 决定与理由

采用数据库事务幂等结算。`idempotency_key` 保持全局唯一；首次结算只允许从 `VALIDATING` 进入 `COMMITTED`，并与完整回合、奖励补丁和事件一起提交。相同幂等键再次结算时，在事务内读取到 `COMMITTED` 后返回 `ALREADY_COMMITTED`，不重复执行任何游戏写入。失败则回滚游戏状态和请求状态。

### 影响

所有会修改游戏事实的AI结果都必须通过该结算边界或语义等价的事务入口，不能先在Repository外单独发放奖励。pending请求的input、context和error只接受受验证JSON，并拒绝API Key、Authorization和令牌类字段。请求状态、错误码和尝试次数由SQLite恢复，不依赖UI状态。

### 可逆性

未来Orchestrator可扩展补丁类型或改用平台原生事务适配，但唯一幂等键、终态短路和请求状态与游戏事实同事务的语义必须保留。

## DEC-014：现有SQLite文件在副本上迁移并保留迁移前原件

- 日期：2026-07-31
- 状态：已采纳
- 依据：`docs/spec.md` 第28.4、32.4节；`docs/TASKS.md` 的 `M2-T09`

### 背景

单个SQLite事务能回滚迁移SQL，却不能覆盖文件损坏、未来Schema误开、进程在文件替换阶段中断或错误迁移逻辑等文件级风险。直接打开玩家原数据库执行迁移，即使最终报错，也可能改动页头、版本表或部分不受事务覆盖的状态，违反保留损坏文件和禁止静默覆盖的要求。

### 可选方案

- 直接在原数据库运行版本迁移，仅依赖SQL事务回滚。
- 迁移前只导出逻辑JSON，失败时尝试重新导入。
- 启动时复制关闭的数据库文件，在工作副本上检查版本、执行迁移和完整性检查；全部成功后保留原件并切换副本。

### 决定与理由

采用写时复制迁移。现有数据库若存在rollback journal、WAL或SHM侧文件则拒绝迁移并提示仍在使用；否则复制到唯一工作文件，只在副本上运行版本兼容检查、迁移和 `PRAGMA integrity_check`。成功后将原文件重命名为唯一的pre-migration副本，再把工作文件切换到正式路径；失败则删除工作文件并报告错误，原文件字节不变。

### 影响

启动调用方必须在数据库连接关闭后执行 `prepareDatabaseFile`，并根据READY、MIGRATED或FAILED结果显示明确状态。高版本、迁移历史断裂、完整性失败、活动侧文件和文件切换失败均有稳定错误码。pre-migration副本当前不做轮换或自动恢复；完整备份保留策略仍由M7-T05实现。

### 可逆性

平台层可将文件复制/切换替换为Rust或iOS原生原子文件API，但副本验证、成功后切换、失败保留原件和不静默覆盖的语义必须保持。

## DEC-015：业务AI边界只使用规范化协议

- 日期：2026-07-31
- 状态：已采纳
- 依据：`docs/spec.md` 第22、23节；`docs/TASKS.md` 的 `M3-T01`

### 背景

项目需要支持云端原生Provider、OpenAI-Compatible服务和本地模型。若业务层直接引用任一厂商SDK的消息、响应、错误或模型类型，切换Provider会把厂商差异扩散到上下文、任务编排和游戏状态逻辑，也会让本地Fake Provider无法完整替代真实服务。

### 可选方案

- 业务层直接使用首个接入厂商的SDK类型。
- 为每个业务任务分别定义一套Provider专用接口。
- 在ai-core定义唯一规范化请求、响应、配置、模型与能力协议，厂商适配器只在边界转换。

### 决定与理由

采用统一规范化协议。业务层只依赖 `AIProvider`、`NormalizedAIRequest`、`NormalizedAIResponse`、`ProviderConfig`、`ModelInfo` 和 `ModelCapabilities`；Provider实现负责把规范消息、响应格式、结束原因和用量转换为厂商调用。配置只暴露安全存储引用 `credentialRef`，不包含API Key字段。

### 影响

任务、Prompt、Orchestrator和游戏流程不得导入厂商SDK类型。模型能力包含检测时间和UNKNOWN/FREE/PAID动态状态，不能把免费状态永久硬编码。新增Provider只能扩展适配层；本地Fake Provider必须实现同一接口。任务Schema和Prompt版本仍由后续任务独立定义。

### 可逆性

规范化字段可按版本兼容扩展；若未来需要流式事件接口，可在ai-core增加标准事件协议，但厂商类型不得越过适配层。

## DEC-016：AI任务按任务名独立版本化，结构验证与领域验证分层

- 日期：2026-07-31
- 状态：已采纳
- 依据：`docs/spec.md` 第22.2、27节；`docs/TASKS.md` 的 `M3-T02`

### 背景

15类AI任务的输入输出结构差异很大。如果共用一个宽松JSON Schema，缺字段、额外字段和错误枚举会延迟到业务提交阶段才暴露；若把世界锁定、奖励等级和关系变化等领域规则全部塞进Zod，又会把当前SQLite状态依赖带入纯结构解析。

### 可选方案

- 所有任务共用一个任意JSON输入输出。
- 每类任务独立Schema，但不记录版本。
- 每类任务拥有独立严格Zod输入/输出Schema和版本；结构解析通过后再进入领域补丁验证。

### 决定与理由

采用独立版本化Schema。`AI_TASK_SCHEMAS` 对15个AITask逐项注册不同的input、output和 `schemaVersion: 1`；所有对象默认严格拒绝未知字段，并约束必填字段、枚举、长度、元组和基础数值范围。Zod只证明输出结构可解释，不证明其可修改当前游戏；锁定规则、同Campaign引用、关系单步变化和奖励合法性由M3-T07结合SQLite事实验证。

### 影响

Prompt、Fake Provider、输出解析和GenerationRecord必须按任务读取同一Schema定义及版本。修改既有任务的不兼容结构必须递增该任务Schema版本，不能静默改写版本1。通过Schema的状态补丁仍不得直接提交。

### 可逆性

任务可在未来拆分或新增版本，并通过迁移/兼容解析保留旧GenerationRecord；结构与领域验证分层原则应保持。

## DEC-017：Prompt集中注册并按模型能力降级格式

- 日期：2026-07-31
- 状态：已采纳
- 依据：`docs/spec.md` 第20.2、22.1至22.3节；`docs/TASKS.md` 的 `M3-T03`

### 背景

页面、Use Case或Repository中散落提示词会让同一任务出现不同规则和版本，也难以记录GenerationRecord实际使用的Prompt。模型对system消息、JSON Schema和JSON Mode的支持不同，若业务层自行拼接格式，会再次把Provider差异扩散到游戏逻辑。

### 可选方案

- 每个页面在调用模型前直接拼接提示词。
- 每个Provider维护一套完整任务提示词。
- 在prompts package集中Base规则、任务指令和版本历史，再按动态模型能力生成规范消息与响应格式。

### 决定与理由

采用集中目录与能力降级。15类任务各有当前Prompt定义、逻辑角色、输出Schema名和PromptVersion；独立的append-only历史基线保留旧版本记录。格式层先用任务Zod Schema验证输入，再组合Base规则与任务指令；支持system消息时拆分SYSTEM/USER，不支持时合并到USER；响应格式按JSON Schema、JSON Mode、TEXT顺序降级。

### 影响

UI、application和Repository不得保存Prompt正文或自行格式化Provider消息。Prompt更新必须新增历史条目并递增版本；不能用当前版本动态覆盖旧历史。能力降级只改变传输格式，不改变任务Schema、规则权限或“AI只提出状态补丁”的边界。

### 可逆性

Prompt文本和策略可以按版本演进，格式层也可新增流式或工具调用标准；集中注册、历史保留和业务层不散落提示词原则应保持。

## DEC-018：AI状态补丁按本地事实顺序验证，奖励授权与效果由程序控制

- 日期：2026-07-31
- 状态：已采纳
- 依据：`docs/spec.md` 第2.2、8.7、10.2、21、27节；`docs/TASKS.md` 的 `M3-T07`

### 背景

结构Schema只能证明补丁JSON形状可解释，不能证明任务状态可达、NPC关系变化幅度合法、奖励与任务等级匹配、事实没有覆盖锁定规则或世界时钟只推进一步。若把结构通过的payload直接转换成Repository写入，模型即可绕过本地规则；若只在每个补丁上孤立验证，同一次输出中“先完成任务、再发放奖励”这类有顺序依赖的合法组合也无法表达。

### 可选方案

- 结构Schema通过后直接把payload交给Repository或事务层。
- 每个补丁独立验证，不考虑同一批次前序补丁造成的本地状态变化。
- 从SQLite恢复当前事实快照，在内存副本上按补丁顺序应用白名单规则，全部通过后才产出不可直接写库的已验证领域补丁。

### 决定与理由

采用顺序式本地事实验证。验证器只接受QUEST、RELATIONSHIP、ITEM_REWARD、FACT和CLOCK白名单；未知类型及属性修改显式拒绝。任务状态按固定迁移表前进，关系复用单回合绝对变化不超过1且结果保持-5至5的规则，时钟复用每次只推进1的规则。事实补丁不得指定已有target，也不得创建LOCKED_RULE，当前只接受追加式DEVELOPING_FACT。

物品奖励必须引用同批次当前视图中已完成的任务，并存在本地 `RewardAuthorization`；奖励等级不得高于任务等级。物品效果不接受AI字段，而由授权中的程序控制 `ItemEffect` 提供。验证器的输出仍是已验证提案，ID分配、时间戳和SQLite事务写入由后续Orchestrator/持久化边界完成。

### 影响

M3-T08必须先完成结构验证，再以SQLite恢复的Quest、Relationship、WorldBible和WorldClock以及本地奖励授权调用领域验证器；任何一个补丁失败时整批不得提交。调用方不能把AI给出的属性、物品效果、锁定事实target或越级奖励转换成写库命令。若未来支持Rumor、TemporaryNarrative或FalseBelief补丁，必须为各自专属字段增加显式白名单和归属验证，不能放宽为任意JSON。

### 可逆性

任务迁移表、奖励授权策略和允许的追加事实类别可通过新增显式规则扩展；“从本地事实验证、整批通过后再提交、程序控制数值和效果”的边界不可绕过。

## DEC-019：AI回合编排以pending状态机为主线，验证完成后才进入幂等事务

- 日期：2026-07-31
- 状态：已采纳
- 依据：`docs/spec.md` 第2.2、25、27、32节；`docs/TASKS.md` 的 `M3-T08`

### 背景

一次AI回合跨越上下文读取、Provider调用、原始响应留存、结构验证、领域验证和多表SQLite提交。若这些步骤由页面或各Use Case自行拼接，失败时pending状态、generation记录与游戏事实可能互相矛盾；若在验证前写入回合或奖励，错误输出会污染唯一事实源；若重试不复用幂等键，又会重复事件和奖励。

### 可选方案

- 页面依次调用Repository、Provider和验证函数。
- Provider成功后先写回合，再异步补写审计记录和状态。
- 由单一Orchestrator驱动pending状态机，分阶段持久化请求/响应，在结构和领域验证全部通过后调用现有幂等事务入口。

### 决定与理由

采用单一回合编排器。执行顺序固定为：创建或复用pending请求、从SQLite快照构建最小上下文、按模型能力格式化Prompt、创建GenerationRecord、进入SENDING并调用统一Provider、记录RECEIVED/VALIDATING、保存结构或领域验证结果，最后以pending幂等键调用 `commitTurnOnce`。COMMITTED请求直接返回 `ALREADY_COMMITTED`，不再构建上下文、调用模型或写入状态。

Provider传输失败允许raw_response_text为空；收到内容后必须原样留存。持久化错误只使用稳定阶段code和通用消息，不直接保存异常对象或可能包含凭据/服务响应的异常文本。GenerationRecord证明输出是否通过验证，pending请求证明工作流状态；二者不能替代SQLite事务作为游戏事实提交边界。

### 影响

后续M4回合类Use Case只向Orchestrator提供任务输入、上下文构建函数以及“领域验证后构造TurnCommit”的函数，不得在页面重复编排。结构失败、领域失败和提交失败都把pending置为FAILED，且在commit成功前不产生部分游戏事实。当前重试/修复策略仍由M7扩展；不得在本阶段绕过状态机自动重发。

### 可逆性

可扩展非回合生成编排、修复尝试和错误分类，但固定阶段顺序、原始响应留存、双层验证、幂等提交和敏感异常不入库原则必须保留。

## DEC-020：车卡草稿不作为游戏事实，完整角色与初始装备原子落库

- 日期：2026-07-31
- 状态：已采纳
- 依据：`docs/spec.md` 第2.2、8、20、27节；`docs/TASKS.md` 的 `M4-T02`

### 背景

规格要求玩家先填写基础车卡、由AI生成6个候选特质并选择2个，再由AI补全背景和装备叙事。现有 `PlayerCharacter` 与SQLite表表达的是完整角色，特质固定为2个且背景非空；为中间步骤写入空背景、假特质或占位装备会把无效数据伪装成游戏事实，也违反禁止伪实现的规则。

### 决定与理由

CreateCharacter只产生经过本地规则验证的瞬时 `CharacterDraft`，不写入游戏状态。GENERATE_CHARACTER_TRAITS输出Schema和Prompt升级到版本2，严格返回6个候选；玩家选择的2个特质随COMPLETE_CHARACTER_BACKGROUND输入再次验证。背景任务的版本2输出同时包含1至4件装备的名称和描述。

完整输出通过结构验证后，程序分配特质/物品ID、BASIC奖励等级和机械效果。首件装备按固定职业原型获得对应主属性的+1检定修正，其余初始装备为叙事物品；AI不能指定数值效果。完整角色、装备归属、Campaign的GENERATING_TAVERN状态和pending的COMMITTED状态在同一SQLite事务提交。

### 影响

未完成的表单不是可恢复游戏事实；只有完成背景步骤后才产生PlayerCharacter并推进状态。客户端若要保留未提交表单，应使用普通界面状态，不得把半成品写入游戏表。GenerationRecord与pending仍保留每次AI候选和背景请求，已提交请求可幂等重放。

### 可逆性

未来若产品明确要求跨重启恢复车卡草稿，可新增有独立语义和迁移的草稿模型；不得放宽完整PlayerCharacter约束或用空值占位。初始装备规则可以在程序控制下版本化，但AI只提供叙事内容的边界保持不变。

## DEC-021：初始传闻使用WorldFact，任务入口与Quest创建分阶段

- 日期：2026-07-31
- 状态：已采纳
- 依据：`docs/spec.md` 第9至12、20、27节；`docs/TASKS.md` 的 `M4-T03`、`M4-T05`

### 背景

M4-T03要求酒馆初始化包含传闻和任务入口，而M4-T05才负责GenerateQuest与AcceptQuest。若初始化阶段直接创建Quest，会提前执行后续任务；若只把传闻留在AI审计记录，SQLite游戏事实又无法在重启后恢复。领域模型已将真假未定信息定义为RUMOR WorldFact。

### 决定与理由

GenerateNpcs的Schema与Prompt升级到版本2，与2名普通常驻和1名访客一起生成恰好3条具名来源、隐藏真实性的传闻。程序验证人数、居留类型、姓名唯一性、访客原因和传闻来源后，为传闻分配WorldFactId并作为RUMOR写入SQLite；来源NPC的初始认知只包含自己发布的传闻。

本任务的“任务入口”由老板和2名ACTIVE常驻NPC的持久化ID表示，它们可供后续GenerateQuest选择为发布者。本阶段不创建Quest行；实际两个AVAILABLE任务和单主任务约束仍完整保留给M4-T05。

### 影响

酒馆初始化完成后，Tavern可恢复3名常驻NPC（含老板）、1名访客、关系、有限认知和3条传闻。页面不得从GenerationRecord直接读取传闻作为事实，也不得在M4-T05前假设Quest已存在。

### 可逆性

未来可为传闻增加独立展示投影或查询Repository，也可扩展任务发布者选择规则；RUMOR的权威记录仍来自WorldFact，Quest创建任务边界不应回退。

## DEC-022：主任务接受在SQLite写事务内串行判定

- 日期：2026-07-31
- 状态：已采纳
- 依据：`docs/spec.md` 第12.2、20、27节；`docs/TASKS.md` 的 `M4-T05`

### 背景

规格要求同一时间只有一个主冒险进行。若应用层先查询当前任务、再单独更新目标任务，两个并发接受操作都可能看到“没有进行中任务”并同时成功。AI生成结果也不能直接决定任务已接受或激活。

### 决定与理由

GenerateQuest只创建AVAILABLE任务，并验证发布者、关联NPC、关联世界事实和8至12回合范围。AcceptQuest使用 `BEGIN IMMEDIATE` 获取SQLite写锁，在同一事务内确认目标仍为AVAILABLE、当前存档不存在ACCEPTED或ACTIVE任务，再条件更新为ACCEPTED。任何条件失败均回滚且保留其他任务状态。

### 影响

UI不能通过直接更新Quest绕过接受用例。StartAdventure必须只从ACCEPTED任务开始，并在自己的事务中把它推进为ACTIVE。数据库索引支持按campaign/status检查，最终游戏事实仍由SQLite决定。

### 可逆性

未来可用部分唯一索引进一步强化约束，或支持显式支线任务类型；在模型增加相应字段和迁移前，单主任务串行接受规则保持不变。

## DEC-023：冒险隐藏骨架只通过受限公开投影离开应用层

- 日期：2026-07-31
- 状态：已采纳
- 依据：`docs/spec.md` 第13.2、20、26.2节；`docs/TASKS.md` 的 `M4-T06`

### 背景

冒险计划必须完整保存在本地以约束后续回合，但玩家不能直接看到核心场景、必要线索、阻碍和可能结局。若GenerateAdventurePlan直接返回Adventure实体，UI即使无意也能读取隐藏字段；若不保存计划，后续模型回合又无法保持一致。

### 决定与理由

GenerateAdventurePlan将完整AdventurePlan和Clue写入SQLite，状态为PREPARING；本地验证风险和回合范围与已接受任务一致，至少包含3条核心线索和2个结局。应用层对调用方只返回 `AdventureStartState`，包含adventureId、questId、state与currentTurnNumber，不暴露plan或clues。

StartAdventure在SQLite写事务内把Adventure从PREPARING推进到SCENE、Quest从ACCEPTED推进到ACTIVE、Campaign从TAVERN推进到ADVENTURE。后续冒险上下文构建器可以在应用内部读取隐藏骨架，但页面不得直接访问AdventureRepository。

### 影响

隐藏并不依赖UI自律，而由用例返回类型形成边界。调试、导出和存档仍可保存完整事实，但玩家展示层必须使用公开投影。任何计划生成失败都不会推进Quest或Campaign。

### 可逆性

公开投影可增加不泄密的进度字段；计划结构可版本化扩展。完整计划只在受信应用内部读取的原则保持不变。

## DEC-024：冒险回合分阶段持久化，本地骰点结果不可被模型覆盖

- 日期：2026-07-31
- 状态：已采纳
- 依据：`docs/spec.md` 第14、15、20、27节；`docs/TASKS.md` 的 `M4-T07`

### 背景

冒险回合需要先接受玩家行动，再由模型判断是否需要检定；若需要检定，D20必须由本地程序生成，随后模型只能根据固定结果叙述后果。Provider调用可能失败或重试，若把行动、检定请求、骰点与叙事只保存在内存，重启会丢失进度；若把骰点交给模型或允许后续响应改写，则本地规则不再具有权威性。

### 决定与理由

SubmitPlayerAction先以连续回合号持久化玩家行动并把冒险置为WAITING_FOR_PLAYER。GENERATE_ADVENTURE_TURN经过结构验证、NPC/线索引用验证和领域补丁验证后，决定进入CHECK_REQUIRED或通过RESOLVING完成至SCENE/ENDING。线索发现只能引用隐藏计划中已有Clue的标题，程序写入discoveredInTurnId，模型不能创建计划外核心线索。

RollCheck从SQLite读取玩家属性和已持有装备效果，调用本地D20规则，生成包含原始骰面、各项修正、总值、难度和成败的DiceResult，并与DICE_ROLLED事件原子写入后进入RESOLVING。RESOLVE_DICE_RESULT只接收该不可变结果并生成叙事与经验证补丁；最终事务更新回合内容但保留DiceResult。奖励和世界时钟补丁不在普通回合提交，留给M4-T08结算。

### 影响

Provider失败时已提交的玩家行动仍可从SQLite恢复并重试；检定完成后即使Provider切换或叙事重试，骰面与成败也不会变化。无检定和检定路径都遵守Adventure状态机，页面不得自行生成骰点或直接更新回合状态。回合产生的世界事实使用程序分配ID，AI建议仍需通过统一状态补丁验证。

### 可逆性

未来可以增加重掷授权、消耗品或更细的状态修正来源，但必须通过显式本地规则生成新的审计事件，不能覆盖既有DiceResult。线索匹配可演进为稳定引用ID，但模型不能绕过隐藏计划或直接写发现状态。

## DEC-025：结算生成先形成验证草案，所有游戏事实由单一事务落库

- 日期：2026-07-31
- 状态：已采纳
- 依据：`docs/spec.md` 第14至16、20至22、27节；`docs/TASKS.md` 的 `M4-T08`

### 背景

冒险结算同时影响任务、NPC、酒馆、奖励、世界事实、世界时钟、冒险档案、事件和Campaign状态，并需要两个AI任务分别生成摘要与世界事件。如果任一生成完成后立即写入部分实体，第二次生成失败、程序退出或业务验证失败都会留下“已推进时钟但尚未结算”之类的不一致状态。既有22表数据模型没有独立档案表，但adventures.ending_json可保存结构化结局索引，其他明细已有权威表和来源关系。

### 决定与理由

SUMMARIZE_ADVENTURE和GENERATE_WORLD_EVENT只保存原始响应、结构验证结果并让pending停留在VALIDATING，不直接修改游戏事实。FinishAdventure从SQLite读取两条GenerationRecord，把任务、关系、奖励、事实和时钟建议组成单一补丁序列，以当前Quest、Relationship、WorldBible、WorldClock和本地RewardAuthorization整批验证。Outcome由本地调用方选择；奖励效果由注入的本地策略提供，AI只能建议叙事内容和不超过任务等级的奖励级别。

验证通过后，AdventureSettlementRepository用BEGIN IMMEDIATE一次提交NPC心情/关系、TavernChange、奖励及归属、WorldFact、WorldClock、Quest、AdventureEnding、审计事件、两条pending COMMITTED以及Campaign ADVENTURE→SETTLEMENT→TAVERN。AdventureEnding的ending_json保存摘要、关键选择、未决方向、未发现线索和相关实体ID，并引用摘要/世界事件GenerationRecord；档案查询从这些SQLite事实重新组装回合、骰子、参与NPC、物品、世界变化与模型/Prompt版本，不新增重复档案表。

### 影响

结算前可以安全重试生成而不产生部分游戏变化；结算成功后重复Finish只返回同一档案。任务结果必须与本地Outcome一致，关系每维最多变化1，时钟每次最多推进1，失败结局不能生成奖励。所有关联ID由程序分配或验证，AI不能覆盖既有事实、指定装备效果或越权引用NPC/时钟。

### 可逆性

未来若档案查询量或跨版本导出需要独立物化表，可从AdventureEnding引用和现有事实表迁移生成，而不改变其权威来源。结算步骤可增加新的显式本地补丁种类，但“先完整验证、后单事务提交、生成记录不等于游戏事实”的边界必须保持。

## DEC-026：重生成以Campaign逻辑快照替换有效状态，AI审计独立保留

- 日期：2026-07-31
- 状态：已采纳
- 依据：`docs/spec.md` 第13.6、23、28节；`docs/TASKS.md` 的 `M4-T09`

### 背景

冒险回合的AI输出可能同时改变回合叙事、线索、任务、关系、世界事实和事件。只覆盖AdventureTurn会让旧补丁继续生效；删除AI审计记录又会破坏问题追踪和规则模式重生成计数。Provider调用位于SQLite事务之外，重生成失败时还必须恢复原先可玩的状态。

### 决定与理由

玩家行动持久化后、首次AI解析前创建Campaign级TURN_INPUT AUTO逻辑快照。快照包含Campaign及其游戏状态表，不包含全局Provider配置、密钥、GenerationRecord或save_snapshots自身；序列化使用规范JSON与UTF-8 BLOB，保存并在恢复前验证SHA-256。恢复通过BEGIN IMMEDIATE事务按外键顺序替换Campaign游戏状态，保留仍指向恢复后回合的pending请求审计。

重生成先根据SQLite中的model_switch_policy、已提交请求次数和显式披露确认校验权限，再创建当前状态安全快照、恢复TURN_INPUT基线，并重新进入既有统一Provider、Schema验证、领域验证和事务提交链。任何生成失败都恢复安全快照；成功结果从同一基线重建，因此旧补丁和新补丁不会同时成为有效游戏事实。跨厂商切换始终需要接受上下文发送披露，并写入MODEL_SWITCHED事件。AUTO快照每个Campaign保留最近10个。

### 影响

GenerationRecord可同时保留旧、新响应作为审计，但它们不直接决定游戏状态；当前有效结果只能从恢复后再次提交的SQLite游戏表读取。规则模式的最大重生成次数由调用方明确提供，已使用次数从SQLite的COMMITTED回合请求计算。页面不得自行拼接旧、新输出，也不得绕过切换批准与披露检查。

### 可逆性

后续可把逻辑快照替换为原生SQLite备份或版本化增量快照，只要保持校验、Campaign隔离、事务恢复、审计独立和失败回滚语义。规则模式上限可在设置模型确定后迁入SQLite配置，不改变现有计数与拒绝边界。

## DEC-027：Windows入口使用HashRouter与最小Tauri capability

- 日期：2026-07-31
- 状态：已采纳
- 依据：`docs/spec.md` 第17至19、31节；`docs/TASKS.md` 的 `M5-T01`

### 背景

Windows客户端需要同时支持Vite开发服务器和Tauri打包后的本地静态资源。Browser history路由在没有服务端回退规则的本地包中刷新深层路径可能失败。Tauri 2 capability如果在骨架阶段授予过多权限，也会提前形成任意文件、网络或原生命令边界。

### 决定与理由

Windows前端使用HashRouter，M5-T01只注册启动入口和not-found回退；M5-T02再在同一路由边界增加导航目标。启动页直接运行共享contracts的schemaVersion函数，形成共享包访问的可执行验收，而不是只依赖静态依赖声明。

Tauri只创建main窗口并授予 `core:default`，不注册业务命令或文件、HTTP、SQL、密钥权限。Windows图标保留SVG源，并用Tauri官方工具生成ICO；Tauri自动生成的schema与Vite dist作为可再生构建输出忽略，手写配置和capability继续经过格式与lint检查。

### 影响

所有前端路由URL带hash，但不依赖外部Web服务器即可恢复。页面不能直接访问任意原生资源；后续命令必须在对应任务中按规格第31节逐项增加。Windows src-tauri作为根Cargo workspace真实成员参与fmt、Clippy和test。

### 可逆性

若未来Tauri自定义协议提供可靠history回退，可在路由测试覆盖后迁移BrowserRouter。Capability可按高层命令逐项扩展，但禁止一次性授予宽泛文件或网络权限。

## DEC-028：Windows存档首页通过受限原生命令访问平台SQLite

- 日期：2026-07-31
- 状态：已采纳
- 依据：`docs/spec.md` 第4.1、18、20、24、31节；`docs/TASKS.md` 的 `M5-T03`；`DEC-012`

### 背景

存档首页必须在应用重启后列出本地存档，而Windows数据库应位于系统应用数据目录。共享TypeScript Repository依赖最小SQLite端口，但Tauri WebView不能获得任意SQL、任意文件路径或宽泛数据库能力；把SQLite连接或原始查询接口直接暴露给页面会破坏分层和原生安全边界。

### 决定与理由

Windows Tauri启动时由Rust解析应用数据目录并打开固定文件 `ember-tavern.sqlite`，原生桥执行与共享持久化层相同的 `0001_initial.sql` 和 `schema_migrations` 版本语义。WebView仅能调用 `campaign_list`、`campaign_create`、`campaign_continue`、`campaign_archive` 四个固定高层命令，不能传入SQL、数据库路径或时间；ID和规范UTC时间由原生程序生成。

原生命令只返回存档摘要，Rust先校验ID、状态、时间和Schema版本，TypeScript网关再把跨进程的 `unknown` 响应逐字段验证。继续存档只更新SQLite中的 `updated_at` 作为最后游玩时间；归档保留数据库行并设为 `ARCHIVED`，活动列表不再显示。页面每次启动和变更后重新从SQLite查询，不把存档事实持久化到Zustand或浏览器存储。

### 影响

SQLite仍是存档唯一真实数据源，应用关闭、WebView重建或模型不可用都不会影响存档列表。后续Windows页面应继续通过稳定用例或同等受限的原生命令访问游戏数据，不得扩展为通用SQL桥。共享迁移SQL是两种执行器的共同Schema来源；新增迁移时必须同步验证Node和Rust启动路径。

### 可逆性

未来可在保持命令语义与测试的前提下，把Rust实现替换为能够承载共享Repository端口的适配机制；数据库路径所有权、未知响应验证和不暴露任意SQL的边界不得撤销。

## DEC-029：Windows世界生成分离统一Provider执行与原子原生提交

- 日期：2026-07-31
- 状态：已采纳
- 依据：`docs/spec.md` 第4、7、18、20、24、25、31节；`docs/TASKS.md` 的 `M5-T04`；`DEC-012`、`DEC-028`

### 背景

现有 `WorldCreationUseCases` 使用同步最小SQLite端口并已在Node真实数据库中验收，但Tauri WebView不能直接打开Windows应用数据目录中的SQLite，也不能获得通用SQL命令。把Fake输出写死在Rust会绕过统一AI适配层；把AI草稿直接交给数据库又会让未经业务验证的数据成为游戏事实。

### 决定与理由

Windows世界创建服务在TypeScript侧继续使用共享 `FakeAIProvider`、Prompt目录、任务Schema和 `validateAIOutput`。页面只调用稳定服务，不直接拼接Prompt、调用Tauri命令或写数据库。成功输出连同规范请求、原始响应和结构验证结果交给固定语义的 `world_generation_commit`；原生层不执行模型生成。

Rust提交层把跨进程输入视为不可信数据：拒绝未知字段，重新校验文本范围、势力和地点引用、Campaign阶段、幂等键、Prompt版本、锁定字段，并要求 `validatedOutput` 中的世界与待提交世界逐字段相等。通过后，WorldBible、Campaign状态、GenerationRecord和已提交pending请求在一个 `BEGIN IMMEDIATE` 事务中写入。手动更新、世界读取和确认分别使用受限命令，不开放SQL或数据库路径。

### 影响

模型仍是可替换内容生成器，SQLite仍是唯一游戏事实源。Fake Provider执行或Schema验证失败时不会修改正式世界；跨语言载荷即使被篡改，也不能改变锁定字段或提交与验证结果不同的世界。Windows原生桥承担平台连接和最终事务防线，页面刷新后只能从SQLite恢复预览。

### 可逆性

未来可让共享用例直接运行在支持异步平台端口的宿主中，或把固定命令实现替换为其他受限适配；统一Provider/Prompt/Schema、原生最终校验、事务提交和不暴露通用SQL的边界必须保持。

## DEC-030：初始世界时钟由已验证事实映射并隐藏传闻真实性

- 日期：2026-07-31
- 状态：已采纳
- 依据：`docs/spec.md` 第9、11、14、25、31节；`docs/TASKS.md` 的 `M5-T06`；`DEC-008`、`DEC-029`

### 背景

规格要求初始酒馆展示约三个世界时钟，并要求玩家不能直接看到传闻真实性。现有 `GENERATE_TAVERN` 与 `GENERATE_NPCS` Schema覆盖酒馆、NPC和传闻，但没有世界时钟字段；为M5-T06扩展既有AI任务会改变已经验收的M3 Prompt/Schema协议，也会让模型决定本应由程序约束的时钟范围和阶段。

### 决定与理由

完成初始NPC阵容的同一原生事务中，程序从已经过Schema及业务验证并持久化的世界核心冲突、酒馆长期问题和第一条剧情线索建立三个初始世界时钟。每个时钟从0/6开始，阈值固定为2、4、6；中间阶段引用对应已验证事实，最大值、当前值和未来单步推进仍由程序控制。该映射不新增AI请求或修改现有生成协议。

传闻真实性继续写入 `world_facts.detail_json`，供规则、NPC有限认知和后续冒险使用；酒馆读取快照只返回传闻ID、陈述和来源NPC ID，不序列化真实性。页面无法通过普通酒馆命令读取该隐藏事实。

### 影响

酒馆完成初始化时，SQLite同时拥有可展示、可被后续规则推进的三个时钟；模型不能直接指定当前值、最大值或任意推进。初始页面能注明传闻来源但不会泄露TRUE、PARTIAL、FALSE或UNKNOWN。所有实体、时钟和Campaign状态仍在第二阶段单一事务提交，失败不会留下部分阵容或部分时钟。

### 可逆性

若未来规格新增独立且版本化的世界时钟生成任务，可用其经过验证的名称与阶段替换事实映射；程序拥有最大值、初值、推进和事务提交的边界不得撤销。若传闻展示策略变化，应通过新的受限视图明确授权，不能直接暴露完整 `detail_json`。

## DEC-031：模型HTTP只通过Rust审批端点边界执行

- 日期：2026-08-01
- 状态：已采纳
- 依据：`docs/spec.md` 第22、31节；`docs/TASKS.md` 的 `M6-T01`；`DEC-027`

### 背景

真实Provider需要请求、取消、超时和流式响应，但若WebView获得通用HTTP命令或任意URL参数，页面脚本就能绕过Provider配置、密钥边界和审计。HTTP重定向、相对路径逃逸及无限响应也可能把已批准请求带到其他主机或耗尽本地资源。

### 决定与理由

新增不注册Tauri命令的Rust crate `ember-secure-http`。调用者必须先构造审批基地址：远程只允许HTTPS，明文HTTP只允许localhost或回环IP以支持本地Provider和合同测试；基地址不得包含凭证、查询或片段，并必须以斜杠结束。请求只接受不能绝对跳转或包含上级段的相对路径，Reqwest客户端禁用重定向。

传输层以总截止时间同时约束建连与完整流读取，并在请求和读取阶段监听CancellationToken；响应逐块交付且受每请求与16 MiB全局上限约束。错误转换为不携带原始URL、Header、正文或底层异常的稳定分类。敏感Header始终标记敏感，请求Debug仅显示正文长度。

### 影响

后续Provider可以复用HTTPS、流式与标准错误能力，但不能借此向WebView开放任意网络。OpenAI兼容自定义地址仍须先通过同一端点策略；本地Ollama可使用回环HTTP。当前Tauri capability保持`core:default`，没有模型HTTP命令，也没有真实API调用。

### 可逆性

可在不改变调用语义的前提下替换Reqwest或TLS实现，也可增加经过独立验证的请求方法与错误元数据。远程HTTPS、禁重定向、相对路径约束、资源上限、脱敏错误和不向WebView暴露通用HTTP的边界不得撤销。

## DEC-032：Windows模型密钥使用系统凭据与不透明引用

- 日期：2026-08-01
- 状态：已采纳
- 依据：`docs/spec.md` 第30、31节；`docs/TASKS.md` 的 `M6-T02`；`DEC-006`、`DEC-027`

### 背景

Provider配置需要长期关联API Key，但SQLite、普通配置、日志、测试fixture和导出均不得保存明文。直接调用Win32 Credential API需要unsafe代码，与workspace的`unsafe_code = "forbid"`冲突；向WebView提供读取命令又会破坏原生安全边界。

### 决定与理由

Windows通过安全Rust封装`keyring-core`与`windows-native-keyring-store`使用系统Credential Manager，并明确选择Local持久化。保存时由Rust生成`credential:v1:<UUID>`，调用者不能指定系统目标名；SQLite只可保存该引用。秘密限制为1至2048字节并拒绝NUL，所有应用拥有的临时String或字节副本在使用后清零。

WebView只开放规格允许的`secret_save`、`secret_exists`和`secret_delete`，不开放明文读取。可信Rust Provider只能通过`with_secret`闭包在一次调用期间借用秘密字节。系统错误归一化，不能进入日志或跨进程响应；删除为幂等操作。

### 影响

密钥不进入SQLite、普通JSON、导出或生成审计，Provider配置仅携带可验证的不透明引用。Windows系统存储可独立于存档生命周期管理；删除存档不会误删全局Provider凭据，配置删除流程必须显式调用密钥删除。当前未实现iOS存储，非Windows返回Unavailable。

### 可逆性

iOS阶段可在相同`SecretStore`语义下加入Keychain后端，或在保持引用格式与迁移策略的前提下替换Windows安全存储实现。不得新增明文读取命令、把秘密复制到SQLite/导出/日志，或允许页面指定任意系统凭据目标。

## DEC-033：OpenAI兼容协议在Rust边界归一化且能力不静默冒充

- 日期：2026-08-01
- 状态：已采纳
- 依据：`docs/spec.md` 第22、30、31节；`docs/TASKS.md` 的 `M6-T03`；`DEC-031`、`DEC-032`

### 背景

OpenAI兼容服务共享大体相同的models与chat completions协议，但响应字段、错误状态和可用能力并不完全一致。若页面直接拼请求，或适配器把未实现的JSON Schema静默降级为JSON Object，业务层会误判能力并可能接受不符合任务Schema的输出。

### 决定与理由

通用适配器放在Rust中，只组合审批端点、安全传输和系统凭据。它把规范角色、文本/JSON Object格式、温度与输出上限映射为OpenAI兼容JSON，并把模型、内容、结束原因、用量和接收时间还原为规范响应。模型列表只返回服务实际报告的标识与owner，不臆测上下文窗口、价格或高级能力。

JSON Schema在当前任务显式返回Unsupported；后续只有预设或动态能力确认支持时才能启用。HTTP、解析和密钥错误归一化为稳定ProviderError，不携带底层异常或响应正文。连接测试复用模型列表，不发送生成请求。

### 影响

Provider合同可完全通过本地服务器验证，真实厂商预设只需提供经过校验的配置与能力，不复制协议实现。业务AI输出仍须经过既有任务Schema和领域验证；Provider成功不等于游戏状态可提交。WebView尚未获得通用Provider命令。

### 可逆性

未来可增加Responses API、流式Provider事件、JSON Schema或兼容服务的字段变体，但必须通过显式能力和合同测试。不得绕过审批端点/系统密钥、把未知响应直接交给游戏状态，或用静默降级宣称未验证能力。

## DEC-034：模型目录与默认选择是全局设置，不改写游戏事实

- 日期：2026-08-01
- 状态：已采纳
- 依据：`docs/spec.md` 第23、24、30、31节；`docs/TASKS.md` 的 `M6-T09`；`DEC-031`至`DEC-033`

### 背景

Provider与模型档案需要跨存档复用，但设置页切换默认或备用模型不能改变已有世界、角色、NPC、任务或冒险事实。密钥又必须独立于SQLite保存，并且页面不能读取明文。

### 决定与理由

Provider元数据写入全局`provider_configs`，模型身份写入`model_profiles`，应用默认与备用模型ID写入`app_settings`。三者在单个SQLite立即事务中更新，不更新`campaigns`或任何游戏事实表。后续存档级覆盖可引用这些稳定档案ID，而不复制密钥或模型会话。

API Key先由固定命令写入系统凭据库；保存设置前Rust确认CredentialRef存在，SQLite只保存该引用。设置读取只返回`hasCredential`，不返回引用或秘密。Provider探测是固定的模型列表语义，不向WebView开放任意URL请求。

### 影响

设置可跨应用重启恢复，默认/备用切换与Campaign事实隔离。连接测试可以复用安全传输和Provider错误边界；临时测试密钥必须在成功或失败后显式删除。当前默认值是应用级选择，不会追溯改写已有GenerationRecord。

### 可逆性

未来可在Campaign列中保存档案ID覆盖或任务级路由，并以明确的MODEL_SWITCHED事件记录实际切换。不得把密钥移入SQLite、把设置更新扩散为游戏事实重写，或向页面暴露通用SQL、HTTP和秘密读取能力。
