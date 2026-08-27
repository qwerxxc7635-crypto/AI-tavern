# M11-T02 Browser-shell smoke evidence

- Source commit: `e8f3a3c6d23e79af88935bab914c25893946ea70`
- Viewport: `1366 × 768`
- Runtime: Vite browser shell at `http://127.0.0.1:4173`
- Console: no errors on all three captured routes
- Saves load timing: 504 ms total in this local browser run

The browser shell cannot invoke Tauri or open the native SQLite campaign store. The screenshots therefore verify layout, navigation states, error handling, and absence of browser console errors only. They do not substitute for the native production-path evidence in `../fantasy/evidence.json`, `../fantasy/run-summary.json`, and `../fantasy/campaign.sqlite3`.

- `01-saves.png`: expected native-save unavailable state and portable archive entry.
- `02-my.png`: expected local-session preparation state without a Tauri campaign context.
- `03-quests.png`: expected route guard when a campaign ID is absent; game facts remain unchanged.
