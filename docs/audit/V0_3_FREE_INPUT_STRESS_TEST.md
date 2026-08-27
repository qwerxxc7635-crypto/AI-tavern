# V0.3 Free-Input Stress Test Audit

## 1. Verdict and scope

M11-T05 is **PASS** on source commit `2432d18e90b05d335c678dfc0c8d3b7202cb631c`. Eight exact, non-recommended player inputs completed across the retained Fantasy, Investigation, and Cyberpunk long-play saves through existing production native transactions. The final ledger contains four reasonable successes, two failures, and two rule-based refusals, with no crash, save loss, skipped consequence, forced suggestion path, or default “无法解析” response. No product defect was found and there are no open M11-T05 findings.

This result tests deterministic production orchestration and persistence with a Fake provider. It does not claim real-model narrative quality, execute M11-T06 reporting, or begin M12.

## 2. Run identity and evidence

- Run: `m11-t05-free-input-2432d18`
- Data origin: copies of the three committed `SYNTHETIC_M11` long-play databases; no formal user save was read or modified
- Provider: deterministic Fake provider through validated NPC dialogue contracts
- Real Provider: `NOT_RUN`; no credential was read and no network model was called
- Script: eight ordered, exact player inputs; all eight persisted without requiring a recommendation
- Evidence ledger: [`evidence.json`](evidence/v0.3-playability/m11-t05-free-input-2432d18/evidence.json)
- Machine summary: [`run-summary.json`](evidence/v0.3-playability/m11-t05-free-input-2432d18/run-summary.json)
- Run manifest and source hashes: [`manifest.json`](evidence/v0.3-playability/m11-t05-free-input-2432d18/manifest.json)
- Exact input script: [`script.json`](evidence/v0.3-playability/m11-t05-free-input-2432d18/script.json)
- Integrity hashes: [`SHA256SUMS`](evidence/v0.3-playability/m11-t05-free-input-2432d18/SHA256SUMS)
- Browser-shell notes and screenshots: [`manual-ui/README.md`](evidence/v0.3-playability/m11-t05-free-input-2432d18/manual-ui/README.md)

Each world directory contains the resulting `campaign.sqlite3` and importable `campaign.emtavern`. The runner verifies the committed source database SHA-256 before copying it and refuses to overwrite an existing run directory.

## 3. Behavior results

| World | Non-recommended behavior | Result | Durable consequence |
| --- | --- | --- | --- |
| Fantasy | Refuse the accepted clock-tower oath | `SUCCEEDED` | One Quest transitioned to `ABANDONED` with `PLAYER` authority; play remains available |
| Investigation | Deceive the publisher with a contradictory accusation | `FAILED` | The accusation was rejected and publisher trust persisted at 2 |
| Fantasy | Buy the tavern for all 12 silver | `REJECTED` | Ownership did not change and money remained 12 |
| Fantasy | Steal the counter cashbox | `FAILED` | Money remained 12 and owner trust fell to 2 |
| Investigation | Leave town without following a recommendation | `SUCCEEDED` | A third travel event moved the player to 海雾观测站 without auto-resolving open work |
| Investigation | Speak with a passerby over three days | `SUCCEEDED` | Six messages and relationship 1/1/1 survived repeated reopen |
| Cyberpunk | Sell a reward still bound to an open Quest | `REJECTED` | The reward remained present and credits remained 15 |
| Cyberpunk | Defect to the opposing corporation | `SUCCEEDED` | Corporate relation became `ALLIED`; the faction action and public consequence fact persisted |

The inputs are not converted into a new command language and their outcomes are not written directly to SQLite. NPC text is committed through the existing validated dialogue transaction. State-changing consequences reuse the existing Quest transition, dynamic-location travel, and faction-action commands. Read-only SQL assertions derive the final outcome from persisted state rather than copying the expected label.

## 4. Save, consistency, and safety observations

- All three campaigns reopened in `TAVERN` state with `PRAGMA integrity_check = ok`, zero foreign-key violations, and zero unfinished AI requests.
- Every exact player input and its corresponding NPC reply persisted. None of the eight replies contains “无法解析”, and every evidence row records `suggestionRequired: false`.
- Fantasy ended with one abandoned Quest, owner trust 2, and money 12. Investigation ended at 海雾观测站 with three travel events and a durable passerby relationship. Cyberpunk retained the bound reward, 15 credits, two faction actions, and one public defection fact.
- Portable archives were produced after the final reopen. Runtime operation locks and transient backup directories are excluded from evidence.
- The script uses existing component and domain boundaries; it does not add a preset-action router, relax validation, change schema, or modify Rules, D20, Provider, Queue, Save, Quest, NPC, or Adventure contracts.

## 5. Performance and UI observations

The production transaction flow took 2291.522 ms wall time, or 286.44 ms amortized over eight actions. This is a local harness observation, not Provider billing latency and not a replacement for the M10 performance gate.

At 1440×1000, the Vite browser shell rendered Saves, My, and the missing-Campaign Quest guard without console errors. The expected native-unavailable and loading states are documented because the browser shell cannot invoke Tauri or open the native SQLite saves. Screenshots prove safe rendering and routing only; persistence claims come from the committed databases, archives, and evidence ledger.

## 6. Reproduction

Run the normal contract test:

```bash
pnpm playtest:free-input
```

To create a new evidence run, choose a new non-existing directory and bind it to the current commit:

```bash
source_commit=$(git rev-parse HEAD)
run_dir="$PWD/docs/audit/evidence/v0.3-playability/m11-t05-free-input-${source_commit:0:7}"
EMBER_FREE_INPUT_STRESS_RUN_DIRECTORY="$run_dir" \
EMBER_FREE_INPUT_STRESS_SOURCE_COMMIT="$source_commit" \
pnpm playtest:free-input
```

Do not overwrite this committed evidence run. A replay is a new run with its own timestamps and hashes.
