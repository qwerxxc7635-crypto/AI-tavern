# Windows端到端测试

更新日期：2026-08-11

## 运行

```powershell
pnpm test:windows-e2e
```

该命令运行`ember-native-bridge`中的单存档发布纵向测试。它也是`pnpm check`所执行的Rust workspace测试之一。

## 自动覆盖

测试在自动清理的临时目录创建真实SQLite，并按同一Campaign顺序完成：

```text
验证首次启动没有Campaign或设备模型配置
→ 打开我的/API边界
创建世界并锁定字段
→ 完成车卡
→ 生成酒馆、NPC、传闻和时钟
→ NPC对话
→ 生成并接受任务
→ 完成8回合冒险和本地D20
→ 结算并返回酒馆
→ 登记默认/备用模型并切换默认模型
→ 继续NPC对话
→ 持久化一个未完成NPC请求并模拟进程中断
→ 关闭并重开Store，进入RECOVERY_REQUIRED
→ 检查恢复信息并原子恢复最近完整TAVERN阶段
→ 验证未完成请求已取消并继续NPC对话
→ 导出.emtavern
→ 删除本地Campaign
→ 检查并重新导入
→ 再次重开并继续对话
```

最终断言Campaign仍为`TAVERN`、对话按顺序保留、结算档案存在、恢复不会重放未完成操作、导入后的Campaign可继续写入，设备模型配置不被Campaign归档替换。与原生`.app`截图、文件对话框和删除确认的配套证据见`docs/audit/V0_2_VERTICAL_FLOW_GATE.md`。

## 安全边界

- 使用Fake生成结果，不调用真实模型或产生费用。
- 不读取或写入`%APPDATA%`生产数据库。
- 不创建或删除Windows Credential Manager凭据。
- 不替代安装后发布候选的UI、系统文件对话框、分辨率、键鼠和恢复入口人工检查；这些项目仍以`docs/WINDOWS_V0_1.md`为准。
