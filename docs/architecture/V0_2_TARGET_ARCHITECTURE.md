# Ember Tavern v0.2 目标架构

状态：Architecture Gate 基线。若本文与实现冲突，实现必须整改；若与总执行提示词冲突，以总执行提示词为准。

## 不变量

1. SQLite 是游戏状态唯一真实数据源。
2. UI 不导入、构造或调用 Provider；UI 只能发送 application command、订阅状态并展示候选。
3. AI 只能生成结构化建议或叙事候选；通过 schema 与 domain policy 前不得写入状态。
4. 骰点、数值、合法性、权限、事务、知识可见性和秘密处理均为本地 hard logic。
5. Domain 不依赖 Tauri、Windows、macOS、HTTP、系统钥匙串或文件对话框。
6. 平台能力只能经 ports & adapters 进入；不得用散落的 `cfg`/路径条件污染业务层。
7. 每次 provider 调用都使用 frozen `ResolvedModelConfig`，不能在请求期间读取可变 UI 设置。
8. WorldTruth、Claim、Knowledge、Memory 不可互相冒充。
9. 新增能力围绕 Windows 优先纵向切片和 macOS 开发门禁，不启动 iOS。

## 分层与依赖方向

```text
UI
  -> Application command/query
    -> AI Task Orchestrator
      -> Context Assembler
      -> Model Router
      -> Provider Port
      -> Output Schema Validator
      -> Domain Policy
      -> Candidate Store / Narrative Projection
    -> Domain Transaction
      -> Repository Ports
        -> SQLite / platform adapters
```

依赖只向内。Provider adapter、SQLite adapter、Windows/macOS adapter 可以依赖 ports；ports 不依赖 adapters。

## AI 任务合同

每种任务在注册表中声明：`task_type`、输入 schema、需要的 ContextBlock 类型、预算、router policy、输出 schema、domain validator、candidate policy、failure policy。UI 不能动态拼出隐式任务。

Orchestrator 产生 `AiOperation`：

- `operation_id`：全链路幂等键；
- `task_type`、`aggregate_id`、`expected_revision`；
- `context_manifest_hash`；
- `resolved_model_fingerprint`；
- `state` 与稳定错误分类；
- provider attempt/repair attempt 审计引用。

## ContextBlock

统一字段：`id`、`type`、`content`、`source_id`、`source_revision`、`stability`、`priority`、`token_budget`、`privacy_class`、`version`、`content_hash`。

- `stable`：规则、schema、固定角色定义；允许跨请求缓存。
- `semi_stable`：世界/lore/角色状态；revision 改变即失效。
- `dynamic`：当前场景、输入、骰点和未决后果；不进入 stable cache。

序列化必须稳定：固定块顺序、对象键顺序、换行与 Unicode 归一化。相同输入必须得到相同 manifest/hash。当前共享canonical JSON按NFC后的key码点排序、对象无额外空白、数组保留语义顺序、有限number使用JSON规范表示、string/enum执行NFC及LF归一化，并拒绝Unicode等价重复key；Prompt段之间只用LF且末尾无换行。

当前Prompt编译先构造版本化Stable Prompt Profile，固定`SYSTEM_CONTRACT -> GAME_RULES -> OUTPUT_SCHEMA -> PROMPT_PROFILE -> STABLE_WORLD_TRUTHS`五段；world truths进入前复制冻结，并拒绝request ID、timestamp、UUID、transient error、cache metrics和UI debug。后续summary/lore/history/scene/input不得插入这五段之间。

后续Context Cache Layout固定`LONG_TERM_SUMMARY -> RELEVANT_LORE_KNOWLEDGE -> RECENT_HISTORY -> CURRENT_SCENE_STATE -> PLAYER_ACTION`。前两段只接受semi-stable summary/memory/lore/knowledge；后三段只接受dynamic history/scene/state/dice/action/user_input。内部布局投影保留type、source revision、version、content hash和content；Provider序列化只发送type/revision/version/content，不发送可能受UUID影响的block/source ID或content hash。

DeepSeek usage边界可接收`prompt_cache_hit_tokens`和`prompt_cache_miss_tokens`。本地仅保留最多200项task type、hit/miss、计算ratio、cacheable prefix SHA-256和记录时间；指标写入device-local `app_settings.deepseek_cache_metrics_v1`，不得含完整Prompt、消息、上下文内容、request ID或credential。

## Provider 三层

- `ConnectionProfile`：用户可编辑的持久设置；密钥只保存 vault reference。
- `ResolvedModelConfig`：请求开始前解析和冻结的模型、端点、能力、超时、采样、cache profile 与 credential reference，并计算 fingerprint。
- `ProviderRequest`：adapter 所需最小 HTTP 投影；只能在安全原生边界解析 secret，且不得落日志/存档。

当前实现以规范化端点、Connection Profile身份与options、credential reference、模型档案/名称、完整能力、生成参数、prompt版本/响应格式及cache profile计算SHA-256 fingerprint。Orchestrator先复算fingerprint并逐值绑定route/request，再从ResolvedModelConfig投影ProviderConfig；调用期间不再读取可变设置对象。GenerationRecord只保存fingerprint，不复制credential reference；结构修复必须匹配原fingerprint。

随机性是device-local生成偏好而非Campaign事实。`app_settings.randomness_profile_v1`只允许CONSERVATIVE 0.2、BALANCED 0.7、HIGH 1.1或CUSTOM 0至2；每条Windows AI路径在构造`NormalizedAIRequest`前从原生边界读取一次，并把解析后的temperature冻结进请求/GenerationRecord。设置变化不追溯修改既有请求，且永不影响本地D20和其他Hard Logic。

## 候选和事务

生成结果先进入 `AICandidate`：`candidate_id`、`operation_id`、`task_type`、结构化 payload、validation evidence、provenance、status、created_at。状态仅可 `proposed -> accepted|rejected|superseded`。接受时以 `expected_revision` 在单一 SQLite 写事务内重新执行 domain policy、写事实和 ledger；失败不产生部分状态。

当前通用基础设施把Candidate作为不可变提案保存于SQLite migration 4。编辑或重新生成会创建带独立operation/provenance的新Candidate，并在同一事务把原项标为superseded；确认要求Campaign与expected revision匹配，在同一`BEGIN IMMEDIATE`中执行领域commit和accepted转换，任一步失败全部回滚。Candidate payload和provenance执行高置信credential扫描。

## Ports & Adapters

必须存在并具备契约测试：

- `SecureVault`：put/get/delete、pending cleanup、health；Windows Credential Manager 与 macOS Keychain adapters。
- `PlatformPaths`：data/cache/log/temp 路径；测试可注入隔离根目录。
- `FileDialog`：只返回用户明确选择的路径。
- `AppInstanceLock`：破坏性操作持有跨进程锁。
- `AppLifecycle`：启动恢复、关闭清理与取消。
- `ReleaseMetadata`：统一版本、channel、commit、build time。

## 明确不做

不做完整事件溯源、插件市场、MultiChat、World Voices、AI Companion、iOS、真实付费 API 或正式用户数据迁移。
