# Ember Tavern 开发日志

本文件按任务记录实际变更、验证证据、限制和后续边界。每次完成任务后追加记录，不覆盖历史。

## 2026-07-30 — M0-T01 初始化 Git 仓库和基础规范

### 范围

- 初始化 Git 仓库。
- 添加 `.gitignore`、`.editorconfig`、根目录 `README.md` 和长期开发规则。
- 将产品规格与任务文档归档到 `docs/`。
- 建立开发日志和架构决策记录。

### 需求审查

- `M0-T01` 无前置依赖，当前可执行。
- 酒馆 NPC 数量的两种表述按 `DEC-001` 统一理解，不扩大产品范围。
- 未发现阻塞 `M0-T01` 的规格冲突或无法执行设计。
- iOS 构建需要 macOS/Xcode；这是后续 iOS 阶段的环境约束，不影响本任务。

### 验证

- 基础文件检查：8 个必需文件全部存在。
- 长期规则检查：`AGENTS.md` 中 19 条指定规则全部命中。
- README 检查：项目目标、文档入口、当前启动说明、分支和 commit 格式均存在。
- 范围检查：未发现 `package.json`、`pnpm-workspace.yaml`、`Cargo.toml`、`windows-app/` 或 `ios-app/`。
- Git 检查：当前分支为 `main`；`node_modules/`、`target/`、`.env` 和本地数据库忽略规则均命中；本任务使用独立 staged diff 提交。
- 测试、类型检查、lint、构建：当前任务尚未创建代码或 workspace，因此没有适用命令。

### 明确未执行

- 未创建 pnpm 或 Cargo workspace。
- 未执行 `M0-T02` 或任何后续任务。
- 未实现游戏功能、真实模型接入或 iOS 客户端。

## 2026-07-30 — M0-T02 创建 pnpm 与 Cargo Workspace

### 范围

- 创建私有根 `package.json`，统一编排 workspace 的 `lint`、`test` 和 `typecheck`。
- 创建 `pnpm-workspace.yaml`，声明后续 Windows、iOS 和共享包路径，但不提前创建这些目录。
- 创建虚拟根 `Cargo.toml`，以 `crates/*` 作为后续原生 crate 成员模式并使用 resolver 2。
- 生成最小 `pnpm-lock.yaml`，固定当前无依赖根 workspace。
- 更新 README 的环境要求和根命令说明。

### 实现选择

- 根 pnpm 命令使用递归 `--if-present` 编排：当前无子项目时成功结束，后续成员创建真实脚本后自动纳入。
- 未添加 ESLint、Vitest、TypeScript 或 Rust 依赖；这些属于后续质量与具体包任务。
- 未产生需要写入 `docs/DECISIONS.md` 的重大架构决定。

### 验证

- `pnpm install --frozen-lockfile`：通过。
- `pnpm lint`：通过；当前无匹配子项目。
- `pnpm test`：通过；当前无匹配子项目。
- `pnpm typecheck`：通过；当前无匹配子项目。
- Node 配置断言：通过；根包为 private，三个脚本与预期一致。
- `pnpm --recursive list --depth -1`：通过；识别私有根 workspace。
- `cargo test --workspace`：未通过；当前环境未安装 Cargo，命令返回 `CommandNotFoundException`。

### 验收状态

- pnpm 根级 lint：通过。
- pnpm 根级 test：通过。
- Cargo workspace 文件：已创建；`cargo test --workspace` 因缺少工具链尚未验证。
- 因 Cargo 验收未完成，任务标记为“实现完成，验收受环境限制”，不能据此自动开始 `M0-T03`。

### 明确未执行

- 未创建 `windows-app/`、`ios-app/`、`packages/`、`crates/` 或数据库目录。
- 未实现应用功能、数据库业务表、AI 接口、页面或真实模型接入。
- 未执行 `M0-T03` 或任何后续任务。

## 2026-07-30 — M0-T02 Rust/Cargo 环境补齐与复验

### 环境处理

- 初检时 `rustup`、`rustc`、`cargo` 和 `winget` 均不可用。
- winget 在当前环境及常见路径不可用，因此从 Rust 官方地址下载 `rustup-init.exe`。
- 首次 `rustup-init.exe -y` 下载在超时后停滞；确认 partial 文件不再增长后终止该进程。
- 使用已安装的官方 rustup，通过 `RUSTUP_USE_CURL=1` 恢复 stable 工具链安装并成功完成。
- 已将 `C:\Users\PC\.cargo\bin` 写入当前用户 PATH；未安装无关软件。

### 工具链版本

- Rustup：`rustup 1.29.0 (28d1352db 2026-03-05)`。
- Rustc：`rustc 1.97.1 (8bab26f4f 2026-07-14)`。
- Cargo：`cargo 1.97.1 (c980f4866 2026-06-30)`。
- 默认工具链：`stable-x86_64-pc-windows-msvc`。
- 已安装目标：`x86_64-pc-windows-msvc`。

### Cargo 复验结果

- 未修改配置时执行 `cargo metadata --format-version 1`：失败，退出码 101。
- 未修改配置时执行 `cargo test --workspace`：失败，退出码 101。
- 两者均报告 `failed to load manifest for workspace member ...\crates\*`，因为 `crates/` 要到 `M0-T03` 才创建。
- 依照最小修复原则临时验证 `members = []`：`cargo metadata` 仍失败，报告 `The manifest is virtual, and the workspace has no members`。
- 临时修改已完全撤销，`Cargo.toml` 恢复为本轮开始时的 `members = ["crates/*"]`。
- 未创建 crate、应用目录、根占位 package 或任何 `M0-T03` 内容。

### 其他验证

- `pnpm lint`：通过；当前无匹配子项目。
- `pnpm test`：通过；当前无匹配子项目。
- `pnpm typecheck`：通过；当前无匹配子项目。

### 边界判断与状态

- Cargo 1.97.1 的虚拟 workspace 必须至少包含一个真实 package。
- `M0-T02` 要求空 workspace 通过 `cargo test --workspace`，但第一个真实 crate 按任务顺序属于 `M0-T03`。
- 创建占位 crate 或提前创建 `crates/` 成员会违反任务边界和禁止伪实现规则，因此未执行。
- 依据 `DEC-002`，`M0-T02` 的 Cargo 部分以根 virtual workspace 静态配置检查完成；根 `Cargo.toml` 保持提交 `96eabb7` 中的配置不变。
- `cargo metadata --format-version 1` 和 `cargo test --workspace` 的动态验证延后至 `M0-T03` 创建首个真实 crate 后执行，且在两项验证成功前不得关闭 `M0-T03`。
- 该处理只调整验证时机，不删除或降低 Cargo 验收标准。
- `M0-T02` 已完成；`M0-T03` 未开始，未创建占位 crate、package 或应用目录。

## 2026-07-30 22:18 — 自动开发启动基线

### 输入与依赖

- 用户授权从 `M0-T03` 起持续执行全部剩余任务；`M0-T01`、`M0-T02` 已完成，Git 工作树启动时干净。
- 完整读取根 `AGENTS.md`、规格、任务、开发日志、决策、README，并确认没有子目录规则文件。

### 修改文件

- `.gitignore`：忽略 `.local/`。
- `pnpm-workspace.yaml`：将 pnpm store 固定到 `.local/cache/pnpm-store`。
- `LOG.md`：建立按任务追加的审计日志。
- `docs/CONTEXT_HANDOFF.md`：建立可恢复上下文摘要。

### 环境与验证

- 建立 `.local/cache/{pnpm-store,cargo,npm,temp}`、`.local/{tools,downloads,build,reports}` 等本地目录，均被 Git 忽略。
- 使用已有工具链验证：Node.js `v24.17.0`、pnpm `11.9.0`、Rustup `1.29.0`、Rustc/Cargo `1.97.1`。
- 在 `CARGO_HOME` 和 `CARGO_TARGET_DIR` 指向项目 `.local/` 时，现有 `cargo.exe` 与 `rustc.exe` 仍可用。
- 未下载依赖、未安装软件、未创建 crate、package 或应用功能。

### 下一步

- 从 `M0-T03` 创建目录骨架和首个真实 crate，并按 `DEC-002` 执行 Cargo workspace 动态验证。

## 2026-07-30 22:19 — M0-T03 创建项目目录骨架（开始）

### 输入任务与依赖

- 依赖 `M0-T02`：已完成。
- 按 `DEC-002`，本任务创建首个真实 crate 后必须完成 Cargo workspace 动态验证。

### 本轮范围与计划文件

- 新增 `windows-app/package.json`、`ios-app/package.json`。
- 新增 `packages/contracts`、`domain`、`application`、`persistence`、`ai-core`、`prompts`、`ui-kit`、`test-fixtures` 的 package manifest。
- 新增 `crates/native-bridge/Cargo.toml` 与可编译的 crate 根文件。
- 新增 `database/migrations/README.md`。
- 完成后更新 `README.md`、`docs/TASKS.md`、`LOG.md` 和 `docs/CONTEXT_HANDOFF.md`。

### 计划验证

- pnpm workspace 成员识别与根 `lint`、`test`、`typecheck`。
- Cargo metadata、格式检查和 workspace 测试。

### 明确不处理

- 不初始化 React、Tauri、TypeScript 质量工具、数据库迁移或任何游戏功能。
- 不创建未具备真实职责的未来 Rust crate。

### 完成结果与验收

- pnpm 识别根项目、两个应用 package 和八个共享 package，共 11 个 workspace 项目。
- 根 Cargo workspace 识别首个真实 crate：`ember-native-bridge`。
- `pnpm --recursive list --depth -1`：通过。
- `pnpm lint`、`pnpm test`、`pnpm typecheck`：通过；当前成员尚无质量脚本，根编排命令正常结束。
- `cargo metadata --format-version 1`：通过，workspace member 与 default member 均为 `ember-native-bridge`，target 位于 `.local/build/cargo-target`。
- `cargo fmt --all -- --check`：通过。
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`：通过。
- `cargo test --workspace`：通过，0 个单元测试、0 个文档测试；本任务没有业务逻辑需要测试。
- `DEC-002` 要求的 Cargo 动态验证已完成。

### 自审与范围核对

- 所有任务列出的 pnpm workspace 目录均有有效、唯一的 package manifest。
- `native-bridge` 是可编译的真实 crate，只声明原生边界和禁止 unsafe，不包含占位返回值或未来功能。
- 未创建其他无实现目的的 Rust crate；未初始化 React、Tauri、数据库迁移或应用功能。
- `M0-T03` 验收通过并标记完成；下一任务为 `M0-T04`。

## 2026-07-30 22:25 — M0-T04 建立代码质量检查（开始）

### 输入任务与依赖

- 依赖 `M0-T02`：已完成；`M0-T03` 也已完成并通过 workspace 动态验收。

### 本轮范围与计划文件

- 更新 `package.json`、`pnpm-lock.yaml`、根 Cargo lint 配置和 `crates/native-bridge/Cargo.toml`。
- 新增 `tsconfig.base.json`、`tsconfig.json`、ESLint、Prettier、Rustfmt 与基础 CI 配置。
- 更新任务状态、README、审计日志与上下文交接。

### 计划验证

- `pnpm install --frozen-lockfile`、`pnpm format:check`、`pnpm lint`、`pnpm test`、`pnpm typecheck`。
- `cargo fmt --all -- --check`、严格 Clippy、`cargo test --workspace`、Cargo metadata。

### 明确不处理

- 不定义 M1 领域类型，不初始化 React/Tauri，不新增数据库或 AI 功能。

### 完成结果与验收

- 安装并精确锁定 `@eslint/js 10.0.1`、`eslint 10.8.0`、`prettier 3.9.6`、`typescript 5.9.3`、`typescript-eslint 8.65.0`、`vitest 4.0.18`；下载与 store 均位于 `.local/cache/pnpm-store`。
- 首次解析到 TypeScript 7.0.2，超出 `typescript-eslint` 的 `<6.1.0` peer 范围；改为兼容的 5.9.3 后 `pnpm peers check` 通过。
- Vitest 4.1.10 的传递 WASM peer 存在冲突；改为 4.0.18 后冲突消失。
- pnpm 供应链保护拦截 esbuild 构建脚本；在 `pnpm-workspace.yaml` 中仅允许 `esbuild` 构建后安装成功，没有放宽其他依赖脚本权限。
- `pnpm install --frozen-lockfile` 与 `pnpm peers check`：通过。
- 刷新已有 Cargo PATH 后，根组合质量门 `pnpm check`：通过。
- `pnpm format:check`：通过。
- `pnpm lint`：通过，零 warning。
- `pnpm typecheck`：通过，严格 TypeScript 配置生效。
- `pnpm test`：通过；当前无业务测试文件，Vitest 按配置返回 0 测试成功。
- `cargo fmt --all -- --check`：通过。
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`：通过。
- `cargo test --workspace` 与 Cargo metadata：通过。

### CI 验收

- `.github/workflows/ci.yml` 在 Windows runner 上配置冻结依赖安装、格式、lint、类型、TypeScript 测试、Rust fmt、Clippy 和 Rust 测试。
- 本地逐项运行了 CI 中的全部质量命令并通过；GitHub 托管执行需仓库推送后由外部服务触发，当前未伪造远端运行结果。

### 自审与里程碑 M0 Review

- TypeScript 严格选项包含未检查索引、精确可选属性、隐式 override、switch fallthrough 和 catch unknown 等边界检查。
- ESLint 对 TypeScript 使用 project service，并将 warning 上限设为 0；Prettier 排除需求、日志和锁文件，避免自动改写验收文档。
- Rust workspace lint 禁止 unsafe 并启用 Clippy `all`，成员显式继承。
- 搜索 TODO、FIXME、HACK、TEMP、placeholder、dummy、未实现宏、panic 和 console.log；命中仅为文档术语或忽略规则，没有生产占位实现。
- M0 全部任务验收通过，工作区成员与质量命令可从根项目统一执行。
- 检查 C 盘常见 npm、pnpm 与 Cargo registry 缓存位置：本轮开始后新增文件数均为 0；依赖实际写入项目 `.local`。
### 组合命令环境修复

- 首次执行 `pnpm check` 时，TypeScript 检查全部通过，但 Rust 阶段报告 `cargo is not recognized`。
- 根因是当前 Codex PowerShell 在 Rust 安装前启动，进程 PATH 未刷新；Cargo 本体已存在且单独用绝对路径验证通过。
- 将已有 `%USERPROFILE%\.cargo\bin` 加入当前进程 PATH 后重跑原组合命令；未硬编码项目脚本、未跳过 Rust 检查。

## 2026-07-30 22:37 — M1-T01 定义通用 ID、时间和版本类型（开始）

### 依赖与范围

- 依赖 `M0-T03`：已完成；M0 质量门已建立。
- 仅修改 contracts 基础协议、测试及任务文档，不定义 `M1-T02` Campaign 状态机或其他未来实体。

### 计划验证

- Vitest 覆盖 ID、时间、版本、枚举已知/未知分支与非法输入。
- 根 `pnpm check` 和 Cargo workspace metadata 回归。

### 完成结果与验收

- 新增五类 brand ID 及唯一公共构造路径；空值和首尾空白被拒绝。
- 新增 canonical UTC `IsoTimestamp`、正整数 `SchemaVersion` 与 `PromptVersion`。
- 新增 `CompatibleEnum`：已知值保持窄类型，未知值保留原始字符串供前向兼容。
- contracts package 声明真实类型出口；没有引入新运行时依赖。
- 首次写文件脚本因 `Test-Path` 与变量缺少空格而未创建 `src/`；确认仅 manifest 写入后修正脚本并重放，没有遗留半成品。
- `pnpm check`：通过；Vitest 1 个文件、15 个测试全部通过，TypeScript、ESLint、Prettier和Rust回归通过。
- `DEC-003` 记录基础序列化协议选择。

### 自审

- 编译期测试确认 `CampaignId` 与 `NpcId` 不相等；其他 ID 使用同一隔离机制。
- 测试覆盖五类 ID、非法 ID、时间戳、无效版本、已知与未知枚举分支。
- 未定义 Campaign 状态机或任何 M1-T02 以后内容。

## 2026-07-30 22:42 — M1-T02 定义 Campaign 与状态机协议（开始）

### 依赖与范围

- 依赖 `M1-T01`：已完成并提交 `855c93f`。
- 仅定义 Campaign 生命周期协议及测试，不提前实现世界、角色、数据库或用例。

### 计划验证

- 合法正常迁移、世界重生成、异常暂停与恢复、归档成功。
- 跳阶段、错误恢复、归档后迁移和时间倒退被拒绝。
- 根 `pnpm check` 全量回归。

### 完成结果与验收

- 定义七个正常阶段、三个可恢复异常状态和终态 `ARCHIVED`。
- `Campaign` 使用 `CampaignId`、`SchemaVersion`、`IsoTimestamp`，未出现含义不明的裸 ID。
- 正常迁移表覆盖规格流程，并允许 REVIEWING_WORLD 返回 CREATING_WORLD 进行重新生成。
- 异常状态保存 `resumeState`，只能恢复被中断阶段；异常之间切换保留恢复目标。
- 归档对所有非归档状态开放，归档后禁止任何迁移；状态更新返回新对象。
- 首次类型检查发现测试动态索引可能为 `undefined`；测试辅助函数增加显式越界拒绝后通过，未使用非空断言绕过。
- `pnpm check`：通过；2 个测试文件、25 个测试全部通过，新增 Campaign 测试 10 项。
- `DEC-004` 记录异常恢复约束。

### 自审

- 覆盖正常全流程、重新生成、异常进入/切换/恢复、归档、非法跳转、重复状态、时间倒退和不可变性。
- canonical UTC 字符串固定长度，迁移时间采用词法比较与实际时间顺序一致。
- 未实现 M1-T03 世界协议、持久化或应用用例。

## 2026-07-30 22:46 — M1-T03 定义世界圣经与世界事实协议（开始）

### 依赖与范围

- 依赖 `M1-T01`：已完成；`M1-T02` 也已完成。
- 仅定义世界协议与测试，不实现 AI 生成、修改、数据库或 UI。

### 计划验证

- 可表达规格要求的完整 WorldBible、Faction 与 Location。
- 可表达锁定、发展、临时、传闻、错误认知以及发展事实替代链。
- 根 `pnpm check` 全量回归。

### 完成结果与验收

- `WorldBible` 覆盖名称、当前地区、简介、核心冲突、技术水平、力量规则、势力、地点、叙事风格、禁止内容、酒馆原因、剧情线索和锁定字段。
- `Faction` 支持目标与带品牌 FactionId 的关系；`Location` 支持父地点和控制势力引用。
- 为 Faction、Location、WorldFact 增加不透明 ID 与构造器，并纳入基础 ID 测试。
- `WorldFact` 判别联合完整覆盖锁定规则、发展事实、临时叙述、传闻和错误认知。
- 发展事实使用 `supersedesFactId` 表达追加式变化；传闻保存真实性，错误认知保存 `NpcId` 列表。
- `pnpm check`：通过；3 个测试文件、29 个测试全部通过，新增世界协议测试 4 项。
- `DEC-005` 记录事实分类与演进策略。

### 自审

- 所有实体关系均使用对应 brand ID；未使用含义不明的裸字符串 ID。
- WorldBible 示例包含规格要求的全部生成字段，五类事实均有构造与判别测试。
- 未实现 AI 生成、世界修改用例、数据库或 M1-T04 角色协议。

## 2026-07-30 22:49 — M1-T04 定义玩家角色协议（开始）

### 依赖与范围

- 依赖 `M1-T01`：已完成；世界协议已在 M1-T03 完成。
- 仅定义角色协议和属性规则，不实现物品效果、AI 生成、数据库或 UI。

### 计划验证

- 合法属性分配成功，超出 1 至 5、总点数不为 10 或非整数被拒绝。
- 完整角色可表达规格要求的全部字段。
- 根 `pnpm check` 全量回归。

### 完成结果与验收

- `PlayerCharacter` 覆盖基础信息、故事偏好、内容边界、固定职业原型与世界化展示名、属性、两个特质、个人目标、背景和初始装备引用。
- 新增 PlayerCharacter、CharacterTrait、Item 的不透明 ID，所有实体引用保持类型隔离。
- `createPlayerAttributes` 强制四项属性为整数 1 至 5且总和 10，并返回冻结对象。
- 初始装备只引用 `ItemId`，未提前定义 M1-T06 的物品效果或奖励等级。
- `pnpm check`：通过；4 个测试文件、38 个测试全部通过，新增角色测试 9 项。

### 自审

- 测试覆盖合法分配、上下界、非整数、错误总点数、不可变结果和完整角色结构。
- 职业 `classArchetype` 固定为四种规则原型，`classDisplayName` 只负责世界观包装。
- 两个已选特质由只读二元组约束；未提前实现特质生成或角色用例。

## 2026-07-30 22:52 — M1-T05 定义酒馆与 NPC 协议（开始）

### 依赖与范围

- 依赖 `M1-T03`、`M1-T04`：均已完成。
- 仅定义酒馆/NPC协议和关系、知识边界测试，不实现传闻、任务、数据库或聊天用例。

### 计划验证

- 四维关系各自接受 -5 与 5，拒绝越界和非整数。
- 两个 NPC 的知识集合独立复制和冻结，互不污染。
- 根 `pnpm check` 全量回归。

### 完成结果与验收

- 定义 Tavern、TavernChange、NpcProfile、NpcKnowledge、NpcRelationship、NpcMemory 和 TemporaryVisitor。
- Tavern 分离老板、常驻 NPC 与访客引用，可表达 DEC-001 的三名常驻角色加一名访客；变化支持纪念物、菜单、损坏、装饰和布局等类别。
- NPC资料覆盖身份、外貌、性格、目标、秘密、语言风格、情绪、居留类型和当前状态。
- `createNpcRelationship` 对信任、亲近、敬畏和亏欠四维逐项强制整数 -5 至 5，并冻结结果。
- `createNpcKnowledge` 复制并冻结每个 NPC 的已知、怀疑、错误认知和明确不可知事实列表，避免共享数组污染。
- 初次 lint 拒绝无新增成员的 `NpcKnowledgeInput` 接口；改为等价类型别名后通过。
- 自审将第三维英文名从过窄的 `fear` 修正为规格语义 `awe`。
- `pnpm check`：通过；5 个测试文件、46 个测试全部通过，新增酒馆/NPC测试 8 项。

### 自审

- 关系边界 -5、0、5 与越界 -6、6、非整数均有测试。
- 两个 NPC 从同一来源数组创建知识后保持独立，来源后续变化不会污染存储结果。
- 临时访客只引用 NPC profile，不复制角色卡；未提前实现传闻、任务、数据库或聊天用例。

## 2026-07-30 22:56 — M1-T06 定义传闻、任务和物品协议（开始）

### 依赖与范围

- 依赖 `M1-T03`、`M1-T05`：均已完成。
- 仅定义协议和结构测试，不实现任务状态迁移、接受任务、奖励发放或持久化。

### 计划验证

- AI名称/描述与程序效果字段在类型结构上分离。
- Quest 覆盖规格规定的发布者、目标、风险、推荐属性、长度、奖励、关联和失败代价。
- 根 `pnpm check` 全量回归。

### 完成结果与验收

- 定义 Rumor、Quest、QuestStatus、QuestRisk、RewardTier、Item 和判别联合 ItemEffect。
- Rumor 将玩家可见 `content` 与隐藏真实性分开，并关联 Tavern、NPC 和 WorldFact brand ID。
- Quest 覆盖标题、发布者、简介、目标、风险、推荐属性、预计回合、奖励等级、关联NPC/事实及失败代价。
- Item 将 AI可生成名称/描述放在 `content`，程序效果限制为 NONE、检定修正、重掷或消耗恢复等判别分支。
- 新增 RumorId 与构造器；未新增运行时依赖。
- `pnpm check`：通过；6 个测试文件、49 个测试全部通过，新增任务/物品测试 3 项。
- `DEC-006` 记录 AI创作字段与程序规则字段的物理分离。

### 自审

- 测试证明同一 `content` 可对应 NONE 或 CHECK_MODIFIER，不会从文本推断规则。
- Quest 所有规格结构字段均有完整实例验证；传闻真实性不混入玩家文本。
- 未实现任务迁移、接受任务、奖励发放、数据库或 M1-T07 冒险协议。

## 2026-07-30 22:58 — M1-T07 定义冒险协议（开始）

### 依赖与范围

- 依赖 `M1-T04`、`M1-T06`：均已完成。
- 仅定义协议与状态机，不实现随机数、D20结算、持久化或用例。

### 计划验证

- 完整冒险状态流程和合法分支成功，跳阶段与 SETTLED 后迁移被拒绝。
- 8至12回合计划、核心线索、检定请求和骰子记录可表达。
- 根 `pnpm check` 全量回归。

### 完成结果与验收

- 定义 AdventurePlan、Adventure、AdventureState、AdventureTurn、PlayerAction、CheckRequest、DiceResult、AdventureEnding 和 Clue。
- AdventurePlan 可表达8至12回合、核心场景、至少三条必要线索、障碍、至少两个结局与失败代价，并与玩家回合文本分离。
- 状态表覆盖 PREPARING、SCENE、WAITING_FOR_PLAYER、CHECK_REQUIRED、RESOLVING、ENDING、SETTLED，支持有/无检定回合和提前进入结局。
- SETTLED 为终态；非法跳阶段由 `AdventureTransitionError` 拒绝。
- PlayerAction 使用判别联合，自由输入、建议选项、使用物品和退出意图独立；建议选项自审后改用 ActionOptionId，未保留裸 optionId。
- CheckRequest 使用固定难度 8、11、14、17；DiceResult只记录本地程序将提供的骰面、修正、总值与成功标记，本任务不生成结果。
- `pnpm check`：通过；7 个测试文件、58 个测试全部通过，新增冒险测试9项。

### 自审

- 测试覆盖完整检定路径、无检定分支、两种进入结局路径、四类非法迁移、隐藏计划和回合记录。
- 新增 CheckRequestId、ClueId、ActionOptionId，所有语义 ID 都是brand。
- 未实现随机源、D20计算、持久化或冒险用例。

## 2026-07-30 23:01 — M1-T08 实现 D20 规则引擎（开始）

### 依赖与范围

- 依赖 `M1-T04`、`M1-T07`：均已完成。
- 仅实现纯领域D20计算和测试，不实现原生随机服务、冒险用例或持久化。

### 计划验证

- 固定随机源验证边界与公式。
- 输入校验拒绝非1至20骰面、非法属性和非整数修正。
- 根 `pnpm check` 全量回归。

### 完成结果与验收

- domain package 声明对 contracts 的 `workspace:*` 依赖和真实出口；离线 pnpm安装仅更新workspace锁关系，下载0项。
- `resolveD20Check` 实现 D20 + 属性 + 装备 + 状态修正 ≥ 难度，并返回 contracts `DiceResult`。
- 难度运行时仅允许8、11、14、17；属性限制1至5，骰面限制1至20，修正和总值必须为安全整数。
- 随机源仅暴露 `nextD20()`，领域代码不依赖 `Math.random`、平台API或AI。
- `pnpm check`：通过；8个测试文件、71个测试全部通过，D20新增13项。
- `DEC-007` 记录随机源注入和本地结算边界。

### 自审

- 四档难度均测试恰好等于成功；另测低一失败、正负修正、骰面1/20和0/21/小数/NaN拒绝。
- 返回结果冻结且保留CheckRequestId，公式字段可审计。
- 未实现原生骰子服务、冒险用例、数据库或M1-T09。

## 2026-07-30 23:05 — M1-T09 实现关系与世界时钟规则（开始）

### 依赖与范围

- 依赖 `M1-T05`、`M1-T07`：均已完成。
- 仅实现纯领域规则，不写SQLite、不接AI、不实现事件提交。

### 计划验证

- 关系单维±1成功，补丁幅度或结果越界时整体拒绝且原对象不变。
- 世界时钟0..max、单步推进、阶段触发和满值拒绝。
- 根 `pnpm check` 全量回归。

### 完成结果与验收

- 新增 `WorldClockId`，并通过统一brand构造器校验和导出。
- `applyRelationshipPatch` 将每个关系维度的单回合变化限制为-1至1，结果限制为-5至5；空补丁、非整数、幅度越界和结果越界均被拒绝。
- `advanceWorldClock` 校验0至max范围、正安全整数上限和唯一阶段阈值；每次仅推进1格并返回本次触发阶段，满值后拒绝继续推进。
- 两类规则均返回新冻结对象；非法补丁抛出 `DomainPatchError`，不修改输入对象，不产生部分写入。
- `pnpm check`：通过；9个测试文件、89个测试全部通过，其中关系与世界时钟新增18项。
- TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo workspace测试全部通过。
- `DEC-008` 记录单步幅度和原子补丁边界。

### 自审

- 覆盖合法多维关系变化、幅度/结果越界、空补丁和输入对象不变。
- 覆盖时钟阶段触发、非阈值推进、负向/零/跳格/小数推进、完成时钟及非法范围和重复阈值。
- 未实现事件协议、SQLite写入、AI状态补丁验证器或应用用例；这些属于 `M1-T10` 及后续任务。

## 2026-07-30 23:10 — M1-T10 定义GameEvent事件协议（开始）

### 依赖与范围

- 依赖 `M1-T02` 至 `M1-T09`：均已完成，最近提交为 `e23c07a`。
- 仅定义共享事件协议和测试；不创建事件表、仓储、事务或应用发布逻辑。

### 计划验证

- 覆盖规格事件日志列出的全部事件类型。
- 验证判别字段可将事件收窄到精确payload。
- 根 `pnpm check` 全量回归。

### 完成结果与验收

- 新增 `GameEventId` 及统一brand构造和导出。
- `GameEvent` 使用公共审计信封与判别联合，公共字段为事件ID、CampaignId、SchemaVersion和规范UTC时间。
- 完整覆盖规格第28.3节的12类事件：世界、角色、NPC、任务接受、玩家行动、骰子、事实发现、物品获得、关系变化、世界时钟、冒险完成和模型切换。
- 每个事件类型拥有精确payload；骰子使用 `DiceResult`、关系变化保留前后状态、冒险完成使用 `AdventureEnding`，没有使用 `any` 或无类型JSON。
- 首轮 `pnpm check` 因测试使用非空断言被ESLint拒绝；改为显式处理缺失fixture分支后通过，未关闭或降低规则。
- 最终 `pnpm check`：通过；10个测试文件、92个测试全部通过，GameEvent新增3项。
- TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo workspace测试全部通过。
- `DEC-009` 记录事件信封和判别联合策略。

### 自审

- `GAME_EVENT_TYPES` 与测试fixture顺序逐项相等，确保规格列出的事件类型没有漏项。
- 类型收窄测试确认 `DICE_ROLLED` 只能访问骰子payload；所有fixture均验证公共审计元数据。
- 未实现事件表、事件仓储、SQLite事务或事件发布用例；这些属于M2及后续任务。

## 2026-07-30 23:16 — M2-T01 设计SQLite ER模型（开始）

### 依赖与范围

- 依赖M1全部任务：已完成，最近提交为 `07abde7`。
- 仅输出数据模型文档；不创建 `0001_initial.sql`、数据库连接或Repository。

### 计划验证

- 规格第24.2节的22张核心表逐项覆盖。
- 每张表明确字段、主键、外键和索引；所有JSON列说明结构与校验要求。
- API Key和令牌明确禁止写入数据库。
- 根 `pnpm check` 全量回归。

### 完成结果与验收

- 新增 `docs/data-model.md`，定义规格第24.2节全部22张核心表的字段、类型、主键、外键、删除策略、索引和JSON列。
- ER图覆盖Campaign与世界、角色、酒馆/NPC、任务/冒险、对话、审计、AI请求、快照和模型配置的主要关系。
- 明确48个去重JSON列名及其协议边界；迁移必须为JSON文本添加 `json_valid`，Repository必须验证内部结构和同Campaign引用。
- Campaign删除级联游戏内容，产品正常流程使用归档；Provider/模型配置为设备级数据，不随Campaign删除。
- 一次回合的消息、任务、关系、世界事实和事件必须在同一SQLite事务中提交。
- `provider_configs` 只允许 `credential_ref` 和非秘密选项，明确禁止API Key、Authorization头和令牌入库。
- 静态覆盖脚本：预期22张、实际22张，缺失0、额外0；所有外键目标均位于核心表清单。
- 自检修正初稿将核心表误计为23张的问题；同时将传输失败场景的 `raw_response_text` 改为可空。
- `pnpm check`：通过；10个测试文件、92个测试全部成功，TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。
- `DEC-010` 记录规范列与受验证JSON的持久化边界。

### 自审

- 未创建 `database/`、迁移SQL、业务表实现、Repository或数据库依赖。
- Faction、Location、Clue、NpcMemory等非核心独立表对象均明确映射到父实体JSON，没有静默遗漏。
- 骰子结果位于 `adventure_turns.dice_result_json`，对话与消息独立持久化，模型切换后可从本地历史恢复。
- M2-T02迁移要求已明确，但没有提前执行该任务。

## 2026-07-30 23:22 — M2-T02 创建首版数据库迁移（开始）

### 依赖与范围

- 依赖 `M2-T01`：已完成并提交 `b239e59`。
- 仅创建首版SQL、迁移执行器与迁移测试；不实现任何Repository。

### 计划验证

- 在真实临时SQLite文件上执行 `0001_initial.sql`。
- 首次执行后核对22张核心表、迁移版本、外键和关键约束。
- 在同一数据库重复运行迁移，确认不重复建表或记录版本。
- 根 `pnpm check` 全量回归。

### 完成结果与验收

- 新增 `database/migrations/0001_initial.sql`，创建 `docs/data-model.md` 定义的22张核心表、全部索引、外键、枚举/范围约束和JSON有效性约束。
- 新增最小迁移执行器：启用外键、维护 `schema_migrations`、按版本跳过已应用迁移，并将DDL与版本写入放在同一 `BEGIN IMMEDIATE` 事务。
- 新增真实文件型SQLite测试，临时数据库位于项目 `.local/cache/temp`，测试结束后删除。
- 首次迁移测试：22张核心表名称精确匹配，外键已启用，版本记录数等于迁移数。
- 重复启动测试：第二次执行不重放DDL，仍只有版本1的一条原始记录，业务表和版本表总数不变。
- 约束测试：非法JSON、越界世界时钟和缺失Campaign外键均被SQLite拒绝；Provider列扫描确认没有API Key、Authorization或Token字段。
- 首轮测试唯一失败来自Node SQLite查询行使用null-prototype对象；改为复制行字段后比较，未更改迁移行为。
- 首轮完整Lint另发现JavaScript中未显式导入全局 `URL`；改为从 `node:url` 导入，未关闭 `no-undef`。
- 最终 `pnpm check`：通过；Vitest 10个文件、92项通过，Node SQLite 3项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。
- `DEC-011` 记录版本化事务迁移策略。

### 自审

- SQL未使用 `CREATE TABLE IF NOT EXISTS` 掩盖业务表重放；幂等性来自成功版本记录。
- 迁移失败会回滚DDL和版本写入；不存在记录了版本但只建一部分表的路径。
- 仅新增迁移基础设施表，不创建规格之外的业务表。
- 未实现Campaign或其他Repository，不提前执行 `M2-T03`。

## 2026-07-30 23:28 — M2-T03 实现Campaign Repository（开始）

### 依赖与范围

- 依赖 `M2-T02`：已完成并提交 `94ba77a`。
- 仅实现Campaign Repository及测试，不实现世界、角色、NPC或其他表的Repository。

### 计划验证

- 创建、读取、状态更新、归档、默认列表和包含归档列表。
- 重复ID、缺失更新/归档和数据库非法枚举值显式报错。
- 关闭SQLite连接后重新打开文件，数据仍存在。
- 根 `pnpm check` 全量回归。

### 完成结果与验收

- persistence package新增对contracts的workspace依赖、公共导出和最小 `SqliteDatabase`/Statement端口。
- `CampaignRepository` 实现create、get、update、archive、list；默认列表排除归档，显式参数可包含归档。
- 读取数据库行从 `unknown` 开始验证字符串、数字、Campaign状态、恢复状态、品牌ID、Schema版本和规范UTC时间；非法数据抛出 `PersistenceDataError`，不返回部分对象。
- update拒绝不存在记录和修改 `createdAt`；archive复用Campaign状态机并在同一语句写入归档状态、更新时间和归档时间。
- 真实SQLite测试覆盖CRUD、排序、归档过滤、重复ID、缺失目标、非法时间戳和空查询。
- 重连验收：写入文件数据库后关闭连接，重新打开同一路径并再次应用幂等迁移，Campaign完整读取成功。
- 增加精确版本 `@types/node 24.13.3` 仅供Node SQLite测试类型；pnpm安装复用本地缓存，下载0项。
- 首轮类型检查发现原始行索引签名使用点号访问；改为显式键访问，保留 `noPropertyAccessFromIndexSignature`。
- 最终 `pnpm check`：通过；Vitest 11个文件、96项通过，Node迁移3项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。
- `DEC-012` 记录平台无关SQLite端口。

### 自审

- Repository没有导入Node、Tauri、iOS或具体SQLite驱动，测试适配器不进入公共导出。
- 所有SQL参数绑定，无字符串拼接实体数据；没有 `any`、非空断言或吞掉数据库错误。
- Campaign仍由本地SQLite保存和恢复，列表不依赖内存缓存。
- 未实现世界、角色或其他Repository，不提前执行 `M2-T04`。

## 2026-07-30 23:34 — M2-T04 实现世界与角色Repository（开始）

### 依赖与范围

- 依赖 `M2-T02`：已完成；前序Campaign Repository已提交 `1dc0289`。
- 仅实现WorldBible、WorldFact和PlayerCharacter读写，不实现M2-T05或后续表。

### 计划验证

- WorldBible锁定字段、Faction、Location及全部JSON数组完整往返。
- 五类WorldFact类别专属字段和发展事实替代链完整往返。
- PlayerCharacter内容边界、属性、两个特质、背景和装备引用完整往返。
- 缺失数据返回null/空列表，非法持久化JSON显式拒绝。
- 根 `pnpm check` 全量回归。

### 完成结果与验收

- 新增共享持久化验证工具，从unknown解析对象、数组、JSON、枚举、字符串、数字和布尔值，错误统一为 `PersistenceDataError`。
- `WorldRepository` 实现WorldBible保存/读取、WorldFact追加/读取/列表；WorldBible更新保护原始创建时间，WorldFact ID重复写入由主键拒绝。
- WorldBible恢复完整校验powerRules、Faction关系、Location层级、禁止内容、故事线索和 `WorldBibleLockableField`；未知锁定字段不进入领域对象。
- WorldFact恢复五类判别联合：锁定规则、发展事实、临时叙事、传闻和错误认知；替代链通过真实外键及品牌ID恢复。
- `PlayerCharacterRepository` 实现创建、读取和更新，保护CampaignId与createdAt；完整验证四项属性总和、恰好两个特质、内容边界、背景和装备引用。
- 真实SQLite测试5项通过：WorldBible JSON/锁定字段保存和更新、六条事实覆盖五类及替代链、未知锁定字段拒绝、角色完整往返更新、错误特质结构拒绝。
- 首轮类型检查发现测试数组索引可能为undefined；改为按ID查找并显式处理缺失fixture，未使用非空断言。
- 最终 `pnpm check`：通过；Vitest 12个文件、101项通过，Node迁移3项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。

### 自审

- 所有JSON读取均先解析和逐字段验证，未把 `JSON.parse` 结果直接断言为领域类型。
- WorldFact为追加式写入，没有提供覆盖历史事实的方法；发展事实链保留。
- 所有SQL使用参数绑定；返回数组和主要聚合被冻结。
- 未实现酒馆、NPC、任务、冒险或对话Repository，不提前执行 `M2-T05`。

## 2026-07-30 23:41 — M2-T05 实现酒馆、NPC和关系Repository（开始）

### 依赖与范围

- 依赖 `M2-T02`：已完成；世界与角色Repository已提交 `bf80e75`。
- 仅实现Tavern、Npc、Knowledge、Relationship、Memory及同表聚合，不实现M2-T06。

### 计划验证

- 酒馆先建立父行，NPC写入后绑定老板；正式读取不接受未绑定老板。
- OWNER和RESIDENT动态组成常驻列表，TEMPORARY_VISITOR动态组成访客列表。
- 两个NPC知识、错误认知、关系和记忆分别写入并独立恢复。
- 酒馆变化与临时访客信息完整恢复，非法JSON显式拒绝。
- 根 `pnpm check` 全量回归。

### 完成结果与验收

- `TavernRepository` 实现两阶段创建、老板绑定、正式读取、更新、酒馆变化追加/列表；未绑定老板的中间行不能恢复为正式Tavern。
- OWNER与RESIDENT从NPC表动态组成常驻列表，TEMPORARY_VISITOR组成访客列表，不重复保存派生ID数组。
- `NpcRepository` 实现资料创建/读取/更新、临时访客信息、知识、四维关系和追加式记忆。
- NPC更新保护CampaignId、TavernId、residency和createdAt；Tavern更新保护CampaignId、LocationId和createdAt。
- 两个NPC分别写入不同已知事实、怀疑、错误认知和秘密排除列表，读取互不包含对方事实；缺失知识返回null。
- 两个NPC的关系和记忆分别往返；记忆重复ID被拒绝，读取时验证嵌入npcId与所属NPC一致。
- 临时访客详情必须与profile的NPC/Tavern ID和居留类型匹配；错误组合在写入前拒绝。
- 酒馆变化、访客详情、NPC记忆和知识JSON均从unknown逐字段验证，错误结构不会进入领域对象。
- 最终 `pnpm check`：通过；Vitest 13个文件、105项通过，Node迁移3项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。

### 自审

- 验收“多个NPC知识互不污染”有独立事实集合和反向不包含断言，不依赖内存对象。
- 老板生成环使用明确两阶段API，没有写死空老板或关闭外键。
- 关系读取复用 `createNpcRelationship` 的-5至5校验；知识复用 `createNpcKnowledge`。
- 未实现Quest、Adventure、Conversation等M2-T06内容。

## 2026-07-30 23:47 — M2-T06 实现任务、冒险与对话Repository（开始）

### 依赖与范围

- 依赖 `M2-T02`：已完成；酒馆/NPC Repository已提交 `1dcc3ac`。
- 仅实现Quest、Adventure、Turn、Conversation、Message、Item、Clock及必要共享ID。

### 计划验证

- 任务规则字段与AI内容、AdventurePlan/Clue/Ending、完整Turn JSON精确往返。
- 对话消息稳定序号、物品效果和世界时钟阶段精确往返。
- 写入完整冒险回合后关闭连接，重开同一数据库并恢复所有字段。
- 非法JSON/枚举和重复顺序被拒绝。
- 根 `pnpm check` 全量回归。

### 完成结果与验收

- 新增ConversationId、MessageId、GenerationRecordId品牌类型，以及Conversation/Message最小共享协议。
- persistence声明domain workspace依赖以复用M1 WorldClock协议；离线安装下载0项。
- `QuestRepository` 实现创建、读取、更新，规则字段和AI内容分别序列化并逐字段恢复。
- `AdventureRepository` 实现Adventure创建/读取/更新、Clue保存、Ending结算、Turn追加/读取/列表；PlayerAction四分支、CheckRequest和DiceResult均严格解码。
- `ConversationRepository` 验证NPC/ADVENTURE/SYSTEM作用域，消息按唯一正序号追加和恢复，NPC角色必须带匹配speaker。
- `ItemRepository` 保存程序控制ItemEffect、持有人和来源冒险；`WorldClockRepository`保存范围、唯一阶段阈值并支持更新/列表。
- 真实SQLite重连测试写入完整任务、冒险计划、核心线索、含检定和骰子的回合、两条消息、物品和时钟；关闭连接后重新打开全部精确恢复。
- 重复冒险回合序号和消息序号由唯一约束拒绝；Quest状态、AdventureEnding和时钟更新有覆盖。
- 首轮Lint发现 `playerCharacterId` 仅用于类型表达式；改为type-only import，未放宽规则。
- 最终 `pnpm check`：通过；Vitest 14个文件、108项通过，Node迁移3项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。

### 自审

- 冒险恢复完全来自重开的SQLite连接，不依赖测试内存对象或模型会话。
- 骰子结果作为AdventureTurn JSON持久化，读取时校验固定难度和成功布尔值。
- 所有实体数据使用SQL参数绑定，JSON从unknown逐字段验证。
- 未实现GameEvent、GenerationRecord、PendingRequest或快照Repository，不提前执行M2-T07。

## 2026-07-30 23:57 — M2-T07 实现事务型回合提交

### 依赖与范围

- 依赖 `M2-T03` 至 `M2-T06`：全部完成；M2-T06已提交 `adba910`。
- 仅实现玩家输入、已验证AI输出、状态补丁和GameEvent的单SQLite事务提交。
- 不实现pending AI请求、Provider、快照或恢复中心。

### 计划验证

- 完整回合必须含玩家输入、非空AI场景输出、已解决时间和匹配的PLAYER_ACTION_SUBMITTED事件。
- 同一事务更新Adventure、追加Turn、应用Quest/NPC关系/WorldFact补丁并追加GameEvent。
- 在事务末尾模拟事件主键冲突，确认所有前序写入回滚且无部分数据残留。
- 根 `pnpm check` 全量回归。

### 完成结果与验收

- 新增 `GameEventRepository`：全部12类事件按判别字段逐项验证payload后追加，读取时同样从unknown重新验证；不提供更新或覆盖历史的API。
- 新增 `TurnTransaction`：使用 `BEGIN IMMEDIATE`、`COMMIT` 和异常时 `ROLLBACK`，原子提交Adventure、AdventureTurn、Quest/NPC关系/WorldFact补丁及GameEvent。
- 事务命令校验Adventure/Turn/Campaign归属、回合号、玩家输入、已解决时间、非空场景输出，并要求匹配本回合及输入内容的玩家行动事件。
- NPC关系补丁在事务内读取NPC和PlayerCharacter的Campaign归属，禁止跨存档绑定；Quest、WorldFact和事件同样限制在命令Campaign。
- SQLite公共端口保持原有最小读写接口，新增独立 `TransactionalSqliteDatabase` 仅补充事务所需 `exec`。
- 成功测试在真实SQLite中同时保存玩家输入、AI场景、任务状态、NPC关系、世界事实和事件，并经Repository读取核对。
- 回滚测试先写入Adventure和Turn、再应用状态补丁，最后用重复GameEvent主键制造失败；验证新Turn不存在、Adventure回合号和Quest状态保持原值、关系不存在且历史事件不变。
- 首轮局部测试发现异步迁移漏 `await`、连接清理顺序和旧属性枚举夹具问题；均修正测试基础设施，没有修改产品约束。
- 首轮全量测试发现关系归属校验为读取Campaign而反序列化完整测试角色；改为最小列查询，使校验职责与读取范围一致。
- 两轮Lint要求聚合错误显式保留正确捕获错误的 `cause`；按规则修正，未关闭或放宽Lint。
- 最终 `pnpm check`：通过；Vitest 15个文件、110项通过，Node迁移3项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。

### 自审

- 事务服务不接收任意SQL状态补丁，只接受明确的Quest、NPC关系和WorldFact领域补丁。
- 已验证AI场景作为完整Turn的一部分保存；原始模型输出不能直接写入游戏状态。
- 故障注入位于事务末端，确实覆盖此前多表写入的回滚，不是事务开始前失败。
- 未实现pending_ai_requests或后续任务内容，不提前执行M2-T08。

## 2026-07-31 00:05 — M2-T08 实现pending_ai_requests

### 依赖与范围

- 依赖 `M2-T02`、`M2-T07`：均已完成；事务型回合提交已提交 `3fbb7b3`。
- 仅实现请求状态、错误码、重试次数、幂等键及防止重复奖励所需的事务集成。
- 不实现GenerationRecord、AI Provider、任务Schema或M2-T09数据库启动检查。

### 计划验证

- 请求按CREATED、CONTEXT_READY、SENDING、RECEIVED、VALIDATING等状态前进，非法终态转换被拒绝。
- 失败保存错误码、消息和retryable；重试清除旧错误且每次发送递增attemptCount。
- 相同幂等键创建不重复记录，不同请求复用键显式冲突。
- 同一幂等键结算两次只提交一次奖励、回合和事件。
- 根 `pnpm check` 全量回归。

### 完成结果与验收

- 新增AiRequestId、IdempotencyKey、ModelProfileId品牌类型，以及JsonValue、八种请求状态、AiRequestError和PendingAiRequest共享协议。
- `PendingAiRequestRepository` 实现createOrGet、按ID/幂等键读取、未完成列表、上下文准备、尝试开始、接收、验证、失败、可重试恢复、取消和幂等回合结算。
- 同一幂等键仅在请求ID、Campaign、Turn、任务、模型和规范输入均一致时返回现有记录；不同逻辑请求复用键抛出 `IdempotencyConflictError`。
- attemptCount只在CONTEXT_READY进入SENDING时递增；失败保存非空错误码、消息和retryable，重试仅允许可重试FAILED请求。
- input、context和lastError从unknown递归验证为有限JSON；普通对象键稳定排序比较，API Key、Authorization、Bearer和令牌类字段在入库前拒绝。
- pending请求引用回合时，通过Turn→Adventure查询验证同Campaign，不依赖外键仅验证ID存在。
- M2-T07事务提取内部受控 `applyTurnCommit` 供幂等结算复用；AdventureRepository新增saveTurn以完成已保存玩家输入的未解决回合，不创建重复回合。
- Turn状态补丁新增明确的ITEM_REWARD分支，验证物品Campaign、来源Adventure和持有人Campaign后才创建并分配奖励。
- `commitTurnOnce` 在 `BEGIN IMMEDIATE` 内读取幂等键；VALIDATING请求原子提交完整回合、奖励、事件及COMMITTED状态，已COMMITTED请求返回ALREADY_COMMITTED且不再写游戏状态。
- 真实SQLite生命周期测试覆盖相同键复用、冲突键、凭证字段拒绝、TIMEOUT错误、两次尝试和VALIDATING状态。
- 真实SQLite幂等测试对同一键连续结算两次，仅恢复一件归属物品和两条首次事件，请求保持COMMITTED。
- 完整检查首轮仅发现只读数组联合未被 `Array.isArray` 完全收窄；增加显式JSON对象类型守卫，未使用any或断言绕过。
- 最终 `pnpm check`：通过；Vitest 15个文件、112项通过，Node迁移3项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。
- `DEC-013` 记录幂等终态短路与请求状态/游戏补丁同事务原则。

### 自审

- 重复结算实际执行两次Repository调用并检查SQLite结果，不是通过mock调用次数证明。
- COMMITTED前任一写入失败会由同一事务回滚，请求不会提前进入终态。
- Repository未保存API Key或Authorization，错误详情同样经过凭证字段扫描。
- 未实现M2-T09或M3任务，不提前扩展AI厂商协议。

## 2026-07-31 00:11 — M2-T09 实现数据库启动检查和迁移框架

### 依赖与范围

- 依赖 `M2-T02`：已完成；最近完成的pending AI生命周期已提交 `c5a7333`。
- 仅实现数据库启动版本检查、迁移执行、完整性检查、失败结果和原文件保护。
- 不实现M7快照恢复中心、完整备份轮换或任何M3 AI协议。

### 计划验证

- 已关闭的v0 SQLite文件在工作副本上升级，保留旧数据并生成迁移前原件。
- 迁移SQL与旧Schema冲突时，失败结果明确且原数据库字节完全不变。
- 高于应用支持版本的数据库拒绝打开；损坏数据库保留原文件。
- 迁移前后执行SQLite完整性检查，根 `pnpm check` 全量回归。

### 完成结果与验收

- `migrations.mjs` 公开只读migrationManifest和currentSchemaVersion，版本记录必须从1连续匹配已知名称；未知未来版本明确返回SCHEMA_TOO_NEW。
- 新增公共 `prepareDatabaseFile` 启动入口及类型声明，结果分为READY、MIGRATED和FAILED；成功结果包含前后版本与可选备份路径，失败包含稳定错误码、消息和原件保留状态。
- 新数据库直接应用迁移并检查完整性；创建失败会关闭连接、删除不完整新文件并报告不存在可保留原件。
- 现有数据库先检查journal、WAL、SHM侧文件；存在任一侧文件时返回ACTIVE_DATABASE，不复制可能未合并的数据。
- 关闭的现有数据库复制到UUID工作文件，仅在副本上运行迁移前完整性、Schema历史/兼容性、迁移和迁移后完整性检查。
- 全部成功后原数据库重命名为唯一pre-migration文件，工作副本切换到正式路径；切换失败优先恢复原路径，恢复也失败时保留聚合错误和原件所在路径信息。
- 任意检查或迁移失败会关闭工作连接并删除工作文件；关闭和清理自身失败分别返回DATABASE_CLOSE_FAILED和CLEANUP_FAILED，不静默吞掉。
- 文件级升级测试从包含legacy_notes数据的v0库升级到v1：原数据仍可读取、版本表为v1、完整性为ok，pre-migration副本仍无版本表且保留旧数据。
- 文件级失败测试使用与v1冲突的旧campaigns表触发真实DDL失败；正式路径文件SHA-256前后一致，旧行可重新打开读取。
- 版本测试构造Schema 99并验证SCHEMA_TOO_NEW及文件哈希不变；损坏文件验证INTEGRITY_CHECK_FAILED和证据字节不变。
- 局部检查后自审补充损坏文件专用错误码、rollback journal检测、非静默关闭/清理错误及准确originalPreserved语义。
- 最终 `pnpm check`：通过；Vitest 15个文件、112项通过，Node SQLite 7项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。
- `DEC-014` 记录写时复制迁移与失败保留原件原则。

### 自审

- “失败不覆盖原数据库”通过真实文件哈希验证，不仅检查SQL事务回滚。
- 启动服务不打开原数据库做探测；版本与完整性检查均发生在工作副本。
- pre-migration文件不自动轮换或恢复，避免提前执行M7-T05/M7-T06。
- 未执行M3-T01或任何AI Provider工作。

## 2026-07-31 00:15 — M3-T01 定义统一AI请求与响应协议

### 依赖与范围

- 依赖M1全部任务：已完成；M2全部任务已提交，最近提交为 `f11622e`。
- 仅定义AIProvider、规范化请求/响应、Provider配置、模型信息和能力协议。
- 不实现M3-T02任务Schema、Prompt、Fake Provider、厂商适配器或真实网络调用。

### 计划验证

- 协议覆盖规格全部首批AITask、Provider类型与预设。
- 一个仅使用本地对象的测试实现可满足AIProvider并返回规范化结果。
- ProviderConfig不含API Key字段，ModelCapabilities记录动态检查时间和成本状态。
- 扫描业务package没有厂商SDK导入，根 `pnpm check` 全量回归。

### 完成结果与验收

- `packages/ai-core` 建立src入口、公共exports和contracts workspace依赖；离线 `pnpm install` 下载0项。
- 定义规格列出的15类AITask、5类Provider类型和17个预设键；只提供协议名称，不提前定义任务输入输出Schema。
- `ProviderConfig` 包含Provider类型、预设、显示名、可选baseUrl、安全凭证引用、非秘密options和启用状态；没有API Key字段。
- `ModelCapabilities` 覆盖文本、流式、system消息、JSON Mode、JSON Schema、Tool Calling、推理、上下文长度及成本状态，并携带checkedAt，避免永久硬编码免费状态。
- `NormalizedAIRequest` 统一requestId、任务、Prompt版本、模型、消息、响应格式、温度、输出限制和超时；JSON Schema为厂商无关JSON对象。
- `NormalizedAIResponse` 统一请求关联、Provider请求ID、模型、内容、结束原因、token用量和接收时间，不暴露SDK响应对象。
- `AIProvider` 按规格提供listModels、testConnection和generate；TestResult使用标准连接错误码。
- 4项协议测试验证列表覆盖、无Schema提前实现、本地对象实现接口、间接凭证和动态能力时间。
- 首次SDK扫描命令因PowerShell双引号正则解析失败，未执行项目检查；改用简单单引号包名模式后扫描0命中。
- 最终 `pnpm check`：通过；Vitest 16个文件、116项通过，Node SQLite 7项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。
- `DEC-015` 记录厂商类型不得越过ai-core规范化边界。

### 自审

- ai-core只依赖共享contracts，package依赖中没有任何厂商SDK。
- 测试中的Provider只是接口契约夹具，不是M3-T04 FakeAIProvider产品实现。
- 未实现M3-T02、M3-T03或任何后续任务。

## 2026-07-31 00:22 — M3-T02 定义首批AI任务Schema

### 依赖与范围

- 依赖 `M3-T01`：已完成并提交 `42e9330`。
- 为规格15类首批AITask分别定义输入、输出Zod Schema和版本号。
- 不实现M3-T03 Prompt、M3-T04 Fake Provider、M3-T06解析流程或M3-T07领域验证器。

### 计划验证

- 注册表与AI_TASKS精确一致，每个任务input/output顶层Schema对象独立且版本为1。
- 每类任务各有一组有效输入输出夹具，空输出全部拒绝。
- 代表性元组、跨字段范围和strict未知字段规则有失败测试。
- 根 `pnpm check` 全量回归。

### 完成结果与验收

- Zod仅加入 `@ember-tavern/ai-core` 运行依赖；pnpm复用本地缓存，下载0项。
- 新增GenerateWorld与RefineWorld严格Schema，覆盖世界核心冲突、技术水平、力量规则、阵营、地点、叙事风格、禁用元素、酒馆原因和故事钩子。
- 新增角色特质二元组和完整背景Schema；特质输出必须恰好两项。
- 新增酒馆与NPC生成Schema，覆盖老板资料、常驻/访客身份、访问原因和数量上限。
- 新增NPC回复Schema，输入只含该NPC知识、错误认知、关系和最近消息；输出包含回复、情绪、话题、记忆候选和单步关系提案结构。
- 新增Quest、AdventurePlan、AdventureTurn和ResolveDiceResult Schema；回合范围max不得小于min，检定难度只允许8/11/14/17。
- 新增世界事件、冒险摘要、NPC记忆提取和一致性检查Schema；一致性布尔值必须与issues是否为空匹配。
- 状态补丁提案限制为QUEST、RELATIONSHIP、FACT、CLOCK和ITEM_REWARD，payload递归限制为有限JSON；尚不判断补丁是否符合当前游戏事实。
- `AI_TASK_SCHEMAS` 使用完整Record约束15个AITask，逐项注册不同input/output对象和schemaVersion 1；遗漏或多余任务会在类型检查失败。
- 32项Schema测试覆盖注册完整性、30个独立顶层对象、15组有效夹具、15个空输出拒绝及代表性结构失败。
- 首轮测试6项失败都来自worldContext严格Schema漏technologyLevel，而共享夹具包含该规格字段；补齐字段后32项全部通过。
- 最终 `pnpm check`：通过；Vitest 17个文件、148项通过，Node SQLite 7项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。
- `DEC-016` 记录逐任务版本化和结构/领域验证分层。

### 自审

- 每类任务有独立命名导出和注册项，不以单一宽松Schema冒充覆盖。
- 所有顶层和主要嵌套对象使用strict；缺字段、错误枚举和意外字段不会静默进入输出。
- 未实现Prompt、Fake Provider、输出修复或状态提交，不提前执行后续任务。

## 2026-07-31 00:26 — M3-T03 建立Prompt目录与版本机制

### 依赖与范围

- 依赖 `M3-T02`：已完成并提交 `ba3d646`。
- 仅建立Base规则、15类任务Prompt、Provider能力格式层和Prompt版本记录。
- 不实现M3-T04 Fake Provider、M3-T05上下文构建、真实Provider或网络调用。

### 计划验证

- TASK_PROMPTS与AI_TASKS精确一致，所有任务有逻辑角色、版本和独立指令。
- PROMPT_HISTORY独立记录v1，不随当前Prompt版本覆盖旧记录。
- 输入在渲染前通过任务Schema；模型能力决定SYSTEM合并和结构化输出格式。
- 扫描UI、application和Repository没有Prompt正文，根 `pnpm check` 全量回归。

### 完成结果与验收

- `packages/prompts` 建立src入口、exports，并依赖ai-core/contracts/Zod；离线安装下载0项。
- BASE_RULES集中声明SQLite权威、只使用给定上下文、禁止修改锁定规则/属性/骰子、补丁仅为提案、内容边界、秘密禁入和纯JSON输出。
- 15类TASK_PROMPTS逐项定义World Designer、Game Master、NPC Actor或Archivist角色、PromptVersion 1、输出Schema名和任务专属指令。
- PROMPT_HISTORY对15类任务保留固定版本1初始记录；自审时从当前Prompt动态映射改为独立AI_TASKS+固定v1，未来升级不会丢失历史。
- `formatTaskPrompt` 先使用对应输入Zod Schema解析unknown，再序列化已验证输入；非法输入不会形成Provider消息。
- 支持system消息时输出SYSTEM Base/角色/任务指令和USER输入；不支持时合并为单个USER消息。
- 支持JSON Schema时由任务输出Zod生成JSON Schema；否则依次降级为JSON_OBJECT或TEXT，不虚报模型能力。
- JSON Schema转换从unknown递归验证为JsonValue；首轮类型检查发现只读数组联合收窄不足，增加显式JsonObject守卫，未用any或断言。
- 6项测试覆盖完整Prompt/历史、Base安全规则、JSON Schema格式、system降级、JSON Mode、TEXT和输入拒绝。
- 页面、windows/iOS、application和persistence扫描指定Prompt正文0命中。
- 最终 `pnpm check`：通过；Vitest 18个文件、154项通过，Node SQLite 7项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。
- `DEC-017` 记录Prompt集中、历史保留和能力降级原则。

### 自审

- Provider格式层只产生规范消息/响应格式，不导入厂商SDK或发送请求。
- Prompt正文没有进入页面、Use Case或Repository。
- 未执行M3-T04或后续任务。

## 2026-07-31 00:32 — M3-T04 实现FakeAIProvider

### 依赖与范围

- 依赖 `M3-T01`、`M3-T02`：均已完成；厂商无关协议提交为 `42e9330`，任务Schema提交为 `ba3d646`。
- 仅实现覆盖15类首批AITask的确定性、无网络Fake Provider及测试数据。
- 不实现M3-T05上下文构建、M3-T06输出解析/修复、M3-T07领域验证或M3-T08编排提交。

### 计划验证

- 每类输出在返回前和测试中均通过对应Zod输出Schema。
- 相同请求重复调用得到相同规范响应，时间和模型信息稳定。
- 禁止网络后生成世界、角色、酒馆、NPC、任务、冒险计划、8个回合、骰子结果和冒险摘要。
- 禁用配置和未知模型显式失败；根 `pnpm check` 全量回归。

### 完成结果与验收

- 新增 `FakeAIProvider`，实现统一 `AIProvider` 接口；公开唯一 `ember-fake-v1` 免费模型，不导入厂商SDK、不读取凭据、不发送网络请求。
- `FAKE_TASK_OUTPUTS` 以完整 `Record<AITask, unknown>` 覆盖15类任务；任务新增或遗漏夹具会触发类型检查。
- `generate` 按请求任务从注册表取得输出Schema并在返回前解析夹具，结构无效时不会伪装成功。
- 响应保留原requestId，使用稳定providerRequestId、STOP结束原因、空用量字段和可注入时钟；默认时间固定以保证测试重复。
- 禁用Provider配置返回明确连接失败并拒绝生成；未知模型抛出 `FakeAIProviderError`。
- 20项专用测试覆盖模型能力、15类确定性Schema输出、夹具注册完整性、禁网完整冒险链、错误路径和注入时间。
- 离线冒险链生成世界、两项角色特质、完整背景、酒馆、常驻与临时NPC、任务、计划、8个回合及骰子结果和最终摘要；网络替身调用次数为0。
- 最终 `pnpm check`：通过；Vitest 19个文件、174项通过，Node SQLite 7项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。

### 自审

- 确定性内容是本任务要求的可验证测试数据，不创建真实Provider、网络客户端或API Key配置。
- Provider只返回经结构Schema验证的JSON，不修改SQLite或任何游戏状态。
- 未实现上下文构建、领域补丁验证、GenerationRecord或Orchestrator，不提前执行M3-T05及后续任务。

## 2026-07-31 00:39 — M3-T05 实现上下文构建器

### 依赖与范围

- 依赖 `M2-T03` 至 `M2-T06`、`M3-T02`：均已完成；上一任务Fake Provider已提交 `a6a7417`。
- 仅实现NPC对话、冒险回合和世界事件的纯上下文构建、长短期组合、相关性过滤与字符预算裁剪。
- 构建器接收由SQLite Repository恢复的领域快照，不直接查询或修改数据库；不实现输出验证、补丁验证或Orchestrator。

### 计划验证

- NPC只看到自身角色卡、知识集合、错误认知、关系、对话与长期记忆；排除无关NPC秘密和excludedSecretFact。
- 冒险只包含同Adventure回合/线索、Quest关联NPC、世界规则、玩家、任务、隐藏计划和本次行动。
- 世界事件只包含同Campaign时钟/事件、势力状态和当前剧情章。
- 最近窗口与总字符预算均可配置；超预算优先裁剪最旧可选记录，核心字段超限显式失败。
- 三类结果通过对应任务输入Schema；根 `pnpm check` 全量回归。

### 完成结果与验收

- 新增三个纯构建函数及明确Source/Result/ContextBudget类型；默认预算24000字符、最近消息12条、长期记忆8条、冒险回合8条、事件10条。
- NPC构建器核对NPC/知识/关系/Campaign归属，仅按知识ID解析同Campaign事实，并始终排除 `excludedSecretFactIds`；NPC消息只保留玩家和目标NPC，记忆只保留目标NPC。
- NPC卡包含目标NPC自身秘密以支持角色扮演，但构建API不接收其他NPC卡；测试确认无关NPC秘密、消息、记忆及显式排除事实均不进入JSON。
- 冒险构建器核对World、Player、Quest、Adventure归属，只保留同Adventure回合和已发现线索、Quest关联NPC；关联NPC使用不含secret的brief。
- 冒险上下文组合长期摘要与最近回合，并包含世界规则、玩家角色、当前任务、隐藏计划、当前场景、线索和本次行动。
- 世界事件构建器只保留同Campaign时钟和重要事件，并加入势力目标/关系和当前剧情章。
- 预算循环从最旧可选记录开始裁剪；NPC在消息与记忆之间比较最旧项体积，避免旧大记忆挤掉最新短消息；核心内容单独超限时抛出 `ContextBuildError`。
- 首轮类型检查仅发现测试阵营ID未使用品牌构造器；已修正。首轮预算测试进一步发现跨消息/记忆类别裁剪优先级问题，修正实现后通过。
- 为符合规格第26节，`NPC_REPLY`、`GENERATE_ADVENTURE_TURN`、`GENERATE_WORLD_EVENT` 输入Schema按 `DEC-016` 升至版本2；输出Schema不变，既有Prompt与Fake Provider回归通过。
- 5项专用测试覆盖秘密隔离、长短期组合/预算、冒险相关性、世界事件Campaign过滤和跨Campaign拒绝。
- 最终 `pnpm check`：通过；Vitest 20个文件、179项通过，Node SQLite 7项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。

### 自审

- 上下文来自调用方提供的已恢复事实快照，模型会话不保存唯一历史；切换Provider后可从SQLite重新构建。
- 构建结果仍需后续结构与领域验证；本任务没有接收AI输出或写游戏状态。
- 未实现M3-T06或任何后续任务。

## 2026-07-31 00:45 — M3-T06 实现AI输出结构验证

### 依赖与范围

- 依赖 `M3-T02`：已完成；上一任务上下文构建器已提交 `30057b8`。
- 仅实现逐任务JSON/Schema结构验证、稳定错误定位，以及 `generation_records` 原始响应和验证结果持久化。
- 不判断任务进度、关系、奖励、事实或时钟补丁的业务合法性，不提交游戏状态，不实现结构修复重试。

### 计划验证

- 有效Fake输出解析为有限JsonValue并保留逐字原始文本。
- 非法JSON、缺字段、错误枚举和嵌套越界值分别失败，错误包含稳定code和完整path。
- 成功与失败结果分别写入既有generation_records列，关闭并重开SQLite后原始文本与结果精确恢复。
- 完成记录必须在validated output和validation error之间二选一，禁止重复完成和请求中凭据字段。
- 根 `pnpm check` 全量回归。

### 完成结果与验收

- ai-core新增 `validateAIOutput`，按AITask从唯一 `AI_TASK_SCHEMAS` 注册表读取当前Schema和版本。
- 解析失败返回 `INVALID_JSON` 和根路径；Zod失败返回 `SCHEMA_VALIDATION_FAILED`，逐项保留字符串/数字路径、Zod code和消息。
- 验证成功结果递归转换并冻结为有限JsonValue；NaN、Infinity、undefined、函数或非JSON对象不能成为验证结果。
- 成功/失败判别联合都原样携带 `rawResponseText`；结构验证不会清洗、重排或用解析后JSON替代原始文本。
- contracts新增GenerationRecord、GenerationValidationError和Issue协议，字段与既有数据模型一致。
- `GenerationRecordRepository` 实现创建、一次性完成和读取；创建时raw/output/error/completed均为空，完成时必须在output/error之间严格二选一。
- Repository将规范请求、原始返回、结构结果/错误分别存入既有列；请求JSON沿用敏感字段拦截，禁止API Key、Authorization、Bearer、access token和secret key字段。
- 读取时逐字段恢复品牌ID、时间、JsonValue和错误路径，并拒绝“已完成但无结果/双结果”或“未完成但含完成数据”的损坏行。
- 5项验证器测试覆盖原始文本、非法JSON、缺字段、错误枚举和嵌套越界路径；3项真实SQLite测试覆盖成功重连、失败记录和生命周期/凭据保护。
- 首轮全仓lint只发现缺字段测试的解构变量未使用；改为显式JSON记录副本删除字段，未关闭规则。
- 最终 `pnpm check`：通过；Vitest 22个文件、187项通过，Node SQLite 7项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。

### 自审

- 验证成功仅表示JSON结构符合当前任务Schema，不能直接修改SQLite游戏事实；业务验证仍由M3-T07负责。
- 原始响应与验证结果分列保存，失败输出不会进入validated_output_json。
- 未实现M3-T07或任何后续任务。

## 2026-07-31 00:51 — M3-T07 实现Domain状态补丁验证器

### 依赖与范围

- 依赖 `M1-T08`、`M1-T09`、`M3-T06`：均已完成；结构验证与原始输出留存已提交 `1579b3c`。
- 仅实现AI提出的QUEST、RELATIONSHIP、ITEM_REWARD、FACT和CLOCK补丁的纯领域验证。
- 不读取或写入SQLite，不创建Repository实体ID，不实现Orchestrator、pending请求流程或事务提交。

### 计划验证

- 合法批次可按“任务完成→授权奖励”顺序验证，并产出五类已验证领域补丁。
- 玩家属性补丁和奖励payload中的属性/效果字段显式拒绝。
- WorldFact只允许target为null的追加发展事实，LOCKED_RULE或指定已有target拒绝。
- 奖励必须引用已完成且本地授权的任务，等级不得超过任务等级，效果只来自本地授权。
- 非法任务跃迁、关系单次变化超过1、时钟推进超过1均拒绝。
- 根 `pnpm check` 全量回归。

### 完成结果与验收

- domain新增 `validateDomainStatePatches`、验证上下文、五类已验证补丁联合及带code/index/path的 `DomainPatchValidationError`。
- 验证器从同Campaign Quest和Clock、本地Relationship、WorldBible及RewardAuthorization建立工作视图，逐项验证；前序合法补丁会更新批次视图。
- Quest固定允许AVAILABLE→ACCEPTED、ACCEPTED→ACTIVE/ABANDONED、ACTIVE→COMPLETED/FAILED/ABANDONED；终态不可再迁移。
- Relationship复用 `applyRelationshipPatch`，每个维度单次绝对变化不超过1且最终保持-5至5；空补丁同样拒绝。
- Clock复用 `advanceWorldClock`，每个补丁必须精确推进1且不能超过max，保留触发阶段。
- ITEM_REWARD要求target为null、任务已完成且存在本地授权；BASIC/NOTABLE/RARE/LEGENDARY按等级比较，禁止超过Quest.rewardTier。
- 奖励payload仅允许questId、name、description、rewardTier；AI提供attribute/effect等额外字段会被拒绝，最终效果来自本地RewardAuthorization。
- FACT要求target为null并默认追加DEVELOPING_FACT；指定已有target或声明LOCKED_RULE拒绝，当前不以宽松JSON冒充其他事实类别支持。
- PLAYER_ATTRIBUTE、ATTRIBUTES和所有未知kind显式拒绝；普通对象入口校验原型并复制为安全字典。
- 首轮检查发现品牌构造器误放在type-only import导致运行时缺失，以及unknown对象收窄不足；拆分值导入并增加普通对象校验后通过。
- 5项测试覆盖五类合法顺序批次及属性、锁定规则、越级奖励、任务跃迁、关系和时钟失败路径。
- 最终 `pnpm check`：通过；Vitest 23个文件、192项通过，Node SQLite 7项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。
- `DEC-018` 记录顺序式本地验证、奖励授权和程序控制效果边界。

### 自审

- 验证器不接受任意Repository对象或SQL；结果仍需M3-T08分配ID/时间并在事务中提交。
- AI不能通过额外payload字段修改属性或指定物品效果，不能覆盖锁定事实或越级发奖。
- 未实现M3-T08或任何后续任务。

## 2026-07-31 00:57 — M3-T08 实现AI Orchestrator

### 依赖与范围

- 依赖 `M2-T08`、`M3-T04` 至 `M3-T07`：均已完成；领域补丁验证已提交 `5cadbb7`。
- 仅实现AI冒险回合编排：pending、上下文、Prompt、统一Provider、GenerationRecord、结构/领域验证和幂等事务提交。
- 不实现M4页面用例、真实Provider、自动重试/修复或非回合生成流程。

### 计划验证

- 上下文从真实SQLite Repository重建并通过现有M3-T05构建器，不依赖模型会话。
- Fake Provider响应经M3-T06结构验证与M3-T07领域验证后，通过M2-T08 `commitTurnOnce` 原子提交。
- pending状态最终COMMITTED，GenerationRecord同时保留raw与validated output，回合/事实/事件可从SQLite读取。
- 相同幂等键第二次执行不重建上下文、不调用Provider、不重复写入。
- Provider传输失败保存pending和generation错误，raw保持null且回合/事件无部分变更。
- 根 `pnpm check` 全量回归。

### 完成结果与验收

- application package建立正式src入口并新增 `AITurnOrchestrator`、命令/生成选项类型和稳定 `AIOrchestrationError`。
- Orchestrator创建或复用pending请求；仅CREATED可开始，COMMITTED直接返回ALREADY_COMMITTED。
- `buildContext` 接收unknown并递归验证为有限、普通对象JsonValue后写入CONTEXT_READY；凭据字段仍由pending Repository拦截。
- 从Provider模型列表取得动态能力，调用集中 `formatTaskPrompt`，构造厂商无关NormalizedAIRequest；请求与裁剪后context进入GenerationRecord。
- Provider响应必须匹配requestId与modelName；成功依次推进SENDING、RECEIVED、VALIDATING，失败记录稳定PROVIDER_FAILURE而不保存异常原文。
- 结构失败保存raw和结构错误；领域回调失败保存raw和定位后的领域错误；两者均不产生validated output或游戏提交。
- 结构与领域全部通过后先记录validated output，再调用现有 `commitTurnOnce`；事务失败pending转FAILED，游戏事实由原事务回滚。
- GenerationRecord完成接口扩展为失败时允许raw为null，成功validated output仍强制要求raw存在，符合数据模型的传输失败语义。
- 成功集成测试在真实SQLite中创建Campaign、World、Player、Tavern/NPC、Quest、Adventure和待处理Turn；从Repository重建上下文后调用Fake Provider，最终原子写入AI场景、发展事实、玩家行动事件和COMMITTED状态。
- 同一命令第二次返回ALREADY_COMMITTED，上下文构建调用次数仍为1；无重复回合、事实或事件。
- 失败集成测试使用抛出传输错误的统一Provider，验证pending FAILED/retryable、GenerationRecord raw null/PROVIDER_FAILURE、原Turn未解决且事件列表为空。
- 2项Orchestrator测试与3项GenerationRecord回归测试通过；离线安装复用缓存，下载0项。
- 最终 `pnpm check`：通过；Vitest 24个文件、194项通过，Node SQLite 7项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。
- `DEC-019` 记录pending主线、双层验证、原始响应留存和幂等提交顺序。

### 自审

- Orchestrator不接受厂商SDK类型，不读取API Key，不把捕获异常文本写入数据库或日志。
- Fake输出只有在结构与领域验证后才转换为TurnCommit，最后仍由SQLite事务决定事实提交。
- 未实现M4-T01或任何后续任务。

## 2026-07-31 01:03 — M4-T01 实现新建存档和世界生成用例

### 依赖与范围

- 依赖 `M3-T08`：已完成并提交 `be7da72`。
- 仅实现CreateCampaign、GenerateWorld、RefineWorld、ConfirmWorld稳定用例及世界专用幂等事务。
- 不创建角色、酒馆、NPC、页面或真实Provider。

### 完成结果与验收

- application新增 `WorldCreationUseCases` 与Generate/Refine命令、世界实体ID工厂协议。
- CreateCampaign创建schemaVersion 1、CREATING_WORLD本地存档；重复或非法状态由Repository/用例拒绝。
- GenerateWorld验证输入后走pending、Prompt、Fake/统一Provider、GenerationRecord和结构验证；将AI名称草稿映射为程序分配的FactionId/LocationId。
- 世界与Campaign的REVIEWING_WORLD状态通过 `commitWorldOnce` 在同一SQLite事务提交；COMMITTED请求幂等短路。
- RefineWorld仅允许REVIEWING_WORLD，保留已有实体ID、createdAt和lockedFields，并逐项拒绝锁定字段变化。
- ConfirmWorld要求世界已存在并将状态迁移至CREATING_CHARACTER；无世界时状态保持CREATING_WORLD。
- 首轮检查发现world专用提交漏导入WorldRepository；补齐值导入后类型和运行测试通过。
- 2项真实SQLite测试覆盖完整Fake生成/细化/确认路径及无世界确认拒绝。
- 最终 `pnpm check`：通过；Vitest 25个文件、196项通过，Node SQLite 7项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。

### 自审

- AI只提供世界草稿，所有ID、锁定字段保护、存档状态和事务由本地程序控制。
- 未实现M4-T02或任何后续任务。

## 2026-07-31 01:11 — M4-T02 实现车卡用例

### 依赖与范围

- 依赖 `M4-T01`：已完成并提交 `549727d`。
- 仅实现CreateCharacter、GenerateCharacterTraits、CompleteCharacterBackground及所需的角色事务提交。
- 不实现酒馆、NPC、页面或真实Provider。

### 完成结果与验收

- CreateCharacter验证Campaign状态、规范文本、年龄和四项属性；每项1至5且总和必须为10。
- 未完成车卡保持为瞬时CharacterDraft，不向完整PlayerCharacter表写入空背景、假特质或占位装备。
- 按规格将特质Schema与Prompt升级为版本2，Fake Provider返回6个候选，完成背景时严格选择2个不同特质。
- 背景Schema与Prompt版本2新增1至4件初始装备的叙事名称和描述；AI不能指定奖励等级或机械效果。
- 程序分配特质/物品ID、BASIC等级和效果；首件装备按职业主属性提供+1检定修正，其余为NONE。
- 完整角色、装备所有权、Campaign的GENERATING_TAVERN状态和pending状态在同一SQLite事务提交。
- 2项真实SQLite用例测试覆盖完整Fake车卡流程及非法属性零写入。
- 最终 `pnpm check`：通过；Vitest 26个文件、198项通过，Node SQLite 7项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。

### 自审

- SQLite仍是已提交游戏事实唯一来源；AI结果经过版本2结构验证后才由本地规则转换。
- `DEC-020` 记录完整角色原子提交及草稿边界。
- 未实现M4-T03或任何后续任务。

## 2026-07-31 01:18 — M4-T03 实现酒馆初始化用例

### 依赖与范围

- 依赖 `M4-T02`：已完成并提交 `f4772c3`。
- 仅实现GenerateTavern、GenerateNpcs、初始传闻与持久化任务发布入口。
- 不实现对话、实际Quest生成、冒险或页面。

### 完成结果与验收

- GenerateTavern从本地WorldBible和PlayerCharacter构建最小输入，经Fake/统一Provider和结构验证后创建酒馆与老板。
- GenerateNpcs Schema/Prompt升级到版本2，要求2名普通常驻、1名临时访客和3条具名来源传闻。
- 本地业务验证人数、居留类型、姓名唯一、访客原因及传闻来源，不接受不完整初始阵容。
- 酒馆与老板在第一事务提交；其余NPC、访客信息、零值关系、有限认知、3条RUMOR WorldFact、Campaign的TAVERN状态在第二事务提交。
- Tavern恢复结果包含老板在内3名常驻与1名访客；3名ACTIVE常驻ID作为后续GenerateQuest发布入口，不提前创建Quest。
- 1项真实SQLite集成测试覆盖完整Fake初始化、传闻来源认知、关系、访客和状态。
- 最终 `pnpm check`：通过；Vitest 27个文件、199项通过，Node SQLite 7项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。

### 自审

- AI只生成叙事草稿和隐藏真伪建议，所有ID、归属、人数规则、认知和事务由本地程序控制。
- `DEC-021` 记录传闻事实与M4-T05任务边界。
- 未实现M4-T04、M4-T05或任何后续任务。

## 2026-07-31 01:23 — M4-T04 实现NPC对话用例

### 依赖与范围

- 依赖 `M4-T03`：已完成并提交 `322906f`。
- 仅实现TalkToNpc、ExtractMemories及其幂等SQLite提交。
- 不实现Quest、冒险、页面或真实Provider。

### 完成结果与验收

- TalkToNpc仅在TAVERN状态且NPC为ACTIVE时工作，从SQLite读取世界、NPC角色卡、该NPC认知、关系、历史消息和长期记忆。
- 复用buildNpcDialogueContext过滤非本NPC消息与excludedSecretFactIds，并执行上下文预算裁剪。
- NPC_REPLY经统一Provider、GenerationRecord与结构验证后，本地应用单回合关系变化规则。
- Conversation、玩家消息、NPC消息、NPC情绪、关系和pending状态在同一事务提交；消息序号连续且NPC消息关联GenerationRecord。
- ExtractMemories从已保存对话构建转录，验证AI返回的sourceTurnIds属于调用方允许集合，再原子追加NpcMemory。
- 真实文件数据库测试覆盖首次对话、关闭重开、继续第二次对话、4条连续消息、已知事实可见、排除秘密不可见及记忆恢复。
- 最终 `pnpm check`：通过；Vitest 28个文件、200项通过，Node SQLite 7项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。

### 自审

- 捕获异常文本未进入SQLite；AI不能直接改关系或写记忆，全部经本地规则与事务。
- 本任务延续DEC-019，无新增重大架构决定。
- 未实现M4-T05或任何后续任务。

## 2026-07-31 01:27 — M4-T05 实现任务用例

### 依赖与范围

- 依赖 `M4-T03`：已完成并提交 `322906f`；M4-T04也已完成并提交 `0842087`。
- 仅实现GenerateQuest、AcceptQuest及任务查询/接受事务。
- 不实现Adventure、奖励结算、页面或真实Provider。

### 完成结果与验收

- GenerateQuest从本地世界、酒馆、玩家角色、ACTIVE NPC和已有任务标题构建最小输入。
- AI输出经Schema后继续验证8至12回合范围、关联NPC必须属于酒馆、关联事实必须存在于当前Campaign。
- 生成任务固定从AVAILABLE开始，AI不能直接接受或激活任务；Quest与pending状态同事务提交。
- QuestRepository新增按Campaign稳定排序查询。
- AcceptQuest使用BEGIN IMMEDIATE在同一事务确认目标AVAILABLE且不存在其他ACCEPTED/ACTIVE主任务，再条件更新。
- 真实SQLite测试连续生成两个AVAILABLE任务，接受第一个后第二个被拒绝并保持AVAILABLE；进行中主任务数量为1。
- 最终 `pnpm check`：通过；Vitest 29个文件、201项通过，Node SQLite 7项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。

### 自审

- AI仅生成任务叙事和结构建议；状态迁移与并发唯一性完全由本地程序和SQLite事务控制。
- `DEC-022` 记录主任务串行接受边界。
- 未实现M4-T06或任何后续任务。

## 2026-07-31 01:33 — M4-T06 实现冒险开始用例

### 依赖与范围

- 依赖 `M4-T05`：已完成并提交 `0864822`。
- 仅实现GenerateAdventurePlan、StartAdventure和计划/启动事务。
- 不实现玩家行动、骰子、冒险回合、结算或页面。

### 完成结果与验收

- GenerateAdventurePlan只接受TAVERN状态中的ACCEPTED任务，从本地世界、角色、任务及其关联事实构建输入。
- AI输出必须保持任务风险与8至12回合范围，且至少包含3条核心线索和2个可能结局。
- 程序分配ClueId，完整AdventurePlan与Clue以PREPARING状态和pending一起原子写入SQLite。
- 用例公开返回 `AdventureStartState`，不含plan、clues、核心场景、阻碍或结局。
- StartAdventure使用BEGIN IMMEDIATE事务同步推进Adventure PREPARING→SCENE、Quest ACCEPTED→ACTIVE、Campaign TAVERN→ADVENTURE。
- Fake Provider计划补齐3条核心线索，仍保持确定性与Schema有效。
- 真实SQLite测试验证隐藏计划/线索存在、公开结果不含plan，以及三实体状态同步推进。
- 最终 `pnpm check`：通过；Vitest 30个文件、202项通过，Node SQLite 7项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。

### 自审

- AI不能启动冒险或直接改变任务/Campaign状态；公开类型阻断隐藏骨架泄露。
- `DEC-023` 记录隐藏数据投影边界。
- 未实现M4-T07或任何后续任务。

## 2026-07-31 01:42 — M4-T07 实现冒险回合用例

### 依赖与范围

- 依赖 `M4-T06`：已完成并提交 `0b08fbf`。
- 仅实现SubmitPlayerAction、RollCheck、ResolveAdventureTurn及所需回合事务扩展。
- 不实现冒险结算、世界时钟推进、回退/重生成、页面或真实Provider。

### 完成结果与验收

- SubmitPlayerAction仅接受SCENE或WAITING_FOR_PLAYER状态，按连续回合号先把玩家行动写入SQLite，再允许Provider参与解析。
- ResolveAdventureTurn复用AITurnOrchestrator、最小冒险上下文、结构Schema和本地状态补丁验证；NPC与线索引用必须属于当前任务/冒险。
- 无检定输出经合法的WAITING_FOR_PLAYER→RESOLVING→SCENE状态序列，在同一事务更新回合、冒险、线索、事实、事件与pending。
- 需要检定的输出进入CHECK_REQUIRED；RollCheck只使用本地D20源、角色属性、已持有匹配装备效果和显式状态修正。
- DiceResult与DICE_ROLLED事件原子写入SQLite，之后的RESOLVE_DICE_RESULT只能生成叙事和经验证补丁，不能修改本地骰点。
- 当前任务不发放奖励或推进世界时钟；此类补丁明确拒绝并保留给M4-T08结算。
- 真实SQLite集成测试依次完成需要检定回合和无检定回合，核对线索发现、装备+1、D20=7、总值11成功、事件序列及最终SCENE状态。
- 最终 `pnpm check`：通过；Vitest 31个文件、203项通过，Node SQLite 7项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。

### 自审

- AI不生成骰点、不直接写游戏状态；所有输出经过Schema与本地业务规则后才进入SQLite事务。
- `DEC-024` 记录分阶段回合、不可变本地骰点与线索引用边界。
- 未实现M4-T08或任何后续任务。

## 2026-07-31 02:01 — M4-T08 实现冒险结算用例

### 依赖与范围

- 依赖 `M4-T07`：已完成并提交 `2eaa001`。
- 仅实现SummarizeAdventure、AdvanceWorldClocks、FinishAdventure及结算档案/事务所需扩展。
- 不实现重生成、快照回退、Windows页面或真实Provider。

### 完成结果与验收

- SUMMARIZE_ADVENTURE Schema/Prompt升级为版本2，摘要输出包含关键选择、未决方向、相关NPC心情/单步关系建议、酒馆变化及受限状态补丁。
- GENERATE_WORLD_EVENT Prompt与既有版本2 Schema对齐，从本地世界、时钟和事件构建上下文；时钟引用必须存在、唯一且每次只推进1。
- 两次生成只持久化GenerationRecord并停留在VALIDATING；任务、NPC、酒馆、世界、奖励和Campaign在FinishAdventure前均保持不变。
- FinishAdventure把摘要建议与世界事件转换为统一领域补丁，按ACTIVE任务→COMPLETED/FAILED、关系单步变化、程序授权奖励、追加事实和时钟规则整批验证。
- AdventureSettlementRepository在BEGIN IMMEDIATE事务内同步提交NPC心情/关系、TavernChange、奖励物品及归属、WorldFact、WorldClock、Quest、AdventureEnding、GameEvent、两条pending状态和Campaign ADVENTURE→SETTLEMENT→TAVERN。
- AdventureEnding扩展为可恢复档案索引，保存关键选择、未决方向、未发现线索、参与NPC、奖励/世界事实/酒馆变化ID和两条GenerationRecord ID；返回档案包含回合、骰子、物品、世界变化及模型/Prompt版本。
- 2项真实SQLite测试覆盖SUCCESS完整奖励结算、FAILURE无奖励结算、中间阶段无部分游戏事实、事件审计及幂等Finish。
- 首轮全量检查准确发现SUMMARIZE_ADVENTURE测试中的旧版本期望；更新为版本2后重新执行全量门禁通过，未关闭或降低检查。
- 最终 `pnpm check`：通过；Vitest 32个文件、205项通过，Node SQLite 7项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。

### 自审

- AI只提出叙事和补丁；Outcome、奖励效果、实体ID、状态迁移、引用范围、变化幅度和事务提交均由本地程序控制。
- `DEC-025` 记录“验证草案后单事务结算”和ending_json档案索引方案。
- 未实现M4-T09或任何后续任务。

## 2026-07-31 02:14 — M4-T09 实现重生成和回退用例

### 依赖与范围

- 依赖 `M4-T07`：已完成并提交 `2eaa001`；M4-T08也已完成并提交 `48001da`。
- 仅实现保留玩家输入重生成、切换Provider重生成、规则模式限次和最新快照回退。
- 不实现Windows页面、真实Provider、导入导出或M5任务。

### 完成结果与验收

- SubmitPlayerAction在玩家输入写入SQLite后创建TURN_INPUT AUTO快照；ResolveAdventureTurn拒绝缺少生成前快照的回合，确保AI结果始终有可恢复基线。
- SnapshotRepository按Campaign捕获游戏状态表和Campaign设置，使用规范JSON、UTF-8 BLOB与SHA-256校验；恢复时先校验完整性，再以BEGIN IMMEDIATE单事务替换有效状态。
- 快照不保存API Key、全局Provider配置或GenerationRecord；回合仍存在时保留pending请求审计，使规则模式可从SQLite统计已提交的生成次数。
- RegenerationUseCases先校验自由故事/规则限次模式和Campaign的模型切换策略，再保存安全快照、恢复TURN_INPUT快照，并调用既有AdventureTurnUseCases及统一AI编排链。
- 跨Provider类型切换无论自动策略如何都必须明确接受数据发送披露；需要人工批准的策略未获批准时不会创建快照或调用Provider。
- Provider、结构、领域或提交失败时恢复安全快照；成功时保留原PlayerAction，以新回合叙事、补丁和事件替换旧游戏状态，并记录MODEL_SWITCHED事件。
- rollbackLatestSnapshot恢复最近快照；AUTO快照按Campaign只保留最近10个，符合规格保留策略。
- 真实SQLite测试覆盖跨厂商披露拒绝、Provider失败恢复、切换Provider成功重生成、旧/新事实互斥、玩家输入不变、规则模式限次和最新快照回退。
- 首轮全量检查准确发现类型导入、未使用声明和异常cause规则问题；逐项修正后重新执行全量门禁通过，未关闭或降低检查。
- 最终 `pnpm check`：通过；Vitest 32个文件、206项通过，Node SQLite 7项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。

### 自审

- SQLite仍是唯一游戏事实来源；快照恢复与新生成不会让旧AI补丁和新补丁同时生效。
- AI调用仍经过统一Provider接口、结构Schema和领域补丁验证，快照层不接触密钥。
- `DEC-026` 记录Campaign逻辑快照、审计保留及重生成失败恢复边界。
- 未实现M5-T01或任何后续任务。

## 2026-07-31 02:28 — M5-T01 初始化Windows Tauri应用

### 依赖与范围

- 依赖 `M0-T03`：已完成；M4里程碑也已全部完成并以 `4774f1d` 结束。
- 仅初始化Windows React、Vite、Tauri、基础路由、基础主题和共享包访问。
- 不实现M5-T02导航壳、业务页面、SQLite桌面适配、原生命令或真实Provider。

### 完成结果与验收

- windows-app成为独立pnpm项目，固定使用React 19.2.8、React Router 7.18.2、Vite 7.2.4和Tauri CLI 2.11.4；无peer依赖问题。
- 根Cargo workspace加入windows-app/src-tauri；Tauri Rust crate使用Tauri 2.11.5，Windows资源使用可复现SVG源和官方工具生成的ICO。
- HashRouter提供 `/` 启动入口和稳定not-found回退，避免打包后的路由依赖外部服务器；未提前创建业务导航。
- 启动页直接调用 `@ember-tavern/contracts` 的schemaVersion并显示Schema v1，证明Windows前端能访问共享包。
- 基础主题使用深蓝黑、氧化铜和苔绿token及拱形炉门构图；支持窄窗口、可见键盘焦点和prefers-reduced-motion。
- Tauri配置只为main窗口启用core:default capability；没有暴露SQL、任意文件、HTTP、密钥或未要求的原生命令。
- `pnpm --filter @ember-tavern/windows-app build`通过；Vite输出52个模块。
- `cargo check -p ember-tavern-windows`通过；`pnpm --filter @ember-tavern/windows-app tauri build --no-bundle`通过并生成8,636,416字节release EXE。
- `tauri dev`实际启动 `ember-tavern-windows.exe`，MainWindowTitle为Ember Tavern、MainWindowHandle非零且Responding=True；验收后已清理应用、WebView、Vite和Cargo子进程，1420端口释放。
- 首轮Cargo检查准确发现Windows资源缺少icon.ico；补齐可复现图标后通过。全量门禁又发现Tauri schema和Vite dist生成物被格式/lint误检，改为仅忽略可再生目录后通过，没有降低源码检查。
- 最终 `pnpm check`：通过；Vitest 33个文件、208项通过，Node SQLite 7项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。

### 自审

- UI只保存展示状态，没有引入游戏事实缓存；SQLite权威边界未改变。
- frontend-design技能将视觉限定为单一启动状态和一个拱形炉门识别元素，避免提前实现导航壳。
- `DEC-027` 记录HashRouter、最小Tauri capability和可复现Windows资源边界。
- 未实现M5-T02或任何后续任务。

## 2026-07-31 02:35 — M5-T02 实现Windows应用壳和导航

### 依赖与范围

- 依赖 `M5-T01`：已完成并提交 `7593c2b`。
- 仅实现侧栏、标题栏、加载状态、错误边界和六个规定页面的可导航骨架。
- 不实现M5-T03存档首页、数据库连接、业务按钮、AI调用或后续页面功能。

### 完成结果与验收

- AppShell提供固定侧栏、品牌标记、离线状态和随路由变化的标题栏；窄窗口收起文字但保留全部导航入口。
- WINDOWS_NAVIGATION集中定义酒馆、任务、冒险、角色、档案和设置六个路由；根路由重定向到酒馆，未知路径提供固定回退。
- 六个页面使用延迟加载的独立模块并明确标注尚未启用业务功能；酒馆骨架继续运行共享contracts的Schema版本验证。
- Suspense统一使用AppLoading，包含aria-live、aria-busy和reduced-motion静态降级。
- 路由内容由AppErrorBoundary隔离；失败只显示开发者固定的恢复说明，不暴露原始异常文本、不吞掉数据库操作且切换路径会重建边界。
- 3项jsdom组件测试逐一点击并验证六个活动路由、加载态可访问语义，以及错误边界不显示私有异常文本。
- `pnpm --filter @ember-tavern/windows-app build`通过；Vite构建55个模块并生成独立section-pages chunk。
- `tauri dev`再次实际启动Windows窗口，MainWindowTitle为Ember Tavern、MainWindowHandle非零且Responding=True；验收后所有子进程清理且1420端口释放。
- 首轮全量检查发现空的componentDidCatch参数违反严格unused规则；移除非必要钩子后重跑全部通过，未调整规则。
- 最终 `pnpm check`：通过；Vitest 33个文件、209项通过，Node SQLite 7项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo测试均通过。

### 自审

- 页面只展示固定空状态，不读取、缓存或伪造游戏事实。
- 错误边界不写日志或存档，不会把异常文本泄露到UI；原生日志能力留给对应任务。
- 沿用 `DEC-027` 的HashRouter和最小Tauri capability，没有产生新的重大架构决定。
- 未实现M5-T03或任何后续任务。

## 2026-07-31 02:52 — M5-T03 实现存档首页

### 依赖与范围

- 依赖 `M4-T01` 和 `M5-T02`：均已完成，M5-T02已提交 `308adc3`。
- 仅实现Windows存档首页的新建、继续、归档、最后游玩时间和本地重启恢复。
- 不实现M5-T04世界创建页面、真实Provider、通用SQL桥、导入导出或后续业务页面。

### 完成结果与验收

- Windows启动时由Rust在Tauri应用数据目录打开固定 `ember-tavern.sqlite`，复用 `0001_initial.sql` 并维护兼容的 `schema_migrations`；未来Schema版本会被明确拒绝。
- 原生桥只提供campaign_list、campaign_create、campaign_continue、campaign_archive四个高层命令；WebView不能提交SQL、文件路径、时间或存档内容。
- 新存档由原生程序生成UUID和规范UTC时间，并以CREATING_WORLD状态写入SQLite；继续操作验证存档存在且未归档，再更新updated_at作为最后游玩时间。
- 归档在SQLite保留原行并设为ARCHIVED，活动列表不再显示；页面在启动及每次变更后都重新查询SQLite。
- 前端网关将Tauri返回值视为unknown，逐字段验证ID、状态和规范时间；错误界面使用固定文案，不显示底层数据库异常。
- 存档首页提供加载、空列表、错误、操作中状态，显示本地存档数量、当前阶段和最后游玩时间；继续后把经原生验证的Campaign ID带入现有应用壳，不提前实现世界创建页面。
- 3项Rust真实SQLite测试覆盖创建后两次重开仍可列出、继续更新时间、归档保留数据及未来Schema拒绝；4项jsdom测试覆盖读取、时间显示、新建、继续、归档和模拟应用重启重新读取。
- `pnpm --filter @ember-tavern/windows-app build`通过；Vite构建59个模块并生成独立save-home-page chunk。
- `pnpm --filter @ember-tavern/windows-app tauri build --no-bundle`通过；release应用实际启动，窗口标题为Ember Tavern、MainWindowHandle非零且Responding=True。
- 实际启动在 `C:\Users\PC\AppData\Roaming\com.embertavern.windows\ember-tavern.sqlite` 创建/打开385,024字节数据库；烟测后应用进程已停止。
- 最终 `pnpm check`：通过；Vitest 34个文件、213项通过，Node SQLite 7项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo workspace测试均通过。

### 自审

- SQLite是存档列表、状态和最后游玩时间的唯一真实数据源；没有使用localStorage、写死存档或前端数据库。
- 原生边界未开放任意SQL、文件或网络能力；没有API Key或模型调用。
- `DEC-028` 记录受限存档命令、平台数据库路径、双边响应验证和共享迁移来源。
- 未实现M5-T04或任何后续任务。

## 2026-07-31 03:12 — M5-T04 实现世界创建与预览页面

### 依赖与范围

- 依赖 `M4-T01` 和 `M5-T02`：均已完成；上一任务M5-T03已提交 `b885202`。
- 仅实现世界基础选项、可选构想、Fake生成、预览、手动编辑、字段锁定、局部/全部重生成和确认。
- 不实现M5-T05车卡、真实Provider、通用SQL桥、恢复中心或后续页面功能。

### 完成结果与验收

- WindowsWorldCreationService调用共享FakeAIProvider、Prompt格式层、GENERATE_WORLD/REFINE_WORLD Schema和validateAIOutput；页面不直接调用Provider或拼接任务提示词。
- 基础表单覆盖世界类型、故事氛围、魔法程度、世界规模、黑暗程度、四类内容许可、不希望出现的内容和可选自由构想；无自由构想时仍由基础选项形成合法输入。
- 预览页展示完整世界圣经、主要势力、地点和剧情线索；九个协议允许字段可手动修改和锁定，锁定字段在局部重生成中保持不变。
- 局部修改先保存当前编辑和锁定，再通过REFINE_WORLD生成；全部重生成显式清除锁定后走同一统一Provider/Schema路径，不写死页面结果。
- Rust增加world_creation_get、world_generation_commit、world_draft_update、world_confirm四个固定语义命令，不向WebView暴露SQL、文件路径或生成时间。
- 原生提交拒绝未知字段，校验文本范围、唯一势力/地点、父地点和势力引用、Campaign状态、Prompt版本、幂等键与锁定值；validatedOutput世界必须和待提交WorldBible完全一致。
- 世界、Campaign、GenerationRecord和COMMITTED pending请求在单一BEGIN IMMEDIATE事务落库；确认只在REVIEWING_WORLD且世界存在时推进至CREATING_CHARACTER。
- 3项新增Rust测试覆盖真实SQLite重开恢复、确认、锁定字段拒绝和验证输出篡改拒绝；4项新增前端测试使用真实Fake Provider覆盖生成/细化服务及页面生成、锁定、局部修改和确认；存档路由补充REVIEWING_WORLD返回世界页测试。
- Windows生产构建通过，Vite转换153个模块并生成独立world-creation-page chunk；Tauri release无bundle构建通过，实际窗口启动并响应。
- 实际窗口键盘烟测完成“继续存档→基础选项生成→确认”：SQLite中世界圣经和COMMITTED请求各1条，Campaign最终为CREATING_CHARACTER；所有临时测试Campaign及其子记录已级联清理，残留0。
- 最终 `pnpm check`：通过；Vitest 36个文件、218项通过，Node SQLite 7项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo workspace测试均通过。

### 自审

- AI输出经过共享结构验证和Rust业务/结构复核后才进入SQLite；输出与提交世界不一致会整笔拒绝。
- 页面状态仅用于未提交表单和展示；重新加载时世界、锁定和Campaign阶段均来自SQLite。
- `DEC-029` 记录统一Provider执行与原生原子提交的跨运行时边界。
- 未实现M5-T05或任何后续任务。

## 2026-07-31 03:31 — M5-T05 实现车卡页面

### 依赖与范围

- 依赖 `M4-T02` 和 `M5-T04`：均已完成；上一任务M5-T04已提交 `ece3204`。
- 仅实现分步车卡、属性分配、特质选择、背景与装备预览，以及完成后进入酒馆生成入口。
- 不实现M5-T06酒馆内容、NPC/任务交互、真实Provider、通用SQL桥或后续页面功能。

### 完成结果与验收

- 新增独立 `/character/create` 流程；世界确认和CREATING_CHARACTER存档继续操作均进入该路由，其他Campaign阶段不冒充可创建状态。
- 基础车卡覆盖姓名、可选性别/年龄、角色概念、四种固定职业原型与显示名、个人目标、故事偏好和内容边界。
- 四项属性均限制为1至5且总和必须为10；页面展示实时分配总数，非法总数不能请求特质，TypeScript和Rust边界再次校验相同规则。
- WindowsCharacterCreationService通过共享FakeAIProvider、Prompt、版本2任务Schema和validateAIOutput生成六个候选特质及完整背景；页面不直接调用Provider或拼接Prompt。
- 特质阶段只能从当前SQLite持久化生成记录的六个候选中选择两个；候选ID由生成记录稳定派生，生成后关闭并重开数据库仍恢复完整草稿与候选。
- Rust新增character_creation_get、character_traits_commit、character_completion_commit三个固定语义命令；拒绝未知字段、跨Campaign数据、非法阶段/属性、非候选特质、篡改的原始响应与验证结果，以及与车卡不一致的生成输入/上下文。
- 完成操作在单个BEGIN IMMEDIATE事务中写入PlayerCharacter、程序分配ID和效果的初始Item、GenerationRecord与COMMITTED pending请求，并将Campaign推进到GENERATING_TAVERN。
- 背景预览展示出生地、成长经历、冒险动机、秘密、重要人物、到达酒馆原因及装备效果；“进入酒馆生成流程”只导航到既有酒馆入口，没有实现M5-T06内容。
- 6项新增前端测试覆盖真实Fake Provider服务、非法属性阻断、三段页面流程、六选二上限与重载恢复；现有存档/世界路由测试补充车卡路径。
- 2项角色原生测试使用真实SQLite覆盖特质后重开恢复、完整角色与装备再次重开、非法属性、非候选特质及响应篡改无写入。
- `pnpm --filter @ember-tavern/windows-app build`通过；Vite转换155个模块并生成独立character-creation-page chunk。
- `pnpm --filter @ember-tavern/windows-app tauri build --no-bundle`通过；release应用实际启动，窗口标题为Ember Tavern、MainWindowHandle非零且Responding=True，烟测后进程已停止。
- 最终 `pnpm check`：通过；Vitest 38个文件、225项通过，Node SQLite 7项通过；native-bridge Rust 8项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo workspace测试均通过。

### 自审

- SQLite是已生成特质、已完成角色、装备和Campaign阶段的唯一真实数据源；页面只保留未提交表单及当前展示状态。
- AI结果在共享结构验证后仍由Rust复核业务规则、输入上下文和原始/验证输出一致性，不能直接修改游戏事实。
- 本任务沿用 `DEC-029` 的统一Provider执行与受限原生原子提交边界，没有形成新的重大架构决定，因此未新增DEC。
- M5-T05验收“完成后进入酒馆生成流程”已由组件流程、路由测试、生产构建和窗口启动烟测覆盖。
- 未实现M5-T06或任何后续任务。

## 2026-07-31 03:50 — M5-T06 实现酒馆页面

### 依赖与范围

- 依赖 `M4-T03` 和 `M5-T05`：均已完成；上一任务M5-T05已提交 `7939093`。
- 仅实现酒馆初始化与首页展示、NPC页内选择和任务入口导航。
- 不实现M5-T07 NPC聊天、M5-T08任务生成/详情/接受、冒险、真实Provider或后续页面功能。

### 完成结果与验收

- WindowsTavernService在GENERATING_TAVERN阶段通过共享FakeAIProvider、Prompt、GENERATE_TAVERN/GENERATE_NPCS Schema和validateAIOutput依次生成酒馆/老板及初始阵容/传闻。
- React StrictMode可能重复执行加载Effect；服务按Campaign缓存正在进行的初始化Promise，两个调用共享同一两段生成，不产生竞争提交或额外Provider请求。
- Rust新增tavern_get、tavern_generation_commit、tavern_npcs_commit三个固定语义命令；WebView不能提交SQL、文件路径、生成时间、实体ID或传闻真实性。
- 原生层把跨进程载荷视为不可信：拒绝未知字段，复核Campaign阶段、世界/角色/地点来源、生成输入与上下文、Prompt任务、原始/验证输出一致性、NPC唯一名称、两常驻一访客、访客原因及三条传闻来源。
- 第一事务写入酒馆、老板、初始有限认知/零关系及生成审计；第二事务写入两名常驻、一名访客、三条传闻、关系/知识、世界时钟、生成审计并将Campaign推进至TAVERN。
- 传闻真实性保存在SQLite detail_json供后续规则使用，但TavernSnapshot只返回陈述与来源NPC，页面无法直接看到真伪。
- 规格要求每存档约三个世界时钟，而既有酒馆AI Schema不含时钟字段；第二事务从已验证的世界核心冲突、酒馆长期问题和首条剧情线索建立三个0/6时钟，阈值与单步推进继续由程序控制。
- 酒馆页展示名称、位置、环境、特殊规则、长期问题、老板、两名常驻、一名访客、访客原因、三条传闻、任务告示板入口和三个世界时钟。
- 点击NPC会更新页内选中态并展示其公开资料；任务入口携带Campaign ID导航到既有任务路由。聊天和任务业务明确保留给M5-T07/M5-T08。
- 2项新增服务测试覆盖真实Fake Provider两段生成、Prompt版本、并发去重和已初始化快照不重复生成；2项页面测试覆盖初始化、全部展示项、隐藏传闻真伪、NPC选择和任务导航。
- 2项新增Rust真实SQLite测试覆盖酒馆提交后重开继续、完整初始化后再次重开、4名NPC/3传闻/3时钟恢复、响应篡改、非法阵容及老板重名不产生部分写入。
- 首轮全量并发测试发现延迟模块在默认等待窗口内仍处于Suspense，保留原断言并将显式异步等待上限设为5秒；随后全部通过。
- 首轮严格Clippy发现布尔filter_map、参数过多和手写Option映射；改为filter+map、NpcInsert参数对象和Option::map后通过，未添加allow或降低规则。
- `pnpm --filter @ember-tavern/windows-app build`通过；Vite转换157个模块并生成独立tavern-page chunk。
- `pnpm --filter @ember-tavern/windows-app tauri build --no-bundle`通过；release应用实际启动，窗口标题为Ember Tavern、MainWindowHandle非零且Responding=True，烟测后进程已停止。
- 最终 `pnpm check`：通过；Vitest 40个文件、229项通过，Node SQLite 7项通过；native-bridge Rust 10项通过；TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和Cargo workspace测试均通过。

### 自审

- SQLite是酒馆、NPC、关系、有限认知、访客、传闻、时钟和Campaign阶段的唯一真实数据源；页面只保留选中NPC这一展示状态。
- AI输出经过共享结构验证和Rust业务复核后才在事务内写入，响应篡改、非法阵容或重名均保持正式状态不变。
- `DEC-030` 记录无新增AI Schema情况下由程序从已验证事实建立初始时钟，以及传闻真实性不越过页面读取边界。
- M5-T06验收“能够选择NPC或任务”已由页内NPC选择和携带Campaign ID的任务入口测试覆盖。
- 未实现M5-T07或任何后续任务。

## 2026-07-31 04:06 — M5-T07 实现NPC聊天页面

### 依赖与范围

- 依赖 `M4-T04` 和 `M5-T06`：均已完成；上一任务M5-T06已提交 `336aa5f`。
- 仅实现酒馆NPC对话入口、历史消息、自由输入、建议话题、关系状态和重启恢复。
- 不实现M5-T08任务列表/详情/接受、NPC长期记忆提取、冒险页面、真实Provider或后续功能。

### 完成结果与验收

- 酒馆选中NPC后可携带Campaign ID与NPC ID进入独立对话路由；对话页保留应用壳并提供返回酒馆入口。
- 页面展示NPC公开身份、外观、性格、当前心情、四维关系、完整已保存消息和最近一次回复的建议话题；不展示NPC秘密或认知内部数据。
- WindowsNpcDialogueService通过统一FakeAIProvider、共享NPC_REPLY Schema、Prompt和validateAIOutput生成回复；页面不直接拼接Prompt或写入游戏事实。
- Rust新增npc_dialogue_get和npc_dialogue_commit两个固定语义命令，WebView不能提交SQL、数据库路径、会话ID、消息ID、序号、关系最终值或NPC最终心情。
- 原生层在BEGIN IMMEDIATE事务内从SQLite重建世界、NPC自身资料、有限认知、关系、最近12条消息和最近8条长期记忆组成的上下文，并与跨进程生成输入逐字段比对。
- 原始响应必须等于结构验证结果；回复、心情、建议话题和关系建议再次经过Rust业务校验，关系单次变化限于-1至1且最终保持-5至5。
- 首次发送由原生层分配会话与消息ID；玩家消息、NPC消息、GenerationRecord、COMMITTED pending、心情、关系和会话时间一次性提交，失败不留下部分对话。
- 读取快照通过NPC消息关联的最新GenerationRecord恢复建议话题；应用或数据库重开后继续使用原会话和连续序号。
- 1项服务测试覆盖两次真实Fake生成并确认第二次上下文包含前一轮；1项页面测试覆盖历史、建议话题、自由输入和关系刷新；酒馆测试覆盖Campaign/NPC身份传递。
- 2项Rust真实SQLite测试覆盖两次连续发送、中间数据库重开、消息序号1至4、关系累加、建议话题恢复，以及篡改有限认知时零部分写入。
- 首轮全量检查仅发现新增页面不符合Prettier格式；执行同一Prettier规则格式化后重跑全部门禁通过，没有关闭或降低检查。
- `pnpm check`通过：Vitest 42个文件231项、Node SQLite 7项、native-bridge Rust 12项及全部类型、lint、格式和严格Clippy检查成功。
- `pnpm --filter @ember-tavern/windows-app build`通过；Vite转换159个模块并生成独立npc-dialogue-page chunk。
- `pnpm --filter @ember-tavern/windows-app tauri build --no-bundle`通过；release窗口实际启动，标题为Ember Tavern、MainWindowHandle非零且Responding=True，烟测后进程已停止。

### 自审

- SQLite是会话、消息、关系和NPC心情的唯一真实数据源；页面只保留输入草稿、等待态和当前SQLite快照。
- AI输出在共享结构验证后仍须通过Rust重建上下文和业务规则验证，不能直接决定ID、序号、最终关系值或提交边界。
- 本任务沿用 `DEC-029` 的统一Provider执行与受限原生原子提交边界，没有形成新的重大架构决定，因此未更新 `docs/DECISIONS.md`。
- M5-T07验收“连续发送消息并在重启后恢复”由真实SQLite重开测试、服务连续生成测试、页面交互测试、全量门禁和release构建共同覆盖。
- 未实现M5-T08或任何后续任务。

## 2026-07-31 04:20 — M5-T08 实现任务页面

### 依赖与范围

- 依赖 `M4-T05` 和 `M5-T06`：均已完成；上一任务M5-T07已提交 `0ed0529`。
- 仅实现任务列表、详情、离线初始任务生成、接受、风险、推荐属性和冒险准备入口。
- 不实现M5-T09冒险三栏、冒险计划生成/启动、回合、骰子、结算、真实Provider或后续功能。

### 完成结果与验收

- WindowsQuestBoardService从SQLite读取任务告示；不足两条时通过统一FakeAIProvider、共享GENERATE_QUEST Schema、Prompt和validateAIOutput依次补足。
- React StrictMode可能并发触发初始化；服务按Campaign缓存正在进行的初始化Promise，同一存档共享一条顺序生成链。
- 原Fake任务结果引用固定npc-owner和npc-cartographer，与Windows原生分配的真实UUID不兼容；将可选relatedNpcIds改为空数组，发布者仍从当前SQLite酒馆NPC明确选择，未关闭引用归属验证。
- Rust新增quest_board_get、quest_generation_commit、quest_accept三个固定语义命令；WebView不能提交SQL、数据库路径、Quest ID、时间、状态最终值或接受事务。
- 原生层从SQLite重建当前世界、酒馆、角色概念、全部活跃酒馆NPC、发布者与最近20个任务标题，逐字段比对生成输入和审计上下文。
- 任务输出再次校验内容、风险枚举、奖励枚举、1至4个推荐属性、8至12回合范围、NPC引用和世界事实引用；实体ID由Rust分配。
- 生成事务原子写入AVAILABLE Quest、GenerationRecord和COMMITTED pending；篡改输入、非法长度或越界引用不会留下部分任务。
- 接受事务只允许TAVERN阶段的AVAILABLE任务；同一Campaign已有ACCEPTED或ACTIVE主任务时拒绝第二项，重复接受同一任务保持幂等。
- 页面展示任务列表、发布者、标题、摘要、状态、风险、目标、失败代价、8至12回合范围、奖励级别和推荐属性。
- 接受成功后页面展示“进入冒险准备”链接，携带Campaign ID和Quest ID导航到既有冒险入口；不生成隐藏计划、不启动Campaign冒险状态，也不实现M5-T09 UI。
- 1项服务测试覆盖真实Fake两任务生成、StrictMode并发合并、发布者轮换、最近标题上下文与接受；1项页面测试覆盖列表/详情/风险/属性、接受和准备路由。
- 2项Rust真实SQLite测试覆盖两任务生成、中间数据库重开、只接受一个主任务、接受状态再次重开，以及篡改角色概念时零部分写入。
- 首轮路由回归发现无Campaign时新任务页未保留原壳测试要求的“任务”一级标题；恢复该稳定可访问标题并保留引导说明后，原断言与新增业务断言均通过。
- 首轮全量检查仅发现4个新增TypeScript文件不符合Prettier格式；使用同一规则格式化后完整重跑通过，没有关闭或降低检查。
- `pnpm check`通过：Vitest 44个文件233项、Node SQLite 7项、native-bridge Rust 14项及全部类型、lint、格式和严格Clippy检查成功。
- `pnpm --filter @ember-tavern/windows-app build`和`tauri build --no-bundle`通过；Vite转换161个模块并生成独立quest-board-page chunk。
- release窗口实际启动，标题为Ember Tavern、MainWindowHandle非零且Responding=True，烟测后进程已停止。

### 自审

- SQLite是任务、发布者、状态和单主任务约束的唯一真实数据源；页面只保留当前选择、等待态和SQLite快照。
- AI只生成任务内容和结构建议；Rust控制ID、发布者授权、引用范围、回合范围、初始状态和事务提交，接受操作完全不经过AI。
- 本任务沿用 `DEC-029` 的统一Provider执行与受限原生原子提交边界，没有形成新的重大架构决定，因此未更新 `docs/DECISIONS.md`。
- M5-T08验收“接受任务后可进入冒险准备”由页面路由测试、真实SQLite接受/重开测试、全量门禁、release构建和窗口烟测共同覆盖。
- 未实现M5-T09或任何后续任务。

## 2026-08-01 — M5-T09 实现Windows冒险三栏页面

### 范围与实现

- 接入冒险准备、启动、行动提交、AI回合、程序D20和骰点叙事的固定Tauri语义命令；WebView不接触SQL、数据库路径或任意模型HTTP。
- 三栏页面分别展示角色/目标/世界时钟、持久化剧情/建议行动/自由输入、物品/已发现线索/最近骰点，AdventurePlan不返回公开页面字段。
- Fake Provider按计划最少回合数在第8回合进入ENDING，第1、3、6回合请求检定，其余中间回合无需检定；骰点由Rust本地生成。
- 玩家行动在AI生成前写入SQLite；WAITING_FOR_PLAYER和RESOLVING可在Provider失败或应用重启后续跑，重复点击与重复恢复不会重复写行动或骰点。
- Rust在事务内重建并比较AI输入，复核Campaign/Quest/Adventure/Turn归属、状态机、连续序号、线索发现回合、NPC引用、检定枚举和事实补丁。

### Review修复

- 修复原交接实现前7回合全部检定，改为符合规格的3次检定与无检定混合流程。
- 修复真实角色特质携带本地ID导致严格冒险输入Schema拒绝；原生上下文只投影name和description，并由真实SQLite测试断言。
- 修复ADVENTURE存档从首页继续时错误进入酒馆；新增存档首页路由测试。
- 修复无检定回合后右栏隐藏已持久化最近骰点；页面改为查找最近非空DiceResult并补测试。
- 修复Provider失败后重试会再次提交动作/掷骰；服务现在先读取SQLite状态并恢复原工作。

### 验证与烟测

- `cargo fmt --all -- --check`、`cargo clippy --workspace --all-targets --all-features -- -D warnings`和`cargo test --workspace`通过；native-bridge 15项测试通过。
- `pnpm check`、Windows生产前端build和`tauri build --no-bundle`通过。
- release应用真实完成新建存档、世界、车卡、酒馆、任务接受、冒险准备、8回合、3次D20和ENDING；关闭重开恢复待处理回合与最终8回合记录。
- SQLite核对为8回合、3个DiceResult、3条发现线索、2件初始物品；Adventure ending_json为空、Quest仍ACTIVE、世界时钟全0、无摘要/世界事件生成，确认未执行M5-T10结算。
- 烟测进程已停止，唯一测试Campaign级联删除后，测试SQLite和空应用数据目录也已移除。

### 自审

- SQLite仍是唯一事实源；AI输出经共享Schema和Rust业务验证后才能提交，且AI不生成骰点。
- 页面只调用固定命令；并发、失败、重启、输入验证和事务原子性均有测试或真实烟测证据。
- 未实现奖励、NPC变化、世界变化、返回酒馆或档案页面；这些保持在M5-T10范围。

## 2026-08-01 — M5-T10 结算与冒险档案页面

### 范围与实现

- Windows服务使用统一Fake Provider、Prompt和共享Schema生成摘要与世界事件；固定Tauri命令在Rust侧再次验证审计、引用和领域边界。
- SQLite立即事务一次写入任务完成、NPC心情/关系、酒馆陈设、程序授权奖励、世界事实/时钟、四类GameEvent、两份AI审计、AdventureEnding和Campaign返回酒馆。
- 档案从已提交ending_json及关联SQLite事实重建；页面展示摘要、关键选择、骰子记录、参与NPC、未解决线索、奖励、世界事实、后续方向及模型/Prompt版本，酒馆同步展示永久变化。

### Review修复

- 修复冒险快照遗漏publisherNpcId造成真实准备流程无法载入；真实release烟测发现后补齐Rust/TypeScript契约并重建验证。
- Fake结算输出改为使用输入中的真实NPC/时钟ID，避免测试符号ID与Windows UUID不一致。
- 将已结算检查移入SQLite立即事务，消除两个并发结算都观察ENDING的竞态；服务侧同时按Campaign单飞。
- 增加原始响应与验证输出一致性、上下文Adventure ID、奖励等级、关系目标/增量、时钟唯一性和文本/集合上限验证。
- 补齐RELATIONSHIP_CHANGED、ITEM_ACQUIRED、WORLD_CLOCK_ADVANCED与ADVENTURE_COMPLETED事件；未知时钟回滚测试确认没有部分写入。

### 验证与烟测

- `pnpm check`通过：48个Vitest文件242项、Node SQLite 7项、native-bridge 16项；格式、ESLint、类型、Rust fmt、严格Clippy和workspace测试全部通过。
- `cargo metadata --format-version 1`、独立Cargo门、Windows生产前端build及`tauri build --no-bundle`通过。
- release应用从已接受任务完成准备、8回合、3次本地D20、结算、档案和返回酒馆；可见NPC变为Relieved、一个世界时钟推进、酒馆新增TROPHY。
- 关闭重启后档案完整恢复；SQLite为Quest COMPLETED、Adventure SETTLED、8回合/3骰点、3件物品、1条结算事实，两份结算GenerationRecord及四类事件各一份。
- 烟测进程停止，唯一测试Campaign按精确ID级联删除并VACUUM，剩余Campaign为0；空SQLite容器因终端安全策略保留，不含游戏数据。

### 自审

- WebView只调用固定结算与档案命令，不接触SQL；AI只提出内容，所有ID绑定、奖励效果、时钟推进和提交权限由本地程序控制。
- 事务原子性、失败回滚、幂等重放、快速重复点击、重启恢复和页面展示均有自动化或真实烟测证据。
- 沿用DEC-027与DEC-029的结算和Windows Provider边界，没有新增重大架构决定；未实现M5-T11或真实Provider。

## 2026-08-01 — M5-T11 Windows离线纵向切片验收

### 验收过程

- 启动最终Tauri release可执行文件，从空SQLite创建全新存档，完成世界、车卡、酒馆生成和与Ilyra Venn的自由对话。
- 接受任务后完成冒险准备、8回合Fake冒险和3次本地D20，随后完成结算、查看完整档案并返回酒馆。
- 关闭应用并重新启动，分别打开NPC对话、档案和酒馆页面，确认对话历史、关系、骰子、模型/Prompt审计、奖励、世界事实、酒馆变化、NPC心情和世界时钟恢复。

### 数据核对与清理

- 重启前SQLite为Campaign TAVERN、Quest COMPLETED、Adventure SETTLED且current_turn_number=8、3个DiceResult、2条对话消息、3件物品、1条结算世界事实和非空ending_json。
- M5-T10最终完整质量门及release构建已通过；本验收任务没有源码修改，也未触碰真实Provider、模型切换或导入导出等后续范围。
- 进程停止后确认应用数据中只有本次测试Campaign，再按精确ID级联删除并VACUUM；剩余Campaign为0，空SQLite容器无游戏数据。

### 结论

- `docs/TASKS.md`列出的Windows离线纵向切片流程全部通过，关闭重启后所有核心进度仍存在。
- 下一任务是M6-T01 Rust安全HTTP传输层；真实凭证和可能收费调用仍受硬性确认约束。

## 2026-08-01 — M6-T01 实现Rust安全HTTP传输层

### 实现

- 新增workspace crate `ember-secure-http`，以Reqwest 0.13的最小Rustls与stream特性实现Rust内部HTTP边界。
- `ApprovedEndpoint`只允许远程HTTPS和本机回环HTTP，拒绝URL凭证、查询、片段、缺失尾斜杠及相对路径逃逸；客户端关闭重定向。
- `SecureHttpTransport`支持GET/POST、敏感Header、请求正文、100毫秒至120秒总时限、CancellationToken、逐块响应和每请求响应上限（全局最大16 MiB）。
- 将配置、输入、超时、取消、TLS、网络、认证、限流、客户端、服务端、流和大小错误映射为稳定枚举，不向调用者携带Reqwest原始错误。
- Header值与请求Body在Debug中脱敏；没有注册Tauri HTTP命令或扩大`core:default` capability。

### 测试与验证

- 本地Tokio TCP服务器测试请求收集、流式首块、在途取消、全流超时、429映射、响应大小限制、端点/路径拒绝及Debug脱敏，共7项；没有真实Provider调用。
- Review发现测试服务器固定等待4096字节会与HTTP keep-alive互锁，改为读取到头结束标记，并用Notify只同步取消用例。
- `cargo metadata --format-version 1 --no-deps`、`cargo fmt --all -- --check`、workspace全目标全特性严格Clippy和`cargo test --workspace`通过；Rust共23项测试。
- `pnpm check`通过：48个Vitest文件242项、7项Node SQLite以及23项Rust测试；格式、ESLint和类型检查通过。
- Windows前端生产build及Tauri release `--no-bundle`通过。

### 结论

- M6-T01验收通过：模型网络能力只存在于未暴露给WebView的Rust crate；前端不能传入任意URL或发起任意模型HTTP。
- M6-T02密钥存储、Provider适配器和真实模型调用均未实现；下一任务为M6-T02。

## 2026-08-01 — M6-T02 实现安全密钥仓库

### 实现

- 新增`ember-secure-secrets` workspace crate，通过`keyring-core 1.0.0`与`windows-native-keyring-store 1.1.0`访问Windows Credential Manager；两个依赖均为MIT OR Apache-2.0并保持最小Windows范围。
- `SecretStore::save`生成`credential:v1:<UUID>`不透明引用，秘密限制为1至2048字节且拒绝NUL；Windows条目使用Local持久化。
- 保存输入、存在检查读取及可信Provider闭包读取均以zeroize清除内存副本；CredentialRef的Debug只显示`<opaque>`，平台错误统一映射，不输出底层异常。
- 删除不存在条目视为成功，便于配置清理幂等；非Windows平台暂返回明确Unavailable，Keychain实现保留给后续iOS平台任务。
- Tauri新增规格第31节允许的`secret_save`、`secret_exists`和`secret_delete`；未提供明文读取、任意凭据目标或文件接口。

### 测试与验证

- 3项密钥测试覆盖不可信引用、空值/超长/NUL拒绝，以及Windows Credential Manager保存、内部读取、存在检查、删除和重复删除。
- 系统存储测试的秘密在运行时由UUID生成，不写入fixture或输出；Drop清理守卫处理失败路径，测试后Ember Credential Manager目标残留计数为0。
- 既有SQLite迁移测试继续验证`provider_configs`仅有`credential_ref`而无密钥列；新增实现没有写SQLite或导出文件。
- workspace全目标全特性严格Clippy、`cargo test --workspace`（26项）、`pnpm check`（48个Vitest文件242项、7项Node SQLite）通过。
- Windows前端生产build和Tauri release `--no-bundle`通过。

### 结论

- M6-T02验收通过：API Key只可进入系统安全存储，SQLite、日志、测试fixture和导出均不接收明文；WebView不能读取已保存秘密。
- 未提前实现M6-T03 Provider或设置页面，未执行真实API调用；下一任务为M6-T03。

## 2026-08-01 — M6-T03 实现OpenAI-Compatible适配器

### 实现

- 新增`ember-provider-openai-compatible` Rust crate，组合M6-T01安全传输与M6-T02系统密钥仓库，不引入厂商SDK。
- 实现`GET models`、连接测试和`chat/completions`普通文本/JSON Object请求；system/user/assistant消息、temperature、max_tokens和Bearer认证按OpenAI兼容协议映射。
- 响应解析Provider请求ID、模型、首个choice内容、stop/length/content_filter/tool_calls/error结束原因、token usage与RFC3339接收时间。
- 请求拒绝空标识、模型、消息和内容、非法温度及零输出上限；响应拒绝空模型、空choice、空内容、无效JSON和超大正文。
- 认证、限流、超时、取消、网络、无效请求/响应和服务端失败使用稳定ProviderError；底层URL、Header、响应正文和异常不会进入返回错误。
- JSON Schema不在M6-T03工作内容中，明确返回Unsupported，不以JSON Object伪装支持；未加入DeepSeek等预设。

### Provider Contract Test

- 本地Tokio HTTP服务器验证模型列表和连接延迟、文本请求、JSON Object的`response_format`、消息角色、模型、用量及结束原因。
- Windows Credential Manager中的运行时UUID秘密用于认证Header合同验证，源码和fixture没有API Key；Drop守卫保证失败路径清理，最终目标残留为0。
- 401、429、500、无效JSON、远程HTTP配置拒绝、JSON Schema不支持以及TransportError全分类映射均有断言，共5项。
- 所有服务器仅监听127.0.0.1，没有真实Provider、账号、凭据或收费请求。

### 验证与结论

- `pnpm check`通过：48个Vitest文件242项、7项Node SQLite、31项Rust测试；格式、ESLint、类型、Rust fmt和严格Clippy通过。
- `cargo metadata --format-version 1`、Windows生产前端build和Tauri release `--no-bundle`通过。
- M6-T03验收通过；适配器尚未暴露页面命令或写入Provider配置，下一任务为M6-T04 DeepSeek预设。

## 2026-08-01 — M6-T04 添加DeepSeek预设

### 实现与依据

- 查阅DeepSeek官方当前模型/价格页与2026-04-24 V4更新：OpenAI兼容Base URL保持`https://api.deepseek.com`，当前模型为`deepseek-v4-flash`和`deepseek-v4-pro`。
- 新增`DeepSeekPreset`，规范化尾斜杠根地址，默认Flash；两个模型均登记JSON模式、推理能力和1,048,576上下文。
- 官方说明旧`deepseek-chat`与`deepseek-reasoner`在2026-07-24停用，因此预设明确不接受旧别名。
- 未登记会动态变化的价格或免费状态；生产配置必须传入系统CredentialRef。

### 验证

- 测试专用回环配置复用通用OpenAI兼容适配器，服务器列出Flash/Pro后以默认Flash执行JSON Object世界生成。
- 本地响应包含名称、地区、摘要、核心冲突、技术水平、力量规则、势力、地点、叙事风格、禁用元素、酒馆理由和剧情钩子；解析后核对中文内容与集合。
- 定向Provider测试6项通过；`pnpm check`通过48个Vitest文件242项、7项Node SQLite和32项Rust测试，严格Clippy及格式检查通过。
- Windows前端生产build和Tauri release `--no-bundle`通过。

### 结论

- M6-T04在不使用真实API Key和不产生付费调用的条件下，通过准确本地合同验证连接语义、模型列表、配置和世界生成。
- 未提前实现Qwen、SiliconFlow/OpenRouter、Ollama或自定义配置；下一任务为M6-T05。

## 2026-08-01 — M6-T05 添加Qwen预设

### 实现与依据

- 查阅阿里云百炼官方Base URL总览与当前文本生成模型页：北京按量付费OpenAI兼容地址为`https://dashscope.aliyuncs.com/compatible-mode/v1`，当前通用推荐模型为Qwen 3.7系列。
- 新增`QwenPreset`，默认`qwen3.7-plus`，另登记`qwen3.7-max`和`qwen3.7-flash`；三者均为1M上下文并支持推理和结构化输出。
- 未把旧`qwen-plus`放入当前预设，也未硬编码价格、免费额度或跨地域Key可用性；生产配置继续要求CredentialRef。

### 验证

- 本地回环合同服务器首先返回自然中文NPC回复，TEXT请求不包含`response_format`。
- 第二次请求使用JSON Object生成完整任务提案：content、MODERATE风险、推荐属性、8至12回合、NOTABLE奖励和空关联集合；解析后核对中文标题、回合范围与属性数。
- 定向Provider测试7项通过；`pnpm check`通过48个Vitest文件242项、7项Node SQLite和33项Rust测试，严格Clippy及格式检查通过。
- Windows前端生产build和Tauri release `--no-bundle`通过。

### 结论

- M6-T05在不使用真实API Key和不产生付费调用的条件下，通过准确本地合同验证中文NPC对话与结构化任务。
- 未提前实现M6-T06及后续预设；下一任务为SiliconFlow或OpenRouter预设。

## 2026-08-01 — M6-T06 添加OpenRouter预设

### 实现与依据

- 按OpenRouter官方Quickstart与Models API使用`https://openrouter.ai/api/v1/`，模型信息保持运行时发现，不登记固定免费模型。
- `ModelInfo`新增上下文窗口与Free/Paid/Unknown成本状态。判定遍历服务端完整pricing对象：prompt/completion必须存在，任一有效非零价格为Paid，全部为零才是Free，缺失或无效数据为Unknown。
- 生产预设要求CredentialRef；测试专用回环配置不会进入生产接口。

### 验证

- 本地合同服务器同时返回付费、免费和未知价格模型，其中付费模型仅在额外web_search字段非零，验证不会被误标为免费。
- 运行时选择零价格模型生成完整JSON Object冒险回合，核对场景、两项建议行动、发现线索、WAITING_FOR_PLAYER状态、请求模型与格式。
- 定向Provider测试8项通过；完整`pnpm check`通过48个Vitest文件242项、7项Node SQLite和34项Rust测试，严格Clippy、格式、lint与类型检查通过。
- Windows前端生产build和Tauri release `--no-bundle`通过；未访问OpenRouter，未使用真实凭据或产生费用。

### 结论

- M6-T06通过本地准确合同满足动态模型信息、非硬编码免费状态和免费模型冒险回合验收。
- 未提前实现Ollama或自定义配置；下一任务为M6-T07。

## 2026-08-01 — M6-T07 添加Ollama预设

### 实现与边界

- 新增`OllamaPreset`，使用官方OpenAI兼容根地址`http://localhost:11434/v1/`，不要求CredentialRef。
- 端点仍由`ApprovedEndpoint`校验：明文HTTP只能指向localhost或回环IP；未开放WebView HTTP命令。
- 模型通过`/v1/models`动态读取，生成继续使用标准Chat Completions JSON Object语义。

### 验证

- 独立回环合同服务模拟已安装本地模型，验证模型列表、请求路径、没有Authorization头、所选模型名和结构化冒险回合内容；整个测试不访问互联网。
- 当前Windows环境检查结果为`OLLAMA_COMMAND=not-found`，所以没有把真实Ollama程序或真实下载模型写成已验证；在安装Ollama与模型后可按同一接口复验。
- 定向Provider测试9项通过；完整`pnpm check`通过48个Vitest文件242项、7项Node SQLite和35项Rust测试，严格Clippy、格式、lint与类型检查通过。
- Windows前端生产build和Tauri release `--no-bundle`通过。

### 结论

- M6-T07的localhost、模型列表、无网本地结构化输出合同已覆盖；真实模型环境验收状态被准确保留。
- 未提前实现自定义Base URL或设置页；下一任务为M6-T08。

## 2026-08-01 — M6-T08 添加自定义Base URL配置

### 实现与安全边界

- 新增`CustomCompatibleConfig`，持有审批后的Provider配置与严格模型名；缺失尾斜杠由构造器规范化。
- 远程端点只允许HTTPS，明文HTTP仅允许localhost/回环地址；凭据继续只接受CredentialRef并由Provider注入Bearer。
- 最多允许16个附加Header，统一标记敏感以避免Debug泄露；Authorization、API Key、Cookie、Host、内容长度/类型和连接类保留头全部拒绝，防止绕过凭据与传输边界。

### 验证

- 本地合同服务验证自定义模型名、两个附加Header和完整文本生成；请求确实到达`/v1/chat/completions`。
- 负向测试覆盖远程HTTP、空模型、Authorization和Host；附加Header值没有写入日志、SQLite或普通配置。
- 定向Provider测试10项通过；完整`pnpm check`通过48个Vitest文件242项、7项Node SQLite和36项Rust测试，严格Clippy、格式、lint与类型检查通过。
- Windows前端生产build和Tauri release `--no-bundle`通过；未访问真实自定义服务。

### 结论

- M6-T08满足用户提供兼容服务的地址、模型和附加Header配置合同，同时保持HTTPS、回环与密钥安全边界。
- 未提前实现设置页面；下一任务为M6-T09。

## 2026-08-01 — M6-T09 实现模型设置页面

### 实现

- 设置页覆盖DeepSeek、Qwen、OpenRouter、Ollama和自定义兼容服务，支持服务名称、Base URL、密码输入、连接测试与动态模型列表、默认/备用选择。
- Tauri新增`model_settings_get`、`model_settings_save`和`provider_probe`固定语义命令；WebView没有通用HTTP、SQL或密钥读取能力。
- API Key先写Windows Credential Manager，SQLite只接收存在性已验证的CredentialRef；读取视图仅返回hasCredential。连接测试使用临时凭据并在finally路径显式删除。
- SQLite立即事务upsert provider_configs与model_profiles，并将全局默认/备用ID保存到app_settings；预设、文本、URL和引用均在Rust边界验证。

### 验证与Review

- 真实SQLite测试创建Campaign后保存默认/备用配置、关闭重开并恢复设置；Campaign ID、状态、创建/更新时间完全不变，证明设置切换不修改已有存档事实。
- 页面测试执行凭据保存、连接测试、模型选择、默认/备用保存和明文隔离；服务合同从unknown逐字段验证原生响应。
- Review修复`secure-http`依赖隐式Tokio feature、保留Header安全边界、CredentialRef悬空写入和临时密钥清理错误可见性。
- `pnpm check`通过50个Vitest文件244项、7项Node SQLite和37项Rust测试；严格Clippy、格式、lint、类型检查、Windows前端build及Tauri release `--no-bundle`通过。
- release应用使用隔离到`.local`的临时APPDATA启动并获得窗口句柄；进程停止后测试目录已逐级精确清理。

### 结论

- M6-T09满足Provider、模型、API Key、连接测试、默认/备用模型和存档事实隔离验收。
- 未提前实现能力路由；下一任务为M6-T10。

## 2026-08-01 — M6-T10 实现模型能力登记与路由

### 接手与边界

- 从基线`42d2a8a`接手账号B留下的11个已修改文件和2个未跟踪源码文件；读取前将全部差异备份到仓库忽略目录`.local/handoff-backup/m6-t10-before-account-a`。
- 将交接目录和ZIP移出Git仓库到同级`handoff-archive`，未删除账号B源码、未接入真实模型、未写入API Key或用户存档。

### 实现

- 模型设置在SQLite原子保存JSON、流式、上下文长度、成本和能力探测时间；Rust边界严格校验RFC 3339、JavaScript安全整数和能力列一致性，旧版空能力保持未登记。
- 新增SQLite模型档案读取器与确定性路由器。候选只来自已启用Provider和模型；结构化任务优先JSON Schema，其次JSON Object，再按显式许可降级文本，同时过滤流式和最小上下文要求。
- AI回合编排先从SQLite读取候选并完成路由，再选择提示词格式和实际模型。Provider结果仍经过共享Schema、领域规则和SQLite事务提交；无候选在Provider调用前返回稳定错误。
- Provider探测只登记可证明能力：当前兼容适配器只发送JSON Object，生成流式未暴露时登记为不支持；没有按模型名称猜测JSON Schema。

### 验证与Review

- Rust覆盖能力正常/偏移时间恢复、非法时间与上下文拒绝、Provider隔离、旧能力兼容和事务回滚；Provider合同测试继续验证请求格式。
- TypeScript覆盖结构化格式优先级、稳定同级顺序、流式/上下文/启用过滤、文本降级、无候选、SQLite实际能力到Fake Provider再到本地验证与持久化的完整链。
- 定向测试通过；完整验证通过51个Vitest文件253项、7项Node SQLite测试和41项Rust测试，严格Clippy、格式、lint与类型检查通过。Windows前端生产build及Tauri release `--no-bundle`通过。
- release可执行文件实际启动并获得窗口句柄；环境变量重定向未在隔离目录产生数据库，因此只记为启动烟测，不宣称隔离存档烟测。业务链的隔离验收来自D盘临时目录中的真实SQLite与Fake Provider测试。

### 结论

- M6-T10满足模型能力登记、能力约束路由和JSON Schema不支持时兼容降级验收，且没有放宽本地验证或改写既有游戏事实。
- 未提前实现跨Provider重试、失败恢复或UI错误行动；下一任务为M7-T01。

## 2026-08-01 — M7-T01 实现标准错误分类

### 实现

- 新增共享标准错误类型，覆盖`QUOTA_EXCEEDED`、`AUTHENTICATION_FAILED`、`RATE_LIMITED`、`TIMEOUT`、`MODEL_NOT_FOUND`、`INVALID_OUTPUT`、`NETWORK_FAILED`及未知兜底，并固定每类可重试性。
- OpenAI兼容Provider将HTTP 402、401/403、429、404、超时和网络失败映射为稳定错误；Tauri命令保留分类和安全中文说明，不返回上游响应正文。
- 世界、车卡、酒馆、NPC、任务、冒险、结算及统一回合编排不再把错误压成`PROVIDER_FAILURE`，而是将具体代码与可重试性写入pending请求。结构失败对外统一为`INVALID_OUTPUT`，GenerationRecord继续保存原始JSON/Schema问题。
- Windows共享错误提示为额度、认证和模型不存在提供设置入口，为限流、超时、结构和网络失败提供当前操作的可点击重试；已接入世界、车卡、NPC对话和冒险交互，不显示底层异常。

### 验证

- 错误映射单测覆盖全部七个要求分类、旧代码归一化、可重试性、未知错误脱敏、设置链接和真实重试回调；应用编排验证网络分类写入SQLite且没有局部游戏提交。
- `pnpm check`通过53个Vitest文件270项、7项Node SQLite和42项Rust测试；格式、lint、类型检查及严格Clippy通过。
- Windows前端生产build转换170个模块；Tauri release `--no-bundle`通过。独立测试标识`com.embertavern.smoke.m7t01`的release窗口启动并获得窗口句柄，进程停止后其LocalAppData目录已精确删除；恢复正式标识后再次完成release build。

### 结论

- M7-T01满足标准错误分类与UI可执行下一步验收，失败时不改写正式游戏状态。
- 未实现自动重试、备用模型或跨厂商切换；下一任务为M7-T02。

## 2026-08-01 — M7-T02 实现模型切换和重试

### 实现

- 新增失败回合恢复用例：只从SQLite读取原请求已经持久化的输入与上下文，以新的请求、生成记录和幂等键调用目标编排器；旧失败记录保持可审计。
- 目标模型档案必须已启用，且Provider配置、预设、类型与模型名全部匹配。恢复请求启用严格档案选择，避免备用模型被同Provider中的其他候选替换。
- 额度、认证、限流、超时、模型不存在和网络失败可进入模型恢复；结构错误仍留给M7-T03。跨预设厂商以及不同自定义Provider配置必须在创建新请求前确认。
- 真正切换模型时，`MODEL_SWITCHED`与验证后的回合状态、状态补丁和原有事件在同一SQLite事务提交；失败路径不写切换事件或局部进度。

### 验证

- SQLite集成测试先让源Provider返回`QUOTA_EXCEEDED`，确认回合、事实和事件均未提交；未确认跨厂商传输时备用请求也不会创建。
- 确认后Fake备用Provider读取与源请求逐值相同的持久化input/context，只调用一次并完成同一回合；源请求保持`FAILED`，新请求为`COMMITTED`，实际备用档案写入GenerationRecord。
- 对同一恢复命令再次执行返回`ALREADY_COMMITTED`；最终只有一个玩家行动事件、一个模型切换事件和一份世界事实，没有重复或丢失进度。
- `pnpm check`通过53个Vitest文件271项、7项Node SQLite和42项Rust测试；格式、lint、类型检查及严格Clippy通过。Windows前端生产build转换170个模块，Tauri release `--no-bundle`成功生成可执行文件。

### 结论

- M7-T02满足额度不足后切换备用模型继续同一回合、跨厂商确认以及进度不重复不丢失验收。
- 未实现结构化输出修复或启动恢复中心；下一任务为M7-T03。

## 2026-08-01 — M7-T03 实现结构化输出修复流程

### 实现

- 新增严格修复提示：把首次非法原文交回原模型，附带本地验证问题，并明确只返回JSON、保留原意、不得新增剧情事实、状态变化或玩家行动。
- 新增结构化回合修复用例。它只接受SQLite中已失败的`INVALID_OUTPUT`请求，逐值复用原input/context，强制使用首次GenerationRecord记录的同一启用模型。
- 修复使用独立请求、生成记录和幂等键，并在规范请求中保存`repairSourceRequestId`；首次与修复原文分别留存。每个源请求最多一次修复，同一命令可幂等重放，换ID的第二次修复被拒绝。
- 修复成功仍经过共享任务Schema、领域校验和回合事务；修复再次失败时保留两条错误记录，不写入回合、世界事实或GameEvent。

### 验证

- Prompt测试验证非法原文、错误详情、JSON-only约束和禁止新增事实均进入严格修复消息，且继续选择模型支持的结构化响应格式。
- SQLite/Fake Provider集成测试验证首次非法JSON后原模型修复成功、同一input/context和模型档案、两条GenerationRecord、一次回合提交和第二次修复拒绝。
- 最终失败测试让原响应与修复响应都返回非法JSON，确认两条pending请求与原文错误均保留，冒险回合、世界事实和事件零提交。
- `pnpm check`通过53个Vitest文件274项、7项Node SQLite和42项Rust测试；格式、lint、类型检查及严格Clippy通过。

### 结论

- M7-T03满足原模型单次严格修复和最终失败保护验收，错误JSON不能破坏正式存档。
- 未实现自动快照轮换；下一任务为M7-T04。

## 2026-08-01 — M7-T04 实现自动快照

### 实现

- SnapshotRepository的创建、SHA-256 payload写入和AUTO轮换改为单一SQLite立即事务；相同快照身份可幂等重放，ID冲突拒绝并回滚。
- TurnCommit新增可选自动快照。无检定回合和检定叙事完成时，完整回合状态、补丁、GameEvent与`AFTER_COMPLETE_TURN`快照同一事务提交；`CHECK_REQUIRED`中间态不创建完整快照。
- 每个Campaign只保留最近10个AUTO快照，按创建时间和rowid稳定轮换。新增按原因前缀查找与列表读取，完整回合恢复只选择目标冒险的最新完成点。
- 恢复后验证冒险当前回合有玩家行动且`resolvedAt`非空；重生成回退改为显式选择`BEFORE_REGENERATION:`安全快照，避免被新完成快照改变语义。

### 验证

- Fake Provider/真实SQLite测试完成一个检定回合和一个无检定回合，再创建后续未完成回合；恢复后回到第二个完整回合，未完成回合消失，冒险回合号恢复为2。
- 连续创建12个AUTO快照后只保留ID 3至12共10个；重复创建第12个快照幂等且数量不变。
- 故意预占完整快照ID制造冲突，AI回合返回`COMMIT_FAILED`；冒险仍为`WAITING_FOR_PLAYER`、回合未解决、事件为空，证明快照与游戏提交共同回滚。
- `pnpm check`通过53个Vitest文件275项、7项Node SQLite和42项Rust测试；格式、lint、类型检查及严格Clippy通过。

### 结论

- M7-T04满足最近10个自动快照、稳定轮换和回退到最近完整冒险回合验收。
- 未实现数据库完整备份；下一任务为M7-T05。

## 2026-08-01 — M7-T05 实现完整备份

### 实现

- 新增共享SQLite完整备份服务：从只读源连接使用在线备份API写唯一临时文件，源库和副本分别通过完整性检查后原子发布，并按主库命名空间轮换保留最近3份。
- Node数据库迁移在执行任何迁移SQL前创建完整备份；备份失败归一为`BACKUP_FAILED`、清除迁移工作副本并保留主库原始字节，成功结果返回可恢复的正式备份路径。
- Windows原生桥启用rusqlite backup能力，`CampaignStore::open`对已存在数据库先完成同语义备份再进入Schema检查和迁移，桌面运行路径实际在应用数据目录旁维护三份完整备份。
- 新库不创建空备份；轮换只匹配当前数据库的`<database>.full-*.sqlite`正式文件，不会删除临时文件、其他数据库或无关文件。

### 验证

- Node测试保持源WAL连接开放，连续写入并创建4份备份；最终只保留含2、3、4条已提交记录的最近3份，均通过`PRAGMA integrity_check`。
- Node备份目录被普通文件占用时创建失败，主库SHA-256不变且数据可只读重开；旧Schema迁移前使用同一故障，返回`BACKUP_FAILED`、未执行迁移且主库哈希不变。
- Rust原生测试连续启动4次后只保留3份可打开、完整且含Campaign数据的备份；占用备份目录制造失败后，主库字节逐字节不变且Campaign仍可读取。
- `pnpm check`通过53个Vitest文件275项、10项Node SQLite和44项Rust测试；格式、lint、类型检查及严格Clippy通过。

### 结论

- M7-T05满足最近3个数据库一致性备份、数据库迁移前备份和备份失败不破坏主数据库验收。
- 未实现启动恢复中心；下一任务为M7-T06。

## 2026-08-01 — M7-T06 实现启动恢复中心

### 实现

- 新增恢复中心用例，读取Campaign、当前冒险、未解决回合、`pending_ai_requests`与完整回合快照，区分进程中断请求、已知失败请求和无请求的崩溃回合，并返回状态允许的继续、重试、更换模型和取消操作。
- CHECK_REQUIRED且尚未掷骰的回合直接返回本地掷骰继续点；CREATED至VALIDATING的中断请求在重试前转为可重试`APP_INTERRUPTED`，再复用M7-T02的新请求/新幂等键恢复链路。
- 已完成回合上的历史FAILED源请求不再触发恢复，保留模型切换、修复与首次失败审计；Campaign级内容请求支持安全取消，不错误要求冒险快照。
- SnapshotRepository拆分事务外包装与事务内恢复入口。取消当前冒险回合时，未结束请求终止、快照校验、未来回合清理及最近完整回合恢复在同一立即事务完成。
- 数据库启动READY/MIGRATED与FAILED结果映射为明确恢复状态；数据库异常保留稳定错误码和主库是否保留信息，不与AI失败混合。

### 验证

- Fake Provider/真实SQLite流程先完成检定与无检定两个回合，再模拟第三回合请求停在SENDING；恢复中心提供重试、换模型和取消，把中断标记为`APP_INTERRUPTED`，取消后第三回合及请求消失并回到第二个完整回合。
- 检定等待阶段没有待生成请求时只提供继续，并返回同一回合的ROLL_CHECK检查点；不产生模型请求或修改骰点。
- 故意破坏完整快照校验和后执行取消，恢复事务失败；请求仍为FAILED、崩溃回合仍存在。修复测试校验和后重试，取消与恢复共同成功。
- 已解决回合上的历史FAILED审计在恢复前后保持FAILED且不会使`needsRecovery`为真；无回合内容请求可单独取消。数据库完整性失败结果正确映射为RECOVERY_REQUIRED。
- `pnpm check`通过53个Vitest文件276项、10项Node SQLite和44项Rust测试；格式、lint、类型检查及严格Clippy通过。

### 结论

- M7-T06满足检测pending请求、崩溃回合和数据库异常，并提供继续、重试、更换模型、取消及恢复到最后完整状态的验收。
- 未实现上下文摘要和预算控制；下一任务为M7-T07。

## 2026-08-01 — M7-T07 实现上下文摘要和预算控制

### 实现

- 为全部15类`AITask`登记紧凑、对话和冒险三组不可变预算，统一限制总字符、最近消息、长期记忆、最近回合、最近事件及旧历史摘要长度。
- 共享历史压缩器把超出最新窗口的内容压成有界首尾摘要；NPC上下文保留最近12条对话、SQLite长期记忆摘要和最近8条记忆，冒险上下文保留最近8回合并压缩更早回合。
- 冒险回合从SQLite读取同Campaign既往已结算冒险的结局摘要，与当前冒险旧回合摘要合并；冒险结算不再发送完整回合列表，世界事件显式使用对应任务预算。
- NPC记忆提取不再发送完整transcript，并只允许生成结果引用本次预算实际发送的最近来源回合。全部压缩后输入仍通过共享任务Schema并持久化到生成审计记录。

### 验证

- 上下文单测覆盖全部任务预算、80条对话/40条记忆、60回合冒险、旧历史摘要长度和最新窗口顺序。
- Fake Provider/真实SQLite集成测试构造62条历史消息、20条长期记忆和80回合冒险，检查GenerationRecord请求包含有界`Earlier history`与最新内容，同时明确不包含中段原始历史。
- `pnpm check`通过53个Vitest文件279项、10项Node SQLite和44项Rust测试；格式、lint、类型检查及严格Clippy通过。
- Windows前端生产build转换170个模块；Tauri release `--no-bundle`成功生成`target/release/ember-tavern-windows.exe`。

### 结论

- M7-T07满足冒险摘要、NPC长期摘要、历史压缩和按任务预算验收，长存档不会把全部历史发送给模型。
- 未定义存档交换格式；下一任务为M8-T01。

## 2026-08-01 — M8-T01 定义 `.emtavern` 格式

### 实现

- 新增`docs/save-format.md`，将`.emtavern` v1定义为包含manifest、Campaign事实、NDJSON事件、生成审计和SHA-256清单的五文件ZIP。
- 独立定义`formatVersion`与`databaseSchemaVersion`，固定SQLite行标量、JSON文本、稳定排序、UTF-8规范字节和旧Schema迁移边界。
- 明确14类Campaign游戏事实、全部事件和GenerationRecord必须包含；设备Provider、模型档案、设置、credential引用、pending请求、旧快照、日志和缓存必须排除。
- 模型绑定在档案中归一为空，目标设备重新选择模型；导入成功后创建新IMPORT快照。定义ZIP路径/大小防护、秘密键扫描、一致性导出、校验与原子导入顺序。

### 验证

- 文档逐项覆盖M8-T01要求的manifest、campaign、events、generation records、checksum和Schema版本，并与当前迁移Schema v1及22表数据边界核对。
- `pnpm check`通过；Windows前端生产build与Tauri release `--no-bundle`通过。

### 结论

- M8-T01格式文档验收完成，未提前实现ZIP导出、导入事务或Windows文件交互。
- 下一任务为M8-T02实现存档导出。

## 2026-08-01 — M8-T02 实现存档导出

### 实现

- 新增共享`exportCampaignSave`服务，在单个SQLite读事务中检查数据库完整性、外键和当前Schema，并稳定捕获Campaign行、14类游戏事实、事件及全部GenerationRecord。
- JSON文本列统一解析、禁止秘密键扫描和规范化；Campaign默认/备用/任务模型绑定及GenerationRecord模型外键归一为空，Provider、模型、app设置、pending请求和旧快照不进入归档。
- 生成`manifest.json`、`campaign.json`、`events.ndjson`、`generations.json`的SHA-256及`checksum.json`，使用无新增依赖的ZIP32 STORE编码器返回确定性`.emtavern`字节和安全建议文件名。
- ZIP写入UTF-8标志、CRC32、中央目录和结束记录，复制归档前执行256 MiB上限；服务不写用户路径，不提前实现M8-T04。

### 验证

- 真实SQLite测试把Campaign绑定到含credentialRef和API Key测试值的设备Provider，同时写入事件、GenerationRecord、游戏事实和含秘密的app设置；解包结果只有五个规定条目，内容完整且不含任一设备秘密或credential字段。
- 校验manifest计数、14表边界、模型外键归一化、事件NDJSON、生成审计、四文件SHA-256、重复导出字节一致；禁止秘密键导致整体失败，缺失Campaign失败后连接可立即开启新事务。
- `pnpm check`通过54个Vitest文件282项、10项Node SQLite和44项Rust测试；格式、lint、类型检查及严格Clippy通过。
- Windows前端生产build转换170个模块；Tauri release `--no-bundle`成功生成可执行文件。

### 结论

- M8-T02满足导出文件包含完整游戏内容且不包含API Key的验收，并保持导出只读。
- 未实现存档校验、导入迁移和IMPORT快照；下一任务为M8-T03。

## 2026-08-01 — M8-T03 实现存档导入

### 实现

- 新增共享异步`importCampaignSave`服务，在写库前严格解析固定五条目ZIP32，支持STORE与DEFLATE，拒绝多盘、加密、危险路径、符号链接、异常标志、重复/额外条目、越界、CRC错误、非法UTF-8、BOM及压缩/解压体积超限。
- 校验规范JSON与NDJSON、四文件SHA-256、manifest媒体类型/数量/时间/生成器版本、format与数据库Schema、Campaign归属、当前表精确列集合、SQLite标量、JSON文本、秘密键及归一为空的设备模型绑定；当前v1无历史Schema需要转换，较新或无迁移器的较旧版本明确拒绝。
- 提供保留原ID的CREATE和显式OVERWRITE两种模式。CREATE遇到同ID整体拒绝；OVERWRITE必须在SQLite事务开始前完成调用方提供的完整备份回调，回调缺失或失败不会删除现有Campaign。
- 使用单个立即事务按外键顺序导入Campaign、GenerationRecord、14类游戏事实和GameEvent，执行外键检查并通过共享Repository逐类回读领域对象；成功后在同一事务创建新的IMPORT快照，任一步失败连同级联删除和快照一起回滚。

### 验证

- 真实SQLite往返测试先导出含世界事实、事件、生成审计及设备模型绑定的Campaign，删除本地Campaign后以CREATE恢复；确认模型绑定保持为空、IMPORT快照存在，并能把恢复后的状态继续推进到`REVIEWING_WORLD`。
- 覆盖测试先修改本地事实，确认缺少备份回调或备份回调失败时原数据不变；完成一次备份回调后OVERWRITE恢复导出值且仅创建目标导入快照。
- 损坏ZIP正文触发CRC/校验失败且不创建Campaign或快照；构造SQLite约束允许但共享领域Repository拒绝的事实JSON，确认所有导入行和IMPORT快照整笔回滚、外键仍完整。
- `pnpm check`通过54个Vitest文件286项、10项Node SQLite和44项Rust测试；格式、lint、类型检查及严格Clippy通过。
- Windows前端生产build转换170个模块；Tauri release `--no-bundle`成功生成`target/release/ember-tavern-windows.exe`。

### 结论

- M8-T03满足校验、Schema迁移边界、新建/覆盖、导入快照，以及删除本地存档后从导出文件恢复并继续的验收。
- 未实现文件选择、拖放或保存位置交互；下一任务为M8-T04。

## 2026-08-01 — M8-T04 实现Windows文件交互

### 实现

- 新增Windows存档迁移网关：使用系统打开/保存对话框选择`.emtavern`文件，并监听当前WebView的单文件拖放事件；能力清单仅开放对话框打开和保存，不向前端暴露数据库或归档字节。
- 存档首页新增迁移面板、逐存档导出、文件选择导入和全窗口拖放导入。导入先检查归档并显示稳定反馈；同ID冲突必须经过明确的完整数据库备份提示和用户确认后才使用OVERWRITE，取消不会修改本地状态。
- Windows原生桥实现v1固定五条目ZIP的检查、导出和导入，验证SHA-256、Schema、精确行形状、Campaign归属、JSON领域内容和秘密边界；设备Provider、设置、pending请求、旧快照和模型绑定不随归档迁移。
- 原生导出拒绝非绝对路径、错误扩展名与符号链接，使用同目录临时文件、同步、逐字节回读和原子发布；已有目标由临时备份保护。覆盖导入先关闭连接并创建一致完整备份，再在单个SQLite事务中写入、检查外键、回读领域状态并创建IMPORT快照。
- Tauri命令通过阻塞线程池执行文件与SQLite工作，避免阻塞应用异步运行时；拖放监听在页面卸载时注销，并用忙碌锁阻止重复并发操作。

### 验证

- 前端页面测试覆盖系统位置导出、CREATE导入后刷新、冲突取消后以拖放再次确认OVERWRITE；网关测试覆盖Tauri命令、系统对话框、拖放路径与监听清理。
- Rust真实SQLite测试覆盖导出覆盖已有文件、删除后导入并继续、覆盖前完整备份、损坏归档无状态变更、备份目录故障保持原状态，以及秘密字段导致导出失败且保留旧目标文件。
- `pnpm check`通过55个Vitest文件291项、10项Node SQLite和49项Rust测试；格式、lint、类型检查及严格Clippy通过。
- Windows前端生产build转换177个模块；Tauri release `--no-bundle`成功生成`target/release/ember-tavern-windows.exe`。

### 结论

- M8-T04满足文件选择、保存位置选择、拖放导入及普通用户无需手动操作数据库文件的验收。
- 未初始化iOS客户端；下一任务为M9-T01。

## 2026-08-01 — 调整为Windows-first发布策略

### 工作区保护与审计

- 在任何策略文档修改前，将`HEAD`、状态、差异、暂存差异和未跟踪文件清单保存到`.local/task-redirection/m9-ios-paused-20260801-220713`。
- 权威审计结果为`HEAD 5904a87cae612f5759e93b39011e580f152b11dc`、工作树干净：未提交文件0个，纯iOS、共享、Windows相关及来源不明修改均为0个。因此没有删除、恢复或混合提交任何M9文件。

### 计划调整

- M9-T01至M9-T09及M10-T04统一标记为`DEFERRED`；保留原编号、依赖和验收，待Windows v0.1完成且具备macOS/Xcode环境后恢复。
- M10-T01、M10-T02、M10-T03和Windows范围的M10-T06列为P0；M10-T05先完成Windows隐私说明，iOS说明随M9补充。
- 新增`docs/WINDOWS_V0_1.md`，把现有任务与Windows发布缺口合并为可核验清单；当前确认`bundle.active`为`false`，尚无普通用户安装包，因此先执行`WV0.1-T01 Windows安装包与启动验收`。

### 结论

- 开发方向调整为Windows-first，不改变SQLite唯一事实源、AI输出校验、秘密存储和共享层跨平台边界。
- M9-T01仍未完成且不会在Windows环境伪造验收；缺少Xcode只延期iOS，不阻塞Windows v0.1继续开发。

## 2026-08-01 — WV0.1-T01 Windows安装包与启动验收

### 实现

- 启用x64 NSIS bundle，写入Ember Tavern 0.1.0产品信息、现有ICO、当前用户安装、简体中文/英文界面、LZMA压缩、禁止降级和WebView2下载bootstrapper。
- 使用`useLocalToolsDir`把NSIS 3.11及Tauri NSIS工具缓存固定到仓库`target/.tauri`；两次网络超时后重试完成下载、SHA校验和解压，没有回退到用户C盘工具缓存。
- 新增Tauri发布配置测试，固定bundle启用、NSIS目标、当前用户模式、版本/标识、WebView2策略、语言和安装/卸载图标存在性。
- 新增`docs/WINDOWS_INSTALL.md`，说明安装要求、产物、生产数据路径、备份、Credential Manager、卸载保留行为及未签名本地候选限制。

### 验证

- `tauri build --bundles nsis --no-sign`成功生成`target/release/bundle/nsis/Ember Tavern_0.1.0_x64-setup.exe`；最终复建产物大小5,062,611字节，SHA-256为`4CB54D928612EB47EA9AE07716B8B9C6DF5770C77561502E0F9836AAC5E94D87`。
- 隔离目录静默安装退出码0；安装EXE与卸载器存在，产品名、文件描述和版本为Ember Tavern 0.1.0，HKCU卸载项的路径与版本正确。静默卸载退出码0后，程序文件、卸载器和卸载注册表项均消失。
- 从安装目录启动发布候选后进程持续运行30秒，证明不依赖开发服务器。Windows Known Folder API不接受测试进程的`APPDATA`重定向，因此启动按生产规则访问既有应用数据目录并创建了一份启动前完整备份；主数据库最后写入时间保持2026-07-31 03:11:53不变。主库与新增备份均只读通过`PRAGMA integrity_check`且Schema为v1。该恢复性备份被保留，没有擅自删除真实用户数据，后续不再重复启动触碰该目录。
- 已有M5-T11实际首次启动证据确认生产数据库路径为`%APPDATA%/com.embertavern.windows/ember-tavern.sqlite`；原生空库迁移和存档首页空状态继续由真实SQLite及页面测试覆盖。
- `pnpm check`通过56个Vitest文件292项、10项Node SQLite和49项Rust测试；格式、lint、类型检查及严格Clippy通过。Windows前端生产build转换177个模块，最终NSIS Release复建通过。

### 结论

- WV0.1-T01满足普通用户安装产物、非开发目录启动、产品元数据、卸载闭环、生产数据路径和卸载保留策略验收。
- 本地产物未签名；正式外部发布需要代码签名证书，不阻塞当前内部发布候选及后续M10收口。下一任务为M10-T01。

## 2026-08-01 — M10-T01 完成Domain单元测试

### 覆盖范围

- Campaign状态机覆盖全部正常迁移、世界重生成、三种异常状态分类/进入/切换/恢复、活动与异常归档、归档终态、重复状态、倒退时间、同时间原子迁移、不可变返回，以及伪造异常状态缺少恢复目标。
- D20覆盖四档难度的临界成功、临界失败、正负修正、骰面1/20、非法骰值、属性1至5边界、非法属性、非安全修正、非法难度、总值安全整数溢出及冻结审计结果。
- 关系与世界时钟覆盖四维每回合增减限制、结果-5至5边界、空/非有限补丁、原对象不变、冻结结果；时钟单步推进、阶段触发、完成态、数值/阶段阈值/重复阈值非法及冻结集合。
- AI状态补丁覆盖五类合法顺序、Campaign隔离、未知任务/NPC/时钟、非普通对象/额外字段/缺字段、精确错误索引与路径、任务非法跳转、关系/时钟限制、奖励完成态/授权/层级、锁定规则、玩家属性禁写及未知类型。

### 验证

- 四个目标文件共88项测试通过：Campaign状态机17项、D20 23项、关系/时钟27项、AI状态补丁21项。
- TypeScript全项目类型检查与ESLint零警告通过；新增测试没有修改生产规则或降低任何验证边界。
- `pnpm check`通过56个Vitest文件334项、10项Node SQLite和49项Rust测试；格式、lint、类型检查及严格Clippy通过。Windows前端生产build转换177个模块，NSIS Release复建成功。

### 结论

- M10-T01达到状态机、骰子、关系、时钟和补丁验证的正常、边界、非法输入、隔离、不可变与错误定位约定覆盖范围。
- 下一任务为M10-T02完成正式启用Provider的统一合同测试。

## 2026-08-01 — M10-T02 完成Provider Contract Test

### 覆盖范围

- 以Windows设置页和Tauri `provider_probe`真实可选项为准，正式启用Provider为DeepSeek、Qwen、OpenRouter、Ollama和自定义兼容服务；通用OpenAI-Compatible配置是共享适配器，不作为独立可选Provider重复计数。
- 新增一套由5个独立测试共同调用的统一合同：模型发现、连接测试、Text生成、JSON Object生成、请求路径与消息角色、Token/结束原因归一化、429稳定错误分类、畸形JSON拒绝，以及JsonSchema不支持时的传输前拒绝。
- 保留各Provider已有专项测试，继续覆盖预设元数据、中文世界/对话/任务、OpenRouter免费模型选择、Ollama无凭据行为，以及自定义Header与安全校验。

### 验证

- `cargo test -p ember-provider-openai-compatible`通过15项测试，其中5项为正式启用Provider的同一合同矩阵；所有请求仅发送到测试进程的本地临时TCP服务，没有访问真实Provider或产生费用。
- 目标crate严格Clippy、全仓格式和差异空白检查通过。
- `pnpm check`通过56个Vitest文件334项、10项Node SQLite和54项Rust测试；格式、lint、类型检查及严格Clippy通过。Windows前端生产build转换177个模块，NSIS Release复建成功。

### 结论

- M10-T02验收通过：每个正式启用Provider均通过同一测试集合，且共享适配器的结构和业务错误边界未被绕过。
- 下一任务为M10-T03完成Windows端到端测试。

## 2026-08-01 — M10-T03 完成Windows端到端测试

### 实现

- 新增`windows_e2e::completes_the_windows_release_vertical_slice_on_one_persistent_save`，只使用临时目录中的真实SQLite、原生业务入口和本地Fake生成结果，在同一Campaign上完成世界生成/字段锁定、车卡、酒馆与NPC、对话、接任务、8回合冒险、本地D20、结算与返回酒馆。
- 结算后先登记本地默认/备用模型，再切换到第二个默认模型并继续同一NPC对话；随后关闭并重开Store，验证Campaign、4条对话和结算档案恢复。
- 同一流程继续导出`.emtavern`、删除精确Campaign、检查归档、CREATE方式重新导入、再次重开、继续Campaign并新增第三轮对话，最终验证6条消息、1份结算档案和2份设备模型配置。
- 根脚本新增`pnpm test:windows-e2e`，发布纵向链也包含在常规`cargo test --workspace`/`pnpm check`中。

### 验证

- `pnpm test:windows-e2e`单独通过；测试执行期间只使用自动清理的临时目录，没有访问`%APPDATA%`、系统凭据、真实Provider或网络。
- `pnpm check`通过56个Vitest文件334项、10项Node SQLite和55项Rust测试；格式、lint、类型检查及严格Clippy通过。
- Windows前端生产build转换177个模块；`tauri build --bundles nsis --no-sign`成功复建0.1.0 NSIS安装包。

### 结论与边界

- M10-T03验收通过：`docs/spec.md`第33.4节的创建世界至重新导入后继续游戏链，已由一条可重复、单存档、真实SQLite自动测试覆盖。
- 这项自动化不冒充安装后UI人工验收；发布候选的首次启动、分辨率、键鼠、故障恢复入口与实际文件对话框仍保留在`docs/WINDOWS_V0_1.md`最终清单。
- M10-T04继续`DEFERRED`；下一任务按Windows-first顺序执行M10-T05的Windows隐私、数据与发布说明。

## 2026-08-01 — M10-T05 完成Windows隐私和数据说明

### 玩家说明

- 新增`docs/PRIVACY_WINDOWS.md`，逐项说明SQLite与完整备份内容、生成审计敏感性、Windows安全凭据、当前联网、未来云上下文、跨厂商确认、`.emtavern`边界、卸载保留和彻底清理步骤。
- 新增`docs/RELEASE_NOTES_0.1.md`，记录Windows 0.1内部候选范围、隐私摘要和已知限制；安装文档补充“无独立文本日志”、SQLite诊断记录和隐私文档入口。
- 设置页直接显示固定的“隐私与联网”说明，明确保存模型不发送Campaign、测试连接会向所选Base URL发送Key并读取模型列表、远程只允许HTTPS，以及云游戏生成尚未启用。

### 现状核验

- 核对7个Windows游戏服务均使用本地`FakeAIProvider`；当前云Provider仅由`provider_probe`执行模型列表/连接测试，不把Campaign或对话作为请求体发送。
- 核对API Key由`com.embertavern.model-provider`系统安全存储持有，SQLite只保存`credentialRef`；远程端点要求HTTPS、回环地址可用HTTP且禁用重定向。
- 核对SQLite保存请求结构、原始响应、验证错误和待处理上下文；`.emtavern`包含Campaign生成审计但排除Provider配置、系统凭据、恢复缓存和日志。

### 验证与结论

- 设置页定向Vitest通过，验证三段玩家可见隐私文案；ESLint、TypeScript、Prettier和差异空白检查通过。
- `pnpm check`通过56个Vitest文件334项、10项Node SQLite和55项Rust测试；Windows前端生产build转换177个模块，0.1.0 NSIS安装包复建成功。
- M10-T05的Windows范围验收通过：玩家可区分本机数据、连接测试联网、未来云生成上下文和API Key边界。iOS说明按既定策略随M9恢复后补充。
- 下一任务为M10-T06 Windows v0.1最终验收。

## 2026-08-01 — M10-T06 Windows v0.1最终验收

### 收口实现

- 新增备份保护的Campaign永久删除：先生成一致性SQLite完整备份，再在外键事务中只删除目标Campaign；存档首页提供明确的导出提醒、确认和结果反馈。
- 新增恢复中心：异常Campaign显示恢复入口，原生层校验持久化`resume_state`，在单事务中取消所有未完成请求并恢复最近已提交阶段；前端严格验证恢复快照并按恢复状态导航。
- 新增模型凭据删除：SQLite先停止引用不透明凭据，再删除Windows安全凭据；系统删除失败时返回可行动的手工清理提示，模型档案本身保留。
- 修复发布候选长页面不可滚动：应用壳与workspace固定在视口，主内容区独立纵向滚动，避免酒馆、任务、冒险和设置底部操作在较低窗口被永久裁切。

### 实际Windows验收

- 在独立应用标识和独立数据目录中，用Release构建真实完成世界、车卡、酒馆、连续NPC对话、接任务、8回合冒险（3次D20与5次无检定）、结算和档案；结算后的任务、奖励、关系、酒馆TROPHY、世界事实与时钟均写入同一SQLite。
- 在酒馆提交态强制结束进程后重启，数据库完整性为`ok`且进度无丢失/重复。另行制造`RECOVERY_REQUIRED`与1条`SENDING`请求，恢复中心将其取消并原子返回`TAVERN`。
- 通过回环OpenAI-Compatible服务实际探测两个模型，把一个切换为默认、另一个保留为备用；模型设置重启保持，凭据删除后引用为`NULL`。没有访问真实Provider或产生费用。
- 通过Windows系统对话框导出`.emtavern`，永久删除Campaign并确认完整备份存在，再导入并恢复8回合结算档案；Escape取消文件对话框不改变数据库。
- 逐一检查860×600、1180×760、1366×768与1920×1080，并使用鼠标、Tab、Enter和Escape完成关键操作。隔离测试数据与临时服务在验收后清理，正式用户数据未被修改。

### 最终门禁与产物

- `pnpm check`通过58个Vitest文件338项、10项Node SQLite、32项native-bridge、15项Provider、7项HTTP、3项SecretStore和1项Tauri测试；Prettier、ESLint、TypeScript、Cargo fmt与严格Clippy通过。
- Windows生产构建转换179个模块；正式NSIS复建产物为`Ember Tavern_0.1.0_x64-setup.exe`，5,070,149字节，SHA-256为`51F824342223895FBC2B8ACB23AB5B6E25BC315E1FF26256007D794CE244F2F6`。
- Git跟踪源码/配置、导出归档和安装包的高置信秘密扫描均无命中；归档不含Provider配置、凭据引用或设备模型，安装包不含验收测试密钥。

### 结论

- M10-T06 Windows范围验收通过，完整证据见`docs/WINDOWS_ACCEPTANCE_0.1.md`。Windows 0.1内部候选已完成；未签名仍是外部发布限制，不影响内部候选结论。
- M9与M10-T04继续`DEFERRED`；未自动开始iOS工作。

## 2026-08-02 — Windows v0.1 第一轮独立发布审查

### 独立发现与修复

- 在审查起始 HEAD `3a2027c0b1111016e5ac46e748dbfae1fc69ddc7` 上先记录四项问题：一项 P1 Provider SSRF/解析重绑定边界，三项 P2（生产 CSP、最小 Tauri 能力、`.emtavern` 双实现互操作门禁）。
- Provider 请求现在验证并固定全部解析地址；生产 WebView 启用 CSP；能力清单移除 `core:default`；归档增加 TypeScript 与 Rust 双向固定夹具。
- SQLite 唯一真实数据源、AI 输出验证、系统凭据和 Fake Provider 游戏生成边界均保持不变。

### 独立审查身份烟测

- 临时使用 `com.embertavern.windows.audit1` 与 `Ember Tavern Audit 1` 构建并静默安装未签名 NSIS；首次启动创建独立 SQLite，强制终止后完整性为 `ok`，再次启动成功。
- 隔离临时目录中的 Windows 端到端纵向切片覆盖世界、角色、酒馆、NPC、任务、冒险、D20、结算、重启、导出、删除、导入和继续游戏；恢复测试验证未完成请求取消与状态原子回退。
- 卸载器删除程序与注册项并按既定策略保留应用数据；审查结束后只清理审查身份目录。正式 `com.embertavern.windows` 数据库哈希未变化，临时生产配置已恢复。

### 浏览器复核

- 真实 Edge/Playwright 复核 860×600、1180×760、1366×768 与 1920×1080，并检查设置、导入导出和恢复中心；未发现横向溢出或新增阻断性 UI 问题。
- 完整门禁结果、正式产物哈希、签名状态、剩余风险与移交包位置在最终审查报告中记录。

## 2026-08-08 — v0.2 M0 仓库与双平台基线

### 完成

- 自动确认仓库、`main`、起始 HEAD `2010448f3be953bb2ebb2c1dcf7ef23a8697e022` 与 `origin/main` 对齐。
- 保护既有 `.gitignore` 修改；在 `.local/recovery/20260808_122928/` 保存 HEAD、status、tracked/staged diff、untracked 和元数据，不执行 destructive git。
- 记录 macOS/Xcode、Node/pnpm、Rust、当前 Windows-only CI、Windows Tauri 入口和缺失 macOS adapters，形成 `docs/V0_2_BASELINE.md`。

### 边界

- 本项完成 `V02-M0-T01`。Architecture Gate 前没有修改生产代码；`V02-M0-T02/T03` 在 Gate 后实施。

## 2026-08-08 — v0.2 M0.5 竞品研究与 Gap Analysis

### 完成

- 自行把 RePoG、TavernAI、SillyTavern clone 到 `.local/research/third_party` 并固定 branch/SHA/license/source availability。
- 逐项分析因果 GM、玩家作者权、知识边界、冷热记忆、Prompt Manager、connection profile、world info、persona、context 预算、本地化和扩展边界。
- 明确 TavernAI 固定仓库为 `SOURCE_NOT_PUBLIC_IN_THIS_REPO`，SillyTavern 只做 clean-room 行为研究，不复制 AGPL 源码。
- 生成 baseline、三份分析、横向矩阵、Gap、Borrow Plan 与 Rejected Ideas；将 MUST/SHOULD/LATER/REJECT 映射到 `docs/TASKS_V0.2.md`。

### 结论

- `V02-COMP-T01`～`V02-COMP-T07` 完成。默认拒绝插件市场、完整 MultiChat/World Voices、AI Companion、浏览器服务替换桌面边界和非 SQLite 真实数据源。

## 2026-08-08 — v0.2 M0.6 Architecture Gate

### 完成

- 定义单一 AI pipeline、ContextBlock、三层 provider 配置、Candidate Pattern、最小 Event Ledger、四层知识模型、SceneFrame 和六个平台 ports。
- Architecture Gate 逐项证明 UI 无 provider 直连、domain 无平台依赖、AI 不直接写状态、context 统一、hard logic 本地、config frozen、knowledge/truth 分离且范围未膨胀。
- Gate 结论为 `PASS FOR IMPLEMENTATION`；实现违反不变量时自动失效。

### 下一项

- 严格执行 `V02-M0-T02`，随后 `V02-M0-T03`；完成后进入 `V02-M1-T01`。不启动 iOS，不访问真实付费 API 或正式用户数据。

## 2026-08-08 — v0.2 M0 跨平台路径与共享脚本完成

### 实现

- 新增 `ember-platform-services` crate，以 `PlatformPaths` port 暴露 data/cache/log/temp，Windows 与 macOS adapters 只接受平台 composition root 解析出的绝对路径。
- Tauri 启动不再直接拼接 `app_data_dir`，而是经当前平台 adapter 获取 SQLite data dir；测试可注入临时根目录。
- 用既有 `app-icon.svg` 补齐桌面 PNG/ICNS，未纳入生成器产生的 iOS/Android 资产。
- 新增跨平台 Node build/shared gate/release metadata 入口；保留 Windows E2E 为明确专项脚本。

### 验证

- PlatformPaths tests：3/3；Node release metadata tests：2/2。
- macOS `cargo check -p ember-tavern-windows` 通过；既有 `secure-secrets` 非 Windows dead-code warning 归入下一项 `V02-M1-T02`，不在 M0 隐藏。
- `pnpm build:desktop` 通过，Vite 转换 179 modules；metadata 命令输出当前版本、提交、darwin/arm64。

### 结论

- `V02-M0-T02` 与 `V02-M0-T03` 完成。下一项严格为 `V02-M1-T01` SSRF IPv4/IPv6；Windows 和 macOS 的最终实机/CI 证据仍由 M9 重新验收。

## 2026-08-08 — V02-M1-T01 关闭 SSRF IPv4/IPv6 绕过

### 实现

- 删除自维护的 IPv4/IPv6 “公网”网段判断，改用 `antissrf` 的 `ExternalOnlyLatest` 地址策略；依赖关闭默认 reqwest integration，不替换现有受限 HTTP transport。
- 对 IPv4-mapped、IPv4-compatible、NAT64、6to4 与 Teredo 解析内嵌 IPv4，并在外层策略之外复用同一 IPv4 安全判断。
- 保留全 DNS answer 校验、混合结果拒绝、解析地址固定、禁重定向和 URL host 驱动 Host/SNI 的既有边界。

### 验证

- `cargo test -p ember-secure-http`：11/11 通过。
- `cargo clippy -p ember-secure-http --all-targets -- -D warnings` 通过；全 workspace tests 继续执行到 `ember-secure-secrets`，仅因 macOS adapter 尚未实现而在既有 round-trip 测试返回 `Unavailable`，该失败正是下一项 SR2-002，不属于本次网络边界回归。
- 新矩阵覆盖 IPv4 private/CGNAT/link-local/documentation/benchmark/multicast/reserved，以及审查列出的 `64:ff9b:1::`、`100::`、`2001::`、`2001:2::`、`2001:10::`、6to4 和旧 compatible 形式。
- 未访问真实 Provider；所有网络测试仅使用回环临时服务。

### 结论

- SR2-001 / `V02-M1-T01` 关闭。下一项严格为 `V02-M1-T02` SecureVault。

## 2026-08-08 — V02-M1-T02 完成 SecureVault 生命周期

### 实现

- `SecretStore` 实现共享 `SecureVault` port；Windows 继续使用 Credential Manager，macOS 新增原生 Keychain adapter 与 health check。
- 模型设置协议新增 `KEEP`、`REPLACE`、`CLEAR`：空密钥保存保持旧引用，显式替换/清空才改变引用。
- 新增本地 migration 2 `credential_cleanup_queue`。新秘密先登记为可回滚暂存项，成功设置事务原子认领；旧引用在替换/清空事务中入队。
- 删除成功才完成队列项，失败增加 attempts 并保留；启动及模型设置命令自动重试。临时探测或保存回滚的删除失败同样持久化。
- Campaign archive schema 继续为1，与设备级 SQLite migration 2解耦；现有 TypeScript/Rust v1 fixture 保持互操作。

### 验证

- `cargo test -p ember-secure-secrets`：3/3，通过 macOS Keychain 真实运行时秘密 round-trip、健康检查和幂等删除，测试秘密已清理。
- `cargo test -p ember-native-bridge -p ember-tavern-windows`：38/38，通过替换、保持、清空、事务回滚、删除失败、重启恢复和成功重试。
- macOS 上的 Provider 系统凭据集成测试通过：仅向本机回环测试服务发送 Keychain 中的随机运行时值，并完成清理。
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` 通过。
- `pnpm test`：340/340，通过 migration 2、archive schema 1互操作、UI不暴露秘密及空输入 `KEEP` 回归。
- `pnpm check:shared` 与 `pnpm build:desktop` 通过；Vite 转换 179 modules。
- 未访问真实 Provider、付费 API 或正式用户数据；系统库测试只使用随机运行时值。

### 结论

- SR2-002 / `V02-M1-T02` 关闭。下一项严格为 `V02-M1-T03` `.emtavern` resource limits。

## 2026-08-08 — V02-M1-T03 关闭存档资源耗尽风险

### 实现

- `.emtavern` 压缩包/展开总量收敛到32/64 MiB，五个固定条目各自限制64 KiB、16 MiB或32 MiB，压缩比最多100:1。
- JSON文本在通用解析器前做非递归深度扫描，解析后以迭代遍历限制深度64、数组100,000项和字符串1,048,576字符/字节。
- 事件、生成记录、单个Campaign事实表和档案总记录数分别限制为100,000、20,000、20,000和200,000；导出与导入共享相同政策。
- TypeScript ZIP读取器只保留中央目录描述并按需用`maxOutputLength`展开；Rust先扫描全部元数据，再逐条目读取、校验SHA-256并解析，不再同时保存全部展开字节。

### 验证

- TypeScript资源测试与跨实现存档测试：12/12；包含实际中央目录压缩比炸弹拒绝。
- Rust native archive tests：7/7；包含真实DEFLATE高压缩比炸弹、极深JSON、超长数组/字符串、记录数、单条目和展开总量。
- `pnpm check:shared`：59 files / 344 tests 全部通过。
- `cargo test --workspace` 全部通过；native bridge 37/37，且 TypeScript/Rust v1 fixtures 双向互操作保持通过。
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` 通过。

### 结论

- SR2-003 / `V02-M1-T03` 关闭。下一项严格为 `V02-M1-T04` Secret scanning。

## 2026-08-08 — V02-M1-T04 完成全字符串秘密扫描

### 实现

- 新增共享 TypeScript 存档秘密扫描器，Rust native实现同一高置信模式；扫描敏感字段名及所有嵌套字符串值。
- 覆盖普通文本、请求JSON、原始响应、验证错误、四个数据文件和最终ZIP字节；识别Authorization、常见Provider Key/JWT、credential引用和显式测试密钥。
- 命中时导出/导入整体拒绝，不修改游戏状态、不发布目标文件，也不把命中原文写入错误消息。
- 诊断文本新增显式redaction函数，以`[REDACTED]`替换已知模式；隐私文档说明高置信扫描并非任意秘密识别的数学保证。

### 验证

- TypeScript scanner/export tests：14/14；覆盖嵌套值、纯文本Header、请求、响应、错误、普通叙事字段、JWT、测试密钥、redaction和无害叙事。
- Rust native archive tests：8/8；真实SQLite导出对嵌套请求值与纯文本Provider回显均拒绝。
- `pnpm check:shared`：60 files / 349 tests 全部通过。
- `cargo test --workspace` 全部通过，native bridge 38/38；`cargo clippy --workspace --all-targets --all-features -- -D warnings` 通过。

### 结论

- SR2-004 / `V02-M1-T04` 关闭。下一项严格为 `V02-M1-T05` Provider consistency。

## 2026-08-08 — V02-M1-T05 关闭 Provider 配置漂移

### 实现

- DeepSeek、Qwen和OpenRouter探测只接受固定规范化端点，设置页地址只读；Ollama和自定义服务把实际探测地址规范化后回传并保存。
- Tauri新增内存探测回执注册表：随机UUID回执最长15分钟、最多64项，精确绑定预设、端点指纹、模型、显示名、能力来源、能力值与探测指纹；保存前必须逐值匹配。
- 能力来源新增`PROVIDER_RESPONSE`、`PRESET_METADATA`、`UNKNOWN`。只有DeepSeek/Qwen正式预设模型使用预设能力，OpenRouter有响应元数据时标为Provider响应，其余保持未知和保守能力。
- SQLite migration 3新增`endpoint_fingerprint`、`capability_source`与`probe_fingerprint`；同一Provider更新时先禁用全部旧模型，默认/备用引用在同一事务先清空再按当前选择写入。
- Campaign archive schema仍为1；Provider配置、回执和设备能力继续不进入`.emtavern`。

### 验证

- 60个Vitest文件、349项测试通过；Node migration/startup覆盖migration 3字段与约束。
- Native model settings 11/11通过，覆盖端点切换、旧模型禁用、默认/备用清空、端点/能力指纹篡改拒绝。
- Tauri单元测试覆盖固定预设端点替换拒绝，以及回执与端点、模型、能力逐值绑定。
- 未访问真实Provider、付费API或正式用户数据；Provider探测测试只验证本地结构和既有回环合同。

### 结论

- SR2-005 / `V02-M1-T05` 关闭。下一项严格为 `V02-M1-T06` Destructive transaction lock。

## 2026-08-08 — V02-M1-T06 关闭破坏性备份并发窗口

### 实现

- `ember-platform-services`新增`AppInstanceLock` port和基于`fs2`的跨平台文件锁adapter，支持阻塞操作锁与非阻塞实例锁。
- Tauri在打开SQLite前取得全生命周期实例锁；第二应用实例不能进入运行期。`CampaignStore`的启动备份、恢复、永久删除和导入使用数据库相邻的操作锁。
- 永久删除与覆盖导入在同一连接记录`PRAGMA data_version`，备份后取得`BEGIN IMMEDIATE`并重新检查版本与目标；期间任一独立连接提交都会返回`CONCURRENT_MODIFICATION`，正式数据不变。
- 创建导入和恢复同样把协调锁保持到事务提交/回滚；备份失败继续阻断删除或覆盖。

### 验证

- 两个独立`CampaignStore`测试在永久删除和覆盖导入完成备份后提交新时间戳；两项破坏性操作均取消，最新Campaign保留。
- 两个独立文件锁adapter测试确认第二个非阻塞持有者在首个guard释放前返回`AlreadyLocked`，释放后可以取得。
- 既有永久删除、覆盖导入、备份失败、恢复、导入回滚与Windows纵向E2E继续纳入完整workspace门禁。
- 未访问正式用户数据；所有并发和备份测试使用自动清理的临时SQLite、锁文件与归档。

### 结论

- SR2-006 / `V02-M1-T06` 关闭。下一项严格为 `V02-M1-T07` TS/Rust bidirectional archive CI。

## 2026-08-08 — V02-M1-T07 建立当前双实现存档门禁

### 实现

- 新增`pnpm archive:interop`跨平台命令：当前TypeScript exporter → 当前Rust importer，再执行当前Rust exporter → 当前TypeScript importer。
- TypeScript门禁使用固定Campaign、事件、GenerationRecord和世界事实；Rust门禁使用固定Campaign与世界事实，两侧均检查导入后的SQLite事实且不携带设备Provider状态。
- `archive-fixtures.json`记录两份v1夹具的路径、producer、source test、固定创建时间与SHA-256；生成结果对五个固定ZIP条目的名称和完整字节做regenerate-and-diff。
- Windows/Unix由ZIP库写入的`made by`头允许不同，但提交夹具原始SHA-256仍由来源清单锁定；逻辑内容差异不能被忽略。
- Windows CI新增独立互操作步骤，不再只依赖同语言测试或历史夹具读取。

### 验证

- `pnpm archive:interop`通过：TypeScript定向13/13、Rust当前交叉门禁1/1、Rust输出回交TypeScript定向13/13。
- 两份重新生成归档的五个条目与提交夹具逐字节一致；提交文件SHA-256与来源清单一致。
- 命令只使用临时SQLite与临时归档目录，结束后自动清理；未访问真实Provider、凭据或正式用户数据。

### 结论

- SR2-007 / `V02-M1-T07` 关闭。下一项严格为 `V02-M1-T08` CI / evidence。

## 2026-08-08 — V02-M1-T08 建立双平台CI与结构化证据

### 实现

- GitHub Actions quality job扩展为Windows/macOS矩阵，两端运行完整共享检查与当前TS/Rust归档交叉门禁。
- Windows release job通过证据包装器运行纵向SQLite E2E和Tauri NSIS构建；macOS build job同样构建Tauri `.app`。
- 新增UTF-8命令证据包装器，记录命令、起止时间、退出码、signal、stdout和stderr；新增release证据收集器，记录bundle内全部常规文件的相对路径、大小与SHA-256并拒绝symlink/空目录。
- 两个平台的bundle和JSON证据均上传为CI artifact，失败时仍上传已产生的证据。

### 验证

- 新增4项Node测试：2项验证UTF-8命令/产物证据，2项锁定双平台矩阵、归档门禁、Windows纵向测试、NSIS、macOS app、哈希和artifact上传配置。
- 本机包装器测试真实捕获中文stdout与stderr并验证退出码/时间；临时bundle的长度与SHA-256逐值匹配。
- macOS本机实际`tauri build --bundles app`通过，release可执行文件与`Ember Tavern.app`生成成功；结构化命令证据退出码为0，bundle证据记录3个常规文件及SHA-256。
- 托管Windows NSIS和macOS app job只在远端CI运行；当前提交不把尚未出现的远端run结果写成已通过，M9仍需双环境最终验收。

### 结论

- SR2-008、SR2-009 / `V02-M1-T08` 关闭。SR2-010保留至最终连续流程截图；下一项严格为 `V02-M2-T01` AI Task Orchestrator。

## 2026-08-08 — V02-M2-T01 统一 AI Task Orchestrator

### 实现

- 新增品牌化`AiOperationId`以及统一`AITaskRequest`/`AITaskResult`，在一次执行中绑定task、request、operation、Campaign/Actor、Provider配置、模型和attempt。
- route显式区分`PRIMARY`、`RETRY`、`FALLBACK`与`REPAIR`；恢复流程分别标记fallback/retry，结构修复标记repair，禁止adapter内部隐式切换。
- Provider调用前验证request/route身份，返回后验证request/model和token usage；错误归一为configuration、credential、capability、network-policy、timeout、provider、schema、domain-policy、stale-revision和cancelled十类。
- 世界、角色、酒馆、任务、NPC对话、冒险开始/回合/结算共八类应用生成路径全部经过统一执行入口，UI继续只调用Application service。

### 验证

- 新增7项Orchestrator测试，覆盖四类route、attempt规则、调用前拒绝漂移、usage一致性、timeout和稳定错误分类。
- 完整`pnpm test`通过：61个Vitest文件、358项测试，Node持久化与脚本测试同时通过；`pnpm typecheck`、`pnpm lint`和`git diff --check`通过。
- 未访问真实Provider、付费API或正式用户数据；测试只使用Fake Provider和固定规范化响应。

### 结论

- `V02-M2-T01`完成。下一项严格为`V02-M2-T02` Context Assembly Pipeline。

## 2026-08-08 — V02-M2-T02 完成 Context Assembly Pipeline

### 实现

- 新增完整ContextBlock schema：12种类型、stable/semi-stable/dynamic、priority、块预算、privacy class、source/revision、version及规范化JSON SHA-256。
- 装配器按阶段、任务type顺序、priority和ID确定性排序；支持0～1 relevance、required块、块预算与总预算，可选块按not-relevant/block-budget/total-budget记录排除原因且不截断JSON。
- ContextManifest只保存来源、版本、hash、隐私级别、估算token和纳入原因，不复制块内容；required块无法装入时fail closed。
- 所有普通应用生成和回合Orchestrator都在Provider前创建任务块；AITaskOrchestrator重新计算hash并核对included manifest，context或provenance漂移时不调用Provider。

### 验证

- 新增5项装配测试，覆盖规范化hash、provenance隐私、三阶段确定顺序、相关性/双层预算、整块排除、required失败与UTF-8估算。
- Orchestrator测试新增context篡改拒绝；完整`pnpm test`通过62个Vitest文件、363项测试，并通过Node持久化/脚本测试。
- `pnpm lint`、`pnpm typecheck`与`git diff --check`通过；未访问真实Provider、付费API或正式用户数据。

### 结论

- `V02-M2-T02`完成。下一项严格为`V02-M2-T03` ResolvedModelConfig。

## 2026-08-08 — V02-M2-T03 冻结 ResolvedModelConfig

### 实现

- 新增ConnectionProfile到ResolvedModelConfig的单向解析，冻结规范化endpoint、Provider options、credential reference、模型档案/名称、能力、生成参数、prompt profile和cache profile。
- 所有语义字段以Unicode NFC规范化JSON计算SHA-256；ContextBlock同时改用共享规范化器，使组合/分解Unicode得到同一hash并拒绝等价键冲突。
- AITaskOrchestrator复算fingerprint并绑定route/request，Provider只接收冻结投影；可编辑配置对象在调用前变化不会影响实际endpoint、credential reference或options。
- 回合GenerationRecord记录resolved fingerprint而不记录完整配置；结构修复要求与原fingerprint一致，temperature或任一配置漂移均在第二次Provider调用前失败。

### 验证

- 新增3项ResolvedModelConfig测试，覆盖深冻结、端点规范化、确定性fingerprint、参数差异、投影、禁用配置及含authority秘密/query的端点拒绝。
- Orchestrator新增冻结投影测试；repair回归新增generation参数漂移拒绝并确认Provider仍只调用一次。
- 完整`pnpm test`通过63个Vitest文件、367项测试及16项Node测试；`pnpm typecheck`通过。未访问真实Provider、付费API或正式用户数据。

### 结论

- `V02-M2-T03`完成。下一项严格为`V02-M2-T04` AI Candidate Infrastructure。

## 2026-08-08 — V02-M2-T04 建立 AI Candidate Infrastructure

### 实现

- SQLite migration 4新增`ai_candidates`，绑定Campaign、operation、GenerationRecord、payload、双重验证证据、无秘密provenance、expected revision、状态和修订链；TypeScript/Rust启动迁移同步升级。
- 新增Candidate repository与Application use cases：propose、preview、edit/regenerate修订、reject及confirm；payload和provenance执行高置信credential扫描。
- Candidate不可原地编辑；修订在同一事务创建新PROPOSED项并把旧项标为SUPERSEDED，保留双向链和独立operation。
- confirm在`BEGIN IMMEDIATE`中核对Campaign/状态/revision，领域commit与ACCEPTED转换共同提交；失败共同回滚，重复确认不会重复领域写入。

### 验证

- 新增4项Candidate纵向测试，覆盖生成/验证/预览、编辑修订、无领域副作用、stale revision、原子确认、幂等重复确认、领域失败回滚、拒绝和credential拒绝。
- 完整Vitest通过64个文件、371项测试；Node migration 4新库与重复应用通过，旧库升级断言更新并定向通过。
- Rust native启动路径纳入migration 4，格式门禁及newer-schema拒绝测试通过；未访问真实Provider、付费API或正式用户数据。

### 结论

- `V02-M2-T04`完成。下一项严格为`V02-M2-T05` Event Ledger。

## 2026-08-08 — V02-M2-T05 建立最小 Event Ledger

### 实现

- SQLite migration 5新增独立`event_ledger`，覆盖character、quest、turn、dice、scene、knowledge、snapshot和recovery八类注册事件/聚合。
- 每项绑定全局event ID、operation ID、aggregate ID/type、连续revision、版本化payload、source和数据库生成时间；唯一约束阻止operation元组重放与revision重复。
- 数据库触发器要求同一aggregate从revision 1严格连续；Repository校验注册表、正整数、JSON和高置信credential，并提供Campaign/aggregate确定性查询。
- Candidate确认纵向测试在同一事务写领域投影、QUEST ledger和ACCEPTED状态；领域失败时三者共同回滚，证明Ledger不脱离状态事务。

### 验证

- 新增3项Ledger测试，逐项覆盖八类首批事件、数据库时间、连续revision、operation幂等、aggregate顺序和秘密拒绝。
- Candidate 4项纵向测试继续通过并新增Ledger原子提交/回滚断言；migration 5新库、重复应用与旧库升级纳入门禁。
- Rust native 43/43通过，包含Windows纵向切片、存档和newer-schema拒绝；`pnpm lint`、`pnpm typecheck`及格式检查通过。未访问正式用户数据或外部API。

### 结论

- `V02-M2-T05`完成，M2 Core AI Architecture实现任务结束。下一项严格为`V02-M3-T01` “我的”入口。

## 2026-08-08 — V02-M3-T01 新增“我的”入口

### 实现

- 存档首页主操作区新增“我的”，无需先选择Campaign即可进入设备级设置。
- 共享侧栏把原“设置”导航升级为“我的”并使用独立`/my`路由；旧`/settings`继续保留，避免恢复提示和既有深链失效。
- 新页面明确设备模型/偏好与SQLite游戏事实的边界，并提供模型设置和存档首页两个可用去向，不提前实现T02的信息架构内容。

### 验证

- 路由测试遍历全部六个共享导航并确认“我的”标题与选中状态。
- 存档首页新增无Campaign入口测试；相关2个测试文件共16项通过，`pnpm typecheck`通过。
- 未接入真实Provider、付费API或正式用户数据。

### 结论

- `V02-M3-T01`完成。下一项严格为`V02-M3-T02` 我的页面信息架构。

## 2026-08-08 — V02-M3-T02 建立“我的”信息架构

### 实现

- “我的”页面固定七个设备级分区：API、默认与备用、生成参数、DeepSeek缓存、上下文、隐私、版本与更新记录。
- 左侧语义导航直接定位页面section，桌面保持sticky目录，小窗口降为单列；每项说明与本地优先、配置冻结和隐私边界一致。
- API分区继续链接现有模型设置；其余分区只建立信息层级，不伪造尚未由T03～M4接线的实时值或控件。

### 验证

- 新增1项页面结构测试，逐一校验七个导航链接、section标题、锚点和模型设置深链。
- “我的”页面及共享路由2个测试文件共4项通过；`pnpm typecheck`通过。
- 未访问真实Provider、付费API或正式用户数据。

### 结论

- `V02-M3-T02`完成。下一项严格为`V02-M3-T03` Connection Profiles。

## 2026-08-08 — V02-M3-T03 建立 Connection Profiles

### 实现

- 建立前端单一`CONNECTION_PROFILES`闭集，逐项定义DeepSeek、Qwen、OpenRouter、Ollama与OpenAI-Compatible的显示名、默认端点、默认模型、端点模式和凭据模式。
- DeepSeek、Qwen及OpenRouter保持固定官方兼容端点且不可在界面编辑；Ollama与OpenAI-Compatible允许配置端点，Ollama明确不要求系统凭据。
- Profile切换统一重置端点、模型、探测模型及receipt，避免旧Profile探测证据被新选择复用；原生层既有固定端点和安全URL校验继续作为权威门禁。
- 已保存模型同时显示用户配置名、Connection Profile类型与实际Base URL；SQLite中已有`preset_key`继续作为持久Profile身份，不增加重复状态。

### 验证

- 新增五类Profile选项测试，覆盖三个固定端点只读、Ollama默认本机地址/禁用Key、OpenAI-Compatible空白可配置端点/可选Key。
- 模型设置页面2项测试通过；`pnpm typecheck`和`pnpm lint`通过。
- 未实现下一项T04的完整binding状态机，未连接真实Provider、付费API或正式用户数据。

### 结论

- `V02-M3-T03`完成。下一项严格为`V02-M3-T04` API Binding State Machine。

## 2026-08-08 — V02-M3-T04 建立 API Binding 显式状态机

### 实现

- 新增纯API Binding reducer，显式覆盖`editing`、`testing`、`choosing_model`、`saving`、`saved`和`failed`六态，页面不再以单一`busy`布尔值推断连接流程。
- 每次端点、Profile、配置名或API Key变化都会递增revision、清空探测证据并废止当前operation；测试/保存返回必须同时匹配operation ID与revision，迟到结果不能恢复旧receipt。
- 连接测试加入30秒默认逻辑超时与可见取消操作；取消后仍由原异步操作的`finally`清理临时credential，底层迟到结果不进入页面状态。
- 保存期间锁定配置表单；保存失败进入`failed`但保留同revision已验证证据，允许用户显式重试，不自动更换Profile或模型。
- 记录`DEC-066`，明确前端状态机与原生probe receipt安全门禁的职责边界。

### 验证

- 状态机5项测试覆盖完整成功路径、timeout、cancel与迟到结果、config changed、key replaced及save failed重试。
- 页面3项测试新增六态可见转换和取消后忽略迟到Provider结果；相关8项测试、`pnpm typecheck`、`pnpm lint`及diff检查通过。
- 未实现T05的凭据clear/remove/health界面，未调用真实Provider、付费API或正式用户数据。

### 结论

- `V02-M3-T04`完成。下一项严格为`V02-M3-T05` Credential UI。

## 2026-08-08 — V02-M3-T05 完成 Credential UI

### 实现

- API Key输入根据当前匹配档案明确显示新建或替换语义；留空保留已有reference，输入新Key经连接测试后使用既有原子REPLACE流程，保存完成立即清空且永不回显。
- 新增“清空未保存的 Key”，只清除React草稿并使旧探测证据失效；已保存档案提供带确认的“删除已保存凭据”，配置和模型继续保留。
- 已保存档案显示三类保守健康信息：Ollama无需Key、远端档案已保存reference但需连接测试确认当前可用性、或未保存；最近探测时间仅取已持久化capability checkedAt，不宣称实时有效。
- 全局显示credential cleanup queue健康；有待处理项时明确旧引用已停用并可调用设置读取路径重试安全库清理，仍失败则保留数量供后续启动重试。
- 复用M1已验收的系统安全凭据、opaque reference、事务后清理队列和持久重试，没有把秘密、reference值或真实Key加入页面、SQLite游戏事实或日志。

### 验证

- 页面4项测试覆盖新Key保存、留空KEEP、Key替换REPLACE、草稿clear、带确认remove、cleanup pending/重试恢复、健康文案及DOM不含草稿Key。
- 定向测试、`pnpm typecheck`、`pnpm lint`及diff检查通过。
- 未调用真实Provider、付费API或正式用户数据；未提前实现M4 DeepSeek缓存功能。

### 结论

- `V02-M3-T05`完成，M3 Settings & Profile UX实现任务结束。下一项严格为`V02-M4-T01` DeepSeek Profile。

## 2026-08-08 — V02-M4-T01 固定 DeepSeek Flash Profile 身份

### 实现

- Provider preset继续只向API发送模型ID `deepseek-v4-flash`，并把对应玩家可见名称固定为`DeepSeek-V4-Flash-0731`；二者以独立常量表达，避免展示名进入请求model字段。
- Tauri模型探测通过DeepSeek preset元数据返回规范UI名，新保存档案持久化该名称；原生档案测试同步锁定准确字符串。
- 前端Profile默认值引用API ID常量，probe解析和已有档案解析对该精确preset/model组合规范化UI名，因此旧本地记录无需数据库迁移也不会继续展示旧名称。
- DeepSeek V4 Pro及其他Provider显示名不受影响；本项未加入缓存序列化或Prompt内容。

### 验证

- Rust DeepSeek契约测试同时断言API ID和UI名并完成本地mock模型列表/生成；TypeScript契约测试证明旧显示名读入后API ID不变、UI名被规范化。
- 模型设置相关7项测试、`pnpm typecheck`和`pnpm lint`通过；未访问真实DeepSeek或付费API。

### 结论

- `V02-M4-T01`完成。下一项严格为`V02-M4-T02` Stable Prompt Profile。

## 2026-08-08 — V02-M4-T02 建立 Stable Prompt Profile

### 实现

- 新增`deepseek-v4-flash-prefix` version 1，固定System Contract、Game Rules、Output Schema、Prompt Profile、Stable World Truths五段及其不可插队顺序。
- Prompt Profile显式冻结task、逻辑角色、任务指令、schema名、任务prompt版本和stable profile版本；完整输出schema进入稳定消息前缀，不再只存在于Provider response format参数。
- Stable World Truths进入前递归复制冻结，并拒绝timestamp、request ID、UUID、transient error、cache metrics及UI debug字段/值；当前调用默认空事实段，等待T04按ContextBlock知识边界接线。
- 现有`formatTaskPrompt`统一携带profile并在动态Task Input JSON之前渲染；不支持system message的模型仍按原能力折入单一USER消息。
- 记录`DEC-067`并同步目标架构当前实现边界，明确T03才负责最终确定性字节序列化。

### 验证

- Prompt目录9项测试通过，新增断言五段准确顺序、profile/task双版本、实际输出schema、前缀位置，以及request ID与UUID拒绝。
- `pnpm typecheck`和`pnpm lint`通过；未发送真实请求或使用正式用户数据。

### 结论

- `V02-M4-T02`完成。下一项严格为`V02-M4-T03` Deterministic Serialization。

## 2026-08-08 — V02-M4-T03 统一确定性序列化

### 实现

- 导出并复用`ai-core`单一canonical JSON实现，Stable Prompt Profile不再调用普通`JSON.stringify`，与ContextBlock hash、token估算及ResolvedModelConfig fingerprint采用相同字节语义。
- object key执行NFC/LF规范化后按码点排序且无额外空白；Unicode等价重复key拒绝，避免规范化后静默覆盖。
- array严格保留调用方语义顺序；string与enum执行NFC和CRLF/CR到LF归一化；finite number使用JSON规范形式并把负零稳定为零，NaN/Infinity拒绝。
- Prompt段固定为section enum、单LF、canonical JSON，段间双LF且末尾无换行；记录`DEC-068`并同步目标架构当前实现。

### 验证

- 新增2项canonical JSON测试，逐项覆盖乱序key、array、零、enum、Unicode组合、CRLF、UTF-8字节相等、非有限数及等价key拒绝。
- Prompt目录新增精确字节片段测试；canonical/context/prompt共17项测试、`pnpm typecheck`及`pnpm lint`通过。
- 未改变`.emtavern`格式、未重写已有审计hash、未访问外部API或正式用户数据。

### 结论

- `V02-M4-T03`完成。下一项严格为`V02-M4-T04` Context Cache Layout。

## 2026-08-08 — V02-M4-T04 建立 Context Cache Layout

### 实现

- ContextBlock注册表增加summary、state和action语义类型；新增五段Cache Layout：Long-term Summary、Relevant Lore/Knowledge、Recent History、Current Scene/State、Player Action。
- summary/memory/lore/knowledge强制semi-stable，history/scene/state/dice/action/user_input强制dynamic；错误stability或尚未映射的复合类型直接拒绝，防止行动进入可复用前缀。
- Layout只投影type、source revision、version、content hash和content，不把block/source ID等随机标识送进Prompt；半稳定与动态段分别按稳定语义顺序整理。
- Provider-neutral formatter可选接收Stable World Truths与Cache Layout，按段渲染后再追加canonical `TASK_INPUT`；既有调用不传layout时保持行为兼容。
- 记录`DEC-069`并同步目标架构；现有复合`task` ContextBlock未被虚假拆分，真实云生成启用前必须由知识边界后的细粒度块接线。

### 验证

- 新增2项Layout测试，覆盖五段/两层准确顺序、summary/lore/knowledge/history/state/action映射、投影不含source ID、错误层级和未知类型拒绝。
- Prompt集成测试证明semi-stable、dynamic与`TASK_INPUT`顺序及Stable World Truths位置；相关13项测试、`pnpm typecheck`、`pnpm lint`和diff检查通过。
- 未访问外部API、未承诺缓存命中率、未记录完整Prompt指标。

### 结论

- `V02-M4-T04`完成。下一项严格为`V02-M4-T05` Cache Metrics。

## 2026-08-08 — V02-M4-T05 建立 Cache Metrics

### 实现

- OpenAI-compatible Provider usage新增可选`prompt_cache_hit_tokens`和`prompt_cache_miss_tokens`解析；字段缺失保持unknown，不从总token猜测命中。
- 新增cacheable prefix SHA-256，只覆盖Stable Prompt Profile及summary/lore/knowledge两个semi-stable段，不含dynamic history/scene/action或Task Input。
- 新增设备级Cache Metrics Repository，记录task type、hit/miss、计算ratio、prefix hash和记录时间，使用`BEGIN IMMEDIATE`更新现有`app_settings.deepseek_cache_metrics_v1`并仅保留最近200项。
- 指标读取严格拒绝未知字段、非法task、负数/非安全整数、伪造ratio、非法hash和时间；数据模型明确排除完整Prompt、messages、context、request ID及credential，不进入Campaign可移植格式。
- 记录`DEC-070`并同步目标架构/数据模型；不承诺固定命中率，不在Fake Provider路径生成虚假指标。

### 验证

- Rust Provider 15/15契约测试通过；DeepSeek本地mock响应断言1000 hit与400 miss被准确解析，未访问真实API。
- 新增2项持久指标测试，覆盖ratio、精确字段白名单、SQLite持久读取、无Prompt内容、非法输入及注入`fullPrompt`拒绝。
- Prompt测试断言prefix hash为64位小写SHA-256；相关13项TypeScript测试、`pnpm typecheck`和`pnpm lint`通过。

### 结论

- `V02-M4-T05`完成。下一项严格为`V02-M4-T06` Cache Regression。

## 2026-08-08 — V02-M4-T06 固定 Cache Regression 门禁

### 实现

- 导出可缓存prefix的规范文本函数，与生产prefix hash共用同一路径，允许测试直接比较UTF-8字节而非只比较摘要。
- Provider Context段不再序列化`contentHash`：该hash包含block/source身份，虽未直接发送UUID仍会随随机ID变化；Prompt只发送type、source revision、version和content，内部Layout/manifest继续保留hash供校验。
- 保持dynamic Context完整渲染，但cacheable prefix只选两个semi-stable段；当前action变化因此只改变tail。
- Profile hash覆盖任务Prompt版本/schema名；Prompt Profile升级会自然改变prefix bytes与SHA-256，无需人为清缓存。

### 验证

- 新增3项专用回归：相同稳定语义在不同object key顺序及随机block/source ID下产生逐字节相同prefix；只改action时prefix/hash不变但完整Context tail变化；Prompt版本1升2时hash必变。
- cache regression、prompt和layout共16项测试、`pnpm typecheck`、`pnpm lint`及diff检查通过。
- 未访问真实Provider、未声明固定缓存命中率、未把完整Prompt写入指标。

### 结论

- `V02-M4-T06`完成，M4 DeepSeek Cache实现任务结束。下一项严格为`V02-M5-T01` Single Version Source。

## 2026-08-08 — V02-M5-T01 建立 0.2.0 单一版本源

### 实现

- 根`package.json.version`升级为产品权威版本`0.2.0`；Windows、全部共享npm workspace及iOS占位manifest同步对齐，未开展iOS功能。
- 根Cargo workspace新增`workspace.package.version = 0.2.0`，五个共享crate和Tauri crate全部改为`version.workspace = true`；Cargo.lock由Cargo重新解析为0.2.0。
- Tauri bundle配置升级到0.2.0；存档导出原有`CARGO_PKG_VERSION`路径自然使用同一Rust workspace版本。
- “我的 → 版本与更新记录”通过`@tauri-apps/api/app.getVersion()`读取打包metadata并显示，不在玩家UI源码另写版本常量。
- 记录`DEC-071`；历史v0.1验收文档、安装包路径及存档兼容测试值保持历史事实，不做机械替换。

### 验证

- My页面与Tauri配置3项测试通过，release metadata 2项Node测试通过并在当前darwin/arm64输出version 0.2.0。
- Cargo workspace全套81项测试通过，输出确认六个内部crate均编译为0.2.0；TypeScript完整71个文件/398项测试、16项Node测试、`pnpm typecheck`和`pnpm lint`通过。
- 未发布、签名或上传产物，未访问真实API或正式用户数据。

### 结论

- `V02-M5-T01`完成。下一项严格为`V02-M5-T02` Changelog Automation。

## 2026-08-08 — V02-M5-T02 自动化 Changelog 与发布信息

### 实现

- 新建根`CHANGELOG.md`，以current-release标记维护`0.2.0 Unreleased`区段；保留历史`0.1.0`但不虚构未知发布日期。
- 新增`release-info.json`及前端生成模块，包含schema、版本、development/unreleased状态、Changelog定位和当前更新摘要；“我的 → 版本与更新记录”显示Tauri运行时版本及生成的发布状态/摘要。
- 新增`release:sync`，从根版本权威源同步全部npm manifests、Tauri、Cargo workspace/成员、Cargo.lock及Changelog标题，再确定性生成两份release-info消费者格式。
- 新增严格只读`release:check`，检测全部版本镜像、Cargo继承、lockfile、Changelog、JSON和前端生成模块漂移；CI在Windows/macOS共享门禁执行该检查。
- release metadata产物增加channel/status；记录`DEC-072`。为恢复仓库级Prettier门禁，仅机械格式化此前已提交但未符合现行规则的v0.2文件，不改变逻辑。

### 验证

- `pnpm release:sync`后`pnpm release:check`通过，并验证再次检查不写文件；Node发布脚本4项测试覆盖确定性生成及8类镜像漂移。
- My页面与Tauri配置3项定向测试、`pnpm typecheck`、`pnpm lint`、全仓`pnpm format:check`及`git diff --check`通过。
- 当前发布状态仍为unreleased；未构建、签名、上传或发布产物，未访问真实API、正式用户数据或开展iOS功能。

### 结论

- `V02-M5-T02`完成。下一项严格为`V02-M5-T03` zh-CN Resource Layer。

## 2026-08-08 — V02-M5-T03 建立 zh-CN 玩家资源层

### 实现

- 新增`windows-app/src/localization/zh-CN.ts`，以只读分区集中通用、导航、标题栏、加载、路由/页面错误和存档文件对话框文案；动态存档标题使用资源格式化函数，不在页面拼接句式。
- 新增唯一活动locale与`playerText`类型安全入口，不提供英文fallback、缺键回显或自动locale侦测；应用启动显式设置HTML根`lang=zh-CN`。
- 应用壳层、全局Suspense/404/ErrorBoundary和Tauri导入导出对话框改用资源入口，清除其中`Current room`、`Local session`、`Preparing room`等玩家可见英文。
- 记录`DEC-073`；页面级游戏流程迁移明确留给紧随其后的T04，不启动iOS或新增多语言切换范围。

### 验证

- 新增2项资源层测试，验证唯一locale、静态资源非空、动态格式化和document语言标记。
- localization、路由、存档对话框及存档首页共4个文件/20项定向测试通过；`pnpm typecheck`、`pnpm lint`与`git diff --check`通过。
- 未访问网络、Provider或正式用户数据，未增加英文资源或静默fallback。

### 结论

- `V02-M5-T03`完成。下一项严格为`V02-M5-T04` Core UI Localization。

## 2026-08-08 — V02-M5-T04 完成核心 UI 中文覆盖

### 实现

- 存档、世界构筑、车卡、酒馆、NPC对话、任务告示、冒险/D20、档案、恢复、模型设置与“我的”全部核心流程清除英文页面眉题并接入zh-CN资源。
- API Binding的editing/testing/choosing_model/saving/saved/failed转为中文展示；连接配置表单不再显示`Connection Profile`，发布channel/status也不再直接显示`development / unreleased`，未知值使用中文保守状态。
- 更新日志标题、当前版本“未发布”状态及连接配置/API绑定摘要改为中文；release sync/check同步适配中文标题，机器协议中的`unreleased`保持不变。
- 修正模型隐私说明仍引用0.1候选及`Campaign`的过期文本；明确保留Provider/模型名、model ID、API字段、URL、代码标识与玩家/AI专名。
- 发布同步JSON改用仓库Prettier配置确定性写入，修复`release:sync`后Tauri配置立刻产生格式漂移的问题；记录`DEC-074`。

### 验证

- 13个核心页面/资源测试文件共35项定向测试通过，覆盖导航、存档、世界、车卡、酒馆、NPC、任务、冒险、档案、恢复、模型与更新记录。
- 中文Changelog同步后`release:sync`、只读`release:check`、发布脚本4项测试及仓库级`format:check`通过；同步本身不再制造格式差异。
- `pnpm typecheck`、`pnpm lint`与`git diff --check`通过；未访问真实Provider、正式用户数据或iOS代码。

### 结论

- `V02-M5-T04`完成。下一项严格为`V02-M5-T05` English Regression Gate。

## 2026-08-08 — V02-M5-T05 建立玩家可见英文回归门禁

### 实现

- 新增TypeScript AST检查器，扫描生产TSX的渲染正文、玩家属性、confirm和状态/错误消息，并检查zh-CN资源、Changelog与release-info highlights。
- 明确跳过className、key、路由、内部枚举、测试夹具与服务诊断；仅放行Provider/模型名、model ID、API字段、URL、代码标识、玩家/AI专名及`.emtavern`格式名。
- 首次扫描修复`Notice board`、`Posted by`、`temperature`、`Inspector`、`ReleaseMetadata`、`Schema`等真实遗漏；误报修正通过AST父节点边界完成，没有扩大普通英文允许范围。
- 新增`pnpm i18n:check`并接入Windows/macOS共享CI；更新日志同步记录英文回归门禁，记录`DEC-075`。

### 验证

- 新增3项Node测试，证明渲染正文/accessibility label/状态消息会失败，允许技术专名可通过，资源与Changelog可检出且机器case不误报。
- 当前仓库`pnpm i18n:check`通过；My/任务/路由5项定向UI测试、`pnpm typecheck`、`pnpm lint`和`git diff --check`通过。
- 未扫描或修改模型生成的玩家内容、正式用户数据或iOS代码，未访问网络。

### 结论

- `V02-M5-T05`完成，M5版本/Changelog/zh-CN任务结束。下一项严格为`V02-M6-T01` Scroll / Layout。

## 2026-08-08 — V02-M6-T01 修复车卡滚动与缩放布局

### 实现

- `.character-studio`改为独立`100dvh`滚动容器，固定滚动条槽、封闭横向溢出并包含overscroll，避免根页面`overflow:hidden`导致低高度字段不可达。
- 车卡表单双栏明确最小28rem/18rem；900px以下表单、特质和确认视图切换单栏，按钮移除最小宽度并铺满可用区域。
- 主操作使用safe-area感知sticky底部位置；640px以下压缩页面顶部、topline、intro与标题，保留全部字段和操作。
- 新增布局合同测试，对860×600、1180×760、1366×768、1920×1080在100%/125%/150%共12组组合验证单/双栏宽度与低高度分支，并锁定滚动/断点/sticky规则；记录`DEC-076`。

### 验证

- 布局合同2项与现有车卡交互3项测试通过；`pnpm typecheck`、`pnpm lint`、英文回归门禁和`git diff --check`通过。
- `design-review`技能因用户未提交`.gitignore`且当前main无目标URL，按技能硬规则未启动截图流程；没有提交/暂存该用户文件，也没有伪造截图证据。
- Windows前端生产构建及全量73个文件/402项Vitest、21项Node测试通过；真实Windows/macOS视口截图证据保留到M9双环境验收。

### 结论

- `V02-M6-T01`完成。下一项严格为`V02-M6-T02` Character Structure。

## 2026-08-08 — V02-M6-T02 建立车卡八分区

### 实现

- 已确认角色卡固定为summary、basics、attributes、background、personality、traits、equipment、AI controls八个语义区，并以稳定`data-character-section`顺序标识。
- 基础区显示姓名、性别、年龄、职业与概念；属性区显示四项数值；背景、特质和装备继续读取已提交视图。
- 领域模型没有独立personality字段，个性区仅投影个人目标、故事偏好和内容边界；未新增schema、migration或伪造字段。
- AI控制区只说明本地确认边界并保留进入酒馆操作，不加入生成/校验/预览/编辑/确认状态；新增响应式八区样式并记录`DEC-077`。
- 更新Changelog并通过release sync把车卡布局/八分区摘要送入“我的 → 版本与更新记录”。

### 验证

- 车卡交互测试新增八区精确顺序及七个内容标题断言；与布局合同共5项测试通过。
- 发布同步/检查、Windows前端生产构建、全量73个文件/402项Vitest与21项Node测试、`pnpm typecheck`、`pnpm lint`、玩家可见英文门禁及格式检查通过。
- 未修改SQLite、存档格式、AI请求、Provider或正式用户数据，未开始iOS。

### 结论

- `V02-M6-T02`完成。下一项严格为`V02-M6-T03` AI Character State Machine。

## 2026-08-08 — V02-M6-T03 建立 AI 车卡显式状态机

### 实现

- 新增纯reducer覆盖idle、generating、validating、preview、editing、confirming、committed，并记录revision、active operation与生成/验证/确认失败种类。
- 草稿和特质选择变化递增revision并失效当前操作；生成、验证、预览和确认结果必须同时匹配operation ID与revision，迟到结果不再更新当前UI。
- Character service增加只读validation observer，在Provider身份核对后、结构验证前通知UI进入validating；不暴露raw response或绕过既有schema验证。
- 页面移除独立busy state，busy由三个活动阶段派生；恢复本地进度映射idle/preview/committed，玩家看到中文live status和阶段化按钮文案。
- 记录`DEC-078`并更新Changelog；明确T03只保证UI结果时序，旧命令的SQLite提交时机必须由T04 Candidate任务修复。

### 验证

- 新增3项状态机测试，覆盖完整阶段链、编辑使迟到验证失效、失败回到可重试编辑态；service/page/layout共11项定向测试通过。
- 页面测试验证编辑、预览、再次编辑和已提交中文状态；`pnpm typecheck`、`pnpm lint`、英文回归门禁和`git diff --check`通过。
- Windows前端生产构建、全量74个文件/405项Vitest、21项Node测试、发布同步/检查和格式检查通过。
- 未改变SQLite schema、存档格式、Provider配置或正式用户数据，未提前实现Candidate原子确认。

### 结论

- `V02-M6-T03`完成。下一项严格为`V02-M6-T04` AI Character Candidate。

## 2026-08-08 — V02-M6-T04 建立可恢复的 AI 角色候选与原子确认

### 实现

- 原生角色流程复用migration 4的`ai_candidates`：特质生成建立PROPOSED候选，重新生成以SUPERSEDED修订链替代旧候选；完整背景生成建立包含草稿、六个候选、两个选择、背景、程序拥有装备效果及两次生成审计的完整候选。
- `character_completion_commit`不再写`player_characters`、`items`、`pending_ai_requests`、`generation_records`或推进Campaign，只返回可跨重启恢复的完整候选；页面增加明确的候选预览与“确认角色并写入存档”操作。
- 新增`character_candidate_confirm`固定语义命令，在`BEGIN IMMEDIATE`内复核Candidate状态/版本/Campaign、结构与领域规则、AI响应一致性和输入/上下文绑定，再原子写角色、装备、两次生成审计、ACCEPTED状态及下一Campaign阶段。
- 确认失败整笔回滚，重复确认同一ACCEPTED候选幂等返回；Candidate不包含凭据。`.emtavern`格式未携带PROPOSED Candidate，因此导出在存在未确认候选时明确报错，避免静默丢进度。
- 记录`DEC-079`并更新Changelog/release摘要；未新增schema、真实Provider/付费调用、正式用户数据或iOS代码。

### 验证

- Rust边界测试证明完整候选生成后角色、物品、已提交生成记录均为0，未确认归档导出被阻止；确认后恰有两条生成记录、候选为ACCEPTED，重复确认不重复写入，关闭重开后角色继续存在。
- Native bridge 43项全量测试（含Windows纵向E2E）通过；Tauri Windows crate `cargo check`通过。
- 车卡service/page/state/layout 11项定向Vitest通过，覆盖候选预览提示、独立确认及committed状态；`pnpm typecheck`通过。

### 结论

- `V02-M6-T04`完成，M6车卡AI任务结束。下一项严格为`V02-M7-T01` SceneFrame。

## 2026-08-09 — V02-M7-T01 建立 Adventure SceneFrame

### 实现

- 新增migration 6的`scene_frames`独立投影，保存scene/location/participants/pressure/affordances/pending consequences/return point/revision，不污染不可变`adventures.plan_json`。
- 初始冒险计划、叙事回合和D20结算均在现有原子事务中更新SceneFrame，并追加相同revision的`SCENE_COMMITTED` Event Ledger；失败回滚后不会留下半个场景。
- Adventure snapshot和AI回合ContextBlock读取持久Frame，严格验证嵌套结构、revision、最新本地ledger以及可移植game event恢复锚点；旧库无Frame时只派生兼容视图。
- GENERATE_ADVENTURE_TURN升级为prompt v2/schema v3，输入必须包含SceneFrame；Windows service验证Frame与当前场景摘要一致。
- `.emtavern` Campaign archive schema升级至2并携带`scene_frames`，TypeScript/Rust读取方继续接受schema 1；导入在正式写入前验证Frame结构、归属和event恢复点，Event Ledger保持设备级不迁移。
- 记录`DEC-080`并更新Changelog/release摘要；未实现T02行动模式、真实Provider/付费API、正式用户数据或iOS。

### 验证

- Rust Adventure测试覆盖初始Frame、每次回合/D20 revision、待决后果清除、重启恢复、ledger一致性和`.emtavern`跨库回环。
- TypeScript契约、上下文、prompt、service/page、存档和migration定向测试通过；旧数据库升级保留原始备份，schema 1 Rust夹具保持可导入。
- 全量门禁结果记录于本任务提交前的最终验证。

### 结论

- `V02-M7-T01`完成。下一项严格为`V02-M7-T02` Action Modes。

## 2026-08-09 — V02-M7-T02 建立冒险行动模式

### 实现

- 冒险输入区新增“行动 / 对话 / 观察”三种互斥意图及对应中文提示和提交文案，不隐藏现有建议或文本输入。
- Windows service与Tauri命令传递ACTION/DIALOGUE/OBSERVE；原生层在打开事务前拒绝未知模式，并把合法模式与玩家文本共同写入`player_action_json`。
- 原生/TypeScript恢复视图保留mode；旧回合没有mode时按ACTION兼容，新的Repository回环不会丢失显式mode。
- `GENERATE_ADVENTURE_TURN`升级到schema v4/prompt v3，Context Builder和原生上下文都传递`playerActionMode`，明确三种意图的叙事语义。
- 记录`DEC-081`并同步Changelog/release摘要；未实现下一任务的建议数量/知识来源约束。

### 验证

- 页面测试覆盖三种单选模式、动态提示、对话提交及模式到service的传递；service八回合测试轮换三种模式。
- Rust测试证明三种模式进入持久上下文，非法模式不创建回合；持久层回环覆盖OBSERVE mode。
- 全量门禁结果记录于本任务提交前的最终验证。

### 结论

- `V02-M7-T02`完成。下一项严格为`V02-M7-T03` Action Suggestions。

## 2026-08-09 — V02-M7-T03 建立受知识边界约束的行动建议

### 实现

- `GENERATE_ADVENTURE_TURN`升级到schema v5/prompt v4；活动场景严格要求3至5条不重复建议，ENDING严格要求0条，结构错误不能进入游戏事务。
- TypeScript Context Builder从当前Campaign SQLite读取Quest相关/LOCKED_RULE事实，并只为相关NPC装配known、suspected与false-belief statements；excluded secret facts在发送给模型前过滤。
- Application Use Case与原生Windows路径都传递knownFacts和npcKnowledge；原生提交层独立复核建议数量与去空白、大小写不敏感唯一性，避免绕过共享schema。
- Fake Provider与测试夹具改为合法的3条活动建议；记录`DEC-082`并同步Changelog/release摘要。
- 未改变T04自由输入合同，未接入真实Provider/付费API、正式用户数据或iOS。

### 验证

- 定向Vitest 6个文件、67项测试通过，覆盖上下文知识筛选、NPC秘密隔离、schema数量/去重/ENDING边界、prompt版本及两条回合编排路径。
- 完整74个Vitest文件/407项测试与21项Node测试通过；Prettier、ESLint、TypeScript、release metadata和zh-CN玩家文案门禁通过。
- Rust workspace格式、全target/feature Clippy及82项测试通过，包含Windows纵向E2E；原生层覆盖少于3条、空白/大小写重复及ENDING空建议边界。
- 桌面前端生产构建通过；未读取或改写正式用户存档。

### 结论

- `V02-M7-T03`完成。下一项严格为`V02-M7-T04` Free Input。

## 2026-08-09 — V02-M7-T04 固化始终可选的自由输入

### 实现

- 冒险行动区把文本框明确标记为“自由输入”，并提示玩家可忽略建议，直接描述想做、想说或想观察的内容。
- 3至5条建议只负责填入同一个可编辑文本框，不成为提交前置条件；建议与输入在非行动状态或提交进行中同步禁用，避免绕过状态机或重复提交。
- 提交成功后清空草稿；失败时保留原文并重新开放输入，玩家可编辑后再次提交。后端继续把任意合法文本与所选模式作为`FREEFORM`写入SQLite。
- 记录`DEC-083`并同步Changelog/release摘要；未提前实现T05状态机改造、真实Provider/付费API、正式用户数据或iOS。

### 验证

- Adventure页面3项定向测试通过，覆盖建议选择、完全不使用建议的任意观察文本、失败后草稿保留，以及D20后重新进入可行动场景。
- 完整74个Vitest文件/409项测试与21项Node测试通过；Prettier、ESLint、TypeScript、release metadata和zh-CN玩家文案门禁通过。
- Rust workspace格式、全target/feature Clippy及82项测试通过，包含Windows纵向E2E；桌面前端生产构建通过。

### 结论

- `V02-M7-T04`完成。下一项严格为`V02-M7-T05` Adventure Turn State Machine。

## 2026-08-09 — V02-M7-T05 建立显式冒险回合状态机

### 实现

- 新增纯Adventure Turn reducer，完整覆盖draft、submitted、generating、validating、resolving、committed和narrating，并用operation ID与draft revision拒绝乱序或迟到事件。
- Windows Adventure Service新增只读阶段观察边界：行动持久化、Provider生成、输出验证、原子提交开始和SQLite提交完成按真实顺序通知页面；恢复`WAITING_FOR_PLAYER`时复用同一条链路且不重复submit。
- 页面不再只用单一busy推断AI回合：各阶段提供中文live status，只有提交/生成/验证/提交事务进行时禁用行动；成功进入narrating后可继续编辑下一回合。
- submitted、generating、validating、resolving失败分别保留明确原因和原输入；编辑会废弃旧重试闭包。首次载入或待处理回合恢复失败时提供安全重载和恢复中心入口。
- 记录`DEC-084`并同步Changelog/release摘要；未改变D20硬逻辑、动画、真实Provider/付费API、正式用户数据或iOS。

### 验证

- 状态机、service与page共18项定向测试通过，覆盖完整七阶段顺序、四类失败、乱序/迟到拒绝、观察器隔离、待处理回合重启恢复、任意自由输入失败保留及载入重试。
- 完整75个Vitest文件/420项测试与21项Node测试通过；Prettier、ESLint、TypeScript、release metadata和zh-CN玩家文案门禁通过。
- Rust workspace格式、全target/feature Clippy及82项测试通过，包含Windows纵向E2E；桌面前端生产构建通过。

### 结论

- `V02-M7-T05`完成。下一项严格为`V02-M7-T06` D20 Hard Logic。

## 2026-08-09 — V02-M7-T06 固化 D20 硬逻辑

### 实现

- 共享DiceResult新增canonical raw、modifier、total、DC、result，程序按属性+装备+状态计算modifier，以安全整数加法计算total，再用total>=DC产生结果；旧d20/difficulty/success字段作为兼容别名保留。
- 原生Windows路径抽出独立D20硬逻辑，在SQLite事务前验证raw 1至20、属性1至5、DC闭集和溢出；随机字节使用rejection sampling消除直接mod 20偏差。
- 原生回合、TypeScript Repository、Game Event、Windows snapshot和Adventure Archive读取均复核别名一致性、修正分解、总计算式及结果，矛盾数据不能进入叙事或玩家界面。
- 冒险页和档案页明确展示raw + modifier = total / DC / result；`RESOLVE_DICE_RESULT`升级为schema/prompt v2，输入只携带已固定的五个硬结果字段并拒绝模型改写。
- 记录`DEC-085`并同步Changelog/release摘要；未实现T07动画、真实Provider/付费API、正式用户数据或iOS。

### 验证

- D20领域、持久化、schema、application、prompt、Windows解析/页面/档案共12个文件107项定向测试通过；覆盖阈值、边界、溢出、旧字段兼容和多种矛盾字段拒绝。
- 原生Adventure 3项定向测试通过，覆盖成功/失败硬结果、非法raw/属性/DC/溢出及完整八回合恢复链路。
- 完整77个Vitest文件/436项测试与21项Node测试通过；Prettier、ESLint、TypeScript、release metadata和zh-CN玩家文案门禁通过。
- Rust workspace格式、全target/feature Clippy及83项测试通过，包含Windows纵向E2E；桌面前端生产构建通过。

### 结论

- `V02-M7-T06`完成。下一项严格为`V02-M7-T07` D20 Animation。

## 2026-08-09 — V02-M7-T07 建立不重骰的 D20 动画

### 实现

- Windows Adventure Service把检定拆分为`rollCheck`与`completeCheck`：前者只生成并持久化硬结果，后者只读取该结果生成叙事；兼容入口仍按相同顺序执行。
- 新增D20动画组件，明确显示已锁定的raw、modifier、total、DC和result，并支持动画结束、fallback与“跳过动画”三种一次性完成路径。
- `prefers-reduced-motion`下立即揭示结果；组件中断卸载会取消fallback，刷新后从SQLite `RESOLVING` snapshot恢复同一结果，再继续叙事。
- Campaign级single-flight合并重复点击；已处于`RESOLVING`时直接复用持久结果，载入不再隐式跳过动画，也没有任何UI重骰入口。
- 记录`DEC-086`并同步Changelog/release摘要；未实现M8知识模型、真实Provider/付费API、正式用户数据或iOS。

### 验证

- 动画、页面与Service共16项定向测试通过，覆盖skip、repeat animation event、reduce motion、unmount interruption、refresh restore、并发/顺序重复点击及叙事阶段边界。
- 完整78个Vitest文件/442项测试与21项Node测试通过；Prettier、ESLint、TypeScript、release metadata和zh-CN玩家文案门禁通过。
- Rust workspace格式、全target/feature Clippy及83项测试通过，包含Windows纵向E2E；桌面前端199 modules生产构建通过。因用户级TUNA Git索引不可达，Rust门禁以临时Cargo Home复用本机rsproxy缓存离线执行，未修改全局配置或依赖锁。

### 结论

- `V02-M7-T07`完成。下一项严格为`V02-M8-T01` WorldTruth / Claim / Knowledge / Memory。

## 2026-08-09 — V02-M8-T01 建立四层知识领域模型

### 实现

- 新增独立WorldTruth、Claim、Knowledge与Memory判别合同及各自强类型ID，避免继续用WorldFact或NPC记忆数组表达所有语义。
- WorldTruth固定本地授权与public/game-private/secret可见性；Claim保存结构化陈述、Truth/Event/Actor来源、confidence和revision。
- Knowledge固定Actor、Truth/Claim目标、known/suspected/believed状态、可见性与最小来源；Memory只能引用Knowledge/Event证据，不含任何Truth authority。
- 构造器拒绝空白标识、非法枚举/置信度/revision、非有限或循环JSON、重复Memory来源和无来源Memory。
- 记录`DEC-087`并同步Changelog/release摘要；T01没有把仅有合同的新对象写入SQLite，避免在T03完整provenance落地前制造第二套不完整真相源。

### 验证

- Knowledge合同4项定向测试与既有Foundation/World/Tavern共31项测试通过，覆盖四层区分、Actor范围、来源、Memory单向边界及非法输入。
- 完整79个Vitest文件/446项测试与21项Node测试通过；Prettier、ESLint、TypeScript、release metadata和zh-CN玩家文案门禁通过。
- Rust workspace格式、全target/feature Clippy及83项测试通过，包含Windows纵向E2E；桌面前端200 modules生产构建通过。Rust继续以临时Cargo Home复用本机rsproxy缓存离线执行，未修改全局配置或依赖锁。

### 结论

- `V02-M8-T01`完成。下一项严格为`V02-M8-T02` NPC Knowledge Boundary。

## 2026-08-09 — V02-M8-T02 固化 NPC 知识边界

### 实现

- `NPC_REPLY` schema v2改为结构化Knowledge数组，显式区分TRUTH/CLAIM及KNOWN/SUSPECTED/BELIEVED，不再传递三个无类型字符串列表。
- TypeScript Context Builder只按当前NPC知识ID投影同Campaign事实，并过滤excluded secret、其他Actor消息和记忆；缺失事实、重复状态和错误认知越权均失败关闭。
- 原生Windows生成上下文实现同一查询与分类规则，限制最多100条，验证FALSE_BELIEF归属和memory.npcId；未授权但同Campaign存在的事实不会进入snapshot。
- 原生提交继续在事务内重建预期上下文并逐值比较，WebView不能注入“已知事实”；Prompt v2明确Claim不得冒充WorldTruth。
- 记录`DEC-088`并同步Changelog/release摘要；未修改Adventure GM知识上下文，未提前实现T03 provenance。

### 验证

- Context Builder、NPC Application、schema、prompt与Windows service共57项定向测试通过；原生NPC 3项测试覆盖未授权事实排除、跨Actor false belief拒绝及篡改零写入。
- 完整79个Vitest文件/447项测试与21项Node测试通过；Prettier、ESLint、TypeScript、release metadata和zh-CN玩家文案门禁通过。
- Rust workspace格式、全target/feature Clippy及84项测试通过，包含Windows纵向E2E；桌面前端200 modules生产构建通过。Rust继续以临时Cargo Home复用本机rsproxy缓存离线执行，未修改全局配置或依赖锁。

### 结论

- `V02-M8-T02`完成。下一项严格为`V02-M8-T03` Knowledge Provenance。

## 2026-08-09 — V02-M8-T03 持久化 Knowledge Provenance

### 实现

- schema 7在既有`npc_knowledge`权威行新增`provenance_json`，为每个活动知识事实记录state、source、eventId、learnedAt与confidence；没有新建第二套Truth或Knowledge数据源。
- 共享合同拒绝缺失/重复provenance、跨状态重复、excluded secret重叠、非法时间/置信度与无事件的观察/交流/推理来源；通用Knowledge合同同步补齐四个来源字段。
- TypeScript Repository原子保存来源并验证事件属于同一NPC Campaign；原生NPC对话与Adventure上下文读取执行同等状态、Actor、时间、置信度和事件校验。
- schema 6数据库按原数组顺序确定性回填IMPORT来源，过滤excluded secret；旧`.emtavern` schema 1/2缺列时在隔离导入阶段补齐后再执行严格领域重载。
- 存档JSON列清单、TypeScript/Rust导出导入及双向fixture已同步，记录`DEC-089`；未提前实现T04传闻来源化、真实Provider/付费API、正式用户数据或iOS。

### 验证

- 完整79个Vitest文件/448项测试与22项Node测试通过；迁移定向测试覆盖schema 6已知/怀疑/相信及excluded secret回填，Repository与合同覆盖来源往返和非法来源拒绝。
- Rust workspace格式、全target/feature Clippy及84项测试通过，包含原生NPC/Adventure边界、初始化持久化和Windows纵向E2E。
- `pnpm archive:interop`完成当前TypeScript/Rust归档双向生成、交叉导入与fixture逐条目比对；桌面前端200 modules生产构建通过。

### 结论

- `V02-M8-T03`完成。下一项严格为`V02-M8-T04` Rumor / Claim。

## 2026-08-09 — V02-M8-T04 轻量来源化酒馆传闻

### 实现

- RUMOR兼容投影新增独立claimId、来源NPC、WITNESS/HEARSAY/PERSONAL_BELIEF/FACTION_MESSAGE、confidence和claimRevision，并可通过`createClaimFromRumor`重建不含隐藏真实性的Claim。
- `GENERATE_NPCS` schema/prompt升级v3，分别生成传播方式、Claim置信度与隐藏veracity；来源名必须解析为当前Roster NPC，程序验证后与NPC Knowledge在同一事务提交。
- TypeScript WorldRepository和原生NPC Context验证Claim字段及来源NPC Campaign边界；Knowledge provenance继承对应Claim confidence，传闻继续只以CLAIM进入NPC Prompt。
- schema 8与旧存档导入兼容层把历史传闻保守回填为HEARSAY/0.5，并从既有detail或NPC Knowledge恢复来源；没有新增Claims表或第二套真相源。
- Windows Tavern view只携带claimId、来源NPC和传播方式，界面显示中文来源标签且不序列化隐藏veracity/confidence；记录`DEC-090`，未实现World Voices、真实Provider/付费API、正式用户数据或iOS。

### 验证

- Knowledge/World/Rumor合同、AI schema/prompt、Context、Application、Repository与Windows页面定向测试通过，覆盖Claim重建、来源往返、置信度继承、v3版本及隐藏veracity不出现在玩家投影。
- schema 6→8迁移测试同时覆盖Knowledge provenance、excluded secret和旧RUMOR来源回填；原生46项bridge测试通过，包含非法confidence零写入与Windows纵向E2E。
- 完整79个Vitest文件/449项测试与22项Node测试通过；Rust workspace格式、全target/feature Clippy及84项测试通过。
- `pnpm archive:interop`完成当前TypeScript/Rust归档双向生成、交叉导入与fixture逐条目比对；release metadata、zh-CN玩家文案门禁及桌面前端200 modules生产构建通过。
- 桌面双实现仍使用Fake Provider，未触达真实付费API、正式用户数据或iOS。

### 结论

- `V02-M8-T04`完成。下一项严格为`V02-M8-T05` Randomness Profiles。

## 2026-08-09 — V02-M8-T05 建立 Randomness Profiles

### 实现

- 新增CONSERVATIVE/BALANCED/HIGH/CUSTOM四档设备级随机性合同，分别解析为0.2、0.7、1.1或0至2的有限自定义temperature；缺省为BALANCED。
- 原生CampaignStore以`app_settings.randomness_profile_v1`持久化非秘密设置，闭集、预设映射和自定义形状验证失败时不覆盖最后有效值；重开数据库后保持设置。
- My页面“生成参数”提供稳健、平衡、高随机与自定义选择、当前实际温度及显式保存状态；非法自定义值不能提交。
- 世界、车卡、酒馆、NPC对话、任务、冒险与结算七条Windows AI路径在请求前读取实际temperature并冻结进请求快照；测试默认源保持离线确定性。
- 记录`DEC-091`并同步数据模型、目标架构和Changelog；随机性不进入存档、不影响本地D20，未实现T06重复抑制、真实Provider/付费API、正式用户数据或iOS。

### 验证

- Randomness Service、My页面与World Service共6项定向测试通过，覆盖四档解析、自定义边界、矛盾快照拒绝、UI保存和请求temperature冻结。
- 原生Randomness 2项测试通过，覆盖默认值、四档保存、重开恢复和非法更新零覆盖。
- 完整80个Vitest文件/452项测试与22项Node测试通过；Rust workspace格式、全target/feature Clippy及86项测试通过，包含Windows纵向E2E。
- `pnpm archive:interop`验证设备级随机性设置不进入TypeScript/Rust归档并完成双向交叉导入；release metadata、zh-CN玩家文案门禁及桌面前端201 modules生产构建通过。

### 结论

- `V02-M8-T05`完成。下一项严格为`V02-M8-T06` Repetition Reduction。

## 2026-08-09 — V02-M8-T06 降低生成内容重复

### 实现

- 新增TypeScript与Rust一致的确定性重复检测器：规范化长句至少12个字母或数字才参与比较，任务结构签名由风险、奖励、回合区间和排序属性组成，NPC原型签名由identity与personality组成。
- `GENERATE_NPCS`、`NPC_REPLY`与`GENERATE_QUEST`分别升级schema/prompt为v4、v3与v2；提示词携带已有NPC原型或最近任务结构，并明确禁止重复长句。
- 酒馆初始化同时检查现有店主和同批NPC原型；任务生成与最近20项任务比较结构；NPC对话与最近同Actor的NPC消息比较生成句段。
- TypeScript Schema、Application/Windows Service与原生SQLite事务前均执行验证，命中后以明确错误失败关闭；原生测试确认NPC、传闻、任务、消息、关系与生成审计均无部分写入。
- Fake Provider根据历史上下文产生可重复测试且彼此不同的离线任务和NPC回复；记录`DEC-092`并同步Changelog与架构文档，未实现T07 Context Budget、真实Provider/付费API、正式用户数据或iOS。

### 验证

- 定向schema、prompt、detector、Windows Service、Application与原生测试通过，覆盖规范化长句、历史NPC回复、任务结构和NPC原型三类命中及零写入路径。
- 完整81个Vitest文件/456项测试与22项Node测试通过；Prettier、ESLint、TypeScript、release metadata和zh-CN玩家文案门禁通过。
- Rust workspace格式、全target/feature Clippy及87项测试通过，包含Windows纵向E2E在模型切换和存档导入后的连续不同回复。
- `pnpm archive:interop`完成TypeScript/Rust归档双向生成、交叉导入与fixture比对；桌面前端202 modules生产构建通过。

### 结论

- `V02-M8-T06`完成。下一项严格为`V02-M8-T07` Context Budget。

## 2026-08-09 — V02-M8-T07 固化 Prompt Context Budget

### 实现

- 复用15类任务现有12,000/16,000/22,000字符预算，新增公共`assertTaskContextBudget`；七条Windows AI生成Service均在Prompt格式化和Provider调用前执行失败关闭。
- 历史型Schema固定窗口上限：NPC消息12、长期记忆9、冒险回合8、世界事件10、结算回合摘要9，并限制相关事实、规则、记忆提取和一致性输入。
- `compressContextHistory`改为真正有损的旧史摘要：超过四项时只保留最早两项和最晚两项样本，标注被压缩条目总数，再附加任务预算允许的最新窗口。
- Windows Adventure Settlement从发送全部回合改为与Application一致的8条最近回合加1条旧史抽样摘要；原生NPC、冒险上下文本来已分别限制12条消息、8条记忆、8个回合、30项事实并继续保持。
- 记录`DEC-093`并同步Changelog与Context/Memory架构文档；未实现T08 Inspector、精确tokenizer、向量检索、真实Provider/付费API、正式用户数据或iOS。

### 验证

- Context Builder、Schema、Application与Windows Settlement定向测试覆盖80条历史压缩、抽样缺失中间条目、最近窗口保留、四类历史数组超限拒绝及12,000字符总预算拒绝。
- 完整81个Vitest文件/458项测试与22项Node测试通过；Prettier、ESLint、TypeScript、release metadata和zh-CN玩家文案门禁通过。
- Rust workspace格式、全target/feature Clippy及87项测试通过，包含Windows纵向E2E；T07未修改SQLite schema或原生存档格式。
- `pnpm archive:interop`完成TypeScript/Rust归档双向生成、交叉导入与fixture比对；桌面前端202 modules生产构建通过。

### 结论

- `V02-M8-T07`完成。下一项严格为`V02-M8-T08` Context Inspector。

## 2026-08-09 — V02-M8-T08 提供隐私遮罩 Context Inspector

### 实现

- ContextManifest条目新增stability，并在AITaskOrchestrator调用Provider前与实际ContextBlock一并复核，防止检查视图与发送块漂移。
- 新增会话级Context Inspector Service；七条Windows AI生成路径在实际请求格式化前记录最近Manifest，不写SQLite或存档。
- Inspector投影包含block、估算token、source、revision、stability、INCLUDED/OMITTED原因、12位hash前缀与HIT/MISS/NOT_APPLICABLE缓存观察。
- secret来源统一遮罩，快照完全不携带block content、完整system prompt、未公开世界真相或凭据；相同上下文二次观察只在当前会话标记HIT。
- “我的/上下文”新增可横向滚动的只读表格、总预算和刷新按钮；空会话显示明确空状态。记录`DEC-094`并同步Changelog与Context/Memory文档，未实现诊断导出、真实Provider/付费API、正式用户数据或iOS。

### 验证

- Inspector Service、Context Assembly/Orchestrator与My页面定向测试通过，覆盖实际请求记录、同内容会话HIT、included/omitted、secret来源遮罩、hash前缀和UI八列展示。
- 完整82个Vitest文件/461项测试与22项Node测试通过；Prettier、ESLint、TypeScript、release metadata和zh-CN玩家文案门禁通过。
- Rust workspace格式、全target/feature Clippy及87项测试通过，包含Windows纵向E2E；Inspector未修改SQLite schema或存档格式。
- `pnpm archive:interop`完成TypeScript/Rust归档双向生成、交叉导入与fixture比对；桌面前端203 modules生产构建通过。

### 结论

- `V02-M8-T08`完成。下一项严格为`V02-M9-T01` Shared Gate。

## 2026-08-09 — V02-M9-T01 完成 Shared Gate

### 实现

- `pnpm check:shared`统一纳入release metadata、zh-CN玩家语言与跨语言存档互操作，并保留既有Prettier、ESLint、TypeScript、Vitest/Node、rustfmt、全target/feature Clippy和Rust workspace测试。
- CI workflow自测新增本地Shared Gate类别锁定，防止release、语言、archive或Rust门禁从本地入口静默漂移。
- 新增`docs/audit/V0_2_SHARED_GATE.md`，记录当前环境、命令、时间、测试统计、门禁映射、边界与原始证据SHA-256；原始UTF-8输出保存在Git忽略的`.local/evidence`。
- 记录`DEC-095`；Shared Gate不冒充Windows或macOS平台专属验收，未接入真实Provider、付费API、正式用户数据或iOS。

### 验证

- 首次结构化运行在23项Node测试阶段失败：新增自测用单行字符串匹配多行Clippy调用；失败证据原样保留，修正测试断言并单独验证3项CI workflow测试后重新执行全门禁。
- 通过记录退出码为0：Prettier、release metadata、zh-CN门禁、ESLint、TypeScript、82个Vitest文件/461项测试及23项Node测试全部通过。
- rustfmt、全workspace/target/feature Clippy及87项Rust测试通过；SQLite迁移/备份/事务、Provider合同、Context、Orchestrator和Security类别均有对应测试覆盖。
- `pnpm archive:interop`完成TypeScript/Rust归档双向生成、交叉导入与fixture比对。

### 结论

- `V02-M9-T01`完成。下一项严格为`V02-M9-T02` Windows Gate。

## 2026-08-11 — V02-M9-T02 完成 Windows Gate

### 实现

- CI新增受限Windows发布门禁：真实Credential Manager合同、WebView2 Runtime/进程、v0.2.0 NSIS、当前用户静默安装、启动存活、静默卸载和应用数据保留。
- 发布命令统一写入UTF-8结构化证据，收集安装器大小与SHA-256并上传artifact；生命周期脚本拒绝既有安装、既有应用数据和非临时Windows CI环境。
- 修复实机暴露的跨平台行尾、Windows测试超时、文件锁错误码、Node 24 pnpm子进程及PowerShell空结果严格模式问题；没有降低或跳过任何门禁。
- 新增`docs/audit/V0_2_WINDOWS_GATE.md`并记录`DEC-096`；未接入真实Provider、付费API、正式用户数据或iOS。

### 验证

- 权威PR CI run `31446196404`在HEAD `43aea70`全绿：Windows/macOS共享质量、Windows发布和macOS构建任务全部成功。
- Windows纵向切片与NSIS构建退出码0；安装器`Ember Tavern_0.2.0_x64-setup.exe`为5,223,248 bytes，SHA-256为`6137ed6c0fb5be27e8e8e490883ada354e74e3b6e6d3cafb42da88e876a95a7d`。
- Credential Manager往返/删除退出码0且无秘密遗留；发现WebView2 Runtime并观测两个新进程；应用版本0.2.0且存活11秒。
- 静默卸载退出码0，HKCU卸载注册与安装目录移除，应用数据哨兵保留；生命周期JSON的`success=true`。

### 结论

- `V02-M9-T02`完成。下一项严格为`V02-M9-T03` macOS Gate。

## 2026-08-11 — V02-M9-T03 完成 macOS Gate

### 实现

- macOS build job新增受限生命周期门禁：验证Keychain、`.app`元数据、系统WebKit链接与新进程、启动存活、实际SQLite落点及PlatformPaths adapter合同。
- 门禁拒绝非临时macOS CI和任何既有应用路径；只有全部确认不存在后才授权清理本次创建的Application Support、Caches、Logs或WebKit精确目录。
- `.app`构建、生命周期、文件清单分别写入UTF-8结构化JSON并上传artifact；新增CI自测锁定所有必需证据入口。
- 新增`docs/audit/V0_2_MACOS_GATE.md`并记录`DEC-097`；未接入真实Provider、付费API、正式用户数据或iOS。

### 验证

- 权威PR CI run `31461140570`在HEAD `3a6e656`的macOS共享质量及build/lifecycle任务成功。
- Keychain往返/读取/删除退出码0且无秘密遗留；`.app`为arm64、bundle ID `com.embertavern.windows`、版本0.2.0。
- 可执行文件链接系统`WebKit.framework`，启动产生2个新WebKit进程并存活19秒；stdout/stderr均为0 bytes。
- SQLite实际创建于`~/Library/Application Support/com.embertavern.windows/ember-tavern.sqlite`，data/cache/log/temp均为绝对路径，macOS PlatformPaths adapter合同通过。
- 生命周期清理仅删除本次创建且预先授权的data/cache/WebKit目录；本机非CI拒绝测试确认清理未获授权且删除列表为空。

### 结论

- `V02-M9-T03`完成。下一项严格为`V02-M9-T04` UI 4-resolution Gate。

## 2026-08-11 — V02-M9-T04 完成四分辨率 UI Gate

### 实现与修复

- 使用headed Google Chrome覆盖存档、世界、车卡、酒馆、NPC、任务、冒险、角色卡、档案、我的、设置和恢复12个核心页面，以及860x600、1180x760、1366x768、1920x1080四个指定视口。
- 每次导航等待页面专用最终就绪选择器，再执行截图前后控制台检查、document/main横向溢出与可见后代裁切测量；48组最终结果均无控制台错误、横向溢出或裁切。
- 修复模型设置标题栏“未知路径”，补充路由标题回归测试；修复纸张主题缺失局部色板导致的低对比度，并以对比度合同锁定正文与弱化文字阈值。
- 核心对话/任务/冒险断点改为计入248px侧栏，“我的”页在最小宽度改为单栏；新增侧栏感知与最小宽度布局回归测试。
- 新增`docs/audit/V0_2_UI_4_RESOLUTION_GATE.md`、48张最终截图、4张修复前截图及52项SHA-256清单，并记录`DEC-098`。
- 视觉数据只来自临时QA工作树中的确定性本地Tauri IPC fixture；fixture未提交，未访问真实Provider、付费API、API Key、正式用户数据或iOS。

### 验证

- 48/48页面与视口组合逐张视觉复核通过；修复后控制台错误0、document/main横向溢出0、裁切后代0。
- `pnpm lint`通过；86个Vitest文件/465项测试与27项Node测试全部通过。
- `pnpm --dir windows-app build`完成TypeScript检查与203 modules生产构建；根包未定义`build`脚本，因此未把不存在的`pnpm build`入口作为门禁。
- 4项QA缺陷全部verified，0项deferred、best-effort或reverted；QA健康分94提升至100。

### 结论

- `V02-M9-T04`完成。下一项严格为`V02-M9-T05` Vertical Flow。

## 2026-08-11 — V02-M9-T05 完成 Vertical Flow

### 实现与修复

- 扩展`windows_e2e::completes_the_windows_release_vertical_slice_on_one_persistent_save`：首次启动先断言无Campaign/设备模型；在同一真实SQLite存档完成世界、车卡、酒馆、NPC、任务、8回合冒险、本地D20与结算。
- 流程在已持久化NPC请求后模拟中断，重开得到`RECOVERY_REQUIRED`与一个pending；恢复原子回到最近完整`TAVERN`、取消pending并继续对话，再完成导出、删除、导入、重开与继续。
- 使用唯一bundle ID `com.embertavern.flowqa`的打包macOS `.app`和隔离Application Support数据完成真实WKWebView验证，覆盖原生导出/导入对话框；没有读取或修改正式应用数据。
- 实机发现`ISSUE-005`：WKWebView未呈现`window.confirm`，首次点击会直接删除隔离QA存档。归档经真实导入路径恢复后，将删除改为应用内警告、取消和最终确认两个阶段，并新增回归测试；修复后取消操作保留Campaign且收起确认。
- 新增`docs/audit/V0_2_VERTICAL_FLOW_GATE.md`、18张原生UI PNG和SHA-256清单，记录`DEC-099`并关闭SR2-010。

### 验证

- `pnpm test:windows-e2e`通过；单一测试覆盖真实SQLite、恢复、导出/删除/导入和继续。
- 删除确认定向Vitest 13/13通过；`pnpm lint`与`pnpm --dir windows-app build`通过，生产构建为203 modules。
- 18张截图逐张视觉复核及SHA-256复算通过；原生应用确认取消后Campaign仍存在，最终危险确认未再次执行。
- 全过程仅使用临时/隔离数据和Fake Provider，未使用真实Provider、付费API、API Key、正式用户数据或iOS。

### 结论

- `V02-M9-T05`完成，M9全部关闭。下一项严格为`V02-M10-T01` Windows v0.2 Build。

## 2026-08-11 — V02-M10-T01 完成 Windows v0.2 Build

### 构建与落盘

- 权威PR CI run `31503183202`在精确HEAD `20ae2f536c1f70f16878bbfb8699bda6df339775`通过Windows/macOS共享质量门禁和两端平台发布job。
- Windows x64 runner先通过单一SQLite纵向E2E，再执行`pnpm --dir windows-app tauri build --bundles nsis`；构建命令退出码0。
- 当前用户NSIS `Ember Tavern_0.2.0_x64-setup.exe`已下载到Git忽略的`release/v0.2/`，结构化CI证据保存在其`evidence/`子目录。
- 安装器为5,220,387 bytes，SHA-256为`1674ffa788316c196ed11147090d281ec68e2ee4b4865a7319c4efe53dde10ca`；CI文件清单、生命周期JSON和下载后复算三方一致。

### 验证与边界

- Credential Manager测试凭据往返/删除通过且无秘密遗留；检测到WebView2 Runtime并观察到新WebView2进程。
- 0.2.0当前用户静默安装、安装后启动存活11秒和静默卸载全部退出0；卸载注册与安装目录移除，应用数据哨兵保留。
- 当前产物为未签名内部发布候选，不冒充已签名公开发行版；未使用真实Provider、付费API、API Key、正式用户数据或iOS。
- 新增`docs/audit/V0_2_WINDOWS_BUILD.md`固定来源HEAD、run、大小、哈希和生命周期结论。

### 结论

- `V02-M10-T01`完成。下一项严格为`V02-M10-T02` Artifact Hash / Manifest。

## 2026-08-11 — V02-M10-T02 完成 Artifact Hash / Manifest

### 输出

- 在Git忽略的`release/v0.2/`生成权威清单要求的五个精确基名文件：`SHA256SUMS`、`ARTIFACT_MANIFEST`、`BUILD_INFO`、`RELEASE_NOTES`和`KNOWN_LIMITATIONS`。
- `SHA256SUMS`只覆盖不可变安装器，避免自引用；复算结果为`1674ffa788316c196ed11147090d281ec68e2ee4b4865a7319c4efe53dde10ca`。
- JSON manifest记录安装器名称、版本、平台、架构、字节数、SHA-256、source HEAD、CI run和未签名状态；BUILD_INFO记录runner、工具链、构建命令/时间/退出码及Windows生命周期结论。
- 发布说明汇总v0.2纵向能力、数据/凭据边界和双平台门禁；已知限制明确未签名、WebView2联网、Fake Provider、无自动更新/云同步/iOS及卸载保留数据。
- 新增`docs/audit/V0_2_ARTIFACT_MANIFEST.md`固定五份文件本身的SHA-256、格式和验证结果。

### 验证与边界

- `shasum -a 256 -c SHA256SUMS`通过；安装器大小/哈希与CI文件清单、生命周期JSON、ARTIFACT_MANIFEST和本机复算一致。
- `jq`验证两个JSON结构、精确source HEAD/run、build exit 0、应用数据保留和unsigned边界。
- release根目录恰好包含安装器与五个要求文件；秘密样式扫描未发现API Key、bearer token或秘密值。
- 本任务未签名、未发布或上传本地release目录，未使用真实Provider、付费API、正式用户数据或iOS。

### 结论

- `V02-M10-T02`完成。下一项严格为`V02-M10-T03` macOS Dev Build Record。

## 2026-08-11 — V02-M10-T03 完成 macOS Dev Build Record

### 构建记录

- 下载权威PR CI run `31503183202`的`ember-tavern-macos-build-evidence`到Git忽略的`.local/m10-t03/run-31503183202/`，来源为最终产品代码HEAD `20ae2f536c1f70f16878bbfb8699bda6df339775`。
- runner为GitHub托管`macos-latest`、darwin arm64；`pnpm --dir windows-app tauri build --bundles app`退出0，生成`Ember Tavern.app` 0.2.0，bundle ID `com.embertavern.windows`。
- 主可执行文件为21,614,912 bytes，SHA-256 `d7c5e45776f70fca26a003f36a56bae4651590c644f75ffdd7ec40bf09210dc5`；Info.plist和icon哈希也完成CI/下载后本机双重核对。

### 验证与边界

- Keychain往返/删除退出0且无秘密遗留；可执行文件使用系统WebKit，启动后观测两个新WebKit进程并存活17秒，stdout/stderr均为0 bytes。
- PlatformPaths返回绝对data/cache/log/temp根，真实SQLite创建于macOS Application Support路径；adapter合同通过，临时runner路径仅在精确授权后清理。
- 下载后的lifecycle JSON通过`jq`合同复核，Mach-O确认为thin arm64；`codesign`只显示ad-hoc linker signature，无TeamIdentifier、Developer ID、公证或分发签名。
- 新增`docs/audit/V0_2_MACOS_DEV_BUILD.md`；该记录不作为正式macOS发布，未使用真实Provider、付费API、API Key、正式用户数据或iOS。

### 结论

- `V02-M10-T03`完成。下一项严格为`V02-M10-T04` Review Package。

## 2026-08-11 — V02-M10-T04 完成 ChatGPT Review Package

### 组包

- 生成`review_v0.2_to_chatgpt_20260811_2319.zip`，包根`00_REVIEW_GUIDE.md`说明审查顺序、证据边界、来源HEAD和分发限制。
- `competitor-research/`包含三个指定仓库拆解、基线、矩阵、Gap Analysis、借鉴计划和拒绝项；`architecture/`包含Architecture Gate、目标架构、AI pipeline、Context/Memory和状态/事件文档。
- `final-tasks/`包含完成态权威任务；`audit-fixes/`包含第一轮、v0.1第二轮、共享/平台/UI/纵向/发布审计；`screenshots/`包含52张四分辨率/修复证据和18张原生纵向流程证据。
- `tests/`包含94个跟踪测试文件清单、当前本地/CI结果摘要及结构化Windows/macOS平台JSON；`git/`只包含HEAD、状态、日志、refs/remotes和摘要文本。
- `source/`使用最终提交HEAD的`git archive`生成源码ZIP；`installer/`包含Windows x64 NSIS和M10-T02五个文件；`risks/`包含已知限制、延期范围和发布边界。

### 安全与验证

- 排除`.git`对象、`.local`、third-party工作树、`node_modules`、target/cache、数据库/备份、`.env`、系统凭据、正式用户数据和真实API Key；预存用户`.gitignore`修改未暂存、未进入源码归档。
- 组包前复核安装器、UI/纵向截图SHA清单和JSON证据；生成覆盖所有包内文件的SHA-256清单（清单自身除外）。
- ZIP创建后解压到新的临时目录，逐项执行SHA-256复算并核对11类必需目录、源码HEAD、安装器和截图数量。
- 新增`docs/audit/V0_2_REVIEW_PACKAGE.md`；包仅供下一轮ChatGPT审查，不构成Windows公开发行或macOS分发授权。

### 结论

- `V02-M10-T04`完成；v0.2 M0–M10权威任务全部完成。iOS及其余默认延期范围不自动启动。
