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

# E16 — Living ecosystems and visual differentiation

## Decisions

- **Biodiversity is a readout, not a currency.** It is derived from the world every second and never stored,
  spent or fed into production. Only the fauna unlocks are saved (`state.fauna`, the sim time each kind arrived),
  as an optional field, so **no save version change** (the save-version bump stays with the E13 follow-up).
- **Build on the paused visual overhaul.** Trees stay `TreeGen`/`TreePlacement`/`Foliage`; E16 changes what
  grows around them and how each stage reads. Every new mesh is procedural; nothing uses the untracked `assets/`
  folder. The Meshy hooks are listed in `docs/art/meshy-assets.md`.
- **Extend the existing birds and butterflies** instead of adding second copies.

## What changed

| Area | Change |
|---|---|
| Biodiversity | `gameplay/Ecosystem.ts`: points per restored tile by stage (0.1 / 0.3 / 0.6 / 1 for Restored / Blooming / Thriving / Radiant), per tree species at Blooming+ (12), per ground kind in bloom (6), per landmark woken (25), per finished superstructure (60) and per fauna kind (15). Ranks Barren → Sprouting → Lively → Flourishing → Teeming → Abundant → Paradise. Counted per chunk, only chunks touched since the last pass, at most once a second; saved chunks not loaded yet are estimated from their packed data a few per pass. All weights in `TUNING.ecosystem` |
| Fauna unlocks | Butterflies at 10 Blooming+ tiles, songbirds at 20 Thriving+ tree tiles, koi when the park fountain flows (or 4 restored water tiles), garden robots with the first finished superstructure. Each fires once (`fauna.unlocked`), survives save/load, and stays if its condition later lapses. All four thresholds are reachable on current maps (bot timings below), so none were changed |
| Showing it | A 🌱 chip in the objective panel's tool row (icon only at 360 px and narrower, so the objective keeps its count); tapping it shows the breakdown, the creatures living here and what the next one needs, as a toast. An arrival toast and a small bounce on the chip when a kind arrives. Nothing blocks or pauses |
| Fauna actors | `rendering/Fauna.ts` (koi, garden robots, songbirds on the lawns, sleeping cats, fireflies) and `FaunaPlan.ts` (pure planning, unit-tested). Pooled (made once, parked at scale 0), one dynamic batch per kind, at most `TUNING.ecosystem.caps[high/low]` of each near the camera target. Routes are seeded (hash of seed, actor, leg; no `Math.random`). They read the sim and never write it. Picking is plane maths, so no actor can take a tap |
| Butterflies (existing) | Now arrive with their unlock, use seeded routes, follow the bloom near the view (they used to look only at rooftop layers, so the city park rarely had any), gather their tiles once a second instead of every frame, and respect the quality cap |
| Birds (existing) | The Phase 4 flocks keep flying from park stage 2; once songbirds arrive, flocks pass about twice as often and songbirds hop and peck on blooming lawns |
| Koi pond | Once koi arrive, the flowing fountain's basin fills to the brim with lily pads (its rim used to hide the water) and four koi circle in it; more swim restored canal tiles |
| Sleeping cats | A seeded 30 % of finished machines on restored ground in view (at most 6) have a cat curled on the camera-facing corner of the machine's own footprint: lying down, grey tabby / ginger / black-and-white, no collar, coin or raised paw, about half a Lucky Cat's height, not tappable. A footprint cell can never hold a Lucky Cat anchor (anchors need a free tile), and spots within 0.75 tiles of any park anchor, possible city nook or the active cat are skipped (tested) |
| Tile stages | Restored: pale young grass, short tufts. Blooming: fresh green with two tight one-colour flower clusters. Thriving: deep green with a tree, or a seeded mix of shrubs (62 %), tall flower spikes (20 %) and mossy rocks with a fern (18 %). Radiant: gold glow and luminous flowers (Phase 4). The far level of detail keeps them apart too (a colour patch for Blooming, a gold disc for Radiant). Everything stays inside the tile and low, so the grid and the dead/restored contrast still read |
| Edges and borders | Restored lawn meeting restored paving gets a trimmed darker edge; the paving gets a raised white border on that side |
| Local landmarks | In each cleared chunk outside the park, one obstacle (seeded) becomes a small landmark by area type: flower arch, ivy statue, topiary, lantern post with a hanging basket, spouting basin or mushroom ring. Obstacles get a restored look once their area clears (flower-capped bollards, ivy pillars, produce on stalls, mossy stumps with mushrooms). Only obstacle cells, never build cells |
| Machines | Idle animation as before; active effects only while a machine really runs (`FaunaPlan.machineRunning`): panels and condensers while their store isn't full, hubs while a drone is out, superstructures once built. A running machine in view gives off a small rising wisp every 2–4 s (pooled particles, at most 5 a second across the view, 2 with "Fewer particles", none with reduced motion); a condenser's water bobs and a hub's ring turns only while working |
| Fireflies | Settings → "Fireflies" (off by default): pooled fireflies drift over Thriving and Radiant tiles near the view. Emissive material, so the lighting epic's bloom will pick them up. Ambience only; off with high contrast and with reduced motion. **Scope change:** an earlier version of this branch also warmed the sun, ambient and haze for a "warm dusk"; that was removed because scene lighting, grading and post-processing belong to the Look 1 lighting epic (#103) |
| Quality tiers | Fauna caps are plain numbers per tier in `TUNING.ecosystem.caps` (`low` / `medium` / `high`). E16 builds no tier selector or detection: `Game.faunaTier` is the hook the lighting epic's graphics-tier setting will set; until then "Fewer particles" means low (also fewer wisps) and everything else high. Reduced motion: fauna rest in place. Debug overlay (F3) shows fauna counts and the score |

## Measured (scripted bots, not people)

When each kind arrived (sim time), with the bots in `tests/bots.ts`:

| Seed | Bot | Butterflies | Koi | Songbirds | Robots | Score at 15 / 30 / 45 min |
|---|---|---|---|---|---|---|
| 7 | active, 30 min (the unit test) | 3:30 | 5:34 | 28:00 | — | |
| 7 | merging, 60 min | 3:35 | 5:04 | 6:42 | 40:01 | 915 / 4,150 / 9,038 |
| 21 | merging, 60 min | 3:19 | 5:04 | 8:04 | 54:12 | 1,039 / 4,492 / 8,064 |
| 21 | active (no merging), 60 min | 3:37 | 5:13 | 18:05 | — | 628 / 1,395 / 2,054 |

- Koi follow the fountain within a second; songbirds depend on how many gardens push tree tiles to Thriving
  (7–28 minutes); robots come with the first superstructure (E14 measured 39–54 minutes).
- The rank ladder was first steeper (Teeming by 15 minutes); it now reaches Flourishing around 15 minutes,
  Teeming around 30 and Abundant around 45 for the merging bot.

## Performance (headless Chromium, SwiftShader software rendering; not a real device)

`npm run test:perf:browser` (150-area city, ~790 machines), on this Windows laptop **while two or three other
sessions ran their own test suites and e2e scripts on the same machine**. Under that load the per-frame update
times swing several-fold between identical runs (main's own HEAD ranged from 11 to 136 ms median on zoom), so treat
them as noise-dominated. Draw calls, page errors and the chain size are the comparable parts. "Before" is main at
`432ba3b`, built from a clean checkout; runs listed in the order they ran.

| Run | Pan update median / hitches | Zoom update median / hitches | Chain update median / hitches | Draw calls pan / zoom / chain (median) | Catch-up worst frame | Chain |
|---|---|---|---|---|---|---|
| before #1 | 256.1 ms / 100 | 11.4 ms / 17 | 13.6 ms / 25 | 237 / 222 / 348 | 376.9 ms | ×715 |
| before #2 | 128.7 ms / 76 | 135.7 ms / 72 | 11.7 ms / 16 | 224 / 228 / 242 | 11.1 ms | ×637 |
| E16 #1 (bug, see below) | 62.8 ms / 60 | 200.8 ms / 79 | 120.7 ms / 80 | 217 / 207 / 225 | 378.6 ms | ×524 |
| E16 #2 (fixed) | 269.5 ms / 106 | 226.2 ms / 82 | 138.3 ms / 92 | 213 / 212 / 274 | 470.4 ms | ×576 |
| before #3 | 13.8 ms / 15 | 10.0 ms / 4 | 31.2 ms / 72 | 217 / 214 / 268 | 13.2 ms | ×679 |
| **E16 #3 (final)** | **13.9 ms / 7** | **12.9 ms / 14** | **3.3 ms / 1** | **229 / 208 / 265** | **10.4 ms** | ×633 |
| before #4 | 12.9 ms / 24 | 135.5 ms / 78 | 38.1 ms / 71 | 229 / 240 / 221 | 447.5 ms | ×583 |

- **Draw calls are unchanged** within run-to-run variation (all under the 400 budget): fauna are one dynamic batch
  per kind, decoration is merged into the existing chunk meshes, the koi pond is one entity.
- **Every run, before and after, failed some timing gates on this machine** (the harness's limits are set for a
  4-core cloud container). The final E16 run failed only zoom hitches (14 > 6) and two autosave steps (encode
  32 ms, write 90 ms), which E16 doesn't touch (before #1 showed the same 90 ms write).
- **Bug found by the first E16 run:** a restored bollard's flower colour used `(x + z) % 5`, which is negative west
  or north of the park, so building that chunk threw every frame (3 page errors, and the frame times of that run).
  Fixed with a positive modulo; no page errors since.
- **Ecosystem cost, measured in Node on the same 150-area city:** the first full count 25.7 ms (once); after a
  reload the first pass 1.7 ms, then 0.44 ms median and 3.7 ms worst per pass (once a second of sim time), with
  saved chunks estimated 2 per pass (6 per pass peaked at 17 ms). 300 s of catch-up simulation: 164 ms in total.
- Not measured: memory, and anything on a phone. The decoration adds geometry to restored chunks (roughly 1.3–1.7×
  primitives on Blooming-heavy chunks before the cluster trim); the chunk rebuild budget (6 ms, nearest first) is
  unchanged.

## Tests run (E16)

On this branch, Windows 11 laptop, headless Chromium with SwiftShader for the browser checks, with other
sessions' test runs sharing the machine.

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `tests/ecosystem.test.ts` (new, 13 tests): score derivation and ranks; score follows the world and is equal after save/load; butterflies at exactly 10, birds at exactly 20 (and the park alone has enough tree tiles); koi with the fountain; robots only with a finished superstructure; each unlock fires once, stays when its condition lapses, survives save/load without a second event; unlocking and counting change no resources, tiles, machines or stats; seeded wander routes; sleeping cats inside footprints and ≥ 0.75 tiles from every Lucky Cat place, within the cap; planning fauna for 300 frames changes nothing; the fauna sources contain no economy, event or state-writing calls; active effects only while a machine runs; a 30-minute bot session reaches butterflies, birds and koi | pass |
| `npm test` (full, 42 files, 262 tests) | first run: 260 pass, 2 fail. `sim-scale` "no full sweeps" caught my first recount, which walked every loaded chunk each pass (fixed: only touched chunks); `drones-city` "far drones within 5 %" passed on rerun (it took 7.4 s under load, 0.8 s alone). Final run: 252 pass, 10 fail, all timeouts (eight at the 5 s default, two at 300 s) while several sessions shared the CPU |
| The ten timed-out tests, rerun by file with a longer timeout, plus the quick set a teammate session recommends for this shared machine (26 files, 162 tests) | pass, except `save.test.ts` "first session reaches the core", which hit its own 30 s limit (33 s) in that run and passed alone (5 / 5) |
| `tests/pacing.test.ts`, `tests/pacing-city.test.ts` (rerun alone) | `pacing.test.ts` passes. The two `pacing-city` tests exceeded their own 300 s limit under load (368 s and 329 s) but printed the same results as the passing first full run: 76 / 82 areas in 60 min, stuck 0 s. Not rerun further |
| `tests/e2e/picking.e2e.mjs` (now also: with every creature unlocked, taps on each actor's screen spot pick the tile underneath, and a real click on a songbird nurtures its lawn) | pass, 74,326 checks (was 74,299) |
| `STRICT=1 phase4-hud` (`npm run test:hud`) | pass, no overlaps at 320–430 px, landscape, tablet, desktop |
| `phase4-session` (`npm run test:session`, 15 min in the real page) | pass, no page errors (run before the bollard fix; that chunk is outside the park) |
| `tests/e2e/ecosystem-shots.mjs` (new) | no page or console errors; screenshots in `docs/review/e16-*.png`: the four stages one at a time (`e16-stage-1…4`), all four side by side at gameplay zoom and zoomed out (`e16-stages-mixed`, `e16-stages-far`), fauna at gameplay zoom (`e16-fauna`, `e16-fountain-koi`), close-ups (`e16-near-robots`, `-cats`, `-groundBirds`) and fireflies (`e16-fireflies`) |
| `npm run test:perf:browser` | see the table above |
| After the lighting scope change (dusk light removed, fireflies-only toggle, medium tier): `npm run typecheck`; the quick set (`grid`, `big`, `world`, `economy`, `placement`, `save-storage`, `save-v4`, `area-switches`, `area-panel`, `upgrades-city`, `feedback-phase4`, `playtest-metrics`, `canal-network`, `district-bloom`, `rooftop-clusters`, `relay-city`, `specialties-city`) plus `ecosystem.test.ts` (now 14 tests, with a tier-caps check); `ecosystem-shots.mjs` | pass (18 files, 97 tests); shots without page or console errors. The full suite was not rerun (it times out on this shared machine) |

## Still open after E16

- **No human playtests and no real-device measurements.** Whether the stages read at a glance, and whether the
  fauna feel alive rather than busy, needs people and phones.
- Fauna are small at gameplay zoom (songbirds and cats are easiest to see closer in); the koi pond and the
  arrival toasts carry the unlocks at gameplay zoom. Real models (Meshy, pending review) should help.
- On a 320 px phone the objective title has a little less room (the 🌱 chip is icon-only there).
- Robots arrive late because superstructures do (E14).
- Persisted field `fauna` is optional and needs no migration, but should be listed in the save fixtures when the
  save version is bumped by the E13 follow-up.
