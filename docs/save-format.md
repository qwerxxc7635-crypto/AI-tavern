# Ember Tavern `.emtavern` 存档格式 v1

## 1. 范围

`.emtavern` 是 Ember Tavern 在 Windows 与 iOS 之间手动迁移单个 Campaign 的可移植存档。v1 是 ZIP 容器，固定包含五个 UTF-8 文件：

```text
<campaign-id>.emtavern
├─ manifest.json
├─ campaign.json
├─ events.ndjson
├─ generations.json
└─ checksum.json
```

本格式保存完整游戏事实、事件和生成审计，但不迁移设备级模型配置、秘密或恢复缓存。它不是活动 SQLite 文件的副本，也不是数据库完整备份的替代品。

本文中的“必须”“不得”“应”是格式 v1 的规范要求。

## 2. 版本

格式使用两个独立版本：

- `formatVersion`：`.emtavern` 容器及文件结构版本；本文固定为 `1`。
- `databaseSchemaVersion`：可移植 Campaign 行集合的Schema版本；v1固定为 `1`，对应 `database/migrations/0001_initial.sql` 中允许进入档案的游戏数据列。

活动设备的 SQLite 迁移版本可以高于档案的 `databaseSchemaVersion`。例如凭据清理队列属于设备级状态，不进入档案，也不得仅因它新增本地迁移就改变 v1 档案版本。写入方必须先确认活动数据库已经迁移到自己支持的最新本地版本，再按本文固定的 Campaign Schema 1投影导出。

Campaign、世界圣经和事件行中已有的 `schema_version` 是各领域对象的协议版本，必须原样保留，不能替代上述两个版本。

读取方必须拒绝高于自身支持值的 `formatVersion` 或档案 `databaseSchemaVersion`。档案数据的版本迁移必须在隔离数据上完成，全部验证通过后才能写入已经就绪的正式 SQLite。

## 3. 容器规则

- ZIP 条目名必须与第1节完全一致，不得有目录、重复条目、绝对路径、反斜杠、`..`、符号链接或额外文件。
- 条目可使用 ZIP `STORE` 或 `DEFLATE`；ZIP CRC 不是本格式的内容校验依据。
- 所有文本使用 UTF-8、无 BOM、LF 换行。JSON 不允许重复键、`NaN`、`Infinity` 或尾随内容。
- `manifest.json`、`campaign.json`、`generations.json` 和 `checksum.json` 文件末尾必须有一个 LF。
- `events.ndjson` 每个非空行是一个完整 JSON 对象并以 LF 结束；没有事件时文件长度为0。
- 压缩包最多32 MiB，全部条目展开总量最多64 MiB；任一非空条目的展开/压缩比不得超过100:1。
- 条目上限固定为：`manifest.json` 64 KiB、`checksum.json` 64 KiB、`campaign.json` 32 MiB、`events.ndjson` 16 MiB、`generations.json` 16 MiB。
- JSON最大深度64，单数组最多100,000项，单字符串最多1,048,576字符/UTF-8字节。事件最多100,000条，GenerationRecord最多20,000条，每个Campaign事实表最多20,000行，档案总记录最多200,000条。
- 读取方必须先扫描ZIP中央目录并验证所有预算，再按条目有界展开、校验和解析；不得同时保留五个展开条目。任何上限命中都在正式SQLite事务前整体拒绝。

### 3.1 规范 JSON

需要稳定字节表示的 JSON 文件和 NDJSON 行按以下规则编码：

1. 对象键按 Unicode 码点升序排列；
2. 数组保持本文件规定的稳定顺序；
3. 不写无意义空白；
4. 字符串使用标准 JSON 转义；
5. 数字必须是有限 JSON 数字；
6. 最外层值后写一个 LF，NDJSON 则每行各写一个 LF。

SQLite 的 `*_json` 文本列仍以字符串字段保存。导出前必须解析并按相同规则重新序列化该列，拒绝非法 JSON，再把规范 JSON 文本作为外层 JSON 字符串写出。

## 4. `manifest.json`

`manifest.json` 描述档案身份、版本、导出时间和文件数量，不包含展示用的可变标题。

```json
{
  "application": "ember-tavern",
  "campaignId": "campaign-01",
  "createdAt": "2026-08-01T13:00:00.000Z",
  "databaseSchemaVersion": 1,
  "files": {
    "campaign.json": { "mediaType": "application/json", "records": 1 },
    "events.ndjson": { "mediaType": "application/x-ndjson", "records": 42 },
    "generations.json": { "mediaType": "application/json", "records": 18 }
  },
  "formatVersion": 1,
  "generatorVersion": "0.1.0"
}
```

字段约束：

| 字段 | 约束 |
| --- | --- |
| `application` | 必须等于 `ember-tavern` |
| `formatVersion` | v1必须等于 `1` |
| `databaseSchemaVersion` | 正整数；v1固定为 Campaign archive schema `1`，不等于设备级迁移上限 |
| `campaignId` | 非空不透明ID，并与其余四个文件一致 |
| `createdAt` | UTC RFC3339时间 |
| `generatorVersion` | 生成该文件的应用版本，非兼容性判断依据 |
| `files` | 必须恰好列出三个数据文件；`records` 是对应记录数 |

`campaign.json` 的 `records` 固定为1；其余计数必须与解析结果一致。

## 5. SQLite 行表示

数据文件使用可迁移的 SQLite 行表示，目的是在同一Schema版本下无损恢复：

- 字段名使用 `database/migrations/0001_initial.sql` 中的准确列名。
- SQLite `TEXT` 写为 JSON 字符串，`INTEGER` 写为 JSON 整数，`NULL` 写为 JSON `null`。
- SQLite布尔值保持 `0` 或 `1`，不得转换成 JSON布尔值。
- `*_json` 字段保持“规范 JSON 文本字符串”，不得在外层展开。
- v1数据文件不允许 BLOB 字段；`save_snapshots.payload` 因此不进入档案。
- 每行必须只含该 `databaseSchemaVersion` 定义的列，不得缺列或增加未知列。

读取方必须先验证行形状和标量类型，再通过当前 Repository/领域协议验证 JSON 列、枚举、范围、Campaign 归属和外键，不能把归档行直接拼接成 SQL。

## 6. `campaign.json`

该文件保存一个 Campaign 行和除事件、生成记录之外的全部持久游戏事实：

```json
{
  "campaign": {
    "archived_at": null,
    "created_at": "2026-08-01T10:00:00.000Z",
    "default_model_profile_id": null,
    "fallback_model_profile_id": null,
    "id": "campaign-01",
    "model_switch_policy": "ASK",
    "resume_state": null,
    "schema_version": 1,
    "state": "TAVERN",
    "task_model_overrides_json": "{}",
    "updated_at": "2026-08-01T12:59:00.000Z"
  },
  "campaignId": "campaign-01",
  "databaseSchemaVersion": 1,
  "formatVersion": 1,
  "tables": {
    "adventure_turns": [],
    "adventures": [],
    "conversations": [],
    "items": [],
    "messages": [],
    "npc_knowledge": [],
    "npc_relationships": [],
    "npcs": [],
    "player_characters": [],
    "quests": [],
    "taverns": [],
    "world_bibles": [],
    "world_clocks": [],
    "world_facts": []
  }
}
```

`tables` 必须恰好包含以下14项：

`world_bibles`、`world_facts`、`player_characters`、`taverns`、`npcs`、`npc_knowledge`、`npc_relationships`、`quests`、`adventures`、`adventure_turns`、`conversations`、`messages`、`items`、`world_clocks`。

所有行必须属于 `campaignId`。直接含 `campaign_id` 的表按该列验证；其余表通过父记录关系验证。数组按主键升序；`adventure_turns` 按 `adventure_id, turn_number, id`，`messages` 按 `conversation_id, sequence_number, id`。

### 6.1 模型绑定归一化

Provider和模型档案是设备级配置，不属于可移植游戏事实。导出时 Campaign 行必须写：

- `default_model_profile_id: null`
- `fallback_model_profile_id: null`
- `task_model_overrides_json: "{}"`

`model_switch_policy` 可以保留。导入完成后，玩家在目标设备重新选择已配置模型；不得凭同名ID自动关联另一台设备的Provider。

## 7. `events.ndjson`

每行是 `game_events` 的一个完整 SQLite 行对象，例如：

```json
{"campaign_id":"campaign-01","id":"event-01","occurred_at":"2026-08-01T11:00:00.000Z","payload_json":"{\"worldName\":\"Ember Coast\"}","schema_version":1,"type":"WORLD_CREATED"}
```

规则：

- 只允许目标 Campaign 的事件；
- 按 `occurred_at, id` 升序；
- `payload_json` 必须匹配 `type` 的共享 `GameEvent` 协议；
- 空文件表示没有事件，不写头行或空 JSON 对象；
- `manifest.files["events.ndjson"].records` 必须等于非空行数。

## 8. `generations.json`

该文件保存 Campaign 的完整 `generation_records` 审计行：

```json
{
  "campaignId": "campaign-01",
  "databaseSchemaVersion": 1,
  "formatVersion": 1,
  "records": [
    {
      "campaign_id": "campaign-01",
      "completed_at": "2026-08-01T11:00:01.000Z",
      "id": "generation-01",
      "model_profile_id": null,
      "prompt_version": 2,
      "raw_response_text": "{\"name\":\"Ember Coast\"}",
      "request_id": "request-01",
      "request_json": "{\"modelName\":\"ember-fake-v1\"}",
      "started_at": "2026-08-01T11:00:00.000Z",
      "task": "GENERATE_WORLD",
      "validated_output_json": "{\"name\":\"Ember Coast\"}",
      "validation_error_json": null
    }
  ]
}
```

记录按 `started_at, id` 升序。`request_json`、验证结果和错误继续保留，以便审计模型生成来源；`raw_response_text` 也原样保留，但仍受秘密扫描规则约束。

`model_profile_id` 在导出表示中必须为 `null`。实际模型名和生成参数由现有 `request_json` 保留，目标设备不得把源设备模型ID连接到本机配置。消息和冒险结局对 `generation_records.id` 的引用保持不变。

## 9. `checksum.json`

校验和对其余四个文件的原始、含末尾 LF 的 UTF-8 字节计算：

```json
{
  "algorithm": "SHA-256",
  "files": {
    "campaign.json": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "events.ndjson": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "generations.json": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "manifest.json": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  },
  "formatVersion": 1
}
```

- `algorithm` 必须等于 `SHA-256`。
- 每个摘要必须是64个小写十六进制字符。
- `files` 必须恰好包含上述四项；`checksum.json` 不自校验，避免循环依赖。
- 摘要用于发现损坏和不完整传输，不是数字签名，不能证明文件作者或抵抗主动篡改。

## 10. 包含与排除边界

### 10.1 必须包含

- `campaigns` 中目标 Campaign 的归一化行；
- `campaign.json` 第6节列出的14类完整游戏事实；
- 该 Campaign 的全部 `game_events`；
- 该 Campaign 的全部 `generation_records`，包括失败和修复审计；
- 五个文件自身的格式、Schema和完整性元数据。

### 10.2 必须排除

- `provider_configs`、`model_profiles`、`app_settings`；
- API Key、Authorization头、Cookie、登录令牌和安全密钥仓库内容；
- `credential_ref` 及其他设备安全存储引用；
- `pending_ai_requests`；导入后由现有回合和Campaign状态重新派生恢复操作；
- `save_snapshots` 及其 BLOB payload；成功导入后创建新的 `IMPORT` 快照；
- SQLite文件、WAL/SHM、完整备份、应用日志、临时文件和缓存。

写入方必须对所有待导出键名执行大小写不敏感的拒绝列表扫描，至少拒绝 `api_key`、`apiKey`、`authorization`、`cookie`、`token`、`password`、`secretKey` 和 `credential_ref`。命中时导出整体失败，不得静默删字段后生成看似完整的档案。玩家在剧情文本中自行输入的普通单词不按键名扫描；应用不能保证识别用户主动写入叙事文本的秘密。

## 11. 一致性快照

导出方必须在单个只读一致性事务中读取全部数据，并在封装ZIP前完成以下检查：

1. 数据库通过完整性检查，目标 Campaign 存在；
2. 所有导出行均属于目标 Campaign；
3. 外键和领域引用闭合，JSON列及共享协议有效；
4. Campaign模型绑定与生成记录模型绑定已按本文归一化；
5. 事件、生成记录和各表顺序稳定；
6. `manifest` 数量与实际内容一致；
7. 四个数据文件的SHA-256与 `checksum.json` 一致；
8. ZIP 仅在全部步骤成功后原子发布到最终路径。

任一步失败都不得留下正式扩展名的半成品。

## 12. 导入验证顺序

M8-T03 的读取方必须按以下顺序处理，且在最终提交前只操作隔离临时数据：

```text
检查ZIP结构、条目名和大小上限
→ 最小解析manifest与checksum
→ 校验四个文件的SHA-256
→ 验证formatVersion和databaseSchemaVersion
→ 严格解析全部文件、数量、行形状和Campaign归属
→ 执行必要Schema迁移
→ 通过共享协议、领域规则、外键与秘密扫描
→ 选择新建或明确覆盖目标
→ 单一SQLite事务写入
→ 创建IMPORT快照
→ 提交
```

覆盖导入必须在事务开始前创建可恢复的数据库完整备份。任何解析、迁移、校验、写入或IMPORT快照失败都必须回滚，不得留下部分Campaign。

## 13. v1 兼容性规则

- 写入方只生成自己完整支持的 `formatVersion` 和 Campaign archive schema；设备级迁移不得隐式抬高档案版本。
- 读取方不得忽略未知顶层字段、缺失固定表或额外ZIP条目；格式升级必须显式增加迁移。
- ID在新建导入中默认保持不变。若与本地其他Campaign内容冲突，必须整体拒绝或执行覆盖模式，v1不得局部改写ID。
- 同一 `campaignId` 已存在时必须由用户明确选择“新建副本”或“覆盖”；新建副本若需要重写ID属于M8-T03的显式全图迁移，不在格式层隐式发生。
- 导入成功后模型绑定为空是预期状态，不代表游戏事实缺失；继续AI生成前必须选择目标设备的模型。

## 14. M8-T01 边界

本任务只定义格式。ZIP读写、导出服务、导入事务、文件选择器和拖放交互分别属于 M8-T02、M8-T03 和 M8-T04，不在本文实现。
