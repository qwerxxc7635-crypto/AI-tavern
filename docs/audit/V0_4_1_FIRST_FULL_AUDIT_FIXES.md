# M12-T02 — First Audit Fix Ledger (in progress)

Audit baseline: [`V0_4_1_FIRST_FULL_AUDIT.md`](V0_4_1_FIRST_FULL_AUDIT.md). This ledger records partial implementation work, not M12-T02 acceptance. No finding is closed until its production path and required platform/regression evidence pass.

| Finding | Root cause | Fix commit / current work | Regression evidence | Status |
| --- | --- | --- | --- | --- |
| M12-041-007 | Checkpoint save advanced the database revision but did not compare the writer's restored revision. | `c9b9410` adds an expected persistence revision checked in the immediate SQLite transaction. | Native exact repeated-save/stale-writer test and combat-session test pass. | FIXED LOCALLY; full gate pending |
| M12-041-008 | The production Combat page bypassed the validated Theme Loader/Resolver and returned a synthetic hard-coded binding. | `ac57006` loads the selected `*-default` package and common fallback assets; current branch also narrows the binding layout type to the contract enum. | Targeted UI/theme tests (15) and TypeScript check pass; real Windows/RC playtest pending. | FIXED LOCALLY; platform gate pending |
| M12-041-014 | Visible-text validation accepted any string containing one Chinese character. | `4ab2574` rejects embedded internal combat tokens and ASCII functional text while preserving user-supplied combatant names. | Combat presentation unit suite (16) passes, including mixed-language regression cases. | FIXED LOCALLY; full language gate pending |

M12-041-001..006, 009..013 remain OPEN. M12-041-010 cannot close until the final source commit has its required Windows evidence. A partial local fix is not a release finding closure.

## SB-041-001 — Encounter ingress and authoritative definition (OPEN)

- **Relevant frozen rules:** V5.2 §4.5.2.1 requires validated Character Domain projections rather than parallel/hard-coded combat attributes; §11.4/§11.4.1 requires an EncounterStart-resolved and persisted Objective Runtime set; §11.2.1/§11.2.2 governs the pre-combat snapshot and canonical commit. External `V0.4.1_TASKS_FINAL.md` M12-T04 requires the real World→Character→Encounter→Combat flow.
- **Minimal state/command:** A campaign is in `ADVENTURE`, its player character exists in SQLite, and the adventure has a `CHECK_REQUIRED` step. The player submits the next adventure action or opens Combat. Current SQLite has Adventure records and BattleRecord/ActiveCombatSave, but no persisted versioned Encounter Definition or adventure→combat command/transition; current `start_or_restore_combat_session(campaign_id, world)` accepts a URL-selected world and constructs fixed `hero/enemy` data.
- **Interpretation A:** Treat an existing `CHECK_REQUIRED` adventure step as the automatic EncounterStart. The check's existing target/participants would need to become the encounter roster/objectives. This starts Combat on that adventure transition and persists a battle plus altered Adventure state.
- **Interpretation B:** Start Combat only from a separate, explicit, versioned Encounter Definition/event selected by the Adventure domain. An ordinary `CHECK_REQUIRED` step remains a non-combat check and no BattleRecord is created; only the explicit encounter event produces one.
- **Different authoritative output:** For the same campaign and next adventure action, A creates a CombatState/seed/BattleRecord and can consume combat RNG, while B keeps the adventure check path with no CombatState or combat RNG. Picking enemy projections, objective IDs, or result deltas from prose would further change Result, canonical persistence, and replay. V5.2 defines how an Encounter executes but does not select A or B or define the missing source record.
- **Affected chain:** M12-041-001, 004–006, 009–013 and the real M11/M12 release gates cannot be closed by substituting a fixed demo or inventing an enemy. The current `M12-T02` remains incomplete; `M12-T03` and later tasks must not start.
- **Safe independent work:** Checkpoint concurrency, theme binding, language validation and their regressions are already repaired locally. Additional fixes that do not choose Encounter ingress or content can continue after this decision, but cannot establish release readiness.

Decision required: Is Combat entered automatically from an existing Adventure check, or only from an explicit, persisted versioned Encounter event? If the latter, which existing or new domain record owns the roster, objective definitions and NPC stat projection? This must be resolved before implementing the authoritative production session.
