# Phase 5 — E12 audit, decisions and economy scaling

The plan is `docs/PHASE_5_EPICS.md`. Phase 4's report is `docs/PHASE_4_AUDIT.md`.

**How to read the numbers:** every timing and rate here comes from **scripted bots** (`tests/bots.ts`, the
city player in `tests/pacing-city.test.ts`), not people. Bots act every 3 s and buy every affordable upgrade,
so people will be slower and buy less. No human playtests and no real-device measurements were done.

## Decisions agreed before starting

- **No save migration.** There are no players yet: the save version goes to **5** and older saves are
  scrapped with the existing notice (backup kept).
- **Seed Vault stays.** It now grows only energy and water. Biomass has no cap.
- **Big numbers from the start**, so nothing has to be retrofitted later: `break_infinity.js` 2.2.0 (MIT,
  published Feb 2023), chosen over `break_eternity.js` (needed only past 1e9e15, and slower).
- **Curve:** keep the fast early game and add long-tail growth rather than slowing the opening.
- **Upgrade depth:** lift the hard level caps; `baseCost × costMult^level` (1.65 for most).
- **Upgrades per machine** for machine and drone upgrades, bought by tapping a machine or with
  "Upgrade all" (cheapest first). Pulse, Rich Soil, Seed Vault, Fog and Network upgrades stay global.
- **Overflow:** the spec's rule (share of production wasted, capped per second).
- **Keep the endless fogged city.** Park → suburbs → skyscrapers, with solarpunk houses and towers as
  staged projects, **replaces E17** and comes after the E12–E16 gate.

## E12 audit (before changes, `4ae1b8e`)

Measured with the active and hands-off bots, seed 7, 30 minutes.

| Finding | Evidence |
|---|---|
| Every upgrade was bought by minute 5 | `upgradesLeft 0` from 5:00 to 30:00; nothing to spend on for 25 minutes |
| Income was thrown away | ~800,000 🌿 lost to the 5,400 cap over 30 minutes; energy full at 3,375 most of the run |
| The screenshot's 100/100 biomass | Seed Vault (the only cap upgrade) never bought, so nothing above 100 🌿 was purchasable |
| "Clear the grove 0/166" | Not a counter bug: the grove is the next fogged area; only tiles touching clear ground can be restored, so it starts at 0. 166 = min(60% of its tiles, 160 × distance difficulty) |
| A real stall | After one area at 6:00, no area progress for 24 minutes: a street at 922/922 restored whose "pass a chain along a green corridor" never fired |
| Frenzy in finished areas | Charged, slowly: one every 6–7 min active, 10–17 min hands-off, mostly from biomass overflow (which E12 removes) |
| Production display | The HUD showed gross income even when the store was full, so "+120/min" on a full bar was not collectable |
| Large numbers | Shown raw (`Math.floor`), no K/M/B |
| Harvest on a full store | Charged Frenzy through the overflow path (a small loop to close) |

## What E12 changed

| Story | Change |
|---|---|
| Uncapped biomass | `Economy` has caps for energy and water only; `cap('biomass')` is `undefined`. Everything that compared against a biomass cap now asks `exceedsStorage(cost)` (advisor, specialty safety valve, metrics, bots). Lucky Harvest, district blooms and offline time always land whole |
| Big numbers | `src/core/Big.ts`: every balance, cap, cost, reward, event amount and income total is a `Decimal`; per-tile and per-machine coefficients stay plain numbers. Entry points sanitise to finite and non-negative (NaN, ±∞, negatives → 0); the supported maximum is 1e100000 (clamped, with one console warning). Saves store them as strings. Display: `fmt` gives 7 · 950 · 12.3K · 4.56M · … · 1.5Dc, then 1.23e45, rounding down |
| Net production | `EconomyLedger` (20 s of sim time): banked, spent, lost to a full store, gross and net per resource. The resource strip shows **net**; tapping a resource opens the breakdown (producing / spending / lost to full storage, which charges Frenzy / net / stored) |
| Useful overflow (spec rule) | Frenzy charge per second = 0.1 × (share of a capped store's steady income lost to its cap), summed over energy and water, capped at 0.15/s. Harvest into a full store never counts. No charge while Frenzy runs or is ready (unchanged) |
| Frenzy in finished areas | New source: +0.03 per tile grown a stage by automation (drones, gardens, chains). Cosmetic events never charge it |
| Per-machine upgrades | Levels live on the machine (`MachineData.upg`). Solar Wings (was Solar Array), Water Bloom, Pollinator Reach, Mother Tree Resonance, Relay Lens and all five Drone Hub upgrades. Machine inspect panels have a buy button plus "All N"; the drawer's per-machine cards buy "All" cheapest-first. Each level is its own atomic transaction; a stale button (machine gone, wrong type) changes nothing |
| Power tiers | Solar Wings: no last level, ×(1 + 0.5L) doubled every 10 levels. Rich Soil: no last level, ×1.2 per level against cost ×1.55. Drone Dash to ×6, Drone Squad to 5 drones per hub, Drone Sweep to 8 free tiles, Work Radius +8, Lit Landmarks no last level. New: **Harvest Burst** (Harvest also pays 4 s of steady biomass income per level, 5 levels) and **Chain Hops** (+2 garden passes per chain per level, 5 levels). Efficient Pulse stays as a minor choice |
| Next purchase | The Upgrades button shows the price when something is affordable, otherwise "~2 min" until the next upgrade or machine at current income; the drawer header names it |
| Smaller goals | Every city area pays rewarded steps at 25 / 50 / 75 % of what its landmark needs (10 / 15 / 20 s of steady income, min 20 🌿, plus energy and water), once each, counted in unique restored tiles. The park keeps its 5–130 milestones |
| Stall fix | A landmark's specialty is satisfied once every restorable tile in its area is restored |
| No impossible prices | Found by the city bot (seed 21 stopped clearing at minute 25): machine prices grew ×1.5 per copy in energy and water too, while those stores are capped, their incomes barely grow and drones spend everything above their 25 % reserve. A Pollinator Garden reached 2.3K 💧 that the store never reached. Now: the energy/water part of a machine price grows for the first **9 copies** only (further copies cost more biomass), never passes **60 %** of that store, and while the advisor says "save up for X" drones leave X's energy and water alone. The landmark safety valve still judges the uncapped price, as before |
| Advisor | The "an upgrade is affordable" hint now waits 15 s of sim time after any purchase. With per-machine upgrades on 200+ gardens the advisor-only player otherwise spent 24 minutes buying one more Pollinator Reach level at a time |
| Display bug | Found while measuring: `fmt` stripped zeros from whole numbers ("160M" showed as "16M"). Fixed and covered by tests |
| Save | Version 5; resources and caps as Decimal strings; v4 and older scrapped with the notice |
| Dev tools | `sbDev.preset('wealthy')`: 1e15 🌿 for checking big-number display and long-tail upgrades |

## Measured (bots, seed 7)

Sustained biomass income per minute (no Frenzy or other temporary boosts), active bot:

| | 1 min | 5 min | 15 min | 30 min | 45 min | 60 min | 90 min | 120 min |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Spec hypothesis | 10 | 250 | 5K | 150K | — | 5M | — | 1B |
| After E12 | 70 | 4.3K | 49K | 4.0M | 14M | 36M | 109M | 160M |

- Early and mid game are faster than the spec's table, as agreed. After an hour, growth slows (about ×4.5
  from 60 to 120 min). Part of that is this bot: it stops clearing city areas at 15. The planned multipliers
  for that stretch are E13 merges and E14 superstructures.
- Rich Soil was tried at ×1.5 per level against ×1.6 cost: runaway (1.7B/min at minute 5), because a
  Frenzy (×10 income) bought dozens of levels at once. With ×1.2 against ×1.55, 10× wealth buys about 5
  levels, worth ×2.5. That is bounded.
- **There is always something to buy** for the full 30-minute test (Phase 4 ran out at about minute 5),
  and the bot is never stuck.
- 9 copies, not 6, for the energy/water price growth: with 6 the city ran faster still (75 / 73 areas an
  hour) but automation started more big chains than the player (92 vs 57), against Phase 4's rule that
  active play stays the most powerful thing.

City player (`tests/pacing-city.test.ts`, 60 min):

| Seed | Phase 4 (E10) | Before the price fixes | After E12 | Big chains: you / automation |
|---|---:|---:|---:|---|
| 7 | 43–68 an hour (seeds 7, 21) | 41 | **76** | 52 / 42 |
| 21 | | 13 (stalled at minute 17) | **82** | 61 / 37 |

Advisor-only player (`tests/no-stall.test.ts`): fountain from empty stores 9.5 min; next area with the park
packed and broke 7.0 min (was a stall before the cooldown); a far area at starting storage 1.1 min.

## Tests run

All on this branch, headless Linux, Chromium with SwiftShader software rendering.

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run build` | pass |
| `npm test`, run file by file (39 files, 226 tests, including the new `big.test.ts` and `economy-phase5.test.ts`) | pass |
| `npm run test:perf` | pass: 0.52 ms sim step (10k tiles, 343 machines, 31 drones; Phase 4: 0.93), 0.07 ms active-region tick (Phase 4: 0.22), 0.79 MB save, 10 ms load |
| `npm run test:perf:browser` | within limits: update median 5.2–11.4 ms (Phase 4: 5.5–11.3), 2 hitches in the ×704 chain run (Phase 4: 1) |
| picking e2e (69,445 checks), `hud-overlap`, `STRICT=1 phase4-hud` | pass, no overlaps at 320–430 px, landscape, tablet, desktop |
| `phase4-session` (15 minutes in the real page) | no page errors |
| `tests/e2e/phase5-hud-shots.mjs` (new) | no page errors; screenshots `docs/review/p5-hud-*.png` (1.23Qa biomass, breakdown, drawer) |
| `npm run test:soak` (1,000 areas, 6 h game time; determinism) | pass |
| `area-panel`, `overview`, `district-bloom` e2e | pass |

The full suite run in one process takes longer than before (the city pacing test alone is ~3.5 min,
because the scripted city now grows to ~80 areas an hour); its per-seed time limit went from 120 s to 300 s.

## Still open after E12

- The 60–120 minute curve flattens; E13/E14 are meant to carry it.
- Per-machine upgrades in a big city are many purchases. "Upgrade all" is one tap; it is not yet available
  as a single automatic setting.
- No human playtests and no real-device numbers.

# E13 — Merge and evolve machines

## Decisions agreed before starting

- **Merging stops at Tier 2** until E14, as the spec says (no Tier 3 that does nothing).
- **Which machines merge:** the four spec families map to Solar Panel, Water Condenser, Pollinator Garden and
  Drone Hub. Mother Tree, Reservoir Garden, Bloom Relay and landmarks don't merge.
- **Tier 2 effects ("stronger + reach"):** Solar Array ×4 energy (and ×4 bloom bursts); Condenser Array ×4
  water and each watering burst wets 2 more tiles; Bloom Garden biomass bonus ×2 (was ×1.5) and zone radius +1;
  Fleet Hub ×3 drones (at most 12) and work radius +2. Upgrades still multiply on top.
- **Selection:** tap a machine (the anchor; the merged machine stays on its footprint). The game picks the two
  nearest connected partners; tap another highlighted machine to swap it in. Confirm or Cancel; Esc cancels.
- **Fee:** the first merge of each type is free; later ones cost 20 s of steady biomass income (at least 20 🌿).
  The fee charged never exceeds the one shown in the preview.
- From the E12 discussion: machine prices count **lifetime builds**, so merging never makes building cheaper;
  a merged Drone Hub stays **2×2** (two footprints freed); the **starter panel and the old drone's lamp never
  merge**; the merged machine keeps the **highest level of each upgrade** and the preview lists what's lost.

## What changed

| Area | Change |
|---|---|
| Rules | `MergeSystem`: three same-type, same-tier machines whose footprints share an edge (corners don't count), as any connected shape (row or L). Any member can be the anchor. `plan()` is the preview (partners, fee, output 3 → 4, upgrade levels lost, tiles freed); `commit()` re-validates everything and changes nothing on a stale preview, a repeated tap, a wrong key or a fee that can't be paid |
| Commit | One transaction: fee, partners' footprints freed (tiles keep restoration and bloom), grid index, partner hubs' drones removed (a job in flight is dropped before it is paid, and its tile is released), anchor tier 2 with the highest upgrade levels, caches refreshed |
| Machines can now be removed | Every cache that assumed machines are only ever added (machine lookup, by-type index, drone networks and reach, garden reach, production sums, canals, metrics, core ids) now uses a stamp that also changes on removal, so a merge followed by new builds can't leave a cache that looks current |
| Prices | `stats.built` counts machines ever built per type; prices use it |
| Tier 2 effects | In `UpgradeSystem` per-machine getters (`solarMult`, `waterMult`, `condenserTierTargets`, `gardenMult`, `pollinatorReach`, `squad`, `droneRadius`). Overlapping garden zones use the strongest multiplier (they don't stack) |
| Inspect panel | Merge button on a machine with two touching partners, or a hint to place three; the preview card with output, fee, tiles freed, levels lost, swap hint, Merge / Cancel |
| Highlights | Gold: the three that merge (anchor brightest); pale blue: other machines you can tap to swap in |
| Animation | Partners hop into the anchor and shrink, the anchor squashes, rebuilds as its Tier 2 model and bounces up; gold arcs, rings, sparkles, a rising power-up then a fanfare. The simulation commits once, before any of it; visuals grant nothing |
| Tier 2 look | Bigger body on a cream plinth with a gold ring and a floating gem in the family colour (gold, cyan, pink, mint). Solar Array gets two extra wing panels that track the sun with it; Condenser Array two side tanks; Bloom Garden a ring of petals; Fleet Hub a second mast |
| Guidance | The advisor suggests a ready, affordable merge (its button flies there and opens the preview). The build tooltip says when a spot touches a matching machine ("one more alongside makes a Solar Array") or completes a merge |
| Saves | `tier` on machines, `stats.built`, `stats.merges`; no version change (no players yet, as agreed) |

## Measured (scripted bots, not people)

`tests/bots.ts` has an opt-in merge behaviour: after its usual build list the bot keeps buying panels, gardens
and condensers beside matching ones and merges every ready group. The control bot builds the same way and never
merges, so the difference is merging itself. Steady biomass income per minute:

| Seed | Bot | First merge | Merges by 15 / 30 / 60 min | 15 min | 30 min | 45 min |
|---|---|---|---|---:|---:|---:|
| 7 | builds, no merges | — | — | 762K | 10.0M | 39.7M |
| 7 | merges | 2:45 | 5 / 15 / 27 | 1.03M | 13.4M | 83.7M |
| 21 | builds, no merges | — | — | 962K | 13.2M | 93.0M |
| 21 | merges | 2:48 | 6 / 15 / 47 | 740K | 16.0M | 91.4M |

- Merging is a real but modest gain: +21–35% at 30 minutes, which is the spec's 3 → 4 output plus freed tiles.
  At 15 minutes on seed 21 it was behind (fees and three gardens covering more ground than one Bloom Garden).
  The spec puts the big multipliers in E14's superstructures.
- The bot merges from about minute 3 because it deliberately builds matching machines side by side; the spec's
  "first merge at 5–15 minutes" is for people, who won't plan that early.
- Longest stretch without a meaningful event: 25–29 s with merging (the Phase 5 bot without extra building: ~130 s).
