# Ember Tavern 审计日志

本日志按时间顺序记录自动开发任务的范围、决策、验证、自审与提交信息。不得记录 API Key、认证头或用户隐私数据。

## 2026-07-30 22:17 — 自动开发启动基线

### 范围

建立从 `M0-T03` 开始持续执行剩余任务所需的 D 盘缓存约束、审计日志和上下文交接基线；未实现任何任务代码。

### 主要改动

- 将 `.local/` 加入仓库忽略规则。
- 在 `pnpm-workspace.yaml` 固定项目本地 store 为 `.local/cache/pnpm-store`。
- 建立项目本地缓存、工具、下载、构建和报告目录。
- 创建 `LOG.md` 与 `docs/CONTEXT_HANDOFF.md`。

### 决策

- 所有后续依赖缓存、下载、构建输出和临时文件均重定向到仓库 `.local/`。
- 继续使用已经安装在 C 盘的 Rust 工具链，但不向 C 盘下载新依赖或构建缓存。

### 验证

- Git 工作树启动时干净，HEAD 为 `bd3a2f5`。
- Node.js `v24.17.0`、pnpm `11.9.0`、Rustup `1.29.0`、Rustc/Cargo `1.97.1` 可用。
- 仓库中没有子目录 `AGENTS.md`。

### 自审

- 未创建 crate、package 或应用功能。
- 未下载或安装新软件。

### Git

- Commit hash：`0478859`。
- Commit message：`chore: establish local development execution baseline`

## 2026-07-30 22:19 — M0-T03 创建项目目录骨架

### 范围

创建任务列出的应用、共享 package、原生 crate 与迁移目录，使 pnpm 和 Cargo 根 workspace 能识别真实成员；不实现业务功能。

### 主要改动

- 计划新增 `windows-app/`、`ios-app/` 和八个 `packages/*` 成员清单。
- 计划新增首个真实 `crates/native-bridge` Rust crate。
- 计划新增 `database/migrations` 目录说明。
- 计划更新任务状态、README、开发日志和上下文交接。

### 决策

- pnpm 成员仅包含最小、有效、可识别的 package manifest，不提前引入框架或依赖。
- `native-bridge` 仅建立可编译的安全 crate 边界，不提前实现未来原生功能。
- 其他未来 Rust crate 不创建空占位目录。

### 验证

- `pnpm --recursive list --depth -1`：通过，识别 11 个 workspace 项目。
- `pnpm lint`、`pnpm test`、`pnpm typecheck`：通过。
- `cargo metadata --format-version 1`：通过，识别 `ember-native-bridge`。
- `cargo fmt --all -- --check`：通过。
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`：通过。
- `cargo test --workspace`：通过，0 个单元测试、0 个文档测试。

### 自审

- package 名称唯一，根 workspace 可识别全部成员。
- 未引入依赖、框架、业务逻辑、占位返回值或未来 Rust crate。
- 数据库迁移仅保留目录用途说明，首版迁移仍属于 `M2-T02`。

### Git

- Commit hash：`ecef89c`。
- Commit message：`chore(M0-T03): create initial workspace structure`

## 2026-07-30 22:25 — M0-T04 建立代码质量检查

### 范围

建立 TypeScript 严格模式、ESLint、Prettier、Vitest 基线、Rust fmt/Clippy 和基础 CI；不实现领域或应用功能。

### 主要改动

- 计划更新根 `package.json` 与锁文件，添加固定版本的质量工具。
- 计划新增 TypeScript、ESLint、Prettier、Rust 格式和 GitHub Actions CI 配置。
- 计划让 `native-bridge` 继承根 workspace Rust lint。

### 决策

- 根级工具统一检查全部 package，避免当前骨架阶段复制十套相同配置。
- TypeScript 编译选项启用严格与额外边界检查；具体包可在后续任务继承。
- 测试命令在尚无业务测试时允许 0 测试成功，但后续业务逻辑任务必须添加真实测试。

### 验证

- `pnpm install --frozen-lockfile`、`pnpm peers check`：通过。
- `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`：通过。
- 刷新已有 Cargo PATH 后，组合命令 `pnpm check`：通过。
- Rust fmt、严格 Clippy、workspace test 与 metadata：通过。
- CI 必需命令静态核对通过；远端 GitHub Actions 尚未触发。

### Bug修复

- 最新 TypeScript 7.0.2 超出 ESLint peer 范围，固定为 5.9.3。
- Vitest 4.1.10 带来传递 peer 冲突，固定为 4.0.18。
- pnpm 阻止 esbuild 构建脚本，仅批准该依赖后成功安装。
- 当前 PowerShell 未刷新已有 Cargo PATH，补入 `%USERPROFILE%\.cargo\bin` 后原 `pnpm check` 完整通过。

### 自审

- 严格类型、零 warning lint、格式和 Rust lint 均为失败即阻断。
- 质量配置不扫描或改写需求、日志、缓存和构建产物。
- M0 里程碑搜索未发现生产占位实现或敏感信息。

### Git

- Commit hash：`e555f8c`。
- Commit message：`chore(M0-T04): establish code quality checks`

## 2026-07-30 22:37 — M1-T01 定义通用 ID、时间和版本类型

### 范围

在 contracts 包定义五类不透明 ID、UTC 时间戳、Schema/Prompt 版本和可保留未知值的枚举兼容协议；不定义业务实体。

### 主要改动

- 计划新增 `packages/contracts/src` 公共协议与单元测试。
- 计划更新 contracts package 出口、任务状态、README、日志和交接文档。

### 决策

- ID 使用 TypeScript brand 防止跨实体误用，运行时构造器拒绝空白值。
- 时间戳统一为 `Date.toISOString()` 的 UTC 格式。
- Schema 与 Prompt 版本使用正整数 brand。
- 未知枚举值保留原始字符串，避免静默映射或数据丢失。

### 验证

- `pnpm check`：通过。
- Vitest：1 个测试文件、15 个测试全部通过。
- TypeScript、ESLint、Prettier 与 Rust 全量回归通过。

### Bug修复

- 写文件脚本的 `Test-Path` 调用漏空格，导致 `src/` 未创建；修正后重放并确认无半成品。

### 自审

- ID 类型不可互换，边界构造器拒绝非规范值。
- 未知枚举保留原值；时间和版本拒绝非法输入。
- 未提前实现 M1-T02 或其他实体。

### Git

- Commit hash：`855c93f`。
- Commit message：`feat(M1-T01): define foundational contract types`

## 2026-07-30 22:42 — M1-T02 定义 Campaign 与状态机协议

### 范围

定义 Campaign 结构、正常与异常状态、合法迁移和恢复约束；不定义世界、角色或持久化。

### 主要改动

- 计划新增 Campaign 协议、迁移实现和状态机测试。
- 计划更新 contracts 出口、任务状态、日志与交接文档。

### 决策

- 异常状态保存原正常阶段，恢复只能回到该阶段，禁止任意跳转。
- `ARCHIVED` 是终态；归档不等于异常恢复。
- 状态迁移返回新 Campaign，不原地修改输入。

### 验证

- `pnpm check`：通过。
- Vitest：2 个文件、25 个测试通过，其中 Campaign 新增 10 项。
- 完整正常流程、重新生成、异常恢复、归档和非法迁移均有覆盖。

### Bug修复

- 严格类型检查发现测试时间数组动态索引可能越界；增加显式 RangeError，未使用非空断言绕过。

### 自审

- 异常只能恢复被中断阶段，归档是终态，时间不能倒退。
- 迁移返回新对象，不原地修改 Campaign。
- 未提前实现世界协议、持久化或应用用例。

### Git

- Commit hash：`2e128c6`。
- Commit message：`feat(M1-T02): define campaign state machine`

## 2026-07-30 22:46 — M1-T03 定义世界圣经与世界事实协议

### 范围

定义 WorldBible、Faction、Location 和五类 WorldFact，支持生成结果与后续世界变化；不实现生成用例或持久化。

### 主要改动

- 计划新增 world 协议、实体 ID 和协议测试。
- 计划更新 contracts 出口、任务状态、日志与交接。

### 决策

- 世界事实采用判别联合，锁定规则与发展/临时/认知类事实在类型层可区分。
- 发展事实通过 `supersedesFactId` 形成可追溯演进，不覆盖旧事实。
- 传闻保留真实性状态；错误认知记录认知该事实的 NPC ID。

### 验证

- `pnpm check`：通过。
- Vitest：3 个文件、29 个测试通过，世界协议新增 4 项。
- 完整 WorldBible、ID 隔离、五类事实与演进链均有覆盖。

### 自审

- 所有实体引用使用 brand ID，事实分类可由程序判别。
- 发展事实追加而非覆盖，锁定规则有独立类别。
- 未实现 AI、持久化、UI 或 M1-T04。

### Git

- Commit hash：`494634e`。
- Commit message：`feat(M1-T03): define world contracts`

## 2026-07-30 22:49 — M1-T04 定义玩家角色协议

### 范围

定义角色、固定职业原型、四属性分配、特质、目标、背景、内容边界和初始装备引用；不定义物品效果。

### 主要改动

- 计划新增 character 协议、角色/物品 ID 和属性规则测试。
- 计划更新 contracts 出口、任务状态、日志与交接。

### 决策

- 底层职业原型固定，AI 包装名存为独立 displayName，不能改变规则定位。
- 属性构造器要求四项整数 1 至 5 且总和 10。
- 已选特质使用长度为 2 的元组表达。

### 验证

- `pnpm check`：通过。
- Vitest：4 个文件、38 个测试通过，角色新增 9 项。
- 属性边界、总点数、不可变性和完整角色协议均有覆盖。

### 自审

- 固定规则原型与 AI 展示名分离。
- 实体引用均为 brand ID，装备只做引用，不提前定义效果。
- 未实现角色生成用例、数据库或 M1-T05。

### Git

- Commit hash：`7712124`。
- Commit message：`feat(M1-T04): define player character contracts`

## 2026-07-30 22:52 — M1-T05 定义酒馆与 NPC 协议

### 范围

定义酒馆、变化、NPC资料、认知、四维关系、记忆和临时访客协议；不定义传闻、任务或对话用例。

### 主要改动

- 计划新增 tavern/NPC 协议、实体 ID、关系和知识构造器及测试。
- 计划更新 contracts 出口、任务状态、日志与交接。

### 决策

- NPC知识按 NPC 独立记录已知、怀疑、错误认知和明确不可知事实。
- 四维关系均由程序构造器限制在 -5 至 5。
- 临时访客引用 NPC资料，不复制角色卡。

### 验证

- `pnpm check`：通过。
- Vitest：5 个文件、46 个测试通过，酒馆/NPC新增 8 项。
- 关系边界、越界拒绝、知识隔离和完整协议均有覆盖。

### Bug修复

- ESLint 拒绝无新增成员的继承接口，改为明确类型别名。
- 自审将关系第三维从 `fear` 修正为符合“敬畏”的 `awe`。

### 自审

- NPC知识按角色复制并冻结，关系四维由程序限制。
- 访客引用资料而不复制，实体关系均用 brand ID。
- 未实现传闻、任务、持久化或聊天用例。

### Git

- Commit hash：`8c49d4f`。
- Commit message：`feat(M1-T05): define tavern and npc contracts`

## 2026-07-30 22:56 — M1-T06 定义传闻、任务和物品协议

### 范围

定义 Rumor、Quest、QuestStatus、Item、ItemEffect 和 RewardTier；不实现任务用例或奖励提交。

### 主要改动

- 计划新增 quest/item 协议、Rumor ID 和结构测试。
- 计划更新 contracts 出口、任务状态、日志、决策与交接。

### 决策

- AI创作字段嵌套在 `content`，程序控制状态、风险、推荐属性、等级和效果。
- 物品效果采用判别联合，不从名称或描述推断规则。
- 传闻公开文本与隐藏真实性分离。

### 验证

- `pnpm check`：通过。
- Vitest：6 个文件、49 个测试通过，任务/物品新增 3 项。
- 完整任务、隐藏传闻真实性和文本/效果分离均有覆盖。

### 自审

- AI文本只在 `content`，规则字段为封闭枚举或判别联合。
- 所有关系使用 brand ID，未新增依赖。
- 未实现任务用例、奖励提交、持久化或 M1-T07。

### Git

- Commit hash：`7e5c039`。
- Commit message：`feat(M1-T06): define quest and item contracts`

## 2026-07-30 22:58 — M1-T07 定义冒险协议

### 范围

定义 AdventurePlan、AdventureState、AdventureTurn、PlayerAction、CheckRequest、DiceResult、AdventureEnding 和 Clue，并实现状态迁移校验；不掷骰。

### 主要改动

- 计划新增 adventure 协议、Check/Clue ID、状态机和测试。
- 计划更新 contracts 出口、任务状态、日志与交接。

### 决策

- 隐藏骨架作为 AdventurePlan 独立保存，不混入玩家可见回合文本。
- 玩家行动使用判别联合，自由输入和建议行动明确区分。
- 冒险状态迁移为封闭表，SETTLED 为终态。

### 验证

- `pnpm check`：通过。
- Vitest：7 个文件、58 个测试通过，冒险新增9项。
- 完整状态路径、合法分支、非法迁移、隐藏计划和回合记录均有覆盖。

### 自审

- SETTLED为终态，PlayerAction为判别联合，骰子仅记录不生成。
- 发现裸 `optionId` 后改为 ActionOptionId brand。
- 未实现D20引擎、持久化或应用用例。

### Git

- Commit hash：`10c4ee6`。
- Commit message：`feat(M1-T07): define adventure contracts`

## 2026-07-30 23:01 — M1-T08 实现 D20 规则引擎

### 范围

在 domain 包实现可注入随机源的D20检定、属性/装备/状态修正和四档难度；不实现 UI 或原生骰子服务。

### 主要改动

- 计划配置 domain 对 contracts 的 workspace依赖。
- 计划新增D20引擎、输入校验和固定随机源测试。

### 决策

- 随机源通过最小接口注入，领域规则不直接依赖 Math.random或平台API。
- 非法骰面、属性和修正直接拒绝，不静默截断。
- 返回 contracts 定义的 DiceResult。

### 验证

- `pnpm check`：通过。
- Vitest：8个文件、71个测试通过，D20新增13项。
- 四档难度、成功/失败边界、骰面边界、修正和非法输入均有覆盖。

### 自审

- 领域层只依赖最小随机源接口，不调用平台或AI。
- 输入拒绝非法值，结果冻结并可审计。
- 未实现原生随机服务、用例、持久化或M1-T09。

### Git

- Commit hash：`72a9461`。
- Commit message：`feat(M1-T08): implement d20 rule engine`

## 2026-07-30 23:05 — M1-T09 实现关系与世界时钟规则

### 范围

实现单回合关系变化、世界时钟范围/阶段触发和非法补丁拒绝；不提交数据库。

### 主要改动

- 计划新增WorldClock ID、领域关系补丁和时钟规则及测试。
- 计划更新任务状态、日志、决策与交接。

### 决策

- 单回合每个关系维度最多±1，结果仍须在-5至5。
- 世界时钟每次只允许推进1，不允许负向或跳格。
- 补丁先完整验证再返回新对象，失败不产生部分更新。

### 验证

- `pnpm check`：通过。
- Vitest：9个文件、89个测试通过，关系与时钟新增18项。
- 合法变化、幅度/结果越界、原对象不变、时钟终点、非法时钟和阶段阈值触发均有覆盖。

### 自审

- 关系补丁和时钟推进均返回冻结的新对象，失败不修改输入或产生部分结果。
- 时钟阶段阈值必须唯一且位于1至max；推进只能为1。
- 未实现事件协议、SQLite写入、AI补丁验证或应用用例。

### Git

- Commit hash：`e23c07a`。
- Commit message：`feat(M1-T09): implement relationship and clock rules`

## 2026-07-30 23:10 — M1-T10 定义GameEvent事件协议

### 范围

定义规格事件日志列出的关键事件、精确payload和公共审计元数据；不实现事件存储、SQLite迁移或发布用例。

### 主要改动

- 计划新增GameEvent ID、事件判别联合和全部事件payload。
- 计划添加类型收窄、完整事件列表和公共元数据测试。

### 验证

- 首轮门禁发现测试使用非空断言；改为显式缺失分支后通过，未调整Lint规则。
- `pnpm check`：通过；10个测试文件、92个测试全部成功。
- 规格第28.3节的12类事件全部有fixture；世界、角色、骰子、关系、任务和冒险验收类别均已覆盖。

### 自审

- `type` 与payload通过映射判别联合关联，不接受通用JSON或 `any`。
- 公共信封包含不透明事件ID、CampaignId、SchemaVersion和规范UTC时间。
- 未创建数据库表、仓储、事务或应用发布逻辑。

### Git

- Commit hash：`07abde7`。
- Commit message：`feat(M1-T10): define game event protocol`

## 2026-07-30 23:16 — M2-T01 设计SQLite ER模型

### 范围

依据规格核心表和M1协议设计SQLite ER模型文档；不创建迁移、数据库目录或Repository。

### 主要改动

- 计划新增 `docs/data-model.md`，明确22张核心表的字段、主外键、索引和JSON列。
- 计划显式记录未单独列为核心表的嵌套实体如何持久化，以及API Key禁止入库的边界。

### 验证

- 静态脚本：规格核心表预期22张、实际22张，缺失0、额外0；外键目标全部有效；识别48个去重JSON列名。
- 初稿核心表计数从错误的23修正为22；传输前失败的生成记录允许原始响应为空。
- `pnpm check`：通过；10个测试文件、92个测试全部成功。

### 自审

- 22张表均明确字段、PK/FK、索引和JSON边界，未创建规格之外的业务表。
- 嵌套协议对象的JSON归属、Repository校验责任和未来规范化路径已说明。
- API Key、令牌和Authorization头明确禁止入库；只保存安全存储引用。
- 未创建迁移、数据库目录、Repository或运行时依赖。

### Git

- Commit hash：`b239e59`。
- Commit message：`docs(M2-T01): design SQLite data model`

## 2026-07-30 23:22 — M2-T02 创建首版数据库迁移

### 范围

创建 `0001_initial.sql`、最小迁移执行器和真实SQLite迁移测试；不实现Campaign或其他Repository。

### 主要改动

- 计划按 `docs/data-model.md` 创建22张核心表、迁移记录表、约束和索引。
- 计划使用Node 24内置SQLite在 `.local/` 临时目录验证首次迁移和重复启动。

### 验证

- 新数据库一次迁移成功，规格22张核心表名称精确匹配，版本1已记录。
- 第二次执行跳过已记录版本，表数和版本记录均不重复。
- 非法JSON、越界时钟和缺失外键被拒绝；Provider列不存在秘密字段。
- `pnpm check`：通过；Vitest 92项、Node SQLite迁移测试3项全部成功。

### Bug修复

- Node SQLite返回null-prototype查询行，首次深比较虽字段相同仍失败；测试改为复制字段后比较。
- ESLint发现JavaScript `URL` 未显式导入；从 `node:url` 导入，保留严格 `no-undef`。

### 自审

- 业务DDL和版本记录同事务，失败回滚；重复启动按版本跳过，不吞掉错误。
- 迁移创建22张规格核心表和1张基础设施版本表，没有额外业务表。
- 未实现任何Repository或后续业务逻辑。

### Git

- Commit hash：`94ba77a`。
- Commit message：`feat(M2-T02): create initial SQLite migration`

## 2026-07-30 23:28 — M2-T03 实现Campaign Repository

### 范围

实现Campaign创建、读取、更新、归档和列表；使用最小SQLite端口保持平台可替换，不实现世界、角色或其他Repository。

### 主要改动

- 计划新增类型安全的Campaign Repository及公共导出。
- 计划用Node 24 SQLite测试适配器执行真实文件数据库重连测试。

### 验证

- CRUD、排序、归档过滤、重复ID、缺失目标和非法持久化时间均有测试。
- 关闭连接后重新打开同一文件数据库，Campaign完整读取成功。
- `pnpm check`：通过；Vitest 11个文件、96项，Node迁移3项全部成功。

### Bug修复

- 严格类型检查拒绝原始数据库行的点号索引访问；改为显式键访问，未降低规则。

### 自审

- 生产Repository仅依赖最小SQLite端口，Node SQLite只存在于测试适配器。
- 原始行按M1构造器和枚举显式验证，无 `any` 或未验证类型断言直出。
- SQL全部参数化，归档复用Campaign状态机；未实现其他Repository。

### Git

- Commit hash：`1dc0289`。
- Commit message：`feat(M2-T03): implement campaign repository`

## 2026-07-30 23:34 — M2-T04 实现世界与角色Repository

### 范围

实现WorldBible、WorldFact和PlayerCharacter读写；不实现酒馆、NPC、任务或冒险Repository。

### 主要改动

- 计划新增受验证JSON解码工具、世界Repository和角色Repository。
- 计划用真实SQLite完整往返锁定字段、判别事实和角色JSON聚合。

### 验证

- WorldBible全部JSON与锁定字段精确恢复，未知锁定字段被拒绝。
- 六条WorldFact覆盖五类及发展事实替代链，重复事实ID被拒绝。
- PlayerCharacter属性、边界、两个特质、背景和装备引用精确恢复并可更新。
- `pnpm check`：通过；Vitest 12个文件、101项，Node迁移3项全部成功。

### Bug修复

- 严格类型检查发现测试按数字索引的fixture可能不存在；改为按ID查找并显式处理缺失分支。

### 自审

- JSON从unknown逐字段验证，未知枚举和错误结构不会进入领域对象。
- WorldFact仅追加，WorldBible和角色保护创建身份字段。
- 未实现M2-T05及后续Repository。

### Git

- Commit hash：`bf80e75`。
- Commit message：`feat(M2-T04): implement world and character repositories`

## 2026-07-30 23:41 — M2-T05 实现酒馆、NPC和关系Repository

### 范围

实现Tavern、Npc、Knowledge、Relationship、Memory及临时访客/酒馆变化持久化；不实现任务和冒险Repository。

### 主要改动

- 计划实现酒馆生成环的两阶段写入、NPC资料与访客信息、知识/关系upsert和追加式记忆。
- 计划从NPC表动态恢复常驻与访客列表，避免重复状态源。

### 验证

- 两个NPC知识、错误认知、关系和记忆独立往返，无交叉污染。
- 老板绑定、动态常驻/访客列表、临时访客、酒馆变化和资料更新完整恢复。
- `pnpm check`：通过；Vitest 13个文件、105项，Node迁移3项全部成功。

### 自审

- Tavern生成环采用父行→NPC→老板绑定的明确流程，未关闭外键。
- JSON从unknown验证，嵌入记忆/访客ID必须匹配所属NPC。
- Tavern/NPC身份字段不可更新，四维关系复用领域范围校验。
- 未实现M2-T06任务、冒险与对话Repository。

### Git

- Commit hash：`1dcc3ac`。
- Commit message：`feat(M2-T05): implement tavern and npc repositories`

## 2026-07-30 23:47 — M2-T06 实现任务、冒险与对话Repository

### 范围

实现Quest、Adventure、Turn、Conversation、Message、Item和Clock持久化；不实现GameEvent或AI请求Repository。

### 主要改动

- 计划补齐Conversation/Message所需品牌ID与最小协议。
- 计划实现任务、冒险聚合、消息流、物品和世界时钟的受验证读写。

### 验证

- 完整冒险回合含行动、检定和骰子结果，关闭并重开SQLite后精确恢复。
- 任务、隐藏计划、线索、消息流、物品效果和时钟阶段完整往返。
- 重复回合号和消息序号被唯一约束拒绝。
- `pnpm check`：通过；Vitest 14个文件、108项，Node迁移3项全部成功。

### Bug修复

- Lint发现仅用于类型表达式的 `playerCharacterId` 是值导入；改为type-only import。

### 自审

- Conversation作用域和NPC speaker语义有双层验证。
- AdventureTurn从重开SQLite恢复，不依赖模型历史或UI状态。
- 未实现M2-T07事件与AI生命周期Repository。

### Git

- Commit hash：`adba910`。
- Commit message：`feat(M2-T06): implement adventure persistence repositories`

## 2026-07-30 23:57 — M2-T07 实现事务型回合提交

### 范围

实现玩家输入、已验证AI输出、状态补丁和GameEvent的单事务提交；不实现pending AI请求或后续恢复功能。

### 主要改动

- 新增 `GameEventRepository`，写入前和读取后均按事件判别字段逐项验证payload。
- 新增 `TurnTransaction`，原子更新Adventure、追加完整Turn、应用Quest/NPC关系/WorldFact补丁并追加事件。
- SQLite端口只增加事务所需的 `exec` 能力，并以独立 `TransactionalSqliteDatabase` 接口表达。

### 验证

- 成功路径同时保存玩家自由输入、AI场景文本、任务状态、NPC关系、世界事实和玩家行动事件。
- 故障路径在末尾用重复GameEvent主键触发失败，验证Turn、Adventure、Quest和NPC关系均无部分残留。
- 校验事件与回合输入一致、所有写入属于同一Campaign，并拒绝空场景或未完成回合。
- `pnpm check`：通过；Vitest 15个文件、110项，Node迁移3项全部成功；TypeScript、ESLint、Prettier及Rust全套检查通过。

### Bug修复

- 初始测试夹具漏等异步迁移并未关闭SQLite连接；补齐 `await` 和连接清理。
- 全量测试发现关系归属检查不应反序列化完整角色；收窄为只读取双方 `campaign_id`。
- 聚合回滚错误按Lint规则保留当前捕获错误的 `cause`，未关闭错误保真规则。

### 自审

- AI输出以已经通过上游结构与业务校验的完整AdventureTurn进入持久化事务，本层不会接收原始模型文本直接修改状态。
- GameEvent只有追加接口，无更新或覆盖接口；JSON读取从unknown验证。
- 未实现pending_ai_requests，不提前执行M2-T08。

### Git

- Commit hash：`3fbb7b3`。
- Commit message：`feat(M2-T07): add transactional turn commits`

## 2026-07-31 00:05 — M2-T08 实现pending_ai_requests

### 范围

实现pending AI请求状态、错误码、重试次数和幂等键，并将幂等请求结算接入M2-T07事务；不实现AI协议、Provider或数据库启动检查。

### 主要改动

- 新增AI请求品牌ID、JSON值、八状态生命周期、错误和pending请求共享协议。
- `PendingAiRequestRepository` 实现创建或复用、读取、未完成列表、上下文、发送/接收/验证、失败、重试、取消及幂等结算。
- Turn事务支持已保存玩家输入的回合更新和ITEM_REWARD补丁；奖励、GameEvent与请求COMMITTED状态同事务提交。
- input/context/error JSON拒绝非JSON结构和凭证字段，回合与奖励归属必须匹配Campaign。

### 验证

- 同一幂等键和相同请求返回原记录；不同请求复用相同键抛出冲突。
- TIMEOUT错误码、可重试标记和两次发送尝试均从SQLite准确恢复。
- 同一幂等键连续结算两次，结果为COMMITTED和ALREADY_COMMITTED；SQLite中只有一件奖励物品和一组事件。
- API Key字段在写入前被拒绝。
- `pnpm check`：通过；Vitest 15个文件、112项，Node迁移3项全部成功；TypeScript、ESLint、Prettier及Rust全套检查通过。

### 自审

- 幂等判断和游戏写入不依赖内存；已提交终态在事务中短路。
- Pending请求不能跨Campaign引用回合，ITEM_REWARD持有人和来源冒险同样校验归属。
- 未实现M2-T09启动检查、M3 AI协议或真实模型调用。

### Git

- Commit hash：`c5a7333`。
- Commit message：`feat(M2-T08): implement idempotent AI request lifecycle`

## 2026-07-31 00:11 — M2-T09 实现数据库启动检查和迁移框架

### 范围

实现数据库版本检查、迁移执行、完整性检查和可显示失败结果；不实现快照恢复、备份轮换或M3 AI功能。

### 主要改动

- 迁移模块公开当前Schema版本和有序manifest，启动时验证版本连续性、名称和未来版本。
- 新增 `prepareDatabaseFile`：现有数据库只在唯一工作副本上检查和迁移，成功后保留pre-migration原件再切换。
- 启动前拒绝带journal/WAL/SHM侧文件的活跃数据库；迁移前后运行 `PRAGMA integrity_check`。
- READY、MIGRATED和FAILED结果包含版本、备份路径或稳定错误码，供平台显示失败提示。

### 验证

- v0旧库保留自有数据并升级到v1，正式库完整性为ok，迁移前副本仍为原Schema。
- 旧库结构与v1迁移冲突时返回失败，原文件SHA-256和数据逐字节不变。
- Schema 99被明确拒绝为SCHEMA_TOO_NEW，损坏文件返回INTEGRITY_CHECK_FAILED且证据文件不变。
- `pnpm check`：通过；Vitest 15个文件、112项，Node SQLite 7项全部成功；TypeScript、ESLint、Prettier及Rust全套检查通过。

### 自审

- 文件关闭、工作副本清理和原文件恢复失败都有独立错误，不吞掉异常。
- 本任务只保留单次迁移前副本，不实现M7备份轮换或自动快照恢复。
- M2全部任务完成，未提前执行M3-T01。

### Git

- Commit hash：`f11622e`。
- Commit message：`feat(M2-T09): add safe database startup migrations`

## 2026-07-31 00:15 — M3-T01 定义统一AI请求与响应协议

### 范围

只定义厂商无关AI协议；不实现任务Schema、Prompt、Fake Provider或真实API。

### 主要改动

- ai-core新增15类AITask、5类Provider和17个预设键。
- 定义AIProvider、NormalizedAIRequest/Response、ProviderConfig、ModelInfo、ModelCapabilities和TestResult。
- 配置只含credentialRef；模型免费/付费状态带动态能力检查时间。
- ai-core声明contracts workspace依赖并建立公共导出。

### 验证

- 本地测试对象不依赖任何SDK即可完整实现AIProvider并生成规范化响应。
- 任务、Provider类别、预设、能力与间接凭证字段均有断言。
- 业务相关package扫描未发现OpenAI、Anthropic或Gemini SDK导入。
- `pnpm check`：通过；Vitest 16个文件、116项，Node SQLite 7项全部成功；TypeScript、ESLint、Prettier及Rust全套检查通过。

### 自审

- 未发送网络请求、未加入SDK依赖、未写入API Key。
- 未定义M3-T02任务Schema或M3-T03 Prompt。

### Git

- Commit hash：`42e9330`。
- Commit message：`feat(M3-T01): define vendor-neutral AI protocol`

## 2026-07-31 00:22 — M3-T02 定义首批AI任务Schema

### 范围

为15类首批AI任务定义独立输入/输出Zod Schema和版本；不实现Prompt、Fake Provider或领域补丁提交。

### 主要改动

- ai-core加入Zod运行依赖。
- 新增世界、角色、酒馆/NPC、对话、任务、冒险、骰子叙事、世界事件、摘要、记忆和一致性Schema。
- `AI_TASK_SCHEMAS` 对全部AITask逐项注册独立Schema及版本1。
- 状态补丁只验证结构化提案，业务合法性留给M3-T07。

### 验证

- 15个任务各自有效输入输出夹具通过，空输出全部拒绝。
- 确认30个顶层Schema对象均独立，版本均为1。
- 特质数量、任务回合范围和严格额外字段有代表性失败断言。
- `pnpm check`：通过；Vitest 17个文件、148项，Node SQLite 7项全部成功；TypeScript、ESLint、Prettier及Rust全套检查通过。

### Bug修复

- 首轮6项夹具失败定位为共享世界上下文漏 `technologyLevel`；补入规格字段后全部通过，未放宽strict校验。

### 自审

- 未写Prompt、未实现Provider、未接收或提交真实AI输出。
- 领域规则仍需M3-T07验证，Schema通过不代表状态补丁可提交。

### Git

- Commit hash：`ba3d646`。
- Commit message：`feat(M3-T02): add versioned AI task schemas`

## 2026-07-31 00:26 — M3-T03 建立Prompt目录与版本机制

### 范围

建立集中Prompt、版本历史和Provider能力格式层；不实现Fake/真实Provider或上下文构建。

### 主要改动

- prompts package新增Base权责/隐私/JSON规则和15类任务指令。
- 每个任务记录逻辑角色、PromptVersion 1和输出Schema名称。
- 独立PROMPT_HISTORY保留固定v1基线，供未来追加版本。
- 格式层先验证任务输入，再按system消息、JSON Schema和JSON Mode能力降级。

### 验证

- 15类Prompt与历史精确覆盖AI_TASKS，版本均为1。
- 支持system与不支持system的消息结构、三种响应格式和非法输入拒绝均通过。
- 页面、application和Repository扫描未发现Prompt正文。
- `pnpm check`：通过；Vitest 18个文件、154项，Node SQLite 7项全部成功；TypeScript、ESLint、Prettier及Rust全套检查通过。

### Bug修复

- 只读JSON数组类型收窄增加显式对象守卫，未使用断言。
- 自审将历史从当前Prompt动态映射改为固定v1基线，避免未来升级覆盖旧记录。

### 自审

- 未调用模型、未实现M3-T04 Fake Provider。
- Prompt只存在prompts package，UI和Repository不持有正文。

### Git

- Commit hash：`b6638ad`。
- Commit message：`feat(M3-T03): centralize versioned prompts`

## 2026-07-31 00:32 — M3-T04 实现FakeAIProvider

### 范围

实现统一AI协议下覆盖15类首批任务的确定性离线Provider；不实现上下文构建、解析修复、领域验证或编排提交。

### 主要改动

- 新增 `FakeAIProvider` 与显式错误类型，提供固定免费模型、连接检查和规范化响应。
- 新增完整 `FAKE_TASK_OUTPUTS`，每项输出在返回前通过对应任务Zod Schema。
- 相同请求得到相同内容、模型、结束原因和默认时间；可注入时钟用于调用侧测试。
- 禁用配置和未知模型均显式失败，不读取凭据、不进行网络调用。

### 验证

- 15类输出逐项重复调用并通过各自Schema。
- 禁网条件下生成世界、角色、酒馆、NPC、任务、冒险计划、8个回合、骰子结果和冒险摘要；网络调用0次。
- 专用测试20项通过。
- `pnpm check`：通过；Vitest 19个文件、174项，Node SQLite 7项全部成功；TypeScript、ESLint、Prettier及Rust全套检查通过。

### 自审

- Provider没有写入SQLite；结构有效输出仍须由后续领域验证和事务提交边界处理。
- 未执行M3-T05或任何后续任务。

### Git

- Commit hash：`a6a7417`。
- Commit message：`feat(M3-T04): implement deterministic fake AI provider`

## 2026-07-31 00:39 — M3-T05 实现上下文构建器

### 范围

实现NPC、冒险、世界事件的最小相关上下文、长短期组合和预算裁剪；不实现AI输出验证或编排。

### 主要改动

- ai-core新增三类纯上下文构建器、Source/Result类型、默认预算和显式构建错误。
- NPC按知识ID、目标消息/记忆和排除秘密集合过滤；冒险按Adventure/Quest关联过滤；世界事件按Campaign过滤。
- 最近消息、记忆、回合和事件有独立窗口，总序列化字符预算超限时裁剪最旧可选内容。
- 补齐规格第26节所需输入字段，三类受影响任务输入Schema升级到版本2。

### 验证

- 无关NPC秘密、消息、记忆和excluded事实均未进入NPC上下文。
- 无关Adventure回合/线索及非Quest关联NPC未进入冒险上下文；长期摘要与最近回合同时保留。
- 世界时钟和事件不会跨Campaign泄漏；三类结果均通过对应输入Schema。
- `pnpm check`：通过；Vitest 20个文件、179项，Node SQLite 7项全部成功；TypeScript、ESLint、Prettier及Rust全套检查通过。

### Bug修复

- 测试夹具阵营ID改用品牌构造器。
- 裁剪策略改为比较消息与记忆的最旧项大小，避免旧大记忆挤掉最新短消息。

### 自审

- 构建器不直接读写SQLite、不调用Provider、不持有唯一模型会话历史。
- 未执行M3-T06或任何后续任务。

### Git

- Commit hash：`30057b8`。
- Commit message：`feat(M3-T05): build scoped AI contexts`

## 2026-07-31 00:45 — M3-T06 实现AI输出结构验证

### 范围

实现AI原始JSON的任务Schema验证、错误定位与generation_records留存；不做领域补丁合法性判断。

### 主要改动

- ai-core新增逐任务结构验证器和成功/失败判别联合。
- 非法JSON、Schema错误均返回稳定code、字段path和消息，原始文本逐字保留。
- contracts新增GenerationRecord及验证错误协议。
- persistence新增GenerationRecordRepository，分列保存请求、raw、validated output和validation error，并限制一次性完成。

### 验证

- 缺字段、错误枚举和嵌套越界值均拒绝且路径准确。
- 成功和失败记录都经真实SQLite关闭/重连或读取验证；失败raw不进入validated output。
- 双结果、无结果、重复完成和含凭据字段请求均拒绝。
- `pnpm check`：通过；Vitest 22个文件、187项，Node SQLite 7项全部成功；TypeScript、ESLint、Prettier及Rust全套检查通过。

### Bug修复

- lint发现缺字段夹具的解构变量未使用，改为显式JSON副本删除字段，未放宽规则。

### 自审

- 结构通过不代表状态补丁可提交；未执行M3-T07。
- 原始响应不写日志，只存既有SQLite审计列。

### Git

- Commit hash：`1579b3c`。
- Commit message：`feat(M3-T06): validate and retain AI outputs`

## 2026-07-31 00:51 — M3-T07 实现Domain状态补丁验证器

### 范围

实现任务、关系、奖励、事实和时钟的本地领域验证；不实现Orchestrator或数据库提交。

### 主要改动

- domain新增顺序式批量补丁验证器、上下文/结果联合及定位错误。
- Quest按状态机前进；关系与时钟复用M1规则。
- 奖励要求已完成任务、本地授权且不越级，物品效果只来自程序授权。
- Fact只允许追加发展事实；锁定规则、已有target、属性变更和未知补丁均拒绝。

### 验证

- 五类合法补丁在同一批次按顺序通过，任务完成后奖励授权生效。
- 玩家属性、锁定规则、越级奖励、跳级任务、关系+2和时钟+2全部拒绝。
- `pnpm check`：通过；Vitest 23个文件、192项，Node SQLite 7项全部成功；TypeScript、ESLint、Prettier及Rust全套检查通过。

### Bug修复

- 品牌ID构造器从type-only import移至值导入，避免运行时擦除。
- unknown对象入口增加普通对象原型校验和安全字典复制。

### 自审

- 已验证补丁仍非数据库命令；未执行M3-T08。
- `DEC-018` 记录本地顺序验证与奖励授权边界。

### Git

- Commit hash：`5cadbb7`。
- Commit message：`feat(M3-T07): validate AI domain state patches`

## 2026-07-31 00:57 — M3-T08 实现AI Orchestrator

### 范围

串联AI冒险回合的pending、上下文、Provider、双层验证、GenerationRecord和幂等SQLite事务；不实现M4用例。

### 主要改动

- application新增 `AITurnOrchestrator` 和正式包入口。
- 固定CREATED→CONTEXT_READY→SENDING→RECEIVED→VALIDATING→COMMITTED流程。
- 动态模型能力驱动集中Prompt格式，统一Provider响应校验request/model。
- 结构/领域失败分别留存，成功后才调用 `commitTurnOnce`；COMMITTED重放直接短路。
- GenerationRecord支持传输失败时raw为空，但成功输出仍必须关联raw。

### 验证

- 真实SQLite从Repository重建上下文，Fake Provider完整提交场景、事实、事件和pending状态。
- 同一幂等键二次执行返回ALREADY_COMMITTED，上下文只构建一次。
- 传输失败记录pending/generation错误，raw为空，Turn与事件无部分变更。
- `pnpm check`：通过；Vitest 24个文件、194项，Node SQLite 7项全部成功；TypeScript、ESLint、Prettier及Rust全套检查通过。

### 自审

- 不保存捕获异常原文，不调用厂商SDK或读取API Key。
- 未执行M4-T01；`DEC-019` 记录编排顺序和幂等边界。

### Git

- Commit hash：`be7da72`。
- Commit message：`feat(M3-T08): orchestrate validated AI turn commits`

## 2026-07-31 01:03 — M4-T01 新建存档和世界生成用例

- 新增CreateCampaign、GenerateWorld、RefineWorld、ConfirmWorld稳定用例。
- Fake输出经统一AI流程后映射程序ID，世界和REVIEWING_WORLD状态同事务提交。
- Refine保留实体ID/createdAt并保护lockedFields；无世界不能Confirm。
- `pnpm check`通过：Vitest 25文件196项、Node SQLite 7项及全部TS/ESLint/Prettier/Rust检查成功。
- 未执行M4-T02。

### Git

- Commit hash：`549727d`。
- Commit message：`feat(M4-T01): add world creation use cases`

## 2026-07-31 01:11 — M4-T02 车卡用例

- 新增CreateCharacter、GenerateCharacterTraits、CompleteCharacterBackground稳定用例。
- 特质和背景Prompt/Schema升级到v2，生成6候选与初始装备叙事。
- 属性本地校验；完整角色、程序控制装备效果和存档状态同事务写入SQLite。
- `pnpm check`通过：Vitest 26文件198项、Node SQLite 7项及全部TS/ESLint/Prettier/Rust检查成功。
- 未执行M4-T03。

### Git

- Commit hash：`f4772c3`。
- Commit message：`feat(M4-T02): add character creation use cases`

## 2026-07-31 01:18 — M4-T03 酒馆初始化用例

- 新增GenerateTavern、GenerateNpcs稳定用例及两阶段幂等事务。
- 生成老板、2名常驻、1名访客与3条本地RUMOR事实；初始化有限认知和关系。
- 常驻NPC提供后续任务入口，但不提前创建M4-T05的Quest。
- `pnpm check`通过：Vitest 27文件199项、Node SQLite 7项及全部TS/ESLint/Prettier/Rust检查成功。
- 未执行M4-T04。

### Git

- Commit hash：`322906f`。
- Commit message：`feat(M4-T03): initialize tavern roster and rumors`

## 2026-07-31 01:23 — M4-T04 NPC对话用例

- 新增TalkToNpc、ExtractMemories稳定用例。
- 对话上下文仅含NPC自身认知、关系、消息与记忆；本地验证关系变化。
- 对话消息/情绪/关系与记忆分别幂等原子写入SQLite。
- `pnpm check`通过：Vitest 28文件200项、Node SQLite 7项及全部TS/ESLint/Prettier/Rust检查成功。
- 未执行M4-T05。

### Git

- Commit hash：`0842087`。
- Commit message：`feat(M4-T04): persist limited-knowledge NPC dialogue`

## 2026-07-31 01:27 — M4-T05 任务用例

- 新增GenerateQuest、AcceptQuest稳定用例。
- 生成任务验证本地NPC/事实引用和8–12回合范围，固定为AVAILABLE。
- BEGIN IMMEDIATE事务确保单存档仅一个ACCEPTED/ACTIVE主任务。
- `pnpm check`通过：Vitest 29文件201项、Node SQLite 7项及全部TS/ESLint/Prettier/Rust检查成功。
- 未执行M4-T06。

### Git

- Commit hash：`0864822`。
- Commit message：`feat(M4-T05): generate and exclusively accept quests`

## 2026-07-31 01:33 — M4-T06 冒险开始用例

- 新增GenerateAdventurePlan、StartAdventure稳定用例。
- 完整隐藏骨架和3条核心线索写入SQLite，对外仅返回公开启动状态。
- 启动事务同步推进Adventure、Quest与Campaign。
- `pnpm check`通过：Vitest 30文件202项、Node SQLite 7项及全部TS/ESLint/Prettier/Rust检查成功。
- 未执行M4-T07。

### Git

- Commit hash：`0b08fbf`。
- Commit message：`feat(M4-T06): prepare and start hidden adventures`

## 2026-07-31 01:42 — M4-T07 冒险回合用例

- 新增SubmitPlayerAction、RollCheck、ResolveAdventureTurn稳定用例。
- 玩家行动先写入SQLite；模型输出经结构和业务验证后决定是否进入检定。
- D20在本地生成，叠加角色属性、装备与状态修正，并与DICE_ROLLED事件原子持久化。
- 无检定路径合法完成至SCENE；检定路径在叙事解析后保留原始骰点并回到SCENE。
- `pnpm check`通过：Vitest 31文件203项、Node SQLite 7项及全部TS/ESLint/Prettier/Rust检查成功。
- 未执行M4-T08。

### Git

- Commit hash：`2eaa001`。
- Commit message：`feat(M4-T07): resolve local-dice adventure turns`

## 2026-07-31 02:01 — M4-T08 冒险结算用例

- 新增SummarizeAdventure、AdvanceWorldClocks、FinishAdventure稳定用例。
- 摘要与世界事件先通过统一Provider、Schema和本地规则验证，不提前写入游戏事实。
- 最终SQLite事务同步更新任务、NPC心情/关系、酒馆变化、奖励、世界事实/时钟、AdventureEnding档案、事件、pending和Campaign状态。
- 冒险档案关联回合/骰子、参与NPC、物品、世界事实、酒馆变化及两条GenerationRecord，可从SQLite恢复。
- 成功与失败结算测试均通过；失败分支不创建未授权奖励，重复Finish返回同一档案。
- `pnpm check`通过：Vitest 32文件205项、Node SQLite 7项及全部TS/ESLint/Prettier/Rust检查成功。
- 未执行M4-T09。

### Git

- Commit hash：`48001da`。
- Commit message：`feat(M4-T08): atomically settle adventures`

## 2026-07-31 02:14 — M4-T09 重生成和回退用例

- 玩家输入提交后立即创建校验和保护的AUTO快照，AI生效前状态可恢复。
- 重生成先恢复输入快照，再通过统一Provider、Schema和领域规则生成；旧游戏事实不会与新结果并存。
- Provider切换遵守存档策略；跨厂商始终要求数据发送披露确认，并记录MODEL_SWITCHED事件。
- Provider或验证失败时恢复安全快照；自由故事和规则限次模式均有本地用例约束。
- 最新快照回退、SHA-256完整性校验和最近10个AUTO快照保留策略由SnapshotRepository执行。
- `pnpm check`通过：Vitest 32文件206项、Node SQLite 7项及全部TS/ESLint/Prettier/Rust检查成功。
- 未执行M5-T01。

### Git

- Commit hash：`4774f1d`。
- Commit message：`feat(M4-T09): regenerate turns from SQLite snapshots`

## 2026-07-31 02:28 — M5-T01 Windows Tauri初始化

- 初始化独立Windows React 19、Vite 7、Tauri 2工程，并加入pnpm/Cargo workspace。
- HashRouter提供最小启动与not-found路由；启动页运行时读取共享contracts的Schema版本。
- 基础主题采用拱形炉门视觉，包含响应式布局、键盘焦点和reduced-motion处理。
- Tauri只授予core:default capability，不开放SQL、文件、HTTP或密钥命令。
- 前端生产构建、Cargo check和Tauri release无bundle构建通过，实际开发窗口标题为Ember Tavern且进程响应。
- `pnpm check`通过：Vitest 33文件208项、Node SQLite 7项及全部TS/ESLint/Prettier/Rust检查成功。
- 未执行M5-T02。

### Git

- Commit hash：`7593c2b`。
- Commit message：`feat(M5-T01): initialize Windows Tauri shell`

## 2026-07-31 02:35 — M5-T02 Windows应用壳和导航

- 新增固定侧栏和上下文标题栏，延续炉门与账册主题。
- 酒馆、任务、冒险、角色、档案、设置六个入口均可导航并显示活动态。
- 页面模块延迟加载，统一Suspense加载态具备可访问进度语义。
- 路由级错误边界使用固定系统文案，不显示原始异常或修改游戏数据。
- 3项jsdom组件测试覆盖六路导航、加载态和错误隔离。
- 前端生产构建与Tauri实际窗口烟测通过；`pnpm check`通过，Vitest 33文件209项。
- 未执行M5-T03。

### Git

- Commit hash：`308adc3`。
- Commit message：`feat(M5-T02): add Windows shell navigation`

## 2026-07-31 02:52 — M5-T03 Windows存档首页

- 应用默认进入本地存档首页，可新建、继续、归档并显示最后游玩时间。
- Windows原生桥在系统应用数据目录管理SQLite，只开放四个固定Campaign命令，不向WebView暴露SQL或文件路径。
- Rust复用首版迁移、校验Schema/存档摘要，并以真实SQLite文件验证关闭连接后两次重开仍可恢复列表。
- 归档保留SQLite记录但退出活动列表；继续操作更新SQLite中的updated_at。
- 4项jsdom测试覆盖读取、新建、继续、归档和模拟重启；3项Rust测试覆盖真实持久化、归档和未来Schema拒绝。
- Windows生产构建和Tauri release无bundle构建通过，实际窗口响应且平台数据库成功创建。
- `pnpm check`通过：Vitest 34个文件213项、Node SQLite 7项、Rust 3项及全部类型、lint、格式检查成功。
- 未执行M5-T04。

### Git

- Commit hash：`b885202`。
- Commit message：`feat(M5-T03): add persistent save home`

## 2026-07-31 03:12 — M5-T04 Windows世界创建与预览

- 基础表单覆盖规格中的世界类型、氛围、魔法、规模、黑暗程度、内容许可、排除内容和可选自由构想。
- WindowsWorldCreationService通过共享Fake Provider、Prompt和任务Schema执行生成/细化，不在页面或Rust写死模型结果。
- 世界圣经支持预览、手动编辑、九类字段锁定、自然语言局部修改、全部重生成和确认。
- Rust固定语义命令重新校验跨进程世界、引用、锁定、阶段和验证输出一致性，并原子提交WorldBible、Campaign、GenerationRecord和pending。
- 新增前端服务/页面测试及Rust真实SQLite测试；篡改验证输出或修改锁定字段均不会写入。
- 生产前端和Tauri release构建通过；实际窗口完成基础选项Fake生成和确认，Campaign进入CREATING_CHARACTER。
- 临时端到端测试存档及子记录已级联清理，残留0。
- `pnpm check`通过：Vitest 36个文件218项、Node SQLite 7项、native-bridge Rust 6项及全部类型、lint、格式检查成功。
- 未执行M5-T05。

### Git

- Commit hash：`ece3204`。
- Commit message：`feat(M5-T04): create and confirm offline worlds`

## 2026-07-31 03:31 — M5-T05 Windows车卡流程

- 新增独立分步车卡页，覆盖基础资料、固定职业原型、四属性10点分配、故事偏好和内容边界。
- WindowsCharacterCreationService通过共享Fake Provider、Prompt、任务Schema和输出验证生成六个特质候选、背景及装备描述。
- 特质严格六选二；草稿和候选写入SQLite审计上下文，应用或数据库重开后可恢复选择进度。
- Rust只开放三个固定角色创建命令，并复核Campaign阶段、属性、候选归属、生成输入/上下文及原始/验证输出一致性。
- 完成事务原子写入角色、程序控制装备、生成审计与Campaign的GENERATING_TAVERN状态。
- 世界确认及未完成车卡存档均进入新路由；完成按钮进入既有酒馆生成入口，不实现M5-T06酒馆业务。
- `pnpm check`通过：Vitest 38个文件225项、Node SQLite 7项、native-bridge Rust 8项及全部类型、lint、格式和严格Clippy检查成功。
- Windows生产构建、Tauri release无bundle构建和实际窗口启动响应烟测通过。
- 未执行M5-T06。

### Git

- Commit hash：`7939093`。
- Commit message：`feat(M5-T05): complete offline character creation`

## 2026-07-31 03:50 — M5-T06 Windows酒馆页面

- WindowsTavernService通过统一Fake Provider依次生成酒馆/老板和NPC/传闻，StrictMode并发初始化按Campaign合并为同一Promise。
- Rust新增三个固定语义命令，复核阶段、生成输入/上下文、原始/验证输出、阵容、访客原因、传闻来源和跨Campaign引用。
- 酒馆、老板、关系、有限认知、两名常驻、一名访客、三条传闻、生成审计及Campaign状态分两次原子提交；失败不留下部分阵容。
- 传闻快照只返回陈述和来源NPC，不向页面暴露SQLite中的真实性。
- 初始化事务从已验证的世界核心冲突、酒馆长期问题和剧情线索建立三个程序控制的0/6世界时钟。
- 酒馆页展示描述、规则、长期问题、NPC/访客、传闻、任务入口和世界时钟；NPC可在页内选择，任务入口导航到既有任务路由。
- 未实现NPC对话和任务列表/详情/接受，分别保留给M5-T07与M5-T08。
- `pnpm check`通过：Vitest 40个文件229项、Node SQLite 7项、native-bridge Rust 10项及全部类型、lint、格式和严格Clippy检查成功。
- Windows生产构建、Tauri release无bundle构建和实际窗口启动响应烟测通过。

### Git

- Commit hash：`336aa5f`。
- Commit message：`feat(M5-T06): initialize and render offline tavern`

## 2026-07-31 04:06 — M5-T07 Windows NPC聊天页面

- 酒馆NPC选择可进入独立对话路由，并保留Campaign与NPC作用域。
- 对话页展示SQLite恢复的历史、自由输入、建议话题、NPC公开资料、心情和四维关系。
- Windows服务通过统一Fake Provider、Prompt与NPC_REPLY Schema生成；Rust重建有限认知上下文并逐字段复验。
- 玩家/NPC消息、会话、生成审计、心情与关系在单个SQLite事务中提交，ID与连续序号由原生程序分配。
- 真实SQLite测试覆盖连续两轮、中间重开恢复、建议话题与关系恢复，以及上下文篡改零部分写入。
- `pnpm check`通过：Vitest 42个文件231项、Node SQLite 7项、native-bridge Rust 12项；生产前端和Tauri release构建通过。
- release窗口烟测通过并已停止；未实现M5-T08。

### Git

- Commit hash：`0ed0529`。
- Commit message：`feat(M5-T07): add persistent NPC dialogue`

## 2026-07-31 04:20 — M5-T08 Windows任务页面

- 任务告示从SQLite恢复列表；不足两条时通过统一Fake Provider与GENERATE_QUEST契约补足。
- 删除Fake任务输出中的固定占位NPC引用，发布者改由当前SQLite酒馆NPC明确确定，实体引用校验保持严格。
- 页面展示任务列表、发布者、详情、风险、推荐属性、预计回合、失败代价和奖励级别。
- Rust固定语义命令重建世界、酒馆、角色、当前NPC和最近任务标题上下文，复核8至12回合与引用归属后原子提交。
- 接受任务事务保证同一Campaign只有一个ACCEPTED/ACTIVE主任务；接受后可携带Campaign与Quest ID进入冒险准备入口。
- 真实SQLite测试覆盖两任务、中间重开、单主任务限制、接受状态再次重开，以及上下文篡改零部分写入。
- `pnpm check`通过：Vitest 44个文件233项、Node SQLite 7项、native-bridge Rust 14项；生产前端和Tauri release构建通过。
- release窗口烟测通过并已停止；未实现M5-T09。

### Git

- Commit hash：`66ed01e`。
- Commit message：`feat(M5-T08): add persistent quest board`

## 2026-08-01 — M5-T09 接管、Review 与环境阻塞

- 已确认仓库根目录为 `D:/4D(0801)/4D`、分支 `main`、HEAD `66ed01e`，M5-T08 已提交；接管时暂存区为空，10个未提交文件均属于M5-T09。
- 正常重构了 `adventure_play.rs` 的 `clippy::collapsible_if`，未添加allow或降低检查标准。
- Review发现Fake冒险前7回合全部检定，违反规格2至4次检定；已改为确定性8回合、3次检定、4个无检定中间回合和最终ENDING，并避免重复写入同一Fake世界事实。
- Review发现Provider在玩家行动或D20已持久化后失败时，再试会重复提交；Windows服务现先读取SQLite状态并续跑WAITING_FOR_PLAYER/RESOLVING，不重复写行动或骰点，新增恢复测试。
- Node侧通过：`format:check`、`lint`、`typecheck`、46个Vitest文件237项、Node SQLite 7项及Windows生产前端build；M5-T09定向24项测试通过。
- 硬阻塞：当前机器没有可调用的`cargo.exe`、`rustc.exe`或Rustup安装，PATH和常见C/D盘安装位置均已核查。因此未能运行Rust fmt、严格Clippy、workspace Rust测试、Tauri build及Windows桌面烟测，不能提交或标记M5-T09完成。
- 未执行M5-T10，未暂存或提交任何变更。

### 恢复第一条命令

```powershell
cargo --version
```

确认Rust工具链恢复后，从`cargo fmt --all -- --check`开始，并继续M5-T09完整质量门、Tauri烟测、文档与独立提交。

### 2026-08-01 Rust恢复后的续验结果

- 已确认项目工具链位于`.local/tools/cargo`与`.local/tools/rustup`，并按D盘缓存规则设置`CARGO_HOME`、`CARGO_TARGET_DIR`、`RUSTUP_HOME`、`TEMP`和`TMP`。
- `cargo fmt --all -- --check`通过。
- 严格Clippy启动后失败：MSVC目标找不到`link.exe`；系统中也不存在Visual Studio Build Tools目录或Windows SDK Lib目录。失败发生在依赖build script链接阶段，尚未进入项目源码Clippy，不能视为源码检查通过。
- 因缺少MSVC C++ Build Tools与Windows SDK，Cargo测试、Tauri build及桌面烟测仍无法执行；未暂存、未提交、未进入M5-T10。
- 恢复前需要安装Visual Studio 2022 Build Tools的“Desktop development with C++”及匹配Windows SDK；恢复后第一条项目命令仍为`cargo clippy --workspace --all-targets --all-features -- -D warnings`。

## 2026-08-01 — M5-T09 Windows持久化三栏冒险完成

- Windows冒险页覆盖角色、目标、世界时钟、剧情、建议行动、自由输入、物品、已发现线索与最近一次本地骰点；隐藏AdventurePlan仅进入AI上下文。
- Fake Provider确定性完成8回合，其中3次本地D20、4个无检定中间回合和1个ENDING回合；三条核心线索关联各自发现回合，未重复写Fake世界事实。
- Rust固定命令验证Campaign/Quest/Adventure/Turn归属、状态机、连续序号、输入上下文、AI结构、NPC/线索引用和事实补丁；行动先持久化，骰点只由本地生成，事务失败不留下部分AI结果。
- Provider失败或应用重启后，服务从SQLite续跑WAITING_FOR_PLAYER/RESOLVING，不重复提交行动或骰点；存档首页的ADVENTURE状态正确返回冒险页。
- 实际Tauri烟测发现并修复真实特质ID泄漏到严格AI Schema、冒险继续路由错误和无检定回合遮蔽最近骰点三个问题。
- 完整质量门通过：Vitest 46文件239项、Node SQLite 7项、native-bridge Rust 15项、Rust fmt、严格Clippy、Cargo workspace测试、Windows前端build和Tauri release无bundle build。
- 真实release应用从新建存档完成世界、车卡、酒馆、任务接受、冒险准备、3次D20和8回合ENDING；两次关闭重开均恢复，最终SQLite为8回合/3骰点/3线索/2初始物品，未生成结算、奖励、NPC/时钟/世界变化或ending_json。
- 烟测进程已停止，唯一测试Campaign级联删除后测试SQLite及空应用数据目录也已移除；未执行M5-T10。

### Git

- Commit message：`feat(M5-T09): add persistent three-column adventures`

## 2026-08-01 — M5-T10 结算与冒险档案页面

- 通过Fake Provider的`SUMMARIZE_ADVENTURE`与`GENERATE_WORLD_EVENT`生成提案，共享Schema和Rust领域边界双重验证；NPC与时钟使用当前SQLite上下文中的真实ID。
- 新增固定Tauri结算/档案命令；单个SQLite立即事务提交Quest COMPLETED、Adventure SETTLED、NPC心情与关系、酒馆变化、程序控制奖励、世界事实、时钟、四类事件、两份AI审计和Campaign返回TAVERN。
- 结算服务按Campaign单飞；原生事务处理并发，重复提交返回既有档案。未知时钟失败测试确认不留下奖励或状态部分写入。
- 档案页展示摘要、关键选择、骰子、参与NPC、未解决线索、酒馆变化、奖励、世界事实、后续方向及模型/Prompt版本；返回酒馆可见陈设、NPC心情和时钟变化。
- 完整`pnpm check`、Cargo metadata/fmt/严格Clippy/workspace测试、Windows前端build和Tauri release无bundle build通过；Vitest 48文件242项、Node SQLite 7项、Rust 16项。
- release烟测完成真实8回合/3骰点结算、档案、返回酒馆和关闭重启恢复；SQLite中结算生成与四类事件均各一份。唯一测试Campaign已级联删除并VACUUM，剩余0条。
- Review修复冒险快照遗漏publisherNpcId导致准备页无法载入、Fake固定符号ID无法匹配UUID、并发状态检查位于事务外、AI审计未比对原始响应以及结算事件不完整等问题。
- 下一任务：M5-T11 Windows离线纵向切片验收。

## 2026-08-01 — M5-T11 Windows离线纵向切片验收

- 最终release应用使用全新存档完成：世界创建→车卡→酒馆→NPC自由对话→接受任务→冒险准备→8回合/3次本地D20→结算→档案→返回酒馆。
- 关闭并重启后，NPC双方消息、关系、档案骰子和模型/Prompt审计、奖励、世界事实、酒馆TROPHY、NPC Relieved心情与1/6世界时钟均从SQLite恢复。
- SQLite核对Campaign TAVERN、Quest COMPLETED、Adventure SETTLED/8回合、3骰点、2条对话消息、3件物品、1条结算世界事实和非空ending_json。
- M5-T11仅为验收任务，没有新增或修改源码；未提前实现spec 33.4中属于后续任务的模型切换、导出/删除/导入。
- 验收进程停止，唯一测试Campaign按精确ID级联删除并VACUUM，剩余0条。
- 下一任务：M6-T01 Rust安全HTTP传输层；未经付费确认不得进行真实模型调用。

## 2026-08-01 — M6-T01 Rust安全HTTP传输层

- 新增Rust内部`ember-secure-http` crate：审批基地址仅接受远程HTTPS或回环HTTP，拒绝凭证、查询、片段、缺失尾斜杠和路径逃逸；客户端禁止重定向。
- 实现GET/POST请求、敏感Header脱敏、全流程超时、显式取消、流式逐块读取、响应大小硬上限和不含原始请求信息的稳定错误分类。
- 最初本地HTTP测试服务器错误等待固定4096字节并造成假超时；改为读取至HTTP头结束且用Notify同步后，7项传输测试全部通过。
- Reqwest/Rustls依赖使用项目D盘Cargo缓存；未使用API Key、真实模型或收费调用。WebView capability仍为`core:default`且未新增HTTP命令。
- Cargo metadata/fmt、workspace严格Clippy、23项Rust测试、`pnpm check`（48文件242项Vitest、7项Node SQLite）、Windows前端build与Tauri release无bundle build通过。
- Review确认超时覆盖完整流、取消同时覆盖请求与流、错误不保留原始URL/正文、请求Debug不暴露Header值或Body；未实现M6-T02。
- 下一任务：M6-T02安全密钥仓库。

## 2026-08-01 — M6-T02 安全密钥仓库

- 新增`ember-secure-secrets`，使用Windows Credential Manager的Local持久化；数据库与WebView只接触`credential:v1:<UUID>`引用。
- Tauri注册规格允许的`secret_save`、`secret_exists`、`secret_delete`固定命令，不提供明文读取命令；内部Provider读取通过短生命周期闭包完成。
- 保存值限制1至2048字节并拒绝NUL；输入、存在检查和内部读取产生的内存副本均使用zeroize清零，错误不包含底层异常或秘密。
- 依赖Review从一体化keyring缩减为MIT/Apache-2.0的`keyring-core 1.0.0`与`windows-native-keyring-store 1.1.0`，没有引入其他平台后端。
- Windows系统存储真实往返测试使用运行时随机值，清理守卫删除条目；测试后Ember目标残留为0。SQLite既有迁移测试继续验证provider配置没有密钥列。
- workspace严格Clippy、26项Rust测试、`pnpm check`（48文件242项Vitest、7项Node SQLite）、Windows前端build与Tauri release无bundle build通过。
- 下一任务：M6-T03 OpenAI-Compatible适配器；仍禁止未经确认的真实或收费调用。

## 2026-08-01 — M6-T03 OpenAI-Compatible适配器

- 新增Rust `ember-provider-openai-compatible`：支持普通文本、JSON Object、模型列表、连接测试及Chat Completions响应归一化。
- 请求严格验证并复用审批端点、超时/取消/大小上限和系统凭据；认证Header标记敏感，错误不保留原始请求或响应。
- 响应映射Provider请求ID、模型、首选项内容、结束原因、用量和RFC3339接收时间；空模型、空choices、空内容和无效JSON拒绝。
- JSON Schema在本任务显式Unsupported，未静默降级或提前实现后续能力；未新增Tauri Provider命令或厂商预设。
- 5项本地Provider Contract Test覆盖文本、JSON模式、模型列表/连接测试、Windows凭据认证、401/429/500、无效响应和完整错误映射；本地服务器绑定回环地址。
- 认证测试加入Drop清理守卫，测试后Credential Manager残留为0；未调用真实或收费API。
- `pnpm check`、Cargo metadata/fmt/严格Clippy、31项Rust测试、Windows前端build和Tauri release无bundle build通过。
- 下一任务：M6-T04 DeepSeek预设。

## 2026-08-01 — M6-T04 DeepSeek预设

- 按DeepSeek官方当前文档新增预设：`https://api.deepseek.com/`、默认`deepseek-v4-flash`，另支持`deepseek-v4-pro`。
- 两模型登记JSON模式、推理与1M上下文；价格/免费状态不硬编码。已于2026-07-24弃用的旧模型别名不进入预设。
- 生产配置必须持有系统CredentialRef；回环覆盖函数仅在测试构建可见。
- 本地合同测试完成模型列表和中文世界JSON生成，内容包含世界摘要、冲突、规则、势力、地点、叙事风格、酒馆理由与剧情钩子。
- 6项Provider测试及完整`pnpm check`通过；Windows前端与Tauri release无bundle build通过。
- 未向DeepSeek或其他外部服务发请求，未使用真实凭据或产生费用。
- 下一任务：M6-T05 Qwen预设。

## 2026-08-01 — M6-T05 Qwen预设

- 按阿里云百炼官方当前文档新增北京OpenAI兼容预设，默认`qwen3.7-plus`，并登记`qwen3.7-max`与`qwen3.7-flash`。
- 三模型登记1M上下文、推理和JSON模式；价格/免费状态不硬编码，旧`qwen-plus`不进入当前模型集。
- 本地合同测试分别执行中文NPC文本回复和完整结构化任务，验证中文内容、8至12回合、推荐属性及JSON请求格式。
- 7项Provider测试及完整`pnpm check`通过；Windows前端与Tauri release无bundle build通过。
- 未向百炼或其他外部服务发请求，未使用真实凭据或产生费用。
- 下一任务：M6-T06 SiliconFlow或OpenRouter预设。

## 2026-08-01 — M6-T06 OpenRouter预设

- 采用OpenRouter官方OpenAI兼容地址；生产配置继续只接受系统CredentialRef。
- 扩展动态模型信息，展示服务端名称与上下文，并从完整pricing对象保守判定Free/Paid/Unknown，不硬编码免费模型ID或免费状态。
- 本地合同服务在运行时提供一个零价格模型，以该模型完成结构化冒险回合；没有发起真实外部调用。
- `pnpm check`通过：48个Vitest文件242项、7项Node SQLite和34项Rust测试；严格Clippy、格式、lint和类型检查通过。
- Windows前端生产build及Tauri release `--no-bundle`通过。
- 下一任务：M6-T07 Ollama预设。

## 2026-08-01 — M6-T07 Ollama预设

- 新增`http://localhost:11434/v1/`无凭据预设，复用仅允许回环明文HTTP的安全传输边界。
- 隔离本地合同服务器验证模型列表、无认证头、模型选择和JSON Object结构化冒险回合；无需互联网。
- 当前机器`ollama`命令不存在，未执行或伪造真实已安装模型测试。
- `pnpm check`通过：48个Vitest文件242项、7项Node SQLite和35项Rust测试；Windows前端及Tauri release无bundle build通过。
- 下一任务：M6-T08自定义Base URL配置。

## 2026-08-01 — M6-T08 自定义Base URL配置

- 新增自定义OpenAI兼容配置，支持Base URL、模型名、CredentialRef和受限非秘密附加Header。
- 自动规范尾斜杠，远程仅HTTPS、本地仅回环HTTP；拒绝认证、API Key、Host及传输保留Header，最多16项且统一脱敏。
- 本地合同测试完成自定义服务文本生成并验证Header与拒绝路径；没有真实外部调用。
- `pnpm check`通过48个Vitest文件242项、7项Node SQLite和36项Rust测试；Windows前端与Tauri release无bundle build通过。
- 下一任务：M6-T09模型设置页面。

## 2026-08-01 — M6-T09 模型设置页面

- 新增Windows模型设置页和固定语义命令：Provider、Base URL、API Key、连接测试、模型列表、默认与备用模型。
- API Key只进入系统凭据库；SQLite只保存CredentialRef，页面读取快照只显示hasCredential。
- 全局设置事务写provider_configs/model_profiles/app_settings；真实SQLite重开测试确认Campaign状态与时间均未变化。
- Review补齐CredentialRef存在性验证与连接测试临时密钥清理；secure-http补齐自身使用的Tokio macros特性声明。
- `pnpm check`通过50个Vitest文件244项、7项Node SQLite和37项Rust测试；Windows两项构建和隔离release窗口烟测通过并清理。
- 下一任务：M6-T10模型能力登记与路由。
