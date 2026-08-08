# v0.1 第二轮审查修复记录

原始依据：`Ember_Tavern_Windows_v0.1_Second_Round_Audit.md`。本文件只在测试证据真实通过后把条目标为关闭。

## SR2-001 — CLOSED

- 用维护的 `antissrf` `ExternalOnlyLatest` IANA/RFC 地址策略替代手写“公网 IP” denylist；关闭默认 network integration，仅使用静态地址政策。
- IPv4-mapped、旧 IPv4-compatible、NAT64、6to4、Teredo 先识别内嵌 IPv4 并复用 IPv4 策略；外层特殊用途策略仍必须通过。
- DNS 仍要求非空且全部地址可接受，混合 DNS 整体拒绝；单次解析结果固定给 reqwest，URL host 保持为 Host/SNI 来源。
- reqwest redirect policy 继续为 `none`，不存在跳转到私网的第二连接。
- 11 项 `ember-secure-http` 测试通过；新增 IPv4/IPv6 special-use、mapped/compatible、NAT64、6to4、Teredo、混合 DNS矩阵。

## 待关闭

- SR2-002～SR2-010：按 `docs/TASKS_V0.2.md` 的 M1 顺序执行。
