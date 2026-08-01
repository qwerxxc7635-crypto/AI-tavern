# Ember Tavern Windows 0.1 隐私与本地数据说明

更新日期：2026-08-01

本文适用于当前Windows 0.1内部发布候选。iOS尚未进入本阶段，后续恢复M9时另行补充。

## 一句话说明

游戏事实、对话、模型审计和设置默认保存在本机。当前0.1候选的游戏内容由内置Fake Provider离线生成，不会把Campaign内容发送给云模型；只有玩家主动点击“测试连接”时，应用才会连接所选Provider的模型列表接口。

## 本机保存的数据

默认数据目录：

```text
%APPDATA%\com.embertavern.windows\ember-tavern.sqlite
%APPDATA%\com.embertavern.windows\ember-tavern.sqlite.backups\
```

SQLite是游戏状态的唯一真实数据源，包含：

- Campaign、世界、角色、酒馆、NPC认知/关系、任务、冒险、骰点、物品、时钟和事件；
- 玩家输入、NPC对话和冒险行动；
- AI请求所用上下文、请求结构、模型原始响应、验证结果和失败分类；
- Provider名称、Base URL、模型能力、默认/备用选择和不透明`credentialRef`；
- 自动恢复快照和未完成请求状态。

`.backups`是完整SQLite备份，因此包含同类本地数据和不透明凭据引用，但不包含API Key本身。应用当前不创建独立文本日志文件，也不包含遥测、广告SDK或产品分析上报。诊断所需的生成记录和错误分类保存在SQLite；分享数据库或存档给他人前，应把它视为可能包含私人创作内容的文件。

## API Key

API Key保存在Windows系统安全凭据库，服务标识为`com.embertavern.model-provider`。SQLite、普通JSON、应用输出和`.emtavern`只允许保存形如`credential:v1:...`的不透明引用，不保存密钥明文。

在设置页测试连接时：

- 玩家输入的Key先临时写入系统凭据库；
- 应用从安全存储读取它并作为敏感Authorization Header发给所选Base URL；
- 测试结束后会删除临时凭据；只有玩家保存配置时才保留新的系统凭据；
- Header值不会出现在Debug输出中。

卸载应用不会自动删除这些凭据。玩家可以先在应用内删除已知凭据（当前设置页尚无完整凭据管理列表），或在Windows“凭据管理器”中删除与上述服务标识关联的条目。

## 当前会发生的联网

当前内部候选有以下联网边界：

1. 缺少WebView2时，安装器可从Microsoft下载安装WebView2 bootstrapper。
2. 玩家主动点击“测试连接并列出模型”时，应用向所选Base URL请求模型列表；云Provider通常会收到API Key、源IP和正常HTTP元数据，但不会收到Campaign、对话或角色内容。
3. Ollama和自定义本机服务使用`localhost`/回环地址；数据会离开Ember Tavern进程并交给该本机服务处理。该服务是否继续联网由其自身配置和隐私规则决定。

远程Provider只允许HTTPS；明文HTTP只允许本机回环地址。HTTP重定向被禁用，防止已批准地址把请求转发到另一来源。

## 云游戏生成尚未启用

设置页可以探测并保存DeepSeek、Qwen、OpenRouter、Ollama或自定义兼容服务，但当前Windows游戏服务仍使用本地Fake Provider。保存“默认”或“备用”模型不会把现有Campaign发送到对应服务商，也不会使后续游戏回合自动改用云模型。

未来若正式启用云游戏生成，首次使用和跨服务商切换前必须显示固定确认信息，包括接收方、用途和将发送的数据类型。必要上下文可能包括：

- 玩家本次输入、世界构想、角色概念、偏好和内容边界；
- 与当前任务有关的世界、酒馆、NPC、关系、任务、物品、线索和时钟；
- 有界的最近对话/冒险回合和长期摘要；
- 任务类型、输出格式、Prompt版本和所选模型名。

不会发送API Key给所选Provider以外的服务商，也不得把整个SQLite、完整历史、设备设置或无关Campaign作为模型上下文。玩家拒绝跨服务商确认时，不得发送请求或修改游戏状态。

## `.emtavern`导入导出

`.emtavern`包含一个Campaign的完整游戏事实、事件和生成审计，因此可能含玩家输入、对话、Prompt请求结构、模型原始响应和验证错误。它不包含：

- API Key、登录令牌或Windows安全凭据库；
- Provider配置、Base URL、默认/备用模型等设备设置；
- SQLite完整备份、恢复缓存或独立应用日志。

`.emtavern`不会自动上传；只有玩家通过系统文件对话框选择位置后才会写入。请像处理私人创作文件一样保管它，并只发送给信任的接收方。

## 删除、卸载与重装

存档首页的“归档”只是让Campaign离开活动列表，不等于安全擦除。当前0.1没有“一键删除全部本机数据”。卸载器会删除程序文件、快捷方式和卸载记录，但默认保留应用数据目录及Windows凭据，以避免误删存档。

需要彻底清理时：

1. 先导出仍需保留的Campaign；
2. 完全退出Ember Tavern；
3. 卸载应用；
4. 精确删除`%APPDATA%\com.embertavern.windows`目录；
5. 在Windows凭据管理器中删除`com.embertavern.model-provider`关联条目。

删除前请再次确认路径，SQLite和完整备份一旦删除将无法由应用恢复。

## 已知限制

- 当前包未签名，仅用于内部候选验收；
- 当前游戏内容生成仍是离线Fake Provider，云模型只支持连接测试/模型发现和配置保存；
- 当前没有独立日志查看器、诊断包导出、遥测开关或一键删除全部数据；
- 当前没有云同步；跨设备迁移依赖玩家手动导出和导入`.emtavern`。
