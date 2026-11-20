# E23.11 build mode: helper notes (paused)

Paused at the owner's request. No file is half-edited. Nothing is committed.

## Done (code written, not yet run in a browser)

- **Build dock** (`src/ui/Hotbar.ts` `BuildBar`, `#buildbar` + `#buildStop`). A paper pill at the bottom centre.
  - Keyboard: Water [V] / Power [O] toggles, then slots 1–9 with their keys, then Remove [X] and All builds [Q].
  - Pad: one "View: off / Power / Water" button (d-pad up), the d-pad left/right glyphs at the ends of the slot row, no number keys, Remove (RT) and All builds (Y).
  - "Stop building" sits above the right end (Esc on keyboard, B on pad). Every glyph comes from `actionGlyph`.
  - Buttons are clickable through a new `HudCallbacks.buildAct(action)`.
- **Classic hotbar removed**: the dome, Pulse, Inspect, Harvest, Upgrades, `#buildToggle`, `#buildTray` markup, and every CSS rule for them in `styles.css` (Hotbar section, dome, tray, the old `#buildbar` rules, the `body.oldcity #hotbar` overrides, phone media rules, the old crosshair, `.sep`). `Hotbar` is now a small model: `currentTool`, `setTool`, `toggleTray`, `trayOpen`, `menu`.
- **Build menu** `#buildMenu` (`src/ui/BuildMenu.ts`, catalogue in `src/ui/BuildCatalog.ts`).
  - Layout: a sheet with tabs (Machines, Power, Water, Farm, Storage, Decorations; only tabs that have something), LB/RB (Q/E) to change tab, a grid of cells, and a detail pane. The pane has recipe chips ("1 of 2 Copper", clay when short, leaf when met), a plain line about the piece, and "On your hotbar, slot N".
  - Locked cells say "Wake <Keeper>". Lucky Cat decorations stay hidden until given.
  - Footer: A/Enter Build (dimmed with a reason when you can't afford it), Y/P Pin to a slot (pick 1–9; replaces what's there; writes `Settings.hotbar` through the new `HudCallbacks.setHotbar`), B/Esc Back (leaves the slot picker first).
  - Mouse: click selects; double-click or a second click takes it.
  - It pauses the game (`syncPanelPause`) and is in PadFocus `PANELS`.
- **Bindings** (`src/app/Bindings.ts`): new actions and defaults.
  - `viewCycle` "Change the view": pad 12. `slotPrev` "Previous build slot": pad 14. `slotNext` "Next build slot": pad 15. All three are build context, pad only by default, and can be put on keys.
  - `pinSlot` "Pin to a hotbar slot": panel context, pad 3 (Y), key P.
  - `waterOverlay` and `powerOverlay` are off the pad (V and O stay).
  - While walking, d-pad left/right/up still eat, pin the next request and open the backpack.
  - **BINDINGS_VERSION stays 2.** Saves store only what differs from the defaults, so a player who never rebound gets the new defaults. A bump would wipe everyone's custom binds.
  - New rule in the `Bindings` constructor: a new default never takes an input the save gave to another action in a context that meets it. That default starts unbound instead.
- **Game.ts** (small edits):
  - New `doAction` cases: `slotPrev`, `slotNext` (`BuildBar.step`), `viewCycle` (`cycleView`), `pinSlot`.
  - `buildMenu` now also calls `syncPanelPause`. `panelTab` handles the build menu. `escape` calls `buildMenu.back()`.
  - New callbacks: `buildAct`, `setHotbar`.
  - New `buildPrompt()` texts: "Build a Solar Panel", "Place the Bench" with a "Turn" sub-line and the rotate glyphs, "Pick up the <name>" when aimed at a placed decoration, and "Remove the <name>" (decoration, machine, pipe or lights) with Remove on.
  - A decoration in hand aimed at a placed one now picks that one up. The board describes this; before, it failed with "in the way".
- **CSS**: new `src/ui/build.css`, imported in `src/main.ts` right after `styles.css`. It covers the dock, the menu, the ring-and-dot crosshair, high contrast, reduced motion and narrow widths.
  - It also holds two rules that touch other helpers' elements, needed for build mode: `body.building #hud #prompt` moves up over the dock, and `body.building #hud #dock` is hidden. Please confirm with the HUD helper.
- **Default hotbar** changed to the board's row: Solar, Battery, Relay, Planter, Compost Bin, Pump, Pipe, empty, empty (`HOTBAR_DEFAULT` now lives in `BuildCatalog.ts` and is re-exported from `Hotbar.ts`).
- Small fixes: `PadFocus` drops `#buildTray` and the `#hotbar` fallback. `OldCityGuide` no longer targets `#buildToggle`. `Hud.blockedRects` uses `#buildbar` instead of `#hotbar`.
- **Tests**:
  - Updated: `tests/bindings.test.ts`, `tests/rebind.test.ts` (new actions, plain labels, the no-reset upgrade, the new-default clash rule).
  - New: `tests/build-menu.test.ts` (catalogue, tabs, Wake text, have-of-need, plain words, default hotbar).
  - E2E scripts pointed at `#buildMenu` (they pinned the old tray): `backpack.e2e.mjs`, `gamepad-driver.js`, `workshop.e2e.mjs`, `water-shots.mjs`, `decor-shots.mjs`, `cat-rewards-shots.mjs`, `look5-shots.mjs`.
  - New screenshot script: `tests/e2e/e23-build-shots.mjs`, which writes to `docs/review/e23-ui/`.

## Test status

- `npx tsc --noEmit` (through heavy.sh): **passes for my files.** The only error was in another helper's file: `src/ui/Confirm.ts(67,23) TS6138 'spec' is declared but never read`. An earlier quote typo in `rebind.test.ts` is fixed.
- **vitest: not run.** The run (bindings, rebind, glyphs, placement, decor, build-menu, icons, hud-contrast, bloombot-words) was queued behind another session's lock ("cats: cat-proof e2e") and I stopped it for the pause.
- **E2E (e22-ui, gamepad, backpack, e23-build-shots): not run.**
- **Screenshots: none taken yet.** Nothing has been compared against the boards.

## Left to do

1. Run the vitest suites above and fix anything that fails.
2. `vite build`, then run `e23-build-shots.mjs` for the 1600x900 and 1280x800 `?gfx=deck` shots, `e22-ui.e2e.mjs`, `gamepad.e2e.mjs` and `backpack.e2e.mjs`.
3. Look at the shots against Build, BuildPad and BuildMenu and fix what differs. Check text sizes, contrast, fit at 125% and 150%, and that the dock fits 1280 wide with 9 slots.
4. Recipe chips on the in-hand prompt: `PromptModel` (the HUD helper's `Prompt.ts`) has no chip field, so machines show "Build a Solar Panel" without chips. That needs either a `chips` field from the HUD helper or a decision to leave it out.
5. `tests/e2e/phase4-hud.e2e.mjs` and `hud-overlap.e2e.mjs` still list `#hotbar` in their element lists. Check that a missing element is skipped, or swap it for `#buildbar`.

## Possibly broken right now (unverified until it runs)

- None of the new UI has run in a browser yet. Risk spots:
  - The click-versus-take rule on mouse clicks (`e.detail` and `downSel`).
  - PadFocus moving through the slot picker.
  - `BuildBar.update` calling `buildItem` 9 times about every 0.4 s.
- `src/ui/ObjectiveCard.ts` (HUD helper's) still mentions `#buildTray`/`#buildToggle`. It is null-safe and just finds nothing.
