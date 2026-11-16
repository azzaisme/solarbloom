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

## Painted icons (5.2, second pass)

The HUD's 22 main icons and the logo mark are painted in [klad](https://github.com/klad-app/klad) by
`tools/icons/paint-icons.mjs` (the source of truth: it rebuilds every drawing each run) and shipped as PNGs in
`src/ui/icons/` (96 px for 2×, 48 px for 1×, about 250 KB in all). Each icon is a set of parts, back to front,
with flat colour, a clipped multiply shade and screen rim from `klad light`, tapered ink, white highlights and a
soft glow. Re-paint with `KLAD=<path to klad> node tools/icons/paint-icons.mjs <workDir> [names]`.

Small glyphs inside text (machine and event emoji) and the solid white pause, fast-forward and gear stay SVG.
The favicon stays the SVG mark (a data URI). klad's drawings are ours to ship; klad itself is not distributed.

## Secondary surfaces (5.10)

Toasts, the discovery feed, tooltips and failure notes, hint bubbles, world labels (styling only; their
positioning belongs to Look 4), the cat panel, the cinematic title, fly-text, the event banner, the
biodiversity pill, the upgrades drawer, the inspect panel (area panel, merge preview, superstructure panel)
and the intro and settings modals all use the glass tokens and the icon set. Settings uses glass toggle
switches, gold sliders and a styled `select`: a new control (Look 1's Graphics quality) is one more
`<label>Name <input|select></label>` row and picks the styles up.

**Deferred (E18 drone roles, not on main yet):** the Drone Hub role picker, mixed-resource price buttons that
mark the short resource, and the Courier reach preview. The pieces they need are in place: the six role icons
(`ROLE_ICONS`), and a three-resource price renders as three icons side by side (`tests/icons.test.ts`).
