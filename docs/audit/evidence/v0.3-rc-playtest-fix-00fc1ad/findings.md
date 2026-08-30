# V0.3 RC Playtest Findings — Frozen Before Remediation

- Evidence source: user-supplied `12.docx`
- Baseline branch: `audit/v0.3-second-full-audit`
- Baseline HEAD: `00fc1adb2d3ffc9c290d52a108b122e080c074f6`
- Product source ancestor: `0c56b56f174e07ffcfe01a7d4b52ff741273c88c`
- Fix branch: `fix/v0.3-rc-playtest-issues`
- Frozen date: 2026-08-29

## RC-PLAYTEST-001 — World generation reports `TIMEOUT`

- Severity: P1 / release-candidate blocker
- Status at freeze: OPEN
- User-visible evidence: `source/image1.png`
- Observed UI: the authoritative world-construction page reports “模型响应超时”, error code `TIMEOUT`, and promises that local progress did not change.
- Required investigation boundary: UI → Application → GenerationQueue → Provider → HTTP transport → schema/business validation → SQLite transaction.
- Safety invariant: remediation must not turn timeout into an unbounded wait, collapse unrelated Provider errors into `TIMEOUT`, or allow partial/duplicate persistence.

## RC-PLAYTEST-002 — New campaign does not directly enter world construction

- Severity: P1 / release-candidate blocker
- Status at freeze: OPEN
- User-visible evidence: `source/image2.png`, `source/image3.png`
- Observed UI: the saves page shows eight records labelled “构筑世界”, while the expected destination is the authoritative “第 01 步 · 世界构筑” page.
- Required investigation boundary: new-save click handler, duplicate-click protection, Campaign ID allocation, SQLite creation order, Hash Router navigation, refresh/back/resume semantics, and save-list eligibility.
- Safety invariant: do not delete or mutate user data unless a record is proven to be an empty invalid draft; remediation tests must use isolated SQLite.

## RC-PLAYTEST-003 — Real Provider output reports `INVALID_OUTPUT`

- Severity: P1 / release-candidate blocker
- Status at freeze: OPEN
- User-visible evidence: `source/image4-invalid-output.png`
- Observed UI: the authoritative world-construction page reports “模型输出没有通过验证”, error code `INVALID_OUTPUT`, and incorrectly reuses locked-hard-result copy from a later adventure stage.
- Required investigation boundary: Provider raw response → fence/prose normalization → JSON parse → repair → TypeScript/Rust schema → business validation → SQLite transaction.
- Safety invariant: deterministic normalization only; multiple objects, truncation, missing/type/enum/ID errors and business-rule violations remain fail closed. Fake Provider evidence cannot satisfy real Provider validation.

## Evidence interpretation boundary

The screenshots prove the displayed failure and the presence of multiple creation-stage records. They do not by themselves prove whether every record is an invalid ghost draft or which internal timeout layer fired. Root-cause conclusions remain OPEN until reproduced against source and isolated tests.

The fourth screenshot proves the `INVALID_OUTPUT` presentation, but the safety contract does not persist failed raw output. It therefore cannot prove the original response bytes or exact validation field. Remediation evidence must preserve that uncertainty and record any later real-provider block separately.
