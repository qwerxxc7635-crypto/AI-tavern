# Ember Tavern V0.3 第二轮完整审计修复记录

- Findings 冻结提交：`f763f08`
- 修复提交：`0c56b56f174e07ffcfe01a7d4b52ff741273c88c`
- 原始产品 HEAD：`bc5fb56f5f5058b48511d5d5b8d8888dc68ed0fd`
- 分支：`audit/v0.3-second-full-audit`

本轮在 findings 冻结后处理全部 2 项发现。没有修改 Rules/D20、SQLite schema、存档格式、Provider 业务合同、三世界状态机或视觉规范。

## V03-SA-001 — P2 / FIXED

macOS CI 的 bundle 哈希根从父目录 `target/release/bundle/macos` 收紧为唯一候选 `target/release/bundle/macos/Ember Tavern.app`。这样即使构建目录残留其他 `.app`，候选 artifact identity 也不会吸收陈旧同级产物。

- 修改：`.github/workflows/ci.yml`
- 回归：`scripts/ci-workflow.test.mjs` 明确断言 exact root，6/6 PASS
- 修复前复现：`evidence/v0.3-second-audit-bc5fb56/macos-release-files-contaminated.json` 收录 6 个文件
- 修复后证据：`evidence/v0.3-second-audit-0c56b56/macos-release-files.json` 只收录候选 `.app` 的 3 个文件

## V03-SA-002 — P3 / FIXED

新增 `docs/ARCHITECTURE.md` 作为当前实现的稳定架构入口。它索引既有权威文档，明确 UI/Application/Rules/AI/Persistence/Native Bridge 的依赖边界、SQLite 唯一事实源、AI 输出验证和 Credential 安全边界，不提前设计 V0.4。

- 修改：`docs/ARCHITECTURE.md`
- 验证：人工与源码依赖方向、`docs/SPEC.md`、`docs/DECISIONS.md` 交叉核对；Prettier 与完整共享门 PASS

## 回归结果

- P0：0 found / 0 open
- P1：0 found / 0 open
- P2：1 found / 1 fixed / 0 open
- P3：1 found / 1 fixed / 0 open
- `pnpm check`：PASS
- `pnpm test:windows-e2e`：1/1 PASS
- `pnpm build:desktop`：PASS，281 modules
- 修复后 macOS `.app` 构建与精确根静态哈希：PASS

完整原始证据、manifest 和 SHA-256 位于 `evidence/v0.3-second-audit-0c56b56/`。
