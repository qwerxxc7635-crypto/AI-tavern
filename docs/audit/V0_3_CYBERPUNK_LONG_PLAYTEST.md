# V0.3 Cyberpunk Long Playtest Audit

## 1. Verdict and scope

M11-T04 is **PASS** on source commit `d42bae2f4e8c111a293420afbd4412d83f501eb9`. The fixed 32-action Cyberpunk script completed through the production native bridge against one persistent SQLite save. No product defect was found and there are no open M11-T04 findings.

This result completes the third and final fixed-world long playtest. It does not execute the cross-world free-input stress test, a real network model, M11-T06 reporting, or the M12 release audit.

## 2. Run identity and evidence

- Run: `m11-t04-cyberpunk-d42bae2`
- Data origin: `SYNTHETIC_M11`; no formal user save was read or copied
- Provider: deterministic Fake provider through production generation contracts
- Real Provider: `NOT_RUN`; no credential was read and no network model was called
- Scenario: 32 ordered behaviors, `32/32 COMPLETE`
- SQLite: [`campaign.sqlite3`](evidence/v0.3-playability/m11-t04-cyberpunk-d42bae2/cyberpunk/campaign.sqlite3)
- Portable archive: [`campaign.emtavern`](evidence/v0.3-playability/m11-t04-cyberpunk-d42bae2/cyberpunk/campaign.emtavern)
- Evidence ledger: [`evidence.json`](evidence/v0.3-playability/m11-t04-cyberpunk-d42bae2/cyberpunk/evidence.json)
- Machine summary: [`run-summary.json`](evidence/v0.3-playability/m11-t04-cyberpunk-d42bae2/cyberpunk/run-summary.json)
- Run manifest: [`manifest.json`](evidence/v0.3-playability/m11-t04-cyberpunk-d42bae2/manifest.json)
- Integrity hashes: [`SHA256SUMS`](evidence/v0.3-playability/m11-t04-cyberpunk-d42bae2/SHA256SUMS)
- Browser-shell notes and screenshots: [`manual-ui/README.md`](evidence/v0.3-playability/m11-t04-cyberpunk-d42bae2/manual-ui/README.md)

The evidence directory also contains the immutable Fantasy and Investigation fixture/script inputs created by M11-T01. Their authoritative completed runs remain in the separate M11-T02 and M11-T03 evidence directories.

## 3. Production-path coverage

| Area | Persisted observation |
| --- | --- |
| World and character | 1 locked no-magic Constitution, 1 universal character, 3 generated Careers, 2 Traits |
| Cyberpunk extension | 1 `cyberpunk-augmentation` definition; neural load 2, street reputation 8, trace heat 0, 1 implant slot, community access |
| Tavern and knowledge | 1 relay tavern, 4 NPCs, 4 knowledge rows, and one each FALSE/PARTIAL/TRUE rumor |
| Limited cognition | 4 dialogue messages and 1 committed two-NPC scene turn used permission-bounded NPC context |
| Quest and adventure | 2 Quests: 1 completed offline-key delivery and 1 open lost-node investigation; 1 settled archive |
| Failure progression | 8 turns, 7 durable D20 results, 2 failed results; the guaranteed first failure did not block later turns |
| Rules and resources | 8 append-only Rules events; credits 15; game time 525 minutes |
| Equipment and reward | explicit unequip/equip replacement left exactly 1 equipped tool; 1 semantic CLUE reward with price 0 |
| Dynamic world | 2 locations, 2 travel events, 2 active factions, 1 faction action, 1 persisted consequence fact, 1 Director run |
| Generation | 33 generation records and 0 unfinished requests after recovery/import |
| Save and recovery | normal reopen, interrupted-request recovery, overwrite archive import, and continued dialogue retained the same Campaign |
| Database health | `PRAGMA integrity_check = ok`, 0 foreign-key violations, Save Schema 3, World Schema 1 |

The character extension definition and initial values are synthetic fixture inputs inserted through the established SQLite schema and triggers because the legacy character-creation UI has no public extension-value authoring command. The patch only changes the profile's `extensions`, `revision`, and `updatedAt`; it does not bypass base-attribute immutability. All subsequent gameplay and faction state changes use production native services.

## 4. Findings and acceptance observations

There are no product findings in the final evidence ledger. The scenario is not a Fantasy reskin: it uses a no-supernatural-magic Constitution, neural interfaces, corporate/community/civic factions, offline network permissions, credit quotas, reputation and debt. It uses original project terms and does not depend on a commercial Cyberpunk setting.

- Neural load, reputation, trace heat, implant slots, and network access survived normal reopen and portable overwrite import.
- Two factions were activated through the production generation and validation path. One action expanded the community network into the newly generated node, set a friendly player relation, and wrote an auditable world fact; all remained present after import.
- Rules Engine credits ended at 15, one explicit equipment replacement remained equipped, and one semantic CLUE reward had price 0. No reward, trait, implant, or equipment path introduced numeric inflation.
- A difficulty-17 physique check combined with an active `-5` neural-echo modifier guarantees failure even on a natural 20. The D20 hard result was persisted before narration, and later turns, the key delivery, settlement, and the second Quest remained available.
- Main Quest completion did not mutate the second accepted Quest. After reopen/import, the pool contained exactly one `COMPLETED` and one `ACCEPTED` Quest.
- NPC dialogue and rumors retained permission-bounded knowledge and explicit truth provenance; faction evolution did not grant NPC omniscience.

## 5. Performance and UI observations

The production flow took 2938.837 ms wall time, or 91.839 ms amortized over 32 scripted behaviors. This is a harness observation, not Provider billing latency and not a replacement for the M10 performance gate. SQLite size was 1,806,336 bytes and the portable archive was 211,913 bytes.

At 1440×1000, the Vite browser shell rendered Saves, My, and the Quest route guard without console errors. The expected native-unavailable/loading states are recorded because a browser shell cannot invoke Tauri or open the native SQLite store. Visuals remain within the frozen tavern/manual/HUD system; native save and gameplay correctness comes from the database evidence, not screenshots.

## 6. Reproduction

Run the normal contract test:

```bash
./node_modules/.bin/vitest run packages/test-fixtures/src/cyberpunk-long-playtest-runner.test.ts --reporter=verbose
```

To create a new evidence run, choose a new non-existing run directory and bind it to the current commit:

```bash
source_commit=$(git rev-parse HEAD)
run_dir="$PWD/docs/audit/evidence/v0.3-playability/m11-t04-cyberpunk-${source_commit:0:7}"
EMBER_CYBERPUNK_PLAYTEST_RUN_DIRECTORY="$run_dir" \
EMBER_CYBERPUNK_PLAYTEST_SOURCE_COMMIT="$source_commit" \
./node_modules/.bin/vitest run packages/test-fixtures/src/cyberpunk-long-playtest-runner.test.ts --reporter=verbose
```

Do not overwrite this committed evidence run. A replay is a new run with its own timestamps and hashes.
