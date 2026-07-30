# Ember Tavern 上下文交接

## 当前状态

- 分支：`main`
- 最近完成任务：`M3-T05 实现上下文构建器`
- 已完成里程碑：M0、M1、M2
- 当前任务：`M3-T05` 已验收，准备提交
- 下一任务：`M3-T06 实现AI输出结构验证`

## 架构摘要

- SQLite是游戏事实唯一来源；主要游戏实体Repository已完成。
- 完整AdventureTurn、消息、物品和世界时钟可从重开数据库恢复；回合状态与事件原子提交。
- JSON从unknown逐字段验证；共享Repository依赖最小SQLite端口。
- GameEvent只追加且按判别字段验证；pending请求状态与游戏补丁支持幂等同事务提交。
- 数据库启动在副本上做版本、迁移和完整性检查；失败保持原文件不变。
- ai-core提供厂商无关请求、响应、Provider、模型与能力协议；业务层无SDK依赖。
- 15类AITask均有独立严格Zod输入/输出Schema和版本1注册项。
- Prompt集中在prompts package，版本历史独立保留，并按模型能力格式化。
- FakeAIProvider通过统一协议为15类任务返回确定性、Schema有效的离线JSON，不访问网络或游戏状态。
- NPC、冒险和世界事件上下文从领域快照最小化构建，具备归属过滤、秘密隔离、长短期组合和字符预算裁剪。
- NPC_REPLY、GENERATE_ADVENTURE_TURN、GENERATE_WORLD_EVENT输入Schema已升级到版本2以覆盖规格第26节。

## 最近成功验证

- 三类上下文Schema验证、秘密/相关性隔离和预算裁剪测试通过。
- `pnpm check`：通过；Vitest 179项、Node SQLite 7项通过。
- TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和workspace test通过。

## 恢复步骤

1. 完整读取规则、规格、任务、日志、决策、README、`LOG.md`、本文件和 `docs/data-model.md`。
2. 检查Git并设置`.local/`环境变量。
3. 完成并提交当前 `M3-T05` 变更。
4. 从 `M3-T06` 实现Schema验证、错误定位和原始输出留存。
