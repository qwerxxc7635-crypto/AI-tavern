# Ember Tavern v0.2 Windows Gate 验收记录

## 结论

`V02-M9-T02` Windows Gate在GitHub托管的全新Windows x64环境通过。验收覆盖真实Windows Credential Manager、WebView2 Runtime、v0.2.0 NSIS、静默安装、应用启动存活和静默卸载；没有访问正式用户数据、真实Provider或付费API。

## 基线与证据

- 分支HEAD：`43aea70 fix: handle empty WebView process sets`
- 权威PR流水线：[CI run 31446196404](https://github.com/qwerxxc7635-crypto/AI-tavern/actions/runs/31446196404)
- 环境：Microsoft Windows NT 10.0.26100.0，X64
- Windows共享质量任务：成功
- Windows发布任务：成功
- 纵向切片：`pnpm test:windows-e2e`，退出码0
- NSIS构建：`pnpm --dir windows-app tauri build --bundles nsis`，退出码0
- 生命周期：2026-08-11T00:50:42.448Z至2026-08-11T00:51:04.260Z，退出码0
- 原始artifact：`ember-tavern-windows-release-evidence`

下载后的原始证据位于Git忽略的`.local/evidence/run-31446196404`。关键JSON的本地SHA-256如下：

| 证据 | SHA-256 |
| --- | --- |
| `windows-e2e.json` | `c0184b9a6de11dbf9deb6d9945ef994c930585aaa9d0cf1667556a07a1635873` |
| `windows-nsis-build.json` | `12df0aa4008322409f23cb52bc5a67d970f7af993ae3f4ad256e7d2718c40f86` |
| `windows-install-gate-command.json` | `8de6a4b25af9fb84d56227e5a5b8e4f79a87d39adc567d9df827c87f858f5242` |
| `windows-install-lifecycle.json` | `b995984b83f5219546297f2951ea16c73bb6da7cd20043a2b66b849f0659cc37` |
| `windows-release-files.json` | `99efed2faab0fe9fb187c6a3eedb52329511d824532418effa26ce506ea42d8e` |

## 门禁映射

| 必须项 | 实机结果 |
| --- | --- |
| Credential Manager | OS存储往返与幂等删除测试退出码0；测试后无秘密遗留 |
| WebView2 | 发现Runtime `150.0.4078.105`，应用启动产生2个新`msedgewebview2`进程 |
| NSIS | 生成`Ember Tavern_0.2.0_x64-setup.exe`，5,223,248 bytes |
| install | 当前用户静默安装退出码0；HKCU卸载注册存在；产品版本为`0.2.0` |
| launch | 安装后的应用进程存活观察11秒；WebView2进程已观测 |
| uninstall | 静默卸载退出码0；卸载注册和安装目录移除；应用数据哨兵保留 |

安装器SHA-256为`6137ed6c0fb5be27e8e8e490883ada354e74e3b6e6d3cafb42da88e876a95a7d`，生命周期记录、发布文件清单与下载后本地复算三者一致。

## 失败证据与修复

- 首轮Windows格式门禁暴露CRLF漂移，使用仓库级行尾策略修复。
- 后续实机门禁暴露Windows测试超时、文件锁错误码和Node 24启动`pnpm.cmd`问题，分别以平台超时、原生锁错误映射和可移植pnpm入口修复。
- 生命周期前两次运行分别暴露PowerShell严格模式下空注册表结果的`.Count`和空WebView进程集合的`.Id`访问；失败JSON保留在对应`.local/evidence/run-*`目录，最终运行未跳过任何步骤。

## 边界

- 生命周期脚本只允许在`CI=true`且`RUNNER_OS=Windows`的临时托管机运行，并拒绝覆盖既有安装或应用数据目录。
- 安装和数据清理目标都经过精确路径检查；卸载必须保留应用数据哨兵。
- 没有调用真实Provider、付费API、正式用户数据或API Key。
- 没有创建、修改或验收iOS工程。
- 本记录不冒充`V02-M9-T03`要求的Keychain、WKWebView、`.app`启动和macOS PlatformPaths验收。
