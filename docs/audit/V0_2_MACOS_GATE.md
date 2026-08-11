# Ember Tavern v0.2 macOS Gate 验收记录

## 结论

`V02-M9-T03` macOS Gate在GitHub托管的全新macOS arm64环境通过。验收覆盖真实Keychain、系统WebKit/WKWebView、v0.2.0 `.app`、应用启动存活和macOS PlatformPaths；没有访问正式用户数据、真实Provider或付费API。

## 基线与证据

- 分支HEAD：`3a6e656 ci(v0.2): automate macOS release gate`
- 权威PR流水线：[CI run 31461140570](https://github.com/qwerxxc7635-crypto/AI-tavern/actions/runs/31461140570)
- 环境：Darwin，arm64，`RUNNER_OS=macOS`
- macOS共享质量任务：成功
- macOS build/lifecycle任务：成功
- `.app`构建：2026-08-11T05:28:56.286Z至2026-08-11T05:33:29.797Z，退出码0
- 生命周期：2026-08-11T05:33:30.175Z至2026-08-11T05:34:12.551Z，退出码0
- 原始artifact：`ember-tavern-macos-build-evidence`

下载后的原始证据位于Git忽略的`.local/evidence/run-31461140570-macos`。关键JSON的本地SHA-256如下：

| 证据 | SHA-256 |
| --- | --- |
| `macos-app-build.json` | `ac8508a23e56236e344bf7a5346c5b6cd58737b966f129d423f584d232c1edb2` |
| `macos-lifecycle-gate-command.json` | `552329cfbb2a4735df2224a26de0c61ca58cb41b48afe76aaa4c58e3750e9d29` |
| `macos-lifecycle.json` | `a632f0b6a04b1f88ce609b6edd831d8ec9f597fa546bbc534dda648206006bad` |
| `macos-release-files.json` | `eb1fc039eb0fb69612d4829bf638d3d77101e08de9919504c39f1e58ebf01879` |

## 门禁映射

| 必须项 | 实机结果 |
| --- | --- |
| Keychain | OS存储往返、读取、删除与幂等删除退出码0；测试后无秘密遗留 |
| WKWebView | `.app`链接系统`WebKit.framework`；应用启动产生2个新WebKit进程 |
| `.app` | `Ember Tavern.app`为arm64，bundle ID `com.embertavern.windows`，版本`0.2.0` |
| launch | 安装包内可执行进程存活观察19秒，stdout/stderr均为0 bytes |
| PlatformPaths | data/cache/log/temp全部为绝对路径；应用实际在macOS Application Support路径创建SQLite；macOS adapter合同测试通过 |

`.app`内可执行文件为21,614,912 bytes，SHA-256为`d2dcf78d24c3d2062b9857c55ad7a33d28e3573753f8a91d1cae9a1839d92c94`，生命周期记录与发布文件清单一致。

## 数据保护与清理

- 门禁只允许`CI=true`、`RUNNER_OS=macOS`且`process.platform=darwin`的临时托管机运行。
- 启动前逐一拒绝已存在的Application Support、Caches、Logs和WebKit应用路径；只有全部确认不存在后才设置清理授权。
- 本次运行创建并清理Application Support、Caches和WebKit路径；没有创建Logs路径，因此没有删除它。
- 非CI拒绝路径已在本机验证：`cleanup.authorized=false`且删除列表为空。

## 边界

- 没有调用真实Provider、付费API、正式用户数据或API Key。
- 没有创建、修改或验收iOS工程。
- 本任务只完成macOS平台门禁，不提前执行M9-T04四分辨率UI截图验收。
