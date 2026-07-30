# Ember Tavern 上下文交接

## 当前状态

- 分支：`main`
- 最近完成任务：`M4-T02 实现车卡用例`
- 已完成里程碑：M0、M1、M2、M3
- 当前任务：`M4-T02` 已验收，准备提交
- 下一任务：`M4-T03 实现酒馆初始化用例`

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
- AI输出先按任务Schema解析并返回可定位错误；原始响应、结构结果或错误分别留存在generation_records，且记录只能完成一次。
- AI状态补丁在本地事实工作视图上按顺序验证；任务/关系/时钟遵守固定规则，奖励须本地授权且效果由程序控制，事实只允许安全追加。
- AITurnOrchestrator串联pending、SQLite上下文、Prompt、统一Provider、GenerationRecord、双层验证和幂等Turn事务；COMMITTED重放不再调用模型。
- WorldCreationUseCases提供创建、生成、细化和确认世界；AI草稿映射本地ID，世界与存档状态同事务提交。
- CharacterCreationUseCases验证本地车卡、生成6候选特质，并将完整背景、程序控制装备与状态同事务提交。
- GENERATE_CHARACTER_TRAITS与COMPLETE_CHARACTER_BACKGROUND的Schema/Prompt为版本2。

## 最近成功验证

- Fake Provider完整车卡、6候选特质、背景装备落库及非法属性零写入测试通过。
- `pnpm check`：通过；Vitest 198项、Node SQLite 7项通过。
- TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和workspace test通过。

## 恢复步骤

1. 完整读取规则、规格、任务、日志、决策、README、`LOG.md`、本文件和 `docs/data-model.md`。
2. 检查Git并设置`.local/`环境变量。
3. 完成并提交当前 `M4-T02` 变更。
4. 从 `M4-T03` 实现GenerateTavern、GenerateNpcs。
