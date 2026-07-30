# Ember Tavern 架构与产品决策记录

仅记录会长期影响实现、数据或验收口径的决定。新增决定采用递增编号，保留历史。

## DEC-001：酒馆老板计入三名常驻 NPC

- 日期：2026-07-30
- 状态：已采纳
- 依据：`docs/spec.md` 第 9.1、35.2 节；`docs/TASKS.md` 的 `M4-T03`

### 背景

规格的初始内容列出一名老板、两名常驻 NPC 和一名临时访客；总体验收与任务拆分要求三名常驻 NPC 和一名临时访客。

### 决定

老板是三名常驻 NPC 之一。因此初始酒馆包含一名老板、另外两名常驻 NPC 和一名临时访客。

### 影响

该解释同时满足两处数量要求，不新增 NPC，不改变 v0.1 产品范围。后续协议、Fake Provider 和验收数据应沿用此口径。

## DEC-002：Cargo workspace 动态验证延后至首个真实 crate

- 日期：2026-07-30
- 状态：已采纳
- 依据：`docs/TASKS.md` 的 `M0-T02`、`M0-T03`

### 背景

根 `Cargo.toml` 是 virtual workspace，成员配置为 `crates/*`。在 `M0-T03` 创建首个真实 crate 前，workspace 没有实际成员；Cargo 1.97.1 因此无法成功执行 `cargo metadata --format-version 1` 或 `cargo test --workspace`。将成员设为空也不能使无成员的 virtual workspace 通过动态验证。

### 决定

`M0-T02` 负责创建并静态检查 pnpm 与 Cargo workspace 配置，不创建无意义、临时或后续需要删除的占位 crate。`cargo metadata --format-version 1` 和 `cargo test --workspace` 延后到 `M0-T03` 创建首个真实 crate 后执行；两项命令成功且根 workspace 能识别该 crate，才可关闭 `M0-T03`。

### 影响

该决定只调整 Cargo 动态验证的执行时机，不取消验证，也不降低项目整体测试标准。`M0-T02` 可在配置静态检查通过后完成，`M0-T03` 仍按原任务范围创建首个真实 crate，并承担 workspace 动态验证。

## DEC-003：基础协议采用不透明 ID 与可保留未知值的序列化类型

- 日期：2026-07-30
- 状态：已采纳
- 依据：`docs/TASKS.md` 的 `M1-T01`

### 背景

共享协议会同时被 UI、领域层、SQLite、导入导出和 AI 上下文使用。裸字符串 ID 容易跨实体误传；非规范时间和未知枚举值若被静默转换，会破坏跨版本恢复。

### 可选方案

- 继续使用裸字符串或数字，由调用方自行约定。
- 使用运行时 class 包装所有值。
- 使用 TypeScript brand 提供编译期隔离，并用构造器执行边界验证。

### 决定与理由

采用 brand：ID 保留可序列化字符串形态但在类型层互不兼容；时间戳必须等于 `Date.toISOString()` 产生的 canonical UTC 字符串；Schema 与 Prompt 版本为正安全整数；枚举解码返回已知值或保留原始未知字符串。该方案简单、无运行时对象开销，且不会静默丢失未来版本数据。

### 影响

后续实体字段必须引用对应 brand 类型，外部字符串只能通过构造器进入领域协议。读取未知枚举时必须显式处理 `unknown` 分支。

### 可逆性

可逆，但改变序列化规则或 brand 构造约束需要 Schema 兼容评估和迁移；因此应在新增持久化数据前完成调整。
