# Ember Tavern v0.2 基线

记录时间：2026-08-08（Asia/Shanghai）

## Git 与工作区

- 仓库：`/Users/mac/Desktop/item/4D`
- 远端：`https://github.com/qwerxxc7635-crypto/AI-tavern`
- 起始分支：`main`
- 起始 HEAD：`2010448f3be953bb2ebb2c1dcf7ef23a8697e022`
- 起始时与 `origin/main` 对齐。
- 起始工作树只有一项既有修改：`.gitignore` 新增 `.gstack/`。该修改未被覆盖、回退或擅自纳入提交。
- 恢复快照：`.local/recovery/20260808_122928/`，包含 HEAD、status、tracked/staged diff、untracked 清单与元数据。

## 工具链

- macOS 14.7.6 arm64；Xcode 16.2。
- Node.js 26.7.0；pnpm 11.9.0。
- rustc/cargo 1.97.1。
- 当前 CI 只有 `windows-latest` 质量任务；macOS 门禁与双平台产物尚缺失。

## 产品与平台基线

- 当前产品版本为 0.1.0，生产入口为 Windows Tauri 应用。
- SQLite 已是游戏状态的唯一真实数据源；iOS 仅占位且继续延期。
- `secure-secrets` 只有 Windows Credential Manager 实现；非 Windows 返回 unavailable。
- 应用/领域层仍存在 Windows 命名和平台路径耦合；尚无 `PlatformPaths` port 与 macOS adapter。
- 现有 AI 服务仍由前端 TypeScript 服务实例化 provider；v0.2 必须收敛到应用命令和统一 orchestrator。

## M0 执行边界

`V02-M0-T01` 已完成。依据总执行提示词，Architecture Gate 前只允许研究和架构文档变更，因此 `V02-M0-T02/T03` 在 Gate 前只形成约束与实施计划，Gate 通过后再实施，且先于 M1。

## Gate 后实施结果

- 新增 `ember-platform-services`：`PlatformPaths` port、经 Tauri 路径解析器注入的 Windows/macOS adapters、绝对路径校验和隔离测试根目录。
- SQLite 文件名只在桌面 composition root 与平台 data dir 组合；domain/application 不引入平台路径。
- 从现有 SVG 生成 Windows ICO 与 macOS PNG/ICNS；移动平台衍生资产未纳入仓库，也未启动 iOS 开发。
- 新增跨平台 Node 入口：`build:desktop`、`release:metadata`、`check:shared`；Windows 专项 E2E 仍保持明确的平台专属边界。
- macOS 上 adapter 契约测试 3/3、release metadata 测试 2/2、Tauri Rust desktop `cargo check` 和 179-module 前端生产构建通过。Windows adapter 使用同一契约夹具；实际 Windows 全门禁仍在 M9 强制复验。
