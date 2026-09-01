# Ember Tavern v0.4.1 Baseline Tests / Branch / CI

状态：M0-T06 PASS

采集日期：2026-09-01（Asia/Shanghai）

基线 source commit：`4e0d12939f6d592663f806afdc794d4c2959b8d7`

正式 v0.3.0 base：`210e699d0aba355b5f00fd4bf6ed777e6977356d`

## 1. Branch baseline

v0.4.1 使用一条可快进的 development lineage 和每 Task 独立 branch/commit：

```text
main / v0.3.0 (210e699)
  -> task/M0-T01-v0-4-1-scope-freeze (751e278)
  -> task/M0-T02-repository-baseline (3639a5d)
  -> task/M0-T03-combat-module-mapping (9506d8c)
  -> task/M0-T04-character-schema-mapping (1fbc5bf)
  -> task/M0-T05-combat-extensibility-contract (4e0d129)
  -> develop/v0.4.1-combat
  -> task/M0-T06-baseline-ci
```

Rules for the continuing lineage:

- each Task starts from the latest accepted task commit and has one or more commits containing only that Task;
- `develop/v0.4.1-combat` advances only to an accepted Task tip;
- no Task commit may include the user's pre-existing `.gitignore` edit;
- no push, PR, merge to `main`, tag, signing, notarization or release is implied by this local branch;
- M12 audits start from the final development tip and do not rewrite prior task evidence.

At collection time, `git status --porcelain=v1` contains only:

```text
 M .gitignore
```

The uncommitted diff SHA-256 is `a719e877b15920df87f99b178ec152099c44f922c2b235ab008babd4641e0987`. It is user-owned baseline noise and must remain excluded. There are no untracked/generated Combat artifacts at baseline.

## 2. Host and toolchain

| Item | Baseline value |
|---|---|
| Host | macOS 14.7.6 (23H626), Darwin 23.6.0, arm64 |
| Node.js | 26.7.0 |
| pnpm | 11.9.0 |
| Rust | rustc/cargo 1.97.1 |
| SQLite CLI | 3.43.2 |
| Git | 2.55.0 |
| repository version | 0.3.0 |
| pnpm lock SHA-256 | `c5b7422541177b7b2ab7632d4038d21b478c4a807da85633ce324203c4cec6f6` |
| CI workflow SHA-256 | `e344d2b23ef349df77f24843887baf836cbe6bf3ccbbda476e9906592f9df1a6` |

Tool versions are evidence, not a new minimum-version contract. Frozen install and CI continue to use repository declarations/lockfiles.

## 3. Database and save baseline

| Item | Baseline |
|---|---|
| migration files | 32 |
| latest migration | `0032_save_schema.sql` |
| current migrated database schema | 32 |
| portable save schema | 3 |
| world schema | 1 |
| Combat durable tables | none |
| Combat Active Save/BattleRecord | none |

M1-M9 must not pretend durable Combat persistence exists. M10 owns migration 33+ and TypeScript/Rust portable archive changes. A future migration or archive failure is a Combat-introduced failure unless it reproduces on this exact baseline.

## 4. Full local baseline result

Command executed from repository root:

```text
pnpm check
```

Result: **PASS**, exit code 0.

| Gate | Result | Counts / evidence |
|---|---|---|
| Prettier | PASS | all matched files formatted |
| release metadata | PASS | synchronized at 0.3.0 |
| zh-CN player language gate | PASS | no player-facing English regression |
| ESLint | PASS | max warnings 0 |
| TypeScript | PASS | `tsc --noEmit` |
| Vitest main suite | PASS | 189 files / 1091 tests passed; 2 files / 6 tests skipped |
| Node test runner | PASS | 33 passed; 0 failed/skipped |
| Rust `ember-native-bridge` | PASS | 101 passed |
| Rust `ember-platform-services` | PASS | 5 passed |
| Rust provider | PASS | 19 passed |
| Rust secure HTTP | PASS | 12 passed |
| Rust secure secrets | PASS | 3 passed |
| Rust Tauri library | PASS | 13 passed; 1 ignored |
| Rust aggregate | PASS | 153 passed; 0 failed; 1 ignored |
| archive interop | PASS | TS fixture gates 14/14 in both directions; native interop 1/1 |

The one ignored Rust test is `real_deepseek_runtime_verifies_selection_cache_and_reopen`; it requires an explicitly authorized DeepSeek credential in an environment variable. It is an existing external-credential gate, not a product failure and not permission to read or expose a real API key.

The six Vitest skips are pre-existing explicit environment/contract skips. Baseline contains **zero known failing tests**.

## 5. CI and platform status

Static inspection of `.github/workflows/ci.yml` confirms:

- shared quality matrix targets `windows-latest` and `macos-latest`;
- Windows release job builds NSIS and runs the ephemeral install lifecycle gate;
- macOS build job builds the `.app` and runs the app lifecycle gate;
- evidence collection/upload steps exist for both platforms;
- workflow behavior and pinning are covered by the 33 passing Node/script tests.

| Environment/gate | M0-T06 status | Reason |
|---|---|---|
| local macOS shared `pnpm check` | PASS | actually executed on this commit |
| GitHub Windows shared quality | NOT_RUN | no remote CI run was triggered for this local branch |
| GitHub macOS shared quality | NOT_RUN | no remote CI run was triggered for this local branch |
| Windows NSIS/install/WebView2/Credential Manager | NOT_RUN | cannot be proven on this macOS host |
| macOS packaged app/Keychain/WKWebView lifecycle | NOT_RUN | packaging lifecycle is not required by M0 baseline and was not run |
| real Provider network/token/cache/latency | NOT_EVALUATED | external credential/network not needed for deterministic baseline |

`NOT_RUN`/`NOT_EVALUATED` are not PASS. Later gates must attach their own run URL/artifact/evidence; this document cannot be reused as proof that future Combat code passes a platform gate.

## 6. Failure attribution policy

From M1 onward, a check is classified as follows:

1. Reproduce on `4e0d129` with the same supported toolchain and command.
2. If it reproduces, record `BASELINE/ENVIRONMENT` with the exact evidence; do not weaken or delete the check.
3. If it does not reproduce, classify it as `COMBAT_REGRESSION` (or an unrelated new change regression if proven by path/bisect).
4. Existing explicit six Vitest skips and one credential-only Rust ignore remain baseline exclusions; increasing skip/ignore counts requires a finding and approval through the owning task gate.
5. Remote platform absence is `NOT_RUN`, never an existing failure and never proof of compatibility.
6. Flaky or intermittent behavior remains a failure to investigate; rerunning until green does not change classification.

Every later Task records command, commit, platform, exit result, pass/fail/skip counts and any deviation from this baseline.

## 7. M0-T06 acceptance

- v0.4.1 development and Task branch lineage exists and is recorded.
- HEAD, toolchain, lock/workflow hashes, working tree, database/save versions and platform are recorded.
- Full local baseline is green with exact suite counts and explicit skips/ignore.
- Existing exclusions and future Combat regressions have an unambiguous classification rule.
- CI topology is inspected while unexecuted remote/platform gates remain honestly `NOT_RUN`.

M0-T06 therefore passes. This is baseline evidence only; it does not approve release or begin Combat implementation.
