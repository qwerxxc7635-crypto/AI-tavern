# M11-T08 Cross-Platform Determinism Evidence

## Gate contract

This gate runs the same committed fixtures on macOS and Windows. A platform passes only when `pnpm test:combat-determinism` exits successfully on that platform; configuring a runner is not execution evidence. Missing platform evidence is `NOT_RUN/BLOCKED`, never `PASS`.

The `quality` matrix in `.github/workflows/ci.yml` runs the gate on `macos-latest` and `windows-latest` and uploads one `combat-determinism-${{ runner.os }}.json` command receipt per platform. The pinned Rust tests reject any mismatch against these values:

| Contract | Golden value |
| --- | --- |
| roll | `utility-attack-roll`, `resolution`, d20=`8`, cursor=`1` |
| scheduler event | chain=`replay-chain`, sequence=`1`, depth=`1`, source=`companion`, effect=`utility-effect-a` |
| events digest | `a5a67467868ee57528ddba0f05be597879459ed869e33d4aeb33479fb7a3e818` |
| replay trace digest | `5edca44ce0b56d98d2575632f445287c28fceadfa04a7de14aec2ce207ff6031` |
| final state hash | `21aaf52c175ccd4b2ec412c1e26937ecd2320c2e5aa66809a21f0f7d97387656` |
| result | `ABORTED` |
| fixed-point fixture SHA-256 | `5eab48395bfb2c96ce7c5040b5f285472bdd80bf95a1d3657f49f56098823ca8` |

The fixed-point fixture covers scale `1_000_000`, multiply-floor, scalar multiply-floor, ratio-floor, ceil division, percent-floor, restore-at-least-one, HARD_CC single-ceil, and damage-floor exact outputs. Its authoritative values remain in `crates/combat-core/test-fixtures/combat-numeric-v1.json`.

## Execution evidence

| Platform | Environment | Evidence | Status |
| --- | --- | --- | --- |
| macOS | GitHub-hosted `macos-latest` | CI run `34937746643`, job `104279266194`; artifact `ember-tavern-combat-determinism-macOS`, SHA-256 `00616ab4abf51c2a7bbff3bb5d7a11274b7b17f00005c24b78311efdfccdab67`, exit 0 | PASS |
| Windows | GitHub-hosted `windows-latest` | CI run `34937746643`, job `104279265927`; artifact `ember-tavern-combat-determinism-Windows`, SHA-256 `60e0181304272ef682b158c4b9bf7633b4949b4ecffde001735f9e8fce1fdfbc`, exit 0 | PASS |

## Gate status

M11-T08 is **PASS**. Both platform jobs ran source commit `a5d5e4c4aac44396725e51a7104dcf28db6996a5`, asserted the same committed roll/event/hash/result/fixed-point golden values, exited 0, and uploaded independently hashed receipts. Durable evidence is recorded in `docs/audit/evidence/v0.4.1/M11-T08-a5d5e4c/`. This supersedes, but does not delete, the earlier `NOT_RUN/BLOCKED` evidence.
