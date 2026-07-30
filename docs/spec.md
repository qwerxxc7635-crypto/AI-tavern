# Ember Tavern 产品与技术规格说明

版本：v0.1 Draft  
项目代号：Ember Tavern / 炉火酒馆  
目标平台：Windows、iOS  
文档用途：作为产品设计、架构设计、开发拆分、AI协作和验收的统一依据。

---

## 1. 项目概述

Ember Tavern 是一款把“AI酒馆”和“AI跑团”结合起来的单人文字冒险应用。

玩家创建一个新的本地存档后，可以选择是否向AI提供世界观提示词。AI根据玩家选择和提示词生成一个独立世界。玩家随后完成车卡，进入AI生成的酒馆，与拥有独立身份、目标、秘密和有限认知的NPC互动，接受任务并参与短局文字跑团。

所有虚构内容和叙事内容由AI生成；所有规则、数值、骰子、状态更新、存档和恢复由本地程序管理。

核心体验：

```text
输入世界构想
→ AI生成世界观
→ 玩家车卡
→ AI生成酒馆和NPC
→ 玩家与NPC交流
→ 接受AI生成的任务
→ 完成8～12回合冒险
→ 骰子和规则由程序结算
→ 冒险结果改变NPC、酒馆和世界
→ 返回酒馆继续下一轮
```

---

## 2. 产品目标

### 2.1 主要目标

1. 提供可持续发展的AI文字冒险体验，而不是单纯的聊天界面。
2. 每个存档拥有独立的世界观、玩家角色、酒馆、NPC、任务和长期变化。
3. 玩家可在不同模型之间切换，不丢失任何已有进度。
4. 所有正式存档默认保存在本地，不依赖任何模型服务商或云数据库。
5. Windows和iOS分别作为独立客户端开发，但共享游戏规则、数据协议和AI任务协议。

### 2.2 次要目标

1. 允许玩家根据偏好控制题材、氛围、黑暗程度和内容边界。
2. 允许玩家锁定部分AI生成内容，并局部重新生成。
3. 支持DeepSeek、Qwen、OpenAI兼容接口、SiliconFlow、OpenRouter、Ollama等模型来源。
4. 提供完整的存档导入、导出、快照和恢复能力。
5. 为后续酒馆经营、语音、图片、多人和模组能力留下扩展空间，但不在v0.1实现。

---

## 3. 非目标

v0.1不实现：

- 多人联机跑团；
- 实时语音；
- AI生成图片；
- 格子地图和战棋战斗；
- 完整DND或其他复杂规则系统；
- 酒馆深度经营；
- 开放世界地图；
- NPC在后台持续自主运行；
- 多个真实Agent并行协作；
- 云端存档和实时双端同步；
- 玩家社区、内容发布和模组市场；
- iOS端直接运行大型本地模型；
- Windows与iOS自动共享同一份本地存档。

---

## 4. 核心设计原则

### 4.1 本地数据库是唯一真实数据源

所有长期事实必须保存到本地SQLite数据库。

模型只接收当前任务所需上下文，并返回内容建议。模型不能成为存档服务器，也不能拥有唯一的对话历史。

```text
本地数据库 = 游戏事实
AI模型 = 可替换的内容生成器
```

即使模型额度耗尽、接口下线、网络断开或更换模型，玩家仍然必须能够打开存档、查看所有历史内容，并在新模型可用后继续游戏。

### 4.2 AI负责创作，程序负责规则

AI负责：

- 世界观；
- 势力和地区；
- 酒馆设定；
- NPC身份、背景和对话；
- 角色背景；
- 任务；
- 冒险场景；
- 道具名称和描述；
- 冒险总结；
- 世界事件文本。

程序负责：

- 页面和系统文字；
- 属性和数值；
- 骰子；
- 奖励等级；
- NPC关系数值；
- 世界时钟；
- 状态机；
- 数据验证；
- 自动保存；
- 快照和恢复；
- API密钥安全；
- 错误提示；
- 导入导出。

### 4.3 模型可替换

业务代码不能直接依赖某一家模型厂商。

所有模型调用必须经过统一AI编排层和Provider适配层。

### 4.4 世界内容可发展，但不可随意推翻

世界信息分为：

- 锁定规则：世界类型、技术水平、魔法规则、核心冲突等；
- 可发展事实：势力关系、NPC生死、城镇状态、世界危机进度等；
- 临时叙述：天气、普通动作、场景装饰等；
- 传闻：未验证信息；
- 错误认知：NPC相信但不一定真实的信息。

AI不能无理由修改锁定规则。

---

## 5. 目标用户

### 5.1 主要用户

- 喜欢AI角色扮演和文字冒险的玩家；
- 喜欢TRPG但没有固定团友的玩家；
- 喜欢自定义世界观和角色的玩家；
- 希望使用本地模型或自有API的用户。

### 5.2 使用场景

- Windows端进行较长时间的沉浸式冒险；
- iOS端进行短时NPC互动、查看存档和继续云模型冒险；
- 玩家在一个模型额度不足后切换到另一个模型继续；
- 玩家导出存档后在另一台设备手动导入；
- 玩家使用Ollama在Windows本地离线生成内容。

---

## 6. 核心游戏循环

```text
创建世界
→ 车卡
→ 进入酒馆
→ 获取传闻与任务
→ 选择任务
→ 开始冒险
→ 玩家输入行动
→ 程序判断是否需要检定
→ 程序掷骰
→ AI根据结果续写
→ 冒险结算
→ 更新NPC、酒馆和世界
→ 返回酒馆
```

每三次左右的冒险构成一个小型剧情章。

每个存档同时存在三个长期目标：

1. 玩家个人目标；
2. 酒馆长期问题；
3. 世界核心危机。

---

## 7. 新世界创建

### 7.1 世界生成方式

玩家可以选择：

1. 完全随机；
2. 基础选项生成；
3. 输入一句话或一段提示词；
4. 基础选项与提示词结合。

自定义提示词为可选项。

示例：

```text
这是一个漂浮在云海上的群岛世界。
人们依靠巨型飞行生物往返各岛。
魔法来自天气，但每次使用魔法都会改变附近气候。
整体偏轻松冒险，不要过度黑暗。
```

### 7.2 基础选项

- 世界类型：奇幻、武侠、蒸汽朋克、科幻、都市怪谈、随机；
- 故事氛围：轻松、冒险、平衡、严肃、黑暗；
- 魔法程度：无、低、中、高；
- 世界规模：一座城市、一个地区、一个王国；
- 黑暗程度；
- 是否允许恐怖元素；
- 是否允许永久死亡；
- 是否允许恋爱剧情；
- 是否允许背叛；
- 不希望出现的内容。

v0.1默认推荐“一座城市”或“一个地区”。

### 7.3 世界圣经

AI必须生成结构化世界圣经，至少包含：

- 世界名称；
- 当前地区；
- 世界简介；
- 核心冲突；
- 技术水平；
- 魔法或特殊力量规则；
- 主要势力；
- 当前地区的重要地点；
- 叙事风格；
- 禁止出现的设定；
- 酒馆存在的原因；
- 可发展的剧情线索。

### 7.4 世界预览和修改

玩家可以：

- 接受；
- 全部重新生成；
- 局部重新生成；
- 手动编辑；
- 输入自然语言修改要求；
- 锁定部分字段后重新生成其他字段。

世界确认后，锁定字段进入不可随意修改状态。

---

## 8. 车卡系统

每个新存档都必须车卡。

### 8.1 基础信息

- 角色名；
- 性别，可选；
- 年龄，可选；
- 一句话角色概念；
- 剧情偏好；
- 内容禁区。

### 8.2 职业原型

底层提供四个固定规则原型：

- 战士型；
- 游荡型；
- 学者型；
- 交涉型。

AI可以根据世界风格重新命名和包装职业，但不能改变其底层属性定位。

### 8.3 属性

四项属性：

- 体魄；
- 敏捷；
- 学识；
- 魅力。

建议规则：

- 初始全部为1；
- 额外分配6点；
- 单项最高5。

### 8.4 特质

AI根据角色概念生成6个候选特质，玩家选择2个。

特质主要影响叙事，不在v0.1引入复杂数值系统。

### 8.5 个人目标

AI和玩家共同确定一个长期个人目标。

### 8.6 角色背景

AI生成：

- 出生地；
- 重要经历；
- 冒险动机；
- 一个秘密；
- 一个重要人物；
- 为什么来到酒馆。

玩家可以锁定部分内容并局部重新生成。

### 8.7 初始装备

AI生成名称和描述；程序从固定装备类别和奖励等级中分配实际效果。

---

## 9. 酒馆系统

### 9.1 初始内容

车卡完成后，AI生成：

- 酒馆名称；
- 位置；
- 环境；
- 特殊规则；
- 酒馆长期问题；
- 一名老板；
- 两名常驻NPC；
- 一名临时访客；
- 三条传闻；
- 两个可接受任务。

### 9.2 酒馆的作用

- 玩家长期基地；
- NPC关系中心；
- 任务入口；
- 世界变化展示；
- 冒险纪念物展示；
- 剧情章之间的过渡空间。

### 9.3 纪念物

重要冒险可以在酒馆留下文字化变化，例如：

- 墙上新增战利品；
- 菜单新增饮品；
- 某张桌子留下伤痕；
- 新增地图或装饰；
- NPC外观或位置变化。

---

## 10. NPC系统

### 10.1 NPC角色卡

每个NPC至少包含：

- 姓名；
- 身份；
- 外貌；
- 性格；
- 目标；
- 秘密；
- 语言风格；
- 当前情绪；
- 与玩家关系；
- 已知事实；
- 怀疑事实；
- 错误认知；
- 不知道的秘密；
- 当前状态。

### 10.2 关系维度

NPC关系使用四维度，每项范围为-5～5：

- 信任；
- 亲近；
- 敬畏；
- 亏欠。

AI只能提出关系变化建议，程序验证后写入。

### 10.3 有限认知

NPC不能知道数据库中所有世界事实。

每个NPC只基于自身已知事实、怀疑、错误认知和近期经历回复。

### 10.4 NPC关系事件

达到条件后可以触发：

- NPC主动委托；
- 透露秘密；
- 赠送物品；
- 加入冒险；
- 与其他NPC冲突；
- 背叛、离开或牺牲。

---

## 11. 传闻系统

酒馆定期出现三条左右传闻。

传闻可能是：

- 真实；
- 部分真实；
- 错误；
- 某势力故意传播；
- 某NPC的个人误解。

玩家不会直接看到传闻真实性。

---

## 12. 任务系统

### 12.1 任务内容

任务文字由AI生成，但必须符合固定结构：

- 标题；
- 发布者；
- 简介；
- 明确目标；
- 风险等级；
- 推荐属性；
- 预计长度；
- 可能奖励等级；
- 关联NPC；
- 关联世界事实；
- 失败代价。

### 12.2 任务限制

v0.1同时只允许一个主冒险处于进行状态。

任务奖励、关系变化和世界时钟变化由程序限定范围。

---

## 13. 冒险系统

### 13.1 冒险长度

每场冒险目标为：

- 8～12个主要回合；
- 2～4次检定；
- 1个明确目标；
- 至少3条核心线索；
- 至少2个可能结局。

### 13.2 隐藏剧本骨架

冒险开始前，AI生成玩家不可见的结构：

- 目标；
- 风险；
- 预计回合；
- 核心场景；
- 必要线索；
- 主要阻碍；
- 可能结局；
- 失败代价。

后续每回合生成必须参考该结构。

### 13.3 玩家行动

每回合玩家可以：

- 选择AI提供的行动；
- 自由输入；
- 查看角色卡；
- 查看线索；
- 使用物品；
- 尝试退出任务。

### 13.4 检定

基础规则：

```text
D20 + 属性值 + 装备或状态修正 ≥ 难度值
```

建议难度：

- 8：简单；
- 11：普通；
- 14：困难；
- 17：极难。

骰子必须由本地程序生成，AI不能决定骰子结果。

### 13.5 失败推进

关键线索不能因一次失败永久丢失。

失败应产生代价，例如：

- 找到线索但惊动敌人；
- 成功进入但损坏工具；
- 被俘而不是直接死亡；
- 世界时钟推进；
- NPC关系下降；
- 获得信息但暴露身份。

### 13.6 重生成与回退

提供两种模式：

- 自由故事模式：允许较自由的重生成和回退；
- 规则模式：限制重生成次数。

必须支持：

- 重新生成当前AI回复；
- 使用另一个模型重新生成；
- 保留玩家输入、替换AI输出；
- 回退到最近快照。

---

## 14. 世界时钟

每个存档生成3个左右世界时钟。

示例：

```text
灰潮扩散：2/6
王国内战：1/6
酒馆封印破裂：3/6
```

世界时钟达到特定阶段后触发事件。

AI可以提出时钟推进建议，程序决定是否接受并限制幅度。

---

## 15. 冒险结算

结算内容：

- 成功、部分成功或失败；
- 获得物品；
- 关系变化；
- 世界事实变化；
- 世界时钟变化；
- 酒馆变化；
- 未解决线索；
- 冒险摘要；
- 下一步可能方向。

结算完成后返回酒馆。

---

## 16. 冒险档案

每场已结束冒险生成档案：

- 标题；
- 摘要；
- 关键选择；
- 骰子记录；
- 参与NPC；
- 获得物品；
- 世界变化；
- 未解决线索；
- 使用的模型和生成版本。

---

## 17. 页面结构

### 17.1 Windows

侧边导航：

- 酒馆；
- 任务；
- 冒险；
- 角色；
- 档案；
- 设置。

冒险页建议三栏：

- 左：角色、目标、世界时钟；
- 中：剧情、NPC发言、行动输入；
- 右：物品、线索、骰子记录。

### 17.2 iOS

底部导航：

- 酒馆；
- 冒险；
- 角色；
- 档案。

任务和设置从顶部菜单进入。

冒险页：

- 顶部：目标和简化状态；
- 中部：剧情消息流；
- 底部：行动选项和输入框；
- 抽屉：物品、线索、骰子和角色状态。

### 17.3 系统文字

按钮、错误、设置、隐私和确认提示由开发者固定编写，不由AI生成。

---

## 18. 技术架构

### 18.1 总体结构

```text
Windows App / iOS App
        ↓
Application Use Cases
        ↓
Shared Game Domain
        ↓
Persistence / AI / Native Adapters
        ↓
SQLite / Provider API / Secure Vault / File System
```

### 18.2 技术栈

- Tauri 2；
- React；
- TypeScript；
- Vite；
- Zustand，仅存临时UI状态；
- Zod；
- Rust；
- SQLite；
- Stronghold或平台安全密钥存储；
- pnpm workspace；
- Cargo workspace；
- Vitest；
- Playwright。

### 18.3 开发顺序

1. 先完成共享协议和Windows纵向切片；
2. 再完成真实模型接入；
3. 再完成恢复、快照和导入导出；
4. 最后适配iOS。

---

## 19. 项目目录

```text
ember-tavern/
├─ windows-app/
├─ ios-app/
├─ packages/
│  ├─ contracts/
│  ├─ domain/
│  ├─ application/
│  ├─ persistence/
│  ├─ ai-core/
│  ├─ prompts/
│  ├─ ui-kit/
│  └─ test-fixtures/
├─ crates/
│  ├─ native-bridge/
│  ├─ ai-transport/
│  ├─ secure-vault/
│  ├─ file-transfer/
│  ├─ backup-service/
│  └─ dice-service/
├─ database/
│  ├─ migrations/
│  ├─ seed/
│  └─ schema.md
├─ docs/
│  ├─ spec.md
│  ├─ architecture.md
│  ├─ ai-protocol.md
│  ├─ data-model.md
│  └─ development-plan.md
├─ scripts/
├─ package.json
├─ pnpm-workspace.yaml
└─ Cargo.toml
```

Windows和iOS必须是两个独立项目文件夹，能够分别安装依赖、运行和构建。

---

## 20. 应用层用例

首批用例：

- CreateCampaign；
- GenerateWorld；
- RefineWorld；
- ConfirmWorld；
- CreateCharacter；
- GenerateCharacterTraits；
- CompleteCharacterBackground；
- GenerateTavern；
- GenerateNpcs；
- TalkToNpc；
- GenerateQuest；
- AcceptQuest；
- StartAdventure；
- SubmitPlayerAction；
- RollCheck；
- ResolveAdventureTurn；
- FinishAdventure；
- AdvanceWorldClocks；
- SwitchModel；
- RetryPendingRequest；
- CreateSnapshot；
- RestoreSnapshot；
- ExportCampaign；
- ImportCampaign。

UI不能直接修改SQLite或模型提示词。

---

## 21. 游戏状态机

### 21.1 存档状态

```text
CREATING_WORLD
→ REVIEWING_WORLD
→ CREATING_CHARACTER
→ GENERATING_TAVERN
→ TAVERN
→ ADVENTURE
→ SETTLEMENT
→ TAVERN
```

异常状态：

- GENERATION_FAILED；
- WAITING_FOR_MODEL；
- RECOVERY_REQUIRED；
- ARCHIVED。

### 21.2 冒险状态

```text
PREPARING
→ SCENE
→ WAITING_FOR_PLAYER
→ CHECK_REQUIRED
→ RESOLVING
→ SCENE
→ ENDING
→ SETTLED
```

程序必须拒绝非法状态迁移。

---

## 22. AI子系统

### 22.1 AI逻辑角色

同一个模型可通过不同任务提示词承担：

- World Designer；
- Game Master；
- NPC Actor；
- Archivist。

v0.1不实现多个并行Agent。

### 22.2 AI任务

首批任务：

- GENERATE_WORLD；
- REFINE_WORLD；
- GENERATE_CHARACTER_TRAITS；
- COMPLETE_CHARACTER_BACKGROUND；
- GENERATE_TAVERN；
- GENERATE_NPCS；
- NPC_REPLY；
- GENERATE_QUEST；
- GENERATE_ADVENTURE_PLAN；
- GENERATE_ADVENTURE_TURN；
- RESOLVE_DICE_RESULT；
- GENERATE_WORLD_EVENT；
- SUMMARIZE_ADVENTURE；
- EXTRACT_MEMORIES；
- CHECK_CONSISTENCY。

每种任务必须具有：

- 输入Schema；
- 输出Schema；
- 提示词版本；
- 上下文策略；
- 温度策略；
- 重试策略；
- 最大输出长度；
- 数据验证规则。

### 22.3 Provider接口

```ts
interface AIProvider {
  id: string;
  listModels(): Promise<ModelInfo[]>;
  testConnection(config: ProviderConfig): Promise<TestResult>;
  generate(
    request: NormalizedAIRequest,
    config: ProviderConfig
  ): Promise<NormalizedAIResponse>;
}
```

### 22.4 Provider类型

- OpenAI Native；
- Anthropic Native；
- Gemini Native；
- OpenAI-Compatible；
- Local OpenAI-Compatible。

### 22.5 Provider预设

预留：

- deepseek；
- qwen；
- zhipu-glm；
- moonshot-kimi；
- minimax；
- doubao；
- hunyuan；
- qianfan；
- siliconflow；
- openrouter；
- groq；
- openai；
- anthropic；
- gemini；
- ollama；
- lm-studio；
- custom。

### 22.6 v0.1实际接入范围

优先真正实现：

1. OpenAI-Compatible通用适配器；
2. DeepSeek预设；
3. Qwen预设；
4. SiliconFlow或OpenRouter预设；
5. Ollama预设；
6. 自定义Base URL。

其他厂商只预留配置和接口，不要求首版全部通过完整测试。

### 22.7 模型能力

模型能力需动态登记：

- 文本；
- 流式输出；
- system消息；
- JSON Mode；
- JSON Schema；
- Tool Calling；
- 推理模式；
- 上下文长度；
- 免费或付费状态。

免费状态不能永久硬编码。

---

## 23. 模型切换

每个存档保存模型配置档案：

- 默认Provider；
- 默认模型；
- 备用Provider；
- 备用模型；
- 按任务覆盖；
- 自动切换策略。

切换策略：

- 每次询问；
- 仅同厂商自动切换；
- 允许跨厂商自动切换；
- 禁止自动切换。

跨厂商切换前必须提示玩家，必要游戏上下文将发送给新的服务商。

模型切换后，应用从本地数据库重建上下文，不依赖旧模型会话ID。

---

## 24. 本地存储

### 24.1 SQLite

Windows和iOS分别拥有本地SQLite数据库。

Windows建议位于系统应用数据目录；iOS位于应用沙盒Application Support目录。

### 24.2 核心表

- campaigns；
- world_bibles；
- world_facts；
- player_characters；
- taverns；
- npcs；
- npc_knowledge；
- npc_relationships；
- quests；
- adventures；
- adventure_turns；
- conversations；
- messages；
- items；
- world_clocks；
- game_events；
- generation_records；
- pending_ai_requests；
- save_snapshots；
- model_profiles；
- provider_configs；
- app_settings。

### 24.3 Zustand限制

Zustand只能保存临时UI状态。

任务、角色、NPC、世界、骰子、物品和冒险回合必须写入SQLite。

---

## 25. AI请求生命周期

```text
1. 保存玩家输入
2. 创建pending_ai_request
3. 构建上下文
4. 选择Provider和模型
5. 发起请求
6. 保存原始返回
7. 验证结构
8. 验证状态变化
9. SQLite事务提交
10. 追加game_event
11. 标记请求完成
12. UI显示结果
```

请求状态：

- CREATED；
- CONTEXT_READY；
- SENDING；
- RECEIVED；
- VALIDATING；
- COMMITTED；
- FAILED；
- CANCELLED。

每个请求必须包含：

- requestId；
- campaignId；
- turnId；
- idempotencyKey。

避免重试造成重复奖励或重复推进。

---

## 26. 上下文构建

### 26.1 NPC对话

只发送：

- 世界摘要；
- 当前地区；
- 当前NPC角色卡；
- NPC已知事实；
- NPC错误认知；
- NPC关系；
- 最近对话；
- 相关长期记忆。

### 26.2 冒险回合

只发送：

- 世界规则；
- 玩家角色；
- 当前任务；
- 冒险隐藏骨架；
- 当前场景；
- 最近5～10回合；
- 已发现线索；
- 相关NPC；
- 玩家本次行动。

### 26.3 世界事件

只发送：

- 世界时钟；
- 势力状态；
- 最近重要事件；
- 当前剧情章。

v0.1不使用向量数据库。

---

## 27. AI输出验证

AI只能返回建议变更，不能直接写数据库。

程序必须验证：

- 任务进度范围；
- 单回合关系变化上限；
- 奖励等级；
- 属性不可被AI直接修改；
- 高级物品不可凭空生成；
- 已确认死亡NPC不可无理由复活；
- 锁定世界规则不可推翻；
- AI不可替玩家决定行动；
- 关键线索失败后仍可推进；
- 世界时钟推进幅度合法。

失败处理：

1. 请求原模型修复结构；
2. 使用严格修复提示词；
3. 仍失败则不提交状态并保存错误记录。

---

## 28. 自动保存、事件与快照

### 28.1 自动保存时机

- 世界生成完成；
- 世界确认；
- 车卡完成；
- 酒馆生成；
- NPC生成；
- 接受任务；
- 每个冒险回合；
- 冒险结算；
- 模型切换前；
- 应用退出前。

### 28.2 SQLite事务

一次回合更新必须在一个事务中完成：

- 玩家输入；
- 模型输出；
- 任务更新；
- NPC关系；
- 世界事实；
- 事件日志。

任何一步失败时全部回滚。

### 28.3 事件日志

事件示例：

- WORLD_CREATED；
- CHARACTER_CREATED；
- NPC_CREATED；
- QUEST_ACCEPTED；
- PLAYER_ACTION_SUBMITTED；
- DICE_ROLLED；
- FACT_DISCOVERED；
- ITEM_ACQUIRED；
- RELATIONSHIP_CHANGED；
- WORLD_CLOCK_ADVANCED；
- ADVENTURE_COMPLETED；
- MODEL_SWITCHED。

### 28.4 快照

保留：

- 最近10个自动快照；
- 最近3个完整备份；
- 玩家手动快照。

快照时机：

- 每5个冒险回合；
- 每场冒险结束；
- 模型切换前；
- 数据库迁移前。

---

## 29. 存档导入导出

导出格式：`.emtavern`

建议结构：

```text
campaign.emtavern
├─ manifest.json
├─ campaign.json
├─ events.ndjson
├─ generations.json
└─ checksum.json
```

导出内容不包含：

- API Key；
- 登录令牌；
- 安全密钥仓库；
- 临时缓存；
- 应用日志。

导入流程：

```text
读取manifest
→ 校验checksum
→ 检查schemaVersion
→ 数据迁移
→ 创建新存档或覆盖指定存档
→ 写入SQLite
→ 创建导入快照
```

v0.1通过文件手动迁移Windows与iOS存档，不提供实时同步。

---

## 30. API Key与隐私

### 30.1 API Key

API Key不得写入SQLite、普通JSON或导出存档。

Windows使用Stronghold或系统安全存储；iOS使用Stronghold或Keychain能力。

数据库只保存credentialRef。

### 30.2 云模型隐私

本地优先不等于云模型请求不离开设备。

使用云模型时，应用需要把必要上下文发送给所选服务商。

首次使用和跨厂商切换时，必须明确说明：

- 发送哪些类型的数据；
- 发送给哪个服务商；
- 用途是什么；
- 如何更换或关闭。

### 30.3 本地模型

Windows支持Ollama、LM Studio或自定义本地OpenAI兼容服务。

iOS v0.1不直接运行大型本地模型。

---

## 31. 原生服务接口

允许的高层命令：

- provider_test_connection；
- provider_list_models；
- provider_generate；
- secret_save；
- secret_delete；
- secret_exists；
- dice_roll；
- campaign_export；
- campaign_import；
- backup_create；
- backup_restore。

禁止向WebView开放：

- 任意SQL执行；
- 任意文件读取；
- 任意HTTP请求；
- 明文密钥读取。

---

## 32. 错误恢复

### 32.1 额度不足

- 保存玩家输入；
- pending请求标记QUOTA_EXCEEDED；
- 不修改游戏状态；
- 提示更换模型；
- 使用同一上下文重试。

### 32.2 输出格式错误

- 保存原始结果；
- 尝试结构修复；
- 修复失败则不提交。

### 32.3 应用崩溃

启动时检查pending请求和最后完整事务，并提供：

- 继续；
- 重试；
- 更换模型；
- 取消本回合。

### 32.4 数据库异常

- 执行完整性检查；
- 尝试恢复最近快照；
- 保留损坏文件；
- 禁止静默覆盖。

---

## 33. 测试要求

### 33.1 单元测试

必须覆盖：

- 状态机；
- 骰子；
- 关系变化；
- 世界时钟；
- AI状态补丁验证；
- 上下文裁剪；
- 模型切换；
- 数据迁移；
- 导入导出。

### 33.2 Fake Provider

必须内置无需联网的FakeAIProvider，用于：

- UI开发；
- 自动化测试；
- 不消耗额度的演示；
- 定位模型问题；
- 纵向切片验证。

### 33.3 Provider Contract Test

所有Provider必须通过：

- 连接测试；
- 模型列表测试；
- 普通文本测试；
- 结构化输出测试；
- 超时测试；
- 额度不足测试；
- 错误JSON测试。

### 33.4 纵向切片测试

必须完整验证：

```text
创建世界
→ 车卡
→ 生成酒馆
→ NPC对话
→ 接受任务
→ 完成冒险
→ 返回酒馆
→ 切换模型
→ 继续对话
→ 导出存档
→ 删除本地存档
→ 重新导入
→ 继续游戏
```

---

## 34. 开发阶段

### 阶段一：项目骨架

- Workspace；
- Windows和iOS独立项目；
- Shared packages；
- SQLite迁移；
- Fake Provider；
- 基础导航；
- 基础主题。

### 阶段二：Windows离线纵向切片

使用Fake Provider实现完整核心循环。

### 阶段三：真实模型

按顺序接入：

1. OpenAI-Compatible；
2. DeepSeek；
3. Qwen；
4. SiliconFlow或OpenRouter；
5. Ollama；
6. 自定义接口。

### 阶段四：稳定性

- 模型切换；
- pending请求；
- 输出修复；
- 自动快照；
- 导入导出；
- 上下文预算；
- 错误恢复。

### 阶段五：iOS

- 移动端页面；
- SQLite；
- 云模型；
- 文件导入导出；
- 真机测试；
- 签名和打包。

---

## 35. v0.1验收标准

### 35.1 世界与车卡

- 玩家可以选择基础世界偏好；
- 玩家可以选择是否填写提示词；
- AI可以生成结构化世界圣经；
- 玩家可以锁定和局部重生成；
- 玩家可以完成车卡；
- 角色背景和初始装备可以生成并保存。

### 35.2 酒馆与NPC

- 能生成一间酒馆；
- 能生成3名常驻NPC和1名临时访客；
- NPC拥有独立关系、记忆和认知；
- 玩家可以与NPC连续对话；
- 关闭应用后对话仍然存在；
- 切换模型后NPC仍能基于本地历史继续交流。

### 35.3 任务与冒险

- 能生成至少2个任务；
- 能接受一个任务；
- 能生成冒险隐藏骨架；
- 能完成8～12回合冒险；
- 程序可以完成D20检定；
- 失败不会使关键剧情永久中断；
- 冒险结束后能更新NPC、酒馆和世界状态。

### 35.4 本地存档

- 每回合自动保存；
- API额度耗尽时进度不丢失；
- 更换模型后可继续当前回合；
- 应用崩溃后能恢复到最近完整状态；
- 能创建和恢复快照；
- 能导出和重新导入完整存档；
- 导出文件不含API Key。

### 35.5 模型

- OpenAI-Compatible通用接口可用；
- DeepSeek和Qwen预设可用；
- 至少一个免费聚合平台预设可用；
- Windows Ollama可用；
- 自定义Base URL可用；
- Provider连接测试可用；
- 模型能力可登记；
- 结构化输出失败不会破坏存档。

### 35.6 双端

- Windows客户端可独立运行和构建；
- iOS客户端可独立运行和构建；
- 两端共享数据协议；
- 两端可以导入和导出相同`.emtavern`格式；
- iOS不依赖Windows本地模型即可使用云模型继续游戏。

---

## 36. 项目成功标准

项目成功不以接入模型数量为标准，而以以下纵向体验是否稳定为标准：

```text
玩家输入世界构想
→ AI生成世界
→ 完成车卡
→ 进入酒馆
→ 与一个NPC建立关系
→ 接受一个任务
→ 完成一次10回合冒险
→ 返回酒馆看到世界变化
→ 模型额度耗尽
→ 切换到另一个模型
→ 不丢进度地继续游戏
```

只要这条链条稳定、可恢复并具备基本趣味，v0.1即可视为完成。

---

## 37. 后续版本候选

以下内容仅作为后续候选，不进入v0.1：

- 可选加密云备份；
- Windows与iOS同步；
- 局域网连接Windows本地模型；
- AI语音和角色配音；
- AI场景插图；
- 酒馆轻度经营；
- 多人房间；
- 用户自定义规则包；
- 世界模板分享；
- 模组和内容市场；
- NPC关系图；
- 章节回顾和年度纪事。

---

## 38. 最终架构结论

Ember Tavern v0.1采用：

```text
两个独立客户端
+
一套共享游戏核心
+
一个本地SQLite事实库
+
一个模型无关AI编排层
+
一套事件、快照和恢复机制
```

模型负责生成世界和故事，程序负责维持规则、记忆和存档。

模型可以更换，存档不能依赖模型。

API额度可以归零，游戏进度不能归零。
