# AI Pipeline

## 单一执行路径

```text
UI intent
-> application command
-> authorize and load aggregate revision
-> create AiOperation
-> assemble ContextBlocks
-> resolve and freeze model config
-> route provider
-> execute through secure provider port
-> parse and schema-validate
-> apply task-specific domain policy
-> persist candidate or narrative projection
-> user/system acceptance
-> revalidate expected revision
-> atomic domain transaction + Event Ledger
```

## Orchestrator 状态机

```text
created -> assembling -> ready -> executing -> validating -> proposed
       \-> failed       \-> cancelled       \-> failed
proposed -> accepted | rejected | superseded
```

只有 `accepted` 能触发游戏状态事务。`cancelled`/`failed` 可以创建新 operation 重试，但不能复用旧 provider response 冒充新结果。

## 执行规则

1. Application 验证调用权限和 `expected_revision`。
2. Context Assembler 只读 repositories，输出块、预算决策与 manifest；不返回裸数据库对象。
3. Router 只相信本地登记的 capability；缺能力显式失败或按任务允许的策略降级。
4. Provider adapter 不理解游戏规则，只处理协议、超时、网络和响应归一化。
5. Schema validator 先做结构校验；domain policy 再做作者权、知识、数值和状态合法性校验。
6. 结构修复最多一次，使用同一 frozen config，并分别保留审计记录。
7. 日志只记录 operation、fingerprint、耗时、token/cache 指标和错误分类，不记录 secret 或默认完整 prompt。

## 当前统一执行信封

`AITaskOrchestrator` 是应用层唯一的 Provider 生成入口。每次调用必须同时携带 `taskType`、`requestId`、`operationId`、Campaign/Actor 身份和不可变 route；route 显式标记 `PRIMARY`、`RETRY`、`FALLBACK` 或 `REPAIR` 及 attempt、Provider 配置、模型档案和模型名。执行前拒绝 request/route 漂移，执行后拒绝响应身份和 token usage 不一致。

现有八类应用生成流程均已迁移至该入口；普通一次性生成从 request ID 派生稳定 operation ID，回合、恢复和结构修复流程传入其显式 operation/route。Orchestrator 只统一执行边界，不替 Router 自动决定重试或降级；相关策略仍由 Application 明确发起，避免隐式切换 Provider 或模型。

## 三类输出

- **Hard Logic**：完全本地计算，模型无权覆盖，例如 D20、修正值、状态转移和权限。
- **Structured Decision Support**：模型给出候选结构；本地 schema/domain 校验后由用户或策略接受。
- **Narrative**：模型只能叙述已提交事实，并受玩家作者权和知识边界约束。

## 失败语义

稳定类别包括：`configuration`、`credential`、`capability`、`network_policy`、`timeout`、`provider`、`schema`、`domain_policy`、`stale_revision`、`cancelled`。错误在 native/application/SQLite/UI 间不得改义。
