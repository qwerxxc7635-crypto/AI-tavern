# SillyTavern 分析

## 观察

- Connection Manager 提供命名连接、模型、preset、代理和 tokenizer 的组合 UX，但其运行时状态高度可变。
- World Info 提供关键词/正则触发、扫描深度、递归、组选择、插入位置和 token 预算。
- Persona 将玩家身份、描述、插入位置和角色绑定分离。
- Prompt 管理器可展示实际 completion、各块 token 与预算。
- 角色卡、swipe 候选、locale 和 extension manifest 形成成熟生态。

## Ember 适配

- 只借鉴命名 ConnectionProfile、结构化 lore 条目、独立玩家 persona、上下文检查器、候选列表、资源化本地化和内部扩展 seam。
- 运行前必须解析为不可变 `ResolvedModelConfig`，再投影成最小 `ProviderRequest`；UI 可变状态不能直接成为 provider 输入。
- lore 召回必须保留来源、版本、优先级、隐私等级和 token 决策，不能只靠前端字符串扫描。

## 不采用

- 不复制 AGPL 源码。
- v0.2 不做插件市场、完整扩展生态、完整角色卡兼容矩阵或高级群聊。
- 不采用浏览器服务替代本地原生边界，也不让前端持有 provider 密钥或直接发请求。

