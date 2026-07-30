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

- Commit hash：待提交。
- Commit message：`feat(M2-T03): implement campaign repository`
