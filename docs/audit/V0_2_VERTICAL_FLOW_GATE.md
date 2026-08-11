# Ember Tavern v0.2 Vertical Flow Gate

- Task: `V02-M9-T05`
- Date: 2026-08-11
- Result: **PASS after fixing ISSUE-005**
- Evidence manifest: [`evidence/v0.2-vertical-flow/SHA256SUMS`](evidence/v0.2-vertical-flow/SHA256SUMS)

## Gate conclusion

The required vertical flow completed on one persistent SQLite campaign:

`首次启动 → 我的/API → 世界 → 车卡 → 酒馆 → NPC → Quest → Adventure → D20 → Settlement → Crash/Recovery → Export → Delete → Import → Continue`

The executable Rust release-flow test proves the state transitions, atomic commits, interruption recovery, export/delete/import round trip, and final continuation against one real SQLite database. The macOS evidence run proves the same product surfaces through the packaged Tauri application and WKWebView. The QA bundle used the isolated identifier `com.embertavern.flowqa`; it did not read or modify the formal Ember Tavern application data.

No real provider, paid API, network generation, API Key, or formal user data was used. English story strings visible in some screenshots are deterministic Fake Provider fixtures; the application chrome and safety messages remain localized.

## Continuous-flow evidence

| Step | Native/UI evidence | Result |
| --- | --- | --- |
| First launch | `macos-ui/01-first-launch.png`; empty database assertions in `windows_e2e` | No campaign and no model profile are fabricated. |
| My/API | `macos-ui/02-my-api.png`, supplemental `macos-ui/03-api-settings.png` | Device model settings are reachable; API Keys remain in the system credential boundary. |
| World | `macos-ui/03-world.png` | Generated world is review-only before explicit confirmation and field locking. |
| Character | `macos-ui/04-character.png` | Candidate preview is not committed until confirmation. |
| Tavern | `macos-ui/05-tavern.png` | Confirmed campaign enters `TAVERN` on the same SQLite save. |
| NPC | `macos-ui/06-npc.png` | Persisted dialogue and relationship projection are visible. |
| Quest | `macos-ui/07-quest.png` | Completed and available quests derive from committed facts. |
| Adventure | `macos-ui/08-adventure.png` | Accepted quest enters the adventure loop. |
| D20 | `macos-ui/09-d20.png` | Local roll, modifier, DC, and outcome are persisted; the model does not decide the roll. |
| Settlement | `macos-ui/10-settlement.png` | Archive summary and seven D20 records are rendered from committed data. |
| Crash/Recovery | `macos-ui/11-crash-recovery.png`, `macos-ui/12-recovered-continue.png` | An interrupted NPC request reopens as `RECOVERY_REQUIRED`; restore cancels the pending request and atomically returns to the last committed `TAVERN` stage. |
| Export | `macos-ui/13-export.png` | Packaged app opens the native `.emtavern` save dialog; Rust flow verifies archive creation. |
| Delete | `macos-ui/14-delete.png`, `macos-ui/14-delete-confirmation-fixed.png` | Isolated campaign delete and post-fix in-app confirmation were exercised; cancel preserves the campaign. |
| Import | `macos-ui/15-import.png` | The archived campaign is imported through the native file picker. |
| Continue | `macos-ui/16-continue.png` | Imported campaign resumes in the tavern with prior committed state. |

## ISSUE-005: irreversible delete confirmation

During the packaged WKWebView run, the original `window.confirm` call did not present a confirmation surface and the isolated QA campaign was deleted immediately. `macos-ui/14-delete.png` is the pre-fix result. The campaign was restored through the application's real import path from its `.emtavern` archive; no formal data was involved.

The fix replaces browser-native confirmation with an explicit, accessible in-card warning and separate `取消删除` / `确认永久删除` controls. Commit `3903c80` implements the product change and commit `1907ce2` adds the regression contract. `macos-ui/14-delete-confirmation-fixed.png` shows the packaged application after the fix. Selecting cancel was then verified to preserve the campaign and collapse the warning; the destructive confirmation was not invoked again.

## Executable recovery and persistence proof

Commit `501da18` extends `windows_e2e::completes_the_windows_release_vertical_slice_on_one_persistent_save` to prove:

- first launch starts without a campaign or model configuration;
- all domain steps use one persistent SQLite campaign;
- an NPC generation request can be interrupted after persistence;
- reopening reports `RECOVERY_REQUIRED` and one pending request;
- recovery restores the most recent fully committed stage and cancels the pending request;
- the recovered campaign continues, exports, deletes, imports, and continues again;
- the test uses only temporary data and the deterministic Fake Provider.

The UI screenshots use stage databases produced from those same domain operations, then open them through the uniquely identified packaged application. This keeps the screenshots repeatable while preserving the distinction between executable state proof and visual/native-shell proof.

## Validation

- `pnpm test:windows-e2e`
- `pnpm lint`
- `pnpm --dir windows-app test -- save-home-page.test.tsx`
- `pnpm --dir windows-app build`
- packaged macOS `.app` launch, native file dialogs, recovery, delete/import/continue, and post-fix cancel verification

All 18 retained screenshots were visually reviewed and are covered by the SHA-256 manifest. M9-T05 is closed; the next strict task is `V02-M10-T01`.
