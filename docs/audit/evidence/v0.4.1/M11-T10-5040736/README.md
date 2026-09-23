# M11-T10 Four-World Production Playtest Evidence

- Source commit: `504073649e6d286830e659a7497c9f0d65a09d66`
- Platform: macOS arm64, Darwin 23.6.0
- Test database: isolated `e2e-data-root` database; no normal user database was opened
- Result: **PASS**

Four route-specific release `.app` shells were compiled from the same source commit. The only shell override was the initial `/combat` URL and a unique bundle identifier; production React chunks, Tauri commands, Native Bridge, Combat Core, Presentation and SQLite code were unchanged.

Each world was operated through the actual macOS application accessibility tree. The run triggered the Ask Reaction, selected the world ability and enemy target, inspected the expanded combat log, stopped the process after the first attack, reopened the same `.app`, compared the exact SQLite checkpoint revision/hash, completed the second attack, observed the Victory result, and used a production return button. SQLite was then queried to verify the deterministic result marker, `COMBAT_FINISHED` ledger fact and active-checkpoint cleanup.

The seeded campaign intentionally contained only the minimal valid campaign row. Consequently, the post-return Adventure/Tavern page displayed its existing fail-closed missing-domain-data state. This did not affect the return navigation or Combat result transaction and was not recorded as a combat-flow pass for unrelated Adventure/Tavern content.

See `four-world-playtest-receipt.json` for the exact UI observations, checkpoint hashes and committed result identities. See `manifest.json` for environment, build and final Gate A-G command results.
