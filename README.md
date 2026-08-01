# Ember Tavern

Ember Tavern（炉火酒馆）是一款面向 Windows 和 iOS 的单人 AI 文字冒险应用。模型负责生成世界与叙事，本地程序负责规则、验证、状态和存档；本地 SQLite 是游戏事实的唯一数据源。

## 当前状态

项目准备里程碑 M0、领域模型里程碑 M1、持久化里程碑 M2、AI基础设施里程碑 M3 和应用用例里程碑 M4 已完成。Windows Tauri 2客户端可启动，应用壳可在酒馆、任务、冒险、角色、档案和设置间导航；存档首页支持在系统应用数据目录的SQLite中新建、继续和归档存档。世界创建与车卡流程可使用Fake Provider完成；酒馆页会生成并展示老板、两名常驻NPC、一名访客、三条不显示真伪的传闻、任务入口和三个SQLite世界时钟。NPC聊天支持历史恢复，任务告示支持单主任务接受；冒险页提供角色/目标/时钟、剧情/行动、物品/线索/骰子三栏，可完成并在重启后恢复8回合Fake冒险。结算会原子提交任务、NPC、奖励、世界时钟与事实，档案页从SQLite恢复完整结局摘要。Rust安全HTTP传输层已提供受限端点、超时、取消、流式响应、响应上限和标准化错误；模型凭据保存到Windows Credential Manager，SQLite只接收不透明引用。OpenAI-Compatible适配器以及DeepSeek V4、Qwen 3.7预设已通过本地Provider合同测试，尚未执行真实厂商调用。

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

应用默认进入存档首页，未完成的世界、车卡或冒险存档会返回对应页面；GENERATING_TAVERN存档会在进入酒馆时完成离线初始化。酒馆选择NPC后可继续已保存对话，任务告示可接受一项主任务，冒险支持本地D20、无检定回合和ENDING恢复；结算后的奖励、NPC心情、酒馆陈设、世界时钟与历史档案均可在重启后恢复。Windows设置页可配置Provider、Base URL、模型、系统安全密钥、连接测试、默认与备用模型；设置与游戏事实隔离。已登记模型的JSON、流式、上下文长度和成本能力会写入SQLite，AI回合从已启用档案中路由并在JSON Schema不可用时降级到JSON Object或文本提示词，输出仍必须通过本地Schema与领域校验。额度、认证、限流、超时、模型不存在、结构和网络错误会保留为标准分类。失败回合可用备用模型复用SQLite中同一输入和上下文继续生成；跨厂商发送需要确认，切换事件与游戏进度原子提交并受新请求幂等键保护。结构错误会把首次非法原文交回同一模型进行一次严格JSON修复；两次原文和错误分别审计，最终失败不提交任何游戏状态。完整冒险回合与AUTO快照原子提交，每个存档轮换保留最近10个自动恢复点，并可清除未完成进度回退到最近完整回合。SQLite完整备份先写入临时文件并校验后原子发布，Windows启动和迁移前均轮换保留最近3份；备份失败会中止启动或迁移且不修改主库。启动恢复协调器会识别中断请求、失败请求、未完成回合与数据库启动异常，并按持久化状态提供继续、重试、更换模型或取消；取消与最近完整回合恢复原子执行。AI上下文按任务使用固定预算，长NPC对话、长期记忆、冒险回合和结算历史会压缩为有界摘要并保留最新窗口，不会把全部存档历史发送给模型。`.emtavern` v1已定义为带Schema版本和SHA-256清单的五文件ZIP，迁移游戏事实、事件和生成审计而不携带设备凭据或模型配置。下一项为M8-T02实现存档导出。

## 本地开发缓存

项目相关缓存、下载、构建输出和临时文件统一放在被 Git 忽略的 `.local/`。执行依赖安装或构建前，为当前 PowerShell 进程设置：

```powershell
$ProjectRoot = (Resolve-Path .).Path
$env:PNPM_HOME = "$ProjectRoot\.local\tools\pnpm"
$env:PNPM_STORE_DIR = "$ProjectRoot\.local\cache\pnpm-store"
$env:npm_config_cache = "$ProjectRoot\.local\cache\npm"
$env:RUSTUP_HOME = "$ProjectRoot\.local\tools\rustup"
$env:CARGO_HOME = "$ProjectRoot\.local\tools\cargo"
$env:CARGO_TARGET_DIR = "$ProjectRoot\.local\build\cargo-target"
$env:PATH = "$env:CARGO_HOME\bin;$env:RUSTUP_HOME\toolchains\stable-x86_64-pc-windows-msvc\bin;$env:PATH"
$env:TEMP = "$ProjectRoot\.local\cache\temp"
$env:TMP = $env:TEMP
```

仓库配置已将 pnpm store 固定为 `.local/cache/pnpm-store`。Rust工具链、Cargo下载和构建输出均使用上述D盘项目路径。

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
