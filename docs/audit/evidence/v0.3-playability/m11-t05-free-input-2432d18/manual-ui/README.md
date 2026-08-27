# M11-T05 browser-shell smoke evidence

- Source commit: `2432d18e90b05d335c678dfc0c8d3b7202cb631c`
- Viewport: 1440×1000
- Runtime: Vite browser shell at `http://127.0.0.1:4173/`
- Routes: Hash Router URLs `/#/saves`, `/#/my`, and `/#/quests`
- Console: no errors after each final route load
- Expected limitation: the browser shell cannot invoke Tauri or open the native SQLite saves, so native-unavailable, loading, and missing-Campaign states are expected safety states.

Screenshots:

- `01-saves.png`: local-save home and portable archive import safety state
- `02-my.png`: shared desktop shell and local loading state
- `03-quests.png`: missing-Campaign route guard

All three final screenshots were opened and inspected at their original resolution. An initial direct-path capture used non-hash URLs and did not switch routes reliably; those captures were replaced before hashing. This is a test-navigation correction, not a product finding.

These screenshots prove only browser-shell rendering and safe routing. The production free-input consequences, persistence, recovery, and archive claims are proven by the sibling SQLite databases, archives, evidence ledger, and run summary.
