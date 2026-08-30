# V0.3 Investigation Long Playtest Audit

## 1. Verdict and scope

M11-T03 is **PASS** on source commit `077980887a4b705f6fda214af56f9355d7c15b15`. The fixed 32-action Investigation script completed through the production native bridge against one persistent SQLite save. No product defect was found and there are no open M11-T03 findings.

This result completes only the Investigation long playtest. It does not execute Cyberpunk, the cross-world free-input stress test, a real network model, or the M12 release audit.

## 2. Run identity and evidence

- Run: `m11-t03-investigation-0779808`
- Data origin: `SYNTHETIC_M11`; no formal user save was read or copied
- Provider: deterministic Fake provider through production generation contracts
- Real Provider: `NOT_RUN`; no credential was read and no network model was called
- Scenario: 32 ordered behaviors, `32/32 COMPLETE`
- SQLite: [`campaign.sqlite3`](evidence/v0.3-playability/m11-t03-investigation-0779808/investigation/campaign.sqlite3)
- Portable archive: [`campaign.emtavern`](evidence/v0.3-playability/m11-t03-investigation-0779808/investigation/campaign.emtavern)
- Evidence ledger: [`evidence.json`](evidence/v0.3-playability/m11-t03-investigation-0779808/investigation/evidence.json)
- Machine summary: [`run-summary.json`](evidence/v0.3-playability/m11-t03-investigation-0779808/investigation/run-summary.json)
- Run manifest: [`manifest.json`](evidence/v0.3-playability/m11-t03-investigation-0779808/manifest.json)
- Integrity hashes: [`SHA256SUMS`](evidence/v0.3-playability/m11-t03-investigation-0779808/SHA256SUMS)
- Browser-shell notes and screenshots: [`manual-ui/README.md`](evidence/v0.3-playability/m11-t03-investigation-0779808/manual-ui/README.md)

The evidence directory also contains the immutable Fantasy and Cyberpunk fixture/script inputs created by M11-T01. Fantasy's authoritative completed run remains the separate M11-T02 evidence directory; Cyberpunk remains `NOT_RUN` here.

## 3. Production-path coverage

| Area | Persisted observation |
| --- | --- |
| World and character | 1 locked Constitution, 1 universal character, 3 generated Careers, 2 Traits |
| Investigation extension | 1 `investigation-resilience` definition; composure 62, fortune 48, credit 35, clue load 0 |
| Tavern and knowledge | 1 tavern, 4 NPCs, 4 knowledge rows, and one each FALSE/PARTIAL/TRUE rumor |
| Limited cognition | 4 dialogue messages and 1 committed two-NPC scene turn used bounded NPC generation context |
| Quest and adventure | 2 Quests: 1 completed main investigation and 1 open related investigation; 1 settled archive |
| Failure progression | 8 turns, 7 durable D20 results, 2 failed results; the first check was guaranteed to fail and later turns still committed |
| Rules and resources | 8 append-only Rules events; cash 9 stayed distinct from credit 35; time 660 minutes |
| Equipment | explicit unequip/equip replacement left exactly 1 equipped evidence tool |
| World evolution | 2 locations, 2 travel events, 1 World Director run |
| Generation | 32 generation records and 0 unfinished requests after recovery/import |
| Save and recovery | normal reopen, interrupted-request recovery, overwrite archive import, and continued dialogue retained the same Campaign |
| Database health | `PRAGMA integrity_check = ok`, 0 foreign-key violations, Save Schema 3, World Schema 1 |

The character extension definition and initial values are synthetic fixture inputs inserted through the established SQLite schema and triggers because the legacy character-creation UI has no public extension-value authoring command. The write patches only the profile's `extensions`, `revision`, and `updatedAt` fields with `json_set`; it does not bypass base-attribute immutability. All later gameplay state changes use production native services.

## 4. Findings and acceptance observations

There are no product findings in the final evidence ledger. During test authoring, invalid fixture values were rejected by existing production validators: unsupported location/travel enums, duplicate NPC speech, an owner-sourced roster rumor, an unsupported D20 difficulty, a non-whitelisted tavern-change kind, and an incorrect test-only SQL column. These were corrected in the fixture rather than weakening product validation, and are not reported as product defects.

- Composure, fortune, credit, and clue load survived normal reopen and portable overwrite import without changing the universal character's tested base semantics.
- Cash and credit remained separate: Rules Engine money ended at 9 while extension credit remained 35.
- Rumors retained explicit FALSE/PARTIAL/TRUE truth states and source provenance. Dialogue stated witnessed, rumored, and unknown information separately; no observation showed cross-NPC omniscience.
- A difficulty-17 physique check combined with an active `-5` rain-chill modifier guarantees failure even on a natural 20. That hard result was persisted before narration; seven subsequent turns, the next clue, settlement, and the second Quest remained available.
- Main Quest completion did not mutate the second accepted Quest. After reopen/import, the pool contained exactly one `COMPLETED` and one `ACCEPTED` Quest.
- The fictional 1920s port investigation uses original project terms and general investigative concepts. It does not copy Call of Cthulhu names, characters, text, or rules.

## 5. Performance and UI observations

The production flow took 2578.118 ms wall time, or 80.566 ms amortized over 32 scripted behaviors. This is a harness observation, not Provider billing latency and not a replacement for the M10 performance gate. SQLite size was 1,777,664 bytes and the portable archive was 190,889 bytes.

At 1440×1000, the Vite browser shell rendered boot, Saves, My, and the Quest route guard without console errors. The expected native-unavailable/loading states are recorded because a browser shell cannot invoke Tauri or open the native SQLite store. Visuals remain within the frozen dark-fantasy tavern/manual/HUD system; native save and gameplay correctness comes from the database evidence, not screenshots.

## 6. Reproduction

Run the normal contract test:

```bash
./node_modules/.bin/vitest run packages/test-fixtures/src/investigation-long-playtest-runner.test.ts --reporter=verbose
```

To create a new evidence run, choose a new non-existing run directory and bind it to the current commit:

```bash
source_commit=$(git rev-parse HEAD)
run_dir="$PWD/docs/audit/evidence/v0.3-playability/m11-t03-investigation-${source_commit:0:7}"
EMBER_INVESTIGATION_PLAYTEST_RUN_DIRECTORY="$run_dir" \
EMBER_INVESTIGATION_PLAYTEST_SOURCE_COMMIT="$source_commit" \
./node_modules/.bin/vitest run packages/test-fixtures/src/investigation-long-playtest-runner.test.ts --reporter=verbose
```

Do not overwrite this committed evidence run. A replay is a new run with its own timestamps and hashes.
