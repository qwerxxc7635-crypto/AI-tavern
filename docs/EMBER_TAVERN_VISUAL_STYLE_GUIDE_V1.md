# Ember Tavern 视觉风格手册 V1.0

**项目：** Ember Tavern / 4D
**适用版本：** V0.3+
**适用范围：** 桌面端 UI、游戏界面、角色卡、酒馆、NPC、任务、冒险、D20、AI 生成界面、设置界面
**设计关键词：**

> 黑暗奇幻 / 温暖酒馆 / 羊皮纸 / 木材 / 黄铜 / 火光 / TRPG / 沉浸 / 克制 / 现代 HUD

---

# 1. 视觉定位

Ember Tavern 的视觉目标不是制作一个“套着奇幻皮肤的 AI 聊天软件”，而是让玩家产生：

> **“我正在使用一本会自己书写故事的数字冒险手册。”**

整体视觉由三层构成：

### 世界层：黑暗奇幻酒馆

负责营造氛围。

主要元素：

* 深色木材
* 火焰
* 烛光
* 黄铜
* 石墙
* 酒杯
* 壁炉
* 阴影
* 夜晚
* 手绘奇幻插画

### 信息层：TRPG 冒险手册

负责呈现：

* 世界观
* 角色
* NPC
* 任务
* 装备
* 属性
* 特质
* 骰子结果
* 冒险日志

视觉语言：

* 羊皮纸
* 卡片
* 印章
* 手稿
* 标签
* 徽章
* D20 图形

### 交互层：现代游戏 HUD

负责保证软件真正“好用”。

包括：

* 导航栏
* 按钮
* 输入框
* AI 生成
* Loading
* Toast
* Modal
* 设置
* Provider 状态
* 保存状态

这一层必须简洁。

**不要为了奇幻感牺牲操作效率。**

---

# 2. 核心设计原则

## 2.1 沉浸优先

玩家进入游戏后，应尽量减少“正在操作软件”的感觉。

避免：

* 大面积纯白界面
* SaaS 风格 Dashboard
* 类 ChatGPT 聊天气泡
* 过多蓝色按钮
* 大量现代办公软件图标

应该更接近：

**游戏界面 + TRPG 工具 + 奇幻冒险手册。**

---

## 2.2 内容优先于装饰

AI 会生成大量文本。

因此视觉设计必须支持：

* 长文本阅读
* 多 NPC
* 多任务
* 多事件
* 多状态
* 多特质
* 长时间游戏

装饰不能侵占主要阅读区域。

建议：

**80% 信息 / 20% 氛围装饰。**

---

## 2.3 层级必须明显

任何页面原则上只有一个最重要的信息焦点。

视觉优先级：

**剧情 / 当前事件**

↓

**玩家可以执行的行动**

↓

**角色 / NPC / 任务状态**

↓

**系统信息**

↓

**AI / Provider / Debug 信息**

技术信息不得抢占游戏内容。

---

# 3. 色彩系统

整体采用：

**暖黑 + 深棕 + 羊皮纸 + 琥珀金**

作为基础。

## 3.1 Background

### Obsidian

`#12100E`

应用：

* App 主背景
* 深色区域
* Modal 背景

### Tavern Dark

`#1B1713`

应用：

* 主面板
* Sidebar
* 游戏 HUD

### Dark Wood

`#2A211A`

应用：

* Card
* Panel
* 二级背景

---

# 4. 羊皮纸系统

不要使用纯白。

### Parchment Light

`#E8D6B3`

### Parchment

`#D2B98C`

### Parchment Dark

`#A88B60`

主要应用：

* 文本阅读区域
* 角色资料
* 世界设定
* 日志
* 任务详情

羊皮纸区域不应该铺满整个 App。

推荐采用：

**深色 UI + 局部羊皮纸信息卡**

形成视觉对比。

---

# 5. 强调色

## Ember Gold

`#D59A3A`

项目核心品牌色。

用于：

* 主按钮
* 当前任务
* Hover
* D20
* AI Generate
* 关键数字
* Selected 状态

---

## Fire Amber

`#F0B45A`

用于：

* 火焰
* Highlight
* Active
* Loading

不要大面积使用。

---

## Blood Red

`#8F3535`

用于：

* 危险
* HP 低
* 战斗
* 严重 Debuff
* 删除

---

## Forest Green

`#56724C`

用于：

* Buff
* 成功
* 治疗
* 正面状态

---

## Arcane Purple

`#72588F`

用于：

* 魔法
* 神秘事件
* 特殊能力
* 极稀有内容

---

# 6. 文本颜色

Primary：

`#E7DED0`

Secondary：

`#B9AA96`

Muted：

`#807568`

Dark Text：

`#30271F`

Disabled：

`#625B52`

禁止使用：

`#FFFFFF`

作为大面积正文。

纯白在深色背景上对比过强，会破坏酒馆的柔和视觉。

---

# 7. 字体系统

建议采用：

## UI

现代、易读字体。

中文推荐：

**思源黑体 / Noto Sans SC**

用于：

* Button
* Navigation
* Setting
* Tooltip
* Input
* 数字

---

## Narrative

剧情正文可以使用稍有文学感的字体。

中文：

**思源宋体 / Noto Serif SC**

用于：

* 世界介绍
* 剧情
* NPC 描述
* 任务背景
* Lore

---

## Numbers

角色属性、D20、HP 等数字：

使用更粗、更清晰的 UI 字体。

例如：

**Inter / Noto Sans**

---

# 8. 字体层级

建议：

### Display

32–40 px

用于：

* 世界名称
* 章节标题
* 重大事件

### H1

24–28 px

页面标题。

### H2

20–22 px

模块标题。

### H3

16–18 px

卡片标题。

### Body

15–17 px

剧情正文。

建议：

**16 px / 1.7 line-height**

保证 AI 长文本阅读体验。

### Caption

12–13 px

状态、时间、辅助信息。

---

# 9. Layout

桌面端采用：

**Sidebar + Main Stage + Context Panel**

结构。

```text
┌──────────┬─────────────────────────────┬──────────────┐
│          │                             │              │
│ Sidebar  │        Main Stage           │ Context      │
│          │                             │ Panel        │
│ 酒馆     │ 剧情 / NPC / 冒险 / 战斗   │ 角色/任务    │
│ 角色     │                             │ NPC/状态     │
│ 任务     │                             │              │
│ 世界     │                             │              │
│          │                             │              │
└──────────┴─────────────────────────────┴──────────────┘
```

推荐宽度：

Sidebar：

`200–240px`

Context Panel：

`280–340px`

Main：

自动填充。

---

# 10. Sidebar

Sidebar 不应该像后台管理系统。

视觉：

* 深木色
* 微弱纹理
* 少量金色线条
* 图标 + 文字

导航：

酒馆

冒险

角色

任务

世界

日志

我的

设置

当前页面使用：

**左侧 Ember Gold 细线 + 微弱暖色背景**

而不是巨大高亮按钮。

---

# 11. Card 系统

卡片是 Ember Tavern 最重要的 UI 元素之一。

统一分为四种。

## Standard Card

用于普通 UI 信息。

特点：

* Dark Wood 背景
* 8–12px Radius
* 极轻 Border
* 微弱 Shadow

---

## Parchment Card

用于：

* Lore
* 任务
* 信件
* 世界信息
* 角色背景

特点：

* 羊皮纸背景
* 深色字体
* 微弱纸张纹理

不要制作过度夸张的破损边缘。

---

## Character Card

用于：

* 玩家
* NPC
* 敌人

结构：

```text
[Portrait]

NPC Name
身份 / 种族 / 职业

──────

关系
状态
特质

──────

[交谈] [观察]
```

---

## Quest Card

结构：

```text
任务名称

● 主线
● 支线
● 隐藏
● 已完成

任务描述

目标
○ 前往旧矿井
○ 找到失踪商人
○ 返回酒馆

奖励 / 风险
```

任务必须明显区分状态。

---

# 12. NPC 视觉系统

NPC 是项目最重要的内容之一。

每个 NPC 建议拥有：

* Portrait
* Name
* Identity
* Relationship
* Mood
* Memory Indicator
* Traits
* Current Goal

NPC 关系可以使用：

敌对

冷淡

陌生

熟悉

友好

信任

亲密

但不要完全游戏化成单纯数值。

可以同时显示：

**“他似乎开始信任你。”**

而不是：

`好感度 +3`

---

# 13. 对话界面

禁止直接复制 ChatGPT 风格：

```text
User Bubble

AI Bubble

User Bubble
```

推荐采用：

**Visual Novel + TRPG Log**

NPC 发言：

```text
[Portrait]

伊琳娜
酒馆老板

“外面又开始下雨了。”

她擦拭着杯子，目光短暂地落在你的剑上。
```

玩家行动区域：

```text
你准备怎么做？

[询问最近发生的事情]
[点一杯酒]
[观察酒馆里的客人]
[离开]

────────────────

或者描述你的行动……

[                         ]

                [行动]
```

---

# 14. AI 生成按钮

由于 AI Generate 是核心功能，它必须拥有统一视觉语言。

建议：

**✦ AI 生成**

或：

**✦ 让命运决定**

不同场景可以使用不同文案。

例如：

角色：

**✦ 随机生成角色**

背景：

**✦ 生成背景故事**

特质：

**✦ 重新生成特质**

任务：

**✦ 生成任务**

世界：

**✦ 构筑世界**

AI 图标统一使用：

**四角星 / Spark**

不要大量使用机器人图标。

AI 应该表现为：

**世界背后的“命运系统”**

而不是一个机器人助手。

---

# 15. Character Sheet / 车卡

车卡必须明显借鉴传统 TRPG。

结构：

```text
────────────────────────
角色名称        Lv / 职业
────────────────────────

STR   DEX   CON
 14    12    16

INT   WIS   CHA
 10    13    15

────────────────────────

HP

Armor

Initiative

────────────────────────

Traits

+ 夜视              -2
+ 强健              -2
- 嗜酒              +1
- 怕火              +3

当前特质点数：

0

────────────────────────

背景故事

装备

技能

────────────────────────
```

---

# 16. Trait 特质系统

V0.3 特质系统是核心玩法之一。

视觉必须清晰区分：

## Buff

绿色或金色。

例如：

`强健  -2`

## Debuff

暗红色。

例如：

`恐高  +2`

玩家需要满足：

**Trait Points = 0**

才能开始游戏。

底部显示：

```text
特质点数

+2
```

未满足：

**还需要平衡 2 点特质。**

满足：

**✓ 命运已经平衡**

然后：

**开始冒险**

按钮激活。

---

# 17. D20 系统

D20 是最应该拥有视觉表现力的交互之一。

正常状态：

中央出现 D20。

点击：

骰子旋转。

背景轻微变暗。

最终：

```text
       17

      + 3

────────────

      20

成功
```

Critical：

Natural 20

使用：

* 金色
* 火星
* 强烈但短暂的 Glow

Critical Failure：

Natural 1

使用：

* 暗红
* 极轻震动

禁止：

过度粒子特效。

---

# 18. Adventure Screen

冒险界面必须让玩家注意力集中在：

**发生了什么 → 我能做什么**

推荐：

```text
CHAPTER III

沉没的钟楼

────────────────

剧情正文……

NPC 对话……

环境描述……

────────────────

建议行动

[检查井口]

[询问守卫]

[点燃火把]

────────────────

描述你的行动

[                              ]

                        [行动]
```

右侧：

```text
当前任务

寻找失踪者

● 调查钟楼
○ 找到地下入口
○ 搜索失踪者


附近人物

守卫 ×2
神秘老人


状态

HP 18/22
潮湿
警觉
```

---

# 19. 酒馆主页

酒馆应该是整个产品最有辨识度的页面。

背景可以使用：

**AI 生成的奇幻酒馆插画。**

但是必须覆盖：

20–40% Dark Overlay

保证 UI 可读。

主要视觉：

```text
EMBER TAVERN

今晚，故事从这里开始。

[继续冒险]

[开始新的故事]
```

下面显示：

最近存档。

酒馆里的 NPC 可以作为视觉背景的一部分。

---

# 20. Loading

AI 生成可能需要数秒甚至更长时间。

禁止：

单纯显示：

`Loading...`

应该使用世界观文案。

例如：

世界生成：

**正在构筑世界……**

NPC：

**有人推开了酒馆的门……**

任务：

**新的传闻正在酒馆中流传……**

剧情：

**命运正在书写接下来的故事……**

角色：

**命运正在塑造这个灵魂……**

同时显示微弱动态：

`✦ · ✦ · ✦`

---

# 21. Streaming

模型 Streaming 输出时：

文本逐渐出现。

不要使用明显的聊天机器人光标。

推荐使用：

微弱 Ember Gold 光标：

`▌`

结束后淡出。

---

# 22. Motion

动画原则：

**慢一点、稳一点、少一点。**

推荐：

Hover：

`120–160ms`

Panel：

`180–240ms`

Modal：

`200–280ms`

重大剧情：

`300–500ms`

动画 Curve：

`ease-out`

避免：

* 弹跳
* 卡通动画
* 高频缩放
* 大面积 Blur
* 大量粒子

---

# 23. Hover

按钮 Hover：

* Brightness +5%
* Border 稍亮
* Y = -1px

Card Hover：

* Border 变为暖色
* Shadow 微微增强

不要：

Scale 1.1

这种明显放大。

---

# 24. Border

主要 Border：

`rgba(213,154,58,0.15)`

强调：

`rgba(213,154,58,0.4)`

尽量使用：

**1px**

不要到处使用粗金边。

金色必须克制，否则容易产生廉价页游感。

---

# 25. Radius

统一 Radius 系统：

Small：

`6px`

Medium：

`10px`

Large：

`14px`

Modal：

`16px`

不要使用：

20–30px 超圆角。

Ember Tavern 不是移动互联网社交 App。

---

# 26. Shadow

Shadow 应模拟：

**烛光环境中的物体层级。**

推荐：

```css
box-shadow:
  0 8px 24px rgba(0, 0, 0, 0.28);
```

避免：

强烈 Neon Glow。

只有：

* D20
* 魔法
* Critical
* AI Generate

允许有限 Glow。

---

# 27. Icon

建议统一：

**Lucide 风格线性 Icon**

特点：

* 简单
* 统一
* 1.5–2px Stroke

游戏特殊元素可以单独制作：

* D20
* Quest
* Trait
* Magic
* Tavern
* Character

不要混合：

Emoji + Lucide + Material + FontAwesome

形成视觉污染。

---

# 28. Texture

允许使用：

* Wood
* Paper
* Leather
* Stone
* Smoke

但是透明度必须低。

建议：

`2–8%`

Texture 的作用是：

**让用户感觉到材质。**

而不是：

**让用户看到一张材质图片。**

---

# 29. 图片风格

AI 图片统一采用：

**Dark Fantasy Digital Painting**

关键词：

* Painterly
* Cinematic
* Warm Firelight
* Dark Fantasy
* Medieval Tavern
* Atmospheric
* Realistic Fantasy

避免：

* Anime
* Q版
* 卡通
* 赛博朋克
* 高饱和
* 二次元手游 UI

除非未来允许用户选择 Theme。

---

# 30. 设置页面

设置页可以适当降低奇幻元素。

原因：

设置属于工具操作。

推荐：

```text
设置

模型

Provider
DeepSeek

Model
DeepSeek V4 Flash

API Key
••••••••••

高级设置
```

采用现代 Desktop UI。

但继续使用项目颜色系统。

---

# 31. Provider 状态

Provider 信息不能进入主要游戏区域。

例如：

右下角：

`● DeepSeek V4 Flash`

绿色：

Online

黄色：

Generating

红色：

Error

点击才展开详细信息。

---

# 32. Toast

成功：

`✓ 冒险已保存`

AI：

`✦ 世界生成完成`

错误：

`生成失败`

并提供：

**重试**

不要显示大量技术错误。

技术错误进入：

**Details**

---

# 33. Empty State

不要：

`No Data`

应该使用世界观语言。

任务为空：

**目前没有新的委托。**

NPC：

**这里暂时没有其他人。**

冒险：

**你的故事尚未开始。**

存档：

**这里还没有留下任何故事。**

---

# 34. Responsive

当前优先 Desktop。

建议最低：

`1280 × 720`

主要优化：

`1440 × 900`

`1920 × 1080`

不要为了兼容极小窗口导致 Desktop UI 过度压缩。

窗口较小时：

右侧 Context Panel 自动 Collapse。

---

# 35. Accessibility

奇幻风格不能影响可访问性。

必须保证：

* 正文 Contrast ≥ WCAG AA
* Button 有 Keyboard Focus
* 不依赖颜色单独表达 Buff/Debuff
* 动画可以关闭
* D20 动画可以跳过
* 字号可以适当调整
* Streaming 不影响阅读

---

# 36. Design Tokens

建议 V0.3 重构时建立统一 Token。

例如：

```css
--bg-app
--bg-panel
--bg-card

--surface-parchment

--text-primary
--text-secondary
--text-muted

--accent-ember
--accent-fire

--status-success
--status-danger
--status-magic

--border-subtle
--border-active

--radius-sm
--radius-md
--radius-lg

--shadow-card
--shadow-modal

--space-xs
--space-sm
--space-md
--space-lg
--space-xl
```

禁止组件自行随意定义颜色。

---

# 37. CSS 架构原则

V0.3 UI 重构后：

禁止：

```text
ComponentA.css
#d79b32

ComponentB.css
#d89c31

ComponentC.css
#d69a35
```

这种重复硬编码。

必须：

```text
Design Token
      ↓
Theme
      ↓
Primitive
      ↓
Component
      ↓
Feature UI
```

---

# 38. Component Architecture

建议：

```text
UI Primitive

Button
Input
Textarea
Select
Card
Modal
Tooltip
Badge
Tabs
ScrollArea
Progress
Divider

↓

Game Component

CharacterCard
NpcCard
QuestCard
TraitCard
D20
NarrativePanel
ActionPanel
InventorySlot

↓

Feature

Tavern
CharacterCreation
Adventure
Quest
World
Profile
Settings
```

---

# 39. 禁止事项

Ember Tavern 不应该出现以下设计倾向：

### ❌ ChatGPT Clone

大量聊天气泡。

### ❌ SaaS Dashboard

白色背景 + 蓝色按钮 + 数据面板。

### ❌ Mobile App Desktopification

巨大圆角。

巨大按钮。

大量 Floating Card。

### ❌ Cheap Fantasy

到处：

* 金边
* 龙
* 火焰
* 羊皮纸
* 哥特字体

### ❌ MMORPG HUD

几十个技能栏和状态条。

### ❌ AI Branding Overload

不要到处出现：

AI

GPT

LLM

机器人 Icon。

玩家应该看到的是：

**世界。**

而不是：

**模型。**

---

# 40. Ember Tavern 的视觉公式

最终视觉公式：

**40% Dark Fantasy Tavern**

*

**30% TRPG Character Sheet**

*

**20% Modern Desktop Game UI**

*

**10% AI Generative Identity**

=

# Ember Tavern

玩家打开软件时：

第一感觉应该是：

> “这是一款奇幻跑团游戏。”

第二感觉：

> “这里的一切似乎都是活的。”

第三感觉才应该是：

> “原来这些内容都是 AI 生成的。”

这就是 Ember Tavern V0.3 UI 重构需要遵守的最高视觉原则。
