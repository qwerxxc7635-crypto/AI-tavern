# Ember Tavern V0.3 RC 实测问题修复报告

- 结论：`FIXED`
- 基线：`00fc1adb2d3ffc9c290d52a108b122e080c074f6`
- 分支：`fix/v0.3-rc-playtest-issues`
- 代码与测试提交：`760b5a24c7c806e8f30eb49c4251f8c1ae6cc62b`
- 输入证据：用户提供的 `12.docx`，原图冻结于 [`evidence/v0.3-rc-playtest-fix-00fc1ad/source/`](evidence/v0.3-rc-playtest-fix-00fc1ad/source/)
- 修复后证据：[`evidence/v0.3-rc-playtest-fix-00fc1ad/`](evidence/v0.3-rc-playtest-fix-00fc1ad/)

本轮只处理两个 RC 实测阻塞项。没有删除用户存档，没有改 SQLite schema、Save 格式、Rules/D20、Quest/NPC/Adventure 业务合同，没有接入新 Provider，也没有签名、notarize、发布、push 或 merge。

## RC-PLAYTEST-001 — 世界生成 TIMEOUT

### 根因

世界构筑原先绕过 `GenerationQueue`，直接请求 Desktop AI；调用侧传入 `5_000 ms`，非 Ollama Provider 又被静默提升到统一 `60_000 ms`。原生 secure HTTP 把这一个总时限同时覆盖 DNS、连接、发送和完整响应体。对于最大 8,000 输出 token 的结构化世界生成，网络正常但响应超过约 60 秒时仍会被传输层提前中止。旧链路也没有用统一队列意图键处理同一 Campaign 的并发请求。

### 修复

- secure HTTP 继续保持有界：DNS 10 秒、连接 15 秒、单次 Provider 完整传输 120 秒；没有无限等待。
- 世界生成与局部重绘统一进入单并发 `GenerationQueue`，使用 `world:<campaignId>:<task>` 意图键去重。外层 270 秒只用于容纳一次 120 秒请求加一次结构修复或获准 fallback，以及有界的本地校验/提交。
- 队列执行超时从任务真正开始时计算，排队时间单独记录为 `queueWaitMs`，避免等待队列消耗 Provider 执行预算。
- `AbortSignal` 从 UI 贯穿 Application、Queue、Desktop orchestrator 和原生非流式 HTTP；取消会调用既有原生取消注册表。
- Provider 错误分类保持原样；AUTH、RATE_LIMIT、NETWORK、SCHEMA 等不会被压成 TIMEOUT。
- SQLite 写入仍只发生在结构与业务校验通过后的原子 commit；取消、超时、无效输出和重复并发均无部分写入。

### 回归证明

- 60,001 ms 的合法响应不再触发旧 60 秒误杀。
- 永久挂起在 270 秒外层预算结束，signal 已取消且 commit 为 0。
- TIMEOUT 后干净重试只提交一次；同意图并发调用只执行/提交一次。
- AUTH 保持 AUTH；取消后 UI 退出 loading 且不发布世界。
- Chromium 受控 TIMEOUT 显示明确错误码与“重新请求”；重试时主按钮禁用，取消触发原生取消调用，三种状态的 commit 调用均为 0。

## RC-PLAYTEST-002 — 新建存档未直接进入世界构筑

### 根因

存档首页的创建处理只执行 `create()` 后刷新列表，没有根据新 Campaign 的权威状态导航。React 的 disabled 状态又只能在一次渲染后生效，同一事件循环内的快速双击可能在首个创建完成前再次调用 `campaign_create`。截图中的八个 `CREATING_WORLD` 记录按现有合同都是可继续的有效草稿；仅凭截图不能证明它们是无效幽灵数据，因此本轮不自动删除或隐藏任何用户存档。

### 修复

- `campaign_create` 成功后立即把返回的权威 Campaign 交给 `destinationForCampaign`，`CREATING_WORLD` 直接进入 `#/world?campaignId=...`。
- 增加同步 `busyIdRef` 防重入；它在 React 下一次渲染前也能挡住第二次调用，同时保留按钮 disabled 与“正在落笔…”反馈。
- 现有继续、归档、删除、导入和恢复流程保持不变；已有创建中存档仍可正常继续。

### 回归证明

- React 回归覆盖直接导航、同步双击只创建一次，以及既有归档行为。
- 真实 Chromium 同一 tick 连续触发两次新建按钮，`campaign_create=1`；随后 URL 为 `#/world?campaignId=rc-browser-campaign-0001`，`world_creation_get=1`，页面显示“第 01 步 · 世界构筑 / 给炉火一张地图”。

## 门禁与数据完整性

- `pnpm install --frozen-lockfile`：PASS，无依赖变更。
- `pnpm check`：PASS；Vitest 189 files / 1063 tests，另 2 files / 6 tests 按合同 skip；Node 30/30；Rust workspace 150 tests PASS，另 1 个真实 DeepSeek Credential 测试 ignored；格式、release metadata、zh-CN、ESLint、TypeScript、rustfmt、严格 Clippy、archive interop 全绿。
- `pnpm test:windows-e2e`：1/1 PASS；另用显式路径重新运行并保留本轮 SQLite/portable archive。
- `pnpm build:desktop`：PASS，Vite 281 modules。
- `pnpm --dir windows-app tauri build --bundles app`：PASS；`Ember Tavern.app` 的产品、identifier、可执行文件和 0.3.0 版本正确，链接系统 WebKit。当前产物为未授权的 ad-hoc 签名，本轮不把它写成公开发布产物。
- npm audit：0 advisories；RustSec：0 vulnerabilities。既有 Linux-only 维护/unsound informational warnings 仍按 DEC-157 边界披露，不属于本轮两个实测问题。
- Chromium：860×600、1366×768、1920×1080 均无横向溢出，console error 0；首个键盘焦点有 2px 可见 outline。
- 本轮 4 个 SQLite（主库加 3 个自动完整备份）全部 `integrity_check=ok`、外键违规 0、重复 idempotency/request/world 0、孤儿 world 0。活动主库未完成请求 0；一个不可变恢复前备份按设计保留 `SENDING` 请求和 `RECOVERY_REQUIRED → TAVERN` 恢复点，活动主库已恢复并为 `TAVERN`，这不是残留活动请求。

## 剩余边界

- 没有读取真实 Credential，也没有调用真实计费模型；真实 Provider 的叙事质量、网络 SLA、token 和计费 cache 仍为 `NOT_EVALUATED`。
- 当前 macOS 主机不能替代 Windows NSIS/Credential Manager/WebView2 安装生命周期；未执行签名、notarization 或发布。
- 因此本报告只给出两个 RC 实测问题的 `FIXED`，不宣称 `PUBLIC RELEASE READY`。
