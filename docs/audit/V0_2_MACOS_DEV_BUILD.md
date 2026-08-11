# Ember Tavern v0.2 macOS Development Build Record

- Task: `V02-M10-T03`
- Date: 2026-08-11
- Result: **PASS — development/acceptance build only**
- Source HEAD: `20ae2f536c1f70f16878bbfb8699bda6df339775`
- Authoritative CI: [GitHub Actions run 31503183202](https://github.com/qwerxxc7635-crypto/AI-tavern/actions/runs/31503183202)

## App path and hashes

Authoritative runner path:

`/Users/runner/work/AI-tavern/AI-tavern/target/release/bundle/macos/Ember Tavern.app`

Downloaded local evidence path:

`.local/m10-t03/run-31503183202/target/release/bundle/macos/Ember Tavern.app`

An `.app` is a directory, so the executable SHA-256 is the primary build hash. The CI file manifest and the post-download local calculation agree:

| Bundle file | Bytes | SHA-256 |
| --- | ---: | --- |
| `Contents/MacOS/ember-tavern-windows` | 21,614,912 | `d7c5e45776f70fca26a003f36a56bae4651590c644f75ffdd7ec40bf09210dc5` |
| `Contents/Info.plist` | 1,084 | `a4c4cbd709826267d89d117a44bb4d8f2746ab7058d4ac4c77e1c41b32c3ae7f` |
| `Contents/Resources/icon.icns` | 63,344 | `a3352d50b1dccc806fd0d3ef66ee270f14dff2cf85232fcf1cda8f7a128a53da` |

## Environment

- GitHub-hosted `macos-latest` runner
- `RUNNER_OS=macOS`, `platform=darwin`, `architecture=arm64`
- Node.js 24, pnpm 11.9.0, Rust stable
- Build command: `pnpm --dir windows-app tauri build --bundles app`
- Bundle identifier: `com.embertavern.windows`
- Display name/version: `Ember Tavern` / `0.2.0`
- Mach-O: thin arm64 executable
- Minimum macOS version in `Info.plist`: 10.13

## Test result

- App build exited `0` from `2026-08-11T14:57:22.815Z` to `2026-08-11T15:02:47.359Z`.
- Keychain round trip/delete exited `0` and left no test secret.
- The executable links the system WebKit framework; two new WebKit processes were observed after launch.
- The app remained alive for 17 seconds with zero stdout/stderr bytes.
- PlatformPaths returned absolute data/cache/log/temp roots and created the real SQLite database at `~/Library/Application Support/com.embertavern.windows/ember-tavern.sqlite`.
- The macOS platform-path adapter contract passed.
- The ephemeral runner paths created by the test were cleaned only after the lifecycle gate authorized their exact targets.
- Downloaded lifecycle JSON was revalidated with `jq`; all three bundle-file hashes were recalculated locally and match CI.

## Distribution boundary

`codesign` identifies only an ad-hoc linker signature: no TeamIdentifier, trusted Developer ID, notarization or distribution signature is present. This record does not make the `.app` a formal macOS release and does not authorize distribution. It uses no real Provider, paid API, API Key, formal user data or iOS build.

The source commit is the final product-code HEAD used for M9-T05 and M10-T01; the following M10-T01/T02 commits contain only release records and do not alter bundle inputs. The next strict task is `V02-M10-T04` Review Package.
