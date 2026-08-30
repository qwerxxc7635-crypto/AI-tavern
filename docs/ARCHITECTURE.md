# Ember Tavern Architecture

本文是当前 V0.3 实现的架构索引，不定义新功能。产品合同仍以 [`SPEC.md`](SPEC.md) 为权威，历史取舍见 [`DECISIONS.md`](DECISIONS.md)。

## 事实与事务边界

- 本地 SQLite 是 Campaign、角色、NPC、Quest、规则结果、时间线和恢复状态的唯一权威事实源。
- UI 通过 Application/Native command 使用用例，不直接访问 SQLite、Provider 或系统凭据库。
- 生成链遵循 Context → Prompt → Provider → Parse → Validate/Repair → Rules → Persist → Events。Provider 输出在结构和业务规则验证完成前不能改变游戏事实。
- D20 硬结果、经济、装备、时间、Quest 状态和不可变 NPC 时间线由本地 Rules/事务提交；streaming chunk 只用于展示，不逐块写入权威状态。

## 分层

| 层 | 责任 | 主要位置 |
| --- | --- | --- |
| Contracts | 稳定类型、schema 与跨语言合同 | `packages/contracts` |
| Domain / Rules | 纯业务规则、验证与投影 | `packages/domain` |
| AI Core / Prompts | Context、Prompt、Queue、结构解析与生成编排 | `packages/ai-core`, `packages/prompts` |
| Application | 用例和跨域协调，不持有第二套事实 | `packages/application` |
| Persistence | SQLite repository、迁移、导入导出与恢复 | `packages/persistence`, `database/migrations` |
| Native boundary | 原子生产事务、平台服务与 Tauri commands | `crates/native-bridge`, `windows-app/src-tauri` |
| UI | Hash Router 桌面界面和可恢复展示状态 | `windows-app/src` |

依赖方向从 UI/Application 指向合同与用例边界；Domain 不依赖 UI 或具体 Provider，Provider 不直接写 SQLite。

## Provider 与凭据

- 所有 OpenAI-compatible 服务使用统一 Provider 合同；模型身份、endpoint、能力探测和 fallback 选择均记录可追溯身份。
- API Key 只存在于操作系统 secure store。SQLite、portable archive、日志、错误对象和前端只允许 opaque credential reference 或 `hasCredential` 状态。
- 真实 Provider 测试需要显式凭据与网络授权；Fake Provider 证据只证明编排、规则和持久化合同。

## Save 与兼容性

- 启动迁移在已验证副本上执行；失败不得改写原文件。
- archive import 在资源、schema、secret 与业务校验后才替换目标，并在覆盖前创建备份。
- Save Schema 3 / World Schema 1 保持 V0.1、V0.2、V0.3 兼容合同；详细格式见 [`save-format.md`](save-format.md) 与 [`data-model.md`](data-model.md)。

## 发布边界

V0.3 以 Windows 纵向切片优先，同时构建 macOS `.app`。Windows/macOS 安装、启动、系统凭据和清理生命周期必须在隔离 CI runner 上验证；签名、notarization、发布以及真实付费 Provider 验证不是本地代码门的替代项。
