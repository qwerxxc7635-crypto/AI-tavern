# Ember Tavern 上下文交接

## 当前状态

- 分支：`main`
- 最近完成任务：`M5-T05 实现车卡页面`
- 已完成里程碑：M0、M1、M2、M3、M4
- 当前任务：`M5-T05` 已验收，准备提交
- 下一任务：`M5-T06 实现酒馆页面`

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
- 玩家行动写入后创建TURN_INPUT AUTO快照；SnapshotRepository以规范JSON、SHA-256和SQLite事务恢复Campaign有效游戏状态，保留独立AI审计并限制最近10个AUTO快照。
- RegenerationUseCases支持自由故事和规则限次模式，按Campaign策略与跨厂商披露控制Provider切换；失败恢复安全快照，成功从输入基线替换旧AI游戏结果。
- Windows React/Vite/Tauri入口已加入pnpm/Cargo workspace；HashRouter、基础主题和最小core:default capability可运行。
- Windows启动页在运行时读取共享contracts Schema版本；无SQL、文件、HTTP、密钥或业务原生命令。
- Windows AppShell包含侧栏、上下文标题栏、离线状态、统一加载态和错误边界；六个规定入口通过延迟路由模块导航。
- Windows存档首页通过四个受限Tauri命令访问系统应用数据目录中的SQLite；页面可新建、继续、归档并显示最后游玩时间。
- 原生桥复用0001迁移并拒绝未来Schema；Rust和TypeScript边界都验证存档摘要，WebView不拥有SQL或数据库路径。
- Windows世界创建服务继续使用共享Fake Provider、Prompt与任务Schema；Rust固定命令重新校验世界、锁定、引用和阶段后原子提交。
- 世界页覆盖全部基础选项、可选构想、预览、手动编辑、九类字段锁定、局部/全部重生成和确认，确认后进入CREATING_CHARACTER。
- Windows车卡服务继续使用共享Fake Provider、版本2 Prompt和任务Schema；Rust固定命令复核属性、候选特质、生成输入/上下文和原始/验证输出后原子提交。
- 车卡页覆盖基础资料、四属性10点分配、六选二特质、重启恢复、背景和程序控制装备预览；完成后Campaign进入GENERATING_TAVERN并导航到酒馆生成入口。

## 最近成功验证

- 车卡相关14项定向前端测试和8项native-bridge Rust测试通过；真实SQLite覆盖生成特质后重开恢复及完整角色再次重开。
- `pnpm check`通过：Vitest 38个文件、225项，Node SQLite 7项及native-bridge Rust 8项均通过；TypeScript、ESLint、Prettier、Rust fmt和严格Clippy通过。
- Windows生产前端与Tauri release无bundle构建通过；release窗口标题正确、窗口句柄非零且响应。
- TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和workspace test通过。

## 恢复步骤

1. 完整读取规则、规格、任务、日志、决策、README、`LOG.md`、本文件和 `docs/data-model.md`。
2. 检查Git并设置`.local/`环境变量。
3. 完成并提交当前 `M5-T05` 变更。
4. 从 `M5-T06` 实现酒馆页面；不要提前实现M5-T07 NPC聊天页面。
