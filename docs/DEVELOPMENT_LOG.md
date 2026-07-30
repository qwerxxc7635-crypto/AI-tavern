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
