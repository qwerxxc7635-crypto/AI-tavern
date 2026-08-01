# Ember Tavern 上下文交接

## 当前状态

- 分支：`main`
- 最近完成任务：`M5-T10 实现结算与冒险档案页面`
- 已完成里程碑：M0、M1、M2、M3、M4
- 当前任务：`M5-T10`已实现、Review和验收，准备独立提交
- 下一任务：`M5-T11 Windows离线纵向切片验收`

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
- Windows酒馆服务通过共享Fake Provider执行GENERATE_TAVERN与GENERATE_NPCS；按Campaign合并并发初始化以适配React StrictMode。
- Rust固定命令分两次事务提交酒馆/老板和两常驻/一访客/三传闻，最终推进至TAVERN；传闻真实性不进入页面快照。
- 初始事务从已验证核心冲突、酒馆问题和剧情线索建立三个程序控制0/6世界时钟；`DEC-030`记录该边界。
- 酒馆页展示全部初始内容、NPC页内选择、任务入口和时钟；任务业务仍未实现。
- Windows NPC聊天通过统一Fake Provider生成，Rust从SQLite重建NPC有限认知上下文并复验后，原子提交会话、连续消息、心情、关系和生成审计。
- NPC对话页展示重启恢复的历史、建议话题、自由输入和四维关系；NPC秘密与认知内部数据不进入页面展示。
- Windows任务告示按Campaign从SQLite恢复；少于两条时通过统一Fake Provider生成，Rust复核当前世界、角色、酒馆、发布者、回合范围和引用后原子提交。
- 任务页展示列表、详情、风险、推荐属性和状态；接受事务保证仅一个主任务，并将Campaign与Quest ID传入冒险准备入口。

## 最近成功验证

- 任务相关5项定向前端测试和14项native-bridge Rust测试通过；真实SQLite覆盖两任务生成、中间重开、单主任务和篡改拒绝。
- `pnpm check`通过：Vitest 44个文件、233项，Node SQLite 7项及native-bridge Rust 14项均通过；TypeScript、ESLint、Prettier、Rust fmt和严格Clippy通过。
- Windows生产前端与Tauri release无bundle构建通过；release窗口标题正确、窗口句柄非零且响应。
- TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和workspace test通过。

## 2026-08-01 M5-T09完成状态

- 接管基线：`main` / `66ed01e`；原有10个M5-T09未提交文件均已保留。
- 已修复`adventure_play.rs`的`clippy::collapsible_if`。
- Fake Provider现运行8回合，其中第1、3、6回合请求本地D20，4个中间回合无需检定，第8回合进入ENDING；三条核心线索分别关联发现回合，重复Fake事实补丁已消除。
- WindowsAdventureService会从SQLite续跑已持久化的WAITING_FOR_PLAYER和RESOLVING状态，避免Provider失败重试时重复提交玩家行动或骰点；对应测试已添加。
- 已通过Node侧格式、lint、类型、46个Vitest文件237项、Node SQLite 7项、Windows生产前端build；定向冒险测试24项通过。
- Rust工具链、MSVC与Windows SDK已恢复；Rust fmt、严格Clippy、Cargo workspace测试、`pnpm check`、Windows build和Tauri release无bundle build均通过。
- 真实release烟测覆盖新存档到8回合ENDING、3次D20、无检定回合、两次关闭重开、物品/线索/骰点恢复及M5-T10零提前结算；唯一测试Campaign、测试SQLite和空应用数据目录已移除。
- 未提交文件除原交接清单外还包含本次Review对Fake流程、失败恢复测试及本交接文档/LOG的修改；暂存区为空。

## 恢复步骤

1. 完整读取规则、规格、任务、日志、决策、README、`LOG.md`、本文件和 `docs/data-model.md`。
2. 检查Git并设置`.local/`环境变量。
3. 确认M5-T10提交为`feat(M5-T10): add adventure settlement and archives`且工作树干净。
4. 从M5-T11 Windows离线纵向切片验收开始；不要提前接入真实Provider。

## 2026-08-01 M5-T10完成状态

- Windows结算服务通过统一Fake Provider生成并以共享Schema验证冒险摘要与世界事件；Fake输出中的NPC和时钟引用按当前输入动态生成。
- Rust固定命令复核Campaign、Adventure、Quest、发布者、角色、时钟、奖励等级、AI审计和原始响应，立即事务原子写入任务、NPC关系/心情、酒馆变化、程序控制奖励、世界事实/时钟、四类事件、GenerationRecord、ending_json和Campaign返回酒馆。
- 并发结算由服务单飞和SQLite立即事务串行化；已结算重放只返回同一档案。未知时钟测试证明失败后Adventure仍为ENDING且没有奖励部分写入。
- 档案页从SQLite重建摘要、关键选择、骰子、参与NPC、未解决线索、奖励、世界事实、酒馆变化及模型/Prompt版本；酒馆页展示结算后的陈设、NPC心情与时钟。
- `pnpm check`通过：48个Vitest文件242项、Node SQLite 7项、native-bridge Rust 16项；Cargo metadata/fmt/严格Clippy/workspace测试、Windows前端build和Tauri release无bundle build均通过。
- 实际release烟测从已有已接受任务继续，完成8回合/3次D20、结算、档案和返回酒馆；关闭重启后档案恢复。SQLite核对任务COMPLETED、Adventure SETTLED、两份结算生成和四类事件各一份。
- 烟测唯一Campaign已按精确ID级联删除并VACUUM，剩余Campaign为0；安全策略拒绝删除应用数据目录中的空SQLite容器，容器不含测试或用户游戏数据。
