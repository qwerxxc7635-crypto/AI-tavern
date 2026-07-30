# Ember Tavern 上下文交接

## 当前状态

- 分支：`main`
- 最近完成任务：`M2-T05 实现酒馆、NPC和关系Repository`
- 已完成里程碑：M0、M1；M2已完成 `M2-T01` 至 `M2-T05`
- 当前任务：`M2-T05` 已验收，准备提交
- 下一任务：`M2-T06 实现任务、冒险与对话Repository`

## 架构摘要

- SQLite是游戏事实唯一来源；已实现Campaign、世界、角色、酒馆、NPC、知识、关系和记忆持久化。
- 酒馆老板生成环为父行→NPC→绑定老板；常驻和访客列表从NPC表派生。
- JSON从unknown逐字段验证；多个NPC知识和记忆经真实SQLite证明隔离。
- 共享Repository依赖最小SQLite端口；API Key不入库。

## 最近成功验证

- `pnpm check`：通过；Vitest 105项、Node迁移3项通过。
- TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和workspace test通过。

## 恢复步骤

1. 完整读取规则、规格、任务、日志、决策、README、`LOG.md`、本文件和 `docs/data-model.md`。
2. 检查Git并设置`.local/`环境变量。
3. 完成并提交当前 `M2-T05` 变更。
4. 从 `M2-T06` 实现Quest、Adventure、Turn、Conversation、Message、Item、Clock持久化，重点验证完整冒险回合关闭应用后恢复。
