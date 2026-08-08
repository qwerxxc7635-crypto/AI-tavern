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

## 待关闭

- SR2-004～SR2-010：按 `docs/TASKS_V0.2.md` 的 M1 顺序执行。
