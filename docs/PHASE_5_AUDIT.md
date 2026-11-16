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

## Bug found while validating

- **Drone Squad crashed the hub model at level 3 (from E12).** E12 raised Drone Squad to 4 levels (5 drones),
  but the hub model had landing pads for only 2 extra drones, so buying the third level threw while refreshing
  the model, every time. The 15-minute session test found it (its bot buys every upgrade). Now there's a pad for
  each level.

## Tests run (E13)

All on this branch, headless Linux, Chromium with SwiftShader software rendering.

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run build` | pass |
| Unit tests, file by file (40 files, 238 tests, including the new `merge.test.ts` with 12) | pass |
| `tests/e2e/merge.e2e.mjs` (new): tap a panel, open the preview, tap a fourth panel to swap it in, confirm | pass, no page or console errors; the merged and kept machines are the expected ones |
| picking e2e (74,299 checks), area-panel, overview, `STRICT=1 phase4-hud` | pass |
| `hud-overlap` | one failure (a toast 3 px over the objective panel on the phone layout, the known toast-timing flake), then 3 passes in a row |
| `phase4-session` (15 minutes in the real page) | pass after the Drone Squad fix |
| `npm run test:perf:browser` (150 areas) | within limits: 0 pan / 0 zoom / 1 chain hitches, chain ×743 |
| `npm run test:perf`, `npm run test:soak` | pass |

## Still open after E13

- Merging is a modest gain on its own (spec: 3 → 4); E14's superstructures carry the big multipliers.
- No Tier 3 yet (E14), so a Tier 2 machine shows "top tier until superstructures arrive".
- No human playtests: whether picking partners by tapping feels good needs people.

# E14 — Superstructures

## Decisions agreed before starting

- **Tree of Life = three Bloom Gardens; the Mother Tree stays** ("the Tree of Life is the Supreme Kai, the
  Mother Tree is King Kai"): the Mother Tree remains the cheap, local radius-2 pulse; the Tree of Life is the
  3×3 tier 3 of the garden family.
- **Store a core, place it anywhere:** merging three tier-2 machines gives a Superstructure Core; it is placed
  like a building (footprint ghost, all three stage prices shown first). A blocked spot never uses a core.
- **Solar Megaflower burst: ×3 energy only, 15 s.**
- **Construction priced from income, locked at placement:** three stages, paid when the player can (no timer).

## What changed

| Area | Change |
|---|---|
| Cores | `MergeSystem`: three edge-connected tier-2 machines of a type merge into a core (`state.cores`); all three leave the grid (tiles keep their state). First core merge of each type free, then 20 s of income. Upgrade levels: the highest of each, kept on the core and on the superstructure |
| Placement | `SuperSystem.check/place`: same footprint rules as building (fog, vents, occupied, drone targets, growing tiles); 2×2, Tree of Life 3×3. Placing pays the foundation and uses the core |
| Construction | `project: { stage, costs }`. Stage prices: 30 / 90 / 180 s of steady biomass income (at least 300 / 600 / 900), plus 40 % of the energy store for assembly and 40 % of energy and water for activation; locked at placement and saved. Nothing works until activation (no production, drones, zones or chain reactions) |
| Built | Tier 3 keeps its family's job at output index 18 (three tier 2s = 12): Megaflower ×18 energy, Nexus ×18 water, Tree of Life biomass ×2.5 within 3 tiles, Megahub fleet drones and work radius +4 |
| Abilities | Solar Burst (every panel ×3 energy, 15 s; the strongest solar boost wins, never a product). Irrigation Wave (up to 24 connected dry or growing tiles, nearest first, as one bounded chain). Evolution (the 12 least-grown tiles within 4 grow a stage; stores up to 3 charges). Swarm (6 temporary drones for 30 s, each restoring 3 extra tiles per job, normal pulse costs) |
| Charge | Productive events and real flow, not time alone: restorations within 4 tiles (the Tree of Life also counts tiles growing a stage), plus the structure's own banked production (Megaflower and Nexus only while their store isn't full; ~90 s to fill, Tree of Life ~120 s). Megahub: its own drones' finished jobs (swarm jobs don't count). The ability's own chain never charges anything. Fired by hand; automatic firing unlocks after the first manual use. With nothing to act on it says so and keeps its charge |
| Bounds | Each release returns less charge than it uses; ability chains are budgeted like a Mega Bloom; tested with two Water Nexuses on auto beside each other (they settle, chains end) |
| Presentation | Core slots in the Build tray (with a "✨ n cores" badge on Build); placement ghost and tooltip with every stage price; inspect card with stage checklist and pay button, then the ability's charge bar, Fire and Auto. Models: Megaflower (a giant sunflower whose petals are solar panels, its face tracking the sun), Water Nexus (cream tower, glass dome of water, spinning cyan rings), Tree of Life (a towering radiant tree with real foliage, so it sways and turns see-through over the cursor, glowing orbs), Drone Megahub (cream dome hangar, landing ring, gold mast and dish). Scaffold for foundation and assembly; on activation the structure unfolds with light rings, a sound crescendo and a toast stating the permanent output gain; the first one nudges the camera (not with reduced motion) |
| Advisor | Suggests a stage you can pay, a charged ability to fire, or placing a waiting core (when the foundation is affordable) |
| Saves | `cores`, `project`, `ability` on machines, `stats.supers` / `superAbilities`; no version change |

## Measured (scripted bots, not people)

The merging bot (`tests/bots.ts`, `merges: true`) now also merges tier 2s, places cores (park first, then any
cleared area), saves up for stages and fires abilities, then leaves them on auto. 60 minutes:

| Seed | First core | First superstructure | Built in 60 min | Abilities fired | Steady biomass/min 15 / 30 / 45 min |
|---|---|---|---|---|---|
| 7 | 25:54 | 39:00 | 4 | 3 | 1.03M / 14.5M / 82.5M |
| 21 | 31:12 | 54:12 | 6 | 2 | 740K / 16.0M / 61.5M |

- **Later than the spec's window** (first superstructure at 15–30 minutes): a core needs nine tier-1 machines,
  each priced on lifetime builds, and the bot had to save for the stages. People may be faster or slower.
- **Not a biomass multiplier yet:** Megaflower and Nexus produce energy and water; biomass at 45 minutes was the
  same (seed 7) or lower while saving for stages (seed 21) than merging alone.
- **Abilities fire rarely late in the game:** the Megaflower and Nexus only charge while their store isn't full,
  and finished areas have little left to restore.
- Two bugs this found in my first version: cores never got placed once the park was full (now any cleared area),
  and abilities never charged in finished areas (now they also charge from their own production).

## Tests run (E14)

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run build` | pass |
| Unit tests, file by file (41 files, including the new `super.test.ts` with 11) | pass |
| `tests/e2e/super.e2e.mjs` (new): place a core from the Build tray by mouse, pay assembly and activation from its panel, fire the Solar Burst, then build the other three | pass, no page or console errors |
| picking (74,299 checks), hud-overlap, area-panel, overview, `STRICT=1 phase4-hud`, `phase4-session` (15 min) | pass |
| `tests/e2e/merge.e2e.mjs` | failed once: the old drone was hovering beside the panel and drones have a generous tap radius, so the tap selected the drone's home (the starter panel). The test now moves drones away first; 2 passes. Real-play note: a drone over a machine can take a tap meant for it (unchanged from Phase 4) |
| `npm run test:perf:browser` | within limits: 0 / 1 / 1 hitches, chain ×666 |
| `npm run test:perf` | one timing failure in a busy run, then 4 / 4 on rerun |
| `npm run test:soak` | pass |

# Pacing pass — the merge → superstructure loop

Release gate (`docs/PHASE_5_EPICS.md` §4): before the city expansion that replaces E17, show a satisfying 15–30
minute loop with economy, merge and one superstructure. The E14 audit measured four problems: the first
superstructure came at 39:00 / 54:12 (seeds 7 / 21), superstructures didn't raise biomass, abilities rarely fired
late on, and the first merge (3 → 4) was a modest gain. Every number below is a hypothesis, tuned in
`src/data/tuning.ts` (only in the E13 `merge` and E14 `super` blocks).

**Every timing and rate here comes from scripted bots (`tests/bots.ts`), not people.** The merging bot plans its
merges and acts every 3 s. People will be slower and less systematic. No human playtests were done, so the
"satisfying" part of the gate is still unverified.

## Before and after (bots, 60 minutes)

Measured with `PACING=1 npx vitest run tests/pacing-super.test.ts` (new). It is skipped without `PACING` because
each seed takes 15–45 minutes of wall time. "Steady" biomass is the sustained rate, without Frenzy or other
temporary boosts. The control bot builds the same machines and never merges.

| Seed | Bot | First merge | First core | First superstructure | Built in 60 min | Abilities fired | Steady biomass/min at 15 / 30 / 45 / 60 min |
|---|---|---|---|---|---:|---|---|
| 7 | before (432ba3b) | 2:45 | 25:54 | 39:00 | 4 | 3 (Megaflower 3) | 1.02M / 14.5M / 82.4M / 113M |
| 7 | **after** | 2:45 | 17:48 | **25:24** | 10 | 89 (Megaflower 25, Tree of Life 36, Nexus 28) | 1.05M / **73.4M / 484M / 1.21B** |
| 7 | control, no merges | — | — | — | 0 | 0 | 760K / 9.99M / 39.6M / 39.7M |
| 21 | before (432ba3b) | 2:48 | 31:12 | 54:12 | 6 | 2 (Megaflower 2) | 740K / 15.9M / 61.4M / 167M |
| 21 | **after** | 2:48 | 13:42 | **19:39** | 14 | 138 (Megaflower 71, Tree of Life 39, Nexus 28) | 1.33M / **87.0M / 983M / 2.26B** |
| 21 | control, no merges | — | — | — | 0 | 0 | 961K / 13.2M / 92.8M / 140M |

The control rows came out identical before and after. The "before" rows reproduce the E14 audit's numbers.

- **The first superstructure lands inside 15–30 min on both seeds** (25:24 and 19:39).
- **Biomass clearly rises after it:** ×5 at 30 min and ×6–16 at 45–60 min against the same bot before, and
  ×7–30 against the control.
- **Abilities fire all game:** Nexus and Tree of Life went from 0 to 28–39 releases each.
- **The opening is unchanged:** first merge at 2:45 / 2:48, and biomass at 15 min is within the bots' usual
  spread. The E12 test "keeps something to buy for 30 minutes and never stalls" passes. Ability bounds hold: two
  Water Nexuses on auto beside each other settle and their chains end.

## How each step moved it (bots, 35–40 minute runs, merging bot only)

| Step | First superstructure, seed 7 / 21 | Biomass/min at 30 min, 7 / 21 |
|---|---|---|
| Before | 39:00 / 54:12 | 14.5M / 15.9M |
| Bot builds new tier-1 groups beside a tier 2, plus the biomass bonus, plus flow charge into a full store | 20:54 / never (core at 17:45, stuck) | 65M / 10.3M |
| + drones and the bot leave a pending stage's energy and water alone | 13:39 / 25:30 | 114M / 77.2M |
| + stages 45 / 120 / 240 s, activation water 30 % | 13:54 / 24:09 | 52.2M / 66.1M |
| the same with the **biomass bonus off** (attribution) | 13:54 / 24:09 | 7.38M / 12.2M |
| stages 60 / 180 / 360 s | 15:06 / 25:36 | 91.5M / 65.6M |
| final: + tier 2 = 5, Bloom Garden ×2.25, Tree of Life ×3, tier 3 = 22, exponent 0.5 | 25:24 / 19:39 | 73.4M / 87.0M |

Read these with care: the bots' layouts are chaotic, and a small change moves the first core by several minutes
either way (seed 7: 9:51 with tier 2 = 4, 17:48 with tier 2 = 5).

## What changed

| Problem | Change | Kind |
|---|---|---|
| Slow first core | The merging bot only grew tier-1 groups, so its tier 2s rarely touched and cores came by accident. It now starts and grows groups beside a tier 2 of the same type and anchors the merge there, as a player aiming for a superstructure would. This alone moved seed 7's first core from 25:54 to 9:51 | measurement (bot) |
| A stage stuck waiting for water | Activation needed 40 % of the water store, but drones spend everything above their 25 % reserve, so seed 21 waited 8+ minutes. Drones now leave the cheapest pending stage's energy and water alone (capped at 60 % of the store, like E12's "save up" rule). The bot also keeps them when it buys machines | mechanic (`DroneSystem.payJob`, `SuperSystem.pendingStage`) |
| | `super.stageWaterShare` for activation 0.4 → 0.3 | tuning |
| Too early once unblocked | `super.stageSeconds` 30 / 90 / 180 → 60 / 180 / 360 s of steady biomass income (still locked at placement, no timers) | tuning |
| No biomass gain | Every built superstructure multiplies all biomass, soft-scaled: 1 + `biomassBonus` × n^`biomassExponent` = 1 + 1 × n^0.5 (×2 for the first, ×3 for 4, ×4.7 for 14). It is a fixed factor per structure, not something you can buy in a loop. The "is alive" toast says so | mechanic + tuning (`SuperSystem.biomassMult`, `ProductionSystem.rates`) |
| Abilities idle late in the game | Megaflower and Nexus also charge while their store is full, at `super.fullFlowShare` = 0.5 (since E12 that overflow already charges Frenzy) | mechanic + tuning |
| | With nothing in reach to grow, a Nexus or Tree of Life release pays `super.bountySeconds` = 12 s of steady biomass income instead of keeping its charge (the spec's "defined productive alternative"). Charge comes at a fixed pace, so this is a bounded share of income. The Megahub still keeps its charge. The panel and feed explain the bounty | mechanic + tuning |
| Modest first merge | Tier 2 output index 4 → 5 (`merge.solarMult` / `waterMult`; the preview reads "Output 3 → 5 (+67%)"), Bloom Garden ×2 → ×2.25, Tree of Life ×2.5 → ×3, tier 3 18 → 22 (still about 1.5× three tier 2s). Machine blurbs now take their numbers from `TUNING` | tuning |

Saves are unchanged: no new saved fields, and `SAVE_VERSION` is untouched.

## Risks and still open

- **The curve is steep after the first superstructure.** The bots reach 1.2–2.3B biomass/min at 60 min and build
  10–14 superstructures an hour. That is above the spec's hypothesis (5M at 60 min, 1B at 120 min), which E12 had
  already passed early on. Stage prices follow income, so this limits itself, but the city expansion needs
  balancing against it. Knobs: `super.biomassBonus` and `biomassExponent`, or stage prices that grow with each
  superstructure built (not tried).
- **People don't get the bot's plan.** The bot builds its next tier-1 group beside a tier 2 on purpose. The
  build tooltip now says so too: on a spot touching a tier 2 of the same type, it says "✨ Beside your Solar
  Array: merge 3 Solar Panels here (tap this one) and 3 touching Solar Arrays make a 🌻 Solar Megaflower core".
  It is highlighted once the new tier 2 would be the third (`MergeSystem.tier2Beside`). Whether people follow
  it still needs a human playtest.
- Gate status: the measurable half (bot timings, biomass, abilities) is met. Whether it is "satisfying" needs people.

## Tests run (pacing pass)

Windows 11, sharing the machine with other sessions' test runs, so wall-clock timings are inflated.

| Check | Result |
|---|---|
| `npm run typecheck`, `vite build` | pass |
| `npm test` (42 files, 253 tests) | 249 pass, 2 skipped (the opt-in pacing table). `pacing-city` hit its 300 s per-test timeout under load. Its numbers printed (76 / 82 areas, the same as E12) and seed 7 passed when run alone. Seed 21 took 379.6 s on 432ba3b and 379.8 s on this branch with identical output, so the timeout is machine load, not a regression |
| `tests/super.test.ts` (13: 2 new, for the biomass bonus and for flow charge into a full store; the Nexus test now checks the bounty) and `tests/merge.test.ts` | pass |
| `tests/e2e/super.e2e.mjs`, `tests/e2e/merge.e2e.mjs` | pass, no page or console errors |
| `phase4-session` (`npm run test:session`, 15 minutes in the real page) | pass, no page errors |
