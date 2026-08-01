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
