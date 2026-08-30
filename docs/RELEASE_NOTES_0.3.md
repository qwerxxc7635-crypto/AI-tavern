# Ember Tavern v0.3.0

## Highlights

v0.3.0 完成 Ember Tavern 的 Ember Rebuild：世界、角色、酒馆、NPC、任务、冒险、D20、结算与存档现在共享同一套本地规则、AI 生成边界和 SQLite 事实源。Windows 与 macOS 桌面构建均由正式 GitHub Actions 流程生成和验证。

## Major Changes

- 世界生成加入世界宪法、确定性种子、动态地点、活跃势力、世界导演、按需生成与有界预取。
- 角色创建支持快速/高级车卡、动态职业池、Trait 点数、协同与平衡验证、语义装备和可恢复草稿。
- 酒馆支持持久 NPC LOD、动态人口、多 NPC 场景、不可变时间线、知识边界和对话建议。
- Quest 升级为多任务池、确定性任务图和动态来源；Adventure 支持自由输入、本地 D20、规则事务、原子结算和恢复。
- 统一 AI Provider、模型设置、结构化输出、一次修复、流式取消、生成队列、fallback 授权和脱敏审计。
- 存档升级到 V0.3 Schema，覆盖迁移、备份、恢复、导入导出、资源上限、秘密扫描和 TypeScript/Rust 互操作。
- 桌面 UI 收敛到统一设计令牌、基础组件和游戏组件，并完成多视口、键盘焦点与 reduced-motion 检查。

## Stability & QA

- Vitest：189 files / 1091 tests passed；2 files / 6 tests 按明确环境合同 skipped。
- Node：30/30 passed。
- Rust：153 passed；1 个需要显式真实 Credential 的测试 ignored。
- SQLite：迁移、备份、foreign key、integrity、重开、恢复和 archive interop 门禁通过。
- Playtest：Fantasy、Investigation、Cyberpunk 各 32 项，加自由输入 8 项，共 104 项行为复算通过。
- 性能：24 项确定性阈值通过；真实 Provider token 与计费 cache 指标保持 `NOT_EVALUATED`。
- 二轮独立审计开放 P0/P1/P2/P3 为 0；三项 RC 实测阻断均已修复并复验。

## Known Limitations

- 构建产物未做商业代码签名或 Apple notarization，首次启动可能显示操作系统安全提示。
- iOS 与 Linux 不属于 v0.3.0 发布范围。
- Fake Provider 长测不代表所有真实模型的长期文风、费用或计费缓存表现。
