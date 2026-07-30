# Ember Tavern 上下文交接

## 当前状态

- 分支：`main`
- 最近完成任务：`M2-T02 创建首版数据库迁移`
- 已完成里程碑：M0、M1；M2已完成 `M2-T01`、`M2-T02`
- 当前任务：`M2-T02` 已验收，准备提交
- 下一任务：`M2-T03 实现Campaign Repository`

## 架构摘要

- SQLite是游戏事实唯一来源；AI输出必须经结构和业务规则验证。
- `docs/data-model.md` 定义22张核心表；`0001_initial.sql` 已真实迁移验证。
- 迁移使用 `schema_migrations` 和单一事务，重复启动按版本跳过。
- API Key不入库，Provider配置只保存安全存储 `credential_ref`。

## 关键决策

- `DEC-001`至`DEC-011`记录从NPC数量到SQLite模型和事务迁移的架构选择。

## 环境与限制

- Node.js `v24.17.0`，pnpm `11.9.0`；Rustc/Cargo `1.97.1`。
- 缓存、下载、构建和临时文件位于`.local/`。
- Node 24内置SQLite用于当前迁移执行和测试；平台原生连接策略尚未实现。

## 最近成功验证

- 首次迁移：22张核心表、1条迁移版本记录；重复启动无重复。
- `pnpm check`：通过；Vitest 92项、Node SQLite 3项通过。
- TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和workspace test通过。

## 恢复步骤

1. 完整读取规则、规格、任务、日志、决策、README、`LOG.md`、本文件和 `docs/data-model.md`。
2. 检查Git并设置`.local/`环境变量。
3. 完成并提交当前 `M2-T02` 变更。
4. 从 `M2-T03` 实现Campaign创建、读取、更新、归档和列表，并用关闭后重新连接的文件型SQLite测试验证持久性。
