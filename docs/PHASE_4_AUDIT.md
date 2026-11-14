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

---

# E01 — economy rescue: what changed and what it measured

## Changes

| Story | Change |
|---|---|
| E01.1 | Drone Hub **80 🌿 + 30 ⚡** (was 110 / 35), Mother Tree **90 🌿 + 30 💧** (was 170 / 40), fountain **40 ⚡ + 100 🌿** (was 60 / 170). Everything the fountain needs fits in the starting stores, with a quarter to spare for energy and water. The bots found that drones spend energy all the time, so a 60 ⚡ fountain could never be paid from a 60 ⚡ store: a real softlock, now covered by a test. The advisor says when the fountain is ready but its price isn't, and points at the Seed Vault when a purchase is bigger than storage. |
| E01.2 | Resource HUD: income per minute plus spending per minute (rolling ~20 s), a ☀️×3 marker and tooltip during the cat's Solar Surge, and a neutral "· full" instead of a red "FULL". |
| E01.3 | Storage tiers in `TUNING.storageTiers`, one per Seed Vault level: 🌿 100 → 250 → 600 → 1,500 → 4,000, ⚡ 60 → 150 → 400 → 1,000 → 2,500, 💧 40 → 100 → 250 → 600 → 1,500. Costs 20 / 50 / 125 / 313 🌿; each level fits the store before it. Cleared areas still multiply the tier. |
| E01.4 | No new sinks yet. Early choices exist (Efficient Pulse 10, Solar Array 14, Seed Vault 20, Wide Pulse 22 🌿). The real gap is later: the city bot owns **every upgrade by about minute 5**, so there's nothing left to buy afterwards. That belongs to E04 (cost growth against production). |
| E01.5 | Income lost to full stores is tracked (`sim.log.overflow`) and not yet spent. It becomes Frenzy charge in E06. |
| E01.6 | Recovery from empty stores is tested (Harvest Sunlight, then a pulse). Nothing decays while away. |
| Old drone | A drone lives by the park's old solar lamp from the start: radius 6, slow (1.5 tiles/s, 7 s rest), free, no upgrades. It's not a Drone Hub, so it unlocks nothing. Saves made before it existed get it too. |
| Drone Hub | Base work radius 3 → **6** (a lone hub ran dry within a minute). Drones never spend a store below **25% of its cap** (`TUNING.drone.reserve`), so taps always have something left. Without the reserve, the bigger radius let drones drain city water and the city bot cleared a third fewer areas. |
| Offline | `OfflineSystem`: time away earns **half** the sustained rate for up to **4 h**. Drone jobs go through the normal pay-and-restore path (with the reserve) but set off no chains. The sim clock doesn't move, so cats, buffs, landmarks and milestones wait. Saves stamp `savedAt`; a clock that went backwards earns nothing; the result is saved at once so a reload can't count it twice. A tab hidden longer than the 10-minute live catch-up gets the rest as offline time. Old v4 saves load fine (no version bump). |
| Rename | The cat reward "Solar Frenzy" is now **Solar Surge** on screen. Saved ids (`solarFrenzy`) are unchanged. |

## Measured (bots, seeds 7 / 21 / 99, first 15 minutes)

| | E00 baseline | After E01 |
|---|---|---|
| Drone Hub fits in storage | 2:36–2:39 (after Seed Vault) | from the start |
| Drone Hub built | 2:51–2:54 | 1:51–2:00 |
| Mother Tree | 4:09–4:15 | 2:48–2:57 |
| Fountain (active) | 5:39–5:54 | 5:45–6:09 |
| Tiles restored by 15:00 (active) | 880–937 | 1,024–1,054 |
| Longest gap with no meaningful improvement | 164–170 s | 116–123 s |
| 🌿 lost to full stores (active) | 46,000–51,000 | 37,000–46,000 |
| Hands-off: tiles after the hub vs active | 1–2% (old definition: no actions at all) | **22–26%** (no taps; still buys and wakes landmarks) |
| Hands-off fountain | never | 8:33–9:06 |
| Fountain without upgrades or cats | — | wakes (test, seeds 7 and 21, within 20 min) |
| City bot, areas in 60 min, 12 seeds | 25.5 (6 seeds) | 25.7 |

## Still open after E01

- **Hands-off reaches 22–26% of active, below the 40–60% target.** Raising the hub radius to 6 got it to ~43%,
  but the drone reserve needed to protect taps brought it back down. The levers are in E07 (drone speed, extra
  drones, multi-tile jobs) rather than more radius.
- **Biomass income still far outruns storage after the fountain** (stores hold about 4 seconds of late income).
  Tiers help early on. The fix is E04's cost-growth pass plus E06 turning overflow into Frenzy charge.
- **The fountain arrives at ~6 minutes**, well before the plan's 9–12. That's left for E04 and E10, which own the park's milestones and pacing.
- **The city bot is chaotic**: tiny early changes swing a seed by ±10 areas, and its longest stalls are on street
  corridor and canal flow specialties (already there before Phase 4). Means over 12 seeds are the comparison used here.
- No human playtests and no real-device numbers yet.

---

# E02 — mobile-first interface

- **Hotbar:** the same five buttons at every size (Inspect · Build · **Pulse** · Harvest · Upgrades). Machines and their costs pop up in the Build tray (B, Esc closes it). Once a machine is picked, the Build button shows it.
- **Phones and short landscape screens** (≤ 760 px wide or ≤ 500 px tall): a compact resource strip of three icon/value/rate cells, and under it a one-line objective with a thin progress bar, the chips, and a compact suggestion button. The full checklist and the suggestion text open with 📋.
- **Hints:** one short line from live numbers, e.g. "Steady water: Build a 💧 Water Condenser · 24/35🌿". They glow the control they mean (the Build button when the machine is in the closed tray).
- **Icons:** one inline SVG set for energy, water, biomass, the five tools, pause/play and Frenzy (`src/ui/Icons.ts`). Machines keep their emoji as placeholders. Every icon has a text label or aria-label.
- **Affordability:** Upgrades shows a dot plus the price of something worth buying now, instead of a count. Unaffordable machines show ⏳ beside their cost, not red text.
- **Input:** a drag already never restores or buys anything (drag threshold), and UI taps never reach the canvas. Both were checked, not changed.

| Size | HUD covers (E00 → E02) | Overlaps |
|---|---|---|
| 320×640 | 50% → 34% | none |
| 360×740 | 39% → 28% | none |
| 390×844 | 33% → 24% | none |
| 430×932 | 27% → 21% | none |
| 844×390 landscape | 64% → 31% | none (was objective × hint) |
| 820×1180 / 1280×800 | 21% → 16% / 15% | none |

The Build tray stays on screen at every size (checked by `npm run test:hud`, which CI now runs). These are headless Chromium checks; no real phone was used.
