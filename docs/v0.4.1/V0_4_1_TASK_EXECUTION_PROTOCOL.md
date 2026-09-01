# Ember Tavern v0.4.1 Task / Log / Commit Protocol

状态：M0-T07 PASS

日期：2026-09-01

适用范围：`V0.4.1_TASKS_FINAL.md` M1-T01 至 M12-T07

## 1. Authoritative records

| Concern | Authority/path | Required use |
|---|---|---|
| Combat product semantics | external V5.2 SOT identified in `V0_4_1_SCOPE_AND_RELEASE_GATE.md` | every Task reads its relevant section; never copied into a new SOT |
| task order/scope/DoD | external `V0.4.1_TASKS_FINAL.md` | only declared Task is implemented; `DependsOn` must be satisfied |
| current execution status | [`../TASKS.md`](../TASKS.md) v0.4.1 table | one current Task; Gate status based on completed evidence |
| chronological work record | [`../DEVELOPMENT_LOG.md`](../DEVELOPMENT_LOG.md) | every completed Task records changes, validation and boundary |
| major architecture/data/security decisions | [`../DECISIONS.md`](../DECISIONS.md) | append decision with context, choice, impact and reversibility |
| scope/release gate | [`V0_4_1_SCOPE_AND_RELEASE_GATE.md`](V0_4_1_SCOPE_AND_RELEASE_GATE.md) | prevents adjacent-version or release-claim expansion |
| module ownership | [`V0_4_1_COMBAT_MODULE_MAPPING.md`](V0_4_1_COMBAT_MODULE_MAPPING.md) | code must land in the declared single owner |
| Character adapter | [`V0_4_1_COMBAT_ATTRIBUTE_MAPPING_MATRIX.md`](V0_4_1_COMBAT_ATTRIBUTE_MAPPING_MATRIX.md) | M1/M5/M10 must implement and close recorded gaps |
| extensibility | [`COMBAT_EXTENSIBILITY_CONTRACT.md`](COMBAT_EXTENSIBILITY_CONTRACT.md) | every milestone and M12 reuse its review checklist |
| baseline | [`V0_4_1_BASELINE_AND_CI.md`](V0_4_1_BASELINE_AND_CI.md) | distinguishes inherited exclusions from new regression |
| durable audit/test evidence | `docs/audit/evidence/v0.4.1/` | machine-readable or platform artifacts when required |
| milestone/audit reports | `docs/audit/` | Gate, playtest, findings/fixes and release summaries |

Repository code, migrations and automated tests remain the evidence for implemented behavior. A document saying a test passed cannot replace running the test.

## 2. Task state machine

Only these Task states are allowed:

```text
NOT_STARTED -> IN_PROGRESS -> PASS
                         \-> FAIL
                         \-> BLOCKED
NOT_STARTED/IN_PROGRESS -> NOT_RUN  (only an explicitly unexecuted gate/evidence item)
```

- `IN_PROGRESS`: dependencies are satisfied and the Task is the current authorized scope.
- `PASS`: all Scope and DoD items are implemented, relevant tests pass, docs/log are updated, diff is reviewed, and the closure commit contains the work.
- `FAIL`: an executed validation failed and the Task has not yet been repaired.
- `BLOCKED`: an external prerequisite or qualifying SPEC BLOCKER prevents the chain; include exact evidence and affected chain.
- `NOT_RUN`: a named check was not executed; never equivalent to PASS.

`DONE`, `PARTIAL`, `SKIPPED`, `READY` and prose-only variants are not v0.4.1 Task states. A Gate is PASS only when every required dependency and Gate assertion is independently PASS.

## 3. Per-Task lifecycle

Every Task follows this sequence:

1. Verify current branch/source commit, working tree and `DependsOn`.
2. Mark only that Task `IN_PROGRESS`; do not start the next Task's implementation.
3. Read the precise V5.2/TASKS sections and inspect current repository owners.
4. Classify ambiguity as implementation choice, bug, asset/data issue or qualifying SPEC BLOCKER.
5. Implement the smallest complete scope; no future-task stubs or empty abstractions.
6. Add/update positive, negative, boundary, deterministic and persistence tests proportional to the Task.
7. Run targeted tests during work, then the Task's declared Gate set.
8. Review diff, ownership, data/AI/security boundaries, generated artifacts and user-owned changes.
9. Update `docs/TASKS.md`, `docs/DEVELOPMENT_LOG.md`, and `docs/DECISIONS.md` when a major decision occurred.
10. Create one independently auditable Task closure commit and fast-forward `develop/v0.4.1-combat` only after closure.
11. Mark the next dependency-ready Task `IN_PROGRESS`; implementation begins only on its branch.

A failed validation is fixed inside the same Task before PASS. If the repair is material, multiple commits may exist on that Task branch, but the complete commit range must contain no next-Task work.

## 4. Branch and commit contract

### 4.1 Branches

- development integration: `develop/v0.4.1-combat`;
- implementation task: `task/<TASK-ID>-<short-scope>`;
- audit/fix branches at M12 follow the explicit M12 task and remain independently reviewable;
- branches start from the latest accepted development tip, never from an unaccepted sibling tip;
- development advances by fast-forward only; `main` remains unchanged until an explicitly authorized release workflow.

### 4.2 Commit scope

Each closure commit includes:

- only the Task's implementation/schema/assets/tests/docs/evidence;
- `docs/TASKS.md` status transition;
- a `docs/DEVELOPMENT_LOG.md` entry;
- a `docs/DECISIONS.md` entry only when required;
- no user-owned unrelated files, credentials, local databases, build output or temporary diagnostics.

Recommended messages:

```text
feat(M1-T01): add combat version contract
test(M11-T01): verify deterministic core gate
docs(M0-T07): freeze task evidence protocol
fix(M12-T02): close <finding-id>
```

Before commit:

```text
git diff --check
git diff --cached --check
git status --short
```

Stage explicit paths, not `git add -A`. The known user `.gitignore` diff remains unstaged unless the user explicitly changes scope.

### 4.3 No history/result inflation

- Do not amend/rebase an already accepted Task just to hide findings.
- Do not squash distinct audit finding/fix evidence into an unverifiable claim.
- Do not mark a Task PASS before its required tests finish.
- Do not manufacture an empty implementation, hard-coded outcome or skipped validator to create a green commit.
- Do not push, merge, tag, sign, notarize or publish without the explicit workflow/task authorization and required gates.

## 5. Test and evidence contract

### 5.1 Minimum Task evidence

Every Task log records:

- Task ID, source commit and task branch;
- files/modules changed and ownership reason;
- relevant V5.2/TASKS section;
- commands actually executed, exit result and counts where available;
- skips/ignores/NOT_RUN/BLOCKED with reason;
- compatibility, migration, determinism, RNG, persistence or AI boundary impact as relevant;
- final status and exact next Task.

Documentation-only mapping tasks require format/link/diff checks and direct source inspection. Code tasks require focused behavior tests; affected full gates are run at milestone boundaries and whenever integration risk warrants.

### 5.2 Durable machine/platform evidence

Use:

```text
docs/audit/evidence/v0.4.1/<gate-or-task>-<source-commit>/
```

The directory contains only sanitized, reproducible evidence such as JSON summaries, deterministic fixture digests, database integrity summaries, screenshots required by a visual gate, platform lifecycle output, manifest and `SHA256SUMS`. It must not contain:

- API keys, Authorization headers or secret refs that reveal credentials;
- raw prompts/responses containing private user data;
- user save databases or unredacted local paths when not required;
- target/node_modules/build caches;
- claims for a platform/provider different from the actual runner.

For Gate/playtest/audit evidence, include a manifest with at least:

```text
schemaVersion, taskOrGateId, sourceCommit, platform,
command, startedAt, completedAt, status,
providerMode, artifact list/hash, findings summary
```

Timestamps document execution but never participate in Combat determinism or rule identity.

### 5.3 Evidence status

- Fake/fixture/simulator evidence is labeled as such and can prove deterministic/local behavior only.
- Real Provider evidence requires explicit credential/network authorization and reports model/provider identity without exposing secret material.
- Windows/macOS claims require evidence produced on that platform or the named trusted CI runner.
- Screenshot presence does not prove rule correctness; pair visual evidence with typed state/query assertions.
- A raw log without source commit/command/exit status is supporting material, not Gate evidence.

## 6. Decision and blocker protocol

Append `docs/DECISIONS.md` when a choice changes architecture, single ownership, persistent schema, compatibility, deterministic semantics, security boundary or future migration cost. Do not record routine refactors or restate the Task.

A qualifying SPEC BLOCKER entry must include:

- stable ID and status;
- exact V5.2 sections;
- minimal input/state/command;
- at least two reasonable interpretations;
- differing CombatState/RNG/Result/Persistence/Replay outputs;
- affected dependency chain and work that can continue safely.

Implementation/test/asset bugs do not become SPEC BLOCKERs. Fix root cause and add regression evidence without reopening product rules.

## 7. Gate closure protocol

A milestone Gate closure entry must list every required Task and evidence link, plus:

- targeted and full suite results;
- unresolved finding counts by P0/P1/P2/P3;
- explicit platform/provider/asset/persistence statuses;
- compatibility and deterministic digest status where relevant;
- architecture checklist result from `COMBAT_EXTENSIBILITY_CONTRACT.md`;
- next allowed Task.

If any required item is FAIL/BLOCKED/NOT_RUN, the Gate is not PASS. A later successful rerun references and supersedes the failed run; it does not delete the failure evidence.

The final release phrase is reserved for M12-T07 after Gate A-G, all required tasks, platform evidence, P0/P1/P2=0 and no unresolved SPEC BLOCKER. M0-M11 cannot use it.

## 8. M0 Gate evidence

| Requirement | Evidence | Status |
|---|---|---|
| Scope and release boundary | `V0_4_1_SCOPE_AND_RELEASE_GATE.md`; `751e278` | PASS |
| repository mapping | `V0_4_1_REPOSITORY_MAPPING.md`; `3639a5d` | PASS |
| Combat module mapping | `V0_4_1_COMBAT_MODULE_MAPPING.md`; `9506d8c` | PASS |
| Character mapping/schema gaps | `V0_4_1_COMBAT_ATTRIBUTE_MAPPING_MATRIX.md`; `1fbc5bf` | PASS |
| extensibility architecture | `COMBAT_EXTENSIBILITY_CONTRACT.md`; `4e0d129` | PASS |
| baseline tests/branch/CI | `V0_4_1_BASELINE_AND_CI.md`; `7dda1e4` | PASS |
| task/log/commit protocol | this document and M0-T07 closure commit | PASS on commit |

M0 has no open SPEC BLOCKER. Local full baseline has zero failures; remote platform gates are not requirements of M0 and remain explicitly `NOT_RUN`, not inherited PASS evidence.

## 9. M0-T07 acceptance

- TASKS, DEVELOPMENT_LOG, DECISIONS, audit report and durable evidence paths are fixed.
- Task status, lifecycle, test evidence, blocker, Gate and release-claim rules are explicit.
- Independent task branch/commit and development fast-forward policy is fixed.
- M0-T01 through M0-T07 each have scoped evidence and independent commits.
- Scope, mapping, architecture contract and baseline are all PASS.

M0 Gate is therefore PASS when this Task closure commit is created. The only next Task is M1-T01 Combat Version Contract.
