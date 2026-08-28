# Ember Tavern V0.3 第二轮完整审计 Findings Ledger

- 审计产品源码：`bc5fb56f5f5058b48511d5d5b8d8888dc68ed0fd`
- 审计分支：`audit/v0.3-second-full-audit`
- 建立日期：2026-08-28
- 状态：FROZEN BEFORE REMEDIATION

本账本在第二轮修复开始前建立。第一轮报告、`TASKS.md` 的 DONE 状态和既有 evidence 只作为待验证声明；结论来自当前源码、Git 范围、重新运行的测试、隔离 SQLite、重新构建的应用和新的 evidence。

## 摘要

| 严重度 | 发现 | OPEN | FIXED | DEFERRED_ACCEPTED | BLOCKED_EXTERNAL |
| --- | ---: | ---: | ---: | ---: | ---: |
| P0 | 0 | 0 | 0 | 0 | 0 |
| P1 | 0 | 0 | 0 | 0 | 0 |
| P2 | 1 | 1 | 0 | 0 | 0 |
| P3 | 1 | 1 | 0 | 0 | 0 |

平台 lifecycle 与真实 Provider 未评价项不是产品 finding，分别保留为 `BLOCKED_EXTERNAL` 与 `NOT_EVALUATED`。

## V03-SA-001 — macOS bundle 哈希会吸收同目录陈旧 `.app`

- Severity：P2
- Status：OPEN
- 影响范围：Release evidence、artifact identity、macOS 静态发布门
- 可复现步骤：在 `target/release/bundle/macos` 同时保留当前 `Ember Tavern.app` 和任意陈旧 `.app`，执行 `node scripts/collect-release-evidence.mjs --root target/release/bundle/macos ...`；输出会同时收录两套 bundle。本轮实际得到 6 个文件，而当前候选自身只有 Info.plist、可执行文件和 icon 共 3 个文件。
- 根因：CI 与第一轮复现命令把 bundle 的父目录交给通用递归收集器，没有把证据根绑定到唯一目标 `.app`。
- 文件和调用路径：`.github/workflows/ci.yml` macOS `Hash macOS app bundle` → `scripts/collect-release-evidence.mjs` 递归遍历传入 root。
- 原始证据：`docs/audit/evidence/v0.3-second-audit-bc5fb56/macos-release-files-contaminated.json`（修复前 6 files）；两个 bundle 的路径和哈希均显式记录。
- 修复方案：CI 传入精确 `target/release/bundle/macos/Ember Tavern.app`；回归测试锁定 exact bundle root，避免以后退回父目录。
- 回归测试：更新 `scripts/ci-workflow.test.mjs`，验证 macOS hash step 的 `--root` 精确指向候选 `.app`。
- 关闭证据：待修复后补充。

## V03-SA-002 — 权威资料清单引用不存在的架构文档

- Severity：P3
- Status：OPEN
- 影响范围：Documentation、架构审计可复现性、新审计者导航
- 可复现步骤：在最终 V0.3 HEAD 执行 `test -f docs/ARCHITECTURE.md`，文件不存在；仓库架构事实分散在 `README.md`、`docs/SPEC.md`、`docs/DECISIONS.md` 和各 V0.3 专题文档。
- 根因：V0.3 持续更新了分散架构决定，但没有保留一个稳定的架构索引入口。
- 文件和调用路径：审计资料入口 → 缺失的 `docs/ARCHITECTURE.md`。
- 原始证据：第二轮基线文件清单与 `wc` 的 `No such file or directory`。
- 修复方案：新增只描述当前已实现边界的架构索引，引用现有权威文档，不引入新设计或 V0.4 范围。
- 回归测试：文档链接与 Prettier 门禁；人工核对其与源码依赖方向和 SQLite 唯一事实源一致。
- 关闭证据：待修复后补充。

## 已核实但不构成 finding 的差异

- `0af1833..bc5fb56` 为 68 个提交、599 个文件；第一轮报告的 598 个文件明确限定到 M12-T03，而最终 M12-T04 新增报告文件使最终 HEAD 变为 599。属于可解释的文档-only 后续提交。
- 第一轮 Queue P95 为 3ms；第二轮同一确定性门实测 2ms。该指标是每次运行的观测值，不是固定结果，两次均低于 50ms 门限。
