# Ember Tavern 上下文交接

## 当前状态

- 分支：`main`
- 最近完成任务：`M1-T10 定义GameEvent事件协议`
- 已完成里程碑：M0、M1
- 当前任务：`M1-T10` 已验收，准备提交
- 下一任务：`M2-T01 设计SQLite ER模型`

## 架构摘要

- SQLite是游戏事实唯一来源；AI输出必须经结构和业务规则验证。
- Campaign、世界、角色、NPC、任务/物品、冒险和GameEvent协议已建立。
- AI文本与程序规则物理分离；D20由可注入本地随机源结算。
- 关系与世界时钟使用单步原子补丁；GameEvent使用带版本公共信封的判别联合。

## 关键决策

- `DEC-001`至`DEC-009`记录NPC数量、Cargo验收、基础类型、恢复、世界事实、AI/规则边界、随机源、原子补丁和事件协议。

## 环境与限制

- Node.js `v24.17.0`，pnpm `11.9.0`；Rustc/Cargo `1.97.1`。
- 缓存、下载、构建和临时文件位于`.local/`。
- iOS真机/签名需要macOS/Xcode；真实云测试需要安全提供的API Key。

## 最近成功验证

- `pnpm check`：通过。
- Vitest：10个文件、92个测试通过。
- TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和workspace test通过。

## 恢复步骤

1. 完整读取规则、规格、任务、日志、决策、README、`LOG.md`和本文件。
2. 检查Git并设置`.local/`环境变量。
3. 完成并提交当前 `M1-T10` 变更。
4. 从 `M2-T01` 依据规格全部核心表和现有M1协议设计 `docs/data-model.md`，不提前创建迁移。
