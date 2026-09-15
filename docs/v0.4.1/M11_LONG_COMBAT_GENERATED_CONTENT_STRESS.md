# M11-T09 Long Combat / Generated Content Stress

## Scope and evidence boundary

This task exercises deterministic fixtures through the production combat rules, candidate transaction, SQLite checkpoint, equipment validator, and React projection boundaries. It does not call a paid or real AI provider; `realProviderStatus` is therefore `NOT_RUN`, and no provider result is claimed. AI-shaped fixture content remains untrusted until the real local mapping, budget, schema, exploit, or candidate-policy checks accept it.

The authoritative source commit is `8d6dcf19d1a745bb8e879da6388ce6a532406c5a`. The immutable receipt is stored in `docs/audit/evidence/v0.4.1/M11-T09-8d6dcf1/stress-receipt.json` with SHA-256 `f85571d8ba900bc7a15e36a3c56047ba8deb35c802b76c078307d5fd864247f9`.

## Stress matrix

| Contract | Load | Assertion |
| --- | ---: | --- |
| Long combat | 128 rounds / 384 normal owner turns | Two complete runs and every snapshot restore are identical; round and owner-turn counters are exact. |
| Trigger depth | depths 1–32 plus overflow at 33 | Depth 32 executes; depth 33 produces typed engine failure and `ABORTED`; RNG is unchanged. |
| Multi reaction | 128 Ask candidates | One canonical window contains the stable ordered set; the selected reaction commits once, preserves the snapshot, and consumes one charge. |
| Status stacks | 4,096 applications, cap 64 | The canonical instance stops at 64 without eviction, overflow, or order drift; repeated runs are identical. |
| Reinforcement | 64 preallocated combatants | Activation uses only the internal deterministic command path, commits 64 ordered events, restores from a validated snapshot, and produces identical state twice. |
| Save/resume | 64 SQLite close/reopen cycles | PendingReaction, accepted commands, scheduler/context/RNG partitions, checkpoint hash, and replay input survive every reopen. |
| Ability/status exploit validation | 32 abilities + 64 statuses | The maximum configured valid catalog passes twice identically; a recursive damage/AP exploit is rejected with the required typed findings. |
| Candidate persistence | 192 accepted + 64 rejected fixtures | Ability/status/equipment-shaped candidates cross the candidate transaction; rejected fixtures add neither candidate nor domain rows. |
| Equipment | 256 definitions | Program-owned mechanics remain deterministic and within the rarity budget, independent of prose claims. |
| UI overflow | 48 timeline entries, 48 combatants, 128 statuses, 128 abilities, 96 intents, 512 log entries | JSDOM renders every projected item, the last ability can target the last hostile, one structured command is submitted, and the complete collapsed log remains operable. |
| Replay | committed golden fixture | Roll, event digest, state hash, result, and fixed-point exact-value tests remain unchanged and pass in the same stress command. |

## Commands

`pnpm test:combat-stress` is the single local entry point. It runs six Rust Core stress tests, the native SQLite close/reopen test, three TypeScript/UI stress tests, and `pnpm test:combat-determinism`. Passing `--output <new-path>` emits a fail-on-overwrite JSON receipt bound to the current Git SHA.

The generated-content cases are deterministic test fixtures, not provider evidence. The UI case is render-and-interaction overflow coverage under JSDOM; it does not claim pixel-level browser performance evidence.

## Result

M11-T09 is **PASS**. The dedicated receipt is PASS, and the full `pnpm check` gate also passes: Vitest 200 files / 1,248 tests (plus 2 files / 6 tests skipped by their established baseline policy), Node 40/40, Rust workspace 531 tests passed with one credential-only ignored test, and archive interoperability passed in both directions. No unexplained determinism or persistence finding remains.
