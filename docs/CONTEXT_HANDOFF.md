# Ember Tavern 上下文交接

## 当前状态

- 分支：`main`
- 最近完成任务：`M2-T07 实现事务型回合提交`
- 已完成里程碑：M0、M1；M2已完成 `M2-T01` 至 `M2-T07`
- 当前任务：`M2-T07` 已验收，准备提交
- 下一任务：`M2-T08 实现pending_ai_requests`

## 架构摘要

- SQLite是游戏事实唯一来源；主要游戏实体Repository已完成。
- 完整AdventureTurn、消息、物品和世界时钟可从重开数据库恢复；回合状态与事件原子提交。
- JSON从unknown逐字段验证；共享Repository依赖最小SQLite端口。
- GameEvent只追加且按判别字段验证；尚未实现AI请求生命周期和快照Repository。

## 最近成功验证

- 真实SQLite事务尾部失败后，Turn、Adventure、Quest、关系和事件均无部分写入。
- `pnpm check`：通过；Vitest 110项、Node迁移3项通过。
- TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和workspace test通过。

## 恢复步骤

1. 完整读取规则、规格、任务、日志、决策、README、`LOG.md`、本文件和 `docs/data-model.md`。
2. 检查Git并设置`.local/`环境变量。
3. 完成并提交当前 `M2-T07` 变更。
4. 从 `M2-T08` 实现pending AI请求状态、错误码、重试次数和幂等键。
