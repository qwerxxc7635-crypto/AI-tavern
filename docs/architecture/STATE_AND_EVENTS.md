# State、Events 与 SceneFrame

## SQLite 状态模型

当前表继续保存聚合的可查询状态。Event Ledger 是审计、幂等和连续性层，不是完整 Event Sourcing；应用启动不需要重放全部事件才能恢复状态。

## 最小 Event Ledger

```text
event_id           globally unique
event_type         registered domain event type
operation_id       idempotency key
aggregate_type     campaign/scene/character/...
aggregate_id       stable aggregate identity
revision           aggregate revision after commit
payload_json       versioned validated payload
payload_version    schema version
source             local_rule/user_acceptance/import/system
occurred_at        database-assigned timestamp
```

约束：`operation_id + event_type + aggregate_id` 唯一；同一聚合 revision 单调递增；状态变更与 ledger 插入位于同一 SQLite 事务。导入必须验证 event 类型、版本、revision 连续性和资源上限。

当前migration 5以独立`event_ledger`表实现该模型，首批注册character、quest、turn、dice、scene、knowledge、snapshot和recovery八类聚合/事件。SQLite唯一键防止operation元组重放，触发器要求每个aggregate从revision 1开始严格连续；occurred_at由数据库生成。Repository只接受版本化JSON并执行高置信credential扫描。

Candidate确认允许领域Repository与Ledger Repository共享同一`BEGIN IMMEDIATE`，测试已证明领域投影、ledger和Candidate状态一起提交/回滚。Ledger不是启动恢复来源，也不取代现有`game_events`业务投影。可移植archive schema 1尚未承载新ledger；任何具体功能开始依赖其跨设备审计前，必须升级TS/Rust双实现并验证类型、版本、连续revision和资源上限，不能把本地ledger静默视为已可移植。

## SceneFrame

```ts
type SceneFrame = {
  scene_id: string;
  location: string;
  participants: string[];
  pressure: Array<{ id: string; kind: string; level: number }>;
  affordances: Array<{ id: string; label: string; preconditions: string[] }>;
  pending_consequence: Array<{ id: string; trigger: string; payload: unknown }>;
  return_point: { event_id: string; summary: string };
  revision: number;
};
```

SceneFrame 是 SQLite 中的持久投影。每个完整回合在同一事务更新 scene、相关聚合、frame 和 ledger。恢复从最新已提交 frame 开始；半完成 provider 调用只能作为失败审计存在。

## 并发和破坏性事务

- 接受候选时必须匹配 `expected_revision`；不匹配返回 `stale_revision`。
- 导入、恢复、永久删除持有 `AppInstanceLock` 到事务提交/回滚结束。
- 锁必须覆盖“检查 → 备份 → 写入 → 校验 → 发布”全时间窗，不能只锁检查点。
- operation id 防重复执行；revision 防陈旧执行；两者不能互相替代。
