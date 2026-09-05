# Ember Tavern 开发日志

本文件按任务记录实际变更、验证证据、限制和后续边界。每次完成任务后追加记录，不覆盖历史。

## 2026-08-13 — 修复模型设置保存 `PROBE_STALE`

### 根因与修复

- Native Provider probe 使用 RFC3339 输出微秒时间戳，并基于该原始能力数据生成 probe fingerprint；前端 `Date.toISOString()` 将时间截断为三位毫秒，保存时 Native receipt 逐值校验因此稳定返回 `PROBE_STALE`。
- 在 Native probe 生成能力数据和 fingerprint 前统一产生三位毫秒 UTC 时间戳，保持前端 canonical ISO 合同、receipt 安全门禁与后续统一 AI 编排三者一致。
- 未放宽 receipt 对 Provider、端点、模型、能力内容与 fingerprint 的校验，也未改动 API Key 生命周期或联网边界。

### 回归验证

- 新增 Native 回归测试，以微秒输入锁定 probe 时间戳为 `2026-08-12T10:01:28.700Z`。
- 保留前端微秒 RFC3339 防御性规范化测试，覆盖 Native/前端时间精度边界。
- `pnpm check:shared` 全量通过：Prettier、release metadata、zh-CN、ESLint、TypeScript、87个Vitest文件/477项、Node 27项、Rust workspace 95项执行通过/0失败/1项真实API测试按设计忽略，以及TypeScript/Rust存档互操作全部通过。
- 用户既有 `.gitignore` 修改保持未暂存，不纳入本次提交。

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
- 首次完成态推送后，Windows CI在80回合SQLite结算集成测试上耗时33.6秒并触发30秒全局超时；macOS及此前权威Windows run均通过，失败不是业务断言。为该单一重型集成用例增加Windows专属60秒余量、macOS保持5秒，未删除操作、断言或测试类别；修复后重新生成源码归档、全文件清单和外层ZIP。
- 新增`docs/audit/V0_2_REVIEW_PACKAGE.md`；包仅供下一轮ChatGPT审查，不构成Windows公开发行或macOS分发授权。

### 结论

- `V02-M10-T04`完成；v0.2 M0–M10权威任务全部完成。iOS及其余默认延期范围不自动启动。

## 2026-08-12 — v0.2 First-Pass Release Audit

### 基线与范围

- 审查基线为分支`codex/v0.2-windows-gate`、commit `451a09d9d7c55f342ca63dfef20a28d56d0294e5`；开始时只有用户已有`.gitignore`修改，本轮全程保留且未覆盖。
- 环境为macOS 14.7.6 arm64、Node 26.7.0、pnpm 11.9.0、Rust/Cargo 1.97.1；原生可玩性使用隔离数据根，不读取正式应用数据。
- 按spec、任务、决策、README、实际调用链、自动测试和release `.app`重新建立验收矩阵，不采信单纯DONE标记。

### 发现

- `AUDIT-001`（P1，OPEN）：模型设置、默认/备用与凭据能够保存，但不会进入世界、角色、酒馆、NPC、任务、冒险或结算调用；production singleton仍固定`FakeAIProvider`与`ember-fake-v1`。
- `AUDIT-002`（P1，OPEN）：共享`AITurnOrchestrator`、路由、pending request、修复和故障切换虽有测试，桌面游戏服务实际绕过该编排层直接调用Provider。
- `AUDIT-003`（P2，FIXED）：打包app的版本读取缺少`core:app:allow-version`，原生页面显示“不可用”。
- `AUDIT-004`（P2，FIXED）：WKWebView没有呈现归档用`window.confirm`，点击后直接归档；覆盖导入和删除凭据存在同类风险。
- `PLAY-001`（P1，OPEN）：Fake冒险按回合数给固定输出，不同自由行动大多得到相同场景，玩家选择缺乏实际意义。
- `PLAY-002`（P2，FIXED）：Fake NPC第二轮后固定同一句，第三轮被重复检测拒绝。
- `PLAY-003`（P2，FIXED）：关系trust到达5后Fake仍提出+1，native事务拒绝后续对话。
- `PLAY-004`（P2，OPEN）：默认世界、NPC、任务、剧情与档案内容大量固定英文且模板重复。

### 修复与修改文件

- 在`windows-app/src-tauri/capabilities/default.json`增加最小app version和dialog message权限，并在`tauri-config.test.ts`锁定精确能力集合。
- 新增`windows-app/src/confirmation-service.ts`，Tauri环境使用原生warning confirm；归档、覆盖导入和删除系统凭据不再依赖WKWebView `window.confirm`。
- 调整`packages/ai-core/src/fake-ai-provider.ts`：长对话回复包含当前玩家输入，trust达到5时不提出越界增量。
- 扩展`windows-app/src/npc-dialogue-service.test.ts`为12轮连续对话回归，并让测试网关遵守关系钳制和最近12条上下文合同。
- 更新`README.md`为v0.2桌面现状与真实Provider未接线限制；新增`docs/V0.2_FIRST_AUDIT_REPORT.md`和`docs/V0.2_PLAYABILITY_REPORT.md`。

### 自动验证

- 最终`pnpm check:shared`通过：格式、release metadata、zh-CN、ESLint、TypeScript、86个Vitest文件/465项、Node 27项、Rust workspace 88项、archive interoperability全部通过。
- `pnpm --dir windows-app tauri build --bundles app`通过，Vite 204 modules，release `.app`生成成功。
- 原生确认相关3文件/19项定向测试及12轮NPC回归通过。
- npm官方registry production audit返回`No known vulnerabilities found`；默认npmmirror无advisory endpoint。环境未安装`cargo-audit`，RustSec检查标记BLOCKED。

### 可玩性验证

- 完成新世界、AI候选车卡、酒馆、Ilyra 10轮对话、Nessa 3轮对话、任务接受、8回合冒险、3次D20、结算、档案、退出、重开与继续；合计21轮AI交互。
- 三次D20分别为7+2=9/11失败、2+2=4/11失败、15+2=17/11成功，档案与当时UI一致。
- 修复后长对话不再失败，trust稳定在5；原生归档sheet取消不写入、确认后才归档；版本显示0.2.0。
- Playability Verdict为`TECHNICALLY PLAYABLE`，综合5/10。Fake纵向路径完整，但不代表真实AI可玩性。

### 未解决与BLOCKED

- P1真实Provider/统一编排接线和P1选择意义问题未解决，因此总体Verdict为`NOT READY`。
- 真实DeepSeek cache hit/miss、真实API错误/延迟/随机性、Windows当前轮实机生命周期、Rust advisory audit及原生手工跳过D20动画为BLOCKED。
- 第二轮优先复核真实模型端到端调用、Windows实机、DeepSeek命中、20轮真实对话/冒险一致性、错误恢复和`.emtavern`覆盖导入。

## 2026-08-12 — v0.2 第一轮审查整改完成

### P1 架构整改

- 新增桌面统一`DesktopAIOrchestrator`与Tauri native adapter；世界、车卡、酒馆、NPC、任务、冒险和结算的production singleton全部迁移到同一模型选择、Prompt、结构校验、修复、错误和缓存路径。
- 原生`ai_generate`按SQLite中精确profile解析Provider、模型、端点、能力与系统凭据引用；前后端双向验证profile/provider/preset/model身份，拒绝模型漂移。
- 默认与显式备用配置以设备模型设置为唯一真源；只有网络、限流、超时和服务不可用允许fallback，认证、额度和非法输出不会静默切换。
- DeepSeek缓存遥测以best-effort写入，失败可观察但不覆盖成功生成；指标保持200条上限且不含Prompt、上下文、请求ID或凭据。

### 业务合同与可玩性整改

- 将世界引用、NPC 3人组成与传闻来源、任务8～12回合、冒险checkRequest、FACT patch、D20结果patch和nullable relationship proposal等native业务边界前移到共享schema与Prompt。
- 统一层允许同一已选模型进行一次结构修复；修复仍失败时拒绝提交，不降低校验标准。
- Fake冒险测试adapter按ACTION、DIALOGUE、OBSERVE和玩家文本返回不同语义结果；基础生成规则要求自然简体中文。
- 修复Rust微秒RFC3339时间戳进入前端ISO合同的问题，以及从RESOLVING恢复并成功结算后UI仍保持提交中状态的问题。
- 保留并扩展第一轮版本权限、Tauri原生危险确认、NPC重复和关系上限修复。

### 真实DeepSeek验证

- 使用仅限本轮的授权凭据，在隔离数据根完成设置探测、保存、世界、角色、酒馆/NPC、两轮对话、两项任务、冒险计划、自由行动和D20结果叙事；共形成12条真实生成记录，模型均为`deepseek-v4-flash`。
- 自由输入中的守塔灯、潮汐罗盘、井壁潮痕与“下井前先观察”均改变结果并触发知识检定；NPC第二轮引用Lin、失踪守塔人和罗盘。
- 真实缓存同一世界前缀第一次hit 0/miss 1072，第二次hit 1024/miss 48，命中率0.9552；独立原生真实测试第二次hit 128/miss 114。
- 退出、重开、继续后默认模型、NPC历史/关系、pending action和locked D20均从SQLite恢复；D20手工跳过动画复用20+2=22/DC11的同一硬结果。

### 最终质量门

- 格式、release metadata、zh-CN、ESLint和TypeScript通过。
- Vitest 87文件/477项、Node 27项通过。
- `cargo fmt`、workspace all-target/all-feature Clippy通过；Rust workspace 94项执行通过、0失败，默认忽略1项真实API测试（本轮已独立真实执行通过）。
- TypeScript/Rust存档互操作通过；`pnpm --dir windows-app tauri build --bundles app`生成正式macOS release app。
- Windows实机生命周期和RustSec advisory因缺少对应环境/工具保持BLOCKED，不宣称已验证。

### 结论

- P0=0、P1=0、P2=0；第一轮整改结论更新为`READY FOR SECOND AUDIT`。
- 用户既有`.gitignore`修改全程保留，整改提交不会纳入该文件；不merge、不push。

## 2026-08-13 — M0-T01 V0.3 规格冻结

### Repo 与 Git 基线

- 仓库根目录为`/Users/mac/Desktop/item/4D`；起始分支`chatgpt/v0.2-second-audit-fixes`，起始commit `0af183391a5d83406874db326ed02b175ba24e6e`。
- 开始时唯一未提交修改为用户已有`.gitignore`中的`.gstack/`；本任务不覆盖、不暂存该修改。
- 完整阅读仓库规则、README、历史规格/任务、V0.2两轮审计与可玩性报告，并核对现有workspace、AI、domain、persistence、native和Windows页面结构。

### 规格与任务

- 新增`docs/V0.3_SPEC.md`，冻结“AI creates. Rules decide. SQLite remembers.”、不可刷新硬事实、自由玩家行动、Windows桌面优先、V0.3范围/非目标、分层架构和最终验收。
- 将`docs/TASKS.md`切换为V0.3 M0–M12权威顺序；每个Task均明确Status、Dependency、Deliverable、Acceptance、Tests和Do Not。
- 统一原提示中重复的M5编号：Character Creation与Trait共同属于V0.3 M5；后续里程碑顺延并保持产品依赖顺序。
- README增加V0.3入口，同时保留v0.1规格和v0.2历史任务链接。

### 架构决定

- 新增`DEC-100`：V0.3增量演进现有V0.2架构，不建立第二套Provider、事实库或持久化链；`docs/TASKS.md`成为V0.3权威执行顺序。
- 当前任务只冻结规格和任务，未修改产品代码、数据库或真实Provider配置，未开始M0-T02。

### 验证

- Prettier定向写入及检查通过：README、V0.3 Spec、Tasks、Decisions和Development Log全部符合格式。
- V0.3任务结构检查通过：59个Task，每项均包含Status、Dependency、Deliverable、Acceptance、Tests和Do Not六个字段。
- 文档目标检查通过；V0.3入口、历史v0.1规格、v0.2任务和两份v0.2审计/可玩性报告均存在。
- 首次组合shell检查因使用变量名`path`覆盖zsh特殊`$path`数组，导致末尾两个`git`命令未被找到；文档检查本身已通过，Git检查随后以独立命令重跑，不修改系统或仓库配置。

## 2026-08-13 — M0-T02 SillyTavern 功能审计

### 研究

- 核对官方SillyTavern仓库、1.18.0 Release和官方文档，覆盖Character Card、Persona、World Info/Lorebook、Prompt Manager、Preset、Chat、Group Chat、Context、Memory、Branch/Checkpoint、Model Settings、Import/Export、Extension、Roleplay UX和生成交互。
- 定位本机`SillyTavern-1.13.3`整合包；只读取package版本、AGPL-3.0 License、README标题和内置扩展目录，未读取兑换码、secret、用户聊天或其他数据，也未启动或联网该包。
- 官方2026年安全公告将1.17.0之前版本视为不安全；因此本机包仅作为历史结构样本，不作为可运行参考。

### 输出与决定

- 新增`docs/V0.3_ST_FEATURE_MATRIX.md`，逐项标记Ember已有、缺失、V0.3采用、不采用和后续考虑，并附官方直接来源。
- 新增`DEC-101`：采用SillyTavern的角色/Persona/Lore/Prompt/Context/Memory/多角色和生成UX控制力；拒绝正式游戏Swipe、静默历史编辑和开放第三方执行面。
- 本任务只修改审计与项目文档，未修改产品代码、数据库、Provider配置或用户本机整合包，未开始M0-T03。

### 验证

- Prettier定向写入和检查通过。首次提交前的tracked diff检查通过；文件暂存后检查发现新矩阵末尾多一个空行，随即删除、复核并修订同一任务commit。
- 矩阵结构检查通过：26行表格数据，Character、Persona、World Info、Prompt、Preset、Chat、Group Chat、Context、Memory、Branch、Model、Import/Export、Extension和生成UX等必需类别及五种Ember分类均存在。
- 文档包含16处官方/直接参考链接；秘密样式扫描通过，未发现Key或Bearer token样式内容。
- 首次验证命令因shell正则内引号组合导致zsh在执行前报parse error；未产生写入。随后改用Node执行同等秘密与结构检查并完整通过。
- Git状态复核只包含本任务四份文档以及用户原有`.gitignore`修改；后者不纳入暂存和提交。

## 2026-08-13 — M0-T03 GitHub Reference Audit

### 研究

- 使用官方GitHub仓库、官方架构/产品文档和仓库License研究12个项目：SillyTavern、RisuAI、Tauri、Actual Budget、SQLite/rusqlite、TypeChat、LangGraph.js、XState、Evennia、ink、Bevy和Radix Primitives。
- 覆盖AI Roleplay、Character/Lore/Prompt、Tauri桌面边界、offline-first SQLite、Structured Output、workflow/state machine、持久文字世界、Quest/narrative graph、数据驱动实体和Design System/a11y。
- 对每个项目记录GitHub地址、License、模块、优点、缺点、Ember适用性、采用判断和拒绝原因；未只研究单一项目或以Star数量作为采用依据。

### 输出与决定

- 新增`docs/V0.3_REFERENCE_AUDIT.md`及子系统选择矩阵、License/复制策略和最终决定。
- 新增`DEC-102`：V0.3不做框架大迁移；选择性吸收TypeChat、LangGraph/XState、Evennia/Bevy、ink、Actual/SQLite和Radix思想，任何实际依赖须在具体任务单独证明。
- 明确LangGraph、Bevy、Evennia和ink不作为V0.3 runtime dependency；XState/Radix只在具体复杂度和测试收益证据成立时逐项评估。
- 本任务只修改文档，未复制第三方源码/资产，未修改产品代码、依赖、数据库或Provider，未开始M1-T01。

### 验证

- Prettier定向写入与检查通过。首次暂存检查发现新审计文档末尾多一个空行，删除后重新暂存复核；未降低检查标准。
- 参考审计结构检查通过：12个项目，每个项目均包含GitHub、License、研究模块、优点、缺点、适用性、采用判断和不采用原因八个字段。
- 文档包含15处官方仓库/文档链接；秘密样式扫描通过。
- Git状态复核只包含本任务四份文档和用户原有`.gitignore`修改；后者不纳入暂存和提交。

## 2026-08-13 — M1-T01 Credential Lifecycle

### 根因与修复

- 审计设置页、Tauri命令、SQLite Provider配置、操作系统安全存储和启动恢复链，确认正式秘密从未以明文写入React状态真源或SQLite。
- 定位延迟清理竞态：旧数据库、备份恢复或中断流程可能留下一个后来又成为活动Provider引用的清理项；原启动重试未复核活动所有权，会删除仍在使用的安全存储秘密。
- 在native bridge增加事务化活动引用检查。清理重试发现`provider_configs`仍引用目标时，只丢弃过期队列项；无活动引用时才执行原有安全存储删除。
- 新增`DEC-103`，固定“SQLite活动引用优先于清理队列”的凭据所有权规则；未新增Provider、未读取正式用户Key，也未调用真实模型API。

### 生命周期回归

- 新增原生端到端测试，使用运行时生成并存入操作系统安全存储的临时秘密和本机mock OpenAI-compatible服务。
- 同一已保存Provider依次执行世界生成、角色背景、NPC生成、NPC回复、任务生成、冒险计划、冒险回合、D20结果和冒险总结九类请求；mock服务逐次验证Bearer凭据存在。
- 测试在流程中注入过期清理项，并在冒险前及完整流程后两次关闭和重开SQLite；每一步均验证默认模型引用、安全存储秘密和生成结果仍可用。测试结束显式删除临时秘密。
- 现有替换、保留、清除、缺失、回滚恢复、秘密扫描和平台安全存储合同测试继续通过。

### 验证

- 定向测试`cargo test -p ember-tavern-windows credential_survives_the_full_game_generation_chain_cleanup_and_reopen -- --nocapture`通过（1项）。首次误用native bridge package过滤同名测试，结果为0项执行；发现后立即改用测试实际所属package重跑，不将空执行视为通过。
- `cargo fmt --all -- --check`、workspace全target/all-feature Clippy（`-D warnings`）和`cargo test --workspace`通过；Rust workspace执行96项、0失败，另有1项需显式真实DeepSeek凭据的测试保持默认忽略。
- `pnpm check:shared`通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 87文件/477项、Node 27项；完整Rust工作区和TypeScript/Rust存档互操作均通过。
- 用户已有`.gitignore`修改保持未暂存；本任务只提交凭据修复、回归测试和三份项目文档，不merge、不push。

## 2026-08-13 — M1-T02 Unified Navigation

### 导航合同

- 新增单一`navigation.ts`，集中定义桌面路径、规范查询参数编码、Campaign父级链接、可选Campaign设备页链接，以及Campaign状态到继续/恢复页面的唯一映射。
- 修复侧栏复制完整查询字符串的问题：跨栏目只保留合法`campaignId`，不再把`npcId`或`questId`泄漏到无关页面。
- 将世界、角色、酒馆、NPC、任务、冒险、结算档案、恢复、我的、模型设置与AI错误入口迁移到统一构造器；层级页返回链接不再丢失Campaign上下文。
- `SETTLEMENT`与`ADVENTURE`统一恢复到冒险页面；失败、等待模型和需恢复状态统一进入恢复页，避免存档首页与恢复页维护不同映射。

### 深链、返回与错误边界

- 在React Router层增加必要上下文边界。世界、角色创建、恢复和五个Campaign主栏目要求唯一合法`campaignId`；NPC对话额外要求唯一合法`npcId`。
- 缺失、重复、首尾空白、控制字符或超过256字符的参数在业务页面加载前被拒绝，显示不修改事实的安全错误页并可返回存档首页；实体是否存在仍由SQLite服务校验。
- AppShell增加“当前位置”面包屑：NPC返回酒馆、冒险返回任务、模型设置返回我的；链接保留Campaign且不依赖历史栈。HashRouter历史和系统返回行为保持由React Router管理。
- 新增13项纯导航合同测试，并扩展AppRoutes/AppShell测试，覆盖六栏目、实体参数隔离、缺失/重复/非法深链、Campaign状态恢复、面包屑跳转和上下文保持。

### 验证

- 定向TypeScript与导航测试采用红绿修复：首次编译发现三个消息组件引用页面局部`campaignId`及exact optional property类型问题；改为从统一查询合同生成安全父级后通过。首次UI测试发现重复文本选择器及非法参数下AppShell提前构造链接，收紧查询范围并让Shell仅使用已验证Campaign后通过。
- `pnpm exec vitest run`通过：88文件/496项；`pnpm --dir windows-app build`通过，Vite production构建207个模块。
- `pnpm check:shared`首次在ESLint阶段发现控制字符正则违反`no-control-regex`和一个迁移后未使用import；改为code point校验并删除遗留import后从头重跑通过。
- 最终统一门禁通过Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript、Vitest 88文件/496项、Node 27项、完整Rust workspace（96项执行、0失败、1项真实API测试默认忽略）及TypeScript/Rust存档互操作。
- 审计硬编码路径时，首次`rg`命令因zsh将未引用模式中的反引号与通配符解释为命令/文件匹配而在读取前失败；改用单引号模式重跑通过，未产生文件写入。
- 用户已有`.gitignore`修改保持未暂存；本任务不修改SQLite、Provider或真实模型配置，不merge、不push。

## 2026-08-13 — M1-T03 Error Architecture

### 六类合同与跨语言映射

- 在AI core新增稳定`ApplicationError`合同，产品错误严格投影为Provider、Generation、Validation、Persistence、Rule和Network六类，同时保留原有细粒度code与AI内部十类诊断。
- 合同统一携带`retryable`、`fallbackEligible`、允许actions和Toast/Error State surface；构造器拒绝不可重试fallback，以及Validation/Persistence/Rule等非Provider/Network fallback伪造。
- 新增六类代表性JSON fixture；TypeScript分类测试与Rust Tauri测试共同读取，逐项验证kind、retry、fallback、surface和actions。
- Rust `CommandError`继续提供安全中文message和原code，同时序列化六类合同字段；未将原始Provider响应、秘密或内部异常文本暴露给UI。

### 编排与UI策略

- Desktop AI fallback改为读取统一`fallbackEligible`，不再维护独立code白名单；新增回归证明网络错误仍使用已保存备用模型，而认证、额度、Validation、Rule和Persistence均只调用主模型一次并原样失败。
- `AITaskExecutionError`保留operation/request和内部category，同时增加稳定kind、fallback资格和actions投影。
- AI错误组件现在按六类显示安全、具体的玩家文案与错误code，并只在合同和回调同时允许时展示Retry、Cancel、显式备用或Dismiss；认证/额度/模型问题提供模型设置入口。
- Toast与持久Error State使用明确data contract和轻量视觉区分；Rule文案明确不能靠更换模型绕过，Validation文案明确技术重试不改变锁定硬结果。

### 验证

- 定向TypeScript测试通过：Application Error 11项、AI Task Orchestrator 8项、Desktop Orchestrator 11项、Error Notice 14项；Rust跨语言策略定向测试1项通过。
- `pnpm check:shared`一次完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 89文件/518项、Node 27项；Rust workspace执行97项、0失败，另有1项真实API测试默认忽略；TypeScript/Rust存档互操作通过。
- 完整门禁同时覆盖pending请求重试幂等、事务回滚、无部分事实写入、D20硬结果和恢复用例；未删除或降低既有校验。
- `pnpm --dir windows-app build`通过，Vite production构建208个模块。
- 用户已有`.gitignore`修改保持未暂存；本任务不调用真实模型、不修改SQLite schema、不merge、不push。

## 2026-08-13 — M1-T04 Performance Baseline

### 指标合同与工具

- 新增内容无关的性能指标schema，覆盖world、NPC、quest、action和D20的总延迟、队列等待、可空token/cache usage、重试与安全错误码，并限制字段、样本数、时间和计数上界。
- 新增可重复CLI，要求显式指定新的JSON输出路径并拒绝覆盖；记录当前commit、运行环境、迭代次数及Fake/Real证据身份，不默认加入仓库或应用遥测。
- Fake Provider没有usage数据时保持`null`，不伪造0；序列化证据扫描确认不包含Prompt、messages、玩家全文、request ID、凭据引用或秘密字段。
- 新增`DEC-106`，固定内容无关指标、unknown传播、Fake/Real隔离与受控场景标记规则；未读取正式API Key或调用真实模型。

### 基线证据

- 正式Fake基线在macOS arm64、Node.js v26.7.0执行，每类10次、共50个样本；五类任务均产生P50/P95总延迟和队列等待汇总。
- 首个quest样本通过标准`TIMEOUT`错误路径形成受控终态失败；首个action样本通过同类可重试错误后实际调用Fake Provider成功。报告分别记录一个失败与一次重试，不将其表述为自然故障率。
- 独立使用每类3次再次运行，共15个样本，报告身份、五类汇总、受控失败和受控重试结构一致，证明工具可重复执行。
- 新增`docs/V0.3_PERFORMANCE_BASELINE.md`，记录证据身份、方法、精确结果、复现命令、限制和M12比较规则。

### 验证

- 首次执行CLI时，runner位于Vitest默认排除的`scripts/`目录，命令明确失败且没有生成报告；将runner迁入`packages/ai-core/src`并保留CLI入口后重跑通过，未把空执行视为成功。
- 定向runner执行通过：10次/任务为1项测试、50个样本；3次/任务重复运行为1项测试、15个样本。两份报告都由同一validator重算汇总并通过隐私扫描。
- 指标单元测试覆盖schema、未知字段/隐私、失败一致性、上下界、nearest-rank汇总、unknown usage和报告身份/一致性。
- 首次完整门禁在ESLint阶段发现测试中的非空断言及Node脚本直接使用`console`；改为显式输出路径校验和`process.stdout`后从头重跑，不跳过规则。
- `pnpm check:shared`完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 90文件/528项通过，另有1项只在CLI环境运行的runner按设计跳过；Node 27项通过；Rust workspace执行97项、0失败，另有1项真实API测试默认忽略；TypeScript/Rust存档互操作通过。
- `pnpm --dir windows-app build`通过，Vite production构建209个模块。本任务没有以优化或删除校验改变基线结果。
- 用户已有`.gitignore`修改保持未暂存；本任务不优化运行路径、不修改SQLite schema、不merge、不push。

## 2026-08-13 — M2-T01 Design Tokens

### Token架构与渐进迁移

- 新增正式三层CSS token：Primitive集中color/type/spacing/radius/shadow/motion/layer原值，Semantic表达主题用途，Component只消费Semantic；单一文件在`theme.css`前加载。
- 深色Ember为默认Semantic映射；NPC对话、任务板和冒险在自身根节点切换浅色Paper映射。旧`--ink`、`--muted`、`--panel`等变量暂时作为Semantic别名，避免全量重写。
- 补齐此前已使用但未正式定义的display/body字体、muted文本与Ember强调别名；应用body、sidebar、navigation、titlebar、My核心卡片和三个Paper页背景/主面板完成迁移。
- `theme.css`原始颜色从92处降至43处，减少49处（约53%）；其余旧页面留待后续逐页迁移，不引入CSS框架、主题状态库或运行时JavaScript。
- 新增`DEC-107`与`docs/V0.3_DESIGN_TOKENS.md`，记录三层所有权、WCAG、motion、layer、迁移范围和后续规则。设计系统技能的三层架构用于约束实现，未采用其无关的slide流程。

### 自动合同

- 新增静态测试验证三层顺序、七类必需token、Semantic/Component无原始颜色、Component不直连Primitive、全部custom property均有定义，以及核心选择器不再写raw颜色。
- 深色与Paper主题共8组文本/强调/焦点配色达到WCAG 2.2适用的7:1、4.5:1或3:1阈值；Paper主题仅作用于NPC对话、任务和冒险页面根节点。
- reduced-motion合同在Semantic层把界面时长降为1ms，并验证导航和D20显式禁用动画；不会跳过规则、持久化或业务timeout。
- 四分辨率静态smoke覆盖860×600、1180×760、1366×768和1920×1080，以及760px紧凑sidebar和已有页面堆叠断点。

### 浏览器证据

- `playwright-cli`技能要求的CLI未安装；未修改全局npm环境，改用已安装的应用内Browser控制本地Vite页面，并在结束时恢复视口、关闭测试页和停止服务器。
- 四视口实际渲染均无document/body横向溢出；workspace宽度依次为612、932、1118和1672px，sidebar固定248px，navigation计算层级为10。
- 深色canvas、正文、焦点和半透明卡片均解析到预期token；应用壳、导航、标题栏、My页卡片和错误状态可见，浏览器控制台0项warning/error。

### 验证

- 定向token、对比度和既有布局测试通过：5文件/22项。
- `pnpm check:shared`完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 91文件/545项通过，另有1项CLI基线runner按设计跳过；Node 27项通过；Rust workspace执行97项、0失败，另有1项真实API测试默认忽略；TypeScript/Rust存档互操作通过。
- `pnpm --dir windows-app build`通过，Vite production构建210个模块；CSS被正式构建且没有解析警告。
- 用户已有`.gitignore`修改保持未暂存；本任务不改变游戏逻辑、SQLite、Provider或玩家数据，不merge、不push。

## 2026-08-13 — M2-T02 UI Primitives

### Primitive实现

- 新增Button、Input、Textarea、Select、Card、Modal、Drawer、Tabs、Tooltip、Toast、Skeleton、Progress、EmptyState和ErrorState共14类无业务primitive，使用React、原生HTML与M2-T01 token实现。
- Button统一variant、loading/disabled和可见状态名；三类Field强制label并关联description/error/`aria-invalid`；Progress和Skeleton拒绝越界输入。
- Modal/Drawer使用原生dialog，覆盖初始焦点、Esc/backdrop/关闭按钮意图、受控open和关闭后焦点归还；Tabs实现方向键、Home/End、循环与跳过disabled的roving focus。
- Tooltip合并触发器`aria-describedby`；Toast按普通/成功与错误区分polite/assertive live region；Empty与Error不以颜色作为唯一状态。
- CSS只消费正式token，提供44px target、focus-visible/scroll margin、窄窗Overlay、正式layer、reduced-motion和forced-colors；未复制第三方资产。

### 架构与迁移

- 新增`DEC-108`和`docs/V0.3_UI_PRIMITIVES.md`，记录原生优先、无业务状态、无障碍与渐进迁移合同。
- UI styling技能用于组件组合和状态原则，accessibility技能用于WCAG 2.2 target/focus/ARIA/live region；因现有栈已满足需求且任务禁止无必要迁移，未采用技能建议的shadcn/Tailwind安装。
- `AppErrorBoundary`迁移到ErrorState作为页面接入证明；仍隐藏原始异常、保留main landmark和返回酒馆action，没有修改路由或错误分类。

### 验证

- 首次定向门禁在TypeScript阶段发现`exactOptionalPropertyTypes`下Field可选prop未允许显式undefined；统一公共Field合同后编译通过，未关闭严格模式。
- Primitive定向行为与CSS测试通过：2文件/15项；连同AppErrorBoundary/Routes回归为3文件/23项。
- 行为覆盖loading/disabled、Field label/error、Card inline snapshot、Modal/Drawer焦点和关闭、Tabs键盘、Tooltip、Toast、Skeleton、Progress及Empty/Error；CSS覆盖token、target、focus、Overlay、motion和forced-colors。
- 首次完整门禁在ESLint阶段发现HTML inline snapshot的12处多余转义；改为标签、命名、子区块和文本组成的稳定结构snapshot后从头重跑，不禁用lint规则。
- `pnpm check:shared`完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 93文件/560项通过，另有1项CLI基线runner按设计跳过；Node 27项通过；Rust workspace执行97项、0失败，另有1项真实API测试默认忽略；TypeScript/Rust存档互操作通过。
- `pnpm --dir windows-app build`通过，Vite production构建212个模块。
- 用户已有`.gitignore`修改保持未暂存；本任务不改变业务逻辑、SQLite、Provider或游戏事实，不merge、不push。

## 2026-08-13 — M2-T03 Game Components

### 共享展示合同

- 核对原始目标发现明确列出十类组件，而Task摘要写成“九类”；按Spec和名称完成CharacterCard、NpcCard、TraitCard、QuestCard、ItemCard、ActionComposer、DialogueView、AIFieldAssist、GenerationPanel和StatusPanel全部十类。
- 每类只接收只读view model、ReactNode或用户意图callback，不导入Repository、SQLite、Tauri、Provider、AI orchestrator或动态实体规则。
- 五类Card统一语义、选择/禁用和非颜色选中提示；Dialogue统一消息与loading/empty/error；Generation/Status统一进度和状态投影。
- ActionComposer与AIFieldAssist只建立presentation shell，未提前实现M2-T04的字段生命周期或M2-T05的streaming、重复提交、恢复和跨场景状态机。
- 新增`DEC-109`和`docs/V0.3_GAME_COMPONENTS.md`，记录view model边界、十类权威清单、迁移与后续任务所有权。

### 核心页面迁移

- 任务板列表迁移到QuestCard；selected quest、accept、风险详情和导航继续由页面拥有。
- 酒馆人物列表迁移到NpcCard；NPC选择、详情和对话导航继续由页面拥有。
- NPC消息历史迁移到DialogueView；草稿、建议、发送、AI错误和关系状态继续由页面拥有。
- 旧布局class作为显式适配保留，未机械替换其他页面或改变服务调用；760px窄窗与forced-colors增加统一合同。

### 验证

- 定向Game Components与三份迁移页面测试通过：5文件/12项。
- 组件测试覆盖十类渲染/交互和空错加载态；CSS静态测试覆盖raw颜色、token完整性、非颜色选择标记、760px窄窗与forced-colors。
- `pnpm check:shared`完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 95文件/568项通过，另有1项CLI基线runner按设计跳过；Node 27项通过；Rust workspace执行97项、0失败，另有1项真实API测试默认忽略；TypeScript/Rust存档互操作通过。
- `pnpm --dir windows-app build`通过，Vite production构建214个模块；共享Game Components形成独立lazy chunk，三份迁移页面bundle均保持按路由拆分。
- 用户已有`.gitignore`修改保持未暂存；本任务不改变SQLite schema、Provider、业务规则或持久化，不merge、不push。

## 2026-08-13 — M2-T04 AI Field Assist

### 字段合同与安全边界

- 建立21项自然语言字段权威清单，覆盖世界创建/预览/修订、角色创建以及NPC与冒险自由输入；页面以唯一`data-ai-field`登记，测试审计所有者、重复与未知marker。
- AIFieldAssist补齐生成、完善、多个候选、扩写、缩写、采用、撤销、取消、重试和锁定展示；radio使用组件独立分组，空候选不能采用。
- 新增纯状态机和React适配器：结果先进入候选，只有显式采用才通知页面；生成器只接收operation/value/AbortSignal，没有SQLite、Repository或save能力。
- 活动请求期间拒绝编辑、二次生成和锁定；取消abort，迟到/失序响应按请求ID忽略。软锁可解，硬锁拒绝编辑、生成及解锁，保护游戏开始后的世界事实。
- 候选限定1–5个，“多个候选”至少2个；拒绝空白、重复、危险控制符和超过8000字符输出。Provider原始异常不进入玩家状态。
- 新增`DEC-110`与`docs/V0.3_AI_FIELD_ASSIST.md`。M2不伪造候选、不调用真实模型、不复用会持久化的现有世界整体生成；M3 Generator通过无持久化接口接入。

### 验证

- 首轮格式化命令错误使用不存在的`src/pages`路径，Prettier明确失败且未更改这些页面；改用真实`src`路径后成功，未将部分格式化视为完成。
- 首次定向TypeScript发现Error结构断言和async rejection写法不满足严格类型；改为显式验证`FieldAssistStateError.code`及Promise rejection后通过，未放宽tsconfig。
- 首次字段审计准确发现`world-name`使用直接字面marker而非World helper动态marker；审计改为同时验证所有清单源登记和所有字面marker均受清单管理，不删除该字段。
- 专项测试4文件/23项通过，覆盖字段审计、state machine、cancel/race、locked field、不合规输出、适配器无直接发布及组件交互。
- 首次完整门禁在ESLint阶段发现测试中的非空断言和两个无用转义；改为显式null保护和规范正则后从头重跑，不禁用规则。
- `pnpm check:shared`完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 98文件/586项通过，另有1文件/1项CLI基线runner按设计跳过；Node 27项通过；Rust workspace执行97项、0失败，另有1项真实API测试默认忽略；TypeScript/Rust存档互操作通过。
- `pnpm --dir windows-app build`通过，Vite production构建214个模块；没有新增Provider依赖或改变路由拆分。
- 用户已有`.gitignore`修改保持未暂存；本任务不改变SQLite schema、真实模型配置或已保存游戏事实，不merge、不push。

## 2026-08-13 — M2-T05 Action Composer

### 统一输入与候选合同

- 新增Action Composer纯状态机，统一freeform/suggestion提交、3–5候选验证、streaming、取消、错误重试、禁用、草稿恢复与SQLite pending恢复语义；迟到事件按submission ID忽略。
- 共享ActionComposer补齐`Ctrl/⌘ + Enter`、受控候选选择、aria-pressed、live stream/status、cancel和retry；自由Textarea始终存在，候选没有专用提交权限。
- NPC和冒险移除各自重复候选/表单结构并迁移共享组件。NPC候选/自由文本均走`service.send`且以ref阻止双击；冒险三种模式均走`service.act`，其中OBSERVE作为当前调查集成。
- NPC Reply schema、prompt与registry升级v4，新生成输出要求3–5个唯一建议话题；Fake Provider和fixtures同步为3项。旧存档快照加载不强制新下限，保证兼容。
- 删除已无调用者的`.dialogue-topics`与`.suggested-actions`旧样式；共享组件只消费正式token，并为候选增加非颜色及forced-colors选择标记。
- 新增`DEC-111`与`docs/V0.3_ACTION_COMPOSER.md`。实际Provider streaming/cancel分别属于M10-T03/M3-T02，本任务不伪造流或提前实现队列。

### 验证

- 首轮专项测试发现NPC schema版本矩阵仍期待v3，且冒险回归依赖“上方建议”既有文案；同步v4矩阵并保留用户文案后重跑通过，没有降低断言。
- 定向8文件/92项通过，覆盖state machine、schema/prompt/Fake、共享组件、NPC Application与NPC/冒险页面集成；冒险既有自由输入失败保留、恢复和不可重复投骰回归继续通过。
- 首次完整门禁在玩家文案阶段拒绝`Ctrl/Enter`英文键名；改为“控制键/命令键/回车”的完整中文说明后从头重跑。
- 第二次完整门禁准确发现共享组件迁移后字段marker由字面属性变为受控prop，以及NPC prompt当前版本升到v4但缓存测试仍模拟v4；审计改为验证所有字面marker均在清单内（字段源登记仍逐项唯一），缓存变化测试改为v4→v5后从头重跑。
- `pnpm check:shared`完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 99文件/596项通过，另有1文件/1项CLI基线runner按设计跳过；Node 27项通过；Rust workspace执行97项、0失败，另有1项真实API测试默认忽略；TypeScript/Rust存档互操作通过。
- `pnpm --dir windows-app build`通过，Vite production构建214个模块；NPC页面chunk略降，ActionComposer保持共享lazy chunk。
- 用户已有`.gitignore`修改保持未暂存；本任务不改变SQLite schema、硬结果或既有消息/行动事实，不merge、不push。

## 2026-08-13 — M3-T01 Generator Framework

### 框架与首个迁移切片

- 在ai-core新增九阶段泛型Generator/Runner，Context、Prompt、raw、parsed、validated、rules-checked、persisted和events类型分离；repair仅处理首次parse/validate失败并强制重新验证。
- 新增内容无关审计entry与安全LifecycleError；每阶段STARTED/SUCCEEDED/SKIPPED/FAILED可观察，未知异常只投影稳定通用码。
- 通过Transaction Port把persist与emitEvents置于同一事务；事件失败回滚，`ALREADY_COMMITTED`跳过事件，框架不导入SQLite/Persistence。
- 首个迁移切片为Windows DesktopAIOrchestrator共享结构化生成：复用既有Model Settings、Prompt、cache、Provider、validate/repair和selection drift，不建立第二套Provider。
- Desktop的persist阶段只返回已验证候选，事件为空，正式事实继续由现有Application/Gateway事务提交；未批量迁移其他生成器，未修改schema。
- 新增`DEC-112`与`docs/V0.3_GENERATOR_FRAMEWORK.md`，固定阶段、一次repair、事务、幂等、审计与渐进迁移边界。

### 验证

- 首次实现补丁因`ai-core/index.ts`导出位置假设不匹配而整体拒绝；读取真实export布局后分两次添加文件与显式exports，没有产生半应用文件。
- 首次Desktop迁移TypeScript发现validation subclass在base class声明前求值；将subclass移动到base之后通过，未关闭严格检查。
- 框架与Desktop/AITurn定向3文件/24项通过，覆盖阶段顺序、失败短路、repair、规则拒绝、事务rollback、幂等事件和既有桌面能力。
- 首次定向ESLint发现测试残留未使用的LifecycleError import；删除无用import后重新执行lint、TypeScript和定向测试通过，未忽略规则。
- `pnpm check:shared`完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 100文件/603项通过，另有1文件/1项CLI基线runner按设计跳过；Node 27项通过；Rust workspace执行97项、0失败，另有1项真实API测试默认忽略；TypeScript/Rust存档互操作通过。
- `pnpm --dir windows-app build`通过，Vite production构建215个模块；Generator形成共享依赖且桌面编排保持路由lazy chunk。
- 用户已有`.gitignore`修改保持未暂存；本任务不改变SQLite schema、Provider配置或已持久化游戏事实，不merge、不push。

## 2026-08-14 — M3-T02 Generation Queue

### 有界调度与策略

- 新增P0/P1/P2 GenerationQueue，提供1–8全局并发、最大256 active intents、P0四次burst公平轮转、P1/P2轮转及P2保留前台槽策略。
- 同intent返回相同handle/Promise；queued和running均可取消，attempt使用AbortSignal和单次settle，迟到结果不会改变终态。
- timeout覆盖所有retry/fallback的整体deadline；retry限制0–3次，达到上限后只有稳定错误合同允许且调用方显式授权时才fallback一次。
- hardResultKey在PRIMARY/RETRY/FALLBACK保持原值，Queue不创建、修改或持久化硬结果；成功结果仍需进入Generator rules/persist。
- 指标只记录task/priority/status/route/attempts/queue wait/duration/error code，拒绝内容和身份字段；时长有界且每任务只记录一个终态。
- 新增`DEC-113`与`docs/V0.3_GENERATION_QUEUE.md`；Queue只依赖execute callback，不建立第二套Provider，不直接写SQLite。

### 验证

- 首轮Queue专项8项中7项通过；并发测试预期错误地要求第二个P2占用专门保留的前台槽，同时fake timer在挂载rejection断言前推进造成handled-late警告。修正测试时序后8/8通过，未削弱P2容量限制。
- 首次定向ESLint发现Queue entry变量只赋值一次；改为const entry和独立cancelTarget闭包后通过，未禁用prefer-const。
- 新增硬结果技术retry及配置/容量边界专测后，Queue/Application Error/Generator定向3文件/28项通过，覆盖priority/fairness、concurrency、cancel race、timeout、dedupe、retry/fallback policy、hard result和metrics。
- `pnpm check:shared`完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 101文件/613项通过，另有1文件/1项CLI基线runner按设计跳过；Node 27项通过；Rust workspace执行97项、0失败，另有1项真实API测试默认忽略；TypeScript/Rust存档互操作通过。
- `pnpm --dir windows-app build`通过，Vite production构建216个模块；Queue保持共享无Provider依赖模块。
- 用户已有`.gitignore`修改保持未暂存；本任务不改变SQLite schema、模型凭据、硬结果或已持久化游戏事实，不merge、不push。

## 2026-08-14 — M3-T03 Structured Entity Schemas

### 版本化实体合同

- 在ai-core新增九类实体闭集与registry，分别提供World Constitution、Career、Trait、Item、Location、Faction、NPC LOD、Quest Graph和Director Action严格version 1 input/output Zod Schema。
- payload与registry双重携带schemaVersion；顶层及嵌套对象拒绝未知字段，字符串、列表、请求数量和输出资源均有硬上限，不把长篇文本作为唯一结构。
- Career覆盖稀有度、role/skills/equipment/social/relationship/risk/requirement；Trait拆分kind、trigger及正负语义效果；Item分离叙事/语义/balance tag，不接受AI数值伤害字段。
- Location/Faction包含稳定ID和关系引用；NPC LOD以0–3层结构承载逐步详情和preservedFields输入；Quest以node/edge表达闭集状态；Director只输出有界action proposal和cooldown key。
- Schema刻意允许不存在的引用和LOD降级形状，证明parse不冒充业务验证；后续rulesCheck必须依据SQLite判断引用、revision、平衡、迁移、预算和冷却。
- 新增`DEC-114`与`docs/V0.3_STRUCTURED_ENTITY_SCHEMAS.md`；不新增数据库、Provider、Prompt或事实写入口。

### 验证

- 首轮Prettier完成TS/JSON格式化；`cargo fmt --check`准确报告新Rust模块和module顺序不符合rustfmt，执行正式`cargo fmt --all`后通过，没有跳过格式门禁。
- TypeScript实体专项14项通过，覆盖registry/fixture完整性、有效、缺失、未知版本、越界、资源上限、未知字段拒绝及结构/业务分层。
- Rust跨语言专项3项通过，共读同一fixture并验证九类闭集、version、必需输出边界、资源上限和strict envelope。
- 定向ESLint与全仓TypeScript strict typecheck通过。
- `pnpm check:shared`完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 102文件/627项通过，另有1文件/1项CLI基线runner按设计跳过；Node 27项通过；Rust workspace执行100项、0失败，另有1项真实API测试默认忽略；TypeScript/Rust存档互操作通过。
- `pnpm --dir windows-app build`通过，Vite production构建217个模块；实体Schema作为共享结构合同进入现有bundle，不新增运行时Provider或数据库依赖。
- 用户已有`.gitignore`修改保持未暂存；本任务不改变SQLite schema、已保存事实或模型配置，不merge、不push。

## 2026-08-14 — M3-T04 AI Inspector

### 会话诊断与权限边界

- 新增session AI Inspector只读Gateway与有界投影，覆盖generation/task/status/error、provider/model、latency、cache、tokens、Context manifest、Prompt、raw、parsed、validation、repair和Generator lifecycle。
- DesktopAIOrchestrator在每个primary/fallback实际attempt边界记录成功或失败；Inspector记录失败本身best-effort，不会替换原生成结果、稳定错误或fallback策略。
- 玩家模式返回空且UI默认关闭；“我的”新增第八个AI检查器分区，只有显式开启才以ADVANCED模式读取，面板无编辑、retry、save或事实提交能力。
- ADVANCED遮罩Prompt/raw/parsed scalar；DEVELOPER仅展示有界净化内容。SYSTEM Core Prompt始终隐藏；无system-role时只显示`[TASK_INPUT]`之后部分，防止合并的Core/stable truth泄露。
- 递归遮罩API Key、Authorization/Bearer、Cookie、Password、Credential、secret/hidden/unrevealed和World Truth字段；Context继续只显示既有manifest metadata。
- 会话记录、段长、消息、数组、对象字段、嵌套深度、validation issue和lifecycle都有硬上限；新增`DEC-115`与`docs/V0.3_AI_INSPECTOR.md`，不新增SQLite或导出面。

### 验证

- 首次严格TypeScript发现Provider cache token字段在协议中可为undefined，而Inspector合同只接受number/null；显式归一为null后通过，未放宽类型。
- 专项4文件/24项通过，覆盖redaction、PLAYER/ADVANCED/DEVELOPER模式、空记录、成功、Provider失败、repair成功/失败、validation、metrics、内容/集合上限、UI显式启用和Context metadata回归。
- 安全复核发现不支持system role时Core Prompt与用户输入合并；新增`[TASK_INPUT]`切分和回归测试，开发模式也不显示Core/stable prefix。
- `pnpm check:shared`完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 103文件/635项通过，另有1文件/1项CLI基线runner按设计跳过；Node 27项通过；Rust workspace执行100项、0失败，另有1项真实API测试默认忽略；TypeScript/Rust存档互操作通过。
- `pnpm --dir windows-app build`通过，Vite production构建218个模块；Inspector保持My与Desktop orchestrator现有lazy chunks，不新增Provider或持久化依赖。
- 用户已有`.gitignore`修改保持未暂存；本任务不改变SQLite schema、GenerationRecord、已保存事实或模型凭据，不merge、不push。

## 2026-08-14 — M4-T01 World Constitution

### 结构化规则与锁定边界

- 新增version 1 World Constitution合同，覆盖世界类型、时代、技术、魔法、族群、社会/政治/经济、战斗/死亡、职业/装备/NPC/Trait规则及禁忌；`GENERATE_WORLD`与`REFINE_WORLD`升级v2，在既有Generator/Provider响应内同批生成World与Constitution，不增加模型调用或提前生成后续实体。
- 新增migration 9及`world_constitutions`独立表；TypeScript Repository与Rust Windows命令支持完整读写、revision递增、expected revision确认和SQLite重开。锁定trigger阻止已确认记录的任何UPDATE，绕过Repository也不能改写。
- World与Constitution在同一事务提交；本地规则要求technology精确匹配、magic进入power rules、所有taboo进入forbidden elements。Schema有效但关系冲突的模型输出以稳定错误整批拒绝，Campaign、World和Constitution均不产生半提交。
- 新增下游`assertConstitutionBinding`入口，要求LOCKED状态、campaign与revision完全一致；后续Career/Item/NPC/Trait业务规则仍由各自任务实现，不把结构parse误当成合法性裁决。
- 世界确认UI增加醒目的只读Constitution区，显示revision/status及全部规则；AI refinement可在确认前同步修订并递增revision，确认后进入车卡且不可继续修订。
- 新增`DEC-116`与`docs/V0.3_WORLD_CONSTITUTION.md`。portable archive仍保持v2，集中升级属于M10-T05；本任务不提前改变跨语言存档协议。

### 验证

- 新增三类Constitution（低魔、无魔调查、赛博朋克）save/reload测试，并覆盖revision、错误expected revision、Repository锁定拒绝、SQLite trigger、migration 9及数据库重开。
- Domain/Application测试覆盖未锁定、campaign mismatch、revision mismatch、World technology/magic/taboo mismatch、原子拒绝及确认锁定；Windows UI/Service与Rust纵向切片覆盖展示、修订和确认。
- 首次Rust reopen测试发现native migration最新版仍写死为8；改为集中`LATEST_SCHEMA_VERSION = 9`后通过。完整门禁随后发现archive本地数据库白名单也仍为8；同步本地识别为9但不改变portable v2格式，再从头执行完整门禁。
- `pnpm check:shared`完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 105文件/646项通过，另有1文件/1项CLI基线runner按设计跳过；Node 27项通过；Rust workspace执行100项、0失败，另有1项真实API测试默认忽略；TypeScript/Rust存档互操作通过。
- `pnpm --dir windows-app build`通过，Vite production构建218个模块；World Creation chunk包含确认UI，不新增Provider或完整世界生成链。
- 用户已有`.gitignore`修改保持未暂存；本任务不merge、不push，也不提前执行M4-T02。

## 2026-08-14 — M4-T02 World Seed

### 持久Seed与独立程序随机流

- 新增version 1 World Seed合同：每个Campaign持久128-bit小写hex Seed和`EMBER_STREAM_V1`算法标识；新Campaign在同一事务创建Seed，非法注入会回滚Campaign，migration 10为既有Campaign一次性回填。
- 新增`world_seeds`与`world_random_streams`；Seed由SQLite trigger永久不可变，每个用途流独立保存next position。Repository以单条UPSERT原子预留1–4096次draw，重开后继续cursor且不会因其他流推进而漂移。
- 新增可注入`DeterministicWorldRandom`，提供uint32/unit、pick、weightedPick和Fisher–Yates shuffle；严格验证Seed、流名、position、候选、权重和reservation边界，耗尽后拒绝继续抽样。
- TypeScript与Rust共同实现`EMBER_STREAM_V1`随机访问算法，并以固定向量验证一致；Windows CampaignStore创建/读取Seed、预留map流，E2E在正式纵向切片证明落库。
- `d20`、`dice`及其命名空间在Domain、Repository、SQLite和Rust拒绝；程序抽样器不实现`nextD20`。既有D20仍由独立受信`D20RandomSource`裁决并持久硬结果，设备模型温度设置也不与Seed混用。
- 新增`DEC-117`与`docs/V0.3_WORLD_SEED.md`；不声称LLM完全确定，不提供Seed重置/查看UI，不提前实现地图、事件池或Director消费者。portable archive新表升级仍按M10-T05集中处理。

### 验证

- Domain/Repository/Application专项11项通过，覆盖shared vector、repeatability、pick/weight/shuffle、reservation耗尽、stream isolation、save/reopen、Seed/cursor、创建rollback、不可变trigger、SQLite硬随机命名拒绝及D20 independence。
- migration/database startup 9项通过；从schema 6升级到10时既有Campaign获得合法Seed，完整新库包含两张Seed表且重复启动幂等。
- 首次完整门禁在Rust Clippy唯一拒绝手写position闭区间判断；按建议改用`RangeInclusive::contains`，未添加allow或降低warnings，随后Clippy、Rust workspace与互操作全部通过。
- `pnpm check:shared`完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 107文件/654项通过，另有1文件/1项CLI基线runner按设计跳过；Node 27项通过；Rust workspace执行102项、0失败，另有1项真实API测试默认忽略；TypeScript/Rust存档互操作通过。
- `pnpm --dir windows-app build`通过，Vite production构建219个模块；Seed基础设施不增加玩家UI或模型调用。
- 用户已有`.gitignore`修改保持未暂存；本任务不merge、不push，也不提前执行M4-T03。

## 2026-08-14 — 引入《Ember Tavern 视觉风格手册 V1.0》并冻结渐进迁移策略

### 规范持久化与任务影响分析

- 将用户提供的视觉手册逐字持久化为`docs/EMBER_TAVERN_VISUAL_STYLE_GUIDE_V1.md`，并在`docs/V0.3_SPEC.md`建立全局引用；视觉方向冻结为“黑暗奇幻酒馆 × TRPG 冒险手册 × 现代桌面游戏 HUD”，AI采用命运/世界生成身份而非技术品牌主角。
- 审计发现M2-T01～T05已完成Token、Primitives、Game Components、AIFieldAssist和ActionComposer基础，不能修改其历史状态或重做；但原任务只做渐进核心页面迁移，M5～M10新增Feature UI之后缺少统一Legacy迁移与一致性收敛门禁。
- 在不改变里程碑顺序的前提下新增`M10-T07 Visual System Convergence`，由M10-T06依赖进入，并将M11-T01依赖改为M10-T07；M12-T01增加独立视觉复核标准。未另建第二套UI体系。
- 新增`docs/V0.3_VISUAL_MIGRATION.md`：记录现有`theme.css`仍有41处非Token raw color、历史页面尚未逐页复核Typography/Color/Spacing/Radius/Border/Shadow/Motion等视觉债务，并冻结Token→Primitive→Game Component→Feature→Legacy→Audit迁移顺序。
- 从现在起，M5～M10新增或自然触及的UI直接复用现有Token和共享组件并遵循手册；明显扩大当前业务任务的视觉调整留到M10-T07。M0～M4-T02页面不在当前M4-T03返工。
- 视觉规范不改变Rules Engine、Provider、Generator/Queue、SQLite、Persistence、Save/Resume、World Seed/Constitution、D20或Quest/NPC/Adventure合同；冲突时功能正确性、数据合同和存档兼容性优先，无法兼容项必须记录Decision。

### 当前任务连续性

- 文档追加完成后继续`M4-T03 Rules Engine Expansion`现有属性、D20、装备、金钱、时间、Trait、Quest和事务盘点；未开始M4-T04，也未因视觉规范扩大或重构规则业务范围。
- 用户已有`.gitignore`修改继续保持未暂存；本次只修改V0.3全局文档与尚未完成任务的标准/依赖，不修改已完成任务历史状态。

## 2026-08-14 — M4-T03 Rules Engine Expansion

### 本地裁决、事务与审计

- 新增version 1角色规则状态与闭集命令合同，覆盖技能、HP、状态、装备、金钱、游戏时间、Trait修正、资源和Quest迁移；基础属性继续采用既有五属性合同并在两张表由SQLite trigger保持不可变。
- authority只允许`LOCAL_RULE`、`PLAYER_ACTION`和`SYSTEM`。AI state patch validator显式拒绝所有规则命令和属性写入；未知命令/字段、非法所属关系和越界数值在写入前拒绝，不从Narrative反解析任何数值。
- 新增migration 11、`character_rule_states`和append-only `rules_events`。TypeScript Repository以即时事务、expected revision、canonical command及idempotency key原子提交角色状态、可选Quest迁移和事件；碰撞、漂移或任一步失败完整回滚。
- Windows原生桥接实现相同严格反序列化、裁决、幂等与事务语义，并提供受限前端gateway；未新增规则编辑页面或扩大视觉重构范围。
- D20仍使用独立受信随机源；修正来自本地基础属性、状态、Trait和角色实际拥有且已装备的合法物品。World Seed、Provider和叙事输出均不能决定硬结果。
- 新增`docs/V0.3_RULES_ENGINE.md`与`DEC-119`。本任务不实现完整DND/COC，不提前完成M5 Trait平衡或M4-T04 Knowledge Boundary。

### 验证与限制

- Domain专项覆盖组合、边界、非法authority/字段、property matrix、Trait/资源、D20/装备和物品效果；AI patch回归覆盖全部数值命令拒绝。
- Persistence与migration测试覆盖schema 11升级/回填、save/reopen、审计append-only、ownership、事件碰撞rollback、Quest原子提交、幂等冲突、属性不可变及Campaign级联。
- `pnpm check:shared`中的Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript及Vitest通过：110个文件/682项通过，另有1文件/1项CLI基线runner按设计跳过。Rust workspace 106项通过、0失败，另有1项真实API测试默认忽略；Clippy全workspace以`-D warnings`通过；TypeScript/Rust archive互操作通过；Windows production build通过（220个模块）。
- Node独立测试28项通过；其中既有`node:sqlite backup()`一致性测试在当前Node 26环境耗时约46秒，但最终正常退出且未被修改、跳过或降低断言。
- 本地数据库schema已为11并可关闭重开。portable`.emtavern`仍保持v2且暂不包含规则状态/事件，跨语言格式升级严格留给M10-T05；不得将本地恢复能力表述为portable archive已覆盖。
- 用户已有`.gitignore`修改继续保持未暂存；本任务不merge、不push，也不进入M4-T04。

## 2026-08-19 — M4-T04 Knowledge Boundary

### 四层持久模型与本地授权

- 新增schema 12及`world_truths`、`knowledge_claims`、`actor_knowledge`、`knowledge_memories`；Truth只承认本地规则、用户接受、领域事务和导入authority，Claim/Memory不能反向创建Truth。
- NPC与Player Character使用独立Actor Knowledge行；数据库与Repository共同验证Campaign、Actor、Truth/Claim目标、provenance Event和Memory来源，跨Campaign、跨Actor、缺失来源及revision跳跃均拒绝。
- LEARN、UPDATE、FORGET使用expected revision、operation ID和event ledger原子提交；重放返回原提交，同operation不同payload或ledger碰撞完整回滚，遗忘保留不可变审计历史。
- Domain投影按Campaign、Actor type和Actor ID精确筛选，保留Truth/Claim种类与Known/Suspected/Believed状态；秘密Truth只有显式授权才可见，多NPC Adventure逐Actor投影。
- TypeScript NPC Dialogue和Windows原生NPC/Adventure路径优先使用通用授权投影；存在新授权行时不再拼接旧事实。尚未迁移的Actor只使用既有隔离验证后的`npc_knowledge`兼容回退。
- migration 12保守转换旧Truth/Rumor/False Belief和NPC认知，不暴露传闻veracity；新增`docs/V0.3_KNOWLEDGE_BOUNDARY.md`与`DEC-120`固定模型、授权和迁移边界。

### 验证与限制

- 合同、Domain、Context Builder、Persistence和Application专项覆盖secret isolation、Claim/Truth区分、NPC/Player独立、learn/update/forget、provenance、幂等/rollback、SQLite重开、Memory及Prompt leakage。
- 原生Windows专项覆盖通用Actor投影替换旧事实列表，以及多NPC场景不交叉传播Knowledge；本地数据库最新版同步为schema 12。
- 安全复核补上Knowledge更新时的provenance Event归属检查，以及Memory引用不存在Knowledge的fail-closed约束；专项23项Vitest和10项迁移/启动测试通过。
- 首次完整门禁仅由`rustfmt --check`发现原生Memory长度条件需要标准换行；执行`cargo fmt --all`后从头重跑。最终`pnpm check:shared`完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 112个文件/689项通过，另有1文件/1项CLI基线runner按设计跳过；Node 28项通过；Rust workspace 108项通过、0失败，另有1项真实API测试默认忽略；Clippy与TypeScript/Rust archive互操作通过。
- `pnpm --dir windows-app build`通过，Vite production构建220个模块；知识授权接线未新增平行Provider、前端状态机或UI重构。
- portable`.emtavern`仍保持v2且暂不包含四张通用知识表；完整历史fixture、跨语言导入导出及round-trip升级严格留给M10-T05，不把本地重开验收冒充portable save/import完成。
- 本任务未修改Rules Engine、Provider、D20、Quest/NPC/Adventure业务语义，也未进入M5-T01；用户已有`.gitignore`修改保持未暂存。

## 2026-08-19 — M5-T01 Universal Character Schema

### 通用合同、世界扩展与兼容迁移

- 新增version 1 `UniversalCharacterProfile`，覆盖规格要求的身份、叙事、职业、属性、技能、熟练、能力、语言、财富、装备、声望、关系、Trait、状态和扩展字段；集合、文本、数字及嵌套资源均有硬上限。
- 新增version 1 `WorldCharacterExtensionDefinition`，以namespace和TEXT/INTEGER/NUMBER/BOOLEAN/ENUM/TEXT_LIST字段描述世界差异；定义必须绑定同Campaign已锁定Constitution revision。
- 修仙fixture验证灵根/境界/宗门，调查fixture验证理智/幸运/信用，Cyberpunk fixture验证义体/神经负荷/街头声望；三者都通过同一通用合同，不进入核心硬编码字段。
- 未知namespace、schema version、字段、required缺失、枚举/数值/文本边界和过量资源明确拒绝；不静默丢弃未知扩展。
- 新增migration 13、`universal_character_profiles`与`character_extension_definitions`。旧`player_characters`保留并保守回填通用档案；旧写入口同步兼容字段但不覆盖昵称、外貌等V0.3-only内容，可无损投影的Profile更新也在同一事务镜像旧行。
- 基础属性、技能名、财富与状态继续以M4-T03 `character_rule_states`为authority；Profile写入必须匹配当前规则投影，规则状态更新trigger同步投影并推进Profile revision，不能借通用档案直接改钱或状态。
- V0.2投影保留旧姓名、概念、偏好、内容边界、职业、属性、两项Trait、目标、背景、装备和时间戳；零/多Trait或无旧原型Career无法无损表示时明确拒绝。
- 新增`docs/V0.3_UNIVERSAL_CHARACTER_SCHEMA.md`与`DEC-121`，固定合同、Constitution绑定、兼容与阶段边界。

### 验证与限制

- 合同与Repository定向11项通过，覆盖三世界fixture、schema version、资源上限、未知扩展、V0.2投影、revision/rollback、基础属性不可变、双向兼容同步、SQLite重开与round-trip。
- migration/database startup定向10项通过，schema 10旧角色经11～13连续升级后完整回填；原生`ember-native-bridge` 63项通过，证明schema 13未破坏既有Windows纵向切片。
- `pnpm check:shared`完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 114个文件/700项通过，另有1文件/1项CLI基线runner按设计跳过；Node 28项通过；Rust workspace 108项通过、0失败，另有1项真实API测试默认忽略；Clippy、rustfmt与TypeScript/Rust archive互操作通过。
- `pnpm --dir windows-app build`通过，Vite production构建221个模块；通用角色合同进入共享bundle，但本任务未新增或迁移玩家UI。
- portable`.emtavern`仍为v2且暂不导出完整通用档案/扩展定义；跨语言格式升级、历史fixture和portable round-trip严格留给M10-T05，不把本地重开冒充portable存档覆盖。
- 本任务未实现M5-T02及后续UI、AI字段生成、Trait点数或Career Pool；用户已有`.gitignore`修改保持未暂存。

## 2026-08-20 — M5-T02 Quick / Advanced Creation

### 共享草稿、两种模式与正式事实门禁

- 新增version 1 `CharacterCreationSession`与`UniversalCharacterDraft`，以`ACTIVE`、`READY_TO_CONFIRM`、`CANCELLED`、`CONFIRMED`状态统一Quick/Advanced、锁定字段、取消恢复、revision和确认语义；草稿和页面状态都不是正式角色事实。
- schema 14新增`character_creation_sessions`及Campaign/Character/Constitution绑定、revision、状态迁移、已确认不可变和恢复保留trigger。Native普通保存使用服务端时间戳且不能伪造Quick generation provenance。
- Quick通过统一`GENERATE_QUICK_CHARACTER`任务读取一句概念、故事偏好、内容边界、锁定Constitution和世界扩展定义；Provider只返回叙事字段、唯一属性优先级、两项当前阶段叙事特质和扩展值。属性4/3/2/1、Trait ID、财富/状态/装备等规则初值全部由本地建立。
- Advanced呈现通用叙事字段、当前兼容职业/属性、内容边界和动态扩展字段；Rules/entity-owned初始字段只读。完整性校验要求叙事、目标、当前两项Trait、职业映射、属性总和及required扩展合法，不从文本反解析数值。
- 模式切换、保存和Quick重生保持已锁字段；取消后SQLite保留草稿，重开可恢复。已通过校验的候选发生未保存页面编辑时禁用确认，不能误写旧持久版本。
- 确认以单一SQLite事务写V0.2兼容角色、既有trigger建立的规则初态和V0.3-only通用档案字段，随后确认会话并推进Campaign到`GENERATING_TAVERN`；失败完整回滚，匹配revision的重复确认幂等。
- 新Windows页面复用既有角色创建布局、Design Token和交互类，AI以“命运编织”表达；锁定控件和字段输入拆分独立可访问标签。未创建第二套Primitive/Game Component，也未提前迁移Legacy UI。
- 新增`docs/V0.3_CHARACTER_CREATION.md`与`DEC-122`。本任务只保留当前两项叙事Trait和V0.2职业映射，不实现M5-T03字段AI、M5-T04点数、M5-T05平衡或M6实体生成。

### 回归、自审与限制

- 定向合同、AI schema/prompt、页面/服务、Repository和Native测试覆盖Quick、Advanced、mode switch、locked preservation、required扩展、invalid output、cancel/resume、save/reopen、revision/provenance伪造、确认rollback/幂等与未保存编辑门禁。
- 完整门禁首次发现格式、玩家可见英语和新增required namespace校验对既有档案兼容读取的回归；分别修正格式/中文文案，并拆分“既有档案兼容校验”与“新角色确认完整校验”，未放宽新角色required要求。随后从头复验通过。
- `pnpm check:shared`完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 118个文件/717项通过，另有1文件/1项CLI基线runner按设计跳过；Node 28项通过；Rust workspace 110项通过、0失败，另有1项真实API测试按授权策略忽略；Clippy、rustfmt与TypeScript/Rust存档互操作通过。
- `pnpm --dir windows-app build`通过，Vite production构建221个模块；新增角色创建页面独立lazy chunk成功产出。
- 本地数据库最新版为schema 14并支持关闭重开。portable`.emtavern`仍为v2且尚不包含完整通用档案、扩展定义或创建会话；跨语言格式升级、历史fixture与portable round-trip严格留给M10-T05。
- 已复核视觉手册附件与`docs/EMBER_TAVERN_VISUAL_STYLE_GUIDE_V1.md`内容及SHA-256完全一致；规格、任务、决策、视觉债务和M10-T07收敛门禁均已持久化，无需重复建立UI重构体系。
- 用户已有`.gitignore`修改继续保持未暂存；本任务不merge、不push，也不进入M5-T03。

## 2026-08-20 — M5-T03 Character AI Everywhere

### 全叙事字段命运辅助

- 新增统一`EDIT_CHARACTER_DRAFT`任务、严格input/output schema、Prompt、Context Budget和Fake Provider。单字段支持生成/完善/3候选/扩写/缩写，整体支持补空、区域、整卡与未锁重生；非3候选、重复路径、缺少/额外目标和类型错误均拒绝。
- 建立通用角色叙事字段白名单，覆盖身份、内心/关系、职业表达、两项当前叙事Trait、兼容背景、排除内容和TEXT/TEXT_LIST世界扩展。年龄、属性、派生值、财富、装备ID、声望、关系、状态、布尔规则和数值/枚举扩展均不可生成；本地patch后再对比全部Rules/entity-owned投影。
- 所有字段复用M2`AIFieldAssist`和`useAIFieldAssist`，补上外部草稿同步；保留显式采用/撤销、取消、错误重试、同字段并发拒绝和迟到响应隔离。整卡类操作只产生预览，显式采用后可整批撤销。
- 生成请求显式携带当前页面草稿、尚未保存的锁定集、锁定Constitution和世界扩展定义；同一锁定集用于目标过滤、本地patch和`CHECK_CONSISTENCY`语义校验，不仅依赖上次保存的session。
- 世界扩展校验区分“草稿逐字段编辑”与“已提供Profile/确认完整性”：草稿可先填一个文本扩展，正式档案和确认仍拒绝required缺失，未放宽正式事实门禁。
- UI继续复用现有Token、角色布局和Game Component，将玩家可见的“AI候选/生成/完善”收敛为“命运”身份；没有开启M10-T07 Legacy视觉迁移，也没有改动Rules Engine、SQLite或正式角色写入合同。
- 新增`DEC-123`固定候选复用、白名单、锁定上下文与本地authority边界；`docs/TASKS.md`仅将M5-T03标记DONE，未修改已完成历史、依赖或M5-T04范围。

### 回归、自审与限制

- 专项测试覆盖静态及动态字段盘点、3候选、当前未保存锁定保留、Rules-owned不变、矛盾拒绝、一次schema repair、并发拒绝、迟到响应、候选/整批撤销和非叙事扩展排除。
- 页面定向测试首次暴露批量请求会被每次重渲染的effect cleanup立即取消；改为只在页面卸载时中止。后续自审又发现未保存新锁未进入Prompt，改为页面显式传递并增加请求内容回归；两处均未以放宽断言规避。
- 首次完整共享门禁仅发现一处新增测试格式偏差；用Prettier修正后从头重跑。最终`pnpm check:shared`通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 119个文件/729项通过，另1个文件/1项CLI基线runner按设计跳过；Node 28项通过；Rust workspace 110项通过、0失败，另1项真实API测试按授权策略忽略；Clippy、rustfmt与TypeScript/Rust存档互操作通过。
- `pnpm --dir windows-app build`通过，Vite production构建225个模块，通用角色创建页独立lazy chunk成功产出。本任务不需要schema/SQLite迁移，portable`.emtavern`仍保持v2，未声称本任务扩大存档范围。
- 用户已有`.gitignore`修改继续保持未暂存；本任务不merge、不push，不进入M5-T04。

## 2026-08-20 — M5-T04 Trait Point System

### 本地点数合同、确认门禁与规则 UI

- 新增Buff、Debuff、Mixed、Narrative统一`TraitPointProfile`：Buff为-1至-5、Debuff为+1至+5、Mixed分别记录两边、Narrative严格为0；未知字段、错误符号、越界、空效果和类型矛盾全部拒绝。
- 净点数不持久化。Domain按每项Trait生成可审计breakdown并计算角色总点数；空集合定义为0。Advanced准备、会话恢复与正式确认均由本地合同严格要求净0，非零草稿仍可保存但保持`ACTIVE`。
- 角色创建页直接消费Domain重算结果，显示本地净点数并禁用非零/非法配置的准备与确认；支持移除到空集合，当前纵向切片最多两项。UI复用现有角色布局、Token和`AIFieldAssist`，未新建平行组件或提前迁移Legacy页面。
- 正面/负面效果作为自然语言字段接入M5-T03白名单，但仅在当前类型需要时出现。Trait类型、Buff/Debuff点值始终位于AI权限外，patch应用后再次验证类型和点值未变；Prompt也明确禁止AI分配点数。
- `CharacterTrait.pointProfile`采用可选兼容字段，旧数据缺失时只解释为Narrative 0；`PlayerCharacter.traits`由固定二元组演进为数组以满足空集合验收，旧两项JSON继续可读。Profile到兼容根的投影只保留id/name/description，不把点值伪装成旧字段。
- TypeScript Repository和Rust Native镜像结构、范围与严格归零校验；点数嵌入既有Profile/会话JSON，无需新增SQLite schema migration。新增`docs/V0.3_TRAIT_POINT_SYSTEM.md`与`DEC-124`固定authority、兼容和阶段边界。

### 验证、自审与限制

- 定向TypeScript类型检查及9个相关测试文件43项通过，覆盖四类Trait、-5/+5边界、Mixed、非法符号/效果/额外字段、empty、strict zero、Domain breakdown、JSON序列化、会话状态、SQLite关闭重开、AI权限与页面门禁。
- 完整`pnpm check:shared`从头通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 121个文件/741项通过，另1个文件/1项CLI基线runner按设计跳过；Node 28项通过；Rust workspace 111项通过、0失败，另1项真实API测试按授权策略忽略；Clippy、rustfmt与TypeScript/Rust存档互操作通过。
- `pnpm --dir windows-app build`通过，Vite production构建235个模块并产出独立通用角色创建chunk。Rust Native专项3项通过，覆盖Quick默认Narrative、非零拒绝及空集合保存/确认。
- 本任务不把点数转换为M4-T03 `TraitRuleModifier`，不判断强度、频率、条件或协同，也不进入M5-T05。portable`.emtavern`仍为v2，完整通用档案迁移保持在M10-T05。
- 已持久化的视觉手册、全局引用、视觉债务与M10-T07收敛门禁保持有效；本轮仅让自然修改到的角色Trait UI遵循既有体系，没有返工M0至M4页面。
- 用户已有`.gitignore`修改继续保持未暂存；本任务不merge、不push，不进入M5-T05。

## 2026-08-20 — M5-T05 Trait Balance & Synergy

### 十维透明分档与协同套利门禁

- 新增策略版本1`TraitEffectBalanceDeclaration`，显式覆盖频率、环境、战斗、社交、剧情、经济、永久性、可规避性、效果稀有度和条件十项0至3维度；至少一个游戏影响非零，条件与所需标签必须一致。
- 十维总分公开映射为1至5点；`TraitBalanceReport`逐效果记录世界规则身份、策略版本、breakdown、总分、建议点、实际点与精确路径。机械Buff/Debuff必须精确匹配档位，Narrative和空集合无需机械声明。
- 新增`TraitBalanceValidator`和`TraitSynergyValidator`。协同规则拒绝抵消计点弱点、自供并实际造成低档折扣的条件和正面触发闭环；只共享主题/机制标签或不改变档位的条件协作保持合法，避免黑盒相似度造成false positive。
- 新增`TraitGenerationFeedback`组合accepted与稳定issues，角色页面直接消费该反馈并显示中文解释。AI自然语言辅助仍只能修改效果文本，类型、点值、十维声明和协同标签均位于AI白名单之外。
- 角色页面为每个机械正负效果提供十维选择及机制/授予/所需/抵消标签，显示本地建议档位。净值、档位、声明或协同任一失败都禁用准备/确认，但仍允许保存和恢复编辑中草稿。
- M5-T04缺少声明的机械Profile继续可读但在重新确认时明确要求补全；旧Narrative 0和空集合不受影响。TypeScript Repository和Rust Native镜像结构、范围、透明分档与组合门禁；数据嵌入现有JSON，SQLite schema保持14。
- 新增`DEC-125`并扩充`docs/V0.3_TRAIT_POINT_SYSTEM.md`，固定策略、兼容、生成反馈和后续边界；视觉实现复用现有角色布局、Token和AIFieldAssist，没有创建平行组件体系或提前执行M10-T07。

### 验证、自审与限制

- 定向合同、Domain、会话、持久化、AI权限与页面测试42项通过；协同false-positive规则收窄后的核心回归子集21项再次通过。覆盖公平/不公平、条件、永久、环境、十维结构、三世界、稳定审计、序列化、旧数据补全、组合套利和false-positive baseline。
- Rust Native角色创建专项4项通过，覆盖十维最低/环境/最高档、条件矛盾、平衡组合接受、协同套利拒绝、非零拒绝及空集合确认。最终`pnpm check:shared`完整通过：Vitest 123个文件通过、1个跳过，759项通过、1项跳过；Node 28项通过；Rust 112项通过、1项显式授权真实模型测试忽略；rustfmt、Clippy与TS↔Rust存档互操作门禁通过。`pnpm --dir windows-app build`生产构建通过，Vite转换237个模块。
- 本任务不解析Trait效果文本、不自动创建M4-T03数值修正、不引入世界特定权重，也不进入M6-T01。portable`.emtavern`仍为v2，完整V0.3 Profile迁移继续属于M10-T05。
- 用户已有`.gitignore`修改继续保持未暂存；本任务不merge、不push，不进入M6。

## 2026-08-20 — M6-T01 Dynamic Career Pool

### Constitution 职业事实、生成与角色集成

- 新增version 1 `CareerDefinition`/`CareerPool`合同和Domain validator，覆盖COMMON、UNCOMMON、RARE、SPECIAL、完整叙事/社会字段、显式V0.2原型映射、generation provenance及全角/空白/大小写统一规范化去重；职业不携带任何数值加成。
- 初始池严格要求四种rarity各一项，运行时发现按请求rarity追加；候选必须逐项精确引用锁定Constitution的career rules、society、technology和economy。三世界fixture通过同一合同产生不同职业，不在核心schema硬编码世界类型。
- 新增统一`GENERATE_CAREER_POOL` schema、Prompt、Context Budget、Fake输出和任务注册，复用既有Provider与Generator Runner；Windows服务进入既有Generation Queue P2通道，并在超时/取消后阻止迟到Native提交。
- schema 15新增Campaign唯一的`career_pools`及身份、revision、锁定Constitution和保留trigger。TypeScript Repository与Rust Native均在写入和每次读取时核对canonical JSON、列及Constitution证据；generation record和池在Native immediate transaction原子提交，幂等重放不重复追加。
- Universal Character Repository、Native创建流程、Quick schema/Prompt与Windows页面统一验证池内精确职业引用。角色创建页只展示动态职业及rarity、职责、社会位置、要求和风险；固定四职业与自由文本入口已移除，旧原型只作V0.2兼容投影。
- 新增`docs/V0.3_DYNAMIC_CAREER_POOL.md`与`DEC-126`，并更新V0.3规格、角色创建、Generator Framework和任务引用。自然修改的UI复用既有Design Token与Game Component；没有提前进入Legacy UI迁移或建立平行设计体系。

### 验证、自审与限制

- 合同、Domain、AI schema/Prompt、Repository、角色服务和页面定向测试通过，覆盖Constitution compliance、四级rarity、requirements、三世界差异、运行时追加、Unicode规范化去重、P2生成集成、保存/重开、篡改拒绝、Quick精确选择及V0.2动态职业映射。
- Native职业专项覆盖初始/运行时提交、幂等重放、关闭重开、角色引用、错误rarity、错误证据和规范化重复；角色创建专项继续通过，证明动态池没有改变Trait/角色状态机语义。
- 完整门禁先后发现并修正新增文件格式/lint、启动迁移schema 15期望、Tauri命令类型导入及portable archive本地schema门禁遗漏；没有放宽断言或提前扩展archive格式。最终`pnpm check:shared`从头通过：Vitest 126个文件/784项通过，另1个文件/1项性能基线按设计跳过；Node 28项、Rust workspace 114项通过，另1项真实API测试按授权策略忽略；Prettier、玩家简体中文、ESLint、TypeScript、rustfmt、Clippy及TS↔Rust存档互操作全部通过。
- `pnpm --dir windows-app build`通过，Vite生产构建转换239个模块并产出独立通用角色创建chunk。
- portable`.emtavern`仍为v2；完整职业池导入导出和历史fixture迁移保留给M10-T05。本任务未实现M6-T02装备或后续NPC/地点/势力，也未修改Rules Engine、D20、Quest、Adventure、Provider或存档状态机。
- 用户已有`.gitignore`修改继续保持未暂存；本任务不merge、不push，不进入M6-T02。

## 2026-08-20 — M6-T02 Semantic Equipment

### 语义合同、本地机械与 Generator

- 新增version 1 `SemanticEquipmentDefinition`，把名称、描述、类别、外观、历史、来源、剧情能力、语义效果和Quest/NPC/Fact绑定，与rarity、price、damage、defense、numeric effect及透明balance记录明确分层；严格结构、资源上限和Unicode规范化去重均fail closed。
- Domain以Quest risk建立BASIC至LEGENDARY来源上限，并只按reward tier、装备类别和Quest主推荐属性派生机械。三世界fixture中的描述都故意包含`+99 damage`，最终数值仍完全由本地策略决定。
- 新增统一`GENERATE_ITEMS`任务、schema、Prompt、Context Budget、Fake输出、缓存指标白名单和fixture。输入携带锁定Constitution三项精确证据、当前Quest/Adventure来源、已存在装备及允许绑定目标；Prompt禁止模型分配任何机械数字。

### Windows 原子结算、持久化与兼容

- Adventure snapshot新增只读装备生成上下文以及Quest risk/reward/recommended attributes；Windows成功结算在Summary和World Event后生成一件语义装备，并把三份generation audit交给固定Native命令。
- Native重新验证响应、输入、Constitution revision、风险上限、类别、绑定、重复和机械预算；至少绑定当前Quest及发布者/关联NPC，Fact只接受同一结算的确定性ID。装备、归属、事件、生成记录、Quest、关系、酒馆变化、Fact、Clock和ending仍在一个immediate transaction中提交。
- 完整语义对象嵌入既有`items.content_json`，顶层name/description与`reward_tier`/`effect_json`保持旧Item、Rules和UI兼容；没有新增migration或平行装备表。档案可读取完整语义对象，旧装备仍按原合同工作。
- 既有`.emtavern` v2已携带items的JSON列，新增portable round-trip测试验证语义对象在导出、删除Campaign、导入后仍保留；未提前升级M10-T05负责的其他V0.3表。
- 历史portable v2尚不含Constitution；为不破坏其中进行中的Adventure恢复，Native只在锁定行不存在时使用带固定Legacy标识、读取World Bible technology且明确economy未知的保守证据。新Campaign始终要求真实锁定Constitution，不写伪迁移数据。
- 新增`docs/V0.3_SEMANTIC_EQUIPMENT.md`与`DEC-127`，并更新规格、Generator Framework和任务引用。自然修改的UI数据边界沿用视觉手册和现有组件，不提前执行M10-T07。

### 验证、自审与限制

- 合同、Domain、AI schema/Prompt、Windows服务、Native原子结算和portable archive专项通过，覆盖七类装备、四档rarity/price、四类trigger、Constitution证据、risk inflation、Unicode去重、叙事数字无authority、幂等、失败回滚和save/import。
- 首轮完整门禁发现Adventure独立测试种子缺少新snapshot所需的Constitution，并进一步验证历史portable v2确实不携带该表；补齐当前测试的真实锁定数据，同时为历史归档加入显式Legacy兼容证据后从头重跑，没有删除测试或降低断言。
- 最终`pnpm check:shared`完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 128个文件/811项通过，另1个文件/1项性能runner按设计跳过；Node 28项通过；Rust workspace 114项通过，另1项需明确API Key授权的真实Provider测试忽略；rustfmt、全workspace严格Clippy及TS↔Rust archive interop全部通过。
- `pnpm --dir windows-app build`生产构建通过，Vite转换241个模块并生成独立settlement service chunk。
- 本任务不修改Rules Engine/D20硬结果、Provider、Career Pool、Quest/NPC/Adventure状态语义、World Seed或SQLite真相架构，不进入M6-T03。用户已有`.gitignore`修改继续保持未暂存。

## 2026-08-20 — M6-T03 NPC LOD

### LOD合同、知识边界与按需Generator

- 新增严格version 1 `NpcLodProfile`和LOD0–3字段解锁合同。LOD0只保存不可变identity anchor与人口角色；LOD1增加名字/外貌/当前行为，LOD2增加职业/人格/目标/授权知识与关系，LOD3才允许授权记忆、秘密、Quest、装备和经历。
- Domain把唯一合法晋升固定为`OBSERVED`、`INTERACTED`、`RECURRING`，每次只增加一LOD和一revision；既有文本与ID必须是下一版本的子集，身份、人口角色和Constitution证据必须逐字一致，跳级、降级、改名、删事实和越权引用均fail closed。
- 新增统一`GENERATE_NPC_LOD`任务、结构schema、Prompt、Context Budget、Fake Provider输出、缓存指标白名单和跨语言entity fixture。模型只选择Native提供的引用ID，不能创建世界事实、记忆、关系、Quest、Item或Event。
- Windows新增`NpcLodService`和三个Tauri命令；同一Campaign/NPC的并发晋升在服务层合并，最终仍由Native expected revision仲裁。显式seed一次只创建一个背景身份，不扫描或预生成人口。

### SQLite、Native与兼容

- schema 16新增`npc_lod_profiles`和append-only`npc_lod_transitions`，保存canonical JSON、Constitution binding、generation provenance、before/after revision和idempotency key；SQLite trigger禁止身份改写、跳级、无provenance升级和在Campaign存续时删除身份。
- Native从当前事务重新构造Generator输入与授权引用：LOD知识只来自该Actor的KNOWN Truth，秘密还必须是SECRET Truth，Memory必须属于该Actor，关系/Quest/语义Item/Event必须显式关联同一NPC。generation audit、profile更新和transition在一个`BEGIN IMMEDIATE`事务提交。
- 既有完整`npcs`在迁移时保守回填为LOD3，后续旧Tavern流程新增完整NPC时由同一insert事务自动投影，不放宽旧表非空合同、不改变Dialogue/Quest/Adventure语义。低LOD身份纳入既有Knowledge、Memory和Actor Claim trigger，但跨Campaign与跨Actor仍拒绝。
- 新增`docs/V0.3_NPC_LOD.md`与`DEC-128`，并更新V0.3规格、Generator Framework和任务引用。UI没有逐页返工，后续自然展示继续复用视觉Token与既有NPC Game Component，完整Legacy迁移仍由M10-T07处理。

### 验证、自审与限制

- 定向合同、Domain、AI schema/Prompt/Fake Provider、TypeScript Repository、Windows service、migration和Rust Native测试通过，覆盖each LOD、字段提前出现、跳级/错误trigger、identity continuity、知识泄露、幂等重放、并发revision、关闭重开及低LOD Actor trigger。
- `pnpm check:shared`从头完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 132个文件/828项通过，另1个文件/1项性能runner按设计跳过；Node 28项通过；Rust workspace 116项通过，另1项需明确API Key授权的真实Provider测试忽略；rustfmt、全workspace严格Clippy及TS↔Rust archive interop全部通过。
- `pnpm --dir windows-app build`生产构建通过，Vite转换243个模块。没有通过删除测试、降低校验或忽略错误完成门禁。
- portable`.emtavern`仍为v2；新增LOD表的正式跨版本导入导出由M10-T05统一处理。本任务不进入M6-T04，不实现动态地点、势力、酒馆人口投影、多NPC场景或不可变NPC时间线。
- 用户已有`.gitignore`修改继续保持未暂存；本任务不merge、不push。

## 2026-08-20 — M6-T04 Dynamic Locations

### 稀疏地点图、渐进物化与本地旅行

- 新增严格version 1 `DynamicLocationProfile`，支持十类地点、OUTLINE/DETAILED物化、Constitution证据、稳定层级、Faction引用和generation provenance。Domain拒绝缺失父节点、环、超过八层、稳定ID/规范化名称重复、未知连接、越权Faction及非相邻旅行。
- 新增统一`GENERATE_LOCATIONS` schema、Prompt、Context Budget、Fake Provider输出和缓存指标白名单。每次只生成一个显式CHILDREN或CONNECTED扩展的一至八个地点；Prompt和校验共同禁止完整地图、坐标、NPC/Faction/Quest副作用与机械数值。
- schema 17新增`dynamic_locations`、`location_connections`、`campaign_location_states`和append-only`location_travel_events`。Constitution锁定时只把既有WorldBible地点保守投影为OUTLINE；不调用模型、不编造额外事实。
- TypeScript Repository和Rust Native均验证canonical profile、锁定Constitution、Faction authority、拓扑、generation provenance、旅行邻接及revision。Native从当前事务重新构造输入，把generation audit、地点与连接原子提交；幂等重放必须与原输入、上下文、generation ID和输出完全一致。
- Windows新增`DynamicLocationService`与四个Tauri命令。同一Campaign、起点、模式和数量的并发扩展意图在服务内合并；移动是独立本地事务，不调用模型。CONNECTED专项证明玩家可以离开预设城市，关闭并重开SQLite后图、当前位置、revision和旅行历史保持一致。
- 新增`docs/V0.3_DYNAMIC_LOCATIONS.md`与`DEC-129`，并更新V0.3规格、Generator Framework和任务引用。没有新增地图页面或逐页返工；未来地点展示继续复用视觉Token和既有组件，完整Legacy UI迁移仍由M10-T07执行。

### 验证、自审与限制

- 合同、Domain、migration、TypeScript Repository、Windows service和Rust Native定向测试覆盖hierarchy、lazy generation、CONNECTED离城、错误证据/父节点、非相邻/过期旅行、幂等、服务并发合并及save/reload。
- 完整`pnpm check:shared`从头通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 136个文件/843项通过，另1个文件/1项性能基线按设计跳过；Node 28项通过；Rust workspace 118项通过，另1项需明确API Key授权的真实Provider测试忽略；rustfmt、全workspace严格Clippy及TypeScript↔Rust archive interop全部通过。`pnpm --dir windows-app build`生产构建通过，Vite转换245个模块。
- portable`.emtavern`仍为v2，schema 17新表的正式跨版本导入导出保留给M10-T05。本任务未实现格子地图、坐标、战棋、寻路、完整地图生成或M6-T05主动势力，也未修改Rules Engine、D20、Quest/NPC/Adventure、Provider、World Seed或存档状态机。
- 用户已有`.gitignore`修改继续保持未暂存；本任务不merge、不push，不进入M6-T05。

## 2026-08-20 — M6-T05 Active Factions

### 八项合同、渐进激活与预算行动

- 新增严格version 1 `ActiveFactionProfile`，完整保存Goal、Resource、Leadership、Enemy、Ally、Territory、Current Action和Player Relation，并绑定锁定Constitution证据、generation provenance和revision。WorldBible既有身份只投影为OUTLINE，不编造资源、领导或行动。
- 新增统一`GENERATE_FACTIONS`任务、schema、Prompt、Context Budget、Fake Provider输出、缓存指标白名单和跨语言fixture。每次只激活一至十六个明确请求的既有Faction，必须延续name、goal、player relation、既有territory/relations与四项Constitution证据；Ally/Enemy必须双向一致。
- Domain与Native共享最高六点的本地成本语义；调用者budget envelope只能收紧action、Quest和World Fact上限。PLAYER、WORLD_EVENT和未来DIRECTOR共用结构化proposal，但Native总会重新核对所需资源、目标、引用、关系对称、Quest合法迁移和成本。
- 行动可原子增删resource/territory、双向改变relation、更新player relation、迁移一个Quest并创建一个Developing Fact。没有固定势力剧情、自动日程或全世界模拟；M8-T04/T05才负责World Director的每日调度、持久预算恢复与cooldown。

### SQLite、Native、桌面与兼容

- schema 18新增`active_factions`和append-only`faction_action_events`。初始Territory直接从同一WorldBible的Location所属关系投影，消除多个Constitution锁定触发器执行顺序造成的丢失风险；更新严格revision加一，Campaign存续时禁止删除身份和行动历史。
- TypeScript Repository与Rust Native在`BEGIN IMMEDIATE`中提交generation audit、全部激活档案或行动的所有Faction/Quest/Fact/event变化；相同generation和operation只允许完全一致的幂等重放，竞争revision和budget decision冲突fail closed。
- Windows新增`ActiveFactionService`及四个Tauri命令。相同Campaign与Faction集合的并发激活意图在服务层合并；本地Faction action不调用AI。关闭并重开SQLite后ACTIVE档案、双向关系、玩家关系和行动历史保持一致。
- 新增`docs/V0.3_ACTIVE_FACTIONS.md`与`DEC-130`，并更新V0.3规格、Generator Framework和任务引用。本任务没有新增Faction页面或逐页返工；后续展示继续复用视觉Token与既有组件，完整Legacy视觉迁移仍由M10-T07处理。

### 验证、自审与限制

- 合同、Domain、AI schema/Prompt/Fake Provider、migration、TypeScript Repository、Windows service和Rust Native专项覆盖八项字段、ally/enemy、territory/resource、身份延续、预算/行动合法性、Quest后果、幂等、事务与save/reload。
- 完整`pnpm check:shared`从头通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 140个文件/856项通过，另1个文件/1项性能基线按设计跳过；Node 28项通过；Rust workspace 119项通过，另1项需明确API Key授权的真实Provider测试忽略；rustfmt、全workspace严格Clippy及TypeScript↔Rust archive interop全部通过。`pnpm --dir windows-app build`生产构建通过，Vite转换247个模块。
- portable`.emtavern`仍为v2，schema 18新表的正式跨版本导入导出保留给M10-T05。本任务未修改Rules Engine、D20硬结果、NPC/Quest/Adventure核心语义、Provider、World Seed或存档状态机，也未进入M7。
- 用户已有`.gitignore`修改继续保持未暂存；本任务不merge、不push，不进入M7-T01。

## 2026-08-24 — M7-T01 Dynamic Tavern Population

### 本地 Context 投影、稳定身份与重要互动

- 新增严格 Tavern Population 合同与纯 Domain projector，Context 固定覆盖 World、当前 Location、Clock、ACTIVE Faction、最近 Event 和 NPC History；来源替换、重复身份、错误 profile、过期 revision 和未晋升 focus 均 fail closed。
- schema 19 新增 population state/member/cycle/focus 四表。数据库验证 Tavern/Campaign、NPC LOD、owner、Location、Clock、Faction 和 Event authority，禁止来源身份漂移、important/encounter 历史倒退及 Campaign 存续时删除。
- TypeScript Repository 和 Rust Native 均从 SQLite 当前事实重建 Context 与机会，以 `BEGIN IMMEDIATE` 原子提交人口状态和 append-only 历史。既有初始化 owner/resident/visitor 保守复用；动态 Location/Clock/Faction/Event 来源只在首次出现时创建稳定 LOD0，不生成完整人口。
- Rumor、AVAILABLE Quest、Faction current action、Clock 与最新 Event 只投影为机会，不执行任何 Quest/Faction/Clock 后果。相同 Context 与机会直接返回现有快照，不生成新身份、不增加 revision/encounter 或调用模型；owner-only 且无机会显式保存 empty state。
- Windows 新增 `TavernPopulationService` 和三个 Tauri 命令。并发 refresh/focus 合并；聚焦 LOD0 时只复用既有 `NpcLodService` 晋升该身份到 LOD1，随后 Native 校验 canonical profile 与 population revision 并持久化 important/focus history。
- 新增 `docs/V0.3_DYNAMIC_TAVERN_POPULATION.md` 与 `DEC-131`，并更新规格、Generator Framework 和任务引用。M7-T01 不新增人口 Generator，不重写既有 Tavern 页面；M7-T02 才消费快照建立多 NPC Scene 与 UI。

### 验证、自审与限制

- 定向合同、Domain、Repository、Windows service、Native 与 migration 测试已覆盖 context factors、同上下文不重生、Clock/Event 变化、来源身份延续/替换拒绝、单身份 LOD promotion、focus、empty state、幂等和关闭重开。
- `pnpm check:shared` 从头完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 144 个文件/866 项通过，另 1 个文件/1 项性能基线按设计跳过；Node 28 项通过；Rust workspace 115 项通过，另 1 项需明确 API Key 授权的真实 Provider 测试忽略；rustfmt、全 workspace 严格 Clippy 及 TypeScript↔Rust archive interop 全部通过。
- `pnpm --dir windows-app build` 生产构建通过，Vite 转换 249 个模块。没有通过删除测试、降低校验、写死结果或忽略错误完成门禁。
- 当前视觉手册、视觉债务和 M10-T07 收敛门禁保持有效。本任务没有新增页面或 CSS，也没有建立平行 Primitive/Game Component；M7-T02 自然修改 UI 时继续复用 Token 与 `NpcCard`。
- portable `.emtavern` 仍为 format v2；schema 19 新表的正式跨版本导入导出与历史 fixture 迁移严格留给 M10-T05。本任务未修改 Rules Engine、D20、Provider、Generation Queue、World Seed/Constitution、Quest/NPC/Adventure 核心合同或存档状态机，也不进入 M7-T02。

## 2026-08-24 — M7-T02 Multi-NPC Scene

### 逐 Actor Context、本地仲裁与 Tavern UI

- 新增 `PROPOSE_TAVERN_SCENE_ACTION` 严格 schema、Prompt、Context Budget、Fake Provider 输出和缓存指标白名单。每次请求只包含一个 Actor 的 LOD、目标、授权 Knowledge/Memory；其他参与者只有公开身份和状态，模型只提交结构化行动候选。
- 合同与 Domain 建立 `SPEAK`、`INTERRUPT`、`SILENCE`、`EAVESDROP`、`LEAVE`、`INTERVENE` 闭集。仲裁按玩家点名、授权知识、有限 urgency 和行动语义选择至多一个发言者，同时保留非发言行动；Actor ID 只作平局键，不固定轮询。
- schema 20 新增 Scene、Participant、append-only Turn 与 Actor Proposal。Rust Native 在 current transaction 重建每份 Actor 输入，验证 generation audit 和知识引用后，原子保存 generation provenance、提案、仲裁结果、离开状态与 scene revision；幂等重放和竞争 revision fail closed。
- Windows `TavernSceneService` 对同 Scene 并发 send 合并，独立并发调用既有桌面 AI 编排；Tavern 页面消费 Population 快照，按需复用 LOD focus，并复用 `NpcCard`、`DialogueView` 与 `ActionComposer` 展示多人场景。新增 CSS 只使用既有 Design Token，没有建立第二套组件体系或提前执行 Legacy UI 迁移。
- TypeScript Knowledge Repository 的 NPC authority 与 schema 16 一致扩展到 `npc_lod_profiles`，使低 LOD 稳定身份可参与逐 Actor 知识边界，不放宽跨 Campaign/Actor 校验。
- 新增 [`V0.3_MULTI_NPC_SCENE.md`](V0.3_MULTI_NPC_SCENE.md) 与 `DEC-132`，并更新 V0.3 规格、Generator Framework 和任务引用。M7-T03 的正式回复锁定、技术 Retry 和事实冲突修复没有提前实现。

### 验证、自审与限制

- 定向测试覆盖非轮询 speaker selection、沉默/离开、知识泄漏、逐 Actor 输入和并发 send 合并。`pnpm check:shared` 从头通过：Prettier、release metadata、简体中文文案、ESLint、TypeScript；Vitest 146 个文件/873 项通过，另 1 个文件/1 项性能基线按设计跳过；Node 28 项通过；Rust workspace 120 项通过，另 1 项需明确 API Key 授权的真实 Provider 测试忽略；archive interop 通过。
- 全 workspace 严格 Clippy 与 rustfmt 通过；Windows 生产构建通过，Vite 转换 254 个模块。没有删除测试、降低校验、写死业务结果或忽略错误。
- portable `.emtavern` 仍为 format v2；schema 20 的正式导入导出升级留给 M10-T05。本任务不修改 Rules Engine、D20、Provider 栈、Generation Queue、World Seed/Constitution、Quest/NPC/Adventure 业务语义或存档状态机，也不进入 M7-T03。
- 视觉实现遵循已持久化手册与现有 Token/组件合同；既有页面的 Legacy 视觉债务仍由 M10-T07 统一迁移和审查。
- 用户已有 `.gitignore` 修改继续保持未暂存；本任务不 merge、不 push。

## 2026-08-24 — M7-T03 Immutable NPC Timeline

### 先锁意图、技术 Attempt 与正式封存

- 新增严格 `NpcTimelineOperation`/`Attempt` 合同及纯 Domain retry policy。Operation 锁定 Campaign/Scope、玩家意图、点名 NPC 和可选硬结果引用；技术 Attempt 使用新 request/generation ID 并保留首个 Attempt 的稳定 idempotency key。
- schema 21 新增 `npc_timeline_operations` 和 append-only `npc_timeline_attempts`，限制每个 Scope 同时只有一个未解决 Operation。SQLite trigger 禁止修改锁定身份、非法状态转换、完成 Attempt 重写，以及删除/改写正式 NPC 回复和紧邻玩家输入；保护范围没有追溯扩大到旧的非 Timeline 消息。
- Rust Native 独立计算 Retry 白名单，只有网络/Provider 暂时失败、结构/重复、`FACT_CONFLICT` 和 `APP_INTERRUPTED` 可重试；认证、配额、规则、持久化和未知失败终止。STARTED Attempt 在重开恢复时先记录 `APP_INTERRUPTED`，随后只允许同一意图、点名和硬结果进入新 Attempt。
- 单 NPC 与多 NPC Native 提交均验证 Timeline Scope、generation/request/idempotency provenance 和 canonical Context，并在同一 immediate transaction 原子保存消息或 Scene Turn、全部 generation audit、业务后果与 COMMITTED Timeline。多 NPC 还为每 Actor 保存 pending request，保持 Actor 顺序和逐 Actor 稳定 key。
- Windows 新增统一 `NpcTimelineService` 与三个 Tauri 命令。单 NPC/Scene 在 Provider 调用前持久化 Attempt；AI 错误 Retry 调用专用 `retry()`，不把旧失败重新当作新 send。Native 已提交但响应丢失时读取 durable COMMITTED 并重载 SQLite，不重复提交。
- 页面重载会暴露 PENDING/FAILED_RETRYABLE 恢复入口；未解决单 NPC Operation 拒绝新输入。既有 UI 没有 Swipe 或成功回复刷新入口，自然修改继续复用 `ActionComposer`、`DialogueView`、`NpcCard` 和 Design Token，没有提前执行 M7-T04 或 M10-T07。
- 新增 [`V0.3_IMMUTABLE_NPC_TIMELINE.md`](V0.3_IMMUTABLE_NPC_TIMELINE.md) 与 `DEC-133`，并更新 V0.3 规格、Generator Framework 和任务引用。

### 验证、自审与限制

- 定向测试覆盖锁定意图/硬结果、network retry、schema/fact policy、非技术失败终止、应用中断恢复、成功封存、消息 append-only、响应丢失、防重复提交和多 NPC 顺序；Native 还验证提交引用必须属于目标 NPC 对话或目标 Scene。
- `pnpm check:shared` 从头完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 148 个文件/890 项通过，另 1 个文件/1 项性能基线按设计跳过；Node 28 项通过；Rust workspace 123 项通过，另 1 项需明确 API Key 授权的真实 Provider 测试忽略；rustfmt、全 workspace 严格 Clippy及 TypeScript↔Rust archive interop 全部通过。
- `pnpm --dir windows-app build` 生产构建通过，Vite 转换 257 个模块。没有删除测试、降低校验、写死业务结果或忽略错误。
- portable `.emtavern` 仍为 format v2；schema 21 的正式导入导出升级严格留给 M10-T05。本任务没有修改 Rules Engine、D20、Provider、Generation Queue、World Seed/Constitution、Quest/NPC/Adventure 核心合同或存档状态机，也不进入 M7-T04。
- 视觉实现继续遵循已持久化手册和渐进迁移策略；没有逐页返工 Legacy UI。用户已有 `.gitignore` 修改继续保持未暂存；本任务不 merge、不 push。

## 2026-08-24 — M7-T04 Dialogue Suggestions

### 公开 Context、精确失效与 Action Composer

- 新增统一 `GENERATE_DIALOGUE_SUGGESTIONS` version 1，严格输出 3–5 条唯一建议和合法可选点名对象。输入只含 World 摘要、玩家、参与者公开身份/状态、单 NPC 关系、公开对话/Scene 行动与开放 Quest；不向模型提供 Secret、私有 Knowledge/Memory 或隐藏事实。
- schema 22 新增 immutable `dialogue_suggestion_cache`。Rust Native 从 SQLite 重建单 NPC 或多人 Scene 输入，并把 Campaign、Scope、NPC/关系/对话或 Scene revision、World Fact、Clock、Faction、Location、Population、Event 与 Quest 状态纳入 SHA-256 digest。缓存只允许精确 digest 命中，世界变化后旧建议不可取回。
- Windows `DialogueSuggestionService` 先 prepare，命中缓存时不调用 Provider；未命中才走既有桌面 AI 编排。Native 在 immediate transaction 内再次重建 Context，过期 digest/输入返回 `FACT_CONFLICT`，并原子保存 request audit、generation record 与派生缓存。
- 单 NPC 与多人 Tavern 页面均复用既有 `ActionComposer`。选择建议只填充可编辑草稿和可选点名 NPC，必须再次明确提交；编辑多人自由输入会清除建议携带的点名。建议加载、取消、错误和重试不禁用自由输入，页面取消后的晚到结果不会提交。
- 建议缓存不复用可确认 `ai_candidates`，也不写 Message、Scene Turn、Game Event 或玩家行动。Campaign 删除可级联清理派生缓存；取消、结构错误、非法点名和过期提交均不产生部分写入。
- 新增 [`V0.3_DIALOGUE_SUGGESTIONS.md`](V0.3_DIALOGUE_SUGGESTIONS.md) 与 `DEC-134`，并更新 V0.3 规格、Generator Framework 和任务引用。

### 验证、自审与限制

- 定向测试覆盖 count、公开 relevance input、单/多人 UI、永久自由输入、无自动发送、精确缓存、关系/世界变化失效、stale digest、非法点名、取消、错误 cause、无玩家行动持久化和 Campaign 删除。
- `pnpm check:shared` 从头完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 149 个文件/899 项通过，另 1 个文件/1 项性能基线按设计跳过；Node 28 项通过；Rust workspace 124 项通过，另 1 项需明确 API Key 授权的真实 Provider 测试忽略；rustfmt、全 workspace 严格 Clippy及 TypeScript↔Rust archive interop 全部通过。
- `pnpm --dir windows-app build` 生产构建通过，Vite 转换 258 个模块。门禁后补充的中文动态错误文案与 Campaign cascade 专项测试亦通过 Prettier、ESLint、TypeScript 和对应 Rust 测试。
- portable `.emtavern` 仍为 format v2；schema 22 派生缓存的正式归档策略留给 M10-T05。本任务没有修改 Rules Engine、D20、Immutable Timeline、Quest/NPC/Adventure 核心合同、Provider/Queue、World Seed/Constitution 或存档状态机，也没有进入 M7-T05。
- 自然触及 UI 继续复用既有 Design Token、`ActionComposer` 与视觉手册；没有新增 CSS、平行组件体系或提前执行 M10-T07 Legacy 迁移。用户已有 `.gitignore` 修改继续保持未暂存；本任务不 merge、不 push。

## 2026-08-24 — M7-T05 Prompt Manager

### 不可覆盖 Core、版本化 User Guidance 与设备级恢复

- Prompt package 新增严格 Prompt Manager schema：最多 24 个 preset、每个最多 8 个有序块、稳定 ID、递增 version、启用状态和 AI task 闭集。Stable Prompt profile 升级为 version 3，固定前五段 Core 后追加低权限 `USER_GUIDANCE`；默认模式也保留 inactive 段，用户内容以 JSON 字符串数据进入，不能改写此前 Core、Schema、Knowledge 或提交权限。
- Native 复用 `app_settings.prompt_manager_v1`，不提升 Campaign schema。创建、更新、启用和导入都在单个 `BEGIN IMMEDIATE` 事务中比较 manager revision；更新还比较 preset version。Preset bundle 固定 `EMBER_PROMPT_PRESET` version 1，只含用户块，并复用存档秘密扫描器拒绝凭据。关闭重开 SQLite 后顺序、版本和活动状态保持一致。
- 合法设置可把活动 preset 清空恢复默认；合法 JSON 但不符合 Prompt schema 的损坏设置只能由专用 Native 恢复在事务内再次确认非法后清除。无 revision 请求不能删除一个并发出现的有效设置，错误导入/秘密/过期修改均不替换最后有效快照。
- Desktop AI Orchestrator 在每次执行开始时并行读取 Model Settings 和活动 preset，一次解析后冻结给 primary、fallback 和 structural repair。manager revision、preset ID/version 与有序块进入稳定 cache prefix，设置变化会改变 hash，动态玩家输入仍不改变稳定前缀。
- “我的”页面新增提示词管理器：Core 只读说明、活动 preset/默认恢复、preset version、块增删/排序/启用、导入导出和损坏设置安全恢复。实现复用当前表单与 Design Token，没有 Core 编辑入口、第二套 UI 体系或 SillyTavern 界面复制。
- 新增 [`V0.3_PROMPT_MANAGER.md`](V0.3_PROMPT_MANAGER.md) 与 `DEC-135`，并更新规格、Generator Framework、data model 和任务引用。Node skill 约束落实为 type-only imports、显式字段而非 parameter properties、错误 cause 保留、模型/Prompt 设置并行读取及隔离单测。

### 验证、自审与限制

- 定向测试覆盖 merge/order、task scope、Core immutability、repair、cache revision、primary/fallback冻结、version、reopen、import/export、secret scan、过期并发、默认恢复、损坏快照安全恢复和 UI 只读边界。
- `pnpm check:shared` 从头完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 152 个文件/909 项通过，另 1 个文件/1 项性能基线按设计跳过；Node 28 项通过；Rust workspace 128 项通过，另 1 项需明确 API Key 授权的真实 Provider 测试忽略；rustfmt、全 workspace 严格 Clippy及 TypeScript↔Rust archive interop 全部通过。
- `pnpm --dir windows-app build` 生产构建通过，Vite 转换 261 个模块。没有删除测试、降低校验、写死结果、忽略错误、修改 Campaign schema 或把 Core/秘密放进 bundle。
- 本任务没有修改 Rules Engine、D20、AI Provider协议、Generation Queue、World Seed/Constitution、Quest/NPC/Adventure 核心业务合同或存档状态机，也没有进入 M8-T01。视觉手册继续有效；完整 Legacy UI 迁移仍由 M10-T07 统一处理。
- 用户已有 `.gitignore` 修改继续保持未暂存；本任务不 merge、不 push。

## 2026-08-24 — M8-T01 Multi-Quest Pool

### 多任务真相源、玩家介入与终态保护

- Quest合同扩展到HIDDEN、DISCOVERED、AVAILABLE、兼容ACCEPTED、ACTIVE、BLOCKED、UPDATED、COMPLETED、FAILED、EXPIRED、ABANDONED，并增加有界转换来源。Domain冻结完整合法边；完成、失败、过期和放弃均为不可逆终态。
- schema 23新增`quest_pool_states`生命周期真相源、append-only `quest_pool_transitions`和仅供内部快照事务使用的`quest_pool_restore_sessions`。迁移原样回填所有旧Quest；revision、operation、来源、原因与时间均持久化，旧`quests.status`不能覆盖已经分叉的新状态。
- TypeScript Repository与Rust Native分别验证状态图、来源语义、乐观revision和幂等重放。Rules Engine、Faction、Adventure开始及结算改为在原业务事务内转换Quest Pool，不改变D20、奖励、NPC、Adventure或其他业务合同。
- 内部自动快照现在保存并精确恢复Pool和转换账本；schema 23前的旧内部快照从其Quest状态建立revision 1迁移记录。恢复门禁只在立即事务内生效，普通业务路径仍不能删除历史。
- Quest UI隐藏HIDDEN，展示状态原因/revision，允许多个任务同时ACTIVE。玩家“介入任务”从可见候选直接激活，不需要唯一主任务或传统接受门禁；兼容accept入口仍可服务旧Adventure流程，但不再限制其他任务。
- 新增[`V0.3_MULTI_QUEST_POOL.md`](V0.3_MULTI_QUEST_POOL.md)与`DEC-136`，并更新V0.3规格、data model和任务引用。Node技能约束落实为type-only imports、显式字段、错误cause/rollback链、事务savepoint与隔离测试。

### 验证、自审与限制

- 专项测试覆盖全部状态和合法/非法转换、多Active、玩家直接介入、终态不可改写、幂等与竞争revision、schema 22→23回填、关闭重开、自动快照恢复、Rules/Faction/Adventure跨模块事务和隐藏任务UI。
- `pnpm check:shared`从头完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 154个文件/915项通过，另1个文件/1项性能基线按设计跳过；Node 29项通过；Rust workspace 130项通过，另1项需明确API Key授权的真实Provider测试忽略；rustfmt、全workspace严格Clippy及TypeScript↔Rust archive interop全部通过。
- `pnpm --dir windows-app build`生产构建通过，Vite转换262个模块。没有删除测试、降低校验、写死结果、忽略错误或回滚已完成任务。
- portable`.emtavern`仍为format v2；schema 23正式跨版本归档严格留给M10-T05。M8-T02 Quest Graph、M8-T03动态来源和World Director均未提前实现。
- 新增UI复用既有Quest页面、组件和Design Token，没有新增CSS或平行组件体系；视觉手册与M10-T07 Legacy迁移门禁保持有效。用户已有`.gitignore`修改继续保持未暂存；本任务不merge、不push。

## 2026-08-24 — M8-T02 Quest Graph

### 本地依赖图、事务重评估与可审计投影

- 新增Quest Graph合同与纯Domain求值器。来源闭集为Quest、World Fact、NPC、Faction和Location；同目标PREREQUISITE采用AND，CONSEQUENCE使用显式priority，相同priority冲突、语义重复、悬空引用、政策冲突和Quest→Quest循环全部fail closed。
- 求值使用稳定拓扑顺序，并在一次事务内消费前序Quest的新状态，支持A→B→C链式传播和A→B/C分支。所有目标变化继续通过Quest Pool合法转换验证；COMPLETED、FAILED、EXPIRED、ABANDONED终态不可被图重开。
- schema 24新增`quest_graphs`、当前边、append-only完整图修订和append-only求值事件。TypeScript Repository与Rust Native都验证Campaign引用、revision、幂等operation和当前SQLite实体状态；AI、Generator和UI不能宣告依赖满足或直接写Quest状态。
- Quest Pool根转换在原事务内触发`QUEST_TRANSITION`重算，Faction行动完成其Profile/World Fact变化后触发`FACTION_CHANGE`重算。Native另提供受验证的World Fact、NPC、Location和手动重算入口，供对应本地事务及M8-T03来源适配器复用，不复制状态机。
- 内部自动快照保存并精确恢复当前图、图修订与求值历史；schema 24前旧内部快照恢复为空图revision 1。portable`.emtavern`format v2保持不变，schema 24正式跨版本归档仍由M10-T05处理。
- Quest Board快照新增最近20次求值和边的只读折叠调试投影，显示来源、谓词、目标、结果和变化数。页面复用现有Quest布局与Design Token，没有新增CSS、编辑权限或平行组件体系。
- 新增[`V0.3_QUEST_GRAPH.md`](V0.3_QUEST_GRAPH.md)与`DEC-137`，并更新V0.3规格、data model和任务引用。此前持久化的视觉手册、视觉债务与M10-T07迁移门禁保持有效；本任务没有逐页返工Legacy UI。

### 验证、自审与限制

- 专项测试覆盖chain、branch、cycle、dangling reference、前置政策/priority冲突、NPC死亡、Faction、Location、World Fact后果、事务回滚、自动快照和关闭重开；Rust集成验证Quest根转换与依赖变化同事务提交并跨重启保持。
- `pnpm check:shared`从头完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 156个文件/920项通过，另1个文件/1项性能基线按设计跳过；Node 29项通过；Rust workspace 132项通过，另1项需明确API Key授权的真实Provider测试忽略；TypeScript↔Rust archive interop通过。
- `cargo fmt --check`与全workspace严格Clippy通过；`pnpm --dir windows-app build`生产构建通过，Vite转换264个模块。没有删除测试、降低校验、写死求值结果、忽略错误或让LLM取得规则权限。
- 本任务不修改Rules Engine、D20硬结果、AI Provider、Generation Queue、World Seed/Constitution、Quest/NPC/Adventure内容合同或存档状态机，也没有进入M8-T03。用户已有`.gitignore`修改继续保持未暂存；本任务不merge、不push。

## 2026-08-24 — M8-T03 完成 Dynamic Quest Sources

### 开始状态与边界

- 在分支 `task/M8-T03-dynamic-quest-sources`、起始提交 `f4e2074` 上继续；未回滚或重做 M0–M8-T02，用户已有 `.gitignore` 修改全程未暂存。
- 本任务只实现 NPC/Faction/World Event/Discovery/Player Action/Consequence 六类 Quest source adapter。没有进入 M8-T04 World Director 或 M8-T05 Director Budget，也没有自动为每个玩家行为创建任务。

### 实现

- 新增 Dynamic Quest source/provenance、Constitution context、相关事实白名单、同步开放任务安全预算和本地初始状态合同；`PLAYER_ACTION` 显式来源直接进入 `ACTIVE`，Discovery 进入 `DISCOVERED`，隐藏 Faction/Consequence 保持 `HIDDEN`。
- `GENERATE_QUEST` 输入 Schema 与 Prompt 升至 version 3，可接收本地 source、relevant facts、Constitution 和 generation budget；Core Prompt 明确模型无权决定来源、状态、可见性、provenance 或预算。旧初始化输入保持兼容。
- schema 25 新增一次性 `quest_pool_creation_intents` 和 append-only `dynamic_quest_sources`。六类 occurrence、Campaign、NPC/Fact、Generation Record 均由唯一约束、外键和 trigger 校验；内部快照捕获并按依赖顺序恢复 provenance。
- TypeScript Repository 与 Rust Native 均执行来源投影、SHA-256 规范上下文、同源去重、预算门禁、引用白名单和事务提交。Native 额外重验完整 generation input/context、8–12 回合、重复 Quest 结构及 generation audit，失败无部分写入。
- Windows 新增显式 `dynamic_quest_prepare` / `dynamic_quest_commit` 命令和服务；相同在途来源合并，已有 provenance 直接加载而不再次调用模型。错误保留 cause，idempotency 与 durable occurrence 绑定。
- NPC adapter 只读取玩家已见的正式提交回复，测试确认 Actor-private Knowledge 不进入输入。Quest Board 的 Quest、最近生成历史和 Windows Quest Graph 投影统一过滤隐藏 Quest；完整 SQLite 图仍供本地规则与内部审计使用。
- 新增 [`V0.3_DYNAMIC_QUEST_SOURCES.md`](V0.3_DYNAMIC_QUEST_SOURCES.md)、`DEC-138`、V0.3 Spec/Data Model/Migration 索引，并将 M8-T03 标记 DONE。未新增 UI/CSS；视觉手册、Design Token、既有 Game Component 和 M10-T07 迁移边界保持不变。

### 验证

- 首轮共享门禁发现 `GENERATE_QUEST` Schema version 测试仍期望 2，以及 Clippy 建议 `sort_by_key`；均按新 version/惯用 Rust 修正后重验。
- Prettier、release metadata、zh-CN 玩家语言、ESLint、TypeScript：通过。
- Vitest：159 files passed、1 skipped；927 tests passed、1 skipped。覆盖六类来源、私有知识隔离、同源并发、重放、Constitution 输入、预算原子拒绝和服务错误 cause。
- Node：29 tests passed。schema 25 新库、重复启动、旧库升级副本、备份失败与完整性约束均通过。
- Rustfmt、Clippy `-D warnings`：通过。Rust workspace：133 passed、1 ignored；Native 动态玩家行动/隐藏后果创建、去重、安全图投影和关闭重开通过。
- archive interoperability：TypeScript 13 + Rust 1 + TypeScript 13 均通过。
- Desktop production build：通过，Vite 266 modules transformed。

### 结束状态

- `M8-T03` 完成；下一项严格为 `M8-T04 World Director`，本次未开始。
- portable `.emtavern` format v2 保持不变；schema 25 正式跨版本归档仍留给 M10-T05。12 个开放任务上限仅为本 adapter 的 fail-closed 安全阀，不替代 M8-T05 的持久每日预算和 cooldown。
- Rules Engine、D20、Provider、Generation Queue、SQLite 真相源、Save/Resume、World Seed/Constitution 与 Quest/NPC/Adventure 核心业务合同未被视觉规范或本任务重构；不 merge、不 push。

## 2026-08-24 — M8-T04 完成 World Director

### 开始状态与边界

- 在分支 `task/M8-T04-world-director`、起始提交 `43652a9` 上继续；未回滚或重做 M0–M8-T03，用户已有 `.gitignore` 修改全程未暂存。
- World Director 冻结为本地确定性调度器，不是 AI Agent 或第二事实源。本任务只实现节奏评估、实体行动提案、显式触发调度和可解释审计；没有进入 M8-T05 的持久每日预算、cooldown、day rollover 或 starvation。
- 再次核对用户视觉手册附件与 `docs/EMBER_TAVERN_VISUAL_STYLE_GUIDE_V1.md` 的 SHA-256 均为 `1ef31784546fb0bd5fc35022741d18522ac977781f933580dc1ffa5f8d854c7e`。既有 V0.3 Spec、视觉债务与 M10-T07 收敛任务已完整覆盖 Design Token 至 Visual Consistency Audit，无需建立第二套 UI 体系；本任务没有新增 UI/CSS。

### 实现

- 新增共享 Director action/pace/route/trigger/suppression、preparation 和 immutable run 合同，以及 TypeScript 纯 Domain 求值器。压力由 Active/Blocked Quest、临界 Clock、敌对 Active Faction 和近期失败确定；quiet、balanced、pressured、overloaded 四档使用稳定规则和最多八项有界提案。
- 自然过期按 Quest 创建后数据库累计的 committed `WORLD_CLOCK_ADVANCED` 计数判断：DISCOVERED/AVAILABLE 为三次，BLOCKED 为五次，不会因最近二十条事件窗口被其他事件挤占。过载只保留收敛性的 `QUEST_EXPIRE`，新 pressure/foreshadow/Faction 内容均附明确抑制原因。
- schema 26 新增 append-only `world_director_runs` 和有序 `world_director_proposals`。Campaign/trigger/事件类型、唯一重放、rank、route 与 JSON 均由约束/trigger 验证；内部快照捕获、按外键顺序恢复，并兼容 schema 26 前空集合。
- TypeScript Repository 与 Rust Native 读取相同 SQLite 投影，计算 canonical SHA-256 context digest，在 immediate transaction 中重算并拒绝陈旧上下文，只追加审计而不写 World Fact、Quest、Clock、Faction、NPC、Adventure、Message 或 Game Event。精确 trigger replay 幂等，冲突身份 fail closed。
- Tauri 新增 prepare/commit/history 命令；Windows 服务仅接受显式 MANUAL/WORLD_EVENT/PLAYER_ACTION/QUEST_TRANSITION/SETTLEMENT trigger，相同在途触发合并，历史只读且保留 signals、rationale、effects、route、cooldown key、suppression 和 source snapshot。服务没有 `AIProvider`、timer 或后台模型调用循环。
- 新增 [`V0.3_WORLD_DIRECTOR.md`](V0.3_WORLD_DIRECTOR.md) 与 `DEC-139`，并更新 V0.3 Spec、Data Model、Migration 索引和任务引用。portable `.emtavern` format v2 保持不变；schema 26 正式跨版本归档仍留给 M10-T05。
- Node skill 约束落实为 type-only imports、显式类字段而非 parameter properties、错误 cause/rollback 链、prepare/commit 隔离边界和独立服务测试。提交前自审进一步把 TypeScript locale/UTF-16 排序与截断改为和 Rust 一致的 Unicode code-point 顺序及字符上限。

### 验证、自审与限制

- 专项测试覆盖 quiet opportunity、foreshadow、pressure、自然 expiry、overload suppression、确定性顺序、触发合并、只读解释历史、失败 cause、陈旧 digest 原子拒绝、幂等重放、关闭重开、无事实副作用和内部快照恢复。
- `pnpm check:shared` 在最终工作树从头完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 162 个文件/938 项通过，另 1 个文件/1 项性能基线按设计跳过；Node 29 项通过。
- Rustfmt、全 workspace 严格 Clippy 与 archive interoperability 通过。Rust workspace 135 项通过，另 1 项需明确 API Key 授权的真实 Provider 测试忽略；其中 Native Bridge 90 项包含两项新增 Director 持久化/失败安全测试。
- `pnpm --dir windows-app build` 生产构建通过，Vite 转换 268 个模块。没有删除测试、降低校验、写死结果、忽略错误或让 Director/LLM 获得事实写权限。
- 单次最多八项只是 payload 安全上限，不冒充 M8-T05 的 durable budget/cooldown。M8-T04 完成后下一项严格为 M8-T05，本次未开始；不 merge、不 push。

## 2026-08-24 — M8-T05 完成 Director Budget

### 边界与实现

- 在分支 `task/M8-T05-director-budget`、起始提交 `3d8af9c` 上继续；未回滚或重做 M0–M8-T04，用户已有 `.gitignore` 修改全程未暂存。本任务未进入 M9，也未新增 UI/CSS。
- 冻结 Active Quest 4、每日事件 4、紧急事件 2、NPC 主动 2、后台变化 3 的本地上限。Rules Engine `game_time_minutes` 是唯一时钟，每 1440 分钟惰性恢复；墙钟、Prompt和模型均无预算权限。
- Proposal 映射、cooldown、容量判断和 waiting-age 防饥饿排序由 TypeScript Domain 与 Rust Native实现。Quest更新/过期为免额度维护；Pressure同时占每日和紧急额度；Opportunity计入Active Quest预约。
- schema 27新增状态、run admission、持久proposal队列、cooldown和append-only decision。批准先预约容量以阻断失败重试放大；延后保留原因和eligible game time；空run也精确幂等。内部快照保存全部预算表，SQLite关闭重开保持day/usage/queue/cooldown/revision。
- Tauri新增admit/read命令，Windows服务在现有World Director提交后执行预算准入。玩家P0操作不进入预算通道；PLAYER_ACTION仅可能产生受预算的派生提案。
- 新增[`V0.3_DIRECTOR_BUDGET.md`](V0.3_DIRECTOR_BUDGET.md)与`DEC-140`，更新V0.3 Spec、Data Model和任务引用。portable `.emtavern` format v2保持不变，schema 27正式跨版本归档仍留给M10-T05。
- 视觉规范继续作为全局标准；本任务没有换色、逐页返工或创建第二套组件体系，M10-T07的Design Token→Primitive→Game Component→Feature→Legacy→Audit收敛顺序不变。

### 验证

- 专项测试覆盖类别与上限、cooldown、游戏日恢复、Active Quest预约、优先级aging、防饥饿、空run幂等、内部快照、SQLite重开、Windows编排和错误cause。
- `pnpm check:shared` 在最终工作树从头通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 165 files / 947 tests通过，另1 file / 1 test性能基线按设计跳过；Node 29 tests通过。
- Rust workspace 125 tests通过，另1项需明确API Key授权的真实Provider测试忽略；其中Native Bridge 91 tests包含新增预算持久化/日恢复测试。Rustfmt、全workspace严格Clippy及TypeScript↔Rust archive interop全部通过。
- Desktop production build通过，Vite转换270 modules。首轮门禁发现portable archive本地schema上限仍为26；提升到27后，archive专项、Windows E2E与完整门禁均从头复验通过。没有删除测试、降低校验或忽略错误。
- M8-T05完成后下一项严格为M9-T01，本次未开始；用户`.gitignore`保持未暂存，不merge、不push。

## 2026-08-24 — M9-T01 完成 Unified Context Builder

### 边界与实现

- 在分支`task/M9-T01-unified-context-builder`、起始提交`84a987a`上继续；未回滚或重做M0–M8-T05，用户`.gitignore`修改保持未暂存。本任务未进入M9-T02，也未新增UI/CSS或SQLite迁移。
- 新增统一十层Context合同：SYSTEM→CONSTITUTION→LORE→LOCATION→PLAYER→ACTOR_KNOWLEDGE→QUEST_STATE→MEMORY→RECENT→ACTION。每个字段形成带source/revision/stability/privacy/hash/token/relevance的immutable block；实体自身revision/schemaVersion优先成为审计revision。
- 可选字段支持relevance与`not_relevant`/`block_budget`/`total_budget`可观察省略；required block超限fail closed且JSON不截断。最终投影继续执行既有task character budget。
- 统一边界递归拒绝database/tables/allRows等全库envelope及credential-shaped字段。Actor Knowledge/Memory source在Inspector中遮罩；NPC授权profile内的叙事secret不被错误当作API凭据。
- DesktopAIOrchestrator在Provider/Prompt执行前构建一次并冻结给primary/fallback/repair；Application AI Turn和primary task helper复用相同入口。14个Windows生成服务均继续通过DesktopAIEngine，不新增页面栈或Provider旁路。
- 既有NPC/Adventure/World Event builder保留为领域adapter，继续执行Campaign、Actor Knowledge、Quest和Recent相关性过滤；M9-T03未来检索评分使用同一个optional/relevance接口，不复制体系。
- 新增[`V0.3_UNIFIED_CONTEXT_BUILDER.md`](V0.3_UNIFIED_CONTEXT_BUILDER.md)与`DEC-141`，更新V0.3 Spec、Generator Framework、Data Model和任务引用。视觉规范和M10-T07迁移边界保持不变。

### 验证

- 专项测试覆盖十层顺序、字段相关性分类、irrelevant/budget omission、required保留、credential/full DB隔离、revision、每个AITask统一入口、Inspector脱敏、Application manifest及primary/fallback/repair冻结。
- `pnpm check:shared`完整通过：Prettier、ESLint、TypeScript、release/i18n、Vitest 166 files/955 tests通过（另1 file/1 test为显式skip的performance baseline runner）、Node 29 tests、Rust workspace 125 tests通过（另1项需明确API Key授权的真实Provider测试ignored），archive interop通过。
- 额外独立复验Rustfmt、全workspace/all-targets/all-features严格Clippy与Desktop production build均通过；Vite转换271 modules。不删除测试、不降低校验、不忽略错误。

## 2026-08-24 — M9-T02 完成 Memory Layers

### 边界与实现

- 在分支`task/M9-T02-memory-layers`、起始提交`4c1c188`上继续；用户`.gitignore`修改保持未暂存。本任务未进入M9-T03，未实现检索/向量/Lore trigger，也未新增UI/CSS。
- 固定Structured Fact、Recent、Summary、Long-term Memory、World Lore五层权威。Truth/Claim/Actor Knowledge与原Message/Event/Turn不重造；派生Summary/Lore/Memory无Truth authority，压缩不删除原史。
- schema 28新增Historical Summary、World Lore和共享source snapshot。每个派生artifact保存Campaign/Actor、来源revision/hash/time、digest、generation record和连续revision；来源删除/更新可观察为stale，current-only列表不再投影。
- 现有`knowledge_memories`继续是唯一通用Long-term Memory表。`EXTRACT_MEMORIES`除turn citation外必须有程序验证的Actor Knowledge/Event来源；同一SQLite事务幂等提交legacy NPC兼容视图、通用Memory与请求终态，任一投影冲突都会整体回滚。TypeScript与Native NPC上下文优先current通用Memory，否则兼容回退legacy隔离列表。
- 内部snapshot首次纳入schema 12四张知识表和schema 28三张memory表，旧payload按空集合恢复。portable `.emtavern` v2按既定边界不升级，完整跨语言格式迁移仍留给M10-T05。
- 新增[`V0.3_MEMORY_LAYERS.md`](V0.3_MEMORY_LAYERS.md)与`DEC-142`，更新V0.3 Spec、Unified Context、Data Model、migration说明和任务引用；视觉规范/M10-T07边界不变。

### 验证

- 专项覆盖promotion rules、Summary/source digest drift、source update/delete、Actor isolation、Long-term Memory freshness与幂等重放、双视图冲突整体回滚、旧史保留、generation provenance、本地reopen和internal snapshot round-trip；TypeScript对话生成记录证明current通用Memory优先于legacy视图，Native NPC测试证明Knowledge revision变化后stale Memory不再进入Prompt。
- `pnpm check:shared`完整通过：Prettier、ESLint、TypeScript、release/i18n、Vitest 168 files/962 tests通过（另1 file/1 test为显式skip的performance baseline runner）、Node 29 tests、Rust workspace 136 tests通过（另1项需明确API Key授权的真实Provider测试ignored），archive interop通过。
- 额外独立复验Rustfmt、全workspace/all-targets/all-features严格Clippy与Desktop production build均通过；Vite转换272 modules。不删除测试、不降低校验、不忽略错误。

## 2026-08-24 — M9-T03 完成 Retrieval Interface & World Info

### 边界与实现

- 在分支`task/M9-T03-retrieval-world-info`、起始提交`d439adb`上继续；用户`.gitignore`修改保持未暂存。本任务未进入M10-T01，未增加UI/CSS、外部向量依赖、第二套Context栈或Lorebook复制实现。
- 新增Campaign-scoped结构化query与版本化Lore rule：bounded keyword、闭集entity、Location、Quest、always-active、ANY/ALL、priority、entry/total token budget、enabled与CAS revision。SQLite schema 29和Repository双重拒绝畸形JSON、跨Campaign引用、身份修改和revision跳跃。
- 纯Domain selector先排除stale/unconfigured/disabled，再产生ALWAYS/KEYWORD/ENTITY/LOCATION/QUEST具名证据；Latin关键词使用完整边界避免`port`误命中`portal`，CJK使用规范化substring。结果按priority→score→Lore ID稳定排序且不截断内容，完整manifest记录每条Lore的选择或省略原因。
- `WorldInfoCandidateSource`隔离候选来源；当前SQLite adapter可离线工作，未来RAG只能替换该port并继续经过本地裁决。应用层有界LRU以规范query digest+完整corpus digest为key，Lore/source freshness/rule/query变化均自动miss，SQLite仍是唯一真相。
- Application NPC对话按玩家文本、当前NPC、Tavern Location及相关非终态Quest检索，将选择结果注入既有Unified Context `LORE`层。`NPC_REPLY` Schema/Prompt升至v5并明确Lore不授予Actor Knowledge；回复、关系、Memory、不可重写时间线和提交事务语义不变。Windows既有native snapshot尚无Lore字段时显式使用空集合，避免把缺失上下文伪装成检索命中。
- 内部snapshot纳入`world_lore_retrieval_rules`并兼容旧payload。portable`.emtavern`保持format v2，schema 29跨语言归档仍与其他V0.3表统一留给M10-T05。
- 新增[`V0.3_WORLD_INFO_RETRIEVAL.md`](V0.3_WORLD_INFO_RETRIEVAL.md)与`DEC-143`，更新V0.3 Spec、Memory、Unified Context、Data Model、migration与任务引用。视觉规范和M10-T07迁移边界保持不变。

### 验证

- 专项测试覆盖keyword/entity/location/quest/always触发、ANY/ALL、false match、priority、score、entry/total budget、stale/disabled/unconfigured原因、rule/source/Lore/query缓存失效、跨Campaign拒绝、畸形更新、SQLite重开语义、internal snapshot及NPC生产请求的LORE注入。
- 首轮完整门禁暴露Windows旧generation context缺少新必填字段及cache regression仍固定v4；补入显式空Lore兼容投影并推进缓存断言后，相关6项测试及完整门禁从头复验通过，没有降低Schema或跳过测试。
- `pnpm check:shared`最终通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 172 files/970 tests通过，另1 file/1 test性能基线按设计跳过；Node 29 tests通过。
- Rust workspace 136 tests通过，另1项需明确API Key授权的真实Provider测试ignored；rustfmt、全workspace/all-targets/all-features严格Clippy及TypeScript↔Rust archive interop全部通过。Desktop production build通过，Vite转换274 modules。
- M9-T03完成后下一项严格为M10-T01；本次未开始。用户`.gitignore`保持未暂存，不merge、不push。

## 2026-08-24 — M10-T01 完成 Lazy World Generation

### 边界与实现

- 在分支`task/M10-T01-lazy-world-generation`、起始提交`4f18e42`上继续；未回滚或重做M0～M9-T03，用户已有`.gitignore`修改保持未暂存。本任务没有进入M10-T02 Prefetch，也没有新增UI/CSS。
- 冻结核心骨架为Campaign、锁定World Constitution、World Seed、World Bible及outline Location/Faction。Application和Native世界确认均在同一事务持久化计划，但不会生成Career Pool、Tavern、NPC、Quest、Item、详细Location或active Faction。
- schema 30新增唯一materialization plan与append-only transition。三个全局P0按需计划覆盖初始职业池、酒馆和依赖酒馆的阵容；outline Location/Faction只登记P2 `BACKGROUND_ELIGIBLE`，不在本任务执行后台生成。
- TypeScript合同、纯Domain计划器和Repository实现claim、同run dedupe、冲突run拒绝、dependency、complete、retryable failure、cancel、interrupted recovery、artifact reconciliation和CAS revision。SQLite trigger验证Campaign边界、合法转换并要求真实artifact，无法用占位内容完成。
- Native职业池、酒馆、阵容、动态Location与主动Faction继续沿用既有Generator、验证与事务，在真实SQLite实体写入后原子reconcile计划；Location计划以outline origin为目标并引用一个新提交的相连/子级DETAILED artifact。旧存档没有bootstrap plan时保持原路径兼容。部分Roster失败不会破坏已提交Tavern。
- internal snapshot纳入plan/history、旧payload空集合兼容，并使用现有restore session恢复非初始状态和append-only历史。portable`.emtavern`仍为format v2；schema 30正式跨语言升级严格留给M10-T05。
- 新增[`V0.3_LAZY_WORLD_GENERATION.md`](V0.3_LAZY_WORLD_GENERATION.md)、`DEC-144`，更新V0.3 Spec、Data Model、migration与任务引用。视觉规范、视觉债务和M10-T07的Token→Primitive→Game Component→Feature→Legacy→Audit边界保持不变。

### 验证

- 专项测试覆盖cold start、no full-world generation、seed/claim dedupe、并发run拒绝、占位完成拒绝、dependency、partial failure、cancel/reopen、响应丢失reconcile、中断retry、snapshot round-trip与世界确认计划原子创建。
- 首轮完整门禁的Windows纵向E2E暴露plan dependency使用`ON DELETE RESTRICT`会阻断整Campaign级联删除；改为同Campaign依赖级联后，迁移测试与该E2E专项通过，并从头重跑完整共享门禁。没有绕过外键或削弱删除验收。
- 最终`pnpm check:shared`通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 175 files/978 tests通过，另1 file/1 test性能基线按设计跳过；Node 29 tests通过。
- Rust workspace 136 tests通过，另1项需明确API Key授权的真实Provider测试ignored；rustfmt、全workspace/all-targets/all-features严格Clippy与TypeScript↔Rust archive interop全部通过。Desktop production build通过，Vite转换276 modules。
- 不删除测试、不降低Schema/SQLite约束、不跳过错误，也不把M10-T02预取或M10-T05 portable迁移冒充完成。

### 结束状态

- `M10-T01`完成；下一项严格为`M10-T02 Prefetch`，本次未开始。
- 用户`.gitignore`保持未暂存，不merge、不push。

## 2026-08-24 — M10-T02 完成 Prefetch

### 边界与实现

- 在分支`task/M10-T02-prefetch`、起始提交`5a41eb0`上继续；未回滚或重做M0～M10-T01，用户已有`.gitignore`修改保持未暂存。本任务未进入M10-T03，也未新增UI/CSS。
- 新增Director预取纯Domain预测：只接受同Campaign、已预算admit的run与`BACKGROUND_ELIGIBLE` Location/Faction计划；批准目标升为P1，其余P2受background剩余容量约束，每run最多四项并稳定排序，不复制source snapshot、rationale或private knowledge。
- 新增Application planning/coordinator：只要存在未完成P0即取消并失效预取；新run supersede旧run；共享Generation Queue保证P0优先、P1高于P2并保留背景lane。队列饱和记录`PREFETCH_QUEUE_REJECTED`而不替换前台任务。
- 生成候选只保存在当前process memory。精确Campaign/kind/target/context digest命中后才返回给原业务采用；未就绪、未预测、context变化、重启、取消和执行失败均形成明确终态。预取路径没有世界commit port，现有Location/Faction Domain/Native验证与原子事务仍是唯一事实写入路径。
- schema 31新增`prefetch_candidates`与append-only `prefetch_events`。SQLite复核Director admission/context、approved P1 action及其真实actor/target绑定、P2容量、lazy plan资格、状态机、execution/process ownership、revision和四项上限；表中不保存Prompt、response、output、content或Knowledge。Repository提供命中率及queue/generation平均时间。
- internal snapshot纳入候选/事件且兼容旧payload；重开必须使无内存body的候选失效。portable`.emtavern`仍为format v2，schema 31正式跨语言升级留给M10-T05。
- 新增[`V0.3_PREFETCH.md`](V0.3_PREFETCH.md)与`DEC-145`，更新V0.3 Spec、Generator Framework、Data Model、migration与任务引用。视觉手册、视觉债务和M10-T07的Token→Primitive→Game Component→Feature→Legacy→Audit边界保持不变。

### 验证

- 专项测试覆盖Director批准/延后、P1/P2、恶意P1目标重绑定拒绝、稳定有界预测、P0门禁、前台优先、queue saturation、ready hit、not-ready/unpredicted miss、context invalidation、P0 cancel、process restart、预算拒绝batch rollback、候选无内容列、指标、整Campaign级联删除和internal snapshot round-trip。
- 首轮全量Node门发现database startup测试仍固定schema 30；只推进期望到31后，startup/migration专项11项重新通过，没有降低迁移或备份门禁。
- 最终`pnpm check:shared`从头通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 179 files / 995 tests通过，另1 file / 1 test性能基线按设计跳过；Node 29 tests通过。
- Rust workspace 136 tests通过，另1项需明确API Key授权的真实Provider测试ignored；rustfmt、全workspace/all-targets/all-features严格Clippy与TypeScript↔Rust archive interop全部通过。Windows纵向E2E包含删除/重开链并通过；Desktop production build通过，Vite转换278 modules。
- 不删除测试、不降低SQLite/Schema校验、不忽略错误，也不把M10-T03 Streaming或M10-T05 portable迁移冒充完成。

### 结束状态

- `M10-T02`完成；下一项严格为`M10-T03 Streaming`，本次未开始。
- 用户`.gitignore`保持未暂存，不merge、不push。

## 2026-08-24 — M10-T03 完成 Streaming

### 边界与实现

- 在分支`task/M10-T03-streaming`、起始提交`980f187`上继续；未回滚或重做M0～M10-T02，用户已有`.gitignore`修改保持未暂存。本任务未进入M10-T04，也未扩大Rules、D20、Quest、NPC、Adventure或Persistence业务合同。
- `AIProvider.generate`保持必需，新增capability-gated可选`generateStream`。旧配置和不支持流的Provider继续完整响应；DeepSeek、Qwen、OpenRouter与Ollama的新probe可记录streaming能力。Primary产生任何片段后不再切换fallback。
- OpenAI-compatible Native发送`stream: true`，复用secure HTTP byte limit、overall timeout与CancellationToken。SSE decoder在byte层组装UTF-8/frame，要求合法JSON、稳定model、完整`[DONE]`；Tauri Channel按request ID发送连续sequence，最终仍返回一个完整Normalized response。
- 有界Native stream registry覆盖active cancel和cancel-before-register竞态。TypeScript共享orchestrator再次验证sequence、总大小和`chunks.join('') === final.content`，取消、顺序错误或final mismatch均fail closed。
- 新增顶层结构化字符串projector，处理跨chunk escape、Unicode escape与surrogate pair，拒绝嵌套同名字段冒充。NPC只显示`reply`，初始世界介绍只显示`summary`，不会向玩家展示原始JSON。
- NPC复用durable timeline和原commit事务；取消/超时/畸形final只形成可重试失败，不插入半条Player/NPC消息。响应丢失后仍以SQLite COMMITTED为准。World只在完整Schema通过后调用原`world_generation_commit`。
- NPC页面复用`ActionComposer` streaming/Cancel状态；World介绍复用同一stream output视觉样式与现有按钮。新增状态遵守[`EMBER_TAVERN_VISUAL_STYLE_GUIDE_V1.md`](EMBER_TAVERN_VISUAL_STYLE_GUIDE_V1.md)，没有新增硬编码视觉值、平行组件体系或Legacy逐页返工。
- 新增[`V0.3_STREAMING.md`](V0.3_STREAMING.md)与`DEC-146`，更新V0.3 Spec和任务引用；M10-T07的Token→Primitive→Game Component→Feature→Legacy→Audit顺序不变。

### 验证

- 专项测试覆盖SSE chunk order、byte-split Unicode、structured Unicode/surrogate、取消竞态、畸形/缺失final、final mismatch、NPC timeout retry、response-loss恢复、NPC/World no partial commit、非流式Provider兼容和NPC/World streaming UI。
- 自审补强active/pre-dispatch取消区分与30秒tombstone TTL，避免完成后晚到cancel造成registry容量泄漏；并在流式草稿进入既有repair前显式清空临时投影，repair仍以完整响应验证且不拼接旧草稿。首轮完整门禁只发现`FinishReason::Default`可派生的严格Clippy问题，按编译器建议修正后从最终工作树完整重跑。
- 最终`pnpm check:shared`通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 180 files / 1008 tests通过，另1 file / 1 test性能基线按设计跳过；Node 29 tests通过。
- Rust workspace 141 tests通过，另1项需明确API Key授权的真实Provider测试ignored；rustfmt、全workspace/all-targets/all-features严格Clippy、Windows纵向E2E及TypeScript↔Rust archive interop全部通过。Desktop production build通过，Vite转换279 modules。

### 结束状态

- `M10-T03`实现与完整门禁完成；本地提交前不进入`M10-T04 Cache Optimization`。
- 用户`.gitignore`保持未暂存，不merge、不push。

## 2026-08-24 — M10-T04 完成 Cache Optimization

### 边界与实现

- 在分支`task/M10-T04-cache-optimization`、起始提交`d14b0db`上继续；未回滚或重做M0～M10-T03，用户已有`.gitignore`修改保持未暂存。本任务未进入M10-T05，未新增SQLite schema，也未修改Rules、D20、Queue、Quest/NPC/Adventure或存档业务合同。
- Stable Prompt Profile推进到v4。Desktop primary/fallback/repair与Application默认turn formatter从同一次Unified Context assembly投影`stable/rules`，将Constitution/locked rules的规范内容、source revision和block version加入实际稳定前缀；随机ID、UUID、墙钟、request/cache/UI元数据、Actor Knowledge、Recent与Action均不进入。
- 完整原任务输入仍保留在动态尾部，不以缓存命中牺牲正确上下文。相同稳定语义生成逐字节一致前缀；Prompt Manager、Profile、Constitution revision或规则内容变化会失效。
- AI Inspector把Provider明确usage得到的`HIT/MISS/UNKNOWN`与进程内`PREFIX_FIRST_SEEN/PREFIX_REUSED`分字段展示。会话LRU只保留200个hash；DeepSeek设备指标继续原子保留最近200项且不保存Prompt、message、request ID、credential或玩家输入。
- 指标白名单补齐Quick Character、Advanced Edit与Dialogue Suggestions。Rust专项测试暴露ratio经JSON往返后严格浮点相等可能误拒绝合法指标，修为只接受`f64::EPSILON`内序列化误差，整数hit/miss与计算语义保持严格。
- 新增[`V0.3_CACHE_OPTIMIZATION.md`](V0.3_CACHE_OPTIMIZATION.md)与`DEC-147`，更新V0.3 Spec和任务引用。视觉手册继续全局有效；本任务只在既有AI Inspector指标区增加证据标签，复用现有组件/Token，没有Legacy逐页返工，M10-T07收敛顺序不变。

### 性能与真实Provider证据

- 使用M1-T04同一Fake Provider schema每任务10次重跑：World P50/P95 0.120/2.294 ms、NPC 0.204/1.845、Quest 0.061/0.601、Action 0.096/1.237、D20 0.032/0.241。两轮均保留受控Quest failure与Action retry；token/cache为unknown，未伪造0，单机微秒级差异不宣称性能改善或回归。
- 真实DeepSeek测试继续是显式API Key opt-in的ignored test，覆盖相同stable system、不同dynamic input、同prefix hash、Provider hit token与SQLite重开。常规门禁未读取Key、未调用真实Provider，真实验证状态为NOT_RUN。

### 验证

- 专项测试覆盖stable byte equality、动态行动隔离、Constitution revision失效、UUID/时间/private knowledge隐私、桌面生产请求、Prompt Manager失效、session/Provider证据分离及TypeScript/Rust/session三处200项上限。
- `pnpm check:shared`从最终工作树通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 181 files / 1015 tests通过，另1 file / 1 test性能runner按设计跳过；Node 29 tests通过。Rust workspace 142 tests通过，另1项需显式API Key授权的真实DeepSeek测试ignored；archive interop通过。
- 额外独立复验rustfmt、全workspace/all-targets/all-features严格Clippy与Desktop production build均通过；Vite转换280 modules。自审确认primary/fallback/repair复用同一稳定assembly、无Prompt/credential持久化、无动态行动进入prefix、无Provider cache虚报。
- M10-T04完成后下一项严格为M10-T05，本次未开始；用户`.gitignore`保持未暂存，不merge、不push。

## 2026-08-24 — M10-T05 完成V0.3 Save Schema与隔离迁移

### 范围与迁移

- 在分支`task/M10-T05-save-schema-migration`、起始提交`2bb62ce`上严格执行M10-T05；未回滚或重做M0～M10-T04，未进入M10-T06。用户已有`.gitignore`修改始终保持未暂存。
- 新增`0032_save_schema.sql`，在`campaigns`以`NOT NULL`/`CHECK`冻结`save_schema_version=3`和`world_schema_version=1`，并只把NPC LOD删除保护接入既有restore session边界；没有改变Rules、D20、Provider、Queue、Quest/NPC/Adventure业务语义。
- Windows实际Rust启动不再对活动SQLite直接跑migration：先创建并验证完整备份，从备份建立隔离工作文件，执行历史migration，完成integrity、foreign key、schema history和Campaign领域重载后才rename切换；迁移或切换失败保持原文件，专项测试验证schema 31→32与失败原字节不变。TypeScript启动路径补齐foreign key与Campaign领域重载。

### Portable archive与恢复UX

- `.emtavern`五文件容器保持format 1，portable schema从2升到3。新增共享TS清单及Rust镜像，完整携带69张Campaign持久事实、状态和审计表，包括Constitution/Seed、Rules、Knowledge、Universal Character/Career、NPC LOD、动态地点/势力、酒馆人口/场景/时间线、Quest Pool/Graph、Director/Budget、Memory/Lore、Lazy Generation、Event Ledger和已终结AI Candidate。
- 设备Provider/Model/设置/凭据、pending request、内部snapshot、restore session、Dialogue/Prefetch缓存继续排除；存在`PROPOSED`候选时仍拒绝导出。导入在单一IMMEDIATE事务内按触发器/外键顺序恢复，执行foreign key、69表精确重载和既有Repository领域重载；覆盖仍先做一致完整备份。
- 历史TS/Rust v1、v2 fixtures未删除或覆盖，新增hash防漂移清单；另增TS/Rust v3 fixtures。v1/v2导入只增加save/world版本和允许的当前兼容投影，不改写源档。未来版本、损坏、资源炸弹和秘密均fail closed。
- Save Home在检查阶段显示目标save/world版本；历史档明确提示隔离升级且原文件不改写，未来版本明确要求升级应用，本地数据保持原状。UI只自然修改既有导入提示，复用现有组件/CSS，没有借机进行M10-T07视觉重构。

### 文档、决定与验证

- 重写[`save-format.md`](save-format.md)为容器v1/portable schema 3权威规范，更新V0.3 Spec、Tasks、Data Model，并新增`DEC-148`。M10-T05标记DONE；后续严格为M10-T06。
- `pnpm check:shared`从最终工作树通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 181 files / 1018 tests通过，另1 file / 1 test性能runner按设计跳过；Node 29 tests通过。
- Rust workspace 147 tests通过，另1项需显式API Key授权的真实DeepSeek测试ignored；rustfmt、全workspace/all-targets/all-features严格Clippy、Windows纵向E2E及TypeScript↔Rust archive interop全部通过。Desktop production build通过，Vite转换280 modules；`pnpm build:desktop`复验通过。
- 未删除测试、降低SQLite/Schema/秘密校验或忽略错误；不merge、不push，不暂存用户`.gitignore`。

## 2026-08-24 — M10-T06 完成 Performance Regression Gate

### 范围与自动门

- 在分支`task/M10-T06-performance-regression`、起始提交`43c89ca`上严格执行M10-T06；未回滚或重做M0～M10-T05，用户已有`.gitignore`修改保持未暂存。本任务未进入M10-T07，也未修改Rules Engine、Provider、Generator/Queue行为、SQLite schema、业务事务或存档格式。
- 抽取M1-T04原Fake Provider测量函数供基线与回归复用；新增`performance:gate` CLI，拒绝覆盖已有输出，并生成内容无关JSON与Markdown。核心证据使用冷启动3批和同实例热运行3批、每任务每批10次，对run-level P95取中位数，不选择单次最快值。
- 核心latency/queue固定门为`max(M1 P95 × 3, M1 P95 + 5 ms)`；真实GenerationQueue用concurrency=2、混合P0/P1/P2共40项压力测量，P95门为50 ms。失败测试证明任一越界会使报告FAIL，CLI也会非零退出；没有根据本次结果降低门槛。
- 长存档在schema 32真实SQLite写入100→1000条durable message，以`page_count × page_size`计算≤4096 bytes/turn；Unified Context只投影固定recent/memory/Constitution/action，以≤2048 tokens且增长≤1.05×限制膨胀，不删除SQLite历史或传输全库。
- Fake Provider未报告的token/cache usage继续为unknown/NOT_EVALUATED；真实证据阈值预先固定为input tokens每样本平均≤16384、Provider cache hit ratio≥0.50，且只接受Provider usage，不把本地prefix reuse冒充hit。

### 证据、文档与验证

- 本机门禁PASS：World cold/warm latency P95中位数0.153/0.104 ms，NPC 1.092/0.171，Quest 0.109/0.080，Action 0.082/0.073，D20 0.090/0.048；对应queue中位数均通过M1门。
- GenerationQueue压力P95为2.000 ms；SQLite为1,556,480→2,043,904 bytes，即541.582 bytes/additional turn；Context为377→383 tokens、增长1.016×。真实Provider仍为NOT_RUN，未读取Key或调用网络模型。
- 新增[`V0.3_PERFORMANCE_REGRESSION.md`](V0.3_PERFORMANCE_REGRESSION.md)与`DEC-149`，更新V0.3 Spec和任务状态。定向测试覆盖repeatability、warm/cold身份、long-save、跨批中位数、threshold failure、unknown usage、真实token/cache失败和report generation。
- 首次Desktop build发现Node专用测量helper经`ai-core`根出口进入浏览器bundle；将helper改为测试/CLI私有导入后，M1旧基线runner再次成功生成3次/任务报告，M10 gate也在最终代码上再次PASS。没有用polyfill或跳过构建掩盖边界错误。
- 最终`pnpm check:shared`从头通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 182 files / 1021 tests通过，另2 files / 2 tests性能CLI runner按设计跳过；Node 29 tests通过。Rust workspace 147 tests通过，另1项需显式API Key授权的真实DeepSeek测试ignored；rustfmt、全workspace/all-targets/all-features严格Clippy、Windows纵向E2E及TypeScript↔Rust archive interop全部通过。
- `pnpm build:desktop`最终通过，Vite转换281 modules。用户`.gitignore`仍保持未暂存；没有merge或push。
- M10-T06完成后下一项严格为M10-T07 Visual System Convergence；本次未开始，不merge、不push。

## 2026-08-24 — M10-T07 完成 Visual System Convergence

### 范围与视觉架构

- 在分支`task/M10-T07-visual-system-convergence`、起始提交`932c16b`上严格执行M10-T07；未回滚或重做M0～M10-T06，用户已有`.gitignore`修改保持未暂存。本任务没有进入M11，也没有修改Rules Engine、D20硬结果、Provider、Generator/Queue、SQLite、存档或Quest/NPC/Adventure业务合同。
- 按`Design Tokens → UI Primitives → Game Components → Feature Pages → Legacy UI Migration → Visual Consistency Audit`完成收敛。三层Token切换为视觉手册的暖黑/深木/羊皮纸/余烬金方向，并冻结中文UI/叙事字体栈、4px spacing、6/10/14/16px radius、Border、Shadow与Motion。
- `theme.css`、`ui/primitives.css`和`ui/game-components.css`的raw color/rgba从41处降为0，应用CSS不再直接读取Primitive`--et-*`。新增静态门同时拒绝raw typography、spacing、radius、border、shadow与animation timing/easing；媒体阈值、运行时几何和keyframe transform保持明确例外，不包装无意义Token。
- 保留历史class作为兼容适配边界，但全部读取同一Semantic/Component Token；没有引入CSS框架或复制第二套组件。Tavern/NPC/Quest/Adventure/Character AI继续复用NpcCard、QuestCard、DialogueView、ActionComposer与AIFieldAssist；D20跳过操作迁入共享Button，不改变已保存结果、reveal回调或重新投掷语义。
- 应用壳新增HashRouter安全的skip link，首个Tab可见且Enter后焦点落到`#app-main`而不改变路由。Paper error危险文本首次真实截图对比度不足后，新增Paper语义danger覆盖和自动对比度门，没有以降低阈值接受缺陷。

### 视觉证据与文档

- 真实Chromium覆盖860×600 Settings、1180×760 My、1366×768 Saves、1920×1080 Quest Paper/error；四个视口document宽度均等于viewport，可见后代横向越界为0。额外保存skip-link focus截图与SHA-256清单。
- 真实reduced-motion浏览器结果为media query命中、D20/Spinner animation-name均`none`、navigation transition duration为`0s`；D20组件测试继续证明skip与reduced-motion只揭示同一硬结果。
- 新增[`audit/V0_3_VISUAL_SYSTEM_CONVERGENCE.md`](audit/V0_3_VISUAL_SYSTEM_CONVERGENCE.md)与`DEC-150`；关闭[`V0.3_VISUAL_MIGRATION.md`](V0.3_VISUAL_MIGRATION.md)适用债务，更新Design Token规范、V0.3 Spec与任务状态。M12仍必须独立复算，不能直接继承本次PASS。

### 验证与结束状态

- 专项测试覆盖raw视觉值静态门、组件复用清单、Feature/状态矩阵、Paper/Ember contrast、skip-link焦点、D20 skip/reduced-motion、forced-colors、四视口布局合同与生产build。
- `pnpm check:shared`从最终工作树完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 183 files / 1038 tests通过，另2 files / 2 tests性能CLI runner按设计跳过；Node 29 tests通过。Rust workspace 147 tests通过，另1项需显式API Key授权的真实DeepSeek测试ignored；Windows纵向E2E与TypeScript↔Rust archive interop全部通过。
- `pnpm build:desktop`最终通过，Vite转换281 modules；构建产物只用于本地验证，没有作为源码提交。
- M10-T07完成后下一项严格为M11-T01；本次不进入M11，不merge、不push，用户`.gitignore`继续保持未暂存。

## 2026-08-26 — M11-T01 完成 Three-World Test Harness

### 范围与配置

- 在分支`task/M11-T01-three-world-harness`、起始提交`2b67ffc`上严格执行M11-T01；未回滚或重做M0～M10-T07，用户已有`.gitignore`修改保持未暂存。本任务未执行Fantasy/Investigation/Cyberpunk长测，也未进入M11-T02。
- 在既有`@ember-tavern/test-fixtures`包增加三套`SYNTHETIC_M11`配置。Fantasy、Investigation与Cyberpunk分别拥有不同的Constitution、3项Career、3项Equipment、2项Trait、3名NPC、3条Quest和3/4/5个世界扩展字段；调查世界不复制受版权保护规则文本。
- 每世界提供32个有序行为，覆盖创建、酒馆、NPC/传闻、多Quest、自由输入、旅行/时间、D20、装备/交易、两次Save/Reopen和状态审阅。动作只声明输入与必采证据，不预填剧情结果。

### 隔离与证据

- 每个run保存来源commit、fixture/script SHA-256及组合scenario hash；三个世界使用独立目录和SQLite路径。相同输入replay保持hash但从空evidence开始；reset只删除目标世界已知SQLite/WAL/SHM与动作流，其他世界不受影响。
- 新增`EMBER_PLAYTEST_EVIDENCE` v1状态机：`NOT_RUN/IN_PROGRESS/COMPLETE/BLOCKED`、Provider模式与显示身份、有序action outcome/latency/persistence/observations，以及P0～P3 finding ledger。Provider身份在首个动作后冻结，缺失必采证据或未完成32步不能声称COMPLETE。
- fixture、manifest和evidence复用portable save秘密扫描；保留Campaign ID与`SYNTHETIC_M11`来源证明没有使用正式用户数据。新增[`V0.3_PLAYTEST_HARNESS.md`](V0.3_PLAYTEST_HARNESS.md)与`DEC-151`，更新Spec和Tasks。

### 验证与结束状态

- 定向7项测试覆盖fixture/业务合同、结构差异、目录与数据库隔离、reset/replay、动作顺序、证据完整性、Provider冻结、秘密扫描及hash篡改。
- `pnpm check:shared`从最终工作树完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 184 files / 1045 tests通过，另2 files / 2 tests性能CLI runner按设计跳过；Node 29 tests通过。Rust workspace 147 tests通过，另1项需显式API Key授权的真实DeepSeek测试ignored；Windows纵向E2E与TypeScript↔Rust archive interop全部通过。
- `pnpm build:desktop`最终通过，Vite转换281 modules；本任务没有调用真实Provider，三世界长测状态仍诚实保持NOT_RUN。
- M11-T01完成后下一项严格为M11-T02；本次不进入长测、不merge、不push，用户`.gitignore`继续保持未暂存。

## 2026-08-27 — M11-T02 完成 Fantasy Long Playtest

### 范围与生产纵切

- 在分支`task/M11-T02-fantasy-long-playtest`、起始提交`8a85be5`上严格执行M11-T02；未回滚或重做M0～M11-T01，未进入M11-T03。用户已有`.gitignore`修改全程保持未暂存。
- 以`9f640d6`建立Fantasy runner和保留数据库/archive路径的Windows production native vertical slice；随后自审发现Career Pool与多NPC scene未实际覆盖，废弃该提交绑定的初版证据，不把覆盖不完整的运行当作完成结果。
- 在同一Campaign顺序执行32项行为，覆盖锁定Constitution、3项Career、角色/2项Trait、酒馆/4名NPC/3条传闻、知识与连续对话、两NPC scene、2项Quest、8回合Adventure、7次D20、7项Rules事件、装备/金钱/时间、地点/旅行、Director、正常重开、失败恢复和portable overwrite import。最终money为12、game time为765分钟、装备1件，所有动作持久化并记录必需observation。
- Provider明确为Fake；真实Provider保持`NOT_RUN`，没有读取Credential或调用网络模型。总生产流墙钟2298.712 ms、32项摊销71.835 ms只作为harness观察，不冒充Provider billing latency或M10性能门。

### 发现、修复与证据

- 长测首次进入多NPC scene时暴露`M11-FAN-001`（P1）：`tavern_scene.rs`查询不存在的`npc_lod_profiles.population_role`列。根因为既有schema把该值存于`profile_json.$.populationRole`；在`e8f3a3c`修正查询，并以population projection、两名focus NPC、scene prepare/commit和最终scene/turn计数回归。
- archive恢复改用生产`CampaignArchiveImportMode::Overwrite`，不以原始SQL删除Campaign绕过外键和领域重载。最终SQLite `integrity_check=ok`、foreign key violation=0、unfinished request=0、Save Schema 3、World Schema 1。
- 最终run`m11-t02-fantasy-e8f3a3c`绑定完整来源提交；提交逐动作evidence、SQLite、`.emtavern`、summary、manifest、三张1366×768浏览器壳截图和SHA-256。浏览器壳三页无console error；Tauri/SQLite不可用、loading和无Campaign route guard是预期状态，不替代Native证据。
- 新增[`audit/V0_3_FANTASY_LONG_PLAYTEST.md`](audit/V0_3_FANTASY_LONG_PLAYTEST.md)与`DEC-152`，更新Spec、Tasks和Harness。M11-T02开放finding为0；Investigation、Cyberpunk、free-input stress、真实模型和M12均未执行。

### 最终门禁与结束状态

- `pnpm check:shared`从最终工作树完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 185 files / 1046 tests通过，另2 files / 3 tests按设计跳过；Node 29 tests通过。
- Rust workspace 147 tests通过，另1项需显式API Key授权的真实DeepSeek测试ignored；rustfmt、workspace/all-targets/all-features严格Clippy与TypeScript↔Rust archive interop均通过。显式Windows纵向E2E再次通过。
- `pnpm playtest:fantasy`普通入口通过合同测试，环境门控的证据生成测试按设计skip；最终绑定提交的集成run此前已32/32通过。`pnpm build:desktop`通过，Vite转换281 modules；证据`SHA256SUMS`全量复验通过。
- 本任务形成`9f640d6`、`e8f3a3c`和最终证据/文档提交；不merge、不push，不暂存用户`.gitignore`。下一项严格为M11-T03，本次未进入。

## 2026-08-27 — M11-T03 完成 Investigation Long Playtest

### 范围与生产纵切

- 在分支`task/M11-T03-investigation-long-playtest`、起始提交`90bf26b`上严格执行M11-T03；未回滚或重做M0～M11-T02，未进入M11-T04。用户已有`.gitignore`修改全程保持未暂存。
- 以`0779808`新增独立Investigation production native slice和环境门控runner，在同一Campaign顺序完成32项行为：锁定Constitution、3项Career、角色/2项Trait、`investigation-resilience`扩展、酒馆/4 NPC/三种真实性传闻、有限认知对话、两NPC scene、2 Quest、8回合Adventure、7次D20、8项Rules事件、装备/现金/时间、地点/旅行、Director、正常重开、失败恢复与portable overwrite import。
- 最终镇定/机运/信用/线索负荷为62/48/35/0，cash为9、game time为660分钟、装备1件。扩展fixture只局部更新`extensions/revision/updatedAt`并继续经过既有触发器；没有修改基础属性、schema或业务合同。
- 以difficulty 17、体魄1和`-5`雨寒状态保证首个检查失败，仍由本地D20硬结果逻辑实际投掷并先持久化；失败后其余回合、线索和结算继续，最终一项Quest完成、一项保持ACCEPTED。没有写死骰值或让一次失败锁死线索。

### 认知、发现与证据

- FALSE/PARTIAL/TRUE传闻各1条并保留source basis、置信度与NPC provenance；连续对话明确区分亲历、转述和未知。最终4条NPC knowledge、4条message和一项双NPC scene turn在重开/import后保留。
- 最终run`m11-t03-investigation-0779808`绑定来源提交`077980887a4b705f6fda214af56f9355d7c15b15`，32/32`COMPLETE`、开放finding 0。夹具编写期被既有enum白名单、防重复、Quest和基础属性不可变校验拒绝的无效值均只修正夹具，没有降低产品门禁，故不冒充产品finding。
- Provider明确为Fake；真实Provider保持`NOT_RUN`，未读取Credential或调用网络模型。生产流墙钟2578.118 ms、32项摊销80.566 ms只作为harness观察，不替代M10性能门。
- SQLite 1,777,664 bytes、archive 190,889 bytes；`integrity_check=ok`、foreign key violation 0、unfinished request 0、Save Schema 3、World Schema 1。提交逐动作evidence、数据库、archive、summary、manifest、1440×1000浏览器壳截图与SHA-256。
- 浏览器壳覆盖boot、Saves、My和Quest route guard且无console error；Vite下native不可用/loading/缺Campaign是预期安全状态，不替代Native证据。视觉保持既有冻结体系，没有借长测修改UI、CSS或业务组件。

### 文档、门禁与结束状态

- 新增[`audit/V0_3_INVESTIGATION_LONG_PLAYTEST.md`](audit/V0_3_INVESTIGATION_LONG_PLAYTEST.md)和`DEC-153`，更新Spec、Tasks与Harness。M11-T03开放finding为0；Cyberpunk、free-input stress、真实模型、M11-T06与M12仍未执行。
- 最终`pnpm check:shared`从最终工作树通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 186 files / 1047 tests通过，另2 files / 4 tests按设计skip；Node 29 tests通过。Rust workspace 148 tests通过，另1项需显式API Key授权的真实DeepSeek测试ignored；rustfmt、workspace/all-targets/all-features严格Clippy与TypeScript↔Rust archive interop均通过。
- 显式Windows纵向E2E再次通过；`pnpm playtest:investigation`普通入口通过合同测试，环境门控的证据生成测试按设计skip；最终绑定提交的集成run此前已32/32通过。`pnpm build:desktop`通过，Vite转换281 modules；证据`SHA256SUMS`全量复验通过。
- 本任务形成`0779808`和最终证据/文档提交；不merge、不push，不暂存用户`.gitignore`。下一项严格为M11-T04，本次不进入。

## 2026-08-27 — M11-T04 完成 Cyberpunk Long Playtest

### 范围与生产纵切

- 在分支`task/M11-T04-cyberpunk-long-playtest`、起始提交`c17e5c8`上严格执行M11-T04；未回滚或重做M0～M11-T03，未进入M11-T05。用户已有`.gitignore`修改全程保持未暂存。
- 以`d42bae2`新增独立Cyberpunk production native slice和环境门控runner，在同一Campaign顺序完成32项行为：无超自然魔法Constitution、3项Career、角色/2项Trait、`cyberpunk-augmentation`扩展、余温中继站/4 NPC/三种真实性传闻、有限认知对话、两NPC scene、2 Quest、8回合Adventure、7次D20、8项Rules事件、装备/信用点/时间、动态地点、2个活跃势力/1次势力行动、Director、正常重开、失败恢复与portable overwrite import。
- 最终神经负荷/街区声望/追踪热度为2/8/0，植入插槽1、网络权限“社区”，信用点15、game time 525分钟、装备1件。扩展fixture只局部更新`extensions/revision/updatedAt`并继续经过既有触发器；没有修改基础属性、schema或业务合同。
- 动态势力使用既有生产生成/校验/提交链激活七码头互助网与栖桥公司；一次势力行动扩展到新生成的七码头离线节点、建立`FRIENDLY`关系并写入后果事实，重开和archive import后仍保留。

### 平衡、发现与证据

- 首个difficulty 17体魄检查叠加`-5`神经回响状态，保证自然20也失败，但仍由本地D20硬结果逻辑实际投掷并先持久化；最终7次D20含2次失败，后续回合、密钥交付、结算和第二项Quest继续完成或保持开放。
- 经济/装备断言同时覆盖8项append-only Rules事件、显式unequip/equip替换、1件语义CLUE奖励和最高奖励价格0；没有用数值膨胀制造科幻差异。
- 最终run`m11-t04-cyberpunk-d42bae2`绑定来源提交`d42bae2f4e8c111a293420afbd4412d83f501eb9`，32/32`COMPLETE`、开放finding 0。Provider明确为Fake；真实Provider保持`NOT_RUN`，未读取Credential或调用网络模型。
- 生产流墙钟2938.837 ms、32项摊销91.839 ms只作为harness观察，不替代M10性能门。SQLite 1,806,336 bytes、archive 211,913 bytes；`integrity_check=ok`、foreign key violation 0、unfinished request 0、Save Schema 3、World Schema 1。
- 浏览器壳在1440×1000覆盖Saves、My和Quest route guard，逐图人工查看且无console error；native不可用/loading/缺Campaign是预期安全状态，不替代Native证据。没有借长测修改UI、CSS或业务组件。

### 文档、门禁与结束状态

- 新增[`audit/V0_3_CYBERPUNK_LONG_PLAYTEST.md`](audit/V0_3_CYBERPUNK_LONG_PLAYTEST.md)和`DEC-154`，更新Spec、Tasks与Harness。三世界固定长测均已独立完成；free-input stress、真实模型、M11-T06与M12仍未执行。
- 最终`pnpm check:shared`从最终工作树完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 187 files / 1048 tests通过，另2 files / 5 tests按设计skip；Node 29 tests通过。Rust workspace 149 tests通过，另1项需显式API Key授权的真实DeepSeek测试ignored；rustfmt、workspace/all-targets/all-features严格Clippy与TypeScript↔Rust archive interop均通过。
- 显式Windows纵向E2E再次通过；`pnpm playtest:cyberpunk`普通入口通过合同测试，环境门控的证据生成测试按设计skip；最终绑定提交的集成run已32/32通过。`pnpm build:desktop`通过，Vite转换281 modules；证据`SHA256SUMS`全量复验通过。
- 本任务形成`d42bae2`和最终证据/文档提交；不merge、不push，不暂存用户`.gitignore`。下一项严格为M11-T05，本次不进入。

## 2026-08-27 — M11-T05 完成 Free-Input Stress Test

### 范围与执行方式

- 在分支`task/M11-T05-free-input-stress`、起始提交`c3c4a29`上严格执行M11-T05；未回滚或重做M0～M11-T04，未进入M11-T06。用户已有`.gitignore`修改全程保持未暂存。
- 以`2432d18`新增八类精确自由输入合同、环境门控runner和Rust production native stress slice。运行器校验三份已提交Fantasy/Investigation/Cyberpunk长测数据库SHA-256后复制到不可覆盖的新run，不读取或修改正式用户存档。
- 八类行为为拒绝Quest、欺骗发布者、购买酒馆、偷窃、离城、与路人长期交流、出售绑定Quest道具和投靠敌对势力；结果为4项`SUCCEEDED`、2项`FAILED`、2项`REJECTED`。全部精确输入与回复持久化，均不依赖推荐项且不含默认“无法解析”。
- 对话使用既有validated `NpcDialogueCommit`；状态后果复用既有Quest transition、dynamic location travel和faction action事务。只以只读SQLite查询推导实际结果，没有为测试写死数据库结果、增加命令语言或绕开业务合同。

### 一致性、证据与发现

- Fantasy最终Quest abandoned 1、owner trust 2、money 12；Investigation旅行至海雾观测站、travel event 3、路人6条message且relationship为1/1/1；Cyberpunk保留绑定奖励和15信用点，同时企业关系为`ALLIED`、势力行动2、公开投敌后果事实1。
- 三个Campaign在最终重开后均为`TAVERN`，`integrity_check=ok`、foreign key violation 0、unfinished request 0；各自产出SQLite与portable archive。正式run`m11-t05-free-input-2432d18`绑定来源提交，逐项evidence为8/8 `COMPLETE`、开放finding 0。
- 首次完整门禁暴露新增Rust测试在无环境变量时错误强制执行，这是测试接线问题；修正为四个路径全部未配置时普通门禁安全返回、部分配置时fail closed、全部配置时执行真实压力流程。初次浏览器截图使用非Hash路径导致路由未切换，改用`/#/...`并逐图重采；两者均未降低产品校验，也不记为产品finding。
- Provider明确为Fake；真实Provider保持`NOT_RUN`，未读取Credential或调用网络模型。生产事务墙钟2291.522 ms、八项摊销286.44 ms只作为harness观察，不替代M10性能门。
- 浏览器壳在1440×1000覆盖Saves、My和Quest route guard，最终三图逐一检查且无console error；native不可用/loading/缺Campaign是预期安全状态，不替代Native证据。

### 文档、门禁与结束状态

- 新增[`audit/V0_3_FREE_INPUT_STRESS_TEST.md`](audit/V0_3_FREE_INPUT_STRESS_TEST.md)和`DEC-155`，更新Spec、Tasks与Harness。M11-T05开放finding为0；真实模型、M11-T06与M12仍未执行。
- `pnpm check:shared`在测试基础提交后通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 188 files / 1049 tests通过，另2 files / 6 tests按设计skip；Node 29 tests通过。Rust workspace 150 tests通过，另1项需显式API Key授权的真实DeepSeek测试ignored；rustfmt、严格Clippy与TypeScript↔Rust archive interop均通过。
- 最终文档/证据工作树已复跑并通过完整共享门禁、显式Windows纵向E2E、普通`pnpm playtest:free-input`、desktop build与14项SHA-256复验；Vite生产构建转换281 modules。
- 本任务不merge、不push，不暂存用户`.gitignore`。下一项严格为M11-T06，本次不进入。

## 2026-08-27 — M11-T06 完成 Playability Report

### 范围与统计复算

- 在分支`task/M11-T05-free-input-stress`、起始提交`95e5e1e`上严格执行M11-T06；未回滚或重做M0～M11-T05，未进入M12。用户已有`.gitignore`修改全程保持未暂存。
- 新增`playtest:report`复算门，直接读取M11-T02 Fantasy、M11-T03 Investigation、M11-T04 Cyberpunk和M11-T05自由输入的已提交evidence/summary，并逐文件复验四个来源目录`SHA256SUMS`。测试不从报告正文复制统计。
- 复算得到三世界固定行为96项、自由输入8项，总计104项；固定流总墙钟7815.667 ms、按行为摊销81.413 ms，自由输入事务2291.522 ms、摊销286.44 ms。两种计时方法分别披露，不冒充Provider latency。
- 唯一finding为Fantasy的`M11-FAN-001`（P1/FIXED）；当前开放P0/P1/P2/P3均为0。自由输入仍明确保留4次成功、2次失败、2次规则拒绝，不把合理失败删成“全成功”。

### 报告、评分与边界

- 新增[`V0.3_PLAYABILITY_REPORT.md`](V0.3_PLAYABILITY_REPORT.md)，逐世界记录行为数、Fake Provider/`ember-fake-v1`、延迟、Knowledge/Personality/Quest/World/Trait/Equipment/Director/Context、发现/修复/剩余和评分。
- 五项显式维度各2分，Fantasy/Investigation/Cyberpunk为8.6/8.8/8.9；三个世界均为32项行为，等行为权重综合8.8/10，置信度MEDIUM。评分只覆盖确定性生产harness，不包含真实模型文风或网络质量。
- 四个M11 run全部为Fake。V0.3真实Provider、真实token/计费cache、网络latency明确为`NOT_EVALUATED`；V0.2 DeepSeek结果只作历史背景，未计入104项行为、评分或findings。
- 机器摘要run`m11-t06-report-95e5e1e`绑定M11-T06起始提交，记录全部来源、统计、逐世界metrics、评分和Provider边界；manifest与SHA-256防止静默漂移。新增`DEC-156`并更新Tasks、Spec与Harness。

### 门禁与结束状态

- `pnpm playtest:report`通过3项测试：四源证据/hash/统计/评分复算、提交摘要逐字段一致、Markdown章节与链接合同。
- 最终工作树`pnpm check:shared`完整通过：Prettier、release metadata、简体中文玩家文案、ESLint、TypeScript；Vitest 189 files / 1052 tests通过，另2 files / 6 tests按设计skip；Node 29 tests通过。Rust workspace 150 tests通过，另1项需显式API Key授权的真实DeepSeek测试ignored；rustfmt、严格Clippy与TypeScript↔Rust archive interop均通过。
- 三世界普通入口、自由输入入口、`pnpm playtest:report`、显式Windows纵向E2E、desktop build与M11-T06 evidence hash全部通过；Vite生产构建转换281 modules。普通长测入口按设计只运行合同测试并跳过需要新run目录的证据生成，权威已提交run由report门重新哈希和复算。
- M11-T06完成后M11全部任务结束；本任务不merge、不push，不暂存用户`.gitignore`。下一项严格为M12-T01，本次不进入。

## 2026-08-27 — M12-T01 完成 First Full Audit

### 审计范围与独立证据

- 在分支`task/M11-T05-free-input-stress`、起始提交`d41e99b`上执行M12-T01；没有采信历史DONE标签，没有修改生产业务代码，也没有边审边修复。用户已有`.gitignore`修改全程保持未暂存。
- 新增[`audit/V0_3_FIRST_FULL_AUDIT_FINDINGS.md`](audit/V0_3_FIRST_FULL_AUDIT_FINDINGS.md)，逐项复核Architecture、Code、Security、Credential、Provider、AI、Rules、SQLite、Save/Migration、Performance/Cache、UI/UX/A11y、Regression和Playability。
- 冻结6项开放finding：P2四项（无Campaign本地导航、Vite开发服务器公告、CI Action可移动tag、V0.3仍标识0.2.0）与P3两项（Vitest/传递开发工具公告、Linux GTK3条件依赖维护/unsound告警）；开放P0/P1均为0。独立安全复核确认CI风险存在可执行artifact投毒路径，但只读token、无secret/write/OIDC/自动发布使其不构成P0/P1。
- 当前与git历史秘密扫描只命中故意的假秘密测试夹具；CSP、最小Tauri capability、OS Keyring、opaque CredentialRef、HTTPS公开地址/loopback HTTP、解析地址固定、禁redirect、超时和响应上限继续通过。`cargo-audit 0.22.2`用当日RustSec库审计499项依赖，报告0个vulnerability、16个unmaintained和1个Linux GTK3路径unsound informational warning。
- 仅使用官方当前文档复核Provider：DeepSeek、Qwen与OpenRouter endpoint/model/API仍有效；Qwen 3.7 Max已列为旧版但仍可调用，不误报为下架。没有读取Credential或调用真实计费Provider。

### UI、性能与外部边界

- 真实Chromium重新覆盖12个核心页面族、unknown/route guard、错误/loading/selected代表状态与860×600、1180×760、1366×768、1920×1080四个既定视口；横向溢出0、console error 0。保存页面证据、finding点击前后图与SHA-256。
- 重新验证Design Token唯一来源、Primitive/Game Component复用、Feature/Legacy收敛、raw visual value、WCAG对比度、2px焦点、forced-colors和reduced-motion静态/测试合同；没有第二套组件体系。视觉评级B+，扣分来自无Campaign导航语义，不来自样式体系分裂。
- 性能门绑定审计基线提交并通过：SQLite增长541.582 bytes/turn，Unified Context在100→1000回合为377→383 tokens、增长1.016，GenerationQueue压力P95为5ms。Fake Provider不报告真实token/cache，保持NOT_EVALUATED。
- 当前macOS主机不能证明V0.3 NSIS/Credential Manager/WebView2/安装启动卸载；真实Provider叙事、网络、token和计费cache也未获授权。两项明确记为BLOCKED_EXTERNAL/NOT_EVALUATED，旧V0.2或Fake证据不冒充通过。

### 门禁与结束状态

- `pnpm check`完整通过：Prettier、release metadata同步、zh-CN、ESLint、TypeScript；Vitest 189 files / 1052 tests通过，另2 files / 6 tests按设计skip；Node 29 tests通过；Rust workspace 150 tests通过，另1项真实DeepSeek测试ignored；rustfmt、严格Clippy和archive interop通过。
- `pnpm test:windows-e2e`、`pnpm build:desktop`（281 modules）、`pnpm performance:gate`和`pnpm playtest:report`均通过。M12-T01只冻结finding和证据，不修复、不进入M12-T03；下一项严格为M12-T02。

## 2026-08-28 — M12-T02 完成 First Audit Findings 修复

### 逐项处理

- 从findings冻结提交`c5b7e74`开始，仅处理M12-T01登记的6项问题；实现提交`d1b5a30`。用户已有`.gitignore`修改保持未暂存，没有修改Rules/D20、Provider业务合同、Generator/Queue、SQLite schema、存档格式或Quest/NPC/Adventure状态机。
- 修复无Campaign导航：设备级“我的”保持`/my`，酒馆/任务/冒险/角色/档案入口统一回存档选择；设置包屑不再以“我的”标签进入Saves。新增两个点击级回归，导航定向2 files / 23 tests通过。
- Vite升级到7.3.6、plugin-react到5.2.0、Vitest到4.1.11，刷新传递图并用workspace override固定`brace-expansion` 5.0.9。npm官方registry audit从8条降为0；仍保持非交互`vitest run`。
- 14个CI `uses:`全部固定到5个当前上游完整commit SHA并保留版本旁注；三处checkout设置`persist-credentials: false`，三处Rust setup显式`toolchain: stable`。新增workflow门锁定SHA数量/格式和安全配置，6/6通过。
- 所有npm workspace、Cargo workspace/lock、Tauri、release-info、生成版本、CHANGELOG和README统一到未发布的0.3.0候选；release sync移除会漏刷Cargo.lock workspace版本的`--no-deps`，连续sync/check与frozen install通过。
- RustSec依旧为0 vulnerability、16 unmaintained/1 unsound informational warning。三目标`cargo tree`证明glib/GTK3只在Linux图，macOS arm64与Windows x64均不可达；V0.3不发布Linux，故P3记为`DEFERRED_ACCEPTED`，任何未来Linux发布前必须重审，不把告警伪装成消失。

### 门禁与边界

- 完整`pnpm check`通过：Vitest 189 files / 1054 tests，另2 files / 6 tests按设计skip；Node 30/30；Rust 150/150，另1项真实DeepSeek测试按授权边界ignored；Prettier、release 0.3.0同步、zh-CN、ESLint、TypeScript、rustfmt、严格Clippy和archive interop均通过。
- `pnpm test:windows-e2e` 1/1、`pnpm build:desktop` 281 modules、性能门和`playtest:report`均通过。性能门绑定实现提交`d1b5a30`；Fake数据为SQLite 541.582 bytes/turn、Context 377→383 tokens、增长1.016、Queue P95 2ms；真实token/cache保持NOT_EVALUATED。
- M12-T02结束时开放P0/P1/P2/P3均为0，另有1项仅Linux条件依赖的显式延期风险。未读取真实Credential、未调用计费Provider，不push、不merge、不签名、不发布。下一项严格为M12-T03 Release Gates。

## 2026-08-28 — M12-T03 完成 Release Gates

### 门禁实现与来源绑定

- 在分支`task/M11-T05-free-input-stress`上严格执行M12-T03；未回滚或重做M0～M12-T02，也未提前进入M12-T04。用户已有`.gitignore`修改保持未暂存。
- 首先修复发布门禁仍硬编码0.2.0的问题：Windows与macOS生命周期脚本改为读取并校验`release-info.json`的0.3.0，测试锁定不得重新引入旧版本字面量；实现提交为`a77eb03`。全部构建、测试、性能与发布元数据证据绑定完整来源提交`a77eb03530ab2f90e635a18b513994b1b4dca1af`。
- 新增[`audit/V0_3_RELEASE_GATES.md`](audit/V0_3_RELEASE_GATES.md)和结构化manifest。证据目录包含20个受`SHA256SUMS`覆盖的文件；逐项SHA-256复验全部通过。没有签名、notarize、发布、push或merge。

### 适用平台结果与外部阻塞

- Frozen install与完整`pnpm check`通过：Vitest 189 files / 1054 tests通过，另2 files / 6 tests按显式环境合同skip；Node 30/30；Rust 150/150，另1项需显式Credential授权的真实DeepSeek测试ignored；Prettier、0.3.0 release sync、zh-CN、ESLint、TypeScript、rustfmt、严格Clippy和archive interop全绿。
- Desktop production build与显式Windows生产纵向切片通过：Vite 7.3.6转换281 modules，Windows E2E 1/1。当前macOS不能构建和执行Windows NSIS、Credential Manager、WebView2、安装/启动/卸载生命周期，因此该项明确为`BLOCKED_EXTERNAL`，没有复用V0.2证据冒充V0.3。
- 当前主机构建`Ember Tavern.app`成功；Info.plist的产品名、identifier、可执行文件与版本0.3.0通过检查，三个bundle文件记录SHA-256，二进制确认链接系统WebKit。Keychain、真实启动、数据库创建与清理门只允许临时macOS CI；本机运行被脚本在触碰用户路径前拒绝，`cleanup.authorized=false`，故生命周期明确为`BLOCKED_EXTERNAL`而非VERIFIED。

### 安全、性能与真实性边界

- `pnpm audit`为0 advisories；RustSec为0 vulnerability，并继续诚实披露16个unmaintained与1个仅Linux GTK3/glib图可达的unsound warning，维持M12-T02的`DEFERRED_ACCEPTED`裁决。
- 对当前tracked tree及全部reachable Git revisions执行秘密模式扫描，只保存文件名和计数、不回显疑似值；10个唯一命中文件全部为测试文件或Rust`cfg(test)`模块内的故意假夹具，未解释命中为0。保存/导出秘密扫描2 files / 17 tests通过。未读取OS Credential Store或用户未跟踪文件。
- 性能门通过：SQLite增长541.582 bytes/turn、Unified Context 377→383 tokens、增长1.016、GenerationQueue压力P95 3ms。证据明确为Fake Provider；真实Provider token预算和计费cache hit仍为`NOT_EVALUATED`，未读取Credential、未调用网络模型。
- M12-T03所有当前主机适用门禁均通过，Windows生命周期与macOS生命周期两个外部环境项显式阻塞，真实Provider两项保持未评价。下一项严格为M12-T04 Reports & Final Verdict。

## 2026-08-28 — M12-T04 完成 Reports & Final Verdict

### 最终报告与复算

- 从M12-T03证据提交`d5c5fe0`进入最后一项任务；未重做M0～M12-T03，也未自动开始第二轮审计。新增[`V0.3_FIRST_AUDIT_REPORT.md`](V0.3_FIRST_AUDIT_REPORT.md)，并将[`V0.3_PLAYABILITY_REPORT.md`](V0.3_PLAYABILITY_REPORT.md)更新为含M12最终附录的版本；同步README、Spec、Tasks、Decisions与本日志。
- 最终开放finding为P0=0/P1=0/P2=0/P3=0。M12第一轮六项finding为4个P2全部FIXED、2个P3中1个FIXED/1个Linux-only`DEFERRED_ACCEPTED`；M11历史`M11-FAN-001` P1已修复并回归，不计为开放项。
- 可玩性证据复算仍为三世界固定96项+自由输入8项=104项；Fantasy/Investigation/Cyberpunk评分8.6/8.8/8.9，综合8.8/10、MEDIUM confidence。自由输入保持4 success/2 failed/2 rules-rejected，没有删除合理失败。

### Final Verdict 与边界

- 最终判断为`READY FOR SECOND AUDIT`：P0/P1清零，核心架构、Rules/D20、SQLite/Save/Migration、Credential边界、三世界可玩性和所有当前主机适用门禁均有可信证据。
- 同时明确`NOT READY FOR PUBLIC RELEASE`：Windows NSIS/Credential Manager/WebView2/install-launch-uninstall和临时macOS Keychain/launch/database/cleanup生命周期仍为`BLOCKED_EXTERNAL`；真实Provider长测、token、network latency和计费cache仍为`NOT_EVALUATED`；产物未签名、notarize或发布。
- 新增`DEC-157`把第二轮审计准入与公开发布批准分离，防止平台阻塞、Fake性能或V0.2历史证据被误写为V0.3发布验证。没有修改任何产品代码、schema、状态机或视觉合同。
- 最终文档完成态再次扫描当前tree和全部reachable revisions，只记录文件名：10个既有假夹具文件外，新增命中仅为已提交`secret-review.json`自身的模式类别标签，未解释命中仍为0；未读取或回显任何真实Credential。

### Git 与结束状态

- V0.3起始基线为`0af183391a5d83406874db326ed02b175ba24e6e`，第一项提交为`01030e1`，最终审计产品源码为`a77eb03`，M12-T03证据提交为`d5c5fe0`。截至M12-T03共新增67 commits（46 feat / 9 test / 4 fix / 8 docs），无merge commit；最终M12-T04文档commit在交接中作为ending HEAD报告。
- 用户已有`.gitignore`修改始终保持未暂存，因此工作树会如实报告为not clean；所有agent-owned M12-T04修改独立提交。不push、不merge、不签名、不发布，也不自动开始第二轮审计。

## 2026-08-28 — V0.3 第二轮独立完整审计完成

### 独立复核与 Findings

- 从最终产品HEAD `bc5fb56`建立`audit/v0.3-second-full-audit`，不采信第一轮DONE/PASS标签，重新检查Git范围、Architecture、Security/Credential、Provider/AI、Rules/D20、SQLite/Save/Migration、Performance、UI/UX/A11y、Regression和Playability。用户`.gitignore`修改全程保持未暂存。
- 在修复前提交`f763f08`冻结2项发现：`V03-SA-001`（P2）为macOS CI哈希父目录会吸收陈旧同级`.app`；`V03-SA-002`（P3）为缺失稳定的`docs/ARCHITECTURE.md`入口。P0/P1均为0。
- 修复提交`0c56b56`把macOS evidence root锁定到唯一候选`.app`并增加6/6 workflow回归；新增只描述当前已实现边界的架构索引。第二轮P2 1/1 FIXED、P3 1/1 FIXED，开放P0/P1/P2/P3均为0。

### 新 Evidence 与完整门禁

- 修复后`pnpm check`通过：Vitest 189 files / 1054 tests，另2 files / 6 tests按显式环境合同skip；Node 30/30；Rust 150/150，另1项真实DeepSeek测试按授权边界ignored；Prettier、release sync、zh-CN、ESLint、TypeScript、rustfmt、strict Clippy和archive interop全绿。
- Frozen install、Windows生产纵向E2E 1/1、desktop build 281 modules、macOS `.app` build/Info.plist/system WebKit/精确3文件hash、npm 0 advisories、RustSec 0 vulnerabilities和秘密扫描均通过。Linux-only 16 unmaintained + 1 unsound informational warning继续按第一轮裁决`DEFERRED_ACCEPTED`。
- 重新生成Fantasy/Investigation/Cyberpunk各32项与自由输入8项，共104项Fake生产harness行为；六份隔离SQLite均`integrity_check=ok`、外键违规0、未完成请求0。确定性性能门SQLite 541.582 bytes/turn、Context 377→383、增长1.016、Queue P95 2ms，真实token/cache仍`NOT_EVALUATED`。
- Chromium覆盖13个路由和860×600、1366×768、1920×1080矩阵；16张截图逐张查看，横向溢出0、console error 0、首个Tab正确聚焦skip link。浏览器无Tauri bridge时的原生错误态按设计降级，不冒充原生生命周期。

### Final Verdict 与边界

- 新增[`V0.3_SECOND_AUDIT_REPORT.md`](V0.3_SECOND_AUDIT_REPORT.md)、第二轮findings/fixes账本、修复前与修复后独立evidence、manifest和逐文件SHA-256。
- 最终判断为`SECOND AUDIT PASS — READY FOR RELEASE CANDIDATE VALIDATION`，同时明确`NOT READY FOR PUBLIC RELEASE`。Windows NSIS/Credential Manager/WebView2/install-launch-uninstall和macOS临时环境Keychain/launch/database/cleanup仍为`BLOCKED_EXTERNAL`；真实Provider、token、网络latency和计费cache仍为`NOT_EVALUATED`；未签名、notarize、发布、push或merge。

## 2026-08-29 — V0.3 RC 实测问题修复完成

### 两项阻塞修复

- 从第二轮审计完成提交`00fc1ad`建立`fix/v0.3-rc-playtest-issues`，完整读取用户提供的`12.docx`文本与三张截图，先冻结`RC-PLAYTEST-001/002`，再提交代码与测试`760b5a24c7c806e8f30eb49c4251f8c1ae6cc62b`。用户已有`.gitignore`修改保持未暂存且diff哈希不变。
- 世界生成根因为世界构筑绕过GenerationQueue，且最大8,000 token任务被单一约60秒传输时限覆盖。修复后使用DNS 10秒、连接15秒、Provider 120秒、世界操作270秒的分层有界预算；Queue按Campaign/Task意图去重并分离排队/执行时间，AbortSignal贯穿UI到原生HTTP，失败/取消/无效输出不进入SQLite commit。
- 新建存档根因为成功后只刷新列表而不导航，且React disabled前存在同tick双击窗口。修复后同步ref防重入，并按`campaign_create`返回的权威状态直接进入世界构筑。截图中的八个创建中存档未被证明为无效幽灵草稿，因此没有删除、隐藏或改写用户数据。

### 回归、Chromium 与 SQLite

- 新增回归覆盖旧60秒边界后的合法响应、永久挂起、TIMEOUT后重试、同意图并发、AUTH分类、取消、Queue等待计时、直接导航、同步双击与现有归档流程。定向55项通过；世界页面取消测试确认退出loading且不发布world。
- 真实Chromium在860×600、1366×768、1920×1080复测：同步双击产生一次`campaign_create`，直接进入`#/world?campaignId=...`并显示权威第01步；TIMEOUT、重试busy/disabled和取消态均可见，commit调用为0；横向溢出0、console error 0、键盘焦点outline可见。
- 显式保留Windows E2E主SQLite、三个自动完整备份和portable archive。四库均`integrity_check=ok`、外键违规0、重复idempotency/request/world 0、孤儿world 0；活动主库未完成请求0。一个恢复前不可变备份按测试设计保留`SENDING`请求和`RECOVERY_REQUIRED → TAVERN`恢复点，活动主库已恢复为`TAVERN`。

### 完整门禁与结束状态

- Frozen install、`pnpm check`、`pnpm test:windows-e2e`、`pnpm build:desktop`和macOS `.app`构建全部通过。完整门为Vitest 189 files / 1063 tests、Node 30/30、Rust 150 tests，另1项需真实Credential的DeepSeek测试ignored；Vite构建281 modules。npm/RustSec vulnerability均为0。
- 新增[`audit/V0_3_RC_PLAYTEST_FIX_REPORT.md`](audit/V0_3_RC_PLAYTEST_FIX_REPORT.md)、`DEC-158`与独立证据目录。两项结论均为`FIXED`；真实Provider、Windows安装生命周期、签名/notarization/发布仍不在授权和本机证明范围，因此不宣称`PUBLIC RELEASE READY`。未push、merge、签名或发布，也未进入V0.4。

## 2026-08-29 — V0.3 RC 实测追加 INVALID_OUTPUT 修复与真实链路复核

### 问题三调查与修复

- 在同一 `fix/v0.3-rc-playtest-issues` 分支追加 `RC-PLAYTEST-003`，冻结用户新截图，不覆盖第二轮审计证据。完整追踪 Provider、finish reason、规范化/parse、一次 repair、TypeScript Schema/业务规则、Rust commit 与 SQLite transaction。
- 原失败 raw response 按既有安全合同未持久化，因此不猜测截图对应的具体字段。确认的代码缺口为：裸 `JSON.parse` 误拒可确定围栏/唯一对象；`LENGTH` 未先分类为截断；repair Provider 失败遮蔽初始验证路径；世界构筑误用“已锁定硬结果”文案。Prompt Schema 与 `AI_TASK_SCHEMAS` 同源，未发现版本漂移；DeepSeek 当前请求为 `JSON_OBJECT`，本地完整验证仍不可省略。
- 实现提交 `1c5f164` 增加严格规范化与 `AMBIGUOUS_JSON` fail closed、finish reason 分类、INITIAL/REPAIR 脱敏诊断、repair 后完整复验，以及 JSON/Schema/截断/业务规则的阶段化 UI。没有放宽 Schema、删除业务规则、写入任意文本或把 Fake 结果冒充真实 Provider。

### 回归、真实 Provider 与 SQLite

- 新增合法 JSON 单次通过、围栏、唯一对象+短说明、多个对象拒绝、截断、缺字段、错类型/枚举、业务规则、repair 成功/失败/超时、无部分 commit、显式重试只提交一次和错误分类回归。Chromium 四种失败层级均可区分，860×600、1366×768、1920×1080 横向溢出 0、console error 0，硬结果误导文案已移除。
- 通过 OS Credential Store opaque reference 在独立数据根运行真实 DeepSeek/`deepseek-v4-flash` 三个不同世界组合；没有读取或打印原始 Key，也没有污染用户存档。三次均在完整响应前 `TIMEOUT`，finish reason、parse、Schema、business 和 commit 均 `NOT_REACHED`，故真实验证为 `BLOCKED_EXTERNAL`，不是 PASS。
- 隔离库 `integrity_check=ok`、外键违规 0、3 个创建中 Campaign、world 0、generation record 0、unfinished 0、重复 Campaign/request/world 0；用户主库前后状态和计数一致。显式同 Campaign 重试没有新增 Campaign/world/unfinished。

### 门禁与状态

- `pnpm check` 通过：Vitest 189 files / 1085 tests，另 2 files / 6 tests 按合同 skip；Node 30/30；Rust workspace、格式、release metadata、zh-CN、ESLint、TypeScript、rustfmt、严格 Clippy和archive interop全绿。
- `pnpm test:windows-e2e` 1/1、`pnpm build:desktop` 281 modules、标准 macOS `.app` 构建均通过；用户 `.gitignore` 保持未暂存。不 push、merge、签名、notarize 或发布。
- 问题二完全关闭；问题一与问题三的代码缺口已闭合，但真实 Provider 三次超时导致总体为 `BLOCKED_EXTERNAL`。因此本轮不输出 `FIXED — READY FOR RC REVALIDATION`，也不宣称 `PUBLIC RELEASE READY`。

## 2026-08-30 — V0.3 RC A–D 差分诊断与三问题最终闭合

### 差分根因与最小修复

- 在同一 `fix/v0.3-rc-playtest-issues` 分支从 `1934053` 继续，不改用户 `.gitignore`、不覆盖第二轮审计证据。通过 OS Credential Store opaque reference 执行 A–D：`/models` 167ms 成功；最小 JSON thinking disabled/default 分别 800ms/1155ms；完整生产世界 D 12.691s、`STOP`、1550/1047 tokens。
- TIMEOUT 的追加根因为 DeepSeek V4 Flash 默认高强度 thinking，而世界流只消费 content；8000 输出 token 也缺少样本依据。仅对 DeepSeek `GENERATE_WORLD/REFINE_WORLD` 显式发送 `thinking.disabled`，世界预算校准为 4096，其他任务/Provider 不变。
- D 首次完整响应复现出独立的 INVALID_OUTPUT 根因：TypeScript 结构验证通过，但 Desktop 未执行 application/Rust 已有的 Constitution 三条跨字段业务规则。Prompt 现明确三条恒等关系，Desktop `RULES_CHECK` 复用 `assertWorldConstitutionCompliance`，以 `WORLD_BUSINESS_RULE_INVALID` 和脱敏路径 fail closed；没有把业务错误改名为 Schema，也没有扩大 repair 范围。

### 三次真实世界验收与 SQLite

- 三个不同选项组合均通过真实 DeepSeek、生产 Prompt/JSON_OBJECT/streaming、4096 token 和隔离 SQLite。前两次首次通过并提交；第三次首次在 `locations[5].factionNames[1]` 被 Schema 拒绝，唯一一次 repair 使用独立 deadline，随后完整重跑 JSON、Schema、business、Rust validation 与 transaction。
- 初始三次时延/token 为 14.209s/1584→1328、10.047s/1588→915、45.514s/1589→3492；repair 为 20.120s/5192→3487。所有调用 `STOP` 且 Provider request ID 存在；cache hit/miss 未由响应提供，明确为 unavailable。
- 验收库 `integrity_check=ok`、外键违规 0、Campaign/world/constitution/generation record 均为 3、unfinished 0、部分 world 0、重复 idempotency/save/world 0。用户数据库未打开或修改。

### 门禁与结论

- `pnpm check` PASS：Vitest 189 files / 1087 tests，另 2 files / 6 tests 合同 skip；Node 30/30；Rust native 101、platform 5、provider 19、HTTP 11、secrets 3、Tauri 13 全绿，1 个环境变量式真实测试 ignored。Windows E2E 1/1、desktop 281 modules 和移除临时诊断入口后的标准 macOS `.app` 构建均 PASS。
- 新增追加证据目录 `audit/evidence/v0.3-rc-playtest-real-provider-1934053/`，更新 RC 修复报告与 `DEC-160`。三个问题均完全关闭，状态更新为 `FIXED — READY FOR RC REVALIDATION`；只批准 RC 复验，不构成公开发布批准。未 push、merge、签名、notarize 或发布。
## 2026-08-30 — V0.3 RC 职业池 TIMEOUT 追加闭环

- 在同一 `fix/v0.3-rc-playtest-issues` 分支与 `914165e` 之后固化真人实测职业池 TIMEOUT 截图，不覆盖二轮审计证据。差分确认职业池 12s Queue 总时限、未传递 AbortSignal、DeepSeek provider-default thinking 与 Queue 外 commit 共同导致问题；不将它写成普通网络中断。
- 严格结构任务统一 DeepSeek non-thinking；职业池改为 4096 token、60s 无进度时限、150s operation，Provider 取消和 commit 纳入同一 intent Queue。传输层对持续分块重置 idle deadline，并保留 300s 安全总上限。TIMEOUT UI 不再误述为“网络恢复”。
- 三组真实 DeepSeek 职业链路使用 OS Credential Store opaque reference 和隔离 SQLite。两个不同世界直接通过；既有 Campaign 显式重试先将 2048 token 截断响应 fail closed，4096 预算下 33.616s/3071 tokens 完整通过并单次提交。三库均 integrity ok、外键违规 0、unfinished 0、每 Campaign 1 个职业池/4 个职业/1 条 generation record，用户存档未打开或修改。
- 完整门禁通过：Vitest 189 files/1091 tests，Node 30/30，Rust native 101、platform 5、provider 19、HTTP 12、secrets 3、Tauri 13；Windows E2E 1/1、desktop build 281 modules 和标准 `Ember Tavern.app` 打包通过。临时诊断入口已移除，未 push、merge、签名、notarize 或发布。

## 2026-08-31 — V0.3.0 最终 Git 与 Release 发布

### 发布范围与元数据

- 完整复核 `docs/TASKS.md`：V0.3 的 60 项实现任务全部为 `DONE`，没有 `PARTIAL`、`NOT DONE` 或 `UNVERIFIABLE`，也没有把 V0.4 规划内容带入发布。补齐既有 DONE 项的真实完成日期，不改写任务结论。
- 将 `CHANGELOG.md`、`release-info.json`、生成的桌面端发布信息和 README 同步为稳定版 `0.3.0`，正式发布日期为 2026-08-31；新增 `docs/RELEASE_NOTES_0.3.md`。发布准备提交为 `221ef0f806bf08bfb9ce6deba49ef31cac7cb745`，PR 为 `#3`。
- 首轮 PR 生命周期批次 `33319736944` 发现 Windows PowerShell 在解析 `"$expectedVersion:"` 时失败；修复为显式 `${expectedVersion}` 边界并增加静态回归断言。修复提交 `e0d78874c316fe3f50c2c6109a37f8812f56fa31` 的复验批次 `33321429337` 四个 job 全部通过。

### 最终门禁与发布产物

- 本地 `pnpm check` 通过：Vitest 189 files / 1091 tests，另 2 files / 6 tests 按显式环境合同 skip；Node 33/33；Rust 153 tests 通过，另 1 项真实 Credential 测试 ignored；格式、release sync、zh-CN、ESLint、TypeScript、rustfmt、严格 Clippy和 archive interop 全绿。
- Windows E2E 1/1、desktop build 281 modules、三世界加自由输入 104 项可玩性证据、确定性性能门 24 PASS / 2 个真实 Provider 指标 `NOT_EVALUATED` 均通过。Windows CI 完成 NSIS、Credential Manager、WebView2、静默安装、启动与卸载；macOS CI 完成 `.app`、Keychain、WKWebView、启动、PlatformPaths 与哈希门禁。
- 正式 Release 只发布 Windows x64 NSIS 安装包、与 CI 一致的 macOS 应用包压缩档和 SHA-256 清单；不上传测试 SQLite、用户存档、Credential、日志或审计临时数据库。当前产物未做代码签名和 Apple notarization，该限制在 Release Notes 中明确披露。

### Git 与发布边界

- 发布分支先正常合并当时的 `origin/main`，保留完整历史，再通过 PR #3 以普通 merge 进入 `main`；最终 `v0.3.0` 为指向发布后 `main` HEAD 的 annotated tag。GitHub Release 固定入口为 `https://github.com/qwerxxc7635-crypto/AI-tavern/releases/tag/v0.3.0`。
- 用户已有 `.gitignore` 修改始终保持未暂存，未进入任何发布提交。发布过程未读取、打印或上传真实 API Key，未修改用户数据库，也未开始 V0.4。

## 2026-09-01 — M0-T01 完成 v0.4.1 Scope Freeze

### 输入与基线

- 从正式发布基线 `210e699d0aba355b5f00fd4bf6ed777e6977356d`（`v0.3.0`）创建 `task/M0-T01-v0-4-1-scope-freeze`；用户已有 `.gitignore` 变更继续保持未暂存且不纳入任务提交。
- 核对 V5.2 Combat SOT、`V0.4.1_TASKS_FINAL.md` 和 Runtime Combat Assets 三项输入。两份文档 SHA-256 分别为 `f0d38e3ab772817f8a0bde3409d2b5fdac5f6e922c22aa9703988807470ec07c`、`7e31d914bb303ad5c8cbf2a24bf75da4e11d2724313eb01967371115692b954b`；素材包 `SHA256SUMS.txt` 全项 PASS，包声明 119 个 Runtime Assets。
- 修改前基线 `pnpm check` PASS：Vitest 189 files / 1091 tests，另 2 files / 6 tests 按合同 skip；Node 33/33；Rust workspace 全绿，1 个需明确 Credential 授权的真实 DeepSeek 测试 ignored。Windows 平台证据本机 `NOT_RUN`。

### 范围冻结

- 新增 `docs/v0.4.1/V0_4_1_SCOPE_AND_RELEASE_GATE.md`，冻结 v0.4.1 Combat System 的权威优先级、IN/OUT OF SCOPE、0.4.2/0.4.3/0.4.4 边界、架构与数据红线、SPEC BLOCKER 判定和 Gate A–G/最终 Release Gate。
- 文档只提供范围入口与证据要求，不复制 V5.2 具体规则，不创建 V5.3，也不提前实现 Map、Dialogue、World Generation、iOS 或任何 Combat Runtime 代码。
- `docs/TASKS.md` 增加 v0.4.1 当前执行状态：M0-T01 PASS，下一项严格为 M0-T02 Repository Baseline Audit。

### 验证与结束状态

- Runtime Assets 的官方校验清单逐项 PASS；没有重新生成、修改或复制素材。
- 文档格式、链接、任务状态与 diff 在提交前复核；M0-T01 未发现 Scope 冲突或 SPEC BLOCKER。
- M0-T01 结束状态为 PASS；下一任务严格为 M0-T02，不在本任务提交中包含仓库映射或 Combat 实现。

## 2026-09-01 — M0-T02 完成 Repository Baseline Audit

### 真实生产架构

- 从 M0-T01 提交 `751e278` 创建 `task/M0-T02-repository-baseline`，只读审计 pnpm/Cargo workspace、React/Tauri、Rust Native、SQLite migrations、事务、Event Ledger、AI、Candidate、Provider、Character、Save、Tests 与 CI；未修改产品代码或 schema。
- 确认桌面生产写入路径为 `React service -> Tauri command -> Rust CampaignStore -> short SQLite transaction`。TypeScript contracts/domain/application/persistence 是共享合同、规则/参考实现和互操作测试层；Windows UI 当前不直接依赖 TS persistence，Combat 不能只实现 TS 测试层。
- 当前 SQLite schema 32、82 张表、portable save schema 3 / world schema 1；Event Ledger 是最小审计层而非完整 Event Sourcing。Rust/TS archive 双实现与互操作 fixture 必须在 M10 同步扩展。

### 可复用能力与缺口

- 新增 `docs/v0.4.1/V0_4_1_REPOSITORY_MAPPING.md`，逐项记录现有 contracts/domain/application/ai-core/prompts/persistence、CampaignStore、Tauri、secure Provider/Credential、Character/Rules、Save/Import、UI/localization 与 CI 的复用边界。
- Character 的唯一基础属性为 `physique/agility/knowledge/charisma`，1–5 且总和 10，并由 SQLite 保证不可变；CombatAttributeResolver 必须在 M0-T04 显式映射，不能创建平行 Strength/Agility/Focus 属性。
- 记录 11 组 Combat Schema/API gaps，包括 versions/RNG/state/scheduler/effects/profiles/AI/UI/persistence/tests；这些缺口与 v0.4.1 TASKS 一致，未发现需要第二套基础设施或重新设计产品规则的理由。

### 验证与结束状态

- 映射引用均来自当前 HEAD 的真实文件/API/SQL/CI，不依据旧 PRD 猜测；基线 `pnpm check` 继续沿用 M0-T01 修改前真实 PASS 证据。
- 文档结构、格式、链接、diff 与用户 `.gitignore` 隔离在提交前复核；无 SPEC BLOCKER。
- M0-T02 结束状态为 PASS；下一任务严格为 M0-T03 Combat Module Mapping。

## 2026-09-01 — M0-T03 完成 Combat Module Mapping

### 唯一权威 Runtime 边界

- 从 M0-T02 提交 `3639a5d` 创建 `task/M0-T03-combat-module-mapping`。新增 `docs/v0.4.1/V0_4_1_COMBAT_MODULE_MAPPING.md`，把 V5.2 的 core/abilities/effects/statuses/tags/reactions/ai/balance/profiles/persistence/presentation 映射到真实 workspace。
- 冻结一套纯 Rust `ember-combat-core` 作为唯一权威 Combat Runtime：无 Tauri、rusqlite、Provider、UI、system time 或动态 plugin 依赖。TypeScript 只承载 wire contracts、AI orchestration 和 React presentation，不实现第二套可执行 Combat Engine。
- 生产路径继续为 React typed gateway -> Tauri -> native adapter -> Combat Core -> existing CampaignStore/SQLite；Core 不反向依赖 presentation/persistence。
- 新增 `DEC-162` 记录上述重大架构选择、理由和可审计边界。

### 子系统归属

- Ability/Effect/Tag/Status/Reaction/Scheduler/Profile/Balance/Utility AI 的规则解释集中于 Core；AI content 复用 `AI_TASKS`、GeneratorRunner、DesktopAIOrchestrator、Candidate、Provider 和 Prompt packages，native facade 负责 programmatic numbers/validation/commit。
- M10 才通过现有 migration/archive/CampaignStore 增加 BattleRecord/ActiveCombatSave；M2/M4 仅定义稳定 Runtime snapshots。Event Ledger 只接 selected committed facts，不复制第二套 ledger。
- Combat UI 复用现有 React service、localization、primitives/game-components 与 design tokens；legal targets/cost/mechanical facts 来自 Core query，不在 UI 重算。

### 验证与结束状态

- Mapping 覆盖 physical path、public facade、依赖禁令、AI/World/Character/Persistence/Presentation/Test ownership；没有创建空目录、代码或 schema。
- 文档格式、链接、ownership 单一性与 diff 在提交前复核；无 SPEC BLOCKER。
- M0-T03 结束状态为 PASS；下一项依赖满足任务为 M0-T04 v0.3 Character Schema Discovery。

## 2026-09-01 — M0-T04 完成 v0.3 Character Schema Discovery

### Character 真源与映射

- 从 M0-T03 提交 `9506d8c` 创建 `task/M0-T04-character-schema-mapping`，逐项读取 PlayerCharacter、CharacterRuleState、UniversalCharacterProfile、NpcProfile/NpcLodProfile、Semantic Equipment 及 migrations 0011/0013/0016；未修改产品代码或数据库 schema。
- 新增 `docs/v0.4.1/V0_4_1_COMBAT_ATTRIBUTE_MAPPING_MATRIX.md`。冻结 `BODY/FINESSE/INTELLECT/PRESENCE` 到现有 `physique/agility/knowledge/charisma` 的唯一 mapping v1，Save 映射为 `FORTITUDE/REFLEX/MENTAL`，initiative base 使用 `agility`。
- 四个 WorldCombatProfile 共享同一基础存储映射；Fantasy/Sci-Fi/Cultivation/Urban 的属性名只作为 profile alias。神识、Focus、Neural Enhancement、装备和 status 必须是独立 typed modifier/resource term，不得成为平行基础属性。
- 玩家导入读取 CharacterRuleState 并与 PlayerCharacter/UniversalCharacterProfile 做逐字段相等校验；drift、非法 allocation 或未知 mapping version 必须拒绝 Combat。Resolved projection 与 mapping/profile version 必须随 Active Combat 保存，replay 不重新解释。

### Schema gaps 与兼容边界

- 明确六个必要 gap：NPC/Enemy numeric Combat projection、Combat proficiency catalog、typed Combat equipment projection、WorldProfile resource key binding、legacy status/trait adapter、mapping/profile version persistence。
- 发现 migration 0013 从 `skills_json[*].name` 构建 UniversalCharacter skills，而真实 `RuleSkill` 字段为 `key`；因此 Universal textual projection 不得作为 numeric Combat authority。未知 skill/status/trait/equipment 文本统一不产生 Combat 数值效果，禁止 LLM 猜测。
- v0.3 普通玩家存档使用现有属性与确定性 defaults，无需 M0 eager migration；NPC 没有合法 projection 时不能进入真实 roster，旧 Active Combat 缺少受支持版本时必须安全拒绝。
- 新增 `DEC-163` 记录 mapping、source precedence、version/replay 和禁止第二属性系统的决定。

### 验证与结束状态

- Matrix 覆盖 source field、Combat role、四种 WorldProfile mapping、default/migration、version 与 schema gap；各 gap 标明 blocking point 与最小后续扩展方向。
- Prettier、文档链接/结构、任务状态和 `git diff --check` 在提交前复核；用户已有 `.gitignore` 修改继续保持未暂存且不纳入任务提交。未发现 SPEC BLOCKER。
- M0-T04 结束状态为 PASS；下一项严格为 M0-T05 Combat Extensibility Architecture Contract。

## 2026-09-01 — M0-T05 完成 Combat Extensibility Architecture Contract

### 扩展机制与所有权冻结

- 从 M0-T04 提交 `1fbc5bf` 创建 `task/M0-T05-combat-extensibility-contract`，读取 `V0.4.1_TASKS_FINAL.md` §1 与 V5.2 相关边界；未新增 Combat 代码、schema、catalog 空壳或未来功能。
- 新增 `docs/v0.4.1/COMBAT_EXTENSIBILITY_CONTRACT.md`：封闭语义使用 Enum/tagged union，开放非执行词汇使用 stable ID + static catalog，可执行 primitive 使用 typed static handler set，V5.2 明确例外使用 subsystem-owned local typed override，四世界使用 developer-defined profile composition。
- 冻结 `DamageChannelCatalog` 只拥有 channel identity/common metadata；world-specific `primaryMitigationByChannel` 只由 resolved WorldCombatProfile 拥有。Core、Balance、AI Exposure、Presentation、Persistence 的职责不可混入 handler 或跨层复制。
- 冻结 combatSchema/ruleset/balance/worldProfile/attributeMapping/rngContract 六类默认 version ownership；只有现有版本无法唯一解释且影响 replay 时才允许增加独立版本。

### 禁止项与审计入口

- 明确禁止 Generic Rule Capability Engine、Runtime Plugin Registry、脚本/表达式 VM、万能 Ability Graph、AI runtime code、per-Ability State mutation、flat duplicated whitelist、boolean flag soup、四套 Combat Engine 和 distributed semantic switch。
- Contract 增加 change admission template 以及 representation/ownership/version/negative-search 四组 checklist，可由每个 milestone review 和 M12 独立审计直接复用。
- 新增 `DEC-164` 记录最窄静态机制、单一 mitigation owner 与 version ownership 决定。

### 验证与结束状态

- Contract 覆盖 M0-T05 Scope/DoD 且没有形成第二份产品规则 SOT；文档只引用 V5.2 与 TASKS 的实现约束。
- Prettier、链接、结构、diff 和提交范围在提交前复核；用户 `.gitignore` 保持未暂存。无 SPEC BLOCKER。
- M0-T05 结束状态为 PASS；下一项严格为 M0-T06 Baseline Tests / Branch / CI。

## 2026-09-01 — M0-T06 完成 Baseline Tests / Branch / CI

### Branch 与环境基线

- 从 M0-T05 提交 `4e0d12939f6d592663f806afdc794d4c2959b8d7` 建立 `develop/v0.4.1-combat`，并创建独立任务分支 `task/M0-T06-baseline-ci`。v0.4.1 继续采用 accepted task commit 线性快进与每 Task 独立 branch/commit。
- 新增 `docs/v0.4.1/V0_4_1_BASELINE_AND_CI.md`，记录正式 v0.3.0 base、HEAD、macOS/arm64、Node/pnpm/Rust/SQLite/Git、lock/workflow SHA-256、32 个 migration、save schema 3、world schema 1 和尚不存在 Combat durable tables。
- 工作树唯一基线变更仍为用户 `.gitignore`；diff SHA-256 为 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987`，保持未暂存、不纳入提交。

### 完整测试基线

- `pnpm check` exit 0：Prettier、release metadata 0.3.0、zh-CN、ESLint、TypeScript 全部 PASS。
- Vitest 189 files / 1091 tests PASS，另 2 files / 6 tests 按既有合同 skip；Node 33/33 PASS；Rust aggregate 153 PASS、0 fail、1 个需显式授权 DeepSeek credential 的测试 ignored。
- archive interop 的 TypeScript 14/14 双向运行与 native 1/1 PASS。基线已知失败为 0；后续不得用新增 skip/ignore 或删除测试掩盖 Combat regression。

### CI/平台诚实边界

- 静态确认 CI shared matrix 覆盖 Windows/macOS，另有 Windows NSIS/install lifecycle 与 macOS app lifecycle/evidence jobs；相关 workflow contract tests 已通过。
- 本地未触发远端 CI，因此 Windows/macOS GitHub jobs、Windows NSIS/WebView2/Credential Manager 和 packaged macOS lifecycle 均记录为 `NOT_RUN`；真实 Provider 指标为 `NOT_EVALUATED`，未冒充 PASS。
- 文档冻结 baseline reproduction/failure attribution：相同 commit/toolchain 可复现才是 BASELINE/ENVIRONMENT，否则是新 regression；flaky 不得靠重复运行降级。

### 结束状态

- M0-T06 Scope/DoD 全部满足；用户变更隔离、文档格式、链接、diff 和 commit scope 在提交前复核。
- M0-T06 结束状态为 PASS；下一项严格为 M0-T07 Task / Log / Commit Protocol。

## 2026-09-01 — M0-T07 完成 Task / Log / Commit Protocol；M0 Gate PASS

### 执行与证据协议

- 从 M0-T06 提交 `7dda1e4` 创建 `task/M0-T07-task-log-commit-protocol`。新增 `docs/v0.4.1/V0_4_1_TASK_EXECUTION_PROTOCOL.md`，固定 TASKS、DEVELOPMENT_LOG、DECISIONS、`docs/audit/` 与 `docs/audit/evidence/v0.4.1/` 的权威职责。
- 冻结 `NOT_STARTED -> IN_PROGRESS -> PASS/FAIL/BLOCKED` 与显式 `NOT_RUN` 状态语义；Task 只有在 Scope/DoD、相关测试、diff review、文档和 closure commit 全部满足时才是 PASS。
- 冻结 `develop/v0.4.1-combat` 线性快进与 `task/<TASK-ID>-<scope>` 独立分支/commit；显式路径暂存，用户 `.gitignore`、credential、local DB、build/cache 和临时诊断不得混入。
- 定义每 Task 最小日志字段、machine/platform evidence 目录与 manifest、Fake/real Provider/platform 证据边界、SPEC BLOCKER 内容、milestone Gate closure 和 final release phrase 保留规则。

### M0 Gate 复核

- M0-T01 Scope `751e278`、M0-T02 Repository Mapping `3639a5d`、M0-T03 Module Mapping `9506d8c`、M0-T04 Attribute Matrix `1fbc5bf`、M0-T05 Extensibility `4e0d129`、M0-T06 Baseline `7dda1e4` 均独立 PASS。
- M0 baseline 的本地完整测试零失败；六项 Vitest skip、一个 credential-only ignored test 与远端 platform `NOT_RUN` 均保持显式，未伪装为新 gate PASS。
- Extensibility checklist、Character schema gaps、single Rust Core、existing SQLite/AI/persistence ownership 与 v0.4.1 scope 彼此一致；无开放 SPEC BLOCKER。

### 验证与结束状态

- 文档引用、状态、branch/commit lineage、格式与 diff 在提交前复核；用户 `.gitignore` 仍未暂存。
- M0-T07 和 M0 Gate 结束状态均为 PASS；唯一下一项为 M1-T01 Combat Version Contract，不进入其他任务或相邻版本。

## 2026-09-01 — M1-T01 完成 Combat Version Contract

### Rust Core 与跨层合同

- 从 M0 Gate 提交 `3e8d4f8` 创建 `task/M1-T01-combat-version-contract`，新增 workspace crate `ember-combat-core`。Core 当前生产依赖只有 serde，不依赖 Tauri、SQLite、Provider、网络、UI、filesystem 或 system time。
- 新增七字段 `CombatVersionSet` 与非零 `CombatVersion`：combat schema、ruleset、balance、engine、world profile、attribute mapping、RNG contract 当前均为 version 1。提供逐字段显式 support gate、stable wire field names 和固定顺序 deterministic debug identity。
- 新增 TypeScript `packages/contracts/src/combat.ts` wire parser/export；Rust 与 TypeScript 共享 exact camelCase JSON fixture。Unknown/missing/zero/fractional versions fail closed；未来正整数可先结构解析，再由 compatibility gate 明确拒绝，不回退到 current。
- Version set 已通过测试证明可 flatten、序列化并恢复到 BattleRecord/ActiveCombatSave 等价 envelope；durable SQLite schema/table 仍由 M10-T01 所有，本任务未提前增加 migration。
- 新增 `DEC-165` 记录七字段、正整数、结构解析与执行兼容分离、无时间规则身份和 version ownership 边界。

### 定向验证

- `cargo test -p ember-combat-core`：5/5 PASS；覆盖 shared fixture、exact round-trip、BattleRecord/ActiveCombatSave flatten、非法结构、未来版本拒绝与无时间 identity。
- `pnpm exec vitest run packages/contracts/src/combat.test.ts`：1 file / 6 tests PASS；覆盖 TS parity、unknown/missing/zero/fraction/unsupported future。
- `pnpm typecheck` PASS；`cargo clippy -p ember-combat-core --all-targets --all-features -- -D warnings` PASS；`cargo tree` 确认生产依赖只有 serde。
- 完整 `pnpm check` PASS：Vitest 190 files / 1097 tests，另 2 files / 6 tests 按基线合同 skip；Node 33/33；Rust 新 Core 5/5、workspace aggregate 158 PASS，另 1 个真实 credential test ignored；archive interop 双向门禁通过。

### 结束状态

- M1-T01 Scope/DoD 全部满足；格式、diff、共享 fixture 和用户 `.gitignore` 隔离在 closure commit 前复核。
- M1-T01 结束状态为 PASS；下一项严格为 M1-T02 Combat Seed / RNG Channels。

## 2026-09-01 — M1-T02 完成 Combat Seed / RNG Channels

### RNG Core

- 从 M1-T01 提交 `65acb06` 创建 `task/M1-T02-combat-rng-channels`，在 pure `ember-combat-core` 新增唯一 RNG executor；没有使用 `rand`、system time、OS randomness、Provider、SQLite、Tauri 或 UI state。
- 固定 `initiative/resolution/utilityTieBreak` 三个 stable channels。每个 channel 从 32 位小写 hex randomSeed、combatInstanceId、rngContractVersion 和 channelId 经 domain-separated length-prefixed SHA-256 独立派生 64-bit state，再使用 SplitMix64 与独立 cursor。
- bounded draw 使用 rejection sampling；channel 明确传入。Utility 连续消费 100 次不会改变下一次 Resolution roll；seed 或 combatInstanceId 变化会改变 streams。
- Snapshot 固定三 channel 顺序并保存 16 位小写 `stateHex` 与 JS-safe cursor；restore 对 version/order/state/cursor/unknown field fail closed，能在暂停点产生与原对象完全相同的后续 rolls。`CombatRng` 不实现 Clone。

### 跨层 checkpoint contract

- TypeScript `packages/contracts/src/combat.ts` 只新增 channel/snapshot DTO 与 exact parser，不实现随机算法。Rust/TS 共享初始 checkpoint fixture，固定三个初始 state 与 JSON shape。
- snapshot/inspection 只需 immutable borrow，不推进 cursor；UI Preview/Log/Tooltip/LegalTargets/default Intent 尚无任何 Core RNG 调用路径。
- 新增 `DEC-166` 记录 derivation、SplitMix64、rejection sampling、safe JSON 与 rngContractVersion ownership。

### 验证与结束状态

- `cargo test -p ember-combat-core`：12/12 PASS；包含三组跨平台 golden d20 vectors、channel isolation、seed/instance isolation、snapshot/resume、read-only inspection、shared fixture 与负向边界。
- `pnpm exec vitest run packages/contracts/src/combat.test.ts`：1 file / 12 tests PASS；`pnpm typecheck` 与 strict Core Clippy PASS。
- 首次完整门禁在两个 test-only non-null assertions 被 ESLint 拒绝；改为显式 fixture 缺失检查，不放宽 lint。随后完整 `pnpm check` PASS：Vitest 190 files / 1102 tests，另 2 files / 6 tests 基线 skip；Node 33/33；Rust 165 PASS、1 个 credential-only ignore；archive interop 双向通过。
- Format/diff/dependency negative scan 与用户 `.gitignore` 隔离在 closure commit 前复核。M1-T02 结束状态为 PASS；下一项严格为 M1-T03 CombatState Aggregate。

## 2026-09-01 — M1-T03 完成 CombatState Aggregate

### 单一权威 Runtime State

- 从 M1-T02 提交 `9df4cae` 创建 `task/M1-T03-combat-state-aggregate`，在 pure `ember-combat-core` 新增唯一 `CombatState`；没有新增 SQLite schema、Tauri command、Provider、UI state 或第二套 TypeScript engine。
- 聚合覆盖 combatants、HP/AP/Reaction/resources/shield/statuses/ability usage、timeline、round/roster、objectives、reinforcement、provisional delta、scheduler checkpoint、pending reaction、result candidates/confirmed result，以及 versions、seed、revision、sequence 与 RNG snapshot。
- Runtime 子结构均为 exact serde DTO，unknown fields fail closed；集合使用显式有序 `Vec`，权威状态不含 map、float、系统时间或 presentation state。UI-only 字段不能被反序列化进 `CombatState`。
- `combatSchemaVersion=1` 使用 compact serde JSON bytes 作为 canonical state encoding，并以 lowercase SHA-256 建立 state hash；snapshot envelope 在 restore 前验证 hash，篡改会 fail closed。只读 serialization/hash/snapshot 不推进任何 RNG cursor。
- 新增 `DEC-167` 记录单一 aggregate、canonical encoding、hash 与后续 version/invariant ownership；`serde_json` 仅作为 Core canonical serialization dependency。

### 验证与结束状态

- `cargo test -p ember-combat-core`：17/17 PASS，其中新增 5 项覆盖全部 state partition round-trip、稳定 hash/envelope restore、tamper/unknown UI field rejection、collection order 与 RNG read-only。
- `cargo clippy -p ember-combat-core --all-targets -- -D warnings` PASS；代码格式检查 PASS。
- 完整 `pnpm check` PASS：Vitest 190 files / 1103 tests，另 2 files / 6 tests 按基线合同 skip；Node 33/33；Rust workspace 170 PASS、1 个 credential-only ignore；archive interop 双向通过。
- Scope/DoD、diff 与用户 `.gitignore` 隔离在 closure commit 前复核；无 SPEC BLOCKER。M1-T03 结束状态为 PASS；下一项严格为 M1-T04 CombatStateInvariantValidator。

## 2026-09-01 — M1-T04 完成 CombatStateInvariantValidator

### 统一 commit / restore 边界

- 从 M1-T03 提交 `6474401` 创建 `task/M1-T04-combat-state-invariant-validator`，新增 pure Core `CombatStateInvariantValidator`；所有错误包含 stable code、combatantId 与可选 resourceId，Validator 只拒绝、不静默 clamp、不产生 UI 文案。
- 覆盖 HP、Shield、AP、ReactionCharges 的上下界与 effective max，普通 resource 的非负 `min/current/max`，以及压力资源同时具备且满足合法范围的 `minValue/overheatThreshold/hardMaxValue` contract。
- 覆盖 `Active -> HP>0`、`Downed/Defeated -> HP=0`；Removed 不被错误等同于 Defeated。当前 combatants 与未部署 reinforcement 的 initial runtime snapshot 均使用同一校验路径。
- 新增 `CombatState::validate_for_commit` 作为后续 Atomic State/Result Commit 入口。Envelope restore 固定先验 SHA-256，再做 invariant validation；重算了合法 hash 的非法 Save 仍被拒绝。
- 测试证明 Working State 可在不可观察阶段暂时为 `Active + HP=0`，但 commit validation 会拒绝；完成同一 Working State 的 Downed LethalResolution 后才通过。新增 `DEC-168` 固定统一 owner 与拒绝型语义。

### 验证与结束状态

- `cargo test -p ember-combat-core`：24/24 PASS；新增 7 项覆盖所有 bounded combatant 上下界、resource/Heat contract、三种 HP/state 关系、Working/commit 边界、hash-valid invalid save 与 reinforcement restore。
- `cargo clippy -p ember-combat-core --all-targets -- -D warnings`、Rustfmt 与 `git diff --check` PASS。
- 完整 `pnpm check` PASS：Vitest 190 files / 1103 tests，另 2 files / 6 tests 基线 skip；Node 33/33；Rust workspace 177 PASS、1 个 credential-only ignore；archive interop 双向通过。
- Scope/DoD 与用户 `.gitignore` 隔离在 closure commit 前复核；无 SPEC BLOCKER。M1-T04 结束状态为 PASS；下一项严格为 M1-T05 CombatAttributeResolver。

## 2026-09-02 — M1-T05 完成 CombatAttributeResolver

### Pure Core mapping 与真实 native source adapter

- 从 M1-T04 提交 `711abd1` 创建 `task/M1-T05-combat-attribute-resolver`。Core 新增 version-gated `CombatAttributeResolver`；native bridge 只新增对 Core 的单向依赖，没有让 Core 依赖 rusqlite、Tauri、Provider、UI、filesystem 或 system time。
- Native adapter 在一个 deferred SQLite read transaction 中读取真实 v0.3 `character_rule_states`、`player_characters.attributes_json` 与可选 `universal_character_profiles`，交给 Core 做 1..5/总和 10、schema/revision 与三投影逐字段一致性校验；不修改数据库。
- 固定 BODY/FINESSE/INTELLECT/PRESENCE、FORTITUDE/REFLEX/MENTAL 与 initiative base 映射。四个 WorldProfile 使用同一 canonical source；profile base defense/initiative modifier 作为独立 versioned terms，不把世界 alias 变成平行属性。
- Legacy status/trait attribute modifier 保存 category/source/role，canonical sort、checked addition 与 duplicate rejection；numeric RuleSkill + typed trait modifier 优先于 developer catalog 的 exact textual baseline。未知文本、career、derived attribute、NPC prose 无数值路径，prose-only NPC 明确拒绝。
- Resolved snapshot 保存 source/universal revision、attribute/profile versions、base/effective attributes、HP、proficiencies 与 applied modifiers；查询方法覆盖 Attack/Defense/Ability DC、三 Save、initiative 与 base defense。新增 `DEC-169` 记录单一 snapshot/Resolver 边界。

### 验证与结束状态

- `cargo test -p ember-combat-core`：29/29 PASS；其中 5 项 M1-T05 测试覆盖四角色、三 Save、四 Profile、Mental、proficiency precedence、unknown text、canonical modifier order、projection drift、invalid allocation、future version/source schema、unknown role、NPC rejection、determinism 与 RNG 零消费。
- `cargo test -p ember-native-bridge combat_attribute_adapter`：3/3 PASS；真实 migrated v0.3 SQLite fixture 覆盖三投影、status/trait/skill、四 Profile、关闭重开、unknown Universal text 中立与合法 allocation drift rejection。
- Core/native strict Clippy、Rustfmt 与 `git diff --check` PASS。完整 `pnpm check` PASS：Vitest 190 files / 1103 tests，另 2 files / 6 tests 基线 skip；Node 33/33；Rust workspace 185 PASS、1 个 credential-only ignore；archive interop 双向通过。
- GAP-01、GAP-03/04/05 的后续 owner 保持显式，未通过 hardcode/default 提前宣称关闭。Scope/DoD 与用户 `.gitignore` 隔离在 closure commit 前复核；无 SPEC BLOCKER。M1-T05 结束状态为 PASS；下一项严格为 M1-T06 Command Envelope / Command Source。

## 2026-09-02 — M1-T06 完成 Command Envelope / Command Source

### 统一边界与 source 权限

- 从 M1-T05 提交 `34500fe` 创建 `task/M1-T06-command-envelope-source`。Pure Core 新增 exact `CombatCommandEnvelope`、typed payload/source、accepted command 与 ledger；没有新增 SQLite schema、Provider、UI action、precondition、reservation 或 execution 实现。
- Player、UtilityAI、Replay、Test、InternalDeterministic source 在类型层分离。只有 Player/UtilityAI/Test 可进入 accepted history；Replay 必须匹配已有 accepted command，Internal action 仅验证并返回可执行 typed value，二者都不会推进 accepted sequence。
- 外部 accepted sequence 从 1 单调递增并受 JavaScript safe integer 上限保护；重复 commandId 且内容完全相同幂等返回原 command，不同 source/actor/version/payload 使用同 ID 时 fail closed。Restore 拒绝 sequence gap、重复 ID、内部 payload 与非法 source 权限。
- UtilityAI 可提交真实 Ability/EndTurn/Escape command，但不能修改玩家战术策略/偏好，也不能替 Player 解决 Ask reaction。Reaction choice/selection 一致性、Internal target canonical order、stable ID 与完整 version support 均在边界拒绝非法输入。
- TypeScript 新增同构 exact parser 和共享 JSON fixture，覆盖六类外部 payload、Replay 与 Internal envelope；unknown fields、unsafe sequence、非法 ID、accepted Replay/Internal、UtilityAI 越权及 incoherent reaction 均被拒绝。新增 `DEC-170` 固定 accepted/replay/internal 历史语义。

### 验证与结束状态

- `cargo test -p ember-combat-core`：36/36 PASS，其中新增 7 项覆盖共享 wire fixture、所有外部 payload、幂等/conflict、source 权限、Replay、Internal 与 malformed history/version/ID；strict Core Clippy 与 Rustfmt PASS。
- TypeScript focused：2 files / 27 tests PASS；新增 command contract 15 tests。TypeScript、ESLint 与 Prettier PASS。
- 完整 `pnpm check` PASS：Vitest 191 files / 1118 tests，另 2 files / 6 tests 基线 skip；Node 33/33；Rust workspace 192 PASS、1 个 credential-only ignore；archive interop 双向通过。
- Scope/DoD 与用户 `.gitignore` 隔离在 closure commit 前复核；无 SPEC BLOCKER。M1-T06 结束状态为 PASS；下一项严格为 M1-T07 Shared Precondition Rule System。

## 2026-09-02 — M1-T07 完成 Shared Precondition Rule System；M1 Gate PASS

### 单一 evaluator 与两个检查时点

- 从 M1-T06 提交 `648c16e` 创建 `task/M1-T07-shared-precondition-rules`。Pure Core 新增唯一 `PreconditionRuleSystem`；Submission 与 ExecutionRevalidation 传入同一 rule set，后者只筛选 `revalidateBeforeResolution=true`，没有复制第二套规则 switch。
- Rules 覆盖 source controls actor、stable input point、actor/ability/target existence/state/legality、AP/resource/item availability、cooldown、Normal Owner Turn/per-battle usage、actor/target required/forbidden Tags 与 resource hard limit。默认 metadata 遵守原始余额只在 Submission 检查、动态状态在 Execution 复查的 V5.2 边界。
- Evaluator 直接只读 `CombatState` 的 actor/AP/resource/usage/cooldown；Ability、Tag、LegalTargets 与 inventory 使用 typed facts。Reaction redirect 使用 effective target，不改原 Command。所有 failure 输出 stable ruleId/code/subjectId 且保持规则声明顺序；UI 不在 Core 内生成文案。
- Definition validation 拒绝非法/重复 ruleId、负 bound 与非法 typed stable ID。评估不修改 State，不占用/扣除成本，不增加 usage/cooldown，不消费 RNG；Reservation 与 lifecycle orchestration 保留给 M2 owning tasks。新增 `DEC-171` 固定单一 evaluator、metadata 与 owner 边界。

### 验证与 M1 Gate

- `cargo test -p ember-combat-core`：43/43 PASS，其中新增 7 项覆盖两时点同系统、Submission-only filtering、PreAction actor/ability/cooldown 失效、合法 Redirect、成本/Tag/target/usage/Heat structured failures、missing facts fail closed、非法 definitions、deterministic order/serialization 与 RNG read-only。
- `cargo clippy -p ember-combat-core --all-targets -- -D warnings`、Rustfmt、Prettier 与 `git diff --check` PASS。
- 完整 `pnpm check` PASS：Vitest 191 files / 1118 tests，另 2 files / 6 tests 基线 skip；Node 33/33；Rust workspace 199 PASS、1 个 credential-only ignore；archive interop 双向通过。
- M1-T01 Version、T02 RNG、T03 State、T04 Invariant、T05 Attribute Adapter、T06 Command Boundary、T07 Precondition 均有独立实现与测试，M1 Gate PASS。用户 `.gitignore` 继续隔离；无 SPEC BLOCKER。下一项严格为 M2-T01 Cost Reservation Model。

## 2026-09-02 — M2-T01 完成 Cost Reservation Model

### 权威 Reservation ledger

- 从 M1 Gate 提交 `2b650b6` 创建 `task/M2-T01-cost-reservation-model`。`CombatState` 新增 canonical Combat inventory 与 ordered cost reservation ledger；AP、Resource、Item、ReactionCharge 使用封闭 typed asset，不新增通用经济 DSL。
- Reservation 绑定 reservationId/commandId、safe sequence、可选 parentReservationId 与逐 line amount/interrupt policy/state。Reserve 只计算当前余额减去全部 active reservations，不先扣费；同 identity/content 重试返回原 record，identity collision 或重复 asset fail closed。
- Parent/child 使用同一 availability，嵌套 Reaction 无法重复占用 Reaction Charge；active child 阻止 parent transition。Commit 在 working clone 中原子扣除全部 line；Cancel 默认 Release，只有 `consumeCostOnInterrupt=true` line 提交，且不会增加 cooldown/usage。
- Item commit 只修改 Combat Runtime inventory 并追加 ItemQuantity provisional delta，不提交 canonical world inventory。Reservation/Commit/Cancel 均推进 state revision，但幂等重试不推进；RNG snapshot 不变。
- Ledger 随 CombatState canonical JSON/hash 保存。统一 invariant restore 检查 sequence 连续性、reservation/command uniqueness、parent 顺序、record/line status coherence、definition、asset existence、inventory 非负/唯一与 active reserved coverage；篡改后即使重算 state hash 也 fail closed。Precondition 的 Item check 改为直接读取权威 Combat inventory，移除临时 item facts 副本。新增 `DEC-172`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：49/49 PASS，其中新增 6 项覆盖四类成本 reserve/commit、并发重复占用、nested Reaction、active child transition、interrupt 部分消费、Item provisional delta、atomic failure、malformed request、save/restore、tampered ledger 与 reserve/commit/cancel 幂等。
- `cargo clippy -p ember-combat-core --all-targets -- -D warnings`、Rustfmt、Prettier 与 `git diff --check` PASS。
- 完整 `pnpm check` PASS：Vitest 191 files / 1118 tests，另 2 files / 6 tests 基线 skip；Node 33/33；Rust workspace 205 PASS、1 个 credential-only ignore；archive interop 双向通过。
- Scope/DoD 与用户 `.gitignore` 隔离在 closure commit 前复核；无 SPEC BLOCKER。M2-T01 结束状态为 PASS；下一项严格为 M2-T02 Submission Validation。

## 2026-09-02 — M2-T02 完成 Submission Validation

### 单一原子 submission 入口

- 从 M2-T01 提交 `eca8968` 创建 `task/M2-T02-submission-validation`。新增 pure Core `CombatSubmissionService`，在 State 与 AcceptedCommandLedger working clones 上串联 Command Boundary、source authorization、共享 precondition、accepted history 与 Reservation，全部 PASS 后才一次性替换权威对象。
- Typed control assignments 精确区分 Player controller、UtilityAI 与 Test authority。Service 强制注入 source/stable input/actor existence+active；UseAbility 强制 ability existence/enabled 和 selected target existence/legal，不能由调用方省略。Ability catalog rules 只追加 cooldown/usage/tag/Heat 等规则。
- 每条 AP/Resource/Item/ReactionCharge cost 自动转成共享 precondition，并再次由 CostReservationModel 检查所有 active reservations；cost owner 必须等于 command actor。无成本 EndTurn 等 Command 仍走同一入口但不创建空 Reservation。
- 成功 submission 只接受并 Reserve，不扣余额、不增加 cooldown/usage、不改变 phase、不进入 Resolution、不消费 RNG。任一 malformed boundary、unauthorized/unstable、missing actor/ability、illegal target、precondition 或 reservation conflict 均保持 State、ledger 与 RNG byte-for-byte 不变。
- Retry 同时复用 accepted command 与 commandId reservation；sequence/revision 不重复推进。若 accepted history 与 Reservation existence 不一致，视为不可能由原子 service 产生的状态并 fail closed。共享 precondition 新增 ReactionChargesAtLeast，默认仅 Submission 检查。新增 `DEC-173`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：56/56 PASS，其中新增 7 项覆盖 valid reserve、authority/stable/actor/ability/target structured failure、自动成本规则、reservation conflict rollback、accepted+reservation retry、UtilityAI control、zero-cost command、malformed boundary 与 wrong cost owner；严格验证 fail 不留 Reservation、不推进 RNG。
- `cargo clippy -p ember-combat-core --all-targets -- -D warnings`、Rustfmt、Prettier 与 `git diff --check` PASS。
- 完整 `pnpm check` PASS：Vitest 191 files / 1118 tests，另 2 files / 6 tests 基线 skip；Node 33/33；Rust workspace 212 PASS、1 个 credential-only ignore；archive interop 双向通过。
- Scope/DoD 与用户 `.gitignore` 隔离在 closure commit 前复核；无 SPEC BLOCKER。M2-T02 结束状态为 PASS；下一项严格为 M2-T03 ResolutionContext Lifecycle。

## 2026-09-02 — M2-T03 完成 ResolutionContext Lifecycle

### 可恢复的单一执行上下文

- 从 M2-T02 提交 `78e7882` 创建 `task/M2-T03-resolution-context-lifecycle`。`CombatState` 新增唯一 optional active ResolutionContext；保存 accepted command/sequence、status、current/completed hooks、original/effective targets、redirect history、reservation、eventChain、全 channel RNG checkpoint、resolved rolls 与 Ask suspension history。
- contextId 固定等于 commandId；Create 校验 version/actor/reservation 且相同重试幂等。已有不同 active context 时 fail closed，不并行创建第二个 Command 执行游标。
- Redirect 追加 stable sequence/from/to/rule history，restore 可从 original targets 重放并必须精确得到 effective targets。Hook transition 使用固定 typed 顺序，完成 PreAction 并到 BeforeRoll 后才可进入 ReadyForExecutionRevalidation，重复/跳跃 transition 被拒绝。
- Resolved roll 只接受 State 已消费后的 Resolution cursor，保存 rollId/channel/sides/value/cursorAfter；相同 record 重试不推进 state revision/RNG，冲突记录拒绝。该 API 不抽取 RNG。
- Ask suspend 保存当前 hook 与完全相同的 RNG snapshot；经 canonical State hash save/restore 后，resume 标记同一 suspension 并继续同一 context。RNG cursor 漂移、window mismatch、重复 suspension sequence、reservation mismatch 均 fail closed；AP/Reservation、roll 与 completed hook 不重复。新增 `DEC-174`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：62/62 PASS，其中新增 6 项覆盖 create/idempotency/active conflict、redirect replay+restore、resolved roll cursor/idempotency/conflict、Ask suspend-crash-restore-resume、hook monotonicity/ready gate，以及 reservation/RNG/tampered context rejection。
- `cargo clippy -p ember-combat-core --all-targets -- -D warnings`、Rustfmt、Prettier 与 `git diff --check` PASS。
- 完整 `pnpm check` PASS：Vitest 191 files / 1118 tests，另 2 files / 6 tests 基线 skip；Node 33/33；Rust workspace 218 PASS、1 个 credential-only ignore；archive interop 双向通过。
- Scope/DoD 与用户 `.gitignore` 隔离在 closure commit 前复核；无 SPEC BLOCKER。M2-T03 结束状态为 PASS；下一项严格为 M2-T04 Execution Revalidation + Atomic Usage Commit。

## 2026-09-02 — M2-T04 完成 Execution Revalidation + Atomic Usage Commit

### 同一规则系统与唯一 pre-resolution commit

- 从 M2-T03 提交 `652c15e` 创建 `task/M2-T04-execution-revalidation-usage`。新增 pure Core `ExecutionRevalidationService`，只接受 `ReadyForExecutionRevalidation` context；Submission 与 Execution 现同时复用 `mandatory_command_rules` 和唯一 `PreconditionRuleSystem`，Execution 只筛选 metadata 标记的动态规则。
- 强制复查 actor 可行动、ability existence/enabled、redirect 后 effective target existence/legality，以及 Reservation 仍属于同 command 且为 Reserved；Ability catalog 的 cooldown、owner-turn/per-battle usage、BasicAttack/MAP、once counter、Tag/Heat 等规则通过同一 ordered specs 追加。
- PASS 后在 working clone 内一次性将 context 置为 `ResolutionStarted`、Reservation 转为 Committed、设置 cooldown，并增加实际声明的 owner-turn/per-battle/BasicAttack 与 OwnerTurn/Round/Battle once counters；任一 cost、counter、overflow 或 invariant 错误都不改变原 State。
- Fail 作为 Pre-Resolution Cancel 清除 active context并默认 Release Reservation；只有明确 `consumeCostOnInterrupt=true` 的 line 保留为 Interrupted cost。两条路径都保持完整 RNG snapshot 不变；Cancel 不增加任何 usage。`ResolutionStarted` restore 强制关联 Reservation 已 Committed，避免 crash/resume 重复提交。
- Miss、Save Success、Resolution 后 Immunity 用例验证不调用退款路径，已提交成本、cooldown 与 counters 保持不变。新增 `DEC-175` 固定该原子边界与后续 owner。

### 验证与结束状态

- `cargo test -p ember-combat-core`：68/68 PASS，其中新增 6 项覆盖完整原子提交、动态 actor cancel、interrupt cost、redirect target、usage 错误 rollback，以及 Miss/Save/Immunity 不退款；strict Core Clippy、Rustfmt 与 `git diff --check` PASS。
- 完整 `pnpm check` PASS：Vitest 191 files / 1118 tests，另 2 files / 6 tests 基线 skip；Node 33/33；Rust workspace 224 PASS、1 个 credential-only ignore；archive interop 双向通过。
- Scope/DoD、参考任务文件 SHA-256 与用户 `.gitignore` 隔离在 closure commit 前复核；无 SPEC BLOCKER。M2-T04 结束状态为 PASS；下一项严格为 M2-T05 Canonical EventChain Scheduler。

## 2026-09-02 — M2-T05 完成 Canonical EventChain Scheduler

### 单一稳定 priority queue

- 从 M2-T04 提交 `8af4072` 创建 `task/M2-T05-canonical-eventchain-scheduler`。新增 pure Core `CanonicalEventChainScheduler`；Trigger、Reaction、EncounterRule、System 共享一个 `SchedulerItem` queue，不存在递归 Trigger 路径或独立 Reaction stack。
- Queue 严格按 phase ASC、explicit priority DESC、冻结的 source initiative ASC、source stable ID ASC、effect stable ID ASC、sequence ASC 排序。初始 candidates 先稳定建序再分配 chain-local sequence，因此调用方输入/模块注册顺序反转仍得到完全相同的 items 与 dequeue order。
- Combatant source 入队时读取 committed timeline index；刚离开 timeline 时使用 `lastCommittedTimelineOrder`，非 Combatant 使用冻结常量 `2_147_483_647`。测试在入队后反转 timeline/修改 fallback，已入队顺序保持不变。
- `dequeueNext` 只允许一个 current item；child 必须在完成该 item 时以 parent depth+1、新 sequence 回到同一 queue。相同前五键时旧 sibling 先执行，更早 phase 的 child 可按 tuple 抢先；当前 item 未完成时重复 dequeue/root injection 被拒绝。
- Scheduler checkpoint 纳入统一 State invariant：chain/ID、depth、initiative bound、canonical queue order、queued count state、sequence uniqueness/range 均 fail closed；所有 mutation 使用 working clone 并推进 revision，排序/入队/出队/完成不消费 RNG。新增 `DEC-176`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：74/74 PASS，其中新增 6 项覆盖六键排序与输入逆序、same-key sibling/child、higher-priority child、Trigger/Reaction 共队、initiative freeze/fallback、递归入口拒绝、RNG 零消费及 tampered restore。
- `cargo clippy -p ember-combat-core --all-targets -- -D warnings`、Rustfmt、Prettier 与 `git diff --check` PASS。完整 `pnpm check` PASS：Vitest 191 files / 1118 tests，另 2 files / 6 tests 基线 skip；Node 33/33；Rust workspace 230 PASS、1 个 credential-only ignore；archive interop 双向通过。
- Scope/DoD、素材 SHA256SUMS 与用户 `.gitignore` diff SHA-256 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 在 closure commit 前复核；无 SPEC BLOCKER。M2-T05 结束状态为 PASS；下一项严格为 M2-T06 Loop Guard Counter Contract。

## 2026-09-02 — M2-T06 完成 Loop Guard Counter Contract

### Final Errata exact counter 与失败 checkpoint

- 从 M2-T05 提交 `c2ab5fa` 创建 `task/M2-T06-loop-guard-contract`。Scheduler 新增 dequeue 后、execution 前的唯一 gate：eligibility skip 清除 current item 但不计数；合法 item 只有在 depth/count 两个 bound 通过后才先增加 `executedEventCount` 并标记 counted。
- Root 固定 depth=1，child 继续通过 parent 完成入口使用 checked depth+1；测试证明 `MaxTriggerDepth=N` 时 depth N 合法、N+1 首次 overflow，`MaxEventCount=N` 时前 N 个合法 execution 可执行、第 N+1 个 overflow。Sibling 与 candidate/queued item 均不增加 counter。
- Counted current item 进入 checkpoint 后 save/restore，再次 gate 返回 resume 且 State byte-for-byte 不变，不重复 count/revision、不改变 depth；未通过 eligibility 的 Reaction skip 不计数。完整 queue/current/depth/count/nextSequence/EventChainID/max limits 继续由 canonical State serde/hash 保存。
- Overflow 保存 exact item 与 `MAX_TRIGGER_DEPTH`/`MAX_EVENT_COUNT` reason，进入不可继续的 `ENGINE_FAILURE`，固定 `ABORTED + RESTORE_PRECOMBAT_SNAPSHOT`，同步 confirmed result；不标记/执行 overflow item、不增加 count、不消费 RNG。实际 PreCombatSnapshot 创建/恢复保持由 M2-T10 owner 实现。新增 `DEC-177`。
- Invariant restore 交叉拒绝 active/failure mismatch、count 超限、无 count 的 counted current、错误 overflow reason/result/policy、改变后不再触顶的 limit、重复 sequence 或继续调度 failure chain。

### 验证与结束状态

- `cargo test -p ember-combat-core`：78/78 PASS；M2-T06 新增 4 项 exact-value 测试，连同 M2-T05 6 项共覆盖 depth N/N+1、count N/N+1、legality skip、Ask/crash resume、terminal failure/tamper、sibling/child 与 RNG 零消费。strict Core Clippy、Rustfmt 与 `git diff --check` PASS。
- 首次全量门禁遇到 macOS 系统进程抢占，Vitest forks worker 启动超时并留下 3 timeout/2 worker errors；五个涉及文件随后独立重跑 30/30 PASS。未把该次红灯作为验收，重新执行原始完整 `pnpm check` 后 PASS：Vitest 191 files / 1118 tests，另 2 files / 6 tests 基线 skip；Node 33/33；Rust workspace 234 PASS、1 个 credential-only ignore；archive interop 双向通过。
- Scope/DoD、参考 SOT/素材与用户 `.gitignore` diff SHA-256 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 在 closure commit 前复核；无 SPEC BLOCKER。M2-T06 结束状态为 PASS；下一项严格为 M2-T07 Turn / Round Phase State Machine。

## 2026-09-02 — M2-T07 完成 Turn / Round Phase State Machine

### 固定 Normal Turn lifecycle 与冻结 roster

- 从 M2-T06 提交 `44b15af` 创建 `task/M2-T07-turn-round-state-machine`。新增 pure Core `TurnRoundStateMachine`，以显式原子 transition 固定 BattleStart → RoundStart → OwnerTurnStart → Action/disabled → OwnerTurnEnd → RoundEnd → next RoundStart，不依赖模块注册或 map/DB 返回顺序。
- RoundStart 从 committed Timeline 顺序构建连续 slot 的 Active/normal-only RoundRoster；Stun 等仍是 Active，保留完整 normal lifecycle。尚未开始便 Downed/Defeated 的 slot deterministic Skipped，Removed 为 Removed；全部 settled 后才进入 RoundEnd。
- Roster 成员集在 RoundStart 冻结。中途加入的 Active combatant 即使已进入 Timeline，也只在下一 RoundStart 获得 slot；Timeline 修改入口只重排未来 Pending entries，不能添加成员、重开已完成 slot或移动当前 actor。
- OwnerTurnStart 接收 Status/Restriction owner 的 typed `actionAllowed`，不解析 status 名称。Action disabled 或 TurnStart 后 actor Downed 时仍进入 OwnerTurnEnd 并以 Completed 结束已开始 slot；Action 中 PreAction 导致 actor Downed 的 committed state 仍合法，可由 execution revalidation cancel 后正常结束 lifecycle。
- Extra Turn 使用独立 `EXTRA_TURN` phase 与 continuation，不进入 RoundRoster；测试证明 begin/end 不改变 round、roster、cooldown、ability usage、BasicAttack、OncePerOwnerTurn 或 ReactionCharges。新增 `DEC-178`，统一 invariant 覆盖 phase/active/round/count/roster/extra continuation。

### 验证与结束状态

- `cargo test -p ember-combat-core`：84/84 PASS，其中新增 6 项覆盖 roster snapshot/filter/order、完整 lifecycle、controlled/downed Action skip、Defeated/Removed RoundEnd、pending reorder、中途加入 next-round-only、Extra Turn clock isolation、illegal transition 与 tampered restore。
- `cargo clippy -p ember-combat-core --all-targets -- -D warnings`、Rustfmt、Prettier 与 `git diff --check` PASS。完整 `pnpm check` PASS：Vitest 191 files / 1118 tests，另 2 files / 6 tests 基线 skip；Node 33/33；Rust workspace 240 PASS、1 个 credential-only ignore；archive interop 双向通过。
- Scope/DoD、SOT 与用户 `.gitignore` diff SHA-256 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 在 closure commit 前复核；无 SPEC BLOCKER。M2-T07 结束状态为 PASS；下一项严格为 M2-T08 CombatObjective Runtime / Protect Removed。

## 2026-09-02 — M2-T08 完成 CombatObjective Runtime / Protect Removed

### 冻结定义与 committed-only 单调结算

- 从 M2-T07 提交 `445981a` 创建 `task/M2-T08-combat-objective-runtime`。新增 pure Core `CombatObjectiveRuntime`，一次性校验并排序六类 objective、required IDs 与 tracked combatant IDs；required Eliminate 必须有冻结目标，DefeatTarget/Protect 必须有单一 target，Survive 必须为正整数轮数。
- Eliminate/DefeatTarget 默认只认 Defeated，定义显式开启时才把 Removed 视为击败；Downed 不完成。预声明 reinforcement 从初始 runtime snapshot 参与冻结集合，`isDeployed=false` 或 Timeline 缺席不等于不存在。
- Survive 只读取 Turn/Round State Machine 已提交的 `completedRoundCount`，第 N 次 RoundEnd 推进完成后才结算。Escape/Scripted 只接受版本化 committed signal；重复相同 signal 幂等，冲突 signal fail closed。
- Protect 仅在显式 flag 下因 Downed 失败，Defeated 必然失败；committed Removed 写入持久化 `ProtectRemoved` failure record 且不可逆。Working clone 的未提交 removal、Timeline absence 与未部署状态不会触发失败；后续试图把该目标恢复为非 Removed 会被统一 invariant 拒绝。
- Evaluation 只允许 BattleStart/RoundStart/OwnerTurnStart/Action quiescent/OwnerTurnEnd/RoundEnd 对应稳定点，Scheduler 有 queued/current item 时拒绝。required fail 产生 Defeat candidate；全部 required complete 且无 required fail 产生 Victory；optional fail 不阻止，Escape/Scripted 产生 typed candidate。候选只生成不确认，最终 arbitration 保留给 M2-T09。新增 `DEC-179`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：92/92 PASS，其中新增 8 项覆盖定义排序/形状、reinforcement 冻结 Eliminate、Downed/Removed policy、Survive exact RoundEnd、Protect committed Removed/不可逆、optional/required 与 signals、quiescent/replay determinism、无候选时 sequence 上限 no-op。
- `cargo clippy -p ember-combat-core --all-targets -- -D warnings`、Rustfmt、Prettier 与 `git diff --check` PASS。完整 `pnpm check` PASS：Vitest 191 files / 1118 tests，另 2 files / 6 tests 基线 skip；Node 33/33；Rust workspace 248 PASS、1 个 credential-only ignore；archive interop 双向通过。
- Scope/DoD、SOT 与用户 `.gitignore` diff SHA-256 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 在 closure commit 前复核；无 SPEC BLOCKER。M2-T08 结束状态为 PASS；下一项严格为 M2-T09 Terminal Outcome Arbitration。

## 2026-09-02 — M2-T09 完成 Terminal Outcome Arbitration

### 稳定点唯一 winner 与 policy 持久化

- 从 M2-T08 提交 `3674674` 创建 `task/M2-T09-terminal-outcome-arbitration`。新增 pure Core `TerminalOutcomeArbitrator`，只有 Scheduler queue/current 清空、无 active ResolutionContext、无 PendingReaction 的 committed quiescent state 才能确认；链中途拒绝且 State/RNG 不变，无 candidate 时 byte-for-byte no-op。
- 默认 typed policy 固定 `ScriptedOutcome → ExplicitObjectivePriority → Defeat → Victory → Escape`；完整五 tier 的开发者 Encounter override 与 stable policy ID 进入 CombatState/hash，Replay 不依赖外部默认。explicit priority 只允许可信 `OBJECTIVE` candidate 使用，同 tier 以 priority DESC、candidate stable ID ASC 唯一决胜。
- Candidate validator 拒绝空/非法 stable IDs、0/乱序 sequence、duplicate ID、非 Objective 伪造 explicit priority 与 gameplay Aborted candidate。确认原子写入 winner candidate ID、typed result 与 revision，并经统一 State invariant 后提交，不消费 RNG。
- 重复确认返回同一 winner 且不重复推进 revision。恢复时重新按已存 policy 验证 confirmed candidate 必须仍是 winner，并要求普通 result 保持 quiescent；Loop Guard `Aborted` 仅在真实 Engine Failure checkpoint 下合法，不参加普通 policy 竞争。新增 `DEC-180`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：98/98 PASS，其中新增 6 项覆盖 simultaneous Victory/Defeat/Escape、Scripted/explicit priority、developer override replay、stable ID tie、active chain/no-candidate、exactly-once 与 tampered state。
- `cargo clippy -p ember-combat-core --all-targets -- -D warnings`、Rustfmt、Prettier 与 `git diff --check` PASS。完整 `pnpm check` PASS：Vitest 191 files / 1118 tests，另 2 files / 6 tests 基线 skip；Node 33/33；Rust workspace 254 PASS、1 个 credential-only ignore；archive interop 双向通过。
- Scope/DoD、SOT 与用户 `.gitignore` diff SHA-256 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 在 closure commit 前复核；无 SPEC BLOCKER。M2-T09 结束状态为 PASS；下一项严格为 M2-T10 Runtime Commit / Rollback Contract。

## 2026-09-02 — M2-T10 完成 Runtime Commit / Rollback Contract 与 M2 Gate

### 可由 Existing Domain Transaction 直接消费的 deterministic plan

- 从 M2-T09 提交 `5ac7038` 创建 `task/M2-T10-runtime-commit-rollback`。新增 pure Core `RuntimeCommitContract`：捕获包含实际恢复值、完整 Combat versions 与 SHA-256 的 typed `PreCombatSnapshot`；不依赖时间、系统随机或数据库自然顺序。
- Finalization 校验 confirmed State、snapshot combat identity/version、Provisional Delta revision、每个 typed key 的 snapshot before 与连续 before→after chain，并交叉检查 HP/Shield/Resource/Item/Status 的 runtime final projection。typed enum tuple key 消除允许冒号的 stable IDs 在字符串拼接下产生碰撞的可能。
- 连续 runtime facts 折叠为 snapshot-before→final-after，净 no-op 删除并固定排序，生成 canonical domain delta/hash。Victory/Escape 提交 runtime delta；Defeat/Aborted 丢弃 delta并携带完整 rollback snapshot；Aborted final sequence 来自真实 Loop Guard overflow item。
- ScriptedVictory/Defeat 强制显式声明 `COMMIT_RUNTIME_DELTA / RESTORE_PRECOMBAT_SNAPSHOT / RESTORE_SNAPSHOT_THEN_APPLY_SCRIPTED_DELTA`；第三种只输出经 snapshot 校验的独立 scripted delta。非 scripted result 传入 override 被拒绝。
- `resultCommitId` 稳定派生自 combatInstanceId、finalResultSequence、result type、canonicalDeltaHash。输出 plan 同时携带 runtime/snapshot/delta hashes、policy、rollback snapshot 与共享 correlation ID 的 `combat.finished` fact；只定义 contract，不新建 durable persistence/Event Ledger。新增 `DEC-181`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：104/104 PASS，其中新增 6 项覆盖 Victory canonical fold/idempotent identity、Defeat rollback、Loop Guard Aborted、Scripted 三 policy、snapshot/delta/runtime drift，以及非 scripted override/identity mismatch。
- M2-T01..T10 的 Core suites 共同覆盖相同 version/seed/state/accepted inputs 下 command identity、reservation/context、event order、RNG cursor、objective/result、provisional state hash 与 finalization plan 的 deterministic closure；M2 Gate PASS。
- `cargo clippy -p ember-combat-core --all-targets -- -D warnings`、Rustfmt、Prettier 与 `git diff --check` PASS。完整 `pnpm check` PASS：Vitest 191 files / 1118 tests，另 2 files / 6 tests 基线 skip；Node 33/33；Rust workspace 260 PASS、1 个 credential-only ignore；archive interop 双向通过。
- Scope/DoD、SOT 与用户 `.gitignore` diff SHA-256 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 在 closure commit 前复核；无 SPEC BLOCKER。M2-T10 与 M2 Gate 结束状态为 PASS；下一项严格为 M3-T01 Fixed-Point Combat Numeric。

## 2026-09-02 — M3-T01 完成 Fixed-Point Combat Numeric

### 百万分之一整数与唯一取整入口

- 从 M2-T10 提交 `4f9ef4e` 创建 `task/M3-T01-fixed-point-combat-numeric`。新增 transparent `CombatFixed(i64)` 与 `COMBAT_FIXED_SCALE=1_000_000`；只接受 scaled integer，不提供 float 构造或写回 State 路径。
- 新增 checked `CombatNumeric`：integer×fixed floor、fixed×fixed floor、ratio fixed floor、overflow-safe ceilDiv、百分比 Integer State floor、SoloRecovery/Revive minimum-one restore、precise Damage 最终 floor，以及 HARD_CC `base × resistance × DR → single ceil → min 1`。
- 所有乘法/组合使用 checked i128 中间值并在 i64 边界检查；negative state inputs、zero/negative denominator、invalid clamp bounds、conversion/add/sub overflow 均结构化 fail closed。Signed Fixed 保留给 Resistance/Weakness 的精确 add/sub/clamp，但非负写入入口必须重新验证。
- 新增共享 `test-fixtures/combat-numeric-v1.json`，以纯整数 exact vectors 锁定 scale、30%/80%/1.25x、1/3 ratio、ceil、普通百分比可为 0、minimum-one restore、HARD_CC 和 3.7 Damage floor。另用 `2 × 0.55 × 0.9` 锁定 single ceil=1，而错误的中途 ceil=2。新增 `DEC-182`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：108/108 PASS，其中新增 4 项覆盖共享 exact fixture、HARD_CC 单次 ceil 反例、负数/除零/bounds/overflow，以及 signed scalar 与 nonnegative state write 分离。
- `cargo clippy -p ember-combat-core --all-targets -- -D warnings`、Rustfmt、Prettier 与 `git diff --check` PASS。完整 `pnpm check` PASS：Vitest 191 files / 1118 tests，另 2 files / 6 tests 基线 skip；Node 33/33；Rust workspace 264 PASS、1 个 credential-only ignore；archive interop 双向通过。
- Scope/DoD、SOT 与用户 `.gitignore` diff SHA-256 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 在 closure commit 前复核；无 SPEC BLOCKER。M3-T01 结束状态为 PASS；下一项严格为 M3-T02 ResolutionResolver（Closed Tagged Union）。

## 2026-09-03 — M3-T02 完成 ResolutionResolver（Closed Tagged Union）

### 六类封闭语义的唯一解释点

- 从 M3-T01 提交 `2d7afb9` 创建 `task/M3-T02-resolution-resolver`。新增 closed `ResolutionType / ResolutionRequest / ResolutionResult` tagged unions 与唯一 pure Core `ResolutionResolver`；AttackRoll、SavingThrow、OpposedCheck、AutoHit、ConditionalCheck、AttemptEscape 全部由 exhaustive match 解释，无 registry/plugin fallback。
- AttackRoll 使用 raw d20：Natural 20 忽略低 total 自动命中并暴击，Natural 1 忽略高 total/ForceCritical 自动 miss；19 等扩展 critical range 必须先按 `total >= defense` 命中。SavingThrow/Conditional/Escape 与双方 Opposed raw extremes 默认都只加入 total。
- Opposed tie 默认 Defender Wins，typed developer override 才可切换 Attacker Wins；Conditional 明确选择无骰确定比较或 d20+modifier，并区分 `AT_LEAST/GREATER_THAN`。AutoHit 不携带 raw roll且默认 non-critical，后续 Resistance/Immunity/Effect validation 仍不被跳过。
- 所有 d20 强制 1..20，critical range minimum 强制 2..20，total checked-add overflow fail closed。Serde `deny_unknown_fields` 与空 struct AutoHit variant 拒绝未知 Resolution、额外 runtime handler 字段。新增 `DEC-183`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：114/114 PASS，其中新增 6 项覆盖 Attack natural/critical range、非 Attack natural extremes、Opposed tie/override、Conditional/AutoHit、malformed/overflow 与 exact closed JSON union。
- `cargo clippy -p ember-combat-core --all-targets -- -D warnings`、Rustfmt、Prettier 与 `git diff --check` PASS。完整 `pnpm check` PASS：Vitest 191 files / 1118 tests，另 2 files / 6 tests 基线 skip；Node 33/33；Rust workspace 270 PASS、1 个 credential-only ignore；archive interop 双向通过。
- 已重新完整读取用户 995 行执行附件并核对当前 branch/working tree；Scope/DoD、V5.2 与用户 `.gitignore` diff SHA-256 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 在 closure commit 前复核；无 SPEC BLOCKER。M3-T02 结束状态为 PASS；下一项严格为 M3-T03 DamageChannelCatalog。

## 2026-09-03 — M3-T03 完成 DamageChannelCatalog

### Stable ID、不可变目录与单一规则所有权

- 从 M3-T02 提交 `814bba6` 创建 `task/M3-T03-damage-channel-catalog`。新增 transparent `DamageChannelId(String)`，只接受确定性小写 stable ID 并在直接构造、FromStr 与 serde decode 时使用同一验证；它保持开放词汇，不新增 giant DamageType enum。
- 新增 `DamageChannelDefinition` 与 immutable `DamageChannelCatalog`。目录从完整 code-owned/versioned definitions 一次性构造，校验后按 Channel ID canonical sort，并只提供 read-only entries/lookup/contains；不存在 incremental register、runtime handler、脚本或 mutable registry。
- Definition 只含 `channelId / semanticTags / presentationKey`；semantic tags 必须为已排序、唯一的 namespaced IDs，presentation key 必须 namespaced。Serde 拒绝 unknown fields、重复 Channel、空目录与非法元数据；不同输入顺序会生成完全相同的 canonical JSON。
- v0.4.1 built-in catalog 收录 V5.2 四个基础 Profile 明确声明的 15 个身份：Physical、Fantasy 四元素/Arcane、Sci-Fi Kinetic/Thermal/Electromagnetic/Plasma/Radiation、Cultivation Qi/Soul、Urban Ballistic/Psychic/Occult。未提前猜测五行扩展名。
- Catalog 类型与 wire shape 均没有 `PrimaryMitigation`。WorldProfile 是否支持 Channel 及其 `primaryMitigationByChannel` 仍唯一归 M5；反序列化时夹带该字段会 fail closed。新增 `DEC-184`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：120/120 PASS，其中新增 6 项覆盖 stable ID round-trip/拒绝、canonical order/lookup、跨输入顺序 exact JSON、duplicate/unknown mitigation 拒绝、metadata 顺序/唯一性，以及 15 个冻结基础 Channel。
- `cargo clippy -p ember-combat-core --all-targets -- -D warnings`、Rustfmt、Prettier 与 `git diff --check` PASS。完整 `pnpm check` PASS：Vitest 191 files / 1118 tests，另 2 files / 6 tests 基线 skip；Node 33/33；Rust workspace 276 PASS、1 个 credential-only ignore；archive interop双向通过。
- Scope/DoD、V5.2 与 M0-T05 ownership contract 已复核；用户 `.gitignore` diff SHA-256 仍为 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 且不纳入任务提交；无 SPEC BLOCKER。M3-T03 结束状态为 PASS；下一项严格为 M3-T04 Mitigation Pipeline。

## 2026-09-03 — M3-T04 完成 Mitigation Pipeline

### 单一 Profile 映射、固定精度与默认 Shield spillover

- 从 M3-T03 提交 `15ae999` 创建 `task/M3-T04-mitigation-pipeline`。新增 pure `MitigationPipeline`，只接受 M3-T02 已解析的 AttackRoll/AutoHit result；miss 在 Profile lookup 前返回零伤害并保持 Shield/HP 不变，其他 ResolutionType 拒绝进入此 Attack damage gate。
- 新增 read-only `DamageDefenseProfile` 边界和 closed `PrimaryMitigation`。命中后必须由注入的当前 Profile 对 Channel 返回唯一 ARMOR/RESISTANCE/NONE；未知/unsupported Channel fail closed。测试 Profile 只包含当前用例映射，没有复制 Fantasy/Sci-Fi/Cultivation/Urban 表；M5 resolved WorldCombatProfile 将实现该接口。
- Armor 严格执行 percent penetration→flat penetration→effective armor→递减 DR→cap，Resistance 严格执行 positive-only penetration→weakness/resistance clamp；每个 Component 只走一支，测试向未选分支填入极端值证明不存在双重减伤。Resistance penetration 最低到 0，不能制造 Weakness，也不扩大已有负抗性。
- Damage 全程使用 M3-T01 `CombatFixed/CombatNumeric`，直到 post-mitigation 后 single floor。默认 Shield 再吸收整数 incoming，输出 shieldDamage/shieldResourceLoss/hpDamage/overkill 与 resulting Shield/HP，并保持总量恒等；不直接写 State 或发布 committed event。
- `DamageImmunity` 是带 rule ID 的显式 tagged union，与 Resistance 分离。零伤害输出 typed Missed/Immune/UnableToPenetrateDefense/Blocked，M8 presentation 将分别映射为简体中文，避免 Core 成为 localization 第二事实源。新增 `DEC-185`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：128/128 PASS，其中新增 8 项覆盖 miss/profile short-circuit、Armor exact math/single floor/spillover、Resistance 单分支、penetration/weakness/caps、显式 immunity、typed 零伤害原因、NONE 默认 Shield 恒等式，以及 unsupported/invalid fail-closed。
- `cargo clippy -p ember-combat-core --all-targets -- -D warnings`、Rustfmt、Prettier 与 `git diff --check` PASS。完整 `pnpm check` PASS：Vitest 191 files / 1118 tests，另 2 files / 6 tests 基线 skip；Node 33/33；Rust workspace 284 PASS、1 个 credential-only ignore；archive interop 双向通过。
- Scope/DoD、V5.2 §4.5 与 M3-T02/T03 dependencies 已复核；用户 `.gitignore` diff SHA-256 仍为 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 且不纳入任务提交；无 SPEC BLOCKER。M3-T04 结束状态为 PASS；下一项严格为 M3-T05 Critical / BasicAttack / MAP。

## 2026-09-03 — M3-T05 完成 Critical / BasicAttack / MAP

### Crit-eligible 骰子计划与 committed counter 决策

- 从 M3-T04 提交 `2e87e0b` 创建 `task/M3-T05-critical-basicattack-map`。新增 `CriticalDamageRules`：只消费 M3-T02 的 typed ResolutionResult，不再解释骰面；只有命中的 AttackRoll critical 会使 Eligible component 的 dice count checked ×2，die sides 与 fixed bonus 永不自动翻倍。
- 每个 Component 显式区分 Instant/DoT timing 与 Eligible/Ineligible。DoT 默认必须 Ineligible，不继承首次攻击 critical；只有带 stable rule ID 的 `AllowDamageOverTime` local typed override 能改变该默认，未新增通用 capability registry 或 runtime handler。
- 新增 `BasicAttackRules`，从已 committed `basicAttackCountThisNormalOwnerTurn` 计算本次 penalty 与 atomic usage commit 所需 increment。v0.4.1 baseline 为 max 3 和 0/-3/-6；config 允许调参但拒绝正向/非单调 penalty、非正 max 与负 counter，第 4 次 BasicAttack fail closed。
- 非 BasicAttack 默认 penalty 0 且不计数；`IgnorePenalty` 仍受 max 且仍计数，`CountAsBasicAttack` 才让其他 Ability 显式共享规则。两个 override 都限定在攻击子系统、携带 rule ID 并拒绝不兼容组合。M2-T07 既有回归继续证明 Extra Turn 不重置该 committed counter。新增 `DEC-186`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：136/136 PASS，其中新增 8 项覆盖 baseline 三档/第 4 次拒绝、tunable monotonic config、非 Basic 默认/显式计入、Ignore 不越 cap、eligible dice/fixed bonus、DoT 默认/typed override、CriticalRange miss/非 Attack，以及 malformed outcome/config/counter/dice fail-closed。
- `cargo clippy -p ember-combat-core --all-targets -- -D warnings`、Rustfmt、Prettier 与 `git diff --check` PASS。完整 `pnpm check` PASS：Vitest 191 files / 1118 tests，另 2 files / 6 tests 基线 skip；Node 33/33；Rust workspace 292 PASS、1 个 credential-only ignore；archive interop 双向通过。
- Scope/DoD、V5.2 §3.2/§4.4 与 M3-T02 dependency 已复核；用户 `.gitignore` diff SHA-256 仍为 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 且不纳入任务提交；无 SPEC BLOCKER。M3-T05 结束状态为 PASS；下一项严格为 M3-T06 Typed Effect Primitive Handler Set。

## 2026-09-03 — M3-T06 完成 Typed Effect Primitive Handler Set

### 19 个 MUST Primitive 与唯一静态 dispatch

- 从 M3-T05 提交 `262443d` 创建 `task/M3-T06-typed-effect-primitives`。新增 19-member `EffectPrimitiveId::ALL`、closed `EffectDefinition` tagged union 和唯一 exhaustive `EffectHandlerSet::resolve`；没有 runtime register、任意代码/表达式执行或 unknown fallback，Spawn 等 future primitive 明确不在集合。
- 每个 variant 使用 typed schema，并解析为 `ResolvedEffect` working operation。Flat/percent 使用 M3-T01 fixed math；Gain/Lose 统一正负方向；resource maximum 来自 read-only context；集合要求 stable、排序、唯一 IDs；百分比 ModifyStat 必须明确 referenceStatId。
- Revive 至少提供 flat/percent 之一并保证最终 >0；percent 使用 minimum-one，二者同时存在按规范相加，附带 tag/status IDs 保持 canonical。真正 Downed legality/Active transition 属 M3-T10；DealDamage bundle/atomicity 属 M3-T07；Status merge 属 M4，未提前侵占。
- Handler 只拥有 schema、validation 与 deterministic resolution；不含 Balance/Tooltip/AI exposure/theme/SQL/Event Ledger。新增 `DEC-187`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：142/142 PASS，其中新增 6 项覆盖 exact 19 set、amount/sign resolution、Revive exact math、unknown primitive/runtime code rejection、ID/resource/reference fail-closed，以及每个 variant 均经过同一 dispatch。
- strict Clippy、Rustfmt、Prettier、`git diff --check` 与完整 `pnpm check` PASS：Vitest 191 files / 1118 tests（另 2 files / 6 tests 基线 skip），Node 33/33，Rust workspace 298 PASS、1 credential-only ignore，archive interop 双向通过。
- 用户 `.gitignore` diff SHA-256 仍为 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 且不纳入提交；无 SPEC BLOCKER。M3-T06 PASS；下一项严格为 M3-T07 DamageBundle + WorkingState Atomicity。

## 2026-09-03 — M3-T07 完成 DamageBundle + WorkingState Atomicity

### Stable component order 与单一 atomic visibility boundary

- 从 M3-T06 提交 `8982bf7` 创建 `task/M3-T07-damage-bundle-atomicity`。新增 `DamageBundleProcessor`，只消费 typed QueueDamage operation；完整校验后按唯一 `componentIndex ASC` 排序，不依赖输入/vector 外的偶然顺序。
- 全部 component 在同一不可观察 CombatState clone 内复用 M3-T04 pipeline；后一段读取前一段 resulting Shield/HP。普通 Bundle 不暴露 component 间 callback，PostDamage/PostEffect 无法插入中途。
- 所有 component 完成后仅在最终 HP=0 时调用一次 injected lethal owner；之后记录最终 Shield/HP provisional delta、推进 state revision、运行全局 invariant，再一次替换正式 State。失败路径丢弃 clone，原 State byte-equivalent 且无 committed facts。
- Commit result 按 componentIndex 返回 DamageResolved facts，随后唯一 DamageApplied aggregate；ShieldBroken/TargetDefeated 的具体 committed 派生分别留给 M3-T08/M3-T09。新增 `DEC-188`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：146/146 PASS，其中新增 4 项覆盖乱序排序与 Working Shield/HP 继承、全 Bundle 后 lethal exactly-once、lethal/invariant rollback byte equality、duplicate/non-damage/bad-tag rejection。
- strict Clippy、Rustfmt、Prettier、`git diff --check` 与完整 `pnpm check` PASS：Vitest 191 files / 1118 tests（另 2 files / 6 tests baseline skip），Node 33/33，Rust workspace 302 PASS、1 credential-only ignore，archive interop 双向通过。
- 995 行用户执行附件已重新完整读取；Scope/DoD 与 V5.2 §4.5.8 已复核。用户 `.gitignore` diff SHA-256 仍为 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 且不纳入提交；无 SPEC BLOCKER。M3-T07 PASS；下一项严格为 M3-T08 Shield / Barrier / Recharge。

## 2026-09-03 — M3-T08 完成 Shield / Barrier / Recharge

### 统一 ShieldResolution 与 committed-only recharge evidence

- 从 M3-T07 提交 `2cd2215` 创建 `task/M3-T08-shield-barrier-recharge`。新增 pure `ShieldResolution` 与 closed `ShieldInteraction`；标准吸收、正 fixed damage multiplier、Bypass 与 Disabled 全部经同一计算入口，Ability 无法直接改 HP/Shield。
- multiplier 严格使用 SOT 的 floor max absorb、ceil Shield resource loss；剩余 Shield 不足完整吸收 1 点时仍耗尽而不减少 incoming。Mitigation Pipeline 继续保留 raw/postMitigation/rounded/shieldDamage/shieldResourceLoss/hpDamage/overkill/resulting resources。
- DamageBundle 每 component 携带 typed interaction，继续继承同一 Working State。Commit 后先发布 ordered DamageResolved、再 DamageApplied；只有整个 transition 的 Shield 从正值变 0 时才追加一个 ShieldBroken，多 component 不会中途或重复发布。
- Recharge 判定只暴露在 `CommittedDamageEvent::DamageResolved` 上。DEFAULT 需要 hostile source 且 Shield 或 HP 实际受损；Miss/Immune/0 damage 不打断，Shield hit 与 Bypass HP hit 打断。ALWAYS/NEVER、source relation 与 decision reason 均为可序列化结构化事实，供后续 log/debug/profile mapping 使用。新增 `DEC-189`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：153/153 PASS，其中新增 7 项覆盖标准/EMP 倍率、fractional insufficient Shield、Bypass/Disabled、非法输入、ShieldBroken exactly-once/order、Shield hit/Bypass recharge，以及 Miss/Immune/0/source/policy matrix。
- strict Clippy、Rustfmt、Prettier、`git diff --check` 与完整 `pnpm check` PASS：Vitest 191 files / 1118 tests（另 2 files / 6 tests baseline skip），Node 33/33，Rust workspace 309 PASS、1 credential-only ignore，archive interop 双向通过。
- 995 行执行附件、Scope/DoD 与 V5.2 Shield equations/recharge rule 已复核；用户 `.gitignore` diff SHA-256 仍为 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 且不纳入提交；无 SPEC BLOCKER。M3-T08 PASS；下一项严格为 M3-T09 LethalResolution Core。

## 2026-09-03 — M3-T09 完成 LethalResolution Core

### Pending outcome、统一 health transition 与 committed defeat fact

- 从 M3-T08 提交 `cb698ff` 创建 `task/M3-T09-lethal-resolution-core`。新增唯一 `LethalResolutionCore` 与 `LethalOutcomeResolver`；Pending Recovered/Downed/Defeated/PhaseTransition/Scripted 结果不做 serde、不是 Event，且必须与 resolver 完成后的 HP/State shape 一致。
- 新增 `AtomicHealthTransitionProcessor`，让已解析的 Status Tick/反伤/其他直接 HP mutation 与 MaxHP 变更遵循同一 clone→mutation→lethal→delta→sequence/revision→Invariant→replace 流程。MaxHP 降低先 clamp current，任何失败都保持原 State byte-equivalent。
- DamageBundle 移除专属 lethal trait，改为复用统一 Core，仍在所有 component 后 exactly once。CombatantState 与 MaxHitPoints 纳入 provisional/canonical delta、snapshot continuity、fold 与 runtime projection，保证最终 commit/rollback 不漏掉 Downed/Defeated 或 maximum 变化。
- committed TargetDefeated 只在 before 非 Defeated、有效 Pending outcome 最终落到 Defeated 且 atomic commit 成功后返回，携带最低稳定 causal attribution。顺序为 DamageResolved→DamageApplied→ShieldBroken→TargetDefeated；重复作用于已 Defeated target 不产生 kill credit。新增 `DEC-190`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：159/159 PASS，其中新增 6 项覆盖 Status Tick/反伤同一闭环、MaxHP clamp lethal、Recovered/Downed 非 defeat event、invalid pending/mutation rollback、canonical MaxHP/CombatantState delta，以及 ShieldBroken/TargetDefeated order 与 second-kill suppression。
- strict Clippy、Rustfmt、Prettier、`git diff --check` 与完整 `pnpm check` PASS：Vitest 191 files / 1118 tests（另 2 files / 6 tests baseline skip），Node 33/33，Rust workspace 315 PASS、1 credential-only ignore，archive interop 双向通过。
- Scope/DoD、V5.2 §4.5.8.1/§8.3/§11.3 与 DependsOn 已复核；用户 `.gitignore` diff SHA-256 保持 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 且不纳入提交；无 SPEC BLOCKER。M3-T09 PASS；下一项严格为 M3-T10 Downed / Revive / Solo Recovery。

## 2026-09-03 — M3-T10 完成 Downed / Revive / Solo Recovery

### CombatStart 模式锁定、标准 lethal policy 与独立 Revive

- 从 M3-T09 提交 `1957d4a` 创建 `task/M3-T10-downed-revive-solo-recovery`。CombatState 新增 ordered `formalPartyMemberIds`；CombatStart initializer 校验 deployed Active Player/Companion 后一次锁定，SOLO/PARTY 只由该 snapshot 派生，未列入的 Drone/Summon 不改变模式。
- `StandardLethalPolicy` 实现统一 resolver：SOLO 首次致命按注入比例 minimum-one 恢复、只消耗每战一次 availability；第二次致命 Defeated 并同事务创建 Defeat candidate。默认 30% 但测试注入 40% 得到不同恢复值，且 AP/resource 不变。
- PARTY formal member 致命进入 Downed；另一 formal Active member或权威调用方已确认的 ExecutableRecoveryPath 可继续，否则同一 Working State 创建 Defeat candidate。没有 Death Save/Stability；非 formal 普通 combatant 默认 Defeated。
- `RecoveryEffectProcessor` 只消费 typed Heal/Revive。Heal 对 Downed fail closed；Revive 仅接受 Downed+0HP，先恢复正 HP并转 Active，再执行 injected removeTags/applyStatus follow-up，最后 Invariant/atomic commit；对 Active Revive、0 MaxHP、follow-up failure 均不写正式 State。Solo availability 进入 provisional/canonical delta。新增 `DEC-191`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：167/167 PASS，其中新增 8 项覆盖 formal member mode lock/summon exclusion、tunable once recovery、second lethal candidate/fact、PARTY active/recovery-path/no-path、Heal/Revive target split、Revive event/order、follow-up rollback/success，以及 formal-party invariant。
- strict Clippy、Rustfmt、Prettier、`git diff --check` 与完整 `pnpm check` PASS：Vitest 191 files / 1118 tests（另 2 files / 6 tests baseline skip），Node 33/33，Rust workspace 323 PASS、1 credential-only ignore，archive interop 双向通过。
- Scope/DoD、V5.2 §6.2/§11.3 与 DependsOn 已复核；用户 `.gitignore` diff SHA-256 保持 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 且不纳入提交；无 SPEC BLOCKER。M3-T10 PASS；下一项严格为 M3-T11 EncounterEffect / Reinforcement Adapter。

## 2026-09-03 — M3-T11 完成 EncounterEffect / Reinforcement Adapter

### 统一内部规则入口与预声明援军激活

- 从 M3-T10 提交 `3de01be` 创建 `task/M3-T11-encounter-effect-reinforcement`。新增 `EncounterRuleExecutor`，只接受现有 command boundary 验证的 InternalDeterministic/InternalRuleAction；rule ID、stable-sorted targets 与版本均 fail closed，且内部 action 不进入玩家 AcceptedCommand history。
- Encounter damage 通过 `ResolutionResolver` 与同一 `EffectHandlerSet` 解析，随后复用 DamageBundle→WorkingState→Lethal→Invariant→atomic commit。Heal/Revive 复用 Recovery processor。局部数值覆盖收敛在 typed `EncounterDamageRule`/services，不建立第二套 handler、Generic Capability Engine 或直接 State writer。
- Reinforcement activation 只消费 CombatState 中预声明 stable ID、definition snapshot、objective membership 与 stored initiative；unknown、重复部署或 live-state collision 不写状态。多目标按 command 的 Stable ID ASC 逐个 atomic commit并生成 ordered `ReinforcementActivated` facts，不访问 RNG。
- 新单位按 `InitiativeResult DESC → InitiativeBaseStat DESC → StableCombatantID ASC` 进入 normal timeline，但当前 RoundRoster 保持原样；下一 RoundStart 才进入 roster。save/hash round-trip 保留部署位和预掷 initiative。全局 invariant 新增 registry identity、ordered uniqueness、undeployed absence 与 deployed live/timeline 唯一性校验；Effect registry 仍无 Spawn/Summon。新增 `DEC-192`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：174/174 PASS，其中新增 7 项覆盖统一 damage/lethal、统一 recovery、外部/Ability source 拒绝、预掷 initiative 与 RNG 不变、next-round roster、save restore、unknown/repeat atomic failure、registry invariant 及无 Spawn/Summon。
- strict Clippy、Rustfmt、Prettier、`git diff --check` 与完整 `pnpm check` PASS：Vitest 191 files / 1118 tests（另 2 files / 6 tests baseline skip），Node 33/33，Rust workspace 330 PASS、1 credential-only ignore，archive interop双向通过。
- Scope/DoD、V5.2 §6.3/§6.3.1 与 DependsOn 已复核；用户 `.gitignore` diff SHA-256 保持 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 且不纳入提交；无 SPEC BLOCKER。M3-T11 与 M3 Gate/Gate B PASS；下一项严格为 M4-T01 GameplayTagCatalog。

## 2026-09-04 — M4-T01 完成 GameplayTagCatalog

### Stable TagId、namespace 与静态只读 Catalog

- 从 M3-T11 提交 `e4ed77d` 创建 `task/M4-T01-gameplay-tag-catalog`。新增 `GameplayTagId`/`GameplayTagNamespace` 开放字符串值对象，强制有界点分 Stable ID、合法 segment 与 namespace 首段精确一致；没有扩张型 Tag enum。
- `GameplayTagCatalog::from_static` 只接受 code-owned static definitions，完整校验后按 TagId ASC canonicalize，并建立不可变 BTreeMap lookup index；无 incremental registration、runtime handler、plugin/DSL 或执行 API。serde restore 重新校验并排序，输入数组顺序不会改变输出字节。
- 内建 v0.4.1 catalog 精确覆盖 V5.2 §7 列出的 15 个 Ability/Element/Damage/Status/Character 标签示例。Definition wire shape 只有 tagId/namespace，unknown handler/logic 字段 fail closed；AI exposure 不进入 Catalog。消费者可统一校验 known、sorted、unique tag sets。新增 `DEC-193`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：180/180 PASS，其中新增 6 项覆盖 Stable ID/namespace、输入顺序无关 canonical serde、冻结 catalog、malformed/mismatch/duplicate/empty、known canonical set 与无 logic/handler/AI exposure wire shape。
- strict Clippy、Rustfmt、Prettier、`git diff --check` 与完整 `pnpm check` PASS：Vitest 191 files / 1118 tests（另 2 files / 6 tests baseline skip），Node 33/33，Rust workspace 336 PASS、1 credential-only ignore，archive interop 双向通过。
- Scope/DoD、V5.2 §7、Architecture Contract 与 M0-T05 DependsOn 已复核；用户 `.gitignore` diff SHA-256 保持 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 且不纳入提交；无 SPEC BLOCKER。M4-T01 PASS；下一项严格为 M4-T02 Status Definition / Runtime Instance。

## 2026-09-04 — M4-T02 完成 Status Definition / Runtime Instance

### 可版本化 schema、typed hooks 与 runtime clock identity

- 从 M4-T01 提交 `6183d59` 创建 `task/M4-T02-status-definition-runtime-instance`。新增 `StatusDefinition` version 1，覆盖冻结的 tags、stackGroup、stackMode、maxStacks、duration、refreshPolicy、priority、tickPhase、dispel/immunity tags、typed effects/triggers 与 strengthRank；所有开放身份走 stable string/GameplayTagCatalog，所有封闭规则语义走 tagged enum。
- Duration schema 固定 OWNER_TURN/ROUND/PERMANENT、NEXT_CLOCK/CURRENT_CLOCK、positive duration/null permanent 与 typed expiry phase；本项只验证 record，不提前推进 clock。Trigger schema固定 §8 事件身份、priority 与 ordered Effect primitive；不建立独立 dispatcher/scheduler。
- `StatusRuntime` 扩充 statusSchemaVersion、definition/source identity、stack、remaining duration、applicationSequence、activationClockIndex、appliedRoundIndex/appliedOwnerTurnIndex 与 strengthRank。Runtime collection 强制 `applicationSequence ASC → statusInstanceId ASC`，并接入全局 CombatState invariant/save restore。新增 `DEC-194`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：186/186 PASS，其中新增 6 项覆盖完整 Definition serde、Runtime clock identity round-trip、非法版本/ID/tag/duration/trigger、canonical application order、runtime duration shape 与 unknown/runtime-code rejection。
- strict Clippy、Rustfmt、Prettier、`git diff --check` 与完整 `pnpm check` PASS：Vitest 191 files / 1118 tests（另 2 files / 6 tests baseline skip），Node 33/33，Rust workspace 342 PASS、1 credential-only ignore，archive interop 双向通过。
- Scope/DoD、V5.2 §8/§9/§9.0/§9.1 与 M4-T01 DependsOn 已复核；用户 `.gitignore` diff SHA-256 保持 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 且不纳入提交；无 SPEC BLOCKER。M4-T02 PASS；下一项严格为 M4-T03 Status Merge Policy。

## 2026-09-04 — M4-T03 完成 Status Merge Policy

### 单一 merge owner、canonical lookup 与原子 outcome

- 从 M4-T02 提交 `7b11f03` 创建 `task/M4-T03-status-merge-policy`。新增 `StatusMergePolicy`，在进入 Runtime 前集中拒绝 Add+IndependentDuration、Replace 非 ReplaceDuration/maxStacks≠1、HighestOnly 缺 rank/maxStacks≠1/IndependentDuration，以及 IndependentStacks 非 IndependentDuration；enum 只承载数据，不解释行为。
- 新增唯一 `StatusMergeEngine`。Candidate 只取 exact stackGroup 并显式按 `applicationSequence ASC → statusInstanceId ASC` 排序；unique mode 遇到旧数据重复实例 deterministic fail closed，不依赖数组/Map/DB 顺序，也不在 Runtime 静默执行迁移修复。
- Add 保留既有 instance/activation、checked 增层到 cap 后继续执行 Keep/Refresh/Extend/Replace duration；Replace 原子返回 removed/applied；HighestOnly 严格按 rank DESC、definition ID ASC 决胜，完全相同定义/rank 才 refresh；IndependentStacks 达 cap 后不 eviction、不 refresh。Typed Apply/Replace/NoOp outcome 固定单次提交与后续事件投影所需 metadata，但本项不直接写 State 或发布 Event。新增 `DEC-195`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：194/194 PASS，其中新增 8 项覆盖非法 cross-product、Add 四种 refresh/cap、Replace incoming identity、HighestOnly rank/ID/reapply、IndependentStacks cap、输入顺序无关 duplicate failure、malformed incoming/sequence，以及 over-cap/cross-clock existing state fail-closed。
- `cargo clippy -p ember-combat-core --all-targets -- -D warnings`、Rustfmt、Prettier 与 `git diff --check` PASS。完整 `pnpm check` PASS：Vitest 191 files / 1118 tests（另 2 files / 6 tests 基线 skip），Node 33/33，Rust workspace 350 PASS、1 credential-only ignore，archive interop 双向通过。
- Scope/DoD、V5.2 §9.0 与 M4-T02 DependsOn 已复核；用户 `.gitignore` diff SHA-256 保持 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 且不纳入提交；无 SPEC BLOCKER。M4-T03 PASS；下一项严格为 M4-T04 Duration / Cooldown Clock。

## 2026-09-04 — M4-T04 完成 Duration / Cooldown Clock

### 可恢复 Status clock、exact phase 与独立 cooldown lifecycle

- 从 M4-T03 提交 `3adf04d` 创建 `task/M4-T04-duration-cooldown-clock`。新增 `StatusClockPolicy/Engine`，集中解释 OWNER_TURN/ROUND/PERMANENT、NEXT_CLOCK/CURRENT_CLOCK、tick eligibility 与 OwnerTurnEnd/RoundEnd/explicit hook expiry；wrong phase、重复同 clock、Extra Turn 都返回 deterministic unchanged。
- Runtime Status 新增 `tickEligibleClockIndex/lastDurationAdvancedClockIndex`，Combatant 新增 `normalOwnerTurnIndex` 并进入既有 serde/hash/invariant。NEXT 只延后计时/Tick，不延后规则效果；CURRENT 必须有 matching unexpired lifecycle，已过 Tick 不补发，PERMANENT 不计时且禁止 CURRENT。
- TurnRoundStateMachine 在 RoundStart 原子刷新 ReactionCharges/OncePerRound，在 Normal Owner Turn Start 原子推进 owner index、正 cooldown 减一并重置 ability/BasicAttack/OncePerOwnerTurn；OncePerBattle 保留。Extra Turn 既不进入 roster，也不推进或重置这些时钟。新增 `DEC-196`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：202/202 PASS，其中本项新增 8 项覆盖 NEXT_OWNER 的完整一回合、ROUND 两次 Tick 后过期、CURRENT before/after tick/invalid context、PERMANENT、explicit hook exactly-once、wrong phase/Extra Turn、Round/Owner reset ownership，以及 CD3 的 T1→T4 exact progression。
- `cargo clippy -p ember-combat-core --all-targets -- -D warnings`、Rustfmt、Prettier 与 `git diff --check` PASS。完整 `pnpm check` PASS：Vitest 191 files / 1118 tests（另 2 files / 6 tests 基线 skip），Node 33/33，Rust workspace 358 PASS、1 credential-only ignore，archive interop 双向通过。
- Scope/DoD、V5.2 §9.1 与 M2-T07/M4-T03 DependsOn 已复核；用户 `.gitignore` diff SHA-256 保持 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 且不纳入提交；无 SPEC BLOCKER。M4-T04 PASS；下一项严格为 M4-T05 HARD_CC / Control Resistance / DR。

## 2026-09-04 — M4-T05 完成 HARD_CC / Control Resistance / DR

### Typed category、single-ceil 与 status-commit-gated DR

- 从 M4-T04 提交 `7e2b950` 创建 `task/M4-T05-hard-cc-control-dr`。Status Definition 增加 closed HARD_CC/RESTRICTION/NONE category；新增 `ControlApplicationEngine`，严格执行 resolution gate→explicit immunity→level 3 immunity→resistance×DR→single ceil/min 1，无按控制名称分支或中间取整。
- `ControlBalanceConfig` 提供可调 Normal/Elite/Boss 1.00/0.75/0.50 与 DR level 0/1/2 的 1.00/0.50/0.25。Boss modifier 与 typed immunity evidence 分离；matching immunity tag 必须确实存在于 Definition immunityTags，显式 rule ID 也经 stable-ID validation。
- Combatant 新增聚合 `HardCcDrRuntime` 并接入 serde/hash/global invariant。成功 HARD_CC 只产生 pending DR transition；它必须接收 M4-T03 Applied/Replaced 才可写 Working State，NoOp 拒绝。OwnerTurnEnd 调用唯一 quiet engine；受控但完整的 Normal Turn 计数，Extra Turn 和 Skipped/Removed 不计，连续两个 quiet full turns 才 reset。新增 `DEC-197`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：212/212 PASS，其中新增 10 项覆盖 tier/Boss balance、single-ceil 反例、DR 0→3 与 pre-application level、Miss/Save/Schema/immunity、Restriction、pending+merge NoOp、quiet reset、malformed input/global invariant，以及受控完整回合/Extra Turn/Skipped 集成。
- `cargo clippy -p ember-combat-core --all-targets -- -D warnings`、Rustfmt、Prettier 与 `git diff --check` PASS。完整 `pnpm check` PASS：Vitest 191 files / 1118 tests（另 2 files / 6 tests 基线 skip），Node 33/33，Rust workspace 368 PASS、1 credential-only ignore，archive interop 双向通过。
- Scope/DoD、V5.2 §9.2 与 M4-T04 DependsOn 已复核；用户 `.gitignore` diff SHA-256 保持 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 且不纳入提交；无 SPEC BLOCKER。M4-T05 PASS；下一项严格为 M4-T06 Trigger Pipeline。

## 2026-09-04 — M4-T06 完成 Trigger Pipeline

### Typed fact boundary、唯一 Scheduler 与 execution permit

- 从 M4-T05 提交 `b4df646` 创建 `task/M4-T06-trigger-pipeline`。新增 `CanonicalTriggerPipeline`，把 Status Definition 的 typed hook 适配到 M2 唯一 Canonical Scheduler：root 使用 `enqueue_roots`，执行中 child 使用 `complete_current_with_children`，不建立递归 dispatcher、第二队列或事件总线。
- Trigger signal 拆为 Lifecycle、Calculated Outcome 与 Committed Event 三类。Committed Damage/Status/Defeat 必须匹配当前 `lastCommittedSequence + EventChainID`；OnKill 只从 committed TargetDefeated 派生并验证 causal source owner，Working Damage/Working State 不可作为 committed signal。
- Hook phase 固定 version 1 code-owned priority；订阅 identity 由 owner/status instance/definition/trigger/hook 的 length-prefixed SHA-256 生成。执行时按 committed current Status 重新确认 legality；前序移除则 Skip。只有 Scheduler eligibility 与 loop guard 返回 Ready 后才生成携带 typed Effects 的 `ScheduledTriggerPermit`，Reaction queue head、Skip 与 Engine Failure 都不释放 Effect。新增 `DEC-198`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：220/220 PASS，其中新增 8 项覆盖 typed hook/canonical order、calculated/committed 隔离、OnKill causal source、permit gate、失效 Skip、child 同队列 + crash resume、overflow 无 Effect，以及拒绝消费 Reaction item。
- `cargo clippy -p ember-combat-core --all-targets -- -D warnings`、Rustfmt 与 `git diff --check` PASS。完整 `pnpm check` PASS：Vitest 191 files / 1118 tests（另 2 files / 6 tests 基线 skip），Node 33/33，Rust workspace 376 PASS、1 credential-only ignore，archive interop 双向通过。
- Scope/DoD、V5.2 §8/§8.1/§8.2/§8.3/§11.1 与 M2-T05/M4-T02 DependsOn 已复核；用户 `.gitignore` diff SHA-256 保持 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 且不纳入提交；无 SPEC BLOCKER。M4-T06 PASS；下一项严格为 M4-T07 Reaction Core。

## 2026-09-05 — M4-T07 完成 Reaction Core

### 基础模式、所有权与原子成本边界

- 从 M4-T06 提交 `42d6601` 创建 `task/M4-T07-reaction-core`。新增 `CanonicalReactionCore`，Reaction 与 Status Trigger 共用唯一 Canonical Scheduler；支持 Auto、Ask、AI_EVALUATE、Disabled，并在出队执行前重新检查 owner active、ReactionCharges 与全部 typed costs。
- PlayerCommandSource 只有 Player side + matching Player assignment 才能打开 Ask；Companion/Enemy 的 Ask 统一路由 UtilityAI，错误 Player assignment fail closed。UtilityAI 必须提供绑定 owner/reaction 的 typed decision，已计数恢复不再次请求决策。
- 执行通过 M2 scheduler gate 后才 reserve+commit Reaction 子成本；不可用成本只做合法性 Skip，缺失资产/损坏 ledger 返回错误。恢复中的 counted item 必须已有 committed reservation，避免免费执行与重复扣费。稳定 Window/Reservation identity 使用 domain-separated SHA-256，合法最大长度 EventChainID 不溢出 Stable ID。
- 单项 Ask 将现有 ResolutionContext 标记为 `SuspendedForReaction`，保留 Scheduler current item、queue、RNG 与 resolved rolls，并写入基础 `PendingReactionWindow`；挂起期间 Scheduler 不能入队、出队、完成或被视为 quiescent。完整多项 snapshot、选择和 exactly-once decision 明确保留给 M4-T08。新增 `DEC-199`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：233/233 PASS，其中 Reaction 13 项覆盖 Auto、Disabled、depleted charge、Player/UtilityAI ownership、Ask suspend/restore、共享队列阻塞、成本错误/恢复、Hook mismatch 与最大长度 identity。
- strict Clippy、Rustfmt、Prettier 与 `git diff --check` PASS。完整 `pnpm check` PASS：Vitest 191 files / 1118 tests（另 2 files / 6 tests baseline skip），Node 33/33，Rust workspace 389 PASS、1 credential-only ignore，archive interop 双向通过。
- Scope/DoD、V5.2 §10/§10.1 与 M4-T06/M2-T01 DependsOn 已复核；用户 `.gitignore` diff SHA-256 保持 `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987` 且不纳入提交；无 SPEC BLOCKER。M4-T07 PASS；下一项严格为 M4-T08 Multi-Reaction / Pending Snapshot Contract。

## 2026-09-05 — M4-T08 完成 Multi-Reaction / Pending Snapshot Contract 与 M4 Runtime Gate

### 同队列多选、exactly-once 与可序列化 continuation

- 从 M4-T07 提交 `9e3ab91` 创建 `task/M4-T08-multi-reaction-pending-snapshot`。Ask Window 只从 queue head 起收集 canonical order 中连续、同 `phasePriority + explicitPriority + sourceInitiativeOrder + sourceStableId` 的 Player Ask items；遇到 Auto、UtilityAI、其他 source 或不同 key 立即停止。挂起项携带完整 SchedulerItem key/depth/sequence，不建立第二队列。
- `ResolveReactionCommand` 先经过统一 AcceptedCommandLedger。Trigger 必须提供 listed `selectedReactionId`，只恢复并执行所选 item；未选 listed items 保留原 key/sequence 回到同一 Scheduler。Skip 固定丢弃窗口列出的全部 items。相同 commandId 幂等返回 AlreadyResolved 且无 permit，不同 commandId 对 resolved Window 冲突拒绝；清窗后的同一已接受命令仍只返回幂等结果。
- ReactionCharges > 1 允许后续 queue opportunity 再开 Window，不在一个 Window 连续触发多项。前项执行后，回队项在 queue head 重新检查 charge/cost/owner legality；耗尽时无 RNG、无 Cost、无 event-count 地 Skip。Auto 与 Ask 的组合实测共用一条 Scheduler 并按 canonical 顺序消耗两次 charge。
- 新增序列化 `PendingReactionSnapshot`、`ResolutionContextSnapshot`、`CostSnapshot` 与聚合 `ReactionContinuationSnapshot`，投影 ruleset versions、state revision、Window/queue/depth/sequence、完整 ResolutionContext/RNG cursor、cost balances/reservation ledger。权威仍是单一 CombatState；这些 contract 供 M10 接入现有 SQLite，不引入平行事实源或长期事务。
- Pending invariant 覆盖 unresolved/resolved-trigger/resolved-skip lifecycle、selected placement、原 sequence 回队、cost state、context suspension/resume 与 tamper rejection。内存 state serialize/verify/restore 后以同一决策分别续跑，结果 State、AcceptedCommands、RNG、Cost、queue 与 completed hooks 完全相同；loop-guard overflow 固定无 permit/charge/RNG 并保留可验证 checkpoint。新增 `DEC-200`。

### 验证与结束状态

- `cargo test -p ember-combat-core`：240/240 PASS，其中 Reaction 20 项；M4-T08 新增 7 项覆盖 multi-select deterministic continuation、Skip/conflict/clear 后 replay、ReactionCharges>1、Auto+Ask shared queue、Ask overflow、pending tamper 与 snapshot unknown field。
- strict Clippy、Rustfmt、Prettier 与 `git diff --check` PASS。完整 `pnpm check` PASS：Vitest 191 files / 1118 tests（另 2 files / 6 tests baseline skip），Node 33/33，Rust workspace 396 PASS、1 credential-only ignore，archive interop 双向通过。
- M4-T01..T08 与 M4 Runtime Gate PASS；覆盖 Status merge/clock/immediate runtime semantics、HARD_CC DR、typed Trigger、Reaction ownership/order/charges 与 pending memory exactly-once resume。按任务 SOT，本项不接 SQLite；durable crash-resume 明确由 M10-T02 接入、M11-T03 最终关闭，当前不将其误报为已验收。用户 `.gitignore` diff SHA-256 保持不变且未纳入提交；无 SPEC BLOCKER。下一项严格为 M5-T01。
