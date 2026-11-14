# Solarbloom: progress

Moved out of the `azzaisme/mouthwash-brigade` repo (where it started in a `solarbloom/` folder) with its full history.

# City scale (epic #1)

The game is growing into an endless, fog-covered city (see issue #1 and its sub-epics).

| Sub-epic | Status |
|---|---|
| #2 City 01: endless chunked world model | ✅ |
| #3 City 02: save format v4 (old saves scrapped, sparse deltas) | ✅ |
| #4 City 03: areas and the fog | ✅ (simulation; fog visuals are #8) |
| #5–#16 | not started |

## City 01: world model

- `Grid` is the world: a set of layers (the unbounded ground `g`, and each rooftop as a bounded raised layer), each made of 16×16 chunks generated on first touch. Tile ids stay `layer:x:z`.
- Generation is a pure function of `(seed, layer, x, z)` (a hash, not the game RNG), so the world is identical whatever order chunks are visited in.
- `tilesNear`, `tilesInRange`, `tilesWithin`, `neighbors` and `machinesNear` (a per-chunk machine index) cost the same in a 64-tile world and a 512k-tile one. Every per-tick "what's nearby" scan in the systems now goes through them; growing tiles are tracked in a set instead of scanning tiles each tick.
- Adjacency never crosses layers. The ground exists but stays unplayable until the park (City 05).
- `GameState` no longer holds tiles (`rooftops` is gone; `layers` describes the surfaces). Occupancy is rebuilt from the machine list.

## City 03: areas and the fog

- `core/Areas.ts`: the city ground is split into areas of whole chunks (a seeded jittered Voronoi over 2×2-chunk super-cells, one or two seeds each; the park is always chunk (0, 0)). Shapes, neighbours and landmark spots are a pure function of the seed, so they are never saved. Areas average about 2–3 chunks.
- `gameplay/AreaSystem.ts`: fog per area (hidden → frontier → thinning → cleared), saved in `state.areas`.
  - Hidden tiles can never change. In a frontier area only tiles touching clear ground (a cleared area or any restored tile) can be restored, so the fog recedes tile by tile. The park is home: no edge rule.
  - Restoring `clearShare` (60%) of an area lets its landmark (a 2×2 Core placed when the area is revealed) be woken: the area clears, once, and its hidden neighbours become frontier.
  - Every revealed area is guaranteed a way in: if obstacles wall off its edge, one is cleared and saved (`unblocked`).
  - Pulses, drones, chains and building all go through the same rules.
- Tests: partition coverage and symmetry, order independence, every transition, reveal ring, tile-by-tile recession, save round trip, and a soak clearing 500 areas in random order with no unreachable frontier.

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

# Phase 3: the living neighbourhood (plan: `docs/PHASE_3_PLAN.md`)

## What already existed vs what the plan assumed

Checked against the code before starting:

| Plan assumption | What the code had | What Phase 3 did |
|---|---|---|
| Roof-scoped tile ids | Already `roofId:x:z`, and every system took a `roofId` | Kept; the Seed's ids are unchanged |
| A second rooftop | A 6×6 "Greenhouse Tower" drawn by the scene as a never-playable preview | Rebuilt as the 8×8 Reservoir; added the 10×8 Canopy |
| Mother Tree | Already a buildable machine (Round 2) | Kept; the Canopy got its own fixed Elder Tree with a different mechanic |
| Water overflow | The condenser already watered dry soil beside it | Added the Reservoir Garden + Overflow on top of it |
| Wide Pulse / Overcharge | Both already upgrades (Overcharge = every Nth pulse) | Kept; added the plan's "Overcharge Pulse" as a boost to machines next to a manual pulse (no new button) |
| Bridge | A purely visual bridge that grew during the Core finale | Real links with relay pylons; built by the player |
| Chain engine with event ids, visited sets, caps | Yes: deterministic queue, visited set, 100-event cap, depth cap | Extended with RELAY/OVERFLOW/CANOPY_BURST/LUSH events and per-chain link tracking |
| Save versioning | v2 with migrations | v3 + migration; tested on real Round 2 saves |

## Milestones

| | Milestone | Status |
|---|---|---|
| P3-M1 | Three authored rooftops, roof-scoped ids, save v3 + migration (real Round 2 fixtures), per-roof rendering, camera bounds/focus/F key/roof chips, picking on every roof (e2e), view-matrix fix | ✅ |
| P3-M2 | Skybridge Relay unlock and objective flow, Reservoir playable (restore, build, drones, production), Cistern water, lush tiles | ✅ |
| P3-M3 | Relay endpoints, bounded cross-roof chains, pulse over the bridge, relay lamps/inspect, Relay II, loop/determinism tests | ✅ |
| P3-M4 | Reservoir Overflow, Elder Tree + Canopy Burst, Overcharge Pulse, Drone Dispatch, per-roof Core panels | ✅ |
| P3-M5 | Lucky Cat on every playable roof (8 new nooks), Golden Relay, Cat's Garden, cat never blocks a build | ✅ |
| P3-M6 | Neighbourhood Bloom finale (skippable, replayable without rewards), white facades, horizon district, quality option | ✅ |
| P3-M7 | Neighbourhood pacing bots (two styles), two no-stall fixes, retuning, phone objective button, docs | ✅ |

## How to test Phase 3

- `npm test`: 80 unit tests. The Phase 3 files:
  - `phase3-save.test.ts`: two real Round 2 saves (`tests/fixtures/`, written by the Round 2 build with its own bot) migrate with the Seed kept tile for tile. Machines, drones, upgrades, resources and an active cat survive. Save → load → save is byte-identical.
  - `neighbourhood.test.ts`: bridge gating, costs paid once, the full-bloom milestone, the Reservoir playable, drones stay on their roof, the objective walk, and the Neighbourhood Bloom (once, across a reload, machines untouched).
  - `relay.test.ts`: crossing, no crossing when unbuilt, outside the zone or recharging, synergy targeting, a closed three-link loop that terminates with each tile changing once, determinism, Relay II and Golden Relay.
  - `specialties.test.ts`: Overflow fill/burst/eligibility, the no-stall fallback, lush expiry, the Elder Tree burst amplified by a garden, solar and garden boosts, Drone Dispatch.
  - `lucky-cat-hood.test.ts`: the reward pool only offers useful rewards, one cat at a time on all three roofs across 60 games, the HUD veto, Golden Relay once, Cat's Garden, the cat hopping off a nook, claim once after reload.
  - `pacing-hood.test.ts`: two scripted play styles finish the neighbourhood with no dead time, plus a slower player at one action per 6 s.
- `npm run test:e2e`: pointer → tile picking on all three rooftops at 3 sizes × 3 zooms (8,964 checks), a real click, and HUD clicks that never reach the world.
- In the game: Settings → *Playtest timings* records the time to each bridge, the first cross-roof chain, each Core, the Bloom, the biggest chain and the cats found.

Quick recipes:
- **Cross-roof chain:** a Pollinator Garden next to the Seed's relay tile (east edge, third row) and a pulse beside it. Watch the pulse cross and bloom the Reservoir's corner.
- **Overflow:** two condensers within 2 tiles of a Reservoir Garden and some mossy tiles around it.
- **Big Canopy Burst:** Pollinator Gardens two tiles from the Elder Tree, then restore around the trunk.

## Phase 3 balance (`TUNING.neighbourhood`, `data/rooftops.ts`)

| Step | Requirement | Cost |
|---|---|---|
| Skybridge Relay | Seed Core awake, every open Seed tile in full bloom | 220🌿 90⚡ |
| Old Cistern | 48 Reservoir tiles restored, a Reservoir Garden, 3 Overflows | 200🌿 80💧 |
| Canopy Bridge | Cistern awake, 75% of open Reservoir tiles in full bloom | 300🌿 140⚡ |
| Elder Tree | 64 Canopy tiles restored, 5 Canopy Bursts | 300🌿 120⚡ |
| Neighbourhood Bloom | All Cores awake, both bridges | free; +200⚡ +120💧 +400🌿, storage +50%, biomass ×1.15 |

Dead ground on the new roofs costs ×2 to pulse. Each new roof adds +50% storage. Relays: 1 remote bloom, 8 s recharge (Relay II: 2, 6 s). Overflow: 3 condenser fills, 3 tiles, lush ×2 for 25 s. Elder Tree: 12 charge, burst radius 2 (3 awake), +2 blooms per garden inside.

Scripted players (minutes of game time; the 6 s player is about how fast people tap):

| Player | Core | Skybridge | first cross-roof chain | Cistern | Canopy Bridge | Elder Tree | Bloom |
|---|---|---|---|---|---|---|---|
| solar, 1 action/3 s | 7:39 | 7:51 | 7:53 | 8:39 | 10:33 | 10:54 | 10:57 |
| water, 1 action/3 s | 7:00 | 7:18 | 7:20 | 8:09 | 11:00 | 11:39 | 11:42 |
| solar, 1 action/6 s | 8:30 | 9:36 | 9:38 | 10:36 | 13:06 | 13:42 | 13:48 |
| water, 1 action/6 s | 8:18 | 9:30 | 9:32 | 10:12 | 17:18 | 18:36 | 18:42 |

No dead time in any run. Water + pollinator builds chain bigger (biggest ×25–36 vs ×21–26) and finishes later, so the two styles feel different.

## Phase 3 known limitations

- The bots are much better at Round 2 than the Round 2 notes assumed (the Core at about 7–8 min instead of 14). The Seed is nearly in full bloom by then, so the Skybridge follows quickly. For people, expect the first bridge a few minutes after the Core. A human playtest should check the plan's 5–10 min target. The full-bloom share and costs in `data/rooftops.ts` are the knobs.
- With every Round 2 upgrade, Wide Pulse III clears new rooftops very fast. The time sinks are nurturing to full bloom, Overflows and Canopy Bursts, all of which are active play.
- Real-GPU frame rate is still unmeasured (the sandbox renders with SwiftShader). Three rooftops add about 140 tile regions to the batcher. Rebuilds stay per region.
- The relay zone is radius 1 around one edge tile per side. Small and readable, but new players may need the pylon tooltip to find it.

## Phase 3 next steps

1. Human playtest with the plan's seven questions; read Settings → Playtest timings afterwards.
2. If the Skybridge comes too soon for people, raise the Seed requirement or the bridge cost; if a stage drags, lower its Overflow/Burst count.
3. Zoomed-out simplification (per-roof aggregate effects) if the frame rate needs it on phones.
4. The new district on the horizon.

---

# Round 2 (plan: `docs/ROUND_2_PLAN.md`)

Round 1 checkpoint: commit `3b79a23` (tag it with `git tag round-1 3b79a23 && git push origin round-1` if you want a named marker). Round 1 saves migrate to the v2 format automatically.

| | Milestone | Status |
|---|---|---|
| M1 | Grid juice: boosted-tile glow, ordered chain waves with an origin marker, neighbour softening highlights, shake on blocked actions, BLOOM CHAIN ×N counter under the resources with end-of-chain totals | ✅ |
| M2 | Deterministic chain engine (typed event queue, 100-event cap + fast-forward), Solar burst / Condenser watering / Pollinator triggers / new Mother Tree, milestone bonuses, determinism + cyclic-layout tests | ✅ |
| M3 | Drone Dash, Work Radius, Chain Intelligence, Second Drone; clickable drones show range + jobs; trails; drones nurture once the roof is green; Wide Pulse + Overcharge for the manual pulse | ✅ |
| M4 | Lucky Cat at 4–6 min then every 4–8 min, 40/25/20/12/3 rewards, 2-reward Jackpot, missed cats stash rewards instead of blocking, corner reward panel, 5 new hiding spots | ✅ |
| M5 | Layered hazy solarpunk city, foreground terraces, service ledge with props, 25/50/75% stages, Rooftop Core finale, richer planting, seamless lawns, HUD restyle | ✅ |
| M6 | Pacing bot + playtest metrics, rebalance, perf check, docs | ✅ |

## How to test Round 2

- `npm test`: 47 unit tests, including `chains.test.ts` (adjacency-only triggers, per-garden limits, once-per-chain solar, Mother Tree can't self-recharge, a placement-built ×10, cyclic layouts terminate, same action + same state = same events) and `pacing.test.ts` (scripted player reaches every beat with no dead time).
- `npm run test:e2e`: pointer→tile picking at 3 sizes × 3 zooms, real clicks, HUD clicks never touch the world, and a regression check for the shared-mesh bug.
- In the game: Settings → *Playtest timings* shows time to first upgrade, ×5 and ×10 chains, Drone Hub, first cat, Mother Tree and its first pulse, Core, and seconds with nothing affordable to do.
- A ×10 recipe: a row of gardens two tiles apart with solar panels between and beside them; tap the grey tile at one end.

## Round 2 balance (all in `src/data/tuning.ts` / `machines.ts` / `upgrades.ts`)

Scripted player, one action every 3 s (people are roughly 2× slower):

| Beat | Bot | ≈ Person | Plan |
|---|---|---|---|
| Water Condenser | 1:03 | ~2:00 | 1:30–3:00 |
| Pollinator Garden | 1:36 | ~3:10 | 3:00–5:00 |
| First Lucky Cat | 4:00–6:00 of real play | same | 4:00–6:00 |
| Drone Hub | 3:06 | ~6:10 | 5:00–8:00 |
| Mother Tree | 7:03 | ~14 | 11:00–13:00 |
| Rooftop Core | 7:15 | ~14:30 | 13:00–15:00 |
| Time with nothing to do | 0 s | | none |

Changes from Round 1: Solar 20🌿, Condenser 35🌿 12⚡, Garden 50🌿 12💧, Drone Hub 110🌿 35⚡, Mother Tree 170🌿 40💧 (unlocked by the hub); Core needs 42 tiles, 24 in full bloom, every machine and a Mother Tree, and costs 60⚡ 170🌿. Start storage 60/40/100. Bloom multipliers 1/2/3 (was 1/2.5/5), Rich Soil +30%/level, garden zone ×1.5. Each garden pollinates up to 4 times per chain, from newly restored *or* newly grown plants.

## Round 2 known limitations

- The pacing bot builds poor synergy layouts, so it rarely chains above ×2; chain reach is proven by deliberate layouts in tests instead. Human playtests should check how quickly people find ×5 and ×10.
- The Mother Tree lands slightly after the plan's 11–13 min window for an average player.
- Frame rate on real phones still needs measuring with the new scenery (draw calls ~150–170 in the busiest tested scenes; game logic 1.3 ms median, 12 ms worst frame during a chain with 4 drones).
- Rooftop 2 is still a preview (the plan says not to build multi-rooftop yet).

## Round 2 next steps

1. Human playtest with the plan's six questions; read Settings → Playtest timings afterwards.
2. Tune the Mother Tree cost/unlock from those numbers.
3. Teach layouts in-game: a "ghost" hint showing where a second garden would link the chain.
4. Then the plan's stretch list (alternative layouts, more synergies, cat variants, weather).

---

# Round 1

## Milestones

| | Milestone | Status |
|---|---|---|
| M0 | PlayCanvas + TS + Vite, ortho iso camera, lights, pan/zoom, pointer/touch picking, UI shell, FPS toggle | ✅ |
| M1 | 8×8 grid with polluted / prepared / growing / restored looks, hover, click-to-restore, animated transitions, resources, solar fail-safe, save/reload | ✅ |
| M2 | Passive production, build mode with ghost + occupancy, solar/condenser/pollinator, 7 upgrades with visible effects, inspect + radius | ✅ |
| M3 | Bounded deterministic chain queue, pollinator-driven chains, combo UI/arcs/sounds, duplicate/infinite guards with tests | ✅ |
| M4 | Drone Hub + cute drone, reservations, flight, automated restoration, speed upgrade, idle behaviour | ✅ |
| M5 | Lucky Cat: first cat at ~3–5 min, 7 hiding anchors, screen-space click target, all 5 reward types, persistence, no double rewards | ✅ |
| M6 | Core requirements + building restoration sequence, camera reveal of Rooftop 2 and bridge, contextual tutorial, audio, responsive layout, new game | ✅ |
| M7 | Rooftop 2 playable, relays, Mother Tree, more machines | ⏭ next |

Extra beyond the plan: **Nurture**. Pulsing a restored tile grows it through three bloom levels (grass → wildflowers → shrubs/trees). This keeps something useful to click after the roof is green, and gives the garden its lushness.

## Gaps filled after the first pass

- Faint tile grid while building; the ghost now has a coloured outline.
- Expandable 🔨 Build tray on phones (machine cards are always visible on wide screens).
- Game speed chip: 1× / 2× / 3×.
- Butterflies over restored tiles (up to 10, one per 5 restored tiles).
- Placement animation: foundation pops, shell unfolds with a quarter twist, the light switches on with a ripple and chime.
- Lucky Cat discovery panel: nooks found, reward types collected. Saved in the discovery log, and old saves load with an empty log.
- Automated pointer→tile test (`npm run test:e2e`): every on-screen tile at 5 points each, at 1280×800, 820×1180 and 390×844, zoom 0.6 / 1 / 1.8, plus a real mouse click and a hotbar click that must not touch the world. 2,778 checks pass.

## Phone playtest fixes

**Frame rate fell apart after lots of tapping.** Cause: every tile change rebuilt one dynamic batch holding *all* tile decoration (~300-vertex spheres), so each rebuild got slower as the garden grew. Measured on a 150-tap storm in headless Chromium: batch rebuilds took 11.2 s in total, average JS frame 165 ms, worst frame 9.2 s.
- Tiles now batch in small regions (4×2 tiles), so a tap only rebuilds its own region.
- Tile decoration uses low-poly meshes with baked vertex colours and one shared material, so each region draws in about one call.
- Up to 8 flying "+🌿" numbers at once (extras just flash the counter); no backdrop blur on touch devices.
- Adaptive resolution: render scale steps down after 1.5 s of slow frames and back up when there's headroom (shown in the F3 overlay).
- After: batch work 0.22 s in total, average frame 10 ms, worst frame 28 ms on the same storm; 150–230 draw calls.

**"Not clear what to do."**
- A welcome card for new players (three steps and the goal).
- A bouncing golden marker on the first tile to tap.
- Hints now use live numbers ("costs 20🌿 10⚡, you have 7🌿") and say exactly which button to tap.
- The control a hint refers to glows (on phones, the 🔨 Build button when the machine is in the tray). Harvest glows when you run out of energy.
- A "Next: …" line on the objective panel on phones, where the checklist is collapsed.

## Verified

- `npm test`: 32 tests pass (grid, economy, placement, chains, drones, lucky cat, save/progression, and a scripted first session that reaches the Core).
- `npm run build`: type-check and production build pass.
- Headless Chromium (SwiftShader): the page loads with **no console errors or warnings**. Restoring, building, the drone, inspect, the cat click and the full Core sequence (including Skip) were driven through the real canvas picker and checked in screenshots at 1280×800 and 390×844.
- Pointer → tile picking is covered by the automated e2e test above.
- Save → reload keeps tiles, machines, upgrades and the active cat.
- Draw calls: about 140 early game, about 300 with a full garden (static + dynamic batching).

## Known issues and notes

- Real-GPU frame rate hasn't been measured: the sandbox only has CPU WebGL (SwiftShader runs at about 1.5 fps). Batching and pooling are in place; profile on a phone next.
- Pacing comes from a scripted bot (about 4 min at one click every 3 s). Human playtests are needed; every number is in `src/data/tuning.ts`.
- The emoji used in HUD icons depend on the system emoji font.
- The playcanvas chunk is about 2.1 MB minified (559 kB gzip). Tree-shaking or code-splitting could reduce it.

## Next steps

1. Make Rooftop 2 playable: unlock its grid, add multi-roof camera navigation and an Energy Relay to carry chains across the bridge.
2. Mother Tree (stores bloom charge, releases a big pulse).
3. A Lucky Cat discovery log, more anchors on Rooftop 2.
4. Art pass: rounded meshes, instanced foliage, butterflies over restored tiles, softer shadows.
5. Human playtest and tuning pass; consider an optional 2× speed toggle.
