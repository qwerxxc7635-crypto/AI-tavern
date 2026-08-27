# M11-T04 browser-shell smoke evidence

- Source commit: `d42bae2f4e8c111a293420afbd4412d83f501eb9`
- Viewport: 1440×1000
- Runtime: Vite browser shell at `http://127.0.0.1:4173/`
- Console: no errors after loading Saves, My, or Quest route guard
- Expected limitation: the browser shell cannot invoke Tauri or open the native SQLite save, so native-unavailable, loading, and missing-Campaign states are expected safety states.

Screenshots:

- `01-saves.png`: local-save home and portable archive import safety state
- `02-my.png`: shared desktop shell and local loading state
- `03-quests.png`: missing-Campaign route guard

These screenshots prove only browser-shell rendering and safe routing. The production native flow, persistence, recovery, and archive claims are proven by the sibling SQLite, archive, evidence ledger, and run summary.
