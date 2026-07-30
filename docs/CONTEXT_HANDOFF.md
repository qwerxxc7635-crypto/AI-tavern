# Ember Tavern 上下文交接

## 当前状态

- 分支：`main`
- 最近提交：`M0-T03` 完成提交（以 `git log -1` 为准）
- 已完成：`M0-T01`、`M0-T02`、`M0-T03`
- 当前任务：`M0-T03` 已验收，准备提交
- 下一任务：`M0-T04 建立代码质量检查`

## 架构摘要

- 本地 SQLite 是游戏事实的唯一真实数据源。
- AI Provider 仅生成内容或状态变更建议，所有输出必须经过结构与业务规则验证。
- Windows 离线纵向切片优先；真实 Provider 和 iOS 全面适配按任务依赖推进。
- pnpm 根 workspace 识别两个应用与八个共享 package；Cargo 根 workspace 识别 `ember-native-bridge`。

## 关键决策

- `DEC-001`：酒馆老板计入三名常驻 NPC。
- `DEC-002`：Cargo 动态验证延后到首个真实 crate 创建后，验证要求未取消且已在 `M0-T03` 完成。

## 环境与限制

- Node.js `v24.17.0`，pnpm `11.9.0`。
- Rustup `1.29.0`，Rustc/Cargo `1.97.1`，目标 `x86_64-pc-windows-msvc`。
- 所有新增缓存、下载、构建和临时文件必须位于仓库 `.local/`。
- 使用已有 C 盘 Rust 工具链，不向 C 盘安装或下载新内容。
- iOS 模拟器、真机和签名验证需要 macOS/Xcode，当前 Windows 环境不可执行。
- 真实云模型连接测试需要用户安全提供的 API Key；没有 Key 时使用 Fake Provider 和 mock contract test。

## 最近成功验证

- `pnpm install --frozen-lockfile`：通过。
- `pnpm --recursive list --depth -1`：识别 11 个 workspace 项目。
- `pnpm lint`、`pnpm test`、`pnpm typecheck`：通过。
- `cargo metadata --format-version 1`：识别 `ember-native-bridge`。
- `cargo fmt --all -- --check`、Cargo Clippy 严格检查、`cargo test --workspace`：通过。

## 恢复步骤

1. 完整读取 `AGENTS.md`、`docs/spec.md`、`docs/TASKS.md`、`docs/DEVELOPMENT_LOG.md`、`docs/DECISIONS.md`、`README.md`、`LOG.md` 和本文件。
2. 检查 Git 状态与最近提交。
3. 为当前 PowerShell 进程设置 `.local/` 下的 pnpm、npm、Cargo、TEMP、TMP 和构建路径。
4. 从 `M0-T04` 建立 TypeScript、Rust 和 CI 质量检查。
5. 完成验证、自审、日志和独立提交后，继续下一个满足依赖的任务。
