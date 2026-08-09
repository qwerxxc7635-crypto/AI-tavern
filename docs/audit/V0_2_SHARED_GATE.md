# Ember Tavern v0.2 Shared Gate 验收记录

## 结论

`V02-M9-T01` Shared Gate在当前macOS开发环境通过。该结论只覆盖共享代码、合同、数据与安全门禁；Windows安装生命周期和macOS应用包仍必须在`V02-M9-T02`、`V02-M9-T03`分别验收。

## 环境与命令

- 时间：2026-08-09T03:47:29.238Z至2026-08-09T03:48:43.099Z
- 系统：Darwin 23.6.0 arm64
- Node.js：v26.7.0
- pnpm：11.9.0
- Rust：rustc 1.97.1
- 基线HEAD：`96d05c9 feat(v0.2): add context inspector`
- 命令：`node scripts/run-with-evidence.mjs --output .local/evidence/m9-shared-gate-macos-pass.json -- pnpm check:shared`
- 退出码：0
- UTF-8证据SHA-256：`58b88eb711f53919ddb74dc7e312a3ce71ee9bbec967989e0c0892aaafc1f234`

原始证据位于被Git忽略的`.local/evidence/m9-shared-gate-macos-pass.json`，包含命令数组、起止时间、退出码、signal、stdout和stderr。首次运行因新增门禁自测对多行Clippy调用使用了过严的字符串匹配而失败；失败记录保留在`.local/evidence/m9-shared-gate-macos.json`（SHA-256 `b0713f606b82e43f50ecd9c013520508e8d4d633b62d93f63636970448bfa5db`），修复测试断言后才生成上述通过证据。

## 门禁映射

| 必须类别 | 验收入口与结果 |
| --- | --- |
| formatting | Prettier与`cargo fmt --all -- --check`通过 |
| lint | ESLint零warning；Clippy覆盖workspace、all targets、all features并以warning为错误 |
| TS | `tsc --project tsconfig.json --noEmit`通过 |
| Vitest | 82个文件、461项测试全部通过；另有23项Node测试通过 |
| Rust | workspace共87项测试通过：native bridge 49、platform 4、provider 15、secure HTTP 11、secure secrets 3、Windows lib 5 |
| SQLite | persistence迁移、约束、备份失败零变更、Repository、原生CampaignStore及Windows纵向切片测试通过 |
| Provider | OpenAI-compatible统一合同、preset/custom、离线Fake/本地stub、错误规范化与凭据引用测试通过；未调用真实付费API |
| archive | `.emtavern` TypeScript生成→Rust导入、Rust生成→TypeScript导入及fixture比对通过 |
| context | Context Assembly、Builder、Budget、Cache Layout与Inspector测试通过 |
| orchestrator | AI Task/Turn Orchestrator、manifest复核、候选与回合用例测试通过 |
| security | SSRF地址策略、DNS复核、响应大小/超时、敏感header、OS秘密存储、存档秘密扫描与资源上限测试通过 |

## 边界

- 没有访问真实Provider、付费API、正式用户数据或API Key。
- 没有创建、修改或验收iOS工程。
- 没有把当前macOS上的Rust Windows纵向测试冒充Windows实机、WebView2、NSIS、安装、启动或卸载证据。
- 没有把共享PlatformPaths合同测试冒充Keychain、WKWebView或`.app`启动证据。
