# Ember Tavern v0.2 Artifact Hash / Manifest Record

- Task: `V02-M10-T02`
- Date: 2026-08-11
- Result: **PASS**
- Release directory: `release/v0.2/` (Git-ignored local release output)

## Required files

| File | Format | Purpose | SHA-256 |
| --- | --- | --- | --- |
| `SHA256SUMS` | sha256sum | Installer integrity check | `9b39003b2569b8f342468de6fd77d4b3a59aa2ab0aca6c41fb0bd42d2a464c37` |
| `ARTIFACT_MANIFEST` | JSON | Artifact name, size, hash, platform, architecture, source and signing state | `7423ad47a6d8c9c57da351c8b60695dbbc1056eb0542586c5fd54d4adfe1d661` |
| `BUILD_INFO` | JSON | Exact source, CI run/job, toolchain, command, timestamps and gate outcome | `e6a2fd9a033eee5c594d68f90183cb8b004ed85b2a828f96db81938683e97eb8` |
| `RELEASE_NOTES` | Markdown | Player-facing v0.2 scope, validation, privacy and install/data summary | `cff6b814bd63bbfc949e44e66824e71f0d750f447f7fb42f4912f6752df0129b` |
| `KNOWN_LIMITATIONS` | Markdown | Signing, runtime, provider, platform, update, data and diagnostics limitations | `256130d0960c23f1074bcfcb89aa81fcec02c8ea8ca3ce0e11a6cbb35e0ee593` |

The five files use the exact basenames required by the authoritative task list. `SHA256SUMS` covers only the immutable installer so it does not become self-referential. `ARTIFACT_MANIFEST` and `BUILD_INFO` bind the metadata to source commit `20ae2f536c1f70f16878bbfb8699bda6df339775`, CI run `31503183202`, Windows release job `93822023706`, and the unsigned internal-candidate boundary.

## Validation

- `shasum -a 256 -c SHA256SUMS` returned `OK` for `Ember Tavern_0.2.0_x64-setup.exe`.
- Installer size `5,220,387` and SHA-256 `1674ffa788316c196ed11147090d281ec68e2ee4b4865a7319c4efe53dde10ca` match both JSON metadata files and the downloaded CI evidence.
- `jq` validated both JSON documents, the exact source commit/run, successful build, application-data retention and unsigned state.
- The release root contains exactly the installer plus the five required files; structured CI evidence remains in the `evidence/` subdirectory.
- A secret-like token scan over the five files found no API Key, bearer token or secret value.

This task does not sign, publish or upload the local release directory. The next strict task is `V02-M10-T03` macOS Dev Build Record.
