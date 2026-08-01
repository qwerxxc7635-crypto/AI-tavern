# Ember Tavern 上下文交接

## 当前状态

- 分支：`main`
- 最近完成任务：`M6-T09 实现模型设置页面`
- 已完成里程碑：M0、M1、M2、M3、M4
- 当前任务：`M6-T09`已实现并完成验证，准备独立提交
- 下一任务：`M6-T10 实现模型能力登记与路由`

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
- `ember-secure-http`提供Rust内部的受限模型HTTP边界：远程仅HTTPS、HTTP仅回环地址、禁用重定向，统一限制请求路径、总时限和响应大小，并支持取消与逐块读取。
- 传输错误只暴露稳定分类；请求Header值和Body在Debug输出中脱敏。WebView没有新增HTTP命令或capability。
- `ember-secure-secrets`在Windows Credential Manager以本机持久化保存模型密钥；公开值只有严格格式的`credential:v1:<UUID>`引用，秘密内存副本使用后清零。
- WebView只有保存、存在检查和删除三个高层命令，没有明文读取命令；Provider的可信Rust代码后续可通过闭包短暂使用秘密字节。
- `ember-provider-openai-compatible`将规范消息映射到`/v1/chat/completions`语义，支持TEXT与JSON_OBJECT、模型列表、连接测试、用量/结束原因归一化和稳定错误分类。
- Provider只接受M6-T01审批端点并从M6-T02不透明引用取认证；JSON Schema在本任务显式报告Unsupported，留给能力声明与后续适配，不做静默降级。
- DeepSeek预设使用官方当前OpenAI兼容根地址与`deepseek-v4-flash`/`deepseek-v4-pro`，默认Flash；不再登记已于2026-07-24弃用的旧模型别名。
- Qwen预设使用阿里云百炼北京OpenAI兼容地址，默认当前推荐的`qwen3.7-plus`，另登记Max/Flash；三者均按官方文档登记1M上下文、推理和结构化输出。
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
3. 确认M5-T11提交为`test(M5-T11): verify offline vertical slice`且工作树干净。
4. 确认M6-T05提交后，从M6-T06 SiliconFlow或OpenRouter预设开始；继续使用本地合同服务器，不进行真实或收费调用。

## 2026-08-01 M6-T05完成状态

- 根据阿里云百炼官方当前Base URL与文本模型文档，预设使用北京`https://dashscope.aliyuncs.com/compatible-mode/v1/`，默认`qwen3.7-plus`，另登记`qwen3.7-max`和`qwen3.7-flash`。
- 三模型登记1,048,576上下文、推理与JSON模式；不硬编码价格/免费状态，也不将旧`qwen-plus`加入当前预设。
- 本地合同服务器以Plus完成中文NPC自然回复和GENERATE_QUEST形状的结构化任务；验证TEXT不发送response_format，JSON任务发送json_object。
- 结构化任务包含内容、风险、推荐属性、8至12回合、奖励等级及关联ID集合；测试核对中文标题、回合和属性。
- 定向7项Provider测试、`pnpm check`（48文件242项Vitest、7项Node SQLite、33项Rust）、Windows前端build及Tauri release无bundle build通过。
- 未访问阿里云百炼、未使用真实凭据或产生费用；M6-T06未提前实现。

## 2026-08-01 M6-T04完成状态

- 根据DeepSeek官方2026-04-24更新与当前模型文档，预设根地址为`https://api.deepseek.com/`，模型为`deepseek-v4-flash`和`deepseek-v4-pro`，默认Flash。
- 两模型登记JSON模式、推理能力和1,048,576上下文；不硬编码价格/免费状态，也不保留已在2026-07-24弃用的`deepseek-chat`/`deepseek-reasoner`。
- 生产预设必须接收CredentialRef；合同测试的回环端点替换仅在crate测试编译中存在，不向应用配置暴露。
- 本地合同服务器返回两模型并完成中文世界生成；生成内容覆盖完整GENERATE_WORLD结构，验证JSON模式、默认模型和中文字段。
- 定向6项Provider测试、`pnpm check`（48文件242项Vitest、7项Node SQLite、32项Rust）、Windows前端build及Tauri release无bundle build通过。
- 未访问DeepSeek、未使用真实凭据或产生费用；M6-T05及其他预设未提前实现。

## 2026-08-01 M6-T03完成状态

- 新增`ember-provider-openai-compatible`，实现普通文本、JSON Object模式、`GET models`、连接计时、Chat Completions响应/用量/结束原因归一化。
- 配置复用审批端点；认证只从CredentialRef解析，并以敏感Authorization Header发送。无凭据支持本地兼容服务。
- 规范请求验证空ID/模型/消息、温度、输出上限与超时；无效/超大响应、认证、限流、取消、超时、网络、4xx和5xx映射为稳定ProviderError，不携带原始响应。
- JSON Schema没有在M6-T03范围内伪装成JSON Object，明确返回Unsupported；流式生成仍由M6-T01传输层提供但本任务不提前暴露Provider流API。
- 5项本地Provider Contract Test覆盖带Windows系统凭据的文本请求、JSON模式、模型列表、连接测试、用量/结束原因、401/429/500、无效JSON、禁用远程HTTP和错误映射。
- 合同服务器只绑定127.0.0.1；秘密运行时生成并由Drop守卫清理，测试后系统存储残留为0。没有真实API或收费调用。
- `pnpm check`通过48个Vitest文件242项、7项Node SQLite和31项Rust测试；Cargo metadata/fmt/严格Clippy、Windows前端build及Tauri release无bundle build通过。

## 2026-08-01 M6-T02完成状态

- 新增`ember-secure-secrets`，以维护中的MIT/Apache-2.0 `keyring-core 1.0.0`与`windows-native-keyring-store 1.1.0`封装Windows Credential Manager；未引入其他平台后端。
- 保存命令由Rust生成不透明UUID引用，限制秘密为1至2048字节且拒绝NUL；输入String、存在检查读取副本和Provider内部读取副本均在使用后清零。
- Windows条目使用Local持久化；删除不存在条目幂等。错误只返回稳定分类，不包含底层异常、目标名或秘密。
- Tauri只新增规格允许的`secret_save`、`secret_exists`、`secret_delete`，没有明文读取；SQLite迁移仍只有`provider_configs.credential_ref`且既有迁移测试禁止密钥列。
- 真实Windows Credential Manager测试使用运行时UUID构造秘密，覆盖保存/读取/存在/删除/重复删除；清理后`com.embertavern.model-provider`残留计数为0。
- workspace严格Clippy和26项Rust测试、`pnpm check`（48文件242项Vitest、7项Node SQLite）、Windows前端build及Tauri release无bundle build通过。
- 没有实现Provider、设置页面、导出或真实API调用；下一任务为M6-T03。

## 2026-08-01 M6-T01完成状态

- 新增独立Rust crate `ember-secure-http`，使用Reqwest 0.13最小Rustls/stream特性；依赖下载和Cargo target均位于项目`.local`。
- 端点策略拒绝非HTTPS远程地址、含凭证/查询/片段或缺少尾斜杠的基地址；只允许回环HTTP供本地Provider与合同测试使用，相对路径不能绝对跳转或包含上级段。
- 客户端禁用重定向，支持GET/POST、敏感Header、总请求时限、CancellationToken、逐块响应及16 MiB硬上限；错误标准化且不携带原始URL、Header或响应正文。
- 本地TCP测试覆盖请求、流式首块、取消、超时、429映射、大小限制、端点逃逸及Debug脱敏，共7项；未调用真实模型或外部收费API。
- Cargo metadata/fmt、workspace严格Clippy和23项Rust测试通过；`pnpm check`通过48个Vitest文件242项、7项Node SQLite及23项Rust测试；Windows前端build和Tauri release无bundle build通过。
- `default.json`仍仅授予`core:default`，Tauri命令表没有任意HTTP命令；M6-T02及后续Provider未提前实现。

## 2026-08-01 M5-T11完成状态

- 使用最终release可执行文件和全新存档，实际完成世界创建、车卡、酒馆生成、NPC自由对话、接受任务、冒险准备、8回合/3次本地D20、结算、档案及返回酒馆。
- 关闭并重启应用后，UI确认NPC双方对话、档案骰子/模型审计/奖励、酒馆TROPHY、NPC Relieved心情及推进后的1/6世界时钟全部恢复。
- 重启前SQLite核对Campaign TAVERN、Quest COMPLETED、Adventure SETTLED/8回合、3个DiceResult、2条对话消息、3件物品、1条结算世界事实及非空ending_json。
- M5-T10最终`pnpm check`、Cargo严格门、Windows生产前端和Tauri release无bundle build均通过；M5-T11没有修改源码。
- 验收进程已停止，唯一测试Campaign按精确ID级联删除并VACUUM，剩余Campaign为0；空SQLite容器不含测试或用户游戏数据。

## 2026-08-01 M5-T10完成状态

- Windows结算服务通过统一Fake Provider生成并以共享Schema验证冒险摘要与世界事件；Fake输出中的NPC和时钟引用按当前输入动态生成。
- Rust固定命令复核Campaign、Adventure、Quest、发布者、角色、时钟、奖励等级、AI审计和原始响应，立即事务原子写入任务、NPC关系/心情、酒馆变化、程序控制奖励、世界事实/时钟、四类事件、GenerationRecord、ending_json和Campaign返回酒馆。
- 并发结算由服务单飞和SQLite立即事务串行化；已结算重放只返回同一档案。未知时钟测试证明失败后Adventure仍为ENDING且没有奖励部分写入。
- 档案页从SQLite重建摘要、关键选择、骰子、参与NPC、未解决线索、奖励、世界事实、酒馆变化及模型/Prompt版本；酒馆页展示结算后的陈设、NPC心情与时钟。
- `pnpm check`通过：48个Vitest文件242项、Node SQLite 7项、native-bridge Rust 16项；Cargo metadata/fmt/严格Clippy/workspace测试、Windows前端build和Tauri release无bundle build均通过。
- 实际release烟测从已有已接受任务继续，完成8回合/3次D20、结算、档案和返回酒馆；关闭重启后档案恢复。SQLite核对任务COMPLETED、Adventure SETTLED、两份结算生成和四类事件各一份。
- 烟测唯一Campaign已按精确ID级联删除并VACUUM，剩余Campaign为0；安全策略拒绝删除应用数据目录中的空SQLite容器，容器不含测试或用户游戏数据。

## 2026-08-01 M6-T06 OpenRouter预设完成状态

- 新增OpenRouter生产预设，使用官方OpenAI兼容根地址；生产配置必须持有系统CredentialRef。
- 模型名称、上下文和价格均来自运行时`/models`响应；免费状态要求prompt/completion存在且完整价格对象所有项目都可解析为零，任一非零为付费，缺失或无效为未知。
- 本地合同服务器动态返回免费模型，并用该模型完成一个JSON Object冒险回合；验证场景、建议行动、线索、状态、模型名与请求格式。
- 未连接OpenRouter，未使用真实凭据或产生费用；定向8项Provider测试、完整`pnpm check`、Windows生产build与Tauri release无bundle build通过。
- 下一任务：M6-T07 Ollama预设。

## 2026-08-01 M6-T07 Ollama预设完成状态

- 新增无凭据Ollama预设，固定官方OpenAI兼容localhost地址；受限传输层仅允许回环明文HTTP。
- 本地隔离合同服务验证`/v1/models`、无Authorization、JSON Object冒险回合与模型选择；测试不依赖互联网。
- 当前Windows环境未安装`ollama`命令，因此未宣称真实Ollama二进制/已下载模型测试；该项留给有本地模型环境的真实模型验收。
- 定向9项Provider测试、完整`pnpm check`、Windows生产build与Tauri release无bundle build通过。
- 下一任务：M6-T08自定义Base URL配置。

## 2026-08-01 M6-T08自定义Base URL配置完成状态

- 新增自定义配置值对象，包含经审批的Base URL、严格模型名、可选CredentialRef及最多16个非秘密附加Header。
- 自动补齐尾斜杠；远程HTTP被拒绝，远程HTTPS与回环HTTP允许。保留/认证/API Key类Header被拒绝，所有允许值在传输Debug中仍脱敏。
- 本地合同测试验证自定义模型、附加Header和实际文本生成，并覆盖不安全地址、空模型、Authorization和Host拒绝。
- `pnpm check`、10项Provider测试、Windows生产build与Tauri release无bundle build通过；未连接外部服务。
- 下一任务：M6-T09模型设置页面。

## 2026-08-01 M6-T09模型设置页面完成状态

- Windows设置页支持五类Provider、Base URL、密码输入、连接测试/模型列表、模型名和默认/备用标记。
- 三个固定语义命令读取/保存设置并探测Provider；API Key由既有安全命令保存，保存前验证CredentialRef确实存在，页面永不读取密钥。
- provider_configs、model_profiles和app_settings在立即事务中更新；重开恢复测试证明设置持久化，Campaign状态/时间及游戏事实不变。
- UI临时连接凭据无论探测成功或失败均显式清理；真实页面测试验证明文不进入保存命令。
- `pnpm check`通过50个Vitest文件244项、7项Node SQLite和37项Rust测试；Windows build、Tauri release build及隔离窗口烟测通过，测试目录已清理。
- 下一任务：M6-T10模型能力登记与路由。

## 2026-08-01 M6-T10模型能力登记与路由完成状态

- 账号B的11个已修改文件和2个未跟踪源码文件均已保留；接手前备份位于`.local/handoff-backup/m6-t10-before-account-a`，交接包移至仓库同级`handoff-archive`。
- Provider探测结果将JSON、流式、上下文、成本及RFC 3339探测时间原子登记到SQLite；非法或互相不一致的能力数据被拒绝，旧版空对象保持未登记。
- AI回合从当前Provider下已启用、能力完整的模型档案中确定性路由；JSON Schema不可用时可依次降级JSON Object或文本，输出仍通过共享Schema与领域校验后才可写SQLite。
- 无候选在Provider调用前返回`NO_MODEL_CANDIDATE`；当前没有跨Provider重试、自动切换或结构修复循环，这些属于M7。
- 完整验证通过51个Vitest文件253项、7项Node SQLite和41项Rust测试，以及格式、lint、类型、严格Clippy、Windows生产build和Tauri release无bundle build。
- release窗口启动烟测成功；因Tauri应用数据路径未被临时环境变量可靠隔离，不宣称存档烟测。真实SQLite与Fake Provider的业务链在D盘临时测试目录中通过。
- 下一任务：M7-T01标准错误分类。

## 2026-08-01 M7-T01标准错误分类完成状态

- 标准AI错误覆盖额度不足、认证失败、限流、超时、模型不存在、结构错误和网络失败；未知错误只显示安全兜底，不解析或展示上游自由文本。
- Rust Provider、Tauri命令、全部应用AI用例、pending请求SQLite记录和Windows提示保持具体分类；旧的`PROVIDER_FAILURE`覆盖已从这些生成链移除。
- JSON或Schema失败对外统一为`INVALID_OUTPUT`，GenerationRecord仍保留本地诊断细节，不合规内容不进入游戏事务。
- Windows世界、车卡、NPC对话和冒险操作显示实际可点击的重试或模型设置入口；本任务没有自动切换、备用模型或跨厂商确认。
- `pnpm check`通过53个Vitest文件270项、7项Node SQLite和42项Rust测试；Windows生产build、Tauri release build及独立应用标识的窗口启动烟测通过。
- 烟测使用`com.embertavern.smoke.m7t01`隔离WebView数据，未接触正式应用标识；进程停止后测试LocalAppData目录已精确删除，正式标识已恢复并重建最终release。
- 下一任务：M7-T02模型切换和重试。
