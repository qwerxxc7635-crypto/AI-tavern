# Ember Tavern `.emtavern` 容器 v1 / Campaign Archive Schema 3

## 1. 范围

`.emtavern` 是 Windows 与未来 iOS 之间手动迁移单个 Campaign 的可移植存档。它不是活动 SQLite 文件的副本，也不能替代完整数据库备份。ZIP 容器固定包含五个 UTF-8 文件：

```text
<campaign-id>.emtavern
├─ manifest.json
├─ campaign.json
├─ events.ndjson
├─ generations.json
└─ checksum.json
```

schema 3保存完整游戏事实、持久状态、事件及生成/规则/Director审计；设备配置、秘密、未完成请求、内部快照和可重建缓存不得进入档案。

## 2. 独立版本

- `formatVersion`：ZIP及五文件结构，当前固定为`1`。
- `databaseSchemaVersion`：可移植Campaign行集合。当前写入`3`，读取历史`1`、`2`。
- `campaigns.save_schema_version`：恢复后的可移植存档语义版本，当前固定为`3`。
- `campaigns.world_schema_version`：恢复后的世界数据语义版本，当前固定为`1`。
- 各行原有`schema_version`：领域对象协议版本，必须原样保留，不能代替上述版本。

活动SQLite迁移版本当前为32，可以高于portable schema。设备表或缓存表变化不得隐式抬高portable版本。schema 1含原14类事实；schema 2增加`scene_frames`；schema 3加入V0.3的持久世界、Rules、Knowledge、动态实体、Quest、Director、Memory和Lazy Generation状态。

高于自身支持值的容器或portable schema必须明确拒绝。历史转换只能在隔离数据上完成，验证通过后才能写入正式SQLite事务；不得改写源`.emtavern`。

## 3. 容器与资源规则

- 条目名必须与第1节完全一致；禁止目录、重复项、绝对路径、反斜杠、`..`、符号链接或额外文件。
- 条目仅允许`STORE`或`DEFLATE`。所有文本为UTF-8、无BOM、LF换行；JSON禁止重复键、非有限数字和尾随内容。
- 四个JSON文件末尾有一个LF。`events.ndjson`每个非空行各含一个规范JSON对象和LF；零事件时文件为空。
- 压缩包最多32 MiB，全部展开最多64 MiB，非空条目展开/压缩比最多100:1。
- 条目上限：manifest/checksum各64 KiB，campaign 32 MiB，events/generations各16 MiB。
- JSON深度最多64，数组最多100,000项，单字符串最多1,048,576 UTF-8字节。事件最多100,000条，Generation最多20,000条，每表最多20,000行，总记录最多200,000条。
- 读取方先验证ZIP中央目录和全部预算，再有界展开、校验、解析；任何失败都发生在正式写事务之前。

规范JSON按对象键Unicode升序、数组原顺序、无无意义空白、标准转义和有限数字编码。SQLite `*_json`列先解析、资源/秘密验证并规范化，再作为外层JSON字符串保存。

## 4. Manifest与Checksum

`manifest.json`字段必须精确为：

```json
{
  "application": "ember-tavern",
  "campaignId": "campaign-01",
  "createdAt": "2026-08-01T13:00:00.000Z",
  "databaseSchemaVersion": 3,
  "files": {
    "campaign.json": { "mediaType": "application/json", "records": 1 },
    "events.ndjson": { "mediaType": "application/x-ndjson", "records": 42 },
    "generations.json": { "mediaType": "application/json", "records": 18 }
  },
  "formatVersion": 1,
  "generatorVersion": "0.3.0"
}
```

`application`固定为`ember-tavern`；`campaignId`在所有文件一致；时间必须是规范UTC RFC3339；三项record计数必须与解析结果一致。

`checksum.json`精确包含`algorithm: "SHA-256"`、`formatVersion: 1`以及其余四文件原始字节的64位小写十六进制摘要。它用于发现损坏/中断传输，不是数字签名。

## 5. SQLite行表示

- 字段名是对应portable schema的准确SQLite列名。
- `TEXT`写JSON字符串，`INTEGER`写JSON整数，有限`REAL`写JSON数字，`NULL`写`null`；SQLite布尔仍为`0`/`1`。
- `*_json`保持规范JSON文本字符串，不在外层展开。
- portable数据文件不允许BLOB；`save_snapshots.payload`不进入档案。
- 每行必须与其portable schema列集合精确匹配。读取方使用固定标识符清单和绑定值写入，禁止归档内容提供SQL。

## 6. Campaign数据

`campaign.json`精确包含`campaign`、`campaignId`、`databaseSchemaVersion`、`formatVersion`和`tables`。schema 3 Campaign行必须带`save_schema_version: 3`和`world_schema_version: 1`。

Provider/model属于设备配置，因此导出行固定归一化为`default_model_profile_id: null`、`fallback_model_profile_id: null`、`task_model_overrides_json: "{}"`。

schema 1的14项表与schema 2的15项表保持历史精确形状。schema 2增加`scene_frames`。schema 3必须恰好包含69项表；权威名称、顺序和查询范围由[`portable-save-schema.ts`](../packages/persistence/src/portable-save-schema.ts)及Rust镜像清单锁定。

69项覆盖：

- V0.2基础世界、角色、酒馆、NPC、Quest、Adventure、对话、物品、时间与SceneFrame；
- World Constitution、Seed、随机流、Rules状态/事件、Knowledge与Memory；
- Universal Character、创建会话、Career Pool、NPC LOD、动态地点/势力；
- 酒馆人口、多NPC场景、不可变NPC时间线、Quest Pool/Graph/动态来源；
- World Director/Budget、Historical Summary、World Lore、检索规则；
- Lazy World Generation、Campaign Event Ledger和已终结AI候选。

所有行必须属于同一Campaign。直接表检查`campaign_id`，间接表通过父记录闭包检查。双语言实现必须稳定排序，导入后逐表精确重载比较。

### 6.1 SceneFrame与Event Ledger

schema 1/2不携带`event_ledger`，允许从SceneFrame revision建立兼容审计基线。schema 3携带完整Campaign Event Ledger，幂等操作及revision历史必须原样恢复，后续revision严格连续。SceneFrame的`returnPoint.eventId`必须存在于同档案`game_events`。

## 7. 事件与生成审计

`events.ndjson`每行是完整`game_events`行，按稳定顺序保存；`payload_json`必须通过共享GameEvent协议。空文件不写占位对象。

`generations.json`精确包含`campaignId`、`databaseSchemaVersion`、`formatVersion`和`records`。全部Campaign `generation_records`均保存，包括失败/修复审计；`model_profile_id`固定为`null`，其余请求、原响应、验证输出及错误仍受资源与秘密扫描约束。

## 8. 包含与排除边界

必须包含目标Campaign的归一化行、portable schema全部表、全部`game_events`和`generation_records`。存在未确认`PROPOSED`候选时导出必须失败；只有在候选全部终结后，schema 3才携带其审计行。

必须排除：

- `provider_configs`、`model_profiles`、`app_settings`、`schema_migrations`；
- API Key、Authorization、Cookie、令牌、密码、安全存储内容和`credential_ref`；
- `pending_ai_requests`、`credential_cleanup_queue`；
- `dialogue_suggestion_cache`、`prefetch_candidates`、`prefetch_events`等可重建/进程缓存；
- `quest_pool_restore_sessions`等事务控制行；
- `save_snapshots`及BLOB payload、SQLite/WAL/SHM、完整备份、日志和临时文件。

字段名、所有字符串、嵌套JSON、请求/响应/错误、四个数据文件和最终ZIP字节都必须经过共享秘密扫描。命中即整体失败，不得静默删字段后生成看似完整的档案。

## 9. 一致导出与原子发布

导出在单个只读一致事务内完成：SQLite `integrity_check`、`foreign_key_check`、本地schema 32、Campaign存在、行归属、JSON/领域协议、资源预算和秘密扫描全部通过后，才编码五文件并原子发布最终路径。任何失败都不得替换已有目标或留下正式扩展名半成品。

## 10. 导入与迁移顺序

```text
验证ZIP结构和资源预算
→ 校验四文件SHA-256
→ 验证容器/portable版本
→ 严格解析行形状、计数、归属、JSON和秘密
→ 把schema 1/2投影转换为schema 3 Campaign行
→ 选择CREATE或用户明确OVERWRITE
→ OVERWRITE先创建一致完整数据库备份
→ 单一IMMEDIATE事务按外键/触发器顺序写入
→ foreign-key/逐表精确重载与领域Repository重载
→ 创建IMPORT快照并提交
```

任一步失败必须回滚；源档案和原Campaign保持不变。未来portable版本以“需要升级应用”明确拒绝。历史迁移不得猜测或伪造缺失的世界事实，只做当前规则允许的确定性兼容投影。

## 11. 活动SQLite V0.2→V0.3迁移

Windows实际使用的Rust启动路径与TypeScript工具路径都必须：

1. 创建并验证迁移前完整备份；
2. 从一致副本建立隔离工作文件；
3. 在工作文件执行历史migration至schema 32；
4. 执行`integrity_check`、`foreign_key_check`、schema history和Campaign领域重载；
5. 仅在全部通过后用rename原子切换；
6. 切换失败恢复原文件；任何失败都清理工作副本并保持原文件字节不变。

## 12. Fixtures与互操作门禁

历史TS/Rust v1、v2 fixtures永久保留并由SHA-256清单防漂移；当前TS/Rust v3 fixtures另行生成。`pnpm archive:interop`验证历史hash、TS v3再生成一致、Rust导入TS、Rust v3再生成一致及TS导入Rust。禁止删除历史migration或fixture来让门禁通过。
