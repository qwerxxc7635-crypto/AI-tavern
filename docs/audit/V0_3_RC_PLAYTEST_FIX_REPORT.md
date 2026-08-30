# Ember Tavern V0.3 RC 实测问题修复报告

- 结论：`FIXED — READY FOR RC REVALIDATION`
- 基线：`00fc1adb2d3ffc9c290d52a108b122e080c074f6`
- 分支：`fix/v0.3-rc-playtest-issues`
- 问题一、二实现提交：`760b5a24c7c806e8f30eb49c4251f8c1ae6cc62b`
- 问题三首轮实现提交：`1c5f164951ca4671393784beb16dcabfb43ba427`
- 追加诊断基线：`1934053`
- 原始修复证据：[`evidence/v0.3-rc-playtest-fix-00fc1ad/`](evidence/v0.3-rc-playtest-fix-00fc1ad/)
- 追加真实链路证据：[`evidence/v0.3-rc-playtest-real-provider-1934053/`](evidence/v0.3-rc-playtest-real-provider-1934053/)
- 职业池 TIMEOUT 追加证据：[`evidence/v0.3-rc-profession-timeout-914165e/`](evidence/v0.3-rc-profession-timeout-914165e/)

本轮只处理三个 RC 实测阻塞项。凭据只通过 OS Credential Store opaque reference 使用；没有读取或记录 API Key、Authorization、用户故事或用户存档内容。所有真实生成都使用隔离 SQLite。没有修改用户 `.gitignore`，没有覆盖第二轮审计证据，没有 push、merge、签名、notarize 或发布。

世界问题的 A–D 差分与三世界验收保持原证据。职业池追加诊断使用权威职业 Prompt/Schema 和三份隔离 SQLite；失败、截断与取消响应均 fail closed，没有保存模型正文到开发证据。

## RC-PLAYTEST-001 — 世界生成 `TIMEOUT`

- 严重度：P1 / RC blocker。
- 复现结果：原截图与旧隔离验证均可复现超时。追加差分中 `/models` 167ms 成功并找到 `deepseek-v4-flash`；最小 JSON 在 thinking disabled/default 下分别 800ms/1155ms 完成，排除认证、模型不存在、DNS/连接和 JSON mode 整体不可用。
- 根因：世界根因保持不变。追加职业池证据确认同源任务配置漂移：`GENERATE_CAREER_POOL` 只有 12s Queue 整体时限，同一权威 Prompt 在 non-thinking 下就需 13.691s；Queue `AbortSignal` 没有传入 Provider，页面超时后请求可继续后台运行；DeepSeek non-thinking 只适用世界任务；commit 位于去重 Queue 外。传输层另把持续分块响应也绑在同一绝对 deadline。
- 修改文件：`crates/provider-openai-compatible/src/lib.rs`、`windows-app/src-tauri/src/lib.rs`、`windows-app/src/world-creation-service.ts` 及对应测试；原 Queue/取消修复文件保持不变。
- 修复机制：DeepSeek non-thinking 策略统一覆盖世界、职业、特质、角色与一致性修复等严格结构任务，叙事/推理任务保留 Provider default。职业池使用 4096 token、60s Provider 无进度时限和 150s operation 总时限，为初始+一次 repair 留出独立 HTTP 预算。Queue 信号贯穿 Provider/HTTP，准备和 commit 均在同一 intent 去重区内。传输 timeout 改为首包/无进度计时，每个合法 chunk 重置，同时保留 300s 安全总上限。
- 追加真实验证：PASS。两个不同世界配置的职业池分别 20.468s / 14.553s 完成，token 1510→1731 / 1394→1596。既有 Campaign 显式重试先证明旧 12s 操作取消，再以 2048 token 复现 `LENGTH` 并 fail closed，校准到 4096 后 33.616s、2333→3071 token、`STOP`，完整通过 JSON/TS Schema/业务/Rust transaction。
- SQLite：三份隔离库均 `integrity_check=ok`、外键违规 0、unfinished 0；每个目标 Campaign 只有 1 个职业池、4 个职业和 1 条 generation record，幂等重放不增写。
- 回归测试：默认请求不携带 thinking 扩展；DeepSeek 世界/重绘精确携带 disabled；最小 JSON 请求锁定 `json_object`、256 token 和显式 JSON 指令；世界服务锁定 4096/120s；既有超时、取消、重试、并发去重和单次提交测试全绿。
- 真实验证状态：PASS。三组生产世界请求均在 120s 内得到完整 `STOP`；总时延 14.209s、10.047s、45.514s，第三组 repair 20.120s。首内容分别 1.732s、1.892s、1.373s，repair 1.096s。
- SQLite：三份验收 Campaign 均为 `REVIEWING_WORLD`，world/constitution/generation record 各 3，unfinished 0，重复请求 0。
- 是否完全关闭：是。

## RC-PLAYTEST-002 — 新建存档未直接进入世界构筑

- 严重度：P1 / RC blocker。
- 复现结果：原创建处理只刷新列表；同一事件循环双击可在 React disabled 生效前重复调用。
- 根因：成功后未按新 Campaign 权威状态导航，且缺少同步防重入。截图中的既有 `CREATING_WORLD` 记录不能仅凭截图判定为无效数据。
- 修改文件：保持提交 `760b5a2` 的页面、路由与测试修改，本轮未扩大范围。
- 修复机制：创建成功后直接进入 `#/world?campaignId=...`；同步 busy ref 在重渲染前阻断第二次创建；世界请求继续按 Campaign/Task 去重。
- 回归测试：直接导航、同步双击只创建一次、归档流程、TIMEOUT/INVALID_OUTPUT 后显式重试与世界构筑联动均通过。
- 真实验证状态：本地 UI/SQLite 生产路径 PASS；Provider 三组验收各使用一个独立 Campaign，没有并发或重复 save。
- SQLite：验收目标 Campaign 3、world 3；重复 Campaign ID、重复 idempotency key、重复 world 均为 0。
- 是否完全关闭：是。

## RC-PLAYTEST-003 — 真实模型输出 `INVALID_OUTPUT`

- 严重度：P1 / 世界创建核心阻断项。
- 复现结果：原截图证明 UI `INVALID_OUTPUT`，但旧失败 raw response 按安全合同未持久化，不能事后猜测原字节。追加 D 使用完整生产 Prompt/Schema 得到完整 `STOP` JSON，并复现出确定的版本漂移：TypeScript 结构验证通过，Rust commit 因 Constitution 三条跨字段规则返回 `InvalidData`。
- 根因：除首轮已修复的围栏/唯一对象、截断分类、repair 诊断和错误文案问题外，追加诊断确认：世界 Prompt 只笼统要求“互相一致”，Desktop rules-check 没有执行共享 `assertWorldConstitutionCompliance`，而 Rust 要求 `technologyLevel == constitution.technology`、`powerRules` 精确包含 `constitution.magic`、每个 taboo 精确存在于 `forbiddenElements`。这属于 TypeScript 业务验证与 Rust 权威边界漂移，不与 TIMEOUT 合并。
- 修改文件：`packages/prompts/src/task-prompts.ts`、`packages/prompts/src/prompts.test.ts`、`windows-app/src/desktop-ai-orchestrator.ts` 及测试；首轮 `output-validator`、错误 UI 与 world service 修复继续保留。
- 修复机制：Prompt 明示三条恒等关系；结构 Schema 保持严格且不把业务错误伪装成 Schema 错误；Desktop `RULES_CHECK` 调用与 application/Rust 相同的 Constitution compliance 规则，并以 `WORLD_BUSINESS_RULE_INVALID` 和脱敏字段路径 fail closed。单次 repair 仍只处理 JSON/Schema 类错误，repair 后从 parse 到 Rust commit 全量复验。
- 回归测试：裸 JSON、围栏、唯一对象、多个对象、截断、缺字段、错类型/枚举/ID、引用错误、结构 repair、repair 失败、业务规则独立分类、错误代码互不映射、无部分写入、显式重试单请求均通过。新增测试锁定 Constitution 漂移为 business rule 而非 Schema，并确认不触发结构 repair。
- 真实验证状态：PASS。三组不同选项都使用真实 DeepSeek/`deepseek-v4-flash`、生产 Prompt、`JSON_OBJECT`、streaming、4096 token 与隔离存档。前两组首次通过；第三组首次在 `locations[5].factionNames[1]` 被严格 Schema 拒绝，唯一一次 repair 使用独立 120s deadline，返回完整 `STOP` 后重新通过 JSON、Schema、business、Rust validation 与 transaction commit。
- 指标：三组初始 input/output token 为 1584/1328、1588/915、1589/3492；第三组 repair 为 5192/3487。Provider request ID 均存在；当前响应未提供可记录的 cache hit/miss，标为 unavailable。
- SQLite：`integrity_check=ok`，foreign key violation 0，unfinished 0，部分 world 0，重复 request/save/world 0；三组均只提交一次。用户数据库未被打开或修改。
- 是否完全关闭：是。

## 完整门禁

- `pnpm check`：PASS；Vitest 189 files / 1091 tests，另 2 files / 6 tests 按合同 skip；Node 30/30；Rust native 101、platform 5、provider 19、HTTP 12、secrets 3、Tauri 13 全部通过，1 个环境变量式真实 DeepSeek 单测按合同 ignored；格式、release metadata、zh-CN、ESLint、TypeScript、rustfmt、严格 Clippy、archive interop 全绿。
- `pnpm test:windows-e2e`：1/1 PASS。
- `pnpm build:desktop`：PASS，Vite 281 modules。
- `pnpm --dir windows-app tauri build --bundles app`：PASS；标准 `Ember Tavern.app` 在移除临时诊断入口后重新构建。
- `git diff --check`：PASS；用户 `.gitignore` 修改保持未暂存。

## 最终状态

三个 RC 实测问题均有独立根因、回归、真实链路与 SQLite 证据，当前均完全关闭。结论为：`FIXED — READY FOR RC REVALIDATION`。该结论只批准下一轮 RC 复验，不构成公开发布批准。
