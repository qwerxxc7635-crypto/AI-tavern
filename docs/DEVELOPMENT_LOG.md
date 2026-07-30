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
