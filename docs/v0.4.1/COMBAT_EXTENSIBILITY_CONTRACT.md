# Ember Tavern v0.4.1 Combat Extensibility Contract

状态：M0-T05 PASS

日期：2026-09-01

适用范围：v0.4.1 Combat implementation and review

上游：V5.2 产品规则；`V0.4.1_TASKS_FINAL.md` §1 implementation architecture contract

## 1. Contract purpose

本文只冻结实现形态与单一所有权，不新增或改写 Combat 产品规则。所有实现必须为当前 V5.2 已证明的变化轴选择最窄机制：

| Nature of the thing | Required representation | Why |
|---|---|---|
| 封闭且改变权威状态机语义 | Enum / tagged union + exhaustive dispatch | 编译期暴露遗漏分支 |
| 可扩展但本身不执行规则的内容词汇 | stable ID + versioned static catalog | 保持 ID 稳定且不形成 giant enum |
| 可执行的 Effect Primitive | typed static handler set | schema、验证、执行与 committed event 语义集中 |
| V5.2 明确允许的少量例外 | subsystem-owned local typed override | 避免万能 capability/boolean 系统 |
| 世界差异 | developer-defined WorldCombatProfile composition | 四世界共享一个 Core，差异集中且可版本化 |
| Replay-sensitive semantic change | existing version owner | 避免每个表各造 version |

“可扩展”不等于 runtime 可注册。v0.4.1 的扩展发生在开发者提交的新代码或版本化规则数据中，经过编译、验证和发布；存档、AI、UI、mod 文本或 Provider 响应不能注入新执行器。

## 2. Dependency and semantic ownership

```text
AI candidate ──mapping/exposure──┐
                                 v
Definition -> static catalog / typed definitions
                                 |
                                 v
                  pure authoritative Combat Core
                  enum resolver / handler / profile
                                 |
                 typed facts / query / committed events
              ┌──────────────────┼──────────────────┐
              v                  v                  v
          persistence       presentation       audit ledger adapter
```

- Combat Core owns executable semantics and deterministic state transition.
- Catalogs own stable identity and non-executable common metadata only.
- Balance owns program numbers, budget contribution and exploit policy.
- AI mapping/exposure owns which existing mechanics ordinary candidates may reference.
- Presentation owns localization, tooltip projection, layout and theme; it consumes mechanical facts.
- Persistence owns serialization/transaction only; it does not reinterpret rules.
- Existing Event Ledger receives selected committed facts; it is not a second scheduler or Combat event engine.

No downstream layer may reproduce a semantic switch just to avoid calling the authoritative query/projection.

## 3. Closed semantic state

Use a closed Rust enum and corresponding TypeScript discriminated union/wire validation when all are true:

1. V5.2 defines a finite set for v0.4.1;
2. each member changes authoritative execution/state semantics;
3. unknown members cannot be handled as neutral content without changing results.

The initial closed families include `WorldType`, `CombatResultType`, `CombatantState`, `ReactionMode`, `DurationClock`, `StackMode`, `RefreshPolicy`, `PrimaryMitigation`, and the frozen `ResolutionType` family.

Rules:

- The owning Core module performs one exhaustive `match` over behavior.
- Serde/wire parsing rejects unknown discriminants and unsupported versions.
- UI maps typed facts/reason IDs to Chinese text; it does not execute the enum semantics.
- Persistence serializes the discriminant and version; it does not branch into alternate rules.
- Adding a member is a ruleset/schema change with compatibility and replay review.
- A closed family must not be converted to stringly typed runtime registration because a future version may grow.

An enum is rejected when it combines unrelated content identities into a global list or requires unrelated modules to change for every new tag/channel/definition. That is enum explosion, not exhaustiveness.

## 4. Static catalogs

Use stable ID + static catalog for open content vocabulary whose members are data identities, classifications or common metadata rather than executable behavior.

### 4.1 Required catalog properties

- stable, namespaced, validated and serializable ID;
- deterministic lookup independent of hash/container iteration order;
- catalog contents supplied by compiled code or versioned developer rule data;
- duplicate ID and invalid metadata rejection at load/build time;
- no public `registerCustom*`, dynamic library, script or Provider registration path;
- catalog semantics covered by `rulesetVersion` unless §9 requires another owner;
- unknown ID fails definition validation when mechanically required.

### 4.2 Catalog ownership

| Catalog/identity | May own | Must not own |
|---|---|---|
| GameplayTagCatalog | Tag ID, namespace, semantic parent/category metadata | executor, arbitrary condition script, AI allowlist, localized prose source of truth |
| DamageChannelCatalog | Channel ID, semantic tags, localization/presentation key, common channel identity | world-specific primary mitigation, full damage formula, handler registration |
| Ability/Status definitions | stable ID, typed definition data and version references | per-definition code, direct mutable state callback |
| Effect Primitive identity set | stable primitive ID and typed schema association | runtime-provided handler, balance/tooltip/AI exposure policy |

Catalog lookup can be implemented as a compile-time array, exhaustive constructor or immutable developer data map. Calling the type `Registry` does not make dynamic behavior acceptable; review evaluates capability, mutation and ownership.

## 5. Typed static handler dispatch

Every executable Effect Primitive must enter one authoritative static dispatch path:

```text
EffectDefinition
  -> decode exact typed payload
  -> select canonical PrimitiveId handler
  -> validate definition and current preconditions
  -> mutate WorkingState only
  -> complete LethalResolution
  -> validate invariants
  -> Atomic Commit
  -> emit committed domain facts
```

A primitive handler may own only:

- its stable primitive ID and exact payload schema;
- static/business validation relevant to execution;
- deterministic WorkingState executor/resolver;
- committed domain event semantics required by triggers.

It must not own:

- Power Budget or program-number selection;
- mechanical tooltip wording/layout;
- AI availability or developer-only policy;
- theme, animation, audio or localization;
- persistence transaction/SQL;
- per-Ability special callback;
- arbitrary code/expression evaluation.

All handlers receive explicit context/RNG channel and return typed outcomes. They cannot use system time, filesystem/network, Provider calls, UI state or global mutable registration. Encounter/System effects reuse the same dispatch and commit pipeline.

## 6. Local typed overrides

An override is permitted only if:

1. V5.2 explicitly requires the exception;
2. one existing subsystem clearly owns its semantics;
3. a bounded tagged union or typed config can express it;
4. validation, balance and replay behavior are testable;
5. no generic cross-domain capability is needed.

Initial ownership examples:

| Exception family | Owner | Acceptable form | Rejected form |
|---|---|---|---|
| BasicAttack/multiple-attack exception | attack/basic-attack | `BasicAttackOverride` tagged config | `canIgnoreAnyPenalty: boolean` on every ability |
| Opposed Check tie policy | resolution | `OpposedTiePolicy` | string condition/expression |
| mitigation exception | damage/mitigation | bounded `MitigationOverride` | global capability bag |
| Extra Turn clock behavior | turn/clock | `ClockAdvanceOverride` | status/ability booleans scattered across modules |
| explicit developer Encounter hook | encounter + owning target subsystem | typed hook referencing existing primitive/override | arbitrary state callback |

Every override must state its owner, V5.2 citation, allowed callers, validation, version owner and tests. Ordinary AI content may reference it only through the single M6 Mechanical Exposure Policy. Developer-only does not mean a second catalog/allowlist inside the handler.

## 7. World profile composition and damage ownership

The only world resolution path is:

```text
WorldType
  -> deterministic WorldCombatProfileResolver
  -> WorldCombatProfile(version)
       + developer-defined Rule Modules
  -> resolved immutable profile input for Combat Core
```

`WorldCombatProfile` owns:

- resource lifecycle;
- defense behavior;
- `primaryMitigationByChannel`;
- recovery rules;
- signature mechanic;
- allowed/supported damage channels;
- selected developer-defined modules and their versions.

`DamageChannelCatalog` owns the channel identity and common semantic/presentation metadata. It **must not** own `primaryMitigation` for a world. The authoritative lookup is exactly:

```text
resolvedProfile.primaryMitigationByChannel[channelId]
```

Validation must reject a profile that lacks a required mapping, maps an unsupported channel, contains duplicate ownership, or selects an incompatible module. Core damage code consumes the resolved profile; it must not branch on `WorldType`. UI/theme may branch on presentation ID but cannot change mechanics. AI receives the already resolved supported vocabulary and cannot assemble a new base profile.

## 8. Distributed semantic switch prohibition

Allowed:

- one exhaustive `match/switch` inside the module that owns a closed semantic family;
- a presentation-only mapping from stable reason/fact/theme key to Chinese rendering;
- a serialization compatibility switch that only selects a decoder/migration, then calls the same rules owner.

Forbidden:

- Core, native adapter, TypeScript domain, UI, tooltip, AI prompt and persistence each calculating the same rule;
- UI recomputing legal targets, cost, damage, status duration or objective completion;
- AI mapping duplicating primitive/tag/channel existence instead of referencing canonical catalogs;
- persistence interpreting status/damage/profile rules during restore;
- profile-specific `switch(worldType)` scattered across effects, HUD and commit code;
- a “temporary” fallback path to legacy logic when Core rejects input.

Wire validation may verify shape/version and presentation may choose labels; neither is duplicate semantic execution.

## 9. Version ownership

| Change kind | Default owner | Examples |
|---|---|---|
| serialized Combat state/command/definition shape | `combatSchemaVersion` | field/discriminant/required structure change |
| executable rule, catalog membership/meaning, handler or scheduler semantics | `rulesetVersion` | primitive behavior, tag/channel semantics, resolution rule |
| tunable numeric data under unchanged formulas | `balanceVersion` | AP/cost/base constants/budget bands |
| WorldCombatProfile/module semantics | `worldProfileVersion` | lifecycle, mitigation map, recovery/signature rule |
| Character-to-Combat adapter | `attributeMappingVersion` | role/source/default/precedence change |
| RNG algorithm/channel/consumption contract | `rngContractVersion` | PRNG or stream/cursor semantics |

A new independent version field is allowed only when all are true:

1. the change affects authoritative future or replay;
2. none of the six owners above uniquely identifies it;
3. load/replay must select old and new semantics independently;
4. migration/rejection policy and tests are defined.

Otherwise it is version explosion and must be rejected. Snapshots/commands store the version set selected at Combat start; resume/replay never silently substitute current versions. Catalog entry display text or theme asset replacement that cannot affect rules does not require a rules version.

## 10. Explicitly prohibited architectures

The following are release-blocking findings if introduced:

- Generic Rule Capability Engine / `RuleCapabilityRegistry`;
- Runtime Plugin Registry or dynamic Effect/Resolution/Tag handler API;
- generic script DSL, expression VM, arbitrary rule graph or universal Ability VM;
- AI-generated JavaScript/Rust/expression or runtime callback;
- per-Ability direct `CombatState` mutation;
- flat global whitelist duplicated across catalog, prompt, validator and UI;
- arbitrary `capabilities: string[]` used to enable execution;
- boolean flag soup where unrelated abilities/statuses carry many global exception flags;
- four Combat engines or profile-specific copies of Core rules;
- catalog/profile double ownership of primary mitigation;
- duplicated legal-target/damage/status/objective logic outside Core;
- a new Combat Event Ledger, persistence stack, AI orchestrator or Character attribute system.

## 11. Change admission template

Any new Combat semantic kind, catalog entry, primitive, override or profile module must answer in its task/PR evidence:

```text
V5.2 requirement:
Semantic nature: closed state | content vocabulary | executable primitive | local exception | profile module
Authoritative owner:
Representation chosen:
Why a narrower existing representation is insufficient:
AI exposure: ordinary | developer-only | unavailable
Version owner:
Determinism/RNG impact:
Save/replay policy:
Tests:
```

An unanswered item blocks admission. “Future flexibility” alone is not sufficient justification.

## 12. Milestone review checklist

M12 and every milestone architecture review must verify:

### Representation

- [ ] Every closed semantic family is exhaustive and unknown values fail safely.
- [ ] No giant enum contains open content vocabulary.
- [ ] Every open vocabulary has stable validated IDs and immutable static catalog input.
- [ ] No runtime registration or script execution path exists.
- [ ] Every executable primitive uses the canonical typed handler set.
- [ ] Every exception is a V5.2-required local typed override owned by one subsystem.
- [ ] No generic capability bag or boolean flag soup exists.

### Ownership

- [ ] Core handlers contain no balance, tooltip, AI exposure, theme or SQL responsibilities.
- [ ] Balance, presentation and AI exposure reference canonical IDs without copying executable semantics.
- [ ] `DamageChannelCatalog` contains no world-specific primary mitigation.
- [ ] `WorldCombatProfile.primaryMitigationByChannel` is the single mitigation owner.
- [ ] Profile composition reuses one Core and Core contains no scattered `WorldType` switches.
- [ ] UI/legal-target/cost/log/result projections come from Core facts/queries.
- [ ] Persistence serializes and commits but does not re-resolve rules.

### Version/determinism

- [ ] Every replay-sensitive change maps to one declared version owner.
- [ ] No version field exists without an independent compatibility need.
- [ ] snapshot/restore/replay selects the saved version set or rejects it explicitly.
- [ ] catalog/handler/profile iteration and dispatch are stable and do not consume unowned RNG.
- [ ] cross-layer fixtures reject unknown IDs, discriminants and versions.

### Repository-wide negative checks

- [ ] Search finds no `registerCustom*`, `RuleCapabilityRegistry`, dynamic handler loading or eval/VM path in Combat scope.
- [ ] Search finds no duplicated `primaryMitigation` owner.
- [ ] Search finds no direct UI/AI/persistence mutation of `CombatState`.
- [ ] Search finds no Combat handler access to Provider, network, filesystem, system time, SQLite, Tauri or presentation.
- [ ] Search finds no player-facing raw enum/error ID introduced by the change.

Any unchecked item must be a documented finding with severity/owner/status; it cannot be silently treated as PASS.

## 13. M0-T05 acceptance

This contract freezes Closed Enum, Static Catalog, Typed Static Handler Dispatch, Local Typed Override, Profile Composition and Version Ownership; establishes the single `primaryMitigationByChannel` owner; and provides an M12-reusable audit checklist. It creates no generic DSL, registry, capability engine, schema or runtime code and does not alter V5.2 product semantics.
