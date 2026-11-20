# E23.11 panels helper: notes at the pause

Paused on the owner's request (Nov 2026). Nothing is committed. No heavy job is running: the queued `tsc` was stopped while it waited for the lock.

## Done (code written, NOT yet type-checked or tested)

- **Shared shell.** New `src/ui/PanelShell.ts` holds:
  - glyph holders that follow the device in use (`setPanelGlyphs`, `fillGlyphs`, `glyph`);
  - action bars (`barHtml`, `wireBar`, `setBar`, `shellFooter`);
  - tab ends (`tabEnd`) and stroke icons (`icon`).
- **Shared CSS.** New `src/ui/panels.css` is imported in `main.ts` after `styles.css`. It covers:
  - the sheet, side card, buttons, cells, chips and bars;
  - settings, controls, the pause menu, `#inspect`, the plot picker;
  - `#tip`, `#fail`, `#catPanel`, `.wlabel`, `#cine` and `#photoBar`;
  - high contrast, reduced motion, and `@container` rules for 150%.
- **Old rules removed from `styles.css`.** The rules that panels.css now replaces are gone.
- **Backpack** (`Backpack.ts`, `backpack.css`): rewritten as a centre sheet with tab ends, an action bar, "X of Y" counts and a detail column. All ids the tests use are kept.
- **Crafting table** (`CraftTable.ts`, `craft.css`): the same rewrite. Parts read "1 of 3 Copper", and there are no `×` signs.
- **Settings** (`SettingsScreen.ts`, `ControlsTable.ts`): a sheet with an action bar and a range output. Controls has keyboard and pad columns and a listening banner (`#ctlListen`); its action bar shows Clear and Cancel while listening.
- **Pause menu** (`Menu.ts`): a left panel showing Paused, the garden name, region, day, time and time played. The buttons are Resume (primary), Backpack, Map, Photo mode, Settings, Save now and Quit to title.
  - Quit asks "Quit without saving?" (Confirm.ts hold) only when the save fails.
- **Outside my scope but needed:**
  - `PadFocus.ts`: I added `PadFocus.modal`, which sends the pad to the Confirm.
  - `Game.ts`: the Menu gets an `unsaved()` host hook, and the menu header gets the time.
- **`Panels.ts`:**
  - `#inspect` and the plot picker are side cards with an action bar.
  - Glyphs are synced each frame from `hud.glyphStyle` and `hud.bindings`.
  - Stats text no longer says "combo".
- **Machine cards in `#ocPanel`** (`OldCityPanel.ts`, `oldcity.css`):
  - `cardHead()` builds the head. The card docks right; storage is a centre sheet.
  - The planter, compost bin, Bio Digester, fountain and Tally's trade cards are rewritten.
  - The words are fixed: Greens, "Fountain step N", "X of Y", no Tier, no "full bloom".
- **Wording fixes:**
  - `AreaPanel.ts`, `OldCityGuide.ts`: "X of Y" and "Fountain step". Area-panel CSS is in panels.css.
  - `PhotoBar.ts`: three rows, a camera badge, and device glyphs in place of `<kbd>`.
  - `ChainSummary.ts`: "Canal · 37 blooms" in place of "×37".
- **Tests updated for the new text:**
  - `tests/area-panel.test.ts`
  - `tests/oldcity-keepers.test.ts` (Fountain step 2)
  - `tests/chain-presentation.test.ts` (regex is now `/ · \d+ blooms?$/`)
- **New screenshot script:** `tests/e2e/e23-panels-shots.mjs` (port 4223). It shoots the backpack, craft table, planter, compost bin, fountain, inspect, pause, settings > controls and the listening banner, at desktop and deck sizes, into `docs/review/e23-ui/`.

## Left to do

1. **`npx tsc --noEmit`:** never completed. Expect a few type errors in the newest edits (OldCityPanel, PhotoBar, ChainSummary).
2. **vitest:** run area-panel, backpack, pause, rebind, oldcity-panel, oldcity-keepers, bloombot-words, chain-presentation, keepers-tally, keepers-crops, research, crafting and hud-contrast.
3. **vite build and e2e:** run backpack, e22-ui, workshop, compost, area-panel, gamepad, plus crossbreed (it reads `#ocPanel h2`).
4. **Screenshots:** run the script, look at every picture and fix what doesn't match the boards. No screenshots have been taken yet.
5. **Markup not yet checked:**
   - `.wlabel` and `#cine` markup in Hud.ts (not my file; the CSS is done).
   - The `#catPanel` close button markup.
6. **Side cards still pause the game.** `Game.syncPanelPause` pauses for `#ocPanel` whether it is a side card or a sheet. The brief says side cards keep the world visible; I haven't checked whether they should also keep it running. This is the lead's call.

## Known risks right now

- **Nothing is type-checked or tested.** Treat the working tree as possibly not building until step 1 passes.
- **Storage sheet title.** `OldCity.openStorage` passes "Storage — at the fountain". In the oldcity UI, the host routes storage to the backpack grid, so the `#ocPanel` storage sheet only shows in classic mode.
- **Other helpers edited the same shared files at the same time.** These are `Hud.ts`, `PadFocus.ts`, `Panels.ts`, `Game.ts` and `styles.css`. Check the merged result before committing.
