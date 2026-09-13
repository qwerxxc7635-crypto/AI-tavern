# M11 Gate F — UI / Theme / Asset Evidence

状态：PASS

采集日期：2026-09-13（Asia/Shanghai）

被测实现提交：`8572712`（Gate A–E PASS）

## 执行门禁

```text
vitest run windows-app/src/combat-screen.test.tsx windows-app/src/combat-theme-service.test.ts windows-app/src/combat-theme-fallback.test.ts windows-app/src/fantasy-combat-theme.test.ts windows-app/src/cultivation-combat-theme.test.tsx windows-app/src/scifi-combat-theme.test.ts windows-app/src/urban-combat-theme.test.ts packages/contracts/src/combat-theme.test.ts
node scripts/combat-runtime-assets.mjs
node scripts/check-player-language.mjs
cargo test -p ember-combat-presentation --lib
```

## SOT 条款映射

| Gate F 条款 | 主要可执行证据 |
|---|---|
| 四种 World Theme 共用同一 CombatState / Command API | `combat-screen.test.tsx` 的 `keeps the same Combat API semantics in all four future world-theme containers`；四个 theme integration tests 均绑定同一 CombatScreen/theme service contract |
| Theme 不修改战斗规则 | `combat-theme-service.test.ts` 的 `does not receive or mutate Combat State, Commands, rules, or an Engine lifecycle`；Core `cross_world_profile::tests::presentation_theme_labels_cannot_change_resolved_rule_bytes`；Presentation 仅消费 authoritative projection |
| 缺素材时 Fallback 不崩溃 | `combat-theme-fallback.test.ts` 覆盖 selected-theme miss、每个 stable slot 的 CSS/vector fallback、fallback package unavailable 与 cycle，全部 non-throwing 并产生 warning |
| 119 Runtime Assets 完整 | `combat-runtime-assets.mjs` 校验 FINAL package 的 manifests、stable slots、文件名、尺寸/透明度与 SHA-256；总数 common 10 + Fantasy 27 + Cultivation 27 + Sci-Fi 28 + Urban 27 = 119 |
| 玩家可见战斗功能文字为简体中文 | `check-player-language.mjs` 扫描 rendered copy、aria/status、CombatResult token、raw enum/error/stack leakage；Presentation 的 Chinese projection/invalid visible text tests |
| UI 不直接写 HP / AP / Status | `combat-screen.test.tsx` 验证 replacement ViewModel 完全替换显示状态、ability 不提交即不改变、EndTurn/UseAbility/Reaction/Tactical 只提交 structured Commands 且无 optimistic mutation；React 只使用 projected legal target IDs |
| Theme fallback 与 public manifest 契约稳定 | `combat-theme.test.ts` 校验 identity/layout/fallback/canonical slots 与 runtime compatibility；四主题 tests 校验各自 FINAL files 与 public manifest 完全一致 |

性能 receipt 由 M9 Gate 生成并在每次完整检查中验证来源和四主题浏览器测量；Gate F 不重新伪造测量结果。

## 结论

M11 Gate F = PASS。单一 Combat UI/API、四主题、fallback、119 assets、中文和只读 UI boundary 全部有可执行证据。
