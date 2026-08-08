# Context 与 Memory 模型

## ContextBlock Schema

```ts
type ContextBlock = {
  id: string;
  type: 'rules' | 'task' | 'persona' | 'character' | 'world' | 'lore' |
        'scene' | 'knowledge' | 'memory' | 'history' | 'user_input' | 'dice';
  content: unknown;
  source_id: string;
  source_revision: number;
  stability: 'stable' | 'semi_stable' | 'dynamic';
  priority: number;
  token_budget: number;
  privacy_class: 'public' | 'game_private' | 'secret';
  version: number;
  content_hash: string;
};
```

`content_hash` 对规范化的内容与语义字段计算，不包含运行时间。`id + source_revision + version + content_hash` 是缓存有效性的充分检查，不能只看 id。

当前实现使用规范化JSON的SHA-256作为`content_hash`。创建块时会验证ID、revision、版本、预算和枚举；进入Provider前Orchestrator重新计算hash，并逐项核对included manifest与块的source/revision/version/hash，拒绝调用后篡改。

## 装配和裁剪

1. 任务合同声明所需类型和总预算。
2. 查询以显式 revision 读取 SQLite 投影。
3. 块按阶段 stable → semi-stable → dynamic 装配，每阶段按 task-defined order、priority、id 稳定排序。
4. 先保留不可裁剪的规则、任务、当前输入和 hard-logic 结果。
5. 其余按优先级与每块预算裁剪；不得截断 JSON 结构。
6. 输出 `ContextManifest`，记录 included/excluded 原因、估算 token、hash 和隐私遮罩。

装配器按`stable → semi_stable → dynamic`、任务声明type顺序、priority降序、id升序产生确定顺序。候选携带0～1 relevance和required标记；低相关或超块/总预算的可选块整块排除，required块无法容纳时整体失败，禁止截断JSON。现有任务schema builder先完成知识过滤和历史裁剪，再把其结果封装为game-private任务块；manifest只含元数据，不含块内容。

## 真相、主张、知识、记忆

- `WorldTruth`：由本地规则或已接受事务确认的客观状态；可被隐藏，但不能由摘要创建。
- `Claim`：某来源对世界的可真可假的陈述，含 subject、predicate、object、source、confidence 和 revision。
- `Knowledge`：某 actor 在某时间通过观察、交流或推理可获得的 claim/truth 投影，必须有 provenance 与 visibility。
- `Memory`：角色/会话对已知经历的压缩或主观表述；可能遗忘或偏差，永不升级为 truth。

合法流向：truth/event 可派生 claim；可观察的 claim 可授予 knowledge；knowledge/event 可生成 memory candidate。反向升级必须有独立的本地证据和 domain transaction。

## 隐私与 Inspector

Inspector 默认只显示块类型、来源、版本、预算、hash 前缀、纳入原因和已遮罩摘要。`secret` 内容、credential、Authorization、完整系统 prompt 与未公开世界真相不显示。调试导出必须显式选择、二次清洗且不进入游戏存档。
