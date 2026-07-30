# Ember Tavern 上下文交接

## 当前状态

- 分支：`main`
- 最近完成任务：`M2-T01 设计SQLite ER模型`
- 已完成里程碑：M0、M1；M2已完成 `M2-T01`
- 当前任务：`M2-T01` 已验收，准备提交
- 下一任务：`M2-T02 创建首版数据库迁移`

## 架构摘要

- SQLite是游戏事实唯一来源；AI输出必须经结构和业务规则验证。
- Campaign、世界、角色、NPC、任务/物品、冒险和GameEvent协议已建立。
- `docs/data-model.md` 定义规格22张核心表；根实体使用规范列/外键，受限聚合使用受验证JSON。
- API Key不入库，Provider配置只保存安全存储 `credential_ref`。

## 关键决策

- `DEC-001`至`DEC-010`记录从NPC数量到SQLite规范列/JSON边界的架构选择。

## 环境与限制

- Node.js `v24.17.0`，pnpm `11.9.0`；Rustc/Cargo `1.97.1`。
- 缓存、下载、构建和临时文件位于`.local/`。
- iOS真机/签名需要macOS/Xcode；真实云测试需要安全提供的API Key。

## 最近成功验证

- 数据模型静态核对：22/22核心表，缺失0、额外0，外键目标全部有效。
- `pnpm check`：通过；Vitest 10个文件、92个测试通过。
- TypeScript、ESLint、Prettier、Rust fmt、严格Clippy和workspace test通过。

## 恢复步骤

1. 完整读取规则、规格、任务、日志、决策、README、`LOG.md`、本文件和 `docs/data-model.md`。
2. 检查Git并设置`.local/`环境变量。
3. 完成并提交当前 `M2-T01` 文档变更。
4. 从 `M2-T02` 创建 `0001_initial.sql` 及迁移执行/测试，使新数据库一次迁移成功且重复启动不重复建表。
