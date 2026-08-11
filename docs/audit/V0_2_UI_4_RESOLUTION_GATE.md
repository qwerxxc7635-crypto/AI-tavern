# Ember Tavern v0.2 四分辨率 UI Gate

## 结论

M9-T04 已通过。12 个核心页面在 860x600、1180x760、1366x768、1920x1080 四个指定分辨率下均完成加载、控制台、横向溢出、裁切和视觉检查。修复后未发现控制台错误、文档或主内容横向溢出、裁切后代元素。

## 范围

检查页面：

1. 存档（saves）
2. 世界（world）
3. 创建角色（character-create）
4. 酒馆（tavern）
5. NPC 对话（npc）
6. 任务（quests）
7. 冒险（adventure）
8. 角色卡（character-sheet）
9. 档案（archives）
10. 我的（my）
11. 设置（settings）
12. 恢复（recovery）

每个页面均在四个指定分辨率下生成最终截图，共 48 张；另保留 4 张问题修复前截图。全部 52 张 PNG 的 SHA-256 摘要记录在 `docs/audit/evidence/v0.2-ui-gate/SHA256SUMS`。

## 验证方法

1. 使用 headed Google Chrome 加载 Vite 页面。
2. 每次导航后等待页面专用的最终就绪选择器，避免把 Suspense 加载态误判为最终页面。
3. 截图前后分别检查控制台错误。
4. 测量 document 与 main 的横向溢出，并检查所有可见后代是否越过视口或主内容边界。
5. 对 48 张最终截图逐张进行视觉检查。
6. 对每个缺陷实施最小修复、独立提交、针对性回归测试和页面复测。

## 缺陷与修复

| 缺陷 | 严重度 | 修复 | 回归测试 | 结果 |
| --- | --- | --- | --- | --- |
| 模型设置页标题栏显示“未知路径” | Medium | `ad5e1d4` | `c867eb9` | verified |
| 对话、任务、冒险的纸张主题文字对比度不足 | High | `df8c687` | `ff3d11f` | verified |
| 860 宽度下核心页面断点未计入侧栏，导致横向裁切 | High | `69fa696` | `ca2d5fb` | verified |
| 860 宽度下“我的”页仍保持双栏，导致内容裁切 | High | `d83c00a` | `40f32c3` | verified |

修复前证据位于 `docs/audit/evidence/v0.2-ui-gate/issues/before/`；修复后证据位于对应分辨率目录。QA 健康分从 94 提升至 100。

## 最终结果

| 指标 | 结果 |
| --- | --- |
| 页面/分辨率组合 | 48/48 通过 |
| 最终控制台错误 | 0 |
| document 横向溢出 | 0 |
| main 横向溢出 | 0 |
| 裁切后代元素 | 0 |
| 已发现缺陷 | 4 |
| verified 修复 | 4 |
| deferred / reverted / best-effort | 0 / 0 / 0 |

## 安全边界与限制

视觉 Gate 使用仅存在于临时 QA 工作树的确定性 Tauri IPC fixture，为页面提供本地、可复现的展示数据。fixture 不进入产品提交，不调用真实或付费模型，不读取或写入正式用户数据，不包含 API Key。

本 Gate 只证明指定页面和分辨率下的 UI 表现。原生 Tauri 打包、命令、持久化与安全行为由 M9-T02 Windows Gate 和 M9-T03 macOS Gate 的独立证据证明，不能用本视觉 fixture 替代。
