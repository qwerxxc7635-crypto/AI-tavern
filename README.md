# Ember Tavern

Ember Tavern（炉火酒馆）是一款面向 Windows 和 iOS 的单人 AI 文字冒险应用。模型负责生成世界与叙事，本地程序负责规则、验证、状态和存档；本地 SQLite 是游戏事实的唯一数据源。

## 当前状态

项目准备里程碑 M0、领域模型里程碑 M1、持久化里程碑 M2、AI基础设施里程碑 M3 和应用用例里程碑 M4 已完成。Windows Tauri 2客户端可启动，应用壳可在酒馆、任务、冒险、角色、档案和设置间导航；存档首页支持在系统应用数据目录的SQLite中新建、继续和归档存档。世界创建与车卡流程可使用Fake Provider完成；酒馆页会生成并展示老板、两名常驻NPC、一名访客、三条不显示真伪的传闻、任务入口和三个SQLite世界时钟。NPC聊天支持历史恢复，任务告示支持单主任务接受；冒险页提供角色/目标/时钟、剧情/行动、物品/线索/骰子三栏，可完成并在重启后恢复8回合Fake冒险。结算、冒险档案和真实Provider仍未实现。

完整产品规格见 [`docs/spec.md`](docs/spec.md)，任务顺序与验收标准见 [`docs/TASKS.md`](docs/TASKS.md)。

## 启动说明

需要 Node.js、pnpm、Rust/Cargo、Microsoft C++ Build Tools 和WebView2。设置下文的本地缓存环境变量后，可从仓库根目录启动Windows开发窗口：

```powershell
pnpm --filter @ember-tavern/windows-app tauri dev
```

构建不含安装器的Windows可执行文件：

```powershell
pnpm --filter @ember-tavern/windows-app tauri build --no-bundle
```

仓库质量检查命令：

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

应用默认进入存档首页，未完成的世界、车卡或冒险存档会返回对应页面；GENERATING_TAVERN存档会在进入酒馆时完成离线初始化。酒馆选择NPC后可继续已保存对话，任务告示可接受一项主任务，冒险支持本地D20、无检定回合和ENDING恢复。下一项为M5-T10结算与冒险档案页面。

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
