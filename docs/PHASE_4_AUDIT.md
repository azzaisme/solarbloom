# Phase 4 — E00 audit and baseline

Done against `main` at `bc6f41f` (City 12.4), before any Phase 4 changes. The plan is `docs/PHASE_4_EPICS.md`.

**How to read the numbers:** every timing here comes from **scripted bots** (`tests/bots.ts`, run by
`tests/baseline.test.ts`), not people. The bots act every 3 s and always pick a sensible move, so people will
be slower. No human playtests and no real-device measurements were done.

## Decisions agreed before starting

- Phase 4 works on the park and its first 15 minutes. The city stays, and shared systems also work there. No new city content.
- Saves are still discarded when the version goes up, with a notice (no migrations).
- The Lucky Cat's "Solar Frenzy" reward gets a new name, so "Frenzy" only means the earned Bloom Frenzy meter.
- Lean a little more idle: an old drone in the park from the start, the Drone Hub at about minute 2–3, a
  hands-off bot that reaches about 40–60% of an active one, and bounded offline progress (up to 4 h at half
  rate; production and drone work only).
- Art and sound stay procedural. One PR per batch of epics.

## The game is bigger than the plan assumes

The Phase 4 doc describes a single park. The repo is an endless, fog-covered city: you start in the park,
and waking the fountain clears the fog from the first ring of areas. The rooftop campaign the earlier plans
describe has been removed (City 12.4). Everything below is about the park and the first 15 minutes unless it says city.

## E00.1 — systems: implemented, partial, absent

| System | Status | Where / notes |
|---|---|---|
| Isometric grid, stable tile ids | ✅ | `core/Grid` — chunked endless world, ids `layer:x:z`, generation is a pure function of the seed |
| Tile states | Partial | `ground`: polluted → prepared (mossy) → growing → restored, then `bloom` 1–3 (grass → flowers → full bloom). No Thriving/Radiant stages, and no growth from water or biomass over time (E05) |
| Resources, caps, transactions | ✅ | `core/Economy`: all-or-nothing `spend`, clamped `add`, no negative balances. Mandatory costs are not checked against reachable caps (E01) |
| Resource sources | ✅ | Starter panel 1 ⚡/s, rain barrel 0.15 💧/s, solar, condensers, biomass per restored tile × bloom level, Harvest Sunlight (+8 ⚡ every 12 s), cleared-area bonuses |
| Resource sinks | Partial | Pulse, nurture, machines (×1.5 per extra copy), biomass-only upgrades, fountain (60 ⚡ + 170 🌿). Nothing uses income lost to full storage (E01/E06) |
| Storage growth | Partial | Seed Vault upgrade (+50% per level, 4 levels, from 20 🌿) and +35% per cleared area. Caps grow far slower than production (see baseline) |
| Pulse footprint | Partial | One tile per pulse; Wide Pulse adds 2 / 4 / radius-2 neighbours; Overcharge every 4th–6th pulse restores radius 2; Mega Pulse (40 taps) releases a 40+ tile chain. No footprint preview before tapping (E03/E04) |
| Upgrades | ✅ | `data/upgrades.ts`: 19 upgrades in 6 groups, all costed in biomass |
| Machines | ✅ | Solar, condenser, pollinator, Drone Hub, Mother Tree, Reservoir Garden, Bloom Relay |
| Bloom Chains | ✅ | `BloomChainSystem`: iterative priority queue, caps of 100 events (1,500 in the city), depth 40, fast-forward after 6 s / 20 s, paid once when the chain ends |
| Drones | ✅ | Reservations, deterministic job search, networks, far drones run by the clock. The radius is small (3 tiles), so a lone hub runs out of work fast (baseline) |
| Lucky Cat | ✅ | Generated nooks, claim-once, stash for missed cats, seeded rewards, discovery log. First cat at 4–6 min (plan: 3–4) |
| Bloom Frenzy | Absent | Only the cat's Solar Frenzy reward (×3 solar for 45 s) exists (E06) |
| Mini milestones | Partial | Park art stages at 25/50/75%, area specialty milestones in the city. Nothing rewarded between 0 and 130 park tiles (E04) |
| Fountain finale | ✅ | 130 restored + 52 full bloom + one of each of 5 machines, then 60 ⚡ + 170 🌿 |
| Advisor / objective | ✅ | `Advisor.suggest()`: always one achievable next step |
| Tutorial | Partial | 10 text steps in a hint card plus an intro modal. The card is long and covers the grid on phones (E02/E10) |
| HUD | Partial | DOM HUD, phone layout, safe-area insets, upgrade badge. Problems at 320 px and in phone landscape (see below) |
| Touch input | ✅ | Tap, drag pan, pinch zoom, pinch-out to the overview, picking e2e at phone zoom limits |
| Feedback (juice) | Partial | `TileFx`, `Vfx`, pooled flying numbers (`ui/Fly`), synthesised sounds and pad, chain counter. Audited properly in E03 |
| Settings / accessibility | Partial | Sound, music, reduced motion, low VFX, hints, debug overlay, keyboard shortcuts. No separate volume sliders and no high-contrast mode (E11) |
| Saves | ✅ | v4, gzip, per-chunk deltas; claim-once markers; corrupt or newer saves backed up; older saves discarded |
| Offline / hidden tab | Partial | A hidden tab catches up at most 600 s when it returns. A closed game earns nothing (E01 adds bounded offline progress) |
| Metrics | Partial | `Metrics`: firsts, stuck time, playtest summary with a Copy button. E00 adds the event log |
| Debug tools | Partial | F3 overlay. E00 adds reset, seed, presets and fast simulation (dev server only) |

## E00.2 — the Drone Hub capacity problem is real

- The Drone Hub costs **110 🌿 + 35 ⚡**. Biomass storage starts at **100**. A fresh save cannot buy the hub until Seed Vault (20 🌿) is bought.
- The game does nudge towards it: the advisor points at any affordable upgrade, and a full biomass store says
  "spend it or build a Seed Vault". But nothing explains that the hub itself needs bigger storage.
  The fountain requires a hub, so a player who never opens Upgrades is blocked for good.
- The Phase 4 screenshot's economy, reproduced with `presetSim('screenshot')` (19 tiles, 60/60 ⚡, 40/40 💧,
  24/100 🌿): the hub is unaffordable at any balance. After Seed Vault (cap 150) it is reachable.
- The Mother Tree (170 🌿) and the fountain (170 🌿) also cost more than the starting cap. They come later,
  so Seed Vault is normally bought by then, but neither has a guaranteed path.

## E00.3 — first-15-minute baseline (bots, seeds 7 / 21 / 99)

| Beat | Active bot | Plan target |
|---|---|---|
| First upgrade | 2:06–2:09 | 0:15–0:30 |
| Condenser / garden | 1:03 / 1:36 | 0:30–2:00 |
| Hub fits in storage (after Seed Vault) | 2:36–2:39 | — |
| Drone Hub built | 2:51–2:54 | ~3–4 min (agreed: ~2–3) |
| First ×5 / ×10 chain | 3:51–4:04 / 4:04–5:24 | 2–4 min |
| Mother Tree | 4:09–4:15 | — |
| First cat | 4:42 | 3–4 min |
| Fountain | 5:39–5:54 | 9–12 min |
| Longest gap with no meaningful improvement* | 164–170 s | 30–60 s |
| Stuck (nothing affordable to do) | 0 s | 0 |

\* Upgrade, machine, cat, chain of ×5 or more, or a milestone.

- **The first upgrade is late because of the bot**, which saves for its next machine. Efficient Pulse costs
  10 🌿, so a person who taps Upgrades early could buy it in about 15–20 s. It isn't the 30-second
  "meaningful improvement" the plan asks for, though.
- **Full storage loses almost everything after the fountain.** Biomass income climbs to ~4,000–5,000/min by
  minute 9 while the cap sits at ~335. In 15 minutes the active bot banks ~3,600–4,200 🌿 and loses
  **~46,000–51,000 🌿** to the cap. Biomass is full for ~550 of 900 s, energy ~420 s, water ~260 s.
- **The fountain comes faster than the plan's pacing** (under 6 min for the bot). By that bar the park finale is early, not late.
- **Hands-off is nearly zero.** The hands-off bot stops acting once its hub stands (~2:52). Over the next 12 minutes it
  restores **8–16 tiles, against 806–865 for the active bot (1–2%)**. The hub's radius is 3 tiles, so the drone
  clears that patch and then only nurtures. The agreed target is ~40–60%.

## E02 preview — HUD at phone widths (fresh park, 19 tiles restored)

`node tests/e2e/phase4-hud.e2e.mjs` after a build; screenshots in `docs/review/phase4-hud-*.png`.

| Size | HUD covers | Problems |
|---|---|---|
| 320×640 | ~50% | Resource names clipped ("60 / 60 Energ", "Biom"); the hint card covers the middle of the grid |
| 360×740 | ~39% | — |
| 390×844 | ~33% | — |
| 430×932 | ~27% | — |
| 844×390 (phone landscape) | ~64% | Objective panel overlaps the hint card; the hotbar and panels leave a thin strip of grid |
| 820×1180 tablet / 1280×800 desktop | ~21% | — |

The plan's screenshot showed the resource panel and objective panel overlapping. That no longer happens in
portrait, but the HUD still covers too much of a small phone. Other notes: the upgrade badge shows a count of
affordable upgrades (the plan asks for "a useful purchase", not a count), full stores show a red **FULL**, and
the hint text runs to 5–9 lines.

## E00.4 / E00.5 — instrumentation added

- `gameplay/DebugLog.ts`: a local, in-memory ring of gameplay events (pulse cast, chain resolved, upgrade
  purchased, machine built, cat spawned/found, store full, harvest, milestones, failed actions), counts of tile
  transitions by source, and income lost to full stores. No personal data; nothing leaves the browser.
  `sim.log` in code. Frenzy events get added with E06.
- `app/DevTools.ts`, loaded only by the Vite dev server (checked: absent from `vite build` output):
  `sbDev.reset(seed)`, `sbDev.preset('fresh' | 'screenshot' | 'rich')`, `sbDev.simulate(seconds)`, `sbDev.log()`,
  `sbDev.counts()`, `sbDev.overflow()`. Randomness was already seeded (`state.seed` / `state.rngState`).
- Presets are starting states, not alternative tuning tables. Tuning is still one `as const` object, and
  swappable balance tables would mean making it mutable, which isn't needed yet.
- `tests/bots.ts`: active and hands-off bots with timelines. `tests/baseline.test.ts` prints the report above
  (`BASELINE=1` adds the per-minute log).

## What E01 has to fix (from this audit)

1. The Drone Hub, Mother Tree and fountain must fit in starting storage, or have a guaranteed path that doesn't depend on finding Seed Vault.
2. Storage must keep up with production, and lost income must become useful (tracked now; it feeds the Frenzy meter in E06).
3. The first meaningful upgrade must come sooner, with something worth buying about every 30–60 s.
4. Automation must matter when hands-off: the old starter drone, the hub at ~2–3 min, and drones that don't run out of work.
5. Bounded offline progress, built on the same rates, sharing the hidden-tab catch-up path.
