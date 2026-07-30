# Ember Tavern 上下文交接

## 当前状态

- 分支：`main`
- 最近提交：`M1-T04` 完成提交（以 `git log -1` 为准）
- 已完成里程碑：M0；M1 已完成 `M1-T01` 至 `M1-T04`
- 当前任务：`M1-T04` 已验收，准备提交
- 下一任务：`M1-T05 定义酒馆与 NPC 协议`

## 架构摘要

- 本地 SQLite 是游戏事实的唯一真实数据源；AI 只能提出经验证的内容或状态建议。
- 根质量门统一执行 Prettier、ESLint、严格 TypeScript、Vitest、Rust fmt、Clippy 和测试。
- Campaign 异常状态保存 `resumeState`，归档为终态。
- 世界事实使用五类判别联合；发展事实以 `supersedesFactId` 保留演进链。

## 关键决策

- `DEC-001`：酒馆老板计入三名常驻 NPC。
- `DEC-002`：Cargo 动态验证已在 `M0-T03` 完成。
- `DEC-003`：brand ID、canonical UTC、正整数版本和未知枚举保留。
- `DEC-004`：Campaign 异常状态保存并限制恢复阶段。
- `DEC-005`：世界事实采用分类联合与替代链。

## 环境与限制

- Node.js `v24.17.0`，pnpm `11.9.0`；Rustc/Cargo `1.97.1`。
- 所有新增缓存、下载、构建和临时文件必须位于仓库 `.local/`。
- iOS 模拟器、真机和签名验证需要 macOS/Xcode。
- 真实云模型连接测试需要安全提供的 API Key；没有 Key 时使用 Fake Provider 和 mock。

## 最近成功验证

- `pnpm check`：通过。
- Vitest：3 个文件、29 个测试通过。
- Rust fmt、严格 Clippy、workspace test 通过。

## 恢复步骤

1. 完整读取仓库规则、规格、任务、日志、决策、README、`LOG.md` 和本文件。
2. 检查 Git 状态与最近提交并设置 `.local/` 环境变量。
3. 从 `M1-T04` 定义玩家角色、四属性、职业原型、特质、目标、背景、内容边界和初始装备引用。
4. 为属性分配总点数和单项上限添加真实测试，通过根质量门后独立提交。
