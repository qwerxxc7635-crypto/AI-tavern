# v0.2 Borrow Plan

| 借鉴项 | clean-room 实现位置 | 验收 |
|---|---|---|
| 因果回合与玩家作者权 | orchestrator + domain policy | AI 叙事不能先于事实提交，越界候选被拒绝 |
| hot/cold 上下文 | context assembler | 稳定块可缓存，动态块不污染缓存；来源可追溯 |
| SceneFrame/恢复锚点 | domain + persistence | 中断后从同 revision 恢复，未决后果不丢失 |
| operation/revision | Event Ledger | 重放幂等，陈旧写入失败 |
| Prompt preview/token | Context Inspector | 与发送使用相同装配结果，隐私默认隐藏 |
| 连接 profile UX | settings/application | profile 解析为 frozen config，密钥只以引用存在 |
| World Info/persona | context blocks | lore/persona 独立、预算化、来源化 |
| swipe 候选 | candidate infrastructure | 接受前不修改真实状态 |
| locale resources | UI resource layer | zh-CN 核心覆盖，英文缺键门禁 |

所有实现从 Ember 的接口和测试重新设计；第三方代码、提示词正文和资源不进入仓库。

