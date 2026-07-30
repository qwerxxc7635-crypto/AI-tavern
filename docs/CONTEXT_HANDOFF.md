# Ember Tavern 上下文交接

## 当前状态

- 分支：`main`
- 最近完成任务：`M2-T04 实现世界与角色Repository`
- 已完成里程碑：M0、M1；M2已完成 `M2-T01` 至 `M2-T04`
- 当前任务：`M2-T04` 已验收，准备提交
- 下一任务：`M2-T05 实现酒馆、NPC和关系Repository`

## 架构摘要

- SQLite是游戏事实唯一来源；AI输出必须经结构和业务规则验证。
- Campaign、WorldBible、WorldFact和PlayerCharacter Repository已实现并用真实SQLite验证。
- JSON从unknown逐字段恢复；世界锁定字段、事实判别联合、角色属性和特质均严格校验。
- 共享Repository依赖最小SQLite端口；API Key不入库。

## 关键决策

- `DEC-001`至`DEC-012`记录当前架构选择；M2-T04沿用SQLite端口和受验证JSON决定，无新增重大决定。

## 最近成功验证

- `pnpm check`：通过；Vitest 101项、Node迁移3项通过。
- TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和workspace test通过。

## 恢复步骤

1. 完整读取规则、规格、任务、日志、决策、README、`LOG.md`、本文件和 `docs/data-model.md`。
2. 检查Git并设置`.local/`环境变量。
3. 完成并提交当前 `M2-T04` 变更。
4. 从 `M2-T05` 实现Tavern、Npc、Knowledge、Relationship和Memory持久化，重点验证多个NPC认知互不污染。
