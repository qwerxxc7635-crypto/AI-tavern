# M11-T03 browser-shell smoke

- Viewport: 1440×1000.
- `01-home.png` captures the initial boot state; `02-saves.png` captures the settled Saves native-unavailable state.
- `03-my.png` captures the transitional My loading state; `05-my-final.png` captures the settled device-settings page.
- `04-quests.png` captures the safe missing-Campaign route guard.
- All inspected routes reported no browser console errors.
- Native-unavailable/loading and missing-Campaign states are expected in Vite because the browser shell cannot invoke Tauri or open the production SQLite save. These screenshots do not replace native evidence.
