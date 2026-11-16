# HUD look (Look 5, #107)

The HUD's visual system, matched to `docs/reference/target-look.png`. Code: `src/ui/styles.css` (tokens at the
top), `src/ui/Icons.ts`, `src/ui/Hud.ts`.

## Tokens and type (5.1)

- Panels are dark teal glass (`--glass`, `--glass-strong`, `--glass-solid`) with a thin gold edge (`--edge*`)
  and an inner glow. Outside `:root` and the high-contrast override, `styles.css` has no colour literals.
- Fredoka (display: titles, numbers, buttons) and Nunito (body), self-hosted latin woff2 in `src/ui/fonts/`
  (SIL OFL 1.1, licences beside them). They sit next to the CSS so Vite bundles them; the build's relative base
  (`./`) keeps them working offline.

## Icons (5.2)

- Game and data strings keep emoji as compact placeholders ("+12🌿"). The HUD draws them as icons at the DOM
  boundary (`iconize`), so nothing on screen is an emoji. `tests/icons.test.ts` fails if a string uses an emoji
  without an icon; `test:hud` fails if any emoji is visible.

## Keyboard layout (5.6): decision

The reference shows Q, W, E, R around a "1" Pulse. **We keep the current bindings and restyle the badges:**
1 Inspect, 2 Restoration Pulse, B Build, H Harvest, U Upgrades, Q Bloom Frenzy, P pause, F next area, Home the
park, Esc back, 3–9 machines.

Why: Q is already Bloom Frenzy, and remapping it (plus W/E/R) would change every player's muscle memory, the
tutorial and the hints for a cosmetic match. The hotbar's five slots are the Phase 4 mobile-first set; machines
live in the Build tray where their 3–9 keys are shown. `test:hud` checks every badge against its binding.

## Top-right row (5.7)

`#chips`: the biodiversity pill (where the reference has its Day pill), then round glass buttons for pause (P),
speed (fast-forward; the multiplier shows on hover or focus, and stays shown while above 1×) and settings.

**Deferred:** the reference's "☀ Day N" pill. The game has no day cycle or day length yet, and Look 5 doesn't
invent gameplay. Once one exists (a day length in `tuning.ts`, optionally tied to Look 1's sun angle), it slots
in as the row's first `.pill`.
