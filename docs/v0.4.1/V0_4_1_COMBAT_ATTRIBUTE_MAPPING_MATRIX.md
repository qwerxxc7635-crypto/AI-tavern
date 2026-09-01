# Ember Tavern v0.4.1 Combat Attribute Mapping Matrix

状态：M0-T04 PASS

日期：2026-09-01

依据：V5.2 §3.3、§4.5.2.1、§4.5.7、§5；`V0.4.1_TASKS_FINAL.md`；当前 v0.3 Character / Rules / NPC / Equipment schema

## 1. 结论与禁止事项

v0.4.1 Combat 必须复用 v0.3 唯一基础属性：

```text
physique / agility / knowledge / charisma
```

Combat Definition 只引用版本化的抽象角色，不引用 SQLite/JSON 字段：

```text
BODY / FINESSE / INTELLECT / PRESENCE
FORTITUDE / REFLEX / MENTAL
```

`CombatAttributeResolver` 在 native boundary 读取 Character Domain，输出纯 Rust Combat Core 所需的 resolved values。Core 不读取数据库字段名；Ability 不得写 `attributes_json.agility` 等路径；WorldCombatProfile 只能选择本矩阵允许的 source。严禁新增平行的 `strength / dexterity / focus / spiritSense` 基础属性表，也严禁用 `derivedAttributes` 或 world extension 偷渡第二套基础属性。

四个 WorldCombatProfile 使用同一基础属性真源。世界差异由版本化 profile 的资源、装备、状态、规则模块和显示名称形成，不靠复制角色属性形成。M0-T04 不修改 schema 或实现公式。

## 2. 当前权威数据源

| Source | Schema/version | Authority for Combat import | Existing invariants | M0 finding |
|---|---|---|---|---|
| `PlayerCharacter.attributes` / `player_characters.attributes_json` | Character contract；legacy table | 玩家基础属性的原始真源 | 四个 integer 均为 1..5、总和 10；SQLite trigger 禁止修改 | 直接复用 |
| `CharacterRuleState.baseAttributes` / `character_rule_states.base_attributes_json` | rules schema 1 | 运行规则投影；必须与 PlayerCharacter 相等 | insert 时复制；SQLite trigger 禁止修改 | Combat import 优先读取并交叉校验原始真源 |
| `UniversalCharacterProfile.attributes` | universal character schema 1 | 通用角色投影，不是第三份可独立修改的 Combat 属性 | repository 校验数值投影；DB triggers 与 legacy profile 同步 | 可作为兼容校验，不能覆盖前两者 |
| `CharacterRuleState.skills` | rules schema 1 | 唯一现存 numeric skill source | `{key,value}`，key 开放；无 Combat catalog/version | 需类型化 allowlist 与冲突规则 |
| `UniversalCharacterProfile.proficiencies` | universal character schema 1 | 现存 textual proficiency hints | string list；无等级、catalog/version | 不能直接产生任意数值 |
| `CharacterRuleState.hitPoints` | rules schema 1 | 玩家战斗前 HP seed | `max` 1..999，`current` 0..max | 可导入；Combat 结束时按 M10 commit policy 回写 |
| `CharacterRuleState.resources` | rules schema 1 | 现存 keyed resources | `{key,current,max}`；key 开放，无 WorldProfile binding | 需 profile-owned stable key mapping/default |
| `CharacterRuleState.statuses` | rules schema 1 | 战斗开始前 legacy status input | 只有基础属性 modifier 与 game-minute expiry | 只允许显式 adapter；不能冒充 Combat Status runtime |
| `CharacterRuleState.traitModifiers` | rules schema 1 | 现存基础属性/skill/resource modifier | typed target，但没有 Combat trigger/effect semantics | 仅对已允许 source 做确定性加成 |
| `equippedItemIds` + Semantic Equipment | rules/equipment schema 1 | 装备引用与现有 damage/defense hint | damage/defense 是单值；numeric effect 能覆盖有限 check/recovery | 缺 Combat weapon/armor/resistance/accuracy typed projection |
| `UniversalCharacterProfile.derivedAttributes` | universal character schema 1 | 开放的 named numeric projection | arbitrary key/value；无 catalog/version/owner | v0.4.1 不作为基础 Combat attribute source |
| `UniversalCharacterProfile.extensions` | extension schema 1 | 世界角色扩展数据 | namespace + typed fields；内容由世界定义 | 不得用于绕过本矩阵；仅显式 versioned profile adapter 可读取非基础 Combat data |
| `NpcProfile` / `NpcLodProfile` | NPC / NPC LOD schema 1 | NPC identity/narrative/equipment references | 没有 attributes、HP、resources、skills 或 numeric proficiency | 必要 schema gap；不能从职业文字猜数值 |

### 2.1 Source precedence and drift rejection

玩家 import 的基础属性顺序固定为：

1. 读取 `CharacterRuleState.baseAttributes` 作为规则态值；
2. 与 `PlayerCharacter.attributes` 和存在时的 `UniversalCharacterProfile.attributes` 做逐字段相等校验；
3. 任一值缺失、越界、总和不为 10 或三份投影不一致，拒绝开始 Combat，禁止静默挑一份继续；
4. Combat snapshot 保存 resolved values 与 mapping version，恢复/replay 不重新读取后来变化的 Character profile。

这条优先级不授权修改 immutable base attributes；它只是确定导入与 drift detection。

## 3. Canonical Attribute Role Matrix

`combatAttributeMappingVersion = 1` 的基础映射如下。Resolver 返回当前有效属性值，即 immutable base value 加上当次 import 明确允许且已验证的 legacy attribute modifier；数值边界与 fixed-point 规则在 M1 实现并测试。

| Ability/Resolution role | Character source | Combat use | Missing/default behavior | Version | Schema gap |
|---|---|---|---|---|---|
| `BODY` | `baseAttributes.physique` | 力量/体魄型 Attack、Ability DC、Opposed Check | source 缺失即拒绝；不取 0 | mapping v1 | 无 |
| `FINESSE` | `baseAttributes.agility` | 灵巧/精准型 Attack、evasion Defense、Ability DC、Opposed Check | source 缺失即拒绝 | mapping v1 | 无 |
| `INTELLECT` | `baseAttributes.knowledge` | 学识/技术/术式型 Attack、Ability DC、Opposed Check | source 缺失即拒绝 | mapping v1 | 无 |
| `PRESENCE` | `baseAttributes.charisma` | 意志/存在/影响型 Attack、Ability DC、Opposed Check | source 缺失即拒绝 | mapping v1 | 无 |
| `FORTITUDE` save | `baseAttributes.physique` | 肉体、毒素、耐力类 Saving Throw | source 缺失即拒绝 | mapping v1 | 无 |
| `REFLEX` save | `baseAttributes.agility` | 闪避、反射、区域危险类 Saving Throw | source 缺失即拒绝 | mapping v1 | 无 |
| `MENTAL` save | `baseAttributes.charisma` | 控制、恐惧、神魂/意志类 Saving Throw 的基础属性部分 | source 缺失即拒绝；Cultivation 神识等是另一个 profile resource/status term，不替换基础属性 | mapping v1 | 需 profile resource projection，见 GAP-04 |
| `INITIATIVE_BASE` | `baseAttributes.agility` | `InitiativeModifier` 的基础属性项及平局 `InitiativeBaseStat` | 所有旧存档确定性使用 agility；装备/status/profile modifier 另计 | mapping v1 | 无 |
| `BASE_DEFENSE` | none in Character | V5.2 `TargetDefense` 的 profile base term | 由 developer-owned Balance/Profile version 给常数，不能从 narrative 猜测 | profile/balance v1 | 非 Character gap；M1/M5 配置项 |

### 3.1 Role selection rules

- 每个 Ability 必须在 definition 中选择一个允许的 `attributeRole`；没有“自动选择最高属性”。
- Attack 与 Ability Save DC 可以选 `BODY / FINESSE / INTELLECT / PRESENCE`；Save 只能选 `FORTITUDE / REFLEX / MENTAL`。
- Defense 默认使用 Ability/attack profile 明确声明的 defense role；典型 evasion 使用 `FINESSE`，但 definition/profile 必须显式，不能由 UI 或名称推断。
- `MENTAL -> charisma` 是基础属性映射；知识型主动 Ability 仍可显式使用 `INTELLECT`。两者不能由 LLM 临场互换。
- Status、equipment、situational、resource 和 proficiency 是 V5.2 公式中的独立项，不得预先揉进 base attribute 后又重复加算。

## 4. WorldProfile Mapping

下表的 alias 只影响 developer content selection 与中文表现，不创建新字段。四个 profile 对 canonical source 的读取相同；profile-specific modifier 必须来自独立、类型化且版本化的 term。

| Canonical role | Fantasy | Sci-Fi | Cultivation | Urban | Stored source |
|---|---|---|---|---|---|
| `BODY` / `FORTITUDE` | 体魄/力量 | 体能/耐受 | 体魄 | 体能/耐力 | `physique` |
| `FINESSE` / `REFLEX` | 敏捷/灵巧 | 反射/精准 | 身法 | 反射/灵巧 | `agility` |
| `INTELLECT` | 学识/奥术理解 | 技术/分析 | 悟性/术理 | 知识/战术 | `knowledge` |
| `PRESENCE` / `MENTAL` | 魅力/意志 | 意志/人格稳定 | 心性/意志 | 魅力/意志 | `charisma` |
| `INITIATIVE_BASE` | Agility/Dexterity base | Reflex base | 身法 base | Reflex base | `agility` |
| profile initiative additions | typed equipment/status effect | Neural Enhancement equipment/status effect | 神识感知 resource/status effect | Focus resource/status effect | 不属于基础属性；必须由 profile module 显式提供 |

V5.2 的 Fantasy Dexterity、Sci-Fi Reflex、Cultivation 身法、Urban Reflex 因此都落到现有 `agility`。V5.2 提到的 Equipment、Neural Enhancement、神识感知、Focus 只能作为各自结构化 modifier；不存在时旧存档默认 modifier 为 0，而不是创建同名基础属性。

## 5. Derived Combat Terms Matrix

| Resolver output | Existing source(s) | Deterministic rule at mapping boundary | Default/migration | Owner/version | Gap |
|---|---|---|---|---|---|
| attack attribute | selected canonical role | role lookup from §3 | invalid role rejects definition | mapping v1 | none |
| defense attribute | selected canonical role | role lookup from §3 | invalid/missing role rejects definition | mapping v1 | attack profile catalog must be frozen in M3 |
| save attribute | save type lookup from §3 | exact save mapping | invalid save type rejects definition | mapping v1 | none |
| ability DC attribute | selected canonical role | role lookup from §3 | invalid role rejects definition | mapping v1 | none |
| initiative base | `agility` | exact value used for modifier base and tie breaker | existing v0.3 value; no migration | mapping v1 | none |
| proficiency | `RuleSkill{key,value}` and allowlisted `UniversalCharacterProfile.proficiencies` | only exact stable Combat proficiency ID may resolve; numeric RuleSkill wins; textual membership may only grant developer-defined baseline | unknown key ignored for Combat, never executed as arbitrary rule | mapping + proficiency catalog v1 | GAP-02 |
| base defense | WorldCombatProfile/Balance definition | developer constant selected by profile/version | no Character migration | profile/balance v1 | none in Character |
| HP | `CharacterRuleState.hitPoints` | copy current/max into initial Combat state | existing v0.3 values; invalid rejects | rules schema 1 + combat state v1 | player ready |
| profile resources | `CharacterRuleState.resources` | exact profile-owned stable resource IDs only | absent old resource gets profile-defined deterministic initial value; migration recorded | resource mapping v1 | GAP-04 |
| equipment modifier | equipped IDs + approved typed Combat equipment projection | sum/apply only typed, bounded effects under core rules | old equipment without projection uses explicit compatibility mapping or neutral Combat modifier | equipment mapping v1 | GAP-03 |
| legacy attribute modifier | `RuleStatus.attributeModifiers`, `TraitRuleModifier(ATTRIBUTE)` | allowlisted deterministic import once into initial snapshot | unknown status/trait effect is narrative-only; no arbitrary execution | legacy adapter v1 | GAP-05 |
| runtime Combat status modifier | Combat Status Definition/State | never read from legacy string fields during a turn | none until M4 | combat status v1 | GAP-05 |

`derivedAttributes`, career display name, trait description, NPC identity, narrative ability text, semantic effect prose and world Constitution prose are never numeric fallbacks. LLM interpretation is forbidden.

## 6. Required Schema Gaps

### GAP-01 — NPC/Enemy combat stats (BLOCKING before NPC combat)

`NpcProfile` and `NpcLodProfile` contain identity and narrative data but no base attributes, HP, resources, skills or proficiency. A predeclared encounter cannot deterministically construct enemy Combatants from the current schema.

Minimal extension direction: add a versioned Character Domain combat projection for eligible NPC/Enemy definitions, using the same four canonical base fields and invariants or an explicitly bounded developer archetype projection. It must carry provenance/version and be validated before Combat start. It must not derive values from `career`, `populationRole` or prose and must not create a second player attribute system. Exact persisted shape belongs to the implementing task, not M0-T04.

### GAP-02 — Combat proficiency catalog and precedence (BLOCKING before Attack/Save scaling)

`RuleSkill.key` and `UniversalCharacterProfile.proficiencies[]` are open strings with no stable Combat catalog, version or unique precedence. Migration `0013_universal_character.sql` also projects `skills_json[*].name` while the TypeScript `RuleSkill` field is `key`, so that projection cannot be trusted as numeric Combat authority.

Minimal extension direction: a developer-owned versioned Combat proficiency catalog and exact key adapter. Existing numeric `RuleSkill` is the preferred source; textual proficiency membership can only map to an explicit bounded baseline. Duplicate/conflicting sources must resolve by the frozen precedence or reject, never add both.

### GAP-03 — Typed Combat equipment projection (BLOCKING before full damage/defense)

Semantic Equipment schema 1 exposes only aggregate `damage`, `defense` and a limited `ItemEffect`. V5.2 needs accuracy, damage bundles/channels, Armor, Resistance, Weakness, penetration, save/DC modifiers and possibly initiative modifiers. Narrative abilities/effects cannot supply them.

Minimal extension direction: versioned approved Combat equipment definition/projection owned by Combat content/balance validation, referenced by existing Item ID. Old equipment receives an explicit compatibility mapping or neutral Combat projection; no prose parsing.

### GAP-04 — World resource key binding and lifecycle (BLOCKING before profile-complete combat)

`RuleResource.key` is arbitrary. There is no versioned binding for Fantasy Mana/Stamina, Sci-Fi Shield/Energy/Heat, Cultivation 灵力/神识, or Urban Stamina/Focus, nor a distinction between primary HP, shield layer and spendable resources.

Minimal extension direction: WorldCombatProfile owns stable resource IDs, initial-value/default policy and import/export mapping. A Combat save persists resolved profile/resource mapping version. Old saves with absent keys use deterministic defaults; ambiguous duplicate/invalid keys reject or remain non-Combat data.

### GAP-05 — Legacy status/trait to Combat effect adapter (BLOCKING for carry-in effects)

Current statuses only modify four attributes and expire by game minutes; traits expose basic modifiers or balance tags but no Combat trigger, stack rule, owner-turn clock, reaction or typed effect. They cannot be executed as V5.2 Combat statuses.

Minimal extension direction: an allowlisted, versioned one-way adapter from approved legacy IDs to Combat initial effects. Unknown entries stay narrative/non-Combat. M4 Combat Status State is separate runtime state, not another update to legacy status strings.

### GAP-06 — Attribute mapping/profile binding persistence (BLOCKING for save/replay)

Current Character/Save schema stores no `combatAttributeMappingVersion`, resolved `WorldCombatProfileId/version`, or resolved Combatant stat snapshot. Re-reading later schemas would make replay change.

Minimal extension direction: M1 version contract includes mapping/profile versions; M10 ActiveCombatSave/BattleRecord stores the resolved initial Combatant projection. Existing non-active v0.3 saves need no eager rewrite; conversion occurs deterministically at first Combat start. An old active Combat without a supported version must fail safely rather than be reinterpreted.

## 7. Compatibility and Migration Matrix

| Existing v0.3 data | v0.4.1 behavior | Persistent mutation at M0-T04 | M10 requirement |
|---|---|---|---|
| valid player attributes/rule state | import with mapping v1 and cross-projection equality checks | none | fixture proves identical resolved values |
| empty skills/proficiencies | proficiency 0 unless developer content explicitly grants a catalog baseline | none | default version recorded in Combat snapshot |
| unknown skill/proficiency string | non-Combat; no numeric effect | none | preserve original data |
| missing profile resource | create Combat-local deterministic profile default at start | none | commit only policy-approved resource result; preserve unrelated resources |
| unknown legacy status/trait | retained outside Combat; no Combat mechanical effect | none | warning/evidence allowed, no silent deletion |
| old equipment without Combat projection | explicit compatibility mapping if cataloged, otherwise neutral Combat modifier | none | result must be deterministic and visible in compatibility tests |
| NPC without combat projection | cannot enter a real Combat roster | none | encounter generation/commit must create and validate projection first |
| inconsistent player attribute projections | fail Combat start with typed compatibility error | none | Chinese UX; no schema id/stack trace to player |
| unsupported mapping/profile version in active Combat | fail resume safely | none | never replay under newest mapping silently |

## 8. Resolver Boundary Contract

The later M1 implementation must preserve this shape semantically:

```text
Character facts + profile binding + approved content
  -> validate source versions and projection equality
  -> resolve canonical role values
  -> resolve typed proficiency/equipment/resource/legacy modifiers
  -> emit immutable ResolvedCombatantInput {
       sourceRevision,
       combatAttributeMappingVersion,
       worldCombatProfileId,
       worldCombatProfileVersion,
       baseAttributes,
       initiativeBaseStat,
       hp,
       resources,
       typed modifiers
     }
  -> Combat Core
```

The resolver:

- is pure for the same explicit inputs and performs no LLM/network/system-time call;
- rejects unknown versions, malformed values, source drift and unsupported required content;
- does not mutate Character/Rules data;
- does not include text descriptions in numeric calculation;
- does not consume Combat RNG;
- records enough version/source revision data for save/load/replay parity.

## 9. M1/M5/M10 Verification Obligations

M1-T05 cannot pass with only happy-path getters. Tests must cover:

- all four base roles, three saves and initiative against real v0.3 fixtures;
- all four WorldProfile mappings producing the same canonical base sources;
- source drift, invalid allocation, unknown role/version and unsupported NPC rejection;
- unknown textual data having no numeric effect;
- resolver determinism and zero RNG consumption;
- modifier category separation so a value is not counted twice.

M5 must close GAP-04 and profile-specific typed additions. M10-T07 must close persistence/compatibility obligations for GAP-01..06 and prove old normal saves load. No gap is considered closed merely because a default was hard-coded in UI or a test fixture.

## 10. M0-T04 Acceptance

- Real v0.3 Character, Rules, Universal Character, NPC LOD, Semantic Equipment and SQLite migrations were inspected.
- Every existing source field relevant to Combat has an authority/default/version/gap decision.
- Canonical role and four-profile mappings are explicit and deterministic.
- Six necessary schema gaps are named with blocking point and minimal extension direction.
- No product code, migration, Combat formula or parallel base attribute schema was created.

M0-T04 therefore passes its documentation DoD. Implementation remains gated by the corresponding later tasks.
