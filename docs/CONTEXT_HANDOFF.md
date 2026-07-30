# Ember Tavern 上下文交接

## 当前状态

- 分支：`main`
- 最近完成任务：`M4-T08 实现冒险结算用例`
- 已完成里程碑：M0、M1、M2、M3
- 当前任务：`M4-T08` 已验收，准备提交
- 下一任务：`M4-T09 实现重生成和回退用例`

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
- TavernInitializationUseCases生成酒馆、老板、2名常驻、1名访客和3条RUMOR，并初始化有限认知与关系。
- GENERATE_NPCS的Schema/Prompt为版本2；常驻NPC是任务入口，实际Quest仍由M4-T05创建。
- NpcDialogueUseCases从SQLite构建单NPC有限认知上下文，并原子提交消息、情绪和关系；ExtractMemories验证来源后追加长期记忆。
- QuestUseCases验证发布者、引用和冒险长度后创建AVAILABLE任务；AcceptQuest在SQLite写事务内保证单主任务。
- AdventureStartUseCases保存PREPARING隐藏计划与线索，只返回公开状态；启动事务同步推进Adventure、Quest和Campaign。
- AdventureTurnUseCases先持久化玩家行动，再通过统一编排判断是否需要检定；检定由本地D20、角色属性、装备与状态修正计算并记录不可变结果，AI只生成后续叙事。
- 回合、线索、受验证状态补丁和事件在SQLite事务边界提交；无需检定和需要检定的回合均遵守Adventure状态机。
- AdventureSettlementUseCases先生成并验证冒险摘要与世界事件，不提前改变游戏事实；FinishAdventure将任务结果、NPC心情/关系、酒馆变化、程序授权奖励、世界事实/时钟、档案、事件、pending状态和Campaign返回酒馆一次性提交。
- AdventureEnding的ending_json保存关键选择、未决方向、未发现线索、参与NPC、奖励/世界事实/酒馆变化ID以及摘要/世界事件GenerationRecord引用；完整档案可从SQLite重新组装。

## 最近成功验证

- 成功与失败结算的真实SQLite集成测试通过；成功奖励由本地策略决定效果，失败不生成未授权奖励，结算可幂等重放。
- `pnpm check`：通过；Vitest 205项、Node SQLite 7项通过。
- TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和workspace test通过。

## 恢复步骤

1. 完整读取规则、规格、任务、日志、决策、README、`LOG.md`、本文件和 `docs/data-model.md`。
2. 检查Git并设置`.local/`环境变量。
3. 完成并提交当前 `M4-T08` 变更。
4. 从 `M4-T09` 实现保留输入重生成、切换Provider重生成和回退快照。
