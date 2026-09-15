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
| macOS arm64 | Darwin 23.6.0; rustc 1.97.1; Node 26.7.0; pnpm 11.9.0 | `docs/audit/evidence/v0.4.1/M11-T08-08a4810/`; source `08a481059f636ac0e877cb0918051ce9cba8693a`; both exact tests exit 0 | PASS |
| Windows | No Windows execution environment or current CI run was available for this task branch | None | NOT_RUN/BLOCKED |

## Gate status

M11-T08 is **BLOCKED** and its release DoD is not satisfied. The branch must be executed by an actual Windows runner and its uploaded receipt must show exit code 0 against the same source tree. A user-authorized push/CI run, or an independently supplied Windows receipt for the task branch, can close the gate. Until then this task must not be marked complete or merged into `develop/v0.4.1-combat`, and strict task-order execution stops before M11-T09.
