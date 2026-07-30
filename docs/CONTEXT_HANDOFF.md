# Ember Tavern 上下文交接

## 当前状态

- 分支：`main`
- 最近完成任务：`M2-T06 实现任务、冒险与对话Repository`
- 已完成里程碑：M0、M1；M2已完成 `M2-T01` 至 `M2-T06`
- 当前任务：`M2-T06` 已验收，准备提交
- 下一任务：`M2-T07 实现GameEvent Repository`

## 架构摘要

- SQLite是游戏事实唯一来源；主要游戏实体Repository已完成。
- 完整AdventureTurn、消息、物品和世界时钟可从重开数据库恢复。
- JSON从unknown逐字段验证；共享Repository依赖最小SQLite端口。
- 尚未实现事件、AI生命周期和快照Repository。

## 最近成功验证

- 关闭并重开SQLite后完整冒险回合及相关聚合精确恢复。
- `pnpm check`：通过；Vitest 108项、Node迁移3项通过。
- TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和workspace test通过。

## 恢复步骤

1. 完整读取规则、规格、任务、日志、决策、README、`LOG.md`、本文件和 `docs/data-model.md`。
2. 检查Git并设置`.local/`环境变量。
3. 完成并提交当前 `M2-T06` 变更。
4. 从 `M2-T07` 实现GameEvent追加和按时间读取，验证历史事件不可覆盖。
