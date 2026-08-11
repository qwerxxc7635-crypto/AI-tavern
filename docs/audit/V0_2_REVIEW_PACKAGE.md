# Ember Tavern v0.2 ChatGPT Review Package Record

- Task: `V02-M10-T04`
- Date: 2026-08-11
- Result: **PASS**
- Package: `review_v0.2_to_chatgpt_20260811_2319.zip`

## Package layout

The review package is assembled from a clean committed snapshot and contains:

| Required category | Package path | Content |
| --- | --- | --- |
| Competitor research | `competitor-research/` | Three repository analyses, baseline pinning, matrix, Gap Analysis, borrow plan and rejected ideas |
| Architecture docs | `architecture/` | Architecture Gate, target architecture, AI pipeline, Context/Memory and state/event contracts |
| Final tasks | `final-tasks/` | Authoritative `TASKS_V0.2.md` with M0–M10 completion state |
| Audit fixes | `audit-fixes/` | Round-one findings/fixes, v0.1 second-round closure, shared/platform/UI/vertical/release audit records |
| Tests | `tests/` | Tracked test-file inventory, current local/CI result summary and structured platform evidence JSON |
| Screenshots | `screenshots/` | 52 four-resolution/fix screenshots plus 18 native vertical-flow screenshots and their manifests |
| Git data | `git/` | Exact HEAD, branch/status, chronological commit log, refs/remotes and HEAD summary |
| Source archive | `source/` | `git archive` ZIP of the exact committed review-package HEAD |
| Installer | `installer/` | Windows x64 NSIS 0.2.0 installer and the five M10-T02 release metadata files |
| Hashes | `hashes/` | SHA-256 manifest for every packaged file except the manifest itself |
| Risks | `risks/` | Known limitations, architecture risk/deferred scope and distribution boundaries |

`00_REVIEW_GUIDE.md` at the package root maps the requested review order and the evidence boundaries.

## Exclusions and safety

The package deliberately excludes `.git/` object storage, `.local/`, third-party clone working trees, `node_modules/`, `target/`, build caches, application databases, backups, system credentials, `.env` files, real user data and real API Keys. Git metadata is exported as text only. The source archive is produced by `git archive`, so ignored and uncommitted files cannot enter it.

The pre-existing uncommitted `.gitignore` addition for `.gstack/` is preserved outside the committed snapshot and excluded from the package. No user-owned uncommitted content is staged or copied.

## Integrity and review boundary

- The Windows installer retains the M10-T02 SHA-256 `1674ffa788316c196ed11147090d281ec68e2ee4b4865a7319c4efe53dde10ca`.
- Screenshot manifests are verified before packaging.
- JSON evidence and metadata are parsed before packaging.
- The final package content manifest is verified after ZIP creation by extracting into a new temporary directory and recalculating every listed SHA-256.
- A final Windows-only CI flake was traced to the 80-turn SQLite settlement integration case taking 33.6 seconds under full-suite contention versus the 30-second global timeout. The test retains all operations and assertions and receives a 60-second Windows-only integration allowance; macOS keeps the 5-second limit. The final package is regenerated from the corrected committed HEAD.
- The package describes an unsigned Windows internal release candidate and a non-distributable macOS development build; it is not a public release authorization.

The default-deferred scope remains iOS, plugin marketplace, full MultiChat, full World Voices, AI Companion, online multiplayer, full VTT map engine, official macOS release and store distribution.
