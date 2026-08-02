# Windows v0.1 第一轮独立发布审查发现

审查起始 HEAD：`3a2027c0b1111016e5ac46e748dbfae1fc69ddc7`

本文件在任何审查修复之前建立。状态会在修复和完整复验后更新，但原始证据与触发条件保持不变。

## AUD-001

- 严重程度：P1
- 标题：自定义 Provider 允许解析到本机或私有网络的 HTTPS 目标，且请求时没有固定已验证的解析结果
- 涉及文件：`crates/secure-http/src/lib.rs`
- 涉及代码位置：`ApprovedEndpoint::parse`（审查起始版本第 25-40 行）、`SecureHttpTransport::send_streaming`（第 166-190 行）
- 触发条件：把自定义 Base URL 设置为 `https://127.0.0.1/`、`https://[::1]/`、HTTPS 私网地址，或设置为初次解析安全但后续可重绑定到受限地址的主机名。
- 证据：端点解析只要求远程地址使用 HTTPS；回环限制只作用于 HTTP。发送阶段直接把 URL 交给共享 `reqwest::Client` 再次解析，没有检查最终 IPv4/IPv6，也没有把连接固定到已验证地址。现有端点策略测试仅拒绝远程明文 HTTP、用户信息、缺少尾斜杠和路径逃逸，没有覆盖 HTTPS 回环、私网、链路本地、未指定地址或 DNS 重绑定。
- 用户影响：恶意或误配置的自定义 Provider 可让应用访问本机或内网 HTTPS 服务；如果该配置同时引用凭据，凭据会被发送到该目标。
- 数据影响：游戏事实不会因此直接写入，但 Provider 凭据和本机网络服务可能暴露给错误目标。
- 安全影响：形成可复现的 SSRF 与解析后目标绕过，违反“解析后的目标也必须受限制”的发布边界。
- 是否已有测试：否；只有语法级来源和相对路径测试。
- 建议修复：解析并验证所有候选 Socket 地址；HTTP 必须全部为回环，HTTPS 必须全部为公开可路由地址；构建请求客户端时固定到已验证地址并保持禁止重定向；补齐 IPv4、IPv6、localhost、私网和混合解析结果测试。
- 最终处理状态：FIXED（解析结果全量校验并固定连接地址；新增 IP 字面量、私网、混合 DNS 与回环测试）

## AUD-002

- 严重程度：P2
- 标题：生产 WebView 明确关闭 Content Security Policy
- 涉及文件：`windows-app/src-tauri/tauri.conf.json`、`windows-app/src/tauri-config.test.ts`
- 涉及代码位置：`app.security.csp`（审查起始版本第 25-26 行）；发布配置测试未断言 CSP。
- 触发条件：生产前端任一位置出现脚本或 HTML 注入缺陷时。
- 证据：Tauri 配置把 `csp` 设为 `null`，构建出的生产 WebView 因而没有应用级 CSP；现有配置测试只验证产品、安装和图标元数据。
- 用户影响：前端注入缺陷的影响面扩大，可直接调用已注册的原生命令。
- 数据影响：被利用时可通过正常应用命令读取或修改当前用户的本地 Campaign。
- 安全影响：缺少桌面 WebView 的纵深防御，且与应用拥有持久化和凭据相关命令的风险不相称。
- 是否已有测试：否。
- 建议修复：为生产配置设置只允许打包资源、Tauri IPC 和必要图片/样式来源的 CSP，并在发布配置测试中锁定；开发来源单独处理，不进入生产 CSP。
- 最终处理状态：FIXED（启用生产 CSP，并由发布配置测试锁定）

## AUD-003

- 严重程度：P2
- 标题：生产能力清单使用 `core:default`，包含内部 DevTools 切换和无关核心能力
- 涉及文件：`windows-app/src-tauri/capabilities/default.json`、`windows-app/src/tauri-config.test.ts`
- 涉及代码位置：`permissions` 数组（审查起始版本第 6 行）；生成的 `desktop-schema.json` 对 `core:default` 的展开说明。
- 触发条件：生产 WebView 运行时。
- 证据：能力清单授予 `core:default`。Tauri 生成 Schema 显示它展开为 path、event、window、webview、app、image、resources、menu 和 tray 默认集合，其中 `core:webview:default` 明确包含 `allow-internal-toggle-devtools`。当前前端只需要自定义命令调用、拖放事件监听以及打开/保存对话框。
- 用户影响：正常功能没有直接错误，但 WebView 获得超出实际需要的生产能力。
- 数据影响：没有单独的数据写入；与注入缺陷组合时扩大可调用面。
- 安全影响：违反最小权限和“调试能力不能进入生产配置”的审查要求。
- 是否已有测试：否；能力文件没有发布回归测试。
- 建议修复：移除 `core:default`，仅授予拖放监听所需的事件能力和打开/保存对话框；为能力清单增加精确断言，禁止 default、shell、fs、http 和 DevTools 权限。
- 最终处理状态：FIXED（替换为事件与文件对话框所需最小权限，并禁止宽泛默认能力）

## AUD-004

- 严重程度：P2
- 标题：`.emtavern` 的 TypeScript 与 Rust 双向兼容没有跨实现测试
- 涉及文件：`packages/persistence/src/save-export.test.ts`、`crates/native-bridge/src/save_archive.rs`、测试夹具目录（缺失）
- 涉及代码位置：TypeScript 导出/导入测试和 Rust `save_archive::tests`。
- 触发条件：任一实现独立修改 ZIP、规范 JSON、排序、Schema、校验和或行表示，而同语言往返测试仍然通过。
- 证据：代码搜索只发现 TypeScript 自身导出/导入测试与 Rust 自身导出/导入测试；不存在 TypeScript 导出→Rust 导入或 Rust 导出→TypeScript 导入的夹具/测试。两个实现分别维护相同常量和编码器，当前门禁无法发现跨实现漂移。
- 用户影响：Windows 与未来 iOS/共享运行时之间的存档迁移可能在发布后才暴露不兼容。
- 数据影响：不兼容归档会被拒绝；若校验差异遗漏，可能导致导入失败或错误恢复。
- 安全影响：跨实现解析器的拒绝规则无法互相验证，归档边界回归不受发布门保护。
- 是否已有测试：有各自实现内往返测试；没有跨实现测试。
- 建议修复：增加由 TypeScript 生成并由 Rust 导入的固定夹具，以及由 Rust 生成并由 TypeScript 导入的固定夹具；两侧验证内容、固定五条目、校验和和秘密边界。
- 最终处理状态：FIXED（加入 TypeScript→Rust 与 Rust→TypeScript 双向固定夹具测试）
