# Ember Tavern Windows 0.1 内部候选说明

发布日期：2026-08-01

## 状态

这是Windows 0.1内部发布候选，不是已签名的公开发行版。安装包可能显示“未知发布者”。

## 本版包含

- 从世界创建、车卡、酒馆、NPC对话、任务、8至12回合冒险、本地D20到结算/档案的离线纵向体验；
- SQLite自动保存、重启恢复、AUTO快照、完整备份和启动恢复入口；
- `.emtavern` v1导出、校验、导入、覆盖前备份和Windows文件选择/拖放；
- DeepSeek、Qwen、OpenRouter、Ollama和自定义OpenAI兼容服务的连接测试、模型发现及本地设置；
- 当前用户NSIS安装和卸载器，卸载默认保留玩家数据与系统凭据。

## 隐私摘要

当前游戏内容生成使用离线Fake Provider，Campaign内容不会发给云模型。只有玩家主动测试Provider连接时，应用才会向所选Base URL发送API Key并读取模型列表。API Key保存在Windows安全凭据库；SQLite和`.emtavern`不保存明文Key。完整说明见[`PRIVACY_WINDOWS.md`](PRIVACY_WINDOWS.md)。

## 已知限制

- 当前内部包未签名，正式外部发布需要代码签名证书；
- 保存云Provider配置不会让游戏回合改用云模型；云游戏生成尚未接入Windows服务；
- iOS任务和iOS端到端验收已延期，不属于本候选完成条件；
- 不提供自动更新、云同步、独立日志文件、诊断包导出或一键删除全部本机数据；
- Windows最终验收已覆盖分辨率、键鼠、系统文件对话框、永久删除备份和故障恢复入口；记录见[`WINDOWS_ACCEPTANCE_0.1.md`](WINDOWS_ACCEPTANCE_0.1.md)。

安装、数据目录和卸载保留策略见[`WINDOWS_INSTALL.md`](WINDOWS_INSTALL.md)；自动端到端测试见[`WINDOWS_E2E.md`](WINDOWS_E2E.md)。
