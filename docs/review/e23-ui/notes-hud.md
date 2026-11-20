# E23.11 walking HUD (Sunlit Glass): status at the pause

Scope: the calm walking HUD from `docs/art/ui-sunlit-glass/Walk.dc.html` and `WalkPad.dc.html`. Nothing is committed.

## Done (code written, not compiled or run yet)

- **New `src/ui/hud.css`**, imported in `src/main.ts` right after `styles.css`. It styles:
  - the objective card, the charge card and the load chip;
  - the painted minimap with its N badge and clock/weather rim;
  - the prompt (54 px pill, leaf hold ring, sub pill, refused in clay);
  - the toasts, the load wheel (round paper cards) and the new dock;
  - high contrast, solid glass, and narrow windows.

  Every colour comes from a token. New tokens are in the first `:root` of `styles.css`:
  - `--mm-edge`, `--mm-flower*`, `--mm-cliff`, `--mm-shadow`;
  - `--mm-landmark*`, `--mm-cache`, `--mm-ring`, `--mm-grain`, `--mm-rim-shadow`, `--mm-disc-edge`;
  - `--card-lift`, `--well`, `--sun-bar`, `--leaf-bar`, `--low-bar`, `--ring-low`.
- **`ObjectiveCard.ts`**:
  - Layout: a leaf badge with a pin, the goal at 18px/900, and a thin bar plus "12 of 20" when there is a count. `objectiveSentence` now also returns `progress` and `topic`.
  - A charge shortage turns the badge to sun with a battery.
  - The hint strip and the details toggle are gone. The guide hint is now asked twice a second rather than every frame. The `nudge` glow is kept.
  - It still uses the `#obj` and `#objTitle` ids.
- **`ChargeMeter.ts`**:
  - A sun badge, "Charge" and the percent.
  - Low: an amber ring, "Low · 18%" and an orange bar. When food is carried, the Eat hint shows the live glyph (keys, Xbox, PlayStation or Deck).
  - It still uses `#chargeRow`, `data-res`, `role=meter` and the low/empty/calm classes.
- **`LoadWheel.ts`**: paper cards placed as on WalkPad, and the chip now reads "Seeds loaded". Their CSS moved from `oldcity.css` to `hud.css`.
- **`Prompt.ts`**: the pills get `sg-card`. The markup order is unchanged, so `tests/interact.test.ts` should still hold.
- **`Toasts.ts`**:
  - Paper cards with a badge. A toast's leading emoji becomes the badge picture.
  - Pick-ups show the material's own mark.
  - `feed()` is removed.
- **New `src/ui/Dock.ts` (`#dock`)**:
  - Backpack, Map and Menu, each with an `actionGlyph` under it that follows the live glyph style and rebinds. Idle opacity is .82.
  - A click calls the new `HudCallbacks.dock(a)`, which `Game.ts` wires as `dock: (a) => this.doAction(a)`.
  - A pink dot shows on Backpack while a Keeper request (or a request step) is new, meaning asked since the backpack was last open. Requests already open at load count as seen.
- **`Minimap.ts`** rewritten:
  - The ground is painted at one pixel per cell, then scaled up smoothly.
  - Over it go:
    - sandy paths with a darker edge;
    - water with a lighter middle;
    - buildings with cream walls and pink roofs;
    - bushes and flowers on lush ground, clods on dead ground;
    - cliff lines, and a paper grain that is made once and cached;
    - landmarks, beacons and caches.
  - It repaints on a new cell or every 0.5 s. Between repaints the canvas slides by the sub-cell offset, so walking is smooth.
  - The bloombot chevron is an SVG with a gradient and a white outline.
  - The rim shows the clock and the weather with an icon (moon on a clear night). Paint colours are read once from the `--mm-*` tokens.
- **Classic HUD removed**:
  - From the `Hud.ts` template and its code: `#logo`, `#quick` (home, cat and paw buttons), `#combo`, `#feed`, `#chainAreas`, `#hint` and `#intro`.
  - `Hud.feed`, `chainAreas`, `showIntro`, `introOpen` and `updateCatChip`.
  - `HudCallbacks.findCat` and `goHome`.
  - `Panels.ts` wiring, `PadFocus` `#intro`, and `blockedRects` now lists `#res #obj #hotbar #prompt #dock #minimap`.
  - `EcoBadge.ts` is deleted. Its `#chips` row never existed. The fauna arrival toast is now inline in `Game.ts`.
  - In `Game.ts`: every `hud.feed` call, `findCat`, `compass`, `solarFeedAt`, `lastBoostFeed`, `summaryAt` and the `introOpen` checks.
- **`styles.css`**: the old rules removed for `#res`/`.res-row`, `#logo`, `#chips`/`.rbtn`, `#obj`, `#combo`/`#feed`, `#hint`, `#toasts`/`.toast`, `#intro`/`.card-intro`, `#quick`, `#minimap`, `#prompt`, plus the `body.oldcity` overrides for these. The charge and load wheel CSS was removed from `oldcity.css`. `#saveLeaf` is kept: it is used, and `title.css` owns it.
- **Tests updated where they pinned the old look**:
  - `phase4-hud.e2e.mjs`: `#dock` is now allowed on the walking view, and dead ids are dropped.
  - `hud-overlap.e2e.mjs`: checks `#minimap`, `#prompt` and `#dock` instead of the dead parts.
  - `hud-one-meter.e2e.mjs`: dead selectors removed.
  - `look5-shots.mjs`: the `h.feed` call is removed.
  - `gamepad-driver.js`: no `introOpen`.
- **New `tests/e2e/e23-hud-shots.mjs`** (never run). It takes shots at 1600×900 and at 1280×800 with `?gfx=deck`, for keys and for pad + low charge + load wheel. It checks:
  - text is 16 px or more;
  - nothing overlaps at 100, 125 and 150%;
  - the dock opens the backpack and the menu;
  - the request dot.

## Not done / not verified

- **Nothing has been compiled or run.** The `npx tsc` job sat queued behind another session's lock ("cats: cat-proof e2e") and was stopped for the pause.
  - Not run: tsc, vitest (`hud-contrast`, `palette-lint`, `icons`, `glyphs`, `interact`, `advisor`), and the e2e `phase4-hud`, `hud-one-meter`, `hud-overlap`.
  - No screenshots taken yet, so none of the look has been checked against the boards.
- **Possible tsc errors to check first**:
  - `Minimap.ts`: the `K`/`Kind` constant object.
  - `Toasts.ts`: the `MaterialIconId` cast.
  - `Hud.ts`: `keyMapVersion` is declared after `setKeyMap`.
  - `Dock.ts`: whether `sim.keepers` is always defined.
- **Narrow windows** (`max-width: 640px` block): untested. Phones aren't supported, but `hud-overlap` runs at 390 px wide.
- **Shared glyph styling not changed.** The keycap SVG style (`svg.glyph` in `styles.css`) still draws leaf-edged caps, not the board's white keycaps. It is shared with the build and panels work, so I left it.

## Broken right now (as far as known)

- The build is unverified (see above). No known breakage beyond that.
- `styles.css` has an orphan comment, "Old-city rules: no hotbar…". The build helper's edit left it, and the rules under it were mine and are now in `hud.css`. It is harmless.
