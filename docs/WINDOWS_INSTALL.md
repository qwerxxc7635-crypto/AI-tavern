# Ember Tavern Windows 安装与数据保留

## 系统要求

- 64位Windows 10或Windows 11；
- Microsoft Edge WebView2 Runtime；
- 使用云模型时需要网络和玩家自己的Provider凭据。

安装器在系统缺少WebView2时使用Microsoft bootstrapper静默下载安装，因此该场景需要网络。应用本体不依赖Node.js、pnpm、Rust、仓库文件或开发服务器。

## 安装包

内部发布候选由以下命令生成：

```powershell
pnpm --filter @ember-tavern/windows-app tauri build --bundles nsis --no-sign
```

产物位于：

```text
target/release/bundle/nsis/Ember Tavern_0.1.0_x64-setup.exe
```

当前安装器按Windows当前用户安装，不要求管理员权限。它会创建程序文件、开始菜单入口和“已安装的应用”卸载记录。当前仓库生成的是未签名内部候选，Windows可能显示未知发布者提示；正式外部发布必须使用项目认可的代码签名证书重新构建。

## 用户数据与凭据

程序文件与用户数据分离。默认数据位置为：

```text
%APPDATA%\com.embertavern.windows\ember-tavern.sqlite
%APPDATA%\com.embertavern.windows\ember-tavern.sqlite.backups\
```

SQLite是游戏事实唯一来源；`.backups`保存启动或迁移前经过校验的最近完整备份。API Key不写入SQLite、普通配置、日志或`.emtavern`，只保存在Windows Credential Manager；SQLite仅保存不透明`credentialRef`。

重要Campaign应定期从存档首页导出为`.emtavern`，尤其是在更换设备、手工清理数据或正式卸载前。

## 卸载与重装

卸载器会移除程序文件、快捷方式和Windows卸载记录，但默认保留：

- `%APPDATA%\com.embertavern.windows`中的SQLite与完整备份；
- Windows Credential Manager中由玩家保存的Provider凭据。

因此重装同一标识的兼容版本后可以继续使用原本地数据。保留策略避免普通卸载误删存档；它也意味着卸载不会自动释放用户数据占用的磁盘空间。删除或迁移真实数据前应先完成`.emtavern`导出和完整备份，当前首版不提供“一键删除全部本机数据”。

## 已知限制

- 当前内部候选未签名，不是正式外部发行包；
- 缺少WebView2的机器首次安装需要联网；
- v0.1不提供自动更新；新版本通过新的安装包升级，配置禁止旧版本覆盖新版本；
- v0.1不自动删除用户数据或系统安全凭据。
