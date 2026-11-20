# E23.11 Sunlit Glass: paused (2026-11-20)

The owner asked to pause. Branch `e23-ui-redesign` in worktree `unruffled-spence-5fb8fe`, WIP commit df8edeb7
on top of the tokens commit d2238f71. Base: `origin/e23-integration` @ e872960. The PR goes to `e23-integration`.

## State

- All four parts are written: walking HUD, title/saves/confirm, panel shell, and build dock/menu/pad controls.
  Each part's own note is `notes-hud.md`, `notes-title.md`, `notes-panels.md` and `notes-build.md`.
- None of the parts has been verified: no full `tsc` and no vitest/e2e run, because every helper sat behind
  another session's heavy lock. No screenshots exist either.
- Known tsc error: `src/ui/Confirm.ts(67,23)` TS6138, `spec` is unused. More are likely in Minimap.ts, Toasts.ts,
  Hud.ts, Dock.ts, OldCityPanel.ts, PhotoBar.ts and ChainSummary.ts.
- The contrast tokens were darkened (`--gold`, `--energy`, `--biomass`, `--good`) after `hud-contrast` failed
  4.46 < 4.5 on card-over-black. The test has not been re-run since.

## Resume order (every heavy step through `bash ~/.solarbloom/heavy.sh`)

1. `npx tsc --noEmit` and fix the errors.
2. `npm test` (quick suite), then the e2e tests:
   - phase4-hud, hud-one-meter, hud-overlap;
   - title, fresh-start;
   - backpack, e22-ui, workshop, compost, area-panel, gamepad, crossbreed.
3. Run the shot scripts (`tests/e2e/e23-{hud,title,panels,build}-shots.mjs`) at 1600x900 and 1280x800
   `?gfx=deck`. Look at each against `docs/art/ui-sunlit-glass/*.dc.html` and fix the differences.
4. Play it in the browser on keyboard and pad before the PR.

## Open decisions for the owner

- Should right-docked machine cards keep pausing the game? Today `syncPanelPause` pauses for them too.
- Should the build prompt show recipe chips? This needs a `chips` field in `Prompt.ts`.
- The hold-to-confirm button has no plain-click route, which may leave screen-reader users with no way to
  confirm. An option is a focused "Confirm" button after a second press.
- Keycap glyphs still use the shared leaf-edged `svg.glyph` cap, not the board's white keycap.
