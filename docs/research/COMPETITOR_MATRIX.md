# 竞品横向矩阵

| 维度 | RePoG | TavernAI（公开文档） | SillyTavern | Ember v0.2 决策 |
|---|---|---|---|---|
| Provider | 工作流外部能力 | 本地/远端 UX | 多连接/模型/preset | 三层配置 + 原生安全请求 |
| Prompt | 规则化工作流 | 有序树、角色、位置、预览 | PromptManager/预算 | ContextBlock 单一路径 |
| Context | hot/cold、按需装载 | 深度/位置/token | 扫描、递归、预算 | stable/semi/dynamic 分区 |
| Lore | 世界文件 | 角色/文件 prompt | World Info | 结构化 lore block |
| Memory | distill/snapshot | 会话历史 | 摘要扩展 | 来源化 Memory，非真相 |
| Character | 作者权边界 | 每角色 prompt | card/persona | 车卡候选 + 本地校验 |
| NPC | observation-bound | 角色上下文 | persona/群聊 | 知识边界与来源链 |
| Knowledge | truth/claim/knowledge | 未公开实现 | lore 注入 | 四层正式模型 |
| Branch | replay/恢复语义 | swipe/branch | swipes | 候选替代；完整分支延期 |
| GM | causal spine | 叙事体验 | prompt 驱动 | Resolve/Persist/Narrate |
| Dice | 确定工具 | 无核心证据 | 扩展生态 | 本地 D20 hard logic |
| State | revision/操作记录 | 会话/项目视图 | 文件/前端状态 | SQLite 唯一真相 |
| Recovery | snapshot/resume anchor | 版本/历史 | 聊天备份 | SceneFrame + checkpoint |
| Localization | 非重点 | locale 文档 | 多 locale | zh-CN 资源层 + 英文门禁 |
| Extensibility | 工作流文件 | 未知 | 插件/扩展 | 内部 ports；市场延期 |
| Security | 边界规则 | 无源码可审计 | 浏览器服务模型 | vault + SSRF + 导入限额 |
| UX complexity | 中 | 中高 | 高 | 渐进披露，核心路径优先 |
| Cross-platform | 文本工作区 | 桌面发布描述 | 浏览器/Node | Windows 发行 + macOS 开发门禁 |

