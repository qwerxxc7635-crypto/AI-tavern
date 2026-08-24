# V0.3 Visual System Convergence Gate

状态：PASS（M10-T07，2026-08-24）

规范：[`EMBER_TAVERN_VISUAL_STYLE_GUIDE_V1.md`](../EMBER_TAVERN_VISUAL_STYLE_GUIDE_V1.md)

## 1. 范围与边界

本 Gate 按 `Design Tokens → UI Primitives → Game Components → Feature Pages → Legacy UI Migration → Visual Consistency Audit` 收敛 Windows 桌面纵向切片。只修改视觉值来源、共享展示合同和键盘可达性；没有修改 Rules Engine、D20 硬结果、AI Provider、Generator/Queue、SQLite、存档、World Seed/Constitution 或 Quest/NPC/Adventure 业务合同。

没有创建第二套组件库，也没有引入 Tailwind、shadcn 或新的运行时主题框架。历史 class 作为页面兼容适配层保留，但颜色、字体、间距、圆角、Border、Shadow 与 Motion 均改为读取同一套 Semantic/Component Token。

## 2. Token 与视觉债务复算

- `design-tokens.css` 是唯一允许保存 raw color/rgb 的应用样式文件；`theme.css`、`ui/primitives.css` 和 `ui/game-components.css` 的 raw color 从 41 处降为 0。
- 应用 CSS 不再直接读取 `--et-*` Primitive；组件与页面只读取 Semantic/Component Token。
- font family/size/weight、line height、letter spacing、margin/padding/gap、radius、border width、shadow 和 animation duration/easing 已进入静态门。媒体查询阈值、运行时几何宽高、百分比与 keyframe 变换不冒充视觉 Token。
- 核心色板收敛到暖黑 `#12100e`、酒馆深棕 `#1b1713`、深木 `#2a211a`、羊皮纸 `#e8d6b3`、主墨色 `#30271f`、余烬金 `#d59a3a`；正文、次级文本、焦点、Paper 正向/危险文本均通过既定 WCAG 对比度测试。
- 卡片/控件圆角分别冻结到 10px/6px 语义层；16px 只用于较大容器，装饰性拱形使用具名 illustration token。没有 20–30px 大圆角堆叠。

## 3. 组件复用清单

| 功能边界 | 复用合同 | 状态证据 |
| --- | --- | --- |
| Character / Trait | `CharacterCard`、`TraitCard`、`AIFieldAssist` | card/selected/locked/error/undo 组件测试；车卡页面测试 |
| Tavern / NPC | `NpcCard`、`DialogueView`、`ActionComposer` | selected、empty、loading、system/player/NPC message、retry/cancel |
| Quest | `QuestCard` | status/risk/selected 与任务页行为测试 |
| Adventure / D20 | `ActionComposer`、`D20Animation`、共享 `Button` | streaming、error、skip、reduced-motion 立即 reveal |
| Narrative / Generation | `DialogueView`、`GenerationPanel`、`StatusPanel` | loading/streaming/complete/error/empty |
| 通用 UI | 既有 Button/Input/Textarea/Select/Card/Modal/Drawer/Tabs/Tooltip/Toast/Skeleton/Progress/Empty/Error | keyboard、focus、overlay、forced-colors、reduced-motion |

`visual-convergence.test.ts` 固定上述生产页面导入关系、Feature 边界与状态选择器，防止后续另建平行组件。

## 4. 页面与状态矩阵

| 页面/组件族 | Loading | Empty | Error | Selected/Active | Streaming/Progress | 视觉结论 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Saves / World / Recovery | ✓ | ✓ | ✓ | n/a | ✓ | Ember 深色、离线事实优先 |
| Character / Trait | ✓ | ✓ | ✓ | ✓ | ✓ | 角色手册层级；合同未改 |
| Tavern / NPC / Narrative | ✓ | ✓ | ✓ | ✓ | ✓ | TRPG 记录而非聊天气泡 |
| Quest / Adventure / D20 | ✓ | ✓ | ✓ | ✓ | ✓ | Paper 手册局部主题；硬结果不变 |
| Archives / My / Settings | ✓ | ✓ | ✓ | ✓ | ✓ | 低装饰密度桌面 HUD；Provider 后置 |
| Toast / Modal / Drawer | n/a | n/a | ✓ | ✓ | ✓ | 一套 primitive、非颜色状态与焦点可见 |

矩阵由相应页面 Vitest、`ui/primitives.test.tsx`、`ui/game-components.test.tsx`、`d20-animation.test.tsx` 与本任务静态门共同固定。V0.2 的 12 页面 × 4 视口填充态证据仍作为迁移前页面结构基线；本任务没有修改其业务语义或数据合同。

## 5. 四视口与浏览器证据

真实 Chromium 使用本地 Vite 渲染并逐张检查。浏览器环境不伪造 Tauri/SQLite 成功结果：Saves、Settings、Quest 截图中的本地读取失败是诚实 error-state 证据，不用于证明 Native 持久化；Native 行为继续由独立桌面门禁负责。

| 视口 | 页面 | document 宽度 | 横向越界 | 证据 |
| --- | --- | ---: | ---: | --- |
| 860×600 | Settings | 860 | 0 | [`settings.png`](evidence/v0.3-visual-convergence/860x600/settings.png) |
| 1180×760 | My | 1180 | 0 | [`my.png`](evidence/v0.3-visual-convergence/1180x760/my.png) |
| 1366×768 | Saves | 1366 | 0 | [`saves.png`](evidence/v0.3-visual-convergence/1366x768/saves.png) |
| 1920×1080 | Quest Paper/error | 1920 | 0 | [`quests-error.png`](evidence/v0.3-visual-convergence/1920x1080/quests-error.png) |

四个视口的 `document.scrollWidth === innerWidth`，可见后代越过左右边界均为 0；长页面由 `.workspace__main` 或独立页面滚动 owner 保持关键操作可达。哈希见 [`SHA256SUMS`](evidence/v0.3-visual-convergence/SHA256SUMS)。

## 6. Accessibility、Focus 与 Motion

- 新增首个 Tab 可达的“跳到主要内容”入口；Enter 后焦点落在 `#app-main`，不会改变 HashRouter 路由。真实浏览器焦点环为 2px、非颜色可见，证据见 [`focus-skip-link.png`](evidence/v0.3-visual-convergence/1920x1080/focus-skip-link.png)。
- active/selected/error 除颜色外还使用 `aria-current`、`aria-selected`/`aria-pressed`、边框、左侧结构线、文本或角色状态；forced-colors 合同保留。
- `prefers-reduced-motion: reduce` 的真实 Chromium 结果：media query 为 `true`，D20 与 Spinner 的 `animation-name` 均为 `none`，navigation transition duration 为 `0s`。
- D20 的“跳过动画”继续直接 reveal 已保存结果；reduced-motion 自动以 0ms reveal，绝不重新投掷或改变硬结果。

## 7. 结论

M10-T07 适用视觉债务已关闭，没有已知未记录差异。M12-T01 仍会作为独立发布复核重新计算本 Gate，而不是沿用本结论；如发现新差异，必须进入 M12 findings ledger 并由 M12-T02 修复或明确裁决。
