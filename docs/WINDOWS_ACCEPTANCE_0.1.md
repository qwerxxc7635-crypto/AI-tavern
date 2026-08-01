# Windows 0.1 最终验收记录

日期：2026-08-01

结论：`M10-T06` 的 Windows 范围通过。M9 与 M10-T04 继续 `DEFERRED`，未计入本次结论。

## 验收环境与隔离

- Windows 11 x64，WebView2，125% DPI；物理桌面可覆盖 1920×1080。
- 使用 Release 构建和独立应用标识 `com.embertavern.windows.m10t06`，数据只写入对应隔离目录；正式 `%APPDATA%/com.embertavern.windows` 数据库的最后写入时间保持不变。
- 联网模型测试只访问 `http://127.0.0.1:38117` 的临时 OpenAI-Compatible 模型列表服务，没有访问真实 Provider 或产生费用。
- 验收结束后已停止应用和临时服务，并删除隔离的 Roaming/Local 数据；导出的脱敏 `.emtavern` 样本保留在验收工件目录。

## 真实 UI 纵向流程

1. 从空状态新建存档，输入“群岛被永夜潮汐包围，失落灯塔守护最后航路。”，生成并确认世界。
2. 创建“岚”并完成属性、两项特质和初始装备，初始化酒馆、1 名老板、2 名常客、1 名访客及传闻。
3. 与同一 NPC 连续发送两条消息；SQLite 保存 4 条有序消息，关系信任值增加到 2。生成两项任务并接受其中一项主任务。
4. 开始冒险并完成 8 回合；其中 3 回合执行本地 D20，另外 5 回合无检定。第 8 回合进入结局并执行结算。
5. 结算后 Campaign 回到 `TAVERN`，Adventure 为 `SETTLED`，任务为 `COMPLETED`；新增 Stormglass Compass、NPC 关系事件、酒馆 TROPHY 变化、世界事实和从 0 推进到 1 的世界时钟，档案保留 8 回合与结局。
6. 在酒馆已提交状态强制结束进程；主库 `PRAGMA integrity_check` 为 `ok`，重启后酒馆、4 名 NPC 和已提交进度均恢复，没有重复提交。

## 模型、故障与恢复

- 设置页实际完成模型探测、默认/备用保存、重启显示和凭据删除；删除后 SQLite 的 `credential_ref` 为 `NULL`，模型配置仍保留。
- 回环服务返回两个模型；实际把 `ember-local-backup` 切换为默认，把 `ember-local-smoke` 保留为备用，重启前数据库完整性为 `ok`。这验证设备模型选择与切换，不改变 Windows 0.1 游戏内容仍由 Fake Provider 生成的发布边界。
- 另行制造 `RECOVERY_REQUIRED` 与 1 条 `SENDING` 请求。普通存档首页显示“需要恢复”，恢复中心显示目标 `TAVERN` 和待取消数量 1；恢复后请求为 `CANCELLED`、Campaign 为 `TAVERN`、`resume_state` 清空，未重复提交回合。
- 共享应用层的额度耗尽后切换模型并继续同一持久化上下文，继续由 M10-T03 单存档端到端测试覆盖；Windows 0.1 尚不把云配置接入游戏生成，这一点继续在隐私和发布说明中明确披露。

## 存档往返与秘密边界

- 通过系统保存对话框导出 179,963 字节的 `.emtavern`；SHA-256 为 `3120DAB7AFD069D9AE27ACCAFC450AD5600AB29E27977AEDCB9B6D84FAEB60C4`。
- “永久删除”先生成 602,112 字节的一致性完整备份，再只删除选中的 Campaign；数据库完整性保持 `ok`。
- 通过系统打开对话框重新导入后，Campaign 为 `TAVERN`，8 回合 Adventure 为 `SETTLED`，任务、奖励、酒馆变化、世界时钟和档案完整；Escape 取消另一轮导入不改变数据库。
- 归档只含 `manifest.json`、`campaign.json`、`events.ndjson`、`generations.json` 和 `checksum.json`；不含 Provider 配置、`credential:v1:` 引用、设备模型名称或测试密钥。

## 窗口与输入

- 逐一检查 860×600、1180×760、1366×768、1920×1080。860×600 使用内容区滚动访问底部操作；其余尺寸未发现关键内容横向截断。
- 实测过程中使用鼠标、Tab、Enter 和 Escape 完成表单、确认、文件对话框取消与关键操作。
- 烟测发现原布局把长页面裁在视口外且鼠标滚轮无效；已把壳层限定为 `100vh`，并让 workspace 主内容区独立纵向滚动。修复后酒馆、对话、任务、冒险和设置底部操作均可达。

## 最终质量门

- `pnpm check`：Prettier、ESLint、TypeScript、58 个 Vitest 文件/338 项、10 项 Node SQLite、严格 Clippy、32 项 native-bridge、15 项 Provider、7 项 HTTP、3 项 SecretStore 和 1 项 Tauri 测试全部通过。
- `pnpm --dir windows-app build`：179 个模块，生产构建通过。
- `pnpm --dir windows-app tauri build --bundles nsis --no-sign`：生成 `target/release/bundle/nsis/Ember Tavern_0.1.0_x64-setup.exe`，5,070,149 字节，SHA-256 `51F824342223895FBC2B8ACB23AB5B6E25BC315E1FF26256007D794CE244F2F6`。
- 对 Git 跟踪源码/配置、归档内容和安装包执行高置信秘密扫描；无命中，测试密钥的 ASCII/UTF-16 字节也不在安装包中。
- 安装包未签名，因此 Windows 可能显示“未知发布者”；正式外发仍需要代码签名证书。
