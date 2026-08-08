# v0.2 Architecture Gate Review

评审日期：2026-08-08。结论：**PASS FOR IMPLEMENTATION**。该结论批准按 `docs/TASKS_V0.2.md` 实现，不代表任务已完成；任何实现若违反下列证明，Gate 自动失效。

| Gate 问题 | 证明/约束 | 结论 |
|---|---|---|
| UI 是否无 Provider 直连？ | UI 只发 application command；provider port 仅由 orchestrator 使用，静态依赖测试禁止 UI 导入 adapter/provider。 | PASS |
| Domain 是否不依赖平台？ | 平台能力均由六个 ports 表达；domain crate/package 不允许 Tauri、OS API 或绝对路径。 | PASS |
| AI 是否不能直接写状态？ | response 先 schema/domain 校验并落 candidate；只有接受命令能在 revision-guarded 事务写状态。 | PASS |
| Context 是否统一？ | 所有任务只消费 `ContextBlock[] + ContextManifest`；preview 与发送共享同一 assembler。 | PASS |
| Hard Logic 是否本地？ | D20、修正、合法性、作者权、知识可见性、事务和秘密处理明确归本地。 | PASS |
| Provider config 是否 frozen？ | `ConnectionProfile -> ResolvedModelConfig -> ProviderRequest` 单向投影；operation 记录 fingerprint。 | PASS |
| Knowledge 是否与 truth 分离？ | 四类模型和合法流向已定义；provenance 是 Knowledge 必填语义。 | PASS |
| 状态是否可恢复并防重放？ | SQLite 聚合 + 最小 ledger + operation id + revision + SceneFrame。 | PASS |
| 双平台是否通过 adapters 实现？ | Windows/macOS 只实现 ports；测试路径可注入；iOS 不在范围。 | PASS |
| 是否避免过度扩大 scope？ | 明确延期完整事件溯源、插件市场、MultiChat、World Voices、iOS 与 macOS 正式发行。 | PASS |

## Gate 后的强制实施顺序

1. 完成 `V02-M0-T02/T03` 的平台路径与共享脚本。
2. 按 SR2 顺序完成 M1，安全问题未关闭前不进入功能扩展。
3. M2 建立 orchestrator、context、frozen config、candidate 与 ledger。
4. M3～M8 在上述基础上做纵向功能；M9/M10 只接受真实双平台证据。

## 自动否决条件

发现 UI 直接网络调用、secret 进入日志/存档、AI response 直接更新状态、业务层硬编码平台路径、模型决定骰点、用 Markdown/YAML 替代 SQLite 或新增 iOS 生产开发时，必须停止相关实现并修复架构偏离。
