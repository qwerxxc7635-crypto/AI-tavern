# Ember Tavern V0.3 Release Gates

- Task: M12-T03
- Release candidate: `0.3.0` / development / unreleased
- Source commit: `a77eb03530ab2f90e635a18b513994b1b4dca1af`
- Host: macOS arm64
- Structured evidence: [`evidence/v0.3-release-gates/manifest.json`](evidence/v0.3-release-gates/manifest.json)

## Verdict

All gates applicable to the current host passed. Two destructive platform lifecycle gates are `BLOCKED_EXTERNAL`, not failed and not verified: the Windows NSIS lifecycle requires an ephemeral Windows CI runner, while the macOS launch/Keychain/database/cleanup lifecycle requires an ephemeral macOS CI runner. The local `.app` bundle itself was built and inspected successfully. No artifact was signed, notarized, published, pushed, or merged.

| Gate | Status | Evidence |
| --- | --- | --- |
| Frozen pnpm install | PASS | `frozen-install.json` |
| Formatter, release sync, zh-CN, ESLint, TypeScript, TS/Node/Rust tests, rustfmt, Clippy, interop | PASS | `shared-check.json` |
| Desktop production build | PASS | `desktop-build.json` |
| Windows production vertical slice | PASS | `windows-e2e.json` |
| Windows NSIS/Credential Manager/WebView2/install-launch-uninstall | BLOCKED_EXTERNAL | `windows-release-blocked.json` |
| macOS `.app` release build | PASS | `macos-app-build.json` |
| macOS bundle identity, version and file hashes | PASS | `macos-info-plist.json`, `macos-release-files.json` |
| macOS system WebKit linkage | PASS | `macos-webkit-link.json` |
| macOS Keychain/launch/database/cleanup lifecycle | BLOCKED_EXTERNAL | `macos-lifecycle-blocked.json` |
| npm dependency vulnerabilities | PASS | `pnpm-audit.json` |
| RustSec vulnerabilities | PASS | `cargo-audit.json` |
| Current tree + reachable history secret review | PASS | `secret-review.json`, `secret-scan-tests.json` |
| Performance regression | PASS | `performance-command.json`, `performance/performance-regression.json` |
| Playability report recalculation | PASS | `playability-report.json` |
| Real-provider token budget | NOT_EVALUATED | `performance/performance-regression.json` |
| Real-provider cache-hit ratio | NOT_EVALUATED | `performance/performance-regression.json` |

## Shared quality gate

`pnpm check` passed against the source commit:

- Vitest: 189 files / 1054 tests passed; 2 files / 6 tests skipped by explicit environment contracts.
- Node: 30 tests passed.
- Rust workspace: 150 tests passed; one real-DeepSeek test remained ignored because no explicit credential/network authorization was provided.
- Prettier, release metadata 0.3.0, simplified-Chinese player-copy guard, ESLint, TypeScript, rustfmt, strict workspace/all-target/all-feature Clippy, and TypeScript↔Rust archive interop all passed.
- Desktop build passed with Vite 7.3.6 transforming 281 modules. The explicit Windows production vertical slice passed 1/1.

The test skips and ignored real-provider test are not counted as verified behavior. Their external boundaries remain visible in the manifest.

## Release artifacts

`pnpm --dir windows-app tauri build --bundles app` produced `target/release/bundle/macos/Ember Tavern.app`. Its `Info.plist` reports product `Ember Tavern`, identifier `com.embertavern.windows`, executable `ember-tavern-windows`, and version `0.3.0`. `otool -L` confirms linkage to the system WebKit framework. The bundle evidence records three file-level SHA-256 values for the plist, executable, and icon.

The local host was suitable for compilation and static bundle inspection, but not for destructive lifecycle verification. The macOS gate rejected the non-CI environment before touching user paths; `cleanup.authorized` remained false and no paths were removed. The Windows installer was not cross-built on macOS, and historical V0.2 artifacts were not reused as V0.3 evidence.

## Security and dependencies

- `pnpm audit` reported zero advisories across 314 dependencies.
- RustSec reported zero vulnerabilities. It still reports 16 unmaintained crates and one unsound warning in the Linux-only GTK3/glib graph. This remains the explicit `DEFERRED_ACCEPTED` risk from M12-T02; V0.3 ships Windows/macOS, and any future Linux release must reopen the review.
- The current tracked tree and all reachable Git revisions were scanned by secret-pattern families without emitting matched values. Ten unique files matched; every match was classified as an intentional fake fixture in a test file or Rust `cfg(test)` module. Two secret-scanner suites passed 17/17 tests. Pattern scanning is not a proof against every encoding and did not read OS credential stores or untracked user files.

## Performance and provider boundary

The deterministic performance gate passed with Fake Provider evidence:

- SQLite growth: 541.582 bytes per additional turn from 100 to 1000 turns.
- Unified Context: 377 → 383 estimated tokens; growth ratio 1.016.
- GenerationQueue stress P95: 3 ms.
- All task cold/warm latency and queue checks remained within the frozen regression thresholds.

Provider input-token usage and paid-provider cache-hit ratio remain `NOT_EVALUATED`; null usage was not converted to zero and process-local prefix reuse was not presented as a provider cache hit. No credential was read and no network model was called.

## Traceability

Every command record, static inspection, platform block, security review, and performance result is listed in the manifest. `SHA256SUMS` covers every evidence file except itself and is verified before task completion. This M12-T03 evidence binds the product source to `a77eb03`; the subsequent documentation-only commit records the evidence without changing the built source.
