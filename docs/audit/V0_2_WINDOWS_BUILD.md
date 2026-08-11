# Ember Tavern v0.2 Windows Build Record

- Task: `V02-M10-T01`
- Date: 2026-08-11
- Result: **PASS**
- Source HEAD: `20ae2f536c1f70f16878bbfb8699bda6df339775`
- Authoritative CI: [GitHub Actions run 31503183202](https://github.com/qwerxxc7635-crypto/AI-tavern/actions/runs/31503183202)

## Output

The authoritative Windows x64 runner produced the current-user NSIS installer and the artifact was downloaded to the Git-ignored local release directory:

`release/v0.2/Ember Tavern_0.2.0_x64-setup.exe`

| Property | Value |
| --- | --- |
| Version | `0.2.0` |
| Platform | `win32` |
| Architecture | `x64` |
| Bytes | `5,220,387` |
| SHA-256 | `1674ffa788316c196ed11147090d281ec68e2ee4b4865a7319c4efe53dde10ca` |
| Signature | Unsigned internal release candidate |

The local release directory also retains the downloaded structured evidence under `release/v0.2/evidence/`. The installer hash and size match all three sources: `windows-release-files.json`, `windows-install-lifecycle.json`, and a fresh local SHA-256 calculation after download.

## Gate results

- Windows/macOS shared quality jobs passed for the exact source HEAD.
- Windows single-SQLite vertical flow evidence exited `0`.
- NSIS build exited `0`.
- Windows Credential Manager round trip exited `0` and left no test secret.
- WebView2 runtime `150.0.4078.105` was detected and a new WebView2 process was observed.
- Current-user silent install exited `0`; installed product version was `0.2.0`.
- The installed application remained alive for 11 seconds.
- Silent uninstall exited `0`, removed registration and the install directory, and preserved the application-data sentinel.
- CI collected the release-file hash and uploaded the complete Windows evidence artifact.

This task only establishes the Windows v0.2 build output. `SHA256SUMS`, `ARTIFACT_MANIFEST`, `BUILD_INFO`, `RELEASE_NOTES`, and `KNOWN_LIMITATIONS` remain the next strict task, `V02-M10-T02`.
