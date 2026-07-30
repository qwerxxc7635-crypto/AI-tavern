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
