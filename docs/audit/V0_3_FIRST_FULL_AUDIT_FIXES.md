# Ember Tavern V0.3 第一轮完整审计修复记录

- 任务：M12-T02
- 审计基线：`d41e99b35e7efb9d47f2a500b236ff3251d68b07`
- Findings 冻结提交：`c5b7e74`
- 实现提交：`d1b5a30`

## 结果

| ID | 优先级 | 最终状态 | 修复或裁决 |
| --- | --- | --- | --- |
| M12-AUD-001 | P2 | FIXED | 本地会话保留“我的”设备路由，Campaign 专属入口回存档选择；新增点击回归。 |
| M12-AUD-002 | P2 | FIXED | Vite 7.3.6 / plugin-react 5.2.0，五条开发服务器公告清零。 |
| M12-AUD-003 | P3 | FIXED | Vitest 4.1.11、传递图刷新、`brace-expansion` 5.0.9 override；npm audit 0。 |
| M12-AUD-004 | P2 | FIXED | 五个唯一 Action 固定完整 SHA，checkout 不持久化凭据，Rust toolchain 显式。 |
| M12-AUD-005 | P2 | FIXED | npm/Cargo/Tauri/release-info/changelog/README 统一到 0.3.0，同步命令可重复。 |
| M12-AUD-006 | P3 | DEFERRED_ACCEPTED | GTK3/glib 仅在 Linux target 图；V0.3 Windows/macOS 不可达，恢复 Linux 发布前必须重审。 |

修复后开放 P0/P1/P2/P3 均为 0。`DEFERRED_ACCEPTED` 不等于依赖告警消失：Cargo.lock 全平台审计仍诚实报告 16 个 unmaintained 和 1 个 Linux GTK3 路径 unsound informational warning；当前 RustSec vulnerability 为 0。

## 关键边界

- 没有修改 Rules Engine、D20 硬结果、AI Provider 运行合同、Generator/Queue、SQLite schema、Save/Resume、World Seed/Constitution 或 Quest/NPC/Adventure 状态机。
- 发布版本提升只改变产品身份和生成的发布说明，不改变 save/world schema version；V0.2 兼容映射、迁移和 archive 格式继续保持。
- 没有为视觉手册新建第二套组件；唯一 UI 行为修复沿用现有 AppShell 与路由合同。
- 没有读取 API Key、调用真实计费模型、push、merge、签名或发布。

## 定向验证

- Navigation：`routes.test.tsx` + `navigation.test.ts`，2 files / 23 tests PASS；新增本地会话侧栏和设置包屑点击用例。
- CI：`scripts/ci-workflow.test.mjs` 6/6 PASS；14 个 Action 引用均匹配 40 字符 SHA，checkout/toolchain 各 3 处配置受锁定。
- Release：连续 `pnpm release:sync`、`pnpm release:check` PASS；发布元数据为 0.3.0；`pnpm install --frozen-lockfile` PASS。
- Dependency：`pnpm audit --registry=https://registry.npmjs.org` 为 0 advisories；`cargo-audit 0.22.2` 为 0 vulnerability。
- Target graph：glib 0.18.5 仅存在于 `x86_64-unknown-linux-gnu`；macOS arm64 与 Windows x64 图均不可达。

## 完整回归

- `pnpm check`：PASS。Vitest 189 files / 1054 tests，另 2 files / 6 tests按设计跳过；Node 30/30；Rust 150/150，另 1 项真实 DeepSeek 测试按显式授权边界 ignored；Prettier、zh-CN、ESLint、TypeScript、rustfmt、严格 Clippy 和 archive interop 全绿。
- `pnpm test:windows-e2e`：1/1 PASS。
- `pnpm build:desktop`：PASS，Vite 7.3.6 转换 281 modules。
- `pnpm performance:gate`：在实现提交 `d1b5a30` 上 PASS；SQLite 541.582 bytes/turn、Context 377→383 tokens、增长 1.016、GenerationQueue P95 2ms。真实 Provider token/cache 仍为 NOT_EVALUATED。
- `pnpm playtest:report`：3/3 PASS，M11 的 104 项行为与 8.8/10 MEDIUM 结论未漂移。

M12-T02 只关闭或裁决第一轮 findings。Windows NSIS/Credential Manager/WebView2/安装启动卸载证据和 macOS `.app` 生命周期属于下一项 M12-T03；真实 Provider 仍无授权，不得冒充 VERIFIED。
