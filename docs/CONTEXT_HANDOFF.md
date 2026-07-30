# Ember Tavern 上下文交接

## 当前状态

- 分支：`main`
- 最近完成任务：`M2-T03 实现Campaign Repository`
- 已完成里程碑：M0、M1；M2已完成 `M2-T01` 至 `M2-T03`
- 当前任务：`M2-T03` 已验收，准备提交
- 下一任务：`M2-T04 实现世界与角色Repository`

## 架构摘要

- SQLite是游戏事实唯一来源；AI输出必须经结构和业务规则验证。
- 首版迁移已真实验证；Campaign Repository支持CRUD、归档、列表和重连恢复。
- 共享Repository依赖最小SQLite端口，Node SQLite只用于测试适配。
- 数据库行从unknown开始验证后构造品牌类型；API Key不入库。

## 关键决策

- `DEC-001`至`DEC-012`记录从NPC数量到SQLite模型、迁移和Repository端口的架构选择。

## 环境与限制

- Node.js `v24.17.0`，pnpm `11.9.0`，`@types/node 24.13.3`；Rustc/Cargo `1.97.1`。
- 缓存、下载、构建和临时文件位于`.local/`。
- 平台原生SQLite连接尚未实现；当前测试使用Node内置SQLite真实文件。

## 最近成功验证

- Campaign写入后关闭并重开数据库，数据完整恢复。
- `pnpm check`：通过；Vitest 96项、Node迁移3项通过。
- TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和workspace test通过。

## 恢复步骤

1. 完整读取规则、规格、任务、日志、决策、README、`LOG.md`、本文件和 `docs/data-model.md`。
2. 检查Git并设置`.local/`环境变量。
3. 完成并提交当前 `M2-T03` 变更。
4. 从 `M2-T04` 实现WorldBible、WorldFact和PlayerCharacter Repository，并测试完整保存与读取。
