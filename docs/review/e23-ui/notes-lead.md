# E23.11 Sunlit Glass: lead notes (2026-11-20)

PR #554, `e23-ui-redesign` → `e23-integration`. It merges the latest `e23-integration`, including #549 automation.

## State

- **Built:**
  - walking HUD, with the painted minimap and the dock;
  - title, save slots and the are-you-sure dialog;
  - the panel shell, with the pause menu and settings;
  - build dock, build menu (#344) and pad build controls.
- **Checks:** `npx tsc --noEmit` and `npm test` (quick suite) pass. e2e and screenshots have not run, because the deadline plan holds them for the final pass.
- **Played:** a quick keyboard and mouse run in the dev server: title → gardens → days → loading → walking HUD → build menu → backpack → pause. Pad and Deck size are not played yet.

## Coordinator review (fixed)

1. Pad Y opens **and closes** the build menu again. Pin to a slot moved to X (keyboard P). `bindings.test.ts` pins both.
2. The build menu keeps **pausing the game**. This is deliberate: every centre sheet pauses (backpack, craft, settings, build menu), and machine cards dock right. The owner confirmed "pause the game" for panels on 2026-11-20.
3. **Contrast:**
   - `--ink-3` and `--text-dim` darkened to #5a6553.
   - The title strip is `--veil-strip` (.7), and the painting note sits on a `--note-bg` pill.
   - `hud-contrast` now checks every ink on every paper and soft fill, plus the title strip and note over white and black.
   - `title.css` and `backpack.css` have no literal text colours; the `--mat-*` values are icon fills.
4. **e2e and shot scripts:** moved to `#buildMenu`, `#buildbar` and `#dock`, with a shared start-game helper. See the helper's report in the PR.
5. **Cleanups:** the dead `#buildTray` and `#buildToggle` nudge lookups are gone, the orphan CSS comment is gone, and the hotbar setting cast is dropped.
6. **Are-you-sure:** a one-second hold **or** two presses. The first press arms the button ("Press again: …"), and a second press within 4 s confirms. This works on mouse, Enter/Space and pad A. Moving to the safe button disarms it.
7. The Settings stats show "Lucky Cats: N" only after a cat has been found.

## Build-mode d-pad: kept as the owner approved

The owner approved the gamepad board (BuildPad.dc.html) and the build-mode d-pad layout on 2026-11-20:

- left/right = previous/next slot;
- up = view Off → Power → Water.

Walking keeps up = backpack and left = eat. In build mode the backpack opens from the dock or Tab, and B leaves build mode first. A change here is the owner's call.

## Final pass to do

- Run the e2e list: phase4-hud, hud-one-meter, hud-overlap, title, fresh-start, backpack, e22-ui, workshop, compost, area-panel, gamepad, crossbreed, and #549's automation e2e.
- Run the shot scripts `tests/e2e/e23-{hud,title,panels,build}-shots.mjs` at 1600x900 and 1280x800 `?gfx=deck`.
- Play on a pad and at Deck size: build placement, decoration pick-up, and the slot d-pad.
