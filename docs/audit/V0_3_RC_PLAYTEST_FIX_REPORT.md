# Ember Tavern V0.3 RC 实测问题修复报告

- 结论：`BLOCKED_EXTERNAL`
- 基线：`00fc1adb2d3ffc9c290d52a108b122e080c074f6`
- 分支：`fix/v0.3-rc-playtest-issues`
- 问题一、二实现提交：`760b5a24c7c806e8f30eb49c4251f8c1ae6cc62b`
- 问题三实现提交：`1c5f164951ca4671393784beb16dcabfb43ba427`
- 输入证据：用户提供的 `12.docx` 与四张实测图，冻结于 [`evidence/v0.3-rc-playtest-fix-00fc1ad/source/`](evidence/v0.3-rc-playtest-fix-00fc1ad/source/)
- 修复证据：[`evidence/v0.3-rc-playtest-fix-00fc1ad/`](evidence/v0.3-rc-playtest-fix-00fc1ad/)

本轮只处理三个 RC 实测阻塞项。没有删除用户存档，没有修改 SQLite schema、Save 格式、Rules/D20、Quest/NPC/Adventure 业务合同，没有读取或打印 API Key，没有签名、notarize、发布、push 或 merge。

## RC-PLAYTEST-001 — 世界生成 `TIMEOUT`

- 严重度：P1 / RC blocker
- 复现：用户截图可复现错误呈现；隔离真实生产链路的三次新世界生成均在 Provider 阶段以 `TIMEOUT` 结束。
- 根因：旧世界构筑绕过 `GenerationQueue`，最大 8,000 输出 token 的任务又被约 60 秒单一传输时限覆盖；同一 Campaign 也没有统一意图键去重。
- 修复机制：DNS 10 秒、连接 15 秒、Provider 120 秒、世界操作 270 秒分层有界；世界生成进入单并发 Queue，按 Campaign/Task 去重；`AbortSignal` 贯穿 UI 到原生 HTTP；队列等待不消耗 Provider 执行预算。
- 回归：60,001 ms 合法响应、永久挂起、TIMEOUT 后重试、同意图并发、AUTH 分类、取消和零部分写入均通过。
- 真实验证：`BLOCKED_EXTERNAL`。三个不同选项组合都通过真实 DeepSeek/`deepseek-v4-flash`、OS Credential Store opaque reference 和生产链路发起，但都在返回完整响应前超时；不能验证 finish reason、JSON、Schema、业务校验或 commit。
- SQLite：隔离库 3 个 `CREATING_WORLD` Campaign、0 world、0 generation record、0 unfinished、0 重复；用户主库前后完全一致。
- 是否完全关闭：否。代码缺陷已修复并通过门禁，但当前真实 Provider 仍连续超时，需外部 Provider/网络可用时重验。

## RC-PLAYTEST-002 — 新建存档未直接进入世界构筑

- 严重度：P1 / RC blocker
- 复现：原创建处理只刷新列表；同一事件循环双击可以在 React disabled 生效前重复调用。
- 根因：创建成功后未按新 Campaign 的权威状态导航，且缺少同步防重入。截图中的既有 `CREATING_WORLD` 记录不能仅凭截图判定为无效幽灵数据。
- 修复机制：`campaign_create` 成功后通过 `destinationForCampaign` 直接进入 `#/world?campaignId=...`；同步 busy ref 在重渲染前阻断第二次创建。
- 回归：直接导航、同步双击只创建一次、既有归档行为和世界构筑联动均通过；Chromium 实测 `campaign_create=1`、`world_creation_get=1`。
- 真实验证：本地真实 UI/SQLite 路径通过；不依赖 Provider 成功。
- SQLite：没有删除或改写用户已有草稿；隔离验证没有重复 Campaign。
- 是否完全关闭：是。

## RC-PLAYTEST-003 — 真实模型输出 `INVALID_OUTPUT`

- 严重度：P1 / 世界创建核心阻断项
- 复现：用户截图明确显示世界构筑页、`模型输出没有通过验证` 与 `INVALID_OUTPUT`。失败响应按安全合同不写 generation record/raw response，因此原事故的具体字段和原始字节无法事后恢复；本报告不猜测它究竟是围栏、截断、Schema 还是业务规则错误。
- 根因：审计确认四个独立缺口：验证器只接受裸 `JSON.parse`，合法单层 JSON 围栏/唯一对象会被误拒；`finishReason=LENGTH` 未在 parse 前识别为截断；repair Provider 失败会丢失最初验证路径；世界构筑复用了“已锁定硬结果”的冒险阶段文案。Prompt 示例与权威 `AI_TASK_SCHEMAS` 同源，未发现 Prompt/TypeScript Schema 版本漂移；DeepSeek 当前能力为 `JSON_OBJECT` 而非严格 `JSON_SCHEMA`，因此本地完整验证仍是必须边界。Rust commit 继续复核命令 ID、validated output/world 一致性和业务规则，并在单一事务中写入。
- 修复机制：先检查 finish reason；对完整单层 JSON 围栏和短说明文字包围的唯一顶层 JSON 对象做严格、确定性规范化；多个对象直接 `AMBIGUOUS_JSON`，不猜测；随后始终运行完整 Zod Schema/业务规则。截断进入一次既有结构修复，repair 使用独立 Provider 请求预算并再次执行完整验证；仍不合法则 fail closed。错误链保留 INITIAL/REPAIR、验证 code 与脱敏字段路径；UI 分开显示 JSON 解析、Schema、响应截断、业务规则、TIMEOUT，移除不适用的硬结果文案。
- 修改文件：`packages/ai-core/src/output-validator.ts`、`application-error.ts`、`index.ts` 及测试；`windows-app/src/desktop-ai-orchestrator.ts`、`ai-error-notice.tsx`、`world-creation-service.test.ts` 及测试。
- 回归：合法 JSON 单次提交；单层围栏；唯一对象+短说明；多个对象拒绝；截断识别；缺字段、错类型、错枚举、跨引用/业务规则拒绝；repair 成功后完整复验；repair 仍失败不提交；repair TIMEOUT 保持 TIMEOUT 且 inspector 保留原字段路径；INVALID_OUTPUT 后显式重试只新建一个请求并只提交一次。Rust 既有边界测试继续覆盖非法本地 ID、envelope/output mismatch、业务规则和事务回滚。
- UI/Chromium：JSON、Schema、截断和业务规则四层文案可区分；860×600、1366×768、1920×1080 无横向溢出，console error 0，不再出现“已锁定的硬结果”。
- 真实验证：`BLOCKED_EXTERNAL`。三次真实 Provider 请求均先在 TIMEOUT 层结束，未取得可供 parse/Schema/business/commit 的完整响应；Fake/受控浏览器结果没有被写成真实 Provider 通过。
- SQLite：隔离真实验证库 `integrity_check=ok`、外键违规 0、unfinished 0、world 0、generation record 0、重复 Campaign/请求/world 0；用户主库校验前后计数一致。
- 是否完全关闭：否。代码与回归已闭合，但原事故原始响应不可恢复，且新的真实 Provider 三次均未越过 TIMEOUT，真实成功输出验收仍被外部条件阻塞。

## 完整门禁

- `pnpm check`：PASS；Vitest 189 files / 1085 tests，另 2 files / 6 tests 按合同 skip；Node 30/30；Rust workspace 全绿，真实 Credential 环境测试仍按合同 ignored；格式、release metadata、zh-CN、ESLint、TypeScript、rustfmt、严格 Clippy、archive interop 全绿。
- `pnpm test:windows-e2e`：1/1 PASS。
- `pnpm build:desktop`：PASS，Vite 281 modules。
- `pnpm --dir windows-app tauri build --bundles app`：PASS，标准 `Ember Tavern.app` 已恢复构建；未签名为公开发布产物。
- npm audit 与 RustSec vulnerability 结论沿用本轮未改依赖的已记录结果：0 advisories / 0 vulnerabilities。
- `git diff --check`：PASS；用户 `.gitignore` 修改保持未暂存。

## 最终状态

问题二完全关闭；问题一和问题三的代码缺陷与本地门禁已闭合，但三次真实 Provider 请求都在完整响应前超时。因此本轮总体状态是 `BLOCKED_EXTERNAL`，不能输出 `FIXED — READY FOR RC REVALIDATION`，更不宣称 `PUBLIC RELEASE READY`。外部条件恢复后，应在隔离存档对三个不同选项组合重新执行并记录 finish reason、parse、Schema、business、commit、重复检查与可用的 token/latency/cache 指标。
