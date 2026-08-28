# Ember Tavern

Ember Tavern（炉火酒馆）是一款面向 Windows 和 macOS 的单人 AI 文字冒险桌面应用。模型负责生成世界与叙事，本地程序负责规则、验证、状态和存档；本地 SQLite 是游戏事实的唯一数据源。

## 当前状态

当前开发候选为 v0.3.0（Ember Rebuild）。M0～M12 的架构、动态世界、Rules Engine、Character Creation 2.0、统一 Context/Memory、视觉体系、长流程可玩性和第一轮完整审计均已完成；当前开放 P0/P1/P2/P3 均为 0，结论为 `READY FOR SECOND AUDIT`，但尚非公开发布候选。正式范围见 [`docs/V0.3_SPEC.md`](docs/V0.3_SPEC.md)，严格任务顺序见 [`docs/TASKS.md`](docs/TASKS.md)，最终结论见 [`docs/V0.3_FIRST_AUDIT_REPORT.md`](docs/V0.3_FIRST_AUDIT_REPORT.md)。

v0.3.0 继续采用 Windows 纵向切片优先、macOS 共享门禁的桌面策略。Tauri 2 客户端具备世界与通用角色创建、动态酒馆/NPC/Quest、8～12 回合冒险、本地 D20、规则事务、原子结算、档案、V0.2→V0.3 存档迁移和“我的”设备设置。macOS 0.3.0 `.app` 已完成编译、身份、哈希和系统 WebKit 检查；Windows NSIS 生命周期与临时 macOS 真实启动生命周期因当前主机限制明确为 `BLOCKED_EXTERNAL`，不能视为已验证。iOS 仍不在当前开发范围内。

模型设置中的默认/备用 Provider、模型、端点和系统安全凭据已经进入统一桌面 AI 编排路径；世界、车卡、酒馆、NPC、任务、冒险和结算共用同一套模型选择、Prompt、结构校验、错误和缓存机制。当前 V0.3 可玩性与性能证据使用 Fake Provider，真实模型文风、网络延迟、token 成本和计费缓存保持 `NOT_EVALUATED`，不得沿用 V0.2 的真实 DeepSeek 结果冒充 V0.3 结论。

历史 v0.1 产品规格见 [`docs/spec.md`](docs/spec.md)，v0.2 历史任务见 [`docs/TASKS_V0.2.md`](docs/TASKS_V0.2.md)。

## 启动说明

需要 Node.js、pnpm 和 Rust/Cargo；Windows 另需 Microsoft C++ Build Tools 与 WebView2，macOS 另需 Xcode Command Line Tools。安装依赖后，从仓库根目录启动桌面开发窗口：

```sh
pnpm install --frozen-lockfile
pnpm --filter @ember-tavern/windows-app tauri dev
```

构建Windows NSIS安装包：

```powershell
pnpm --filter @ember-tavern/windows-app tauri build --bundles nsis --no-sign
```

构建 macOS app：

```sh
pnpm --filter @ember-tavern/windows-app tauri build --bundles app
```

本地命令生成未签名的内部验收候选；正式对外发布需要代码签名证书。安装、WebView2、用户数据位置与卸载保留策略见[`docs/WINDOWS_INSTALL.md`](docs/WINDOWS_INSTALL.md)。如只需开发期裸EXE，仍可在命令末尾使用`--no-bundle`。

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

应用默认进入存档首页，未完成的世界、车卡或冒险存档会返回对应页面。酒馆选择 NPC 后可继续已保存对话，任务告示可接受一项主任务；冒险支持候选操作、自由输入、本地 D20 和中断恢复。结算后的奖励、NPC 心情、酒馆陈设、世界时钟和档案均从 SQLite 恢复。模型设置支持 Provider、Base URL、模型、系统安全密钥、连接测试及默认/备用选择；保存后，下一次游戏生成会读取该设备配置。只有明确授权的备用模型会在网络、限流、超时或服务不可用时接手一次，认证、额度或非法输出不会触发静默跨 Provider 切换。

## 玩家文档

- [Windows 0.1 隐私与本地数据说明](docs/PRIVACY_WINDOWS.md)
- [Windows 0.1 内部候选说明](docs/RELEASE_NOTES_0.1.md)
- [Windows 安装、数据保留与卸载](docs/WINDOWS_INSTALL.md)
- [Windows 自动端到端测试](docs/WINDOWS_E2E.md)
- [Windows 0.1 最终验收记录](docs/WINDOWS_ACCEPTANCE_0.1.md)
- [v0.2 第一轮技术审查](docs/V0.2_FIRST_AUDIT_REPORT.md)
- [v0.2 第一轮可玩性报告](docs/V0.2_PLAYABILITY_REPORT.md)
- [v0.3 第一轮完整审计报告](docs/V0.3_FIRST_AUDIT_REPORT.md)
- [v0.3 可玩性报告](docs/V0.3_PLAYABILITY_REPORT.md)
- [v0.3 发布门报告](docs/audit/V0_3_RELEASE_GATES.md)

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
