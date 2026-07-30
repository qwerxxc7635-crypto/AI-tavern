# Ember Tavern

Ember Tavern（炉火酒馆）是一款面向 Windows 和 iOS 的单人 AI 文字冒险应用。模型负责生成世界与叙事，本地程序负责规则、验证、状态和存档；本地 SQLite 是游戏事实的唯一数据源。

## 当前状态

项目准备里程碑 M0 和领域模型里程碑 M1 已完成。pnpm workspace 已识别 Windows、iOS 和八个共享 package，Cargo workspace 已识别 `ember-native-bridge`；严格 TypeScript、ESLint、Prettier、Vitest、Rust fmt/Clippy 和基础 CI 已建立。共享协议现已覆盖Campaign、世界、角色、酒馆/NPC、任务/物品、冒险和事件；D20、关系与世界时钟领域规则已实现。SQLite ER模型已在 [`docs/data-model.md`](docs/data-model.md) 定义，迁移和数据库功能仍未实现。

完整产品规格见 [`docs/spec.md`](docs/spec.md)，任务顺序与验收标准见 [`docs/TASKS.md`](docs/TASKS.md)。

## 启动说明

当前阶段没有可启动的应用。需要 Node.js、pnpm 和 Rust/Cargo；在仓库根目录可运行：

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm rust:fmt
pnpm rust:clippy
pnpm rust:test
# 或一次执行全部质量门：
pnpm check
```

这些 pnpm 命令统一检查当前 workspace 成员。Cargo workspace 可通过以下命令验证：

```powershell
cargo metadata --format-version 1
cargo test --workspace
```

当前没有可启动的应用；React、Tauri 和游戏功能尚未实现。

## 本地开发缓存

项目相关缓存、下载、构建输出和临时文件统一放在被 Git 忽略的 `.local/`。执行依赖安装或构建前，为当前 PowerShell 进程设置：

```powershell
$ProjectRoot = (Resolve-Path .).Path
$env:PNPM_HOME = "$ProjectRoot\.local\tools\pnpm"
$env:PNPM_STORE_DIR = "$ProjectRoot\.local\cache\pnpm-store"
$env:npm_config_cache = "$ProjectRoot\.local\cache\npm"
$env:CARGO_HOME = "$ProjectRoot\.local\cache\cargo"
$env:CARGO_TARGET_DIR = "$ProjectRoot\.local\build\cargo-target"
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
$env:TEMP = "$ProjectRoot\.local\cache\temp"
$env:TMP = $env:TEMP
```

仓库配置已将 pnpm store 固定为 `.local/cache/pnpm-store`。现有 Rust 工具链继续从系统安装位置调用，Cargo 下载和构建输出必须使用上述 D 盘项目路径。

## 开发约定

### 分支

- `main` 保持可验收状态，不在其上混入多个任务。
- 每个任务使用独立分支，命名为 `task/<任务编号>-<简短说明>`，例如 `task/M0-T01-repository-baseline`。
- 不得在当前任务分支提前实现后续任务。

### Commit

- 每个任务形成独立 commit。
- 格式为 `<type>(<scope>): <summary>`。
- 常用 `type`：`chore`、`docs`、`feat`、`fix`、`test`、`refactor`。
- `scope` 优先使用任务编号，例如 `chore(M0-T01): initialize repository standards`。
- 提交前必须按 `docs/TASKS.md` 核对当前任务验收标准并更新开发日志。

## 长期协作规则

仓库级长期规则见 [`AGENTS.md`](AGENTS.md)。
