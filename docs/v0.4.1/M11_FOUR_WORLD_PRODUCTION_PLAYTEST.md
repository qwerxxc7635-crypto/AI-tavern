# M11-T10 Four-World Production Playtest

> 2026-09-24 审计更正：以下 PASS 是 2026-09-23 对固定示例四个 release `.app` 操作的历史判断。[`M12-T01 First Independent Full Audit`](../audit/V0_4_1_FIRST_FULL_AUDIT.md) 发现该 Session 没有真实 Campaign/Encounter、完整 Command/Objective/Domain/Theme 接入，且最终生产源码缺少 Windows 证据；M11-T10 和 M11 Final Gate 的当前状态均为 **FAIL**。原始观察和收据保留，不再作为完整生产战斗的证明。

## Verdict

**PASS.** Source commit `504073649e6d286830e659a7497c9f0d65a09d66` provides the production Combat route, typed Tauri boundary, Native session orchestration, canonical Core execution, Presentation projection and SQLite checkpoint/result lifecycle required to execute four complete real-UI battles.

This PASS supersedes, but does not delete or rewrite, the earlier source-commit `9918048` BLOCKED evidence. The blocker was real at that commit and was closed only after the user explicitly authorized the remediation implementation.

## Production boundary exercised

- React `/combat` renders only the authoritative `CombatViewModel` and submits `CombatCommandEnvelope` values.
- Tauri exposes typed start/restore, submit and complete commands.
- Native orchestration reuses the canonical Submission, Cost, Reaction, Scheduler, Encounter, World Profile, Status, Terminal and Runtime Commit components; it does not accept UI-computed HP, resources, status or results.
- `CampaignStore` writes each accepted step to `ActiveCombatSave`, restores the exact checkpoint after process restart, commits BattleRecord/result/Event Ledger in the canonical result transaction, then removes the active save.
- Cultivation, Fantasy, Science Fiction and Urban select data-only names/resources/abilities/reactions/status labels and an existing World Profile; they share the same command and persistence pipeline.

## Real-UI playtest matrix

| World | Reaction | Action / target | Resource | Status log | Intent | Reopen | Result / return |
|---|---|---|---|---|---|---|---|
| Cultivation | 护体罡气 | 破妄剑诀 → 噬灵傀儡 | 灵力 6→4→2; AP 3→2→1 | 剑意印记 | 攻击 → 云岚剑修 | revision 3 hash unchanged | 胜利 → 冒险 |
| Fantasy | 奥术屏障 | 余烬飞弹 → 灰烬守卫 | 法力 6→4→2; AP 3→2→1 | 灼烧印记 | 攻击 → 余烬法师 | revision 3 hash unchanged | 胜利 → 酒馆 |
| Science Fiction | 偏转力场 | 等离子齐射 → 失控机兵 | 能量 6→4→2; AP 3→2→1 | 锁定标记 | 攻击 → 边境特勤 | revision 3 hash unchanged | 胜利 → 冒险 |
| Urban | 紧急闪避 | 精准制敌 → 街巷暴徒 | 专注 6→4→2; AP 3→2→1 | 破绽标记 | 攻击 → 夜巡调查员 | revision 3 hash unchanged | 胜利 → 冒险 |

For every world the operator expanded the real Combat Log, stopped the `.app` after the first attack, reopened the same release shell, observed the persisted resource/log state, and compared the exact SQLite checkpoint hash. Each second attack visibly produced the fixed Chinese “胜利” result and both return controls. Across the matrix both return destinations were exercised.

The campaign was a minimal valid isolated test fixture, so the destination pages correctly failed closed on their own missing Adventure/Tavern domain data after navigation. That behavior is outside this Combat task and did not prevent the return route or result transaction from completing.

## SQLite closure

All four BattleRecords contain `VICTORY`, a unique deterministic `resultCommitId`, canonical delta hash, event digest and committed timestamp. Each combat aggregate contains exactly revision 1 `COMBAT_STARTED` and revision 2 `COMBAT_FINISHED`; the finished operation id equals the result commit id. The campaign has zero rows remaining in `active_combat_saves`.

Full identities and before/after checkpoint hashes are in [`M11-T10-5040736/four-world-playtest-receipt.json`](../audit/evidence/v0.4.1/M11-T10-5040736/four-world-playtest-receipt.json).

## Final M11 Gate

After the UI runs, the current source commit passed:

- `pnpm test:combat-determinism`
- `pnpm test:combat-stress`
- `pnpm check`
- `pnpm build:desktop`

Gate A-G remain PASS, the two-platform M11-T08 receipts and M11-T09 stress receipts remain applicable, and there is no unexplained determinism or persistence finding. M11 Final Gate is **PASS**; M12-T01 may begin next, but was not started as part of this task.

Evidence manifest: [`M11-T10-5040736/manifest.json`](../audit/evidence/v0.4.1/M11-T10-5040736/manifest.json).
