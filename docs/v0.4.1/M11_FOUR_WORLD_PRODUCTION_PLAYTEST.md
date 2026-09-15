# M11-T10 Four-World Production Playtest

## Required gate

M11-T10 requires one complete real-UI battle for Cultivation, Fantasy, Science Fiction, and Urban. Each run must cover action, status, resource, reaction, enemy intent, terminal result, return flow, and SQLite save/reopen. Component tests, theme previews, JSDOM fixtures, and the theme performance page are not substitutes for a production flow.

## Observed production state

Source commit `9918048ba9e5c6df38f190aa4244d010353c6e29` builds successfully with `pnpm build:desktop`, but the production bundle has no Combat page chunk. The product integration required by the playtest is absent:

- `windows-app/src/navigation.ts` declares no combat path.
- `windows-app/src/routes.tsx` registers no combat route or Combat page.
- No production `combat-page.tsx` or `combat-service.ts` exists.
- `windows-app/src-tauri/src/lib.rs` registers no combat command in its `tauri::generate_handler!` list.
- `CampaignStore` has real combat checkpoint/replay/result methods, but none is exposed to the production UI.

Using the repository's `browse` QA skill, the built application was served and Chromium navigated to `#/combat?campaignId=playtest-m11-cultivation`. The actual player-visible result was the normal unknown-route screen: “路径不可用……返回酒馆.” No CombatScreen, action, status, resources, reaction, intent, result, return-from-result, or save/reopen control was reachable. The other three world runs share the same missing route and therefore remain `NOT_RUN/BLOCKED`; they were not mislabeled as executed.

## Blocker

Passing this gate would require implementation work outside M11-T10's playtest-only scope: a production Combat route/page, a typed UI service, registered Tauri combat commands, and an orchestrator connecting the already-built Core/Presentation/SQLite boundaries. A standalone benchmark page or hard-coded state carousel would not satisfy the SQLite-as-truth or real-combat requirements.

M11-T10 is **BLOCKED**. M11 Final Gate is not PASS, so M12 must not begin. Durable observation evidence is stored in `docs/audit/evidence/v0.4.1/M11-T10-9918048/`.
