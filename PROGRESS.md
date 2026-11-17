# Solarbloom: progress

Moved out of the `azzaisme/mouthwash-brigade` repo (where it started in a `solarbloom/` folder) with its full history.

# E20: One game — bloombot first (#283)

Direction audit, 17 Nov 2026: Solarbloom is a cozy restoration game where bloombot does the work; the idle engine stays underneath as bloombot's helpers.

| Story | Status |
|---|---|
| E20.1 The Lucky Cat hides (#284) | ✅ never placed in view (on screen within 12 tiles of bloombot) or within 6 tiles of it; a spot within a 40-tile walk is preferred; no stash (an old save's stash is paid once); the 🐾 chip names a direction and a landmark instead of flying the camera; Scouts no longer hint cats |
| E20.2 Speak bloombot (#285) | ✅ hints, toasts, tooltips, the intro and tutorial say walk up and press the bound key (pad or keyboard, from `Bindings`); `tests/bloombot-words.test.ts` fails on tap or click wording |
| E20.3 Walking pacing bot (#286) | ✅ `npm run bot:walk`: the active bot's decisions, but every ground action walks there first (`Walker.path`, sprint over 8 cells). Numbers below |

E20.3, 30 minutes, the same decisions with and without walking (`npm run bot:walk`). "By bloombot" counts the player's own pulses (chains, drones, machines and events are helpers):

| Seed | Play | Hub | Fountain | First area | Tiles | By bloombot | By helpers | Walking |
|---|---|---|---|---|---|---|---|---|
| 7 | cursor | 1:18 | 5:09 | 6:30 | 6,691 | 78% | 22% | — |
| 7 | walking | 1:33 | 6:42 | 7:36 | 4,442 | 82% | 18% | 18:30 (395 trips) |
| 21 | cursor | 1:18 | 5:27 | 6:45 | 6,123 | 80% | 20% | — |
| 21 | walking | 1:30 | 5:21 | 6:48 | 4,598 | 76% | 24% | 18:41 (441 trips) |

Reading: walking barely moves the early milestones (hub +12–15 s, fountain −6 s to +1:33) but costs about a third of the tiles by 30 minutes, because bloombot spends ~60% of its time walking. The player already does most of the restoring, so E20.4 (helpers around bloombot) is not urgent; the owner decides.

# Phase 5: Ecological Overdrive

Plan: `docs/PHASE_5_EPICS.md`. Decisions, audit and results: `docs/PHASE_5_AUDIT.md`. Timings are from scripted bots, not people.

| Epic | Status |
|---|---|
| E12 Economy scaling | ✅ big numbers everywhere (`break_infinity.js`, K/M/B/T… display, saves as strings, save v5), uncapped biomass (Seed Vault grows energy and water only), net income in the HUD with a tap-for-breakdown (producing / spending / lost to full storage), spec overflow rule for Frenzy (share of income wasted, ≤ 0.15/s; Harvest into a full store never counts) plus charge from automation growth, per-machine upgrades with "Upgrade all" (cheapest first), long-tail Solar Wings and Rich Soil, Harvest Burst and Chain Hops, next purchase with time-to-afford, rewarded 25/50/75 % steps in every city area, no specialty stall once an area is fully restored, no impossible machine prices. Bots: always something to buy for 30 min (Phase 4: nothing after ~5 min); city 76 / 82 areas an hour with the player still starting most big chains |
| E13 Machine merging | ✅ three edge-connected same-type machines merge into a tier 2 (Solar Array, Condenser Array, Bloom Garden, Fleet Hub: stronger plus reach), preview with partners, fee, output and levels kept or lost, atomic commit, first merge of each type free, prices count lifetime builds, merge animation and tier-2 models, advisor and build-tooltip guidance. Bots: +21–35 % steady biomass at 30 min against the same build without merging |
| E14 Superstructures | ✅ three tier 2s merge into a Superstructure Core placed like a building, three paid stages priced from income and locked at placement, tier 3 output ×18 plus an ability (Solar Burst, Irrigation Wave, Evolution, Swarm) charged by play, manual then automatic, four landmark models with scaffolding and an unfolding reveal. Bots: first superstructure at 25:24 / 19:39 after the pacing pass (was 39–54 min), steady biomass ×5 at 30 min and ×6–16 at 45–60 min against the same bot before; build tooltip points the way to a core |
| E15 World events | ✅ seeded scheduler in sim time (first 3–6 active min after the first Drone Hub, then every 3–6 min; own saved random stream; one at a time; pause/reload safe), Solar Supernova (solar ×10, 20 s), Great Migration (up to 20 tiles a stage, 15 s), Super Rain (water ×3, 3 irrigation waves of ≤12 tiles, 25 s), Lucky Cat Invasion (up to 3 extra cats that stay until found); one stacking policy in `Modifiers` (same category strongest, across categories product capped at 20×, applied once to the baseline); nothing eligible → a stated income fallback, never "0 tiles"; Golden / Rainbow cats (80/18/2, crown / halo, named in the toast), stable cat ids with claim-once, capped rewards, cats never behind buildings or superstructures, paw-print hints (🐾 chip, inspect); small non-blocking banner with timer; `sbDev.event()` / `sbDev.cat()`; save v6 (older saves scrapped, as agreed). Bot numbers in `docs/PHASE_5_AUDIT.md` (bots, not people) |
| E16 Living ecosystems | ✅ biodiversity score (derived from tile stages, tree species and ground kinds in bloom, landmarks, superstructures and fauna; never spent) with a 🌱 chip and breakdown; one-time fauna unlocks saved with the game (butterflies at 10 blooming tiles, songbirds at 20 thriving tree tiles, koi when the fountain flows, garden robots with the first superstructure) and an arrival toast; pooled, seeded, capped koi, robots, songbirds, sleeping cats (inside machine footprints, never where a Lucky Cat can sit) and dusk fireflies that never take a tap or grant anything; stage-distinct ground (pale Restored, flower clusters for Blooming, lush mixes for Thriving, gold Radiant), lawn edges, white path borders, mossy rocks, local landmarks on obstacle cells; machine wisps only while they really run; optional fireflies; fauna caps per low/medium/high tier for the lighting epic's tier setting. Bots: butterflies ~3:30, koi ~5 min (with the fountain), songbirds 7–28 min, robots 40–54 min (with the first superstructure) |
| E17 | replaced (agreed): park → suburbs → skyscrapers in the endless city, houses and towers solarpunkified as staged projects, after the E12–E16 gate |
| E18 Drone roles | 🟡 per-hub roles picked in the hub panel: Restorer (default, unchanged), 🌱 Gardener (grows tiles for water), 🔭 Scout (fast, longer reach, pushes the fog, early Lucky Cat paw prints), 📦 Courier (feeds Mother Trees, panels, condensers and relays), ✨ Spark and 🧺 Harvester (P1); refits paid once per hub, owned roles switch free; Fleet Hub second slot and per-drone Megahub roles on merge; role parts, eyes, beams and chirps; one advisor hint per role; drone upgrades priced in biomass plus energy or water (E18.7). Restorer-only saves hash identically to before. Bots (`docs/E18_AUDIT.md`): drones wait for energy 50–74 % of the time (was 88–93 %), every P0 role chosen by 8:09. Open: hands-off share still 15–31 % (target 40–60 %); city seed 7 has automation ahead on big chains (3 of 4 seeds fine); role shapes at gameplay zoom and the floating role icon |

# Phase 4: Dopamine Overdrive

Plan: `docs/PHASE_4_EPICS.md`. Audit, baseline and results: `docs/PHASE_4_AUDIT.md`. Timings are from scripted bots, not people.

| Epic | Status |
|---|---|
| E00 Audit, instrumentation, baseline | ✅ audit, bot baseline (active + hands-off), local event log, dev-only debug tools, phone HUD check |
| E01 Economy rescue and overflow | ✅ fountain purchases fit starting stores, storage tiers, old drone, hub at ~2 min, drone reserve, offline progress (4 h, half rate), Solar Surge rename, HUD spending/boosts. Open: hands-off reaches 22–26% of active (target 40–60%, E07); overflow feeds Frenzy in E06 |
| E02 Mobile-first interface | ✅ five-button hotbar (Inspect · Build · Pulse · Harvest · Upgrades) with a Build tray at every size, compact resource strip and one-line objective on phones and short landscape screens, one-line live hints, SVG icons for resources and tools, upgrade dot instead of a count, B / Esc for the tray, `npm run test:hud` (no overlaps at 320–430 px, landscape, tablet, desktop; HUD covers 34% at 320 px, was 50%) |
| E03 Restoration feedback | ✅ hover preview of the exact pulse footprint and its cost (tested to match the real pulse), quick rings for nurture and Wide Pulse taps, separate sound/music volume sliders, high-contrast setting. Already in place and kept: restore rings and bursts, pooled flying numbers capped at 8, rising chain notes, chain summary, soft failure feedback, reduced motion |
| E04 Power progression | ✅ Pulse Reach tiers (Seed 1 → Sprout 9 → Bloom 25 → Grove 69 → Radiant 161 tiles, Euclidean on the grid; Overcharge reaches a tier further), rewarded park milestones at 5/10/20/35/50/75/100/130 tiles (paid once, save-safe, no windfall for older saves), six levels of Solar Array and Rich Soil, first Lucky Cat at ~3–4 min. Bot: fountain 4:21–4:42, city 50–60 areas/hour (was ~25) |
| E05 Evolving tiles | ✅ a fifth stage: Radiant (bloom 4) above Thriving/full bloom, production weights 0/1/2/4/8, golden Radiant look in both renderers, goals still count full bloom (Radiant included), drones finish tiles to full bloom first. Fountain now costs 100 🌿 only (an energy price could never fill once Radiant gave taps and drones endless work); the advisor saves up for fountain machines and points at green tiles when full blooms are missing |
| E06 Bloom Frenzy | ✅ 0–100 meter from taps, chains, automation and capped overflow; waits until fired (button above the hotbar, Q); 15 s of +2 pulse tiers, biomass ×10, drones ×3; central `Modifiers` (strongest boost per stat); golden vignette and faster music; save/pause/reload safe; never charges offline or while ready/active. Bots: first Frenzy 3:48–4:00, 3–4 in 15 min |
| E07 Automation | ✅ Drone Dash ×1.5/×2/×3, Work Radius +2 per level, Drone Squad (every hub +1/+2 drones), Drone Sweep (each drone restore also restores 2/4 tiles around it), drone tile lists and networks cached and own reach searched first (30-min city run 36 s → 13 s). Hands-off 30–36% of active (was 13–27%) |
| E08 Lucky Cat | ✅ first cat ~3–4 min, then every 3–5 min of active play; Lucky Harvest = 30–60 s of sustained income (no Frenzy ×10), floor 15, age bonus; overflow named in the reward; composes with Frenzy. Existing: claim-once, no expiry, stash for missed cats, seeded rewards, save-safe. Not done: golden flowers / butterflies as extra discoveries (optional) |
| E09 Art | ✅ upgrades change every machine's silhouette (Solar Array wing array, Water Bloom tanks and mist, Drone Hub pads / sweeper arms / mast and dish / antennas, Rich Soil and Pollinator Reach blooms, Mother Tree canopy and gold lanterns, Relay Lens rings), sun-tracking solar panels, birds crossing a lively park, distinct old drone, drone trim by Drone Dash, Radiant tiles, Frenzy vignette; before/after and machine screenshots (`npm run shots:phase4`). Not done: connected tile edges, new lighting grade |
| E10 First 15 minutes | ✅ no blocking welcome card (first tap works at once, a short welcome toast), the fountain fills Bloom Frenzy, pacing table from bots (first upgrade 0:21 for an eager buyer, hub 1:15–1:18, fountain 4:12–4:24, 4–5 Frenzies in 15 min); hands-off now 28–46% of active |
| E11 Validation | ✅ 15-minute in-browser session with no page errors (`npm run test:session`, in CI) after fixing two real crashes it found (stale Solar Array panels; the objective's build button hijacking the hotbar lookup); all unit, soak, benchmark, picking (69,445 checks), HUD and browser-perf checks pass; accessibility: reduced motion, separate sound/music volumes, high contrast, keyboard (B, Q, U, H, P, Esc). Not done: real-device numbers, human playtests, the 12-minute leak test |

# City scale (epic #1)

The game is growing into an endless, fog-covered city (see issue #1 and its sub-epics).

| Sub-epic | Status |
|---|---|
| #2 City 01: endless chunked world model | ✅ (height layers and multi-layer picking ✅ #20) |
| #3 City 02: save format v4 (old saves scrapped, sparse deltas) | ✅ |
| #4 City 03: areas and the fog | ✅ (simulation; fog visuals are #8) |
| #5 City 04: endless city generator | ✅ except the visual review (#37, needs ground rendering) |
| #6 City 05: the dilapidated park | ✅ layout, onboarding, fountain finale, pacing, cat nooks park art stages ✅ (#39: `docs/review/park-stage-0/2/4.png`) (open: nook screenshots) |
| #8 City 07: rendering | first pass ✅ chunk streaming, merged chunk meshes, fog machine batching ✅ (#53), procedural buildings ✅ (#54: `docs/city-overview.png`, `docs/city-near.png`) (open: device numbers #56) |
| #7 City 06: simulation at city scale | ✅ active-region ticking ✅ (#44: 0.107 ms per tick with 1,046 areas and 5 active chunks) frame budget and catch-up ✅ (#48) |
| #10 City 09: endless progression | ✅ storage, area bonuses, machine permits, endless pacing bot no-stall guarantees ✅ (an advisor-only bot progresses from empty pockets: fountain in 22.7 min, next area with the park packed and broke in 14.3 min) playtest timings ✅ (time to each area, areas per hour, biggest chain, cats, stuck time; Copy button) upgrade tree for scale ✅ (Lit Landmarks; every upgrade has an effect test and sparkles the spots it changes) area milestone generator ✅ (#62: one specialty action per area type) |
| #9 City 08: camera and overview | ✅ bounds, zoom-out to 0.22 with far level of detail, area labels, F / Home overview mode ✅ (labels show fog progress, 🔗 active chains and 🐱 cat finds; one tap flies to an area and opens its panel — e2e) phone gestures ✅ (a quick pinch-out snaps to the overview; picking e2e at 390×844 at both zoom limits) |
| #11 City 10: massive blooms | ✅ chains across areas, green corridors, city chain caps, area summaries district blooms ✅ (#75) canal water network ✅ (#71) buildable relays ✅ (#72) huge-chain presentation built (#74: waits on a real-phone recording) |
| #14 City 13: Lucky Cat in the city | ✅ generated nooks, spawn rules, Fog Whisker and Golden Corridor (scaled with the city, capped: a cat never wakes an area alone), discovery log grouped by area type (`docs/discoveries-500-areas.png`) |
| #12 City 11: automation at scale | ✅ drone networks, fog-edge priority, 50-hub safety soak Mega Pulse and scaled Overcharge ✅ (the city bot's own taps start 18–19 big chains an hour vs 2–4 by automation) area automation switches ✅ (Keep blooming, Focus the frontier, Leave alone; saved) far drones by the clock ✅ (#79) |
| #13 City 12: Phase 3 content in the city | ✅ specialties on generic landmarks (grove Elder Trees, reservoir/canal Reservoir Gardens), cat rewards on areas rooftop cluster areas ✅ (#82) fixed rooftop data removed ✅ (#85) |
| #15 City 14: HUD | toast cap ✅, upgrades drawer grouped by system ✅, area panel ✅ (from landmarks and overview labels) (Networks: Green Corridors, Drone Mesh; Fog: Fog Lanterns) (open: phone pass #95, objective panel #91) |
| #16 City 15: proof | headless soak ✅ (`npm run test:soak`), browser perf ✅ (`npm run test:perf:browser`), CI workflow ✅ leak test ✅ (`npm run test:leak`), docs ✅ (open: device log #99) |

## City 01: world model

- `Grid` is the world: a set of layers (the unbounded ground `g`, and each rooftop as a bounded raised layer), each made of 16×16 chunks generated on first touch. Tile ids stay `layer:x:z`.
- Generation is a pure function of `(seed, layer, x, z)` (a hash, not the game RNG), so the world is identical whatever order chunks are visited in.
- `tilesNear`, `tilesInRange`, `tilesWithin`, `neighbors` and `machinesNear` (a per-chunk machine index) cost the same in a 64-tile world and a 512k-tile one. Every per-tick "what's nearby" scan in the systems now goes through them; growing tiles are tracked in a set instead of scanning tiles each tick.
- Adjacency never crosses layers. The ground exists but stays unplayable until the park (City 05).
- Height layers (#20): `core/Picking.ts` `pickLayers` casts the pointer ray against every pickable layer's plane (height + slab top; raised layers only inside their footprint) and returns the nearest hit; `Game.pick` uses it. Tests cover a roof directly above the ground (never neighbours, in either direction), overlapping and stacked layers, slanted camera rays, locked and preview layers. The browser picking e2e still passes (69k checks).
- `GameState` no longer holds tiles (`rooftops` is gone; `layers` describes the surfaces). Occupancy is rebuilt from the machine list.

## City 03: areas and the fog

- `core/Areas.ts`: the city ground is split into areas of whole chunks (a seeded jittered Voronoi over 2×2-chunk super-cells, one or two seeds each; the park is always chunk (0, 0)). Shapes, neighbours and landmark spots are a pure function of the seed, so they are never saved. Areas average about 2–3 chunks.
- `gameplay/AreaSystem.ts`: fog per area (hidden → frontier → thinning → cleared), saved in `state.areas`.
  - Hidden tiles can never change. In a frontier area only tiles touching clear ground (a cleared area or any restored tile) can be restored, so the fog recedes tile by tile. The park is home: no edge rule.
  - Restoring `clearShare` (60%) of an area lets its landmark (a 2×2 Core placed when the area is revealed) be woken: the area clears, once, and its hidden neighbours become frontier.
  - Every revealed area is guaranteed a way in: if obstacles wall off its edge, one is cleared and saved (`unblocked`).
  - Pulses, drones, chains and building all go through the same rules.
- Tests: partition coverage and symmetry, order independence, every transition, reveal ring, tile-by-tile recession, save round trip, and a soak clearing 500 areas in random order with no unreachable frontier.

## City 04: the endless city generator

- `data/city.ts`: seven area types (parkland, street, plaza, canal, market, reservoir, grove) with their ground material, obstacle share, landmark, and weights per district theme (old town, docks, towers, parkland).
- District themes are coarse 6×6-chunk regions. A type is a weighted pick from the theme, re-rolled once if it would match its first neighbour (order-independent, depth-limited).
- A road network (35% of chunk rows/columns, two tiles wide) and canals (12%, plus every canal area) run through the city. They restore into green avenues and clean water, so they never wall anything off. Small obstacles never sit within 2 tiles of a landmark.
- Authored landmarks (Great Greenhouse at 6 chunks, Solar Cathedral at 12, Sky Observatory at 20, then one every 10 chunks) sit in a seeded direction at their distance.
- Difficulty grows with distance: pulse cost ×(1 + 0.04/chunk, max ×2) and a rising pollution floor (max 85).
- Tests: skeleton determinism, themes, every type's ground/obstacles/landmark clearance, authored landmarks for 10 seeds, difficulty caps, and a 500+-area variety soak (under 30% same-type neighbours; every type within 12 chunks of the park).

## Look 4: camera and composition (#106)

- The camera is a perspective view that changes with the zoom (`VIEW` in `CameraController.ts`): the overview (≤ 0.45) is high and narrow (42°, 12° lens) and reads like the old isometric grid; the default zoom is a close three-quarter view (24°, 52°) with the skyline across the top; zooming in lowers it further (19°, 56°) until the sky shows. Yaw stays 45°.
- Pan keeps the ground under the finger (raycast at the old and new pointer positions); wheel and pinch zoom toward the cursor or pinch centre; player pans keep the visible ground edges within the bounds plus `edgeSlack`, while glides may centre anywhere inside them (`tests/e2e/camera.e2e.mjs`).
- World-anchored UI uses `CameraController.onScreen()`: nothing behind the camera or past the haze; area labels scale with distance close up.
- Sky (`rendering/Sky.ts`): dome, sun along the key light, soft drifting clouds; grey while the city is fogged and clearer as areas wake. The scene fog colour is the sky's horizon colour, so the ground fades into the sky. Skyline (`rendering/Skyline.ts`): three rings of terraced towers with hanging gardens, bridges, domes and scrolling waterfalls, haze baked in, 5 draw calls. All colours in `data/sky.ts` for Look 1 to grade.
- Height: the early city (park, then suburbs) is at street level. Unrevealed areas are drawn a step lower (`SINK` 0.45) so revealed ground has a stone kerb at its edge; `Game.pick` follows rays down to the lower ground. A drop of 2 or more draws a window-and-balcony facade instead (kept for the skyscraper stage). Fog-of-war has soft vertical curtains at its edges.
- Streaming loads chunks near the view's ground trapezoid, capped where the haze is complete; far chunks close up use the far level of detail.
- Screenshots: `node tests/e2e/camera-shots.mjs docs/review/look4 <prefix>` (desktop and phone at every zoom band); before and after in `docs/review/look4`.

## City 11: drone networks

- Far drones (#79): the game tells `DroneSystem.focus` where the camera is. A drone whose hub is outside the view (plus a margin) flies by the clock: its job's arrival time is computed once (same distance ÷ speed, so the same arrival tick) and nothing moves per tick. `worldOf` interpolates the line it would fly, and when the camera arrives mid-flight the drone carries on from that point for real, so nothing teleports. Reservations are a maintained set (findJob used to scan every drone for every tile it considered), and hub top-ups count drones per hub once per tick. Tests: 8 hubs over 10 minutes far vs full (drone jobs and tiles restored within 5%), the camera arriving mid-flight moves a drone at most one tick's flight, and no two drones ever share a target.

- In the city, Drone Hubs within 12 tiles of each other (transitively) form a network, and an idle drone takes work anywhere within the network's combined reach. Rooftop hubs keep to their own range.
- Drones prefer restoring tiles at the fog's edge (a frontier tile next to clear ground), so automation pushes the fog back on its own.
- Tests: linked hubs share work, distant hubs don't, edge preference, and 50 hubs for 60 s never targeting hidden, blocked, finished or double-booked tiles.

## City 13: the Lucky Cat in an endless city

- Besides the park's five nooks, every cleared area offers up to three generated nooks: a free tile of that area beside one of its obstacles (bench, stall, pillar…), hint "beside a broken stall". Only the 12 most recently cleared areas are considered, so the cat stays near where the player has been; nooks are never in fog. Nook ids (`nook:x:z`) resolve from the world, so a hiding cat survives a reload.
- New reward, **Fog Whisker**: up to 10 tiles of the next fogged area restored outward from its edge (each opens the next, so the fog's rules hold). Only offered once the fountain is awake and there is fog to thin.
- Tests: nook validity, 200 spawns in a 40-area city (all valid, one at a time, never in fog), reload in a city nook with a single payout, Fog Whisker order and cap.

## City 10: massive blooming systems

- Chains follow plain adjacency across area borders on the ground and stop at hidden fog (fog-edge rules apply to every chain effect).
- Green corridors: a Pollinator Garden standing on a street or path passes its chain to every other corridor garden within 6 tiles (once per garden per chain), which blooms a spot beside it and sets it off in turn. Lines of street gardens carry a bloom right across the city.
- City chains may run up to 500 events and travel for 20 s before the rest resolves at once (rooftop chains keep 100 / 6 s).
- Chain results report how many areas they swept: a feed line from 3 areas, a toast from 6.
- Tests: crossing borders and stopping at fog, a 10-garden corridor end to end (deterministic, once per garden), and a ×200+ chain sweeping 12+ areas that terminates and pays once.

## City 09.1: area milestone generator

- `gameplay/Milestones.ts`: each landmark asks for its restored share **and** one specialty action for its type (`TUNING.milestones`): parkland grows tiles to full bloom, streets pass a chain along a green corridor, plazas boost a Solar Panel with blooms, canals send water along the canal, markets set off a ×N chain, reservoirs overflow a Reservoir Garden, groves release a Canopy Burst. Sizes are base + perChunk × distance, capped; share-sized ones (full bloom, chain) are also capped by the area's restorable tiles, so machines can't put them out of reach.
- The generator checks the area's own layout (a garden spot with a condenser spot, two paved spots, an Elder Tree with room, a canal plan: the shortest stretch of the area's own water whose banks are out of the condenser's own reach). Unsupported types fall back to full bloom. Over 25×25 chunks no area needed the fallback.
- Progress (`state.areas[id].spec`, saved) counts from events while the area is in fog: `corridor.sent` (a street garden passing its chain on, now even with nothing left to pollinate), `solar.boost`, `reservoir.overflow`, `canopy.burst`, `canal.flow`, `chain.ended.areaIds` (best combo); full bloom is counted live. Completing it re-checks readiness and announces the area.
- Safety valves: a fogged area entirely in full bloom never waits on its specialty, and nor does one whose corridor/solar/chain machines have no room left beside them when a new one costs more than storage holds.
- `Advisor.specialtyStep(id)` gives one achievable step (build where there's room to bloom, pulse beside the machine, restore the canal path, or save up once the share is met); the suggestion button, the pacing bot and the no-stall bot use it. The objective and area panels show the specialty line and its hint.
- Tests (`tests/milestones.test.ts`): every area within 8 chunks of the park for 3 seeds has a supported, capped specialty; sizes grow with distance; every kind is actually played out to completion on real areas (two of each, two seeds); the wake needs both; progress is saved; machines can't make share-sized ones unreachable; a fully bloomed area is never stuck.
- Pacing, before → after: the city bot clears 25 → 26 (seed 7) and 29 → 31 (seed 21) areas an hour (it now saves up for specialty machines instead of spending everything on pulses); its slowest area went from 4:12/3:27 to 5:18/6:18. The advisor-only no-stall bot's "park packed and broke" case went from 14.3 to 27.0 min (limit 45). Park pacing unchanged. Soak: 1,000 areas, tick mean 0.115 ms.

## City 12.4: the fixed rooftop campaign is gone

- Deleted `data/rooftops.ts` (ROOFTOPS, LINKS, campaign cat anchors), `NeighbourhoodSystem`, the campaign's scenery (`Scenery.ts`, the buildings, bridges, relay pylons, skyline and Neighbourhood Bloom in `SceneBuilder`), its HUD objective, roof chips and labels, the bridge relays and Drone Dispatch, the Old Cistern water and Canopy self-charge, the rooftop-only upgrades (Relay II, Drone Dispatch) and the `rooftops` new-game option. `src` has no `'r1'`/`'r2'`/`'r3'` literals left.
- The three layouts survive as `data/templates.ts` (`seed`, `reservoir`, `canopy`), used by rooftop clusters; the park's cat nooks moved there too. Reservoir Gardens, the Elder Tree's Canopy Burst, Overcharge and Golden Relay all live on in the city. Old saves' `cores`/`neighbourhoodBloomAt` fields are optional and ignored.
- Tests: the campaign-only suites (neighbourhood, its pacing bot and cat, bridge relays, rooftop specialties) are deleted; each has a city counterpart (`relay-city`, `specialties-city`, `lucky-cat-city`, park and city pacing). Generic mechanics tests (chains, drones, placement, economy, saves, world) now run on a small test layer laid out like the Seed template inside a normal city (`tests/helpers.ts`); the save and Lucky Cat tests that relied on the rooftop Core and anchors now use the park's fountain and nooks.
- Everything passes: 177 unit tests, the e2e suite (69k picking checks, area panel, overview, HUD overlap, district bloom), the soak (tick mean 0.096 ms). Pacing is unchanged (park 6:39/5:54/6:27; city 27/32 areas an hour).

## City 12.1: rooftop cluster areas

- Ground generation 3 (new games; saves keep their generation): `CITY_GEN.rooftops` turns 14% of streets, plazas and markets at least 2 chunks out into **Rooftops**. Nothing else in the city changes (tested against generation 2).
- `AreaMap.rooftop(id)`: one of the campaign layouts (Seed, Reservoir, Canopy) as a template, placed so its Core stands exactly over the area's landmark cell (the landmark is nudged so the roof fits in its chunk), so labels, camera and advisor need no special case. The ground under it is the building (roads and canals run on underneath).
- `gameplay/RooftopClusters.ts`: revealing the area adds the roof as a raised layer (`roof:<area>`, saved with the layers, kept out of `grid.rooftops` so the old campaign code never sees it) and its Core becomes the landmark. It's visible but locked until a Bloom Relay on playable ground is within range of it; then it unlocks (and may let relays reach further roofs). Roof tiles and machines belong to the area (`areaOf`); pulses there cost the template's multiplier × the area's distance difficulty.
- The landmark's specialty for Rooftops is `roofBloom`: restore a share of the roof (10 + 0.5/chunk, max 24, at most half the roof). The advisor walks it through (a Drone Hub if needed, a relay in reach, a spot to build it on, then roof tiles); a safety valve covers a relay that can't be afforded.
- Rendering: roof tiles use their template's dead-ground look; `GridRenderer.clusterBuilding` draws the building with window bands and a parapet, grey until reached, white with vines after. Screenshots: `docs/review/rooftop-cluster-locked.png`, `rooftop-cluster-reached.png` (`npm run shots:rooftops`).
- Tests (`tests/rooftop-clusters.test.ts`): placement rules and rarity over 6 seeds, only cluster areas differ from generation 2, Core over the landmark, roof inside its chunk; ground under the roof; reach by relay (out of range doesn't); playable end to end to the wake; reload keeps roof, reach and tiles; generation-2 saves never grow clusters. The milestone "every kind is playable" test now covers `roofBloom`.
- Pacing with generation 3: city bot 26 → 27 (seed 7) and 31 → 32 (seed 21) areas an hour, each clearing 3 rooftop clusters in the hour; slowest area unchanged (5:18 / 6:18). Soak: tick mean 0.095 ms, save 0.64 MB.

## City 05.2: park art stages

- `ProgressionSystem.parkStage()`: 0 at the start, 1/2/3 at 25/50/75% of the park's restoration goal, 4 once the fountain is awake. Presentation only.
- Dead park ground is strewn with leaf litter and cracks until stage 1 (the paths are swept: litter gone, paving scrubbed lighter). Stage 2 mends the benches (fresh slats, green legs; broken ones sag onto one leg with the backrest fallen), refills the rain barrel and repairs the bandstand (missing column back, white columns). Stage 3 stands the toppled lamp back up with a warm lantern and a pool of light, leafs out the planter trees beside each bench and strings bunting round the bandstand. Stage 4 repaints its roof red.
- City props follow their area: broken until it clears.
- `ChunkRenderer` rebuilds only the park chunk when the stage changes; Game shows a short line for stages 1–3.
- `npm run shots:park` renders every stage; `tests/city.test.ts` checks the thresholds and that the park never looks lush before the fountain.

## City 10.6: readable huge chains

- `ui/ChainSummary.ts` follows every running chain from its events: blooms per area and a smoothed wave front. Under the combo the HUD lists the area the wave is in now and the biggest others (at most three, "🛶 Canal ×7") and a running total ("14 blooms across 3 areas"); see `docs/review/chain-summary.png`.
- A ring marks the wave front every 0.3 s on chains of 20+ blooms; the camera-follow setting now follows that smoothed front instead of each bloom.
- Audio changes instead of stacking: at most one bloom voice every 60–180 ms, pitch climbing with the combo (logarithmically past ×20) and the texture moving from sine to triangle to an octave shimmer (`bloomVoice`).
- VFX coalesce: past ×30, events beyond 18 per frame only flash their tile (no arcs or bursts), on top of the particle pool cap; toasts stay capped at two.
- Tests (`tests/chain-presentation.test.ts`): a ×200+ chain's per-area counts always add up to its total, at most three areas plus the total are listed, finished chains are dropped; the front moves far less than the blooms jump; 1,000 blooms in 10 s make under 120 voices with non-decreasing pitch and three textures; the per-frame budget. Browser perf still passes (chain ×635, update median 6.6 ms).
- Still open: the "done" check is a ×1,000 chain at 30 fps or more recorded on a real phone.

## City 10.4: buildable relays

- New machine **Bloom Relay** (📡, hotkey 9, 90🌿 40⚡, city only, after a Drone Hub). `gameplay/RelaySystem.ts`: any two relays within range (16 tiles, measured between centres in world space so ground and raised layers can link) form a link; links are derived from the relays, so nothing needs bookkeeping beyond each link's recharge and crossings in `state.links`.
- A bloom beside a relay sends one pulse down each ready link (once per link per chain, then a 6 s recharge), if something around the far relay can bloom. It arrives after a short travel and blooms 2 tiles there (synergy spots first, lush if all is in full bloom); those blooms can set the far relay's other links off, so a pulse runs through a network and always ends.
- **Relay Lens** (Networks, 2 levels): +6 range and +1 bloom per pulse per level.
- Presentation: an arc between the relays and a ring where it lands; the inspect panel lists links and readiness, and the range overlay highlights linked relays.
- Tests (`tests/relay-city.test.ts`, the Phase 3 relay checks ported to the city plus new ones): one pulse per crossing that blooms the far side; never from outside the zone, out of range or while recharging; only valid tiles (never hidden fog, obstacles or machines); Relay Lens range and targets; a ring of 10 relays where one chain fires every link once, reaches every relay and ends; placement rules; recharge survives a reload. (The campaign's own bridge-relay tests went with the campaign in #85.)

## City 10.3: canal water network

- `gameplay/CanalNetwork.ts`: restored water tiles ("clean water") carry flow. A Water Condenser or Reservoir Garden whose footprint touches one (8 neighbours) is on that canal's network. Networks are flood-filled lazily from a machine's bank and cached until a water tile changes or the machine count changes, so ticks never sweep the world.
- A full condenser with no garden within 2 tiles fills the emptiest basin on its network (lowest charge, then id).
- When a basin overflows on its own, it also spills at one other connected garden: the one with the most dry ground to water (then lowest id), after a travel delay along the canal. Each garden sends and receives at most once per chain; routed spills never route again and leave the receiving basin's own water alone, so a network can't loop.
- `canal.flow` events carry the water path (BFS along the canal) and the presentation runs a white flash and droplets tile by tile; the garden's inspect panel shows its network.
- Tests (`tests/canal-network.test.ts`): connectivity (dirty water and gaps break it), condenser routing, deterministic overflow routing, ten gardens all overflowing at once (one crossing per chain, 20 overflows, no loops), rooftops have none. Pacing unchanged (park 6:39/5:54/6:27, city 25/29 areas an hour).

## City 10.7: district blooms

- A district is one theme region (6×6 chunks); an area belongs to the district its landmark stands in, so membership is static (`DistrictSystem.members`).
- A district bloom is available once its largest group of neighbouring awake landmarks reaches `TUNING.district.minAwake` (4). Scattered landmarks don't count.
- Setting it off is claimed first (`state.districts[id]`, saved), then pays `TUNING.district.reward` (+25% for each earlier district bloom) and makes every free restorable tile in the district's cleared areas lusher: dead ground restored at bloom 1, restored ground one bloom level up. Machines and their tiles are never touched. A replay emits the presentation only.
- Surfaced by a toast when it becomes ready, the Advisor (right after a ready landmark), and the area panel (district progress line, Set off / Replay button). The presentation frames the district, rings each awake landmark, rolls a green wave outward and flies the reward; Skip lands everything at once.
- Tests (`tests/district-bloom.test.ts`): static membership, availability (connected vs scattered), once-only across a reload, machines untouched, replays change nothing, rooftops have none. `tests/e2e/district-bloom.e2e.mjs` plays it in the browser. The pacing bots don't use it, so their numbers are unchanged (city seeds 7/21: 25/29 areas an hour); the advisor-only no-stall bot sets it off when offered.

## City 08: getting around the city

- In the city the camera zooms out to 0.22 (a district at a glance). Chunks more than two chunks from the view centre draw at a far level of detail (one slab per tile, a bump for full bloom) when zoomed out; streaming is capped to a 90-unit radius.
- Labels over revealed areas: a ready landmark always shows a Wake button; when zoomed out every area shows its type and fog progress (or "clear").
- `F` cycles areas that need attention (ready landmarks first, then the fog furthest along); `Home` flies back to the park. Pan bounds follow revealed areas.

## City 09: an economy that never ends

- Storage grows with cleared areas: +35% of the starting caps per area, with diminishing returns (n^0.85), on top of Seed Vault.
- Each cleared area gives a small permanent income by type (parkland and groves biomass, streets and plazas energy, canals and reservoirs water, markets both), soft-scaled per type (n^0.75) so numbers stay readable.
- Machine permits: each cleared area waives one copy's worth of the ×1.5 cost growth for every machine type, so building keeps pace with the city.
- `tests/pacing-city.test.ts`: a scripted player wakes the fountain at ~6:40, then clears 16–20 areas in an hour (average 2.5–3.3 min per area, slowest ~4.5 min) with zero dead time. People play roughly twice as slowly.
- Metrics record when the 1st, 5th, 10th, 25th, 50th and 100th areas are cleared.

## City 06: simulation at city scale

- Biomass income is cached per chunk: a tile change re-sums only its chunk (via the grid's touch listeners); upgrades, new machines and Cores re-sum everything. Lush timers schedule their own chunk refresh.
- Saved city chunks load lazily; until a chunk loads, its income is estimated from its packed save columns (restored tiles × bloom level), then the exact sum takes over. A ~1,000-area city loads in about 10 ms.
- The Bloom Chain queue is a binary heap ordered by (time, sequence); fast-forward re-heapifies. Machine lookups by id are O(1); Core occupancy checks use a cached id set.
- Growing tiles are tracked in a set; drone jobs and synergy checks use O(r²) lookups and the per-chunk machine index.
- Active-region ticking (#44): every per-tick system visits only its own active set (growing tiles, condensers and filling basins via a by-type machine index, drones, queued chain events); `Sim.activeChunks()` reports where anything happens. Condensers find gardens through the per-chunk machine index instead of the whole list, and the park's tutorial step no longer scans the park once the fountain is awake. `tests/sim-scale.test.ts` plays 20 minutes of the city bot with `sim.fullScan` (scan every machine every tick) and without, and requires byte-identical saves; `npm run test:perf` ticks a 1,046-area world (3,528 chunks, 3,276 machines, 5 active chunks) in 0.107 ms (limit 0.3).
- Frame budget and catch-up (#48): `Game.runSim` spends at most `TUNING.catchUp.frameBudgetMs` (8 ms) on simulation per frame (always at least one tick). Time lost to a hitch (frame gaps over 0.25 s) or a hidden tab becomes catch-up debt (capped at 10 minutes, with a toast from 20 s), paid back within the same budget over the next frames; work beyond the budget carries over as debt instead of piling up. Browser perf: 300 s away is caught up over 6–7 frames, with at most 11.2 ms of simulation in any frame (limit 16).
- Metrics are incremental: stuck time caches the cheapest upgrade that could be bought and re-derives it only on a purchase, build, clear or storage change (a test checks it matches checking every upgrade every tick).
- `npm run test:perf`: a 0.1 s step takes ~0.4–0.5 ms with 10k restored tiles, 343 machines and 30 drones (target < 2 ms). `tests/sim-scale.test.ts` fails if a tick ever sweeps every tile or chunk.

## City 05 + City 07 (first pass): the park and the city on screen

- A new game starts in the city: only the endless ground layer, the park at chunk (0, 0) (paths crossing at the fountain, benches, a bandstand, a toppled lamp, a rain barrel, the old solar lamp as the starter panel, three mossy tiles to start on).
- The park's goal (the fountain) replaces the Seed Core: restore 130 tiles, grow 52 to full bloom, build every machine, then wake it. That clears the park's fog and reveals the first ring of areas. The park pacing bot wakes the fountain at about 6:30 (Round 2 window), with chains up to ×36 thanks to the extra room.
- After the fountain the objective points at the next area (one with a ready landmark first, otherwise the one furthest along). Landmarks are clickable, with an inspect panel and a Wake button. City areas ask for 60% of their tiles, capped at 160 × distance difficulty.
- `ChunkRenderer` draws the ground: one merged, vertex-coloured mesh per 16×16 chunk (slabs, decoration, props), streamed around the camera and rebuilt (at most 2 per frame, nearest first) when its tiles change. Fog is a per-chunk mesh of two translucent sheets whose per-vertex alpha is averaged across tile corners: hidden areas are thick, frontier fog thins with progress, tiles next to clear ground are lighter, and restored tiles are clear, so the gloom visibly recedes tile by tile. Cleared areas fade their fog out.
- The ground is picked as an unbounded plane. Picking e2e now covers the city ground (55k checks). Camera bounds follow the revealed areas.

## City 02: save format v4

- Saves older than v4 are discarded with a notice ("A new city awaits…"). Newer or unreadable saves are still backed up, never overwritten. The Round 1–Phase 3 migrations and fixtures are deleted.
- Only chunks that differ from generation are saved, as compact columns (ground, bloom, pollution, plus a short list of timers). Chunks are re-packed only when touched, and the tiles JSON is spliced from cached fragments.
- Autosave gzip-compresses at an idle moment (`SB4z:` + base64); page unload saves plain JSON synchronously; a full or blocked storage shows a message once. Saved chunks of the ground load lazily (chunks with growth in progress load at once).

Benchmarks (`npm run test:perf`, Node, synthetic city of ~2,000 chunks ≈ 1,000 areas, 512k tiles, 2,000 machines):

| | Result | Target |
|---|---|---|
| Lookup set (tilesNear + tilesWithin + machinesNear + neighbors) | ~7–9 µs, same as a 64-tile world | flat |
| Autosave serialize | ~5 ms | < 8 ms |
| Stored size (gzip) | 0.79 MB (2.37 MB plain) | < 1 MB |
| Load | ~12 ms | < 50 ms |
| First full pack / gzip | ~80 ms / ~250 ms (async) | — |

---

## City 15: proof

### Headless soak (`npm run test:soak`)

A deterministic "very fast player" clears 1,000 areas over 6 hours of game time (one every 21.6 s, a third of them picked at random from the frontier), builds 4 machines per area and a drone hub every 25, taps the fog edge and claims every cat. The soak fails if any limit is crossed:

| Check | Limit | Measured (seed 31) |
|---|---|---|
| Areas cleared | 1,000 | 1,000 |
| Stalls (no next goal) | 0 s | 0 s |
| Unreachable frontiers | 0 | 0 |
| Tick, mean | < 3 ms | 0.15 ms |
| Tick, p99 | < 25 ms | 0.77 ms |
| Tick, worst | < 120 ms | 17 ms |
| Save, stored | < 6 MB | 0.60 MB |
| Save, serialize + gzip | < 400 ms | 260 ms |
| JS heap after the run | < 900 MB | 253 MB (871k tiles loaded, 5,117 machines) |
| Save round trip | identical | identical |
| Production bookkeeping | equals a full re-sum | equal |
| Determinism (same seed twice, 60 areas) | identical saves | identical |

The first run found a real hitch: every area clear and every build re-summed production over the whole loaded world (296 ms per clear at 1,000 areas). Clears no longer re-sum, and a build only re-sums the chunks inside its reach (`ProductionSystem.markNear`), so the worst tick dropped to 17 ms. `SOAK_AREAS`, `SOAK_HOURS` and `SOAK_PROFILE=1` (per-system timing of slow ticks) help when working on it locally.

CI (`.github/workflows/ci.yml`) runs the typecheck, unit tests, benchmarks and the soak on every push to main.

### Browser perf (`npm run test:perf:browser`)

Playwright builds a 150-area city in the page (790 machines), reloads it from the save like a returning player, then:

1. pans in a widening loop across the city at mid zoom (120 frames);
2. zooms from near to the far overview and back over the park (90 frames);
3. lines a 350-tile strip with a grid of about 730 street gardens and sets off one chain (×600+).

For each phase it records the game's update time per frame (`app.stats.frame.updateTime`: simulation, chunk streaming and mesh building, labels, VFX), hitches (update over 50 ms), draw calls, render submission and wall-clock frame time. Update time, hitches, draw calls, reload time and the chain's combo are gated; render and wall time are only reported, because under SwiftShader the GL calls block on the software rasteriser and measure the runner rather than the game. `PERF_AREAS`, `PERF_JSON=file` and `PERF_VERBOSE=1` (per-method timing of slow frames) help locally.

| Phase | Update median | p95 | Worst | Hitches | Draw calls |
|---|---|---|---|---|---|
| Pan | 11.2 ms (limit 20) | 20.5 ms | 34 ms | 0 (limit 8) | 175 (limit 400) |
| Zoom | 10.0 ms | 20.1 ms | 24 ms | 0 (limit 6) | 161 (limit 400) |
| Chain ×746 | 5.7 ms | 28.9 ms | 63 ms | 1 (limit 8) | 239 (limit 400) |
| Catch-up (300 s away) | — | — | 11.2 ms of simulation (limit 16) | — | — |

Reload with the 150-area save: about 4 s under SwiftShader (limit 8 s). Autosave's main-thread steps with that save loaded (worst of 5): serialize 2.2 ms, base64 3.5 ms, storage write 0.7 ms (each limited to 16 ms; gzip runs off the main thread in a CompressionStream, at an idle moment). A full or blocked storage makes the save report failure (tested), keeps the previous save and shows one toast.

What the first runs found, and the fixes:

- **Chunk meshes were slow to build** (25–60 ms each, 2 per frame): `MeshBuilder` now writes into growable typed arrays and copies normals for boxes and uniform scales instead of renormalising, and rebuilds run within a 6 ms budget per frame. Pan p95 went from 45 to 18 ms, and the zoom's worst frame from 1.35 s to 41 ms.
- **Every machine animated every frame**, on screen or not (17–33 ms with 1,500 machines): only machines inside the visible ground rectangle animate now. The chain-phase median went from 24.6 to 4.4 ms.
- **Big chains thrashed layout**: each resource gain forced a layout to restart the counter flash and measured the counter for a flying number. Flashes are throttled, and flying gains coalesce per resource every 120 ms.
- **Machines cost a draw call per part** (2,678 with 800 gardens on screen): city machines now merge into dynamic batches per 64×64-tile region (a build or upgrade re-batches only its region; panels, orbs and status lights whose materials or visibility change stay separate). Draw calls dropped to 160–240 at every zoom. The debug overlay (F3) shows draw calls against the 400 budget.
- **A ×500 chain was impossible**: the city event cap (500) allowed about ×220 at most. It is now 1,500.

### Leak test (`npm run test:leak`)

Pans out and back across a 120-area city in a new direction every lap for 10 minutes (12 laps), sampling after a forced GC at the park. Baseline after 3 warm-up laps → after 10 minutes:

| | Baseline | After 10 min | Limit |
|---|---|---|---|
| Scene entities | 3,185 | 3,185 | +10% |
| Mesh instances | 2,401 | 2,401 | +10% |
| Materials | 434 | 434 | +10% |
| GPU memory per streamed chunk | 2.34 MB | 2.30 MB | +10% |
| JS heap | 177 MB | 177 MB | +25% |

Dropped chunks release their meshes and buffers; nothing accumulates.

### Graphics tiers (Look 1.11)

`npm run test:perf:browser` now reloads the same 150-area city at each graphics tier (`?gfx=low|medium|high`) and
pans and zooms it again (60 frames each), after the main run on High. Measured 2026-11-16 on a Windows dev machine
with several other sessions building and testing at the same time, in headless Chromium with **SwiftShader software
rendering**: these are relative numbers between builds and tiers, not frame rates on a real laptop or phone. The
untouched pre-Look build (0164ddc) already failed the update-time and hitch limits on this busy machine (pan update
median 196 ms against a 20 ms limit), so update time and wall time here mostly measure the machine's load.

| Main run (same script, same city size) | Pan frame / draw calls / update | Zoom frame / draw calls / update | Chain frame / draw calls |
|---|---|---|---|
| Before Look 1 (0164ddc) | 390 ms / 212 / 196 ms | 317 ms / 176 / 28 ms | 702 ms / 255 |
| After, High tier | 558 ms / 356 / 216 ms | 608 ms / 337 / 186 ms | 1290 ms / 493 |

Per tier, after Look 1 (60-frame pan and zoom after a reload):

| Run (pan phase) | Frame wall ms (median) | Draw calls (median) | Update ms | Render submit ms |
|---|---|---|---|---|
| Before Look 1 (0164ddc), main run | 390 | 212 | 195.7 | 21.7 |
| After, Low tier | 548 | 239 | 13.3 | 9.7 |
| After, Medium tier | 517 | 262 | 12.0 | 6.7 |
| After, High tier | 610 | 362 | 10.8 | 7.5 |

| Run (zoom phase) | Frame wall ms (median) | Draw calls (median, worst) | Update ms |
|---|---|---|---|
| Before Look 1, main run | 317 | 176 (559) | 27.9 |
| After, Low tier | 374 | 210 (525) | 12.2 |
| After, Medium tier | 410 | 227 (541) | 10.0 |
| After, High tier | 544 | 340 (779) | 9.9 |

What the tiers do: Low has no post-processing (camera tone mapping only), 1024² PCF3 shadows, no motes or shafts.
Medium adds the CameraFrame stack with bloom, grading and vignette (2× MSAA), 2048² shadows, 50 motes and 3 shafts.
High adds SSAO (a depth prepass: the scene is drawn twice, hence about +100 draw calls), depth of field, 4× MSAA,
soft PCF5 shadows, 90 motes and 5 shafts. The harness gates draw calls per tier (Low 400, Medium 450, High 800) and
each tier's frame time against Low in the same run (Medium ≤ 1.5×, High ≤ 2×). On a real device the post stack is
GPU fill-rate work that SwiftShader inflates a lot; the targets (High about 60 fps on a mid-range laptop, Low 30 fps
or better on a mid-range phone) still need checking on hardware (device log #99).

# History: the rooftop campaign (before the city)

Before the city, Solarbloom was a fixed campaign on rooftops. Its three rooftops live on as the templates of
generated rooftop clusters (#82); the fixed campaign itself was removed in #85 (see "City 12.4" above). Its plans are
in `docs/ROUND_2_PLAN.md` and `docs/PHASE_3_PLAN.md`, and the full write-ups are in git history.

- **Round 1:** one 8×8 rooftop, Pulse, solar, condensers, pollinator gardens, Bloom Chains, a drone, the Rooftop Core finale.
- **Round 2:** the Mother Tree, upgrades in groups, the hidden Lucky Cat, rooftop transformation stages, phone layout, the scripted pacing bots.
- **Phase 3:** three linked rooftops (the Seed, the Reservoir, the Canopy), relay pylons over bridges, Overflow and Canopy Burst specialties, Overcharge, Golden Relay and Cat's Garden, the Neighbourhood Bloom. Everything except the fixed rooftops themselves now lives in the city: specialties on grove and reservoir/canal areas, chains across areas through green corridors, cat rewards on cleared areas.
