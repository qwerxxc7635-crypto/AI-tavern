# v0.1 第二轮审查修复记录

原始依据：`Ember_Tavern_Windows_v0.1_Second_Round_Audit.md`。本文件只在测试证据真实通过后把条目标为关闭。

## SR2-001 — CLOSED

- 用维护的 `antissrf` `ExternalOnlyLatest` IANA/RFC 地址策略替代手写“公网 IP” denylist；关闭默认 network integration，仅使用静态地址政策。
- IPv4-mapped、旧 IPv4-compatible、NAT64、6to4、Teredo 先识别内嵌 IPv4 并复用 IPv4 策略；外层特殊用途策略仍必须通过。
- DNS 仍要求非空且全部地址可接受，混合 DNS 整体拒绝；单次解析结果固定给 reqwest，URL host 保持为 Host/SNI 来源。
- reqwest redirect policy 继续为 `none`，不存在跳转到私网的第二连接。
- 11 项 `ember-secure-http` 测试通过；新增 IPv4/IPv6 special-use、mapped/compatible、NAT64、6to4、Teredo、混合 DNS矩阵。

## SR2-002 — CLOSED

- `SecretStore` 通过共享 `SecureVault` port 使用 Windows Credential Manager 或 macOS Keychain；SQLite 仍只保存不透明 `credential:v1:<UUID>`，不保存秘密。
- 设置更新显式区分 `KEEP`、`REPLACE` 与 `CLEAR`。空输入不再用 `null` 覆盖既有引用；替换或清空会在同一 SQLite 事务中登记旧引用。
- 新建秘密先作为 `ROLLBACK` 清理项持久化，设置事务成功时原子认领；因此秘密写入后进程退出也能在下次启动恢复。
- 系统库删除成功才移除清理项；失败会保留引用并增加重试次数。启动、设置读取、保存和清空均会重试，UI 只显示待清理数量，不暴露历史引用。
- 回归测试覆盖新增、保留、替换、清空、事务回滚、删除失败、临时探测清理失败、数据库重开与成功重试；macOS Keychain 实际 round-trip 与幂等删除通过。

## SR2-003 — CLOSED

- 压缩包由256 MiB降至32 MiB，展开总量由1 GiB降至64 MiB；五个固定条目分别限制为64 KiB、32 MiB或16 MiB，单条目压缩比最多100:1。
- JSON在调用解析器和递归规范化前先以非递归扫描限制深度64；解析后以迭代遍历限制数组100,000项及字符串1,048,576字符/字节。
- 事件、生成记录、每个事实表和全档案分别设置记录数上限；导出与导入使用同一上限，不能生成自身无法再次导入的档案。
- TypeScript先扫描ZIP目录，仅在使用条目时以`maxOutputLength`有界展开；Rust先扫描`ZipArchive`元数据，再逐条目读取并立即校验SHA-256/解析，不再同时持有五个展开文件。
- 双实现测试覆盖压缩比炸弹、单条目/展开总量、极深JSON、超长数组/字符串和记录数；所有拒绝发生在正式SQLite写事务之前。

## SR2-004 — CLOSED

- TypeScript/Rust 双实现不再只看敏感键名；所有字符串值、嵌套JSON、普通叙事文本、`request_json`、`validation_error_json`和`raw_response_text`都经过相同高置信扫描。
- 显式识别 Bearer/Basic Authorization、常见 `sk-` Provider Key、JWT、Google/AWS/GitHub/Slack前缀、credential引用和测试密钥；普通“secret”叙事词不会单独命中。
- 导出在编码前扫描四个数据文件，并再次扫描最终ZIP字节；任一命中整体失败，不修改数据库或发布目标文件。
- 共享诊断redaction函数把已知敏感材料替换为`[REDACTED]`；隐私说明同时保留对任意变形/未知秘密无法绝对识别的诚实边界。
- 回归测试覆盖嵌套普通字段值、纯文本Provider回显、请求、响应、错误、普通叙事字段、已知测试密钥与无害叙事文本。

## SR2-005 — CLOSED

- DeepSeek、Qwen、OpenRouter只允许各自固定规范化端点，设置页将地址设为只读；Ollama和自定义服务探测并保存同一个规范化地址。
- 原生命令签发最长15分钟、最多64项的随机探测回执，并把回执精确绑定到Provider、端点SHA-256指纹、模型、能力来源、能力内容与探测指纹；伪造、篡改、过期或重启后的回执都必须重新探测。
- 能力来源显式区分`PROVIDER_RESPONSE`、`PRESET_METADATA`与`UNKNOWN`；没有响应或预设证据时使用保守能力值，不再由Provider名称推断系统消息、流式或结构能力。
- SQLite migration 3持久化端点指纹、能力来源和探测指纹。保存新端点/模型时，同一Provider旧模型在同一事务禁用；默认和备用设置先清理，再按当前选择原子写入。
- 回归测试覆盖固定端点替换拒绝、回执与端点/模型/能力绑定、指纹篡改拒绝、端点切换旧模型残留、默认/备用清空及migration约束。

## 待关闭

- SR2-006～SR2-010：按 `docs/TASKS_V0.2.md` 的 M1 顺序执行。
