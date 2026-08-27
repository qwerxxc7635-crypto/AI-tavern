# V0.3 Fantasy Long Playtest Audit

## 1. Verdict and scope

M11-T02 is **PASS** on source commit `e8f3a3c6d23e79af88935bab914c25893946ea70`. The fixed 32-action Fantasy script completed through the production native bridge against one persistent SQLite save. One P1 product defect was found, fixed, and covered by the same-save regression. There are no open M11-T02 findings.

This result completes only the Fantasy long playtest. It does not execute Investigation, Cyberpunk, free-input stress, a real network model, or the M12 release audit.

## 2. Run identity and evidence

- Run: `m11-t02-fantasy-e8f3a3c`
- Data origin: `SYNTHETIC_M11`; no formal user save was read or copied
- Provider: deterministic Fake provider through the production generation contracts
- Real Provider: `NOT_RUN`; no credential was read and no network model was called
- Scenario: 32 ordered behaviors, `32/32 COMPLETE`
- SQLite: [`campaign.sqlite3`](evidence/v0.3-playability/m11-t02-fantasy-e8f3a3c/fantasy/campaign.sqlite3)
- Portable archive: [`campaign.emtavern`](evidence/v0.3-playability/m11-t02-fantasy-e8f3a3c/fantasy/campaign.emtavern)
- Evidence ledger: [`evidence.json`](evidence/v0.3-playability/m11-t02-fantasy-e8f3a3c/fantasy/evidence.json)
- Machine summary: [`run-summary.json`](evidence/v0.3-playability/m11-t02-fantasy-e8f3a3c/fantasy/run-summary.json)
- Run manifest: [`manifest.json`](evidence/v0.3-playability/m11-t02-fantasy-e8f3a3c/manifest.json)
- Integrity hashes: [`SHA256SUMS`](evidence/v0.3-playability/m11-t02-fantasy-e8f3a3c/SHA256SUMS)
- Browser-shell notes and screenshots: [`manual-ui/README.md`](evidence/v0.3-playability/m11-t02-fantasy-e8f3a3c/manual-ui/README.md)

The evidence directory also contains the immutable Investigation and Cyberpunk fixture/script inputs created by M11-T01. Their evidence remains `NOT_RUN`; their presence does not claim those tasks were executed.

## 3. Production-path coverage

| Area | Persisted observation |
| --- | --- |
| World and character | 1 locked Constitution, 1 universal character, 3 generated Careers, 2 Traits |
| Tavern and knowledge | 1 tavern, 4 NPCs, 3 rumors, 6 messages, 4 NPC knowledge rows |
| Multi-NPC | 1 active tavern scene and 1 committed two-NPC scene turn after population projection/focus |
| Quest and adventure | 2 Quests: 1 completed main Quest and 1 open branch Quest; 1 settled adventure archive |
| D20 and Rules | 8 adventure turns, 7 durable D20 rolls, 7 Rules Engine events |
| Equipment and economy | final equipped count 1, money 12, game time 765 minutes |
| World evolution | 2 locations, 2 travel events, 1 World Director run |
| Generation and context | 33 generation records, 0 unfinished requests, maximum recorded context 48 bytes |
| Save and recovery | normal reopen, failure recovery, overwrite archive import, and dialogue continuation all used the same Campaign |
| Database health | `PRAGMA integrity_check = ok`, 0 foreign-key violations, Save Schema 3, World Schema 1 |

The script includes free-form intents and actual state transitions; it is not limited to clicking generated candidates. The portable archive round trip uses the production overwrite import path so foreign-key and domain reload checks remain active.

## 4. Finding and fix

### M11-FAN-001 — P1 — FIXED

Starting the first production multi-NPC scene failed with SQLite `no such column: population_role`. `tavern_scene.rs` queried `npc_lod_profiles.population_role`, but the schema stores that projection in `profile_json.$.populationRole`.

The query now reads the JSON field used by the established NPC LOD contract. The regression projects the tavern population, focuses two NPC participants, starts the scene, prepares actor generations, and commits one durable scene turn on the same save. The final database contains one scene and one scene turn, so the fix is exercised rather than inferred.

No schema, Rules Engine, D20 hard-result, Provider, Queue, Quest, NPC, Adventure, or save-format contract changed.

## 5. Consistency, knowledge, and performance observations

- The final state retained one locked Constitution and the expected Save/World schema versions across reopen, recovery, and archive restore.
- NPC knowledge remained bounded to four durable rows while dialogue and the multi-NPC scene continued; no observation showed cross-NPC omniscience or personality/world-rule drift.
- Main Quest settlement and branch Quest state remained mutually consistent after D20, equipment, money, time, travel, Director, reopen, and archive operations.
- The core production flow took 2298.712 ms wall time. Dividing by the fixed 32-action script gives 71.835 ms per action. This is an amortized harness observation, not Provider billing latency and not a substitute for M10's performance regression gate.
- SQLite size was 1,765,376 bytes and the archive was 176,168 bytes. No unfinished request, integrity failure, or foreign-key violation remained.

## 6. Manual UI smoke

At 1366×768, the Vite browser shell rendered Saves, My, and the Quest route guard without console errors. The visuals remain consistent with the frozen dark-fantasy HUD system. Because a browser shell cannot invoke Tauri or open the native SQLite store, expected native-unavailable/loading/route-guard states were captured. Native save, archive, and gameplay correctness comes from the production-path database evidence above, not from these screenshots.

## 7. Reproduction

Run the normal contract test:

```bash
./node_modules/.bin/vitest run packages/test-fixtures/src/fantasy-long-playtest-runner.test.ts --reporter=verbose
```

To create a new evidence run, choose a new non-existing run directory and bind it to the current commit:

```bash
source_commit=$(git rev-parse HEAD)
run_dir="$PWD/docs/audit/evidence/v0.3-playability/m11-t02-fantasy-${source_commit:0:7}"
EMBER_FANTASY_PLAYTEST_RUN_DIRECTORY="$run_dir" \
EMBER_FANTASY_PLAYTEST_SOURCE_COMMIT="$source_commit" \
./node_modules/.bin/vitest run packages/test-fixtures/src/fantasy-long-playtest-runner.test.ts --reporter=verbose
```

Do not overwrite this committed evidence run. A replay is a new run with its own timestamps and hashes.
