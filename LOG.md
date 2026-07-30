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

- Commit hash：本条所在提交，完成后由 `git log` 确认。
- Commit message：`chore(M0-T03): create initial workspace structure`
