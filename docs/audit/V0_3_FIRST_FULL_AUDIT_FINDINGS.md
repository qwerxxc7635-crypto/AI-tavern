# Ember Tavern V0.3 第一轮完整审计 Findings Ledger

状态：M12-T01 COMPLETE（审计冻结，尚未执行 M12-T02 修复）

审计基线：`d41e99b35e7efb9d47f2a500b236ff3251d68b07`

审计日期：2026-08-27

范围：Architecture、Code、Security、Credential、Provider、AI、Rules、SQLite、Save/Migration、Performance/Cache、UI/UX/A11y、Regression、Playability

本文件在任何 M12 修复之前建立。它不采信 `docs/TASKS.md` 的 DONE 标签，而是重新检查源码、合同、测试、真实浏览器页面和可复算证据。M12-T02 可以更新 finding 状态，但不得删除原始触发条件和证据。

## 1. 结论摘要

- 开放 P0：0
- 开放 P1：0
- 开放 P2：4
- 开放 P3：2
- 外部限制 / `NOT_EVALUATED`：2
- 第一轮结论：核心数据、规则、存档和安全边界没有发现阻断级回归，但依赖、CI 供应链、发布身份与本地会话导航仍需在 M12-T02 处理；当前不能进入最终发布结论。

| ID | 类别 | 优先级 | 状态 | 摘要 |
| --- | --- | --- | --- | --- |
| M12-AUD-001 | UI/UX / Navigation | P2 | OPEN | 无 Campaign 的“我的/设置”导航会指向错误或无效目标 |
| M12-AUD-002 | Security / Dependency | P2 | OPEN | Windows 前端直接锁定 Vite 7.2.4，开发服务器命中 5 条已修复公告 |
| M12-AUD-003 | Code / Test Tooling | P3 | OPEN | Vitest 与传递开发工具依赖命中 3 条公告，但默认门禁不暴露 Vitest UI/API |
| M12-AUD-004 | Security / CI Supply Chain | P2 | OPEN | 5 个唯一 GitHub Action 使用可移动 tag，发布 artifact 存在上游接管投毒路径 |
| M12-AUD-005 | Release / Regression | P2 | OPEN | V0.3 实现仍由所有发布元数据标识为 0.2.0 |
| M12-AUD-006 | Dependency Maintenance | P3 | OPEN | Rust 锁文件保留 Linux GTK3 旧依赖维护/unsound 警告 |

## 2. Findings

### M12-AUD-001 — 无 Campaign 的本地会话导航目标错误

- 优先级：P2
- 状态：OPEN
- 类别：UI/UX、Accessibility、Regression
- 触发条件：直接打开 `#/settings` 或 `#/my`，当前 URL 不含 `campaignId`。
- 证据：`windows-app/src/routes.tsx:255-273` 的 `withCampaign()` 在没有 Campaign 时统一退回 `/saves`，所以设置页面包屑中标为“我的”的链接实际进入存档首页。设备级 `/my` 页面侧栏仍暴露酒馆、任务、冒险、角色和档案直达项，点击后进入缺少存档信息的 route guard。
- 浏览器复现：[`finding-nav-before.png`](evidence/v0.3-first-audit/browser/finding-nav-before.png) → [`finding-nav-after.png`](evidence/v0.3-first-audit/browser/finding-nav-after.png)；[`finding-local-nav-before.png`](evidence/v0.3-first-audit/browser/finding-local-nav-before.png) → [`finding-local-nav-after.png`](evidence/v0.3-first-audit/browser/finding-local-nav-after.png)。
- 影响：不破坏数据，但标签与目的地不一致，并让设备级页面暴露不可完成的 Campaign 导航路径；键盘用户也会得到同一错误目的地。
- 建议：设置页“我的”面包屑在无 Campaign 时固定指向 `/my`；设备级页面的 Campaign 导航应回到存档选择、禁用并解释，或使用经过验证的最近 Campaign。增加无 Campaign 的点击级路由回归。

### M12-AUD-002 — Vite 7.2.4 开发服务器公告未修复

- 优先级：P2
- 状态：OPEN
- 类别：Security、Dependency、Developer Environment
- 证据：`windows-app/package.json:29-31` 声明 Vite `^7.2.4`，锁文件解析为 7.2.4。`pnpm audit --registry=https://registry.npmjs.org` 命中 GHSA-4w7w-66w2-5vf9、GHSA-v2wj-q39q-566r、GHSA-p9ff-h696-f583、GHSA-v6wh-96g9-6wx3、GHSA-fx2h-pf6j-xcff；最高修复下限为 7.3.5。
- 暴露边界：Vite 是 devDependency，生产 Tauri 使用预构建 `dist`；本仓库开发 URL 绑定 `127.0.0.1:1420`，所以不是生产 WebView 漏洞。风险集中在 Windows/macOS 开发机上运行受攻击页面或恶意请求时的文件读取、deny 绕过和 Windows UNC/NTLM 行为。
- 影响：开发机本地文件和 Windows 凭据材料可能在特定开发服务器攻击条件下暴露；不直接改变游戏存档。
- 建议：升级直接 Vite 及 plugin-react 解析图到 Vite `>=7.3.5`，冻结锁文件并复跑前端、浏览器和桌面构建门禁。

### M12-AUD-003 — Vitest 与传递开发工具依赖公告

- 优先级：P3
- 状态：OPEN
- 类别：Code、Security、Test Tooling
- 证据：`package.json:39` 和锁文件使用 Vitest 4.0.18，命中 GHSA-5xrq-8626-4rwp；传递的 `nanoid` 3.3.16 命中 GHSA-2v37-7h3g-55p8，ESLint 路径的 `brace-expansion` 5.0.8 命中 GHSA-rgw5-rvv9-x895。
- 暴露边界：仓库脚本只执行 `vitest run`，没有安装 `@vitest/ui`，也没有启动 Vitest UI/API server；Vitest 自身传递的 Vite 已是 7.3.6。`nanoid` 与 `brace-expansion` 均位于开发/测试工具路径。独立复核据此否定“生产 critical RCE”的表述，但版本债务仍真实存在。
- 影响：正常发布运行时不可达；在额外开启测试 UI 或让不受信任输入进入开发工具时扩大风险。
- 建议：升级 Vitest 到 `>=4.1.0`，刷新 `nanoid`、ESLint/minimatch/brace-expansion 的锁文件解析，并保留非交互 `vitest run` 门禁。

### M12-AUD-004 — CI Action 使用可移动 tag

- 优先级：P2
- 状态：OPEN
- 类别：Security、CI Supply Chain、Release Evidence
- 证据：`.github/workflows/ci.yml` 的 14 个 `uses:` 归并为 5 个可移动引用：`actions/checkout@v4`、`pnpm/action-setup@v4`、`actions/setup-node@v4`、`dtolnay/rust-toolchain@stable`、`actions/upload-artifact@v4`；checkout 未设置 `persist-credentials: false`。
- 独立复核：workflow 只由 `push`/`pull_request` 触发，权限为 `contents: read`，没有 secrets、OIDC、write 权限、自动签名或发布，因此不能评为 P0/P1。但上游 Action tag 被接管后，可修改同一 job 的构建输入并让 Windows NSIS/macOS `.app` 作为正常 artifact 上传；项目历史确实会人工消费这些产物。
- 影响：无法写回仓库，但可伪造门禁或投毒可执行 artifact，破坏发布证据可信度。
- 建议：把 5 个唯一 Action 固定到完整 40 字符 commit SHA并旁注版本；checkout 设置 `persist-credentials: false`；`dtolnay/rust-toolchain` 固定 Action SHA后显式配置 `toolchain: stable`。可用 Dependabot 维护 SHA 更新。

### M12-AUD-005 — V0.3 发布身份仍为 0.2.0

- 优先级：P2
- 状态：OPEN
- 类别：Release、Code、Regression、Documentation
- 证据：`package.json:3`、`windows-app/package.json:3`、`Cargo.toml:6`、`windows-app/src-tauri/tauri.conf.json:4`、`release-info.json:3` 均为 `0.2.0`；`CHANGELOG.md:7` 仍是 `[0.2.0] - 未发布`，README 仍称 V0.3 处于设计冻结与参考审计阶段。
- 边界：`pnpm release:check` 通过，只证明多个 0.2.0 镜像彼此同步，不能证明它们是当前 V0.3 候选的正确发布身份。
- 影响：若直接构建，安装器、应用版本、运行时展示与审计目标错标为 V0.2，证据无法作为 V0.3 发布候选使用。
- 建议：M12-T02 统一把发布权威和镜像推进到 0.3.0，更新 changelog/README，再由 M12-T03 生成绑定新 commit 的平台产物。

### M12-AUD-006 — Linux GTK3 传递依赖维护与 unsound 警告

- 优先级：P3
- 状态：OPEN
- 类别：Dependency Maintenance、Security
- 证据：本地安装的 `cargo-audit 0.22.2` 使用 2026-08-27 RustSec 数据库审计 499 个锁定依赖：可利用 vulnerability 为 0，但报告 16 项 unmaintained 和 1 项 unsound。后者是 `glib 0.18.5` 的 RUSTSEC-2024-0429，限定于 `VariantStrIter` 的五个迭代方法；其余主要是 GTK3、旧 `unic-*` 与 `proc-macro-error` 维护警告。
- 暴露边界：这些包来自 Tauri 的 Linux GTK/WebKit 条件依赖，不在当前 Windows 优先或已验证 macOS 构建图中；代码扫描也未发现项目调用受影响的 `VariantStrIter`。因此不将它们误报为 Windows/macOS 发布漏洞。
- 影响：当前目标平台没有已证实运行时影响；若未来恢复 Linux 发布，旧 GTK3 图会成为维护和潜在稳定性风险。
- 建议：在依赖升级任务中评估 Tauri/Wry 可达的新依赖图；M12-T02 至少记录目标平台裁决，并为未来 Linux 发布建立 target-specific RustSec gate。

## 3. 分领域审计结果

| 领域 | 结果 | 重新核对的证据 |
| --- | --- | --- |
| Architecture | PASS | 分层仍为 contracts/domain/ai/persistence/application/native/UI；UI 不直接访问 SQL、Keyring 或 Provider；高层 Tauri command 继续守住事务边界。 |
| Code | PASS_WITH_FINDINGS | 无生产 TODO/FIXME/HACK、`any`、`eval`、`innerHTML` 或 console 泄漏；全量 lint/typecheck/Clippy 通过。工具依赖见 003。 |
| Security | PASS_WITH_FINDINGS | CSP、最小 capability、禁 unsafe、端点解析后固定、禁 redirect、限时/限响应均保持；依赖与 CI 见 002–004、006。 |
| Credential | PASS | API Key 只进入 OS Keyring；UI/SQLite/存档只见 opaque CredentialRef；当前与 git 历史扫描只命中故意的假秘密测试夹具。 |
| Provider | PASS_WITH_LIMIT | DeepSeek、Qwen、OpenRouter、Ollama、Custom 统一合同测试通过。官方 DeepSeek、阿里云百炼和 OpenRouter 文档重新确认当前 endpoint/model/API；Qwen 3.7 Max 已列入旧版但仍受支持。真实 Provider 运行见外部限制。 |
| AI | PASS | 结构化 schema、输出验证、Generator/Queue、stream/cancel/retry、统一错误、Context/Memory 和 AI patch 权限均有 TS/Rust 回归；AI 不能直接写游戏状态。 |
| Rules | PASS | D20 硬结果先于叙事、modifier 只取合法状态/Trait/已装备物品、经济/时间/Quest/event 原子与幂等回归通过。 |
| SQLite | PASS | 32 个 migration、foreign key、integrity、`BEGIN IMMEDIATE`、并发与失败回滚、事实唯一来源均有动态测试。 |
| Save/Migration | PASS | 备份保留、失败不改原文件、未来 schema 拒绝、secret/resource limit、TS↔Rust archive interop 均通过。 |
| Performance/Cache | PASS_WITH_LIMIT | Fake gate PASS：SQLite 541.582 bytes/turn、Context 100→1000 回合 377→383 tokens、增长 1.016、Queue P95 5ms；真实 token/cache 保持 NOT_EVALUATED。 |
| UI/UX/A11y | PASS_WITH_FINDING | 12 个核心页面族和错误/loading/empty/selected/streaming 合同复核；四视口无横向溢出；token 唯一来源、共享 primitive/game component、对比度、焦点、forced-colors/reduced-motion 静态门通过。导航见 001。 |
| Regression | PASS_WITH_FINDINGS | `pnpm check`、Windows E2E、desktop build 和性能门通过；版本身份见 005。 |
| Playability | PASS_WITH_LIMIT | M11 四组 evidence 重新哈希/复算：104 项行为、开放历史 finding 0、8.8/10 MEDIUM；全部是 Fake Provider，真实文风/网络不在评分内。 |

Provider 的外部时效性核对只采用一手文档：DeepSeek [API Docs](https://api-docs.deepseek.com/)、阿里云百炼[文本生成模型清单](https://help.aliyun.com/zh/model-studio/text-generation-model)和 OpenRouter [List available models](https://openrouter.ai/docs/api-reference/list-available-models)。这是 2026-08-27 的配置兼容性复核，不是一次真实生成或服务可用性承诺。

## 4. UI / UX / Accessibility 逐页复核

视觉方向保持“黑暗奇幻酒馆 × TRPG 冒险手册 × 现代桌面游戏 HUD”，AI 被呈现为命运/世界生成系统；没有退化为 ChatGPT Clone、SaaS Dashboard、大金边或巨大圆角堆叠。

| 页面族 | 浏览器/测试状态 | 结论 |
| --- | --- | --- |
| Saves / Recovery | native-unavailable error、loading、恢复合同 | PASS |
| World / Character Create | loading、native error、生成/锁定/undo 测试 | PASS |
| Tavern / NPC | loading、卡片/选中、对话/建议/stream/retry 测试 | PASS |
| Quest / Adventure / D20 | loading/error、Paper、selected、硬结果、skip/reduced-motion 测试 | PASS |
| Character / Archives | loading、角色卡与结算档案测试 | PASS |
| My / Settings | 完整设备级内容与 Provider 表单；本地导航见 001 | PASS_WITH_FINDING |
| Unknown / route guard | fallback、可见焦点、返回目标 | PASS |

M10-T07 既定四视口已重新渲染：860×600 Settings、1180×760 My、1366×768 Saves、1920×1080 Unknown/focus；`document.scrollWidth === innerWidth`，横向溢出均为 0。审计另保存 1180×760 的 12 页面族代表状态和 finding 前后图，均人工查看且 console error 为 0。浏览器 CDP 不允许本轮动态改写 reduced-motion；因此该项由生产 CSS 静态检查、`d20-animation.test.tsx`、`visual-convergence.test.ts` 和 M10-T07 已提交真实浏览器证据交叉证明，并明确记录这一工具限制。

样式重新扫描结果：raw color/rgb 仍只存在于 `design-tokens.css`；其他应用 CSS 不直接读取 primitive `--et-*`；无 `transition: all`。唯一 inline style 是 NPC 关系条的运行时百分比宽度；`.workspace__main` 的 `outline: none` 只用于程序化主内容焦点，交互控件与 skip link 仍有 2px 可见焦点环。视觉审查评级：B+；扣分来自导航上下文，不来自视觉体系分裂。

## 5. 门禁与可复算证据

- `pnpm check`：PASS。Prettier、release sync、zh-CN、ESLint、TypeScript；Vitest 189 files / 1052 tests PASS，另 2 files / 6 tests 设计性 skip；Node 29/29；Rust 150/150，另 1 项需显式 API Key 的真实 DeepSeek 测试 ignored；rustfmt、严格 Clippy、archive interop PASS。
- `pnpm test:windows-e2e`：1/1 PASS。
- `pnpm build:desktop`：PASS，Vite 281 modules。
- `pnpm performance:gate --output-dir docs/audit/evidence/v0.3-first-audit/performance`：PASS。
- `pnpm playtest:report`：3/3 PASS，重新复算 M11 证据。
- `pnpm audit --registry=https://registry.npmjs.org`：8 条开发工具公告，裁决见 002/003。
- `cargo-audit 0.22.2 audit --json`：0 vulnerability；16 unmaintained、1 unsound informational warning，裁决见 006。
- 视觉与 finding 截图：[`browser/`](evidence/v0.3-first-audit/browser/)。性能 JSON/Markdown：[`performance/`](evidence/v0.3-first-audit/performance/)。文件哈希：[`SHA256SUMS`](evidence/v0.3-first-audit/SHA256SUMS)。

## 6. 外部限制与未评价项

1. **Windows release lifecycle — BLOCKED_EXTERNAL / NOT_RUN**：当前主机是 macOS，不能为审计基线 commit 重新证明 NSIS 安装、Credential Manager、WebView2 bootstrap、启动和卸载。旧 V0.2 CI 证据不能冒充 V0.3；必须在 M12-T03 由 Windows runner 生成绑定最终 commit 的新证据。
2. **Real Provider — NOT_EVALUATED**：本轮没有用户授权的真实 API Key，也未读取 OS 凭据或调用计费模型。真实叙事质量、网络延迟、token 成本与 Provider 计费缓存命中率保持未知；Fake Provider 结果不得替代。

## 7. M12-T02 修复顺序

按风险与依赖执行：

1. 修复 M12-AUD-001 并增加点击级路由回归。
2. 升级 Vite/Vitest 与传递开发依赖，复跑全门禁和浏览器矩阵。
3. 固定 CI Action SHA、关闭 checkout 凭据持久化，并用 workflow 测试锁定。
4. 统一 0.3.0 发布身份、README 与 changelog。
5. 对 Rust Linux 条件依赖作目标平台裁决或升级；不得为了清理告警破坏 Windows/macOS 主链。

M12-T01 不实施以上修复，也不提前进入 M12-T03。所有修复必须保留数据合同、SQLite、Rules/D20、Provider、Generation Queue、存档兼容性与已验证状态机。
