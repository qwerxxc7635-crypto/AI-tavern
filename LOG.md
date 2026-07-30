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

- Commit hash：待提交。
- Commit message：`feat(M1-T03): define world contracts`
