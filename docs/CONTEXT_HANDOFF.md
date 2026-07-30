# Ember Tavern 上下文交接

## 当前状态

- 分支：`main`
- 最近提交：`M1-T06` 完成提交（以 `git log -1` 为准）
- 已完成里程碑：M0；M1 已完成 `M1-T01` 至 `M1-T06`
- 当前任务：`M1-T06` 已验收，准备提交
- 下一任务：`M1-T07 定义冒险协议`

## 架构摘要

- SQLite 是游戏事实唯一来源；AI 输出必须经结构和业务规则验证。
- Campaign 异常保存恢复阶段；世界事实使用分类联合与替代链。
- 玩家属性、NPC关系由程序限制；NPC知识按角色隔离。
- Quest/Item 的 AI `content` 与程序状态、等级、效果物理分离。

## 关键决策

- `DEC-001`：老板计入三名常驻 NPC。
- `DEC-002`：Cargo 动态验证已完成。
- `DEC-003`：brand ID、canonical UTC、版本和未知枚举策略。
- `DEC-004`：Campaign 异常恢复阶段。
- `DEC-005`：世界事实分类与替代链。
- `DEC-006`：AI创作字段与程序规则字段物理分离。

## 环境与限制

- Node.js `v24.17.0`，pnpm `11.9.0`；Rustc/Cargo `1.97.1`。
- 所有缓存、下载、构建和临时文件位于 `.local/`。
- iOS真机/签名需要 macOS/Xcode；真实云测试需要安全提供的 API Key。

## 最近成功验证

- `pnpm check`：通过。
- Vitest：6 个文件、49 个测试通过。
- Rust fmt、严格 Clippy、workspace test 通过。

## 恢复步骤

1. 完整读取规则、规格、任务、日志、决策、README、`LOG.md` 和本文件。
2. 检查 Git并设置 `.local/` 环境变量。
3. 从 `M1-T07` 定义 AdventurePlan、AdventureState、AdventureTurn、PlayerAction、CheckRequest、DiceResult、AdventureEnding 和 Clue。
4. 实现冒险状态机非法迁移拒绝测试，通过根质量门后独立提交。
