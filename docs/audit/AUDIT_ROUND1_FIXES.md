# Windows v0.1 第一轮独立发布审查修复

日期：2026-08-02

## 修复映射

| 编号 | 修复 | 回归保护 |
| --- | --- | --- |
| AUD-001 | 在发起 Provider 请求前解析全部候选地址；HTTP 只允许全回环，HTTPS 只允许全公开地址；把客户端固定到已验证地址并禁止重定向 | `ember-secure-http` 覆盖 IPv4、IPv6、私网、链路本地、回环与混合 DNS 结果 |
| AUD-002 | 为生产 WebView 启用只允许打包资源、Tauri IPC、必要图片与内联样式的 CSP | `tauri-config.test.ts` 精确断言 CSP |
| AUD-003 | 移除 `core:default`，仅保留事件监听和打开/保存对话框能力 | 配置测试精确断言权限数组，并禁止 shell、fs、http、devtools 与宽泛默认能力 |
| AUD-004 | 固定两份由不同实现生成的 `.emtavern` v1 夹具 | Rust 导入 TypeScript 夹具，TypeScript 导入 Rust 夹具；同时验证游戏事实、IMPORT 快照和设备配置排除边界 |

## 数据与兼容性

- SQLite 仍是唯一真实数据源；修复未改变状态提交路径。
- Provider 仍只是可替换内容生成器；本轮没有启用真实云端游戏生成。
- `.emtavern` 格式版本与数据库 Schema 版本未变，新增的是双向兼容性门禁。
- API Key 仍只通过 Windows 安全凭据边界使用，不进入普通配置、SQLite、归档或日志。

完整门禁、安装烟测、产物与剩余风险见本轮移交包中的正式报告。
