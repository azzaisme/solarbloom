# E21: The Old City — a sandbox of exploring, salvaging and restoring

## Goal
Solarbloom becomes a sandbox, exploration and restoration game, in the way Dreamlight Valley and Satisfactory are. I walk bloombot out of the park into a foggy city split into ten named regions, with a beach close to home. Each region has a material found nowhere else, a landmark I can see from far away, something in my way, and a sleeping robot who wakes up and asks for help. I salvage by hand, store what I find, carry it to the fountain, and each delivery gives bloombot a new way to move and new things to build. I have a house that grows with me. Days turn to nights and the weather changes. Helpers only take over what I have already restored myself.

**The setting: an island.** The Old City is a fog-bound island city that was abandoned when the fog came. Bloombot is sent there by boat from the mainland to bring it back to life. The sea surrounds it on every side, and the journal pages tell what happened. The endless idle city is not deleted: it becomes the mainland (the Outskirts), reached across the Long Causeway once the island is restored.

Controls, prompts, menus and the backpack screen are their own epic: **E22: Controls and UI**. This document names actions (Interact, Pulse), never keys.

## Today, and what changes

| | Today (`testing`, 18 Nov 2026) | After E21 |
|---|---|---|
| World | Endless seeded areas that all play alike | A fixed Old City: the park plus 10 regions, one of them a downtown of skyscrapers under cloud; the endless city opens after the finale |
| What I spend | Biomass, energy and water earned by machines and tiles | Eight materials I find, carry and store; biomass is one ingredient; energy and water power pulses |
| Opening a region | Buy sealed fog for biomass and energy | Clear what is in the way with an ability or a repair |
| Progress | Upgrade drawer, exponential costs | Fountain tiers: deliver materials, get an ability and recipes |
| Who restores | Bloombot and drones side by side | Bloombot first; helpers only where bloombot has done its share |
| Reason to explore | None: income arrives wherever I stand | Materials, caches, Keepers and gates are in specific places |
| Ground | Flat everywhere; only rooftops are raised | Terraced levels with cliffs, ramps, stairs and lookouts |
| Home | None | A house in the park with four levels |
| Time | One fixed light | A day and night cycle and changing weather |
| Camera | Fixed pitch, no zoom | An orbit camera made for walking and looking |
| Idle layer (Frenzy, merging, superstructures, events) | The headline | Hidden until the Outskirts |

## Rules for the whole epic
1. **Two rule sets.** `GameState.rules` is `'oldcity'` or `'classic'`. New games are `'oldcity'`. A save with no `rules` field loads as `'classic'` and plays exactly as it does today, so no save is scrapped and `SAVE_VERSION` stays 7. `createInitialState(seed, rules = 'classic')` keeps every existing test on classic rules, unchanged and byte-identical.
2. **All numbers live in data.** `src/data/oldcity.ts` (map, regions, gates, Keepers, caches, house) and `src/data/salvage.ts` (materials, yields, recipes, tiers). The numbers here are the starting values. Tickets tune yields, not gates or recipes, unless the pacing bot (§19) fails.
3. **No intermediate items.** Materials go straight into recipes. No crafting stations, conveyors or part chains.
4. **"Region"** means one of the ten authored places. In code they are `OldRegion` in `oldcity.ts`; `DistrictSystem` and "sealed areas" keep their current meanings.
5. **Keepers are robots.** E19's "animals only, no residents" stays true for people.
6. **The Lucky Cat stays hidden** (E20). Nothing here adds a hint for it.
7. **No new paid models are needed.** Everything uses GLBs already in `assets/raw/tripo/models` and `assets/raw/models`, plus procedural shapes. Keepers reuse the bloombot model with a tint and one prop. The owner can swap in new models later.
8. **Desktop and Steam Deck only**, full controller support for every new panel, calm HUD by default.
9. **Work lands on `testing`**, then `testing` → `main` when the epic is done. Run `npm test` per ticket; the full suite at the two milestones (§20).

## 1. Materials

| Id | Name | Salvaged from (existing models) | Home |
|---|---|---|---|
| `scrap` | Scrap | rubble-pile, crate, stone-block | Park, backstreets, every region |
| `seeds` | Seeds | broken-pot, stump | Park (a few), Elder Grove |
| `copper` | Copper | copper-pipe, ac-unit | Mast Row |
| `timber` | Timber | driftwood (procedural), barrel, mooring-post | Saltwind Beach |
| `glass` | Glass | lantern, market-stall | Old Market |
| `clay` | Clay | dry-drain, planter-pot | Cistern Basin |
| `gears` | Gears | vent, bollard (as clockwork heaps) | Clock Plaza |
| `sunstone` | Sunstone | procedural crystal shards | The Terraces |

Two one-off items: the **Heart Seed** (Great Greenhouse) and the **Star Lens** (Sky Observatory). They take no space.

- **Backpack:** whole numbers per material. Stack limit 40, then 60, 80 and 120 at fountain tiers 2, 3 and 4. A full stack leaves the rest in the pile.
- **Biomass** still grows on restored tiles, has no limit, and is an ingredient in living machines. **Energy and water** still pay for pulses and helpers, as today.

## 2. Storage
- **The store** is one shared, unlimited stock of materials for the whole city.
- **Ways into the store:** the fountain, every woken landmark, the chest in the house, and any **Storage Chest** I build (recipe 8 Timber, 4 Scrap; crate model; one tile; from tier 1; at most 40).
- Interact with any of them opens the storage panel: one row per material with backpack and store counts, "Deposit all", and move 1, 10 or a stack either way.
- **Paying:** a recipe or delivery takes from the backpack first, then from the store if bloombot is within 12 tiles of a way into the store. Anywhere else, only the backpack counts.
- Reclaimers (§3) deliver straight to the store.

## 3. Salvage
- A salvage pile is a real thing in the simulation: `{id, region, x, z, material, left}`, placed from the region's data, with only `left` saved.
- Hold Interact for 0.6 s facing a pile to take up to 3 units. Sizes: small 6, medium 12, large 24.
- A pile blocks its tile. When it is empty it disappears and **the tile underneath becomes ordinary dead ground that can be restored**. Tidying up is the first step of restoring.
- Piles never come back in the Old City.
- Each region has one **seam** (a 2×2 marked spot, for example the Pipeworks in Mast Row). After the region's landmark is woken, a **Reclaimer** can be built on the seam. It sends 6 units a minute of the region's material to the store, for ever. While away it earns half that, for up to 4 hours.
- Loose yield per region, of its own material: 120 in ring 1, 160 in ring 2, 200 in ring 3. Scrap: 60 in the park, 80 in each region, 20 per backstreet area. Seeds in the park: 12.
- **No dead ends:** once the Market Hall is awake, Tally trades any 3 of one material for 1 of another.

## 4. Recipes (old-city rules: fixed, no price growth)

| Thing | Recipe | From tier |
|---|---|---|
| Solar Panel | 10 Scrap | 1 |
| Water Condenser | 12 Scrap, 6 Copper | 1 |
| Storage Chest | 8 Timber, 4 Scrap | 1 |
| Pollinator Garden | 10 Seeds, 6 Timber, 20 Biomass | 2 |
| Drone Hub | 20 Scrap, 15 Copper, 10 Glass | 2 |
| Reclaimer (new, seams only) | 20 Scrap, 10 Copper, 10 Timber | 2 |
| Reservoir Garden | 15 Clay, 10 Seeds, 30 Biomass | 3 |
| Mother Tree | 30 Seeds, 20 Clay, 100 Biomass | 3 |
| Bloom Relay | 20 Copper, 10 Gears, 10 Sunstone | 4 |
| Cultivator | 30 Scrap, 20 Gears, 10 Copper | 4 |

Removing something gives everything back. Decorations and plots stay free, and can be placed on any restored ground: that is the sandbox.

## 5. The fountain: tiers and deliveries
Interact at the fountain opens the delivery panel. Materials can be handed in a bit at a time; the panel shows what is still missing.

| Tier | Also needs | Delivery | Gives |
|---|---|---|---|
| 1 "Water returns" | 60 park tiles restored | 20 Scrap, 6 Seeds | **Pry**; build mode; Solar Panel, Condenser, Storage Chest; the house plot |
| 2 "The pump turns" | 2 landmarks awake | 30 Copper, 30 Timber, 20 Glass | **Hover**; Pollinator, Drone Hub, Reclaimer; stack 60 |
| 3 "The garden climbs" | 4 landmarks awake | 40 Clay, 30 Gears, 40 Seeds | **Climb**; Reservoir Garden, Mother Tree; stack 80 |
| 4 "Light on the roofs" | 6 landmarks awake | 40 Sunstone, 60 Copper, 40 Gears | **Glide**; Relay, Cultivator; stack 120 |
| 5 "The Great Bloom" | all 10 landmarks awake | 80 Sunstone, 80 Glass, 80 Seeds, Heart Seed, Star Lens | Finale (§17) |

The fountain's look changes at each tier (dry, trickle, flowing, lit, in bloom). The old fountain rules (130 tiles, one of each machine, 100 biomass) apply only under classic rules.

## 6. Abilities

| Ability | What it does | How it works |
|---|---|---|
| Pry (tier 1) | Clears rubble barricades | Hold Interact for 2 s at a barricade. It is gone for good (`salvage.opened`) |
| Hover (tier 2) | Crosses deep water | Deep water tiles block walking until Hover. Hovering moves at walking speed with no sprint. Shallow water is waded as today |
| Climb (tier 3) | Climbs ladders to roofs | Interact at a ladder marker rides up to the roof layer. Replaces the rule that a Bloom Relay must reach a rooftop first (old-city rules only) |
| Glide (tier 4) | Crosses gaps from roof edges | Interact at a perch marker flies a 2–4 s arc to its paired landing marker, using the lift's easing |

Sprint and travel to woken landmarks stay as they are.

## 7. The map: regions under cloud
The structure follows Merge Mayor: one map, split into named regions, each under cloud until I open it, each shown on a region map with what it needs. The beach is one of the four regions touching the park, so the sea is a two-minute walk from the first pulse.

The Old City is an island inside chunks −6 to 6 in both directions (13 × 13 chunks, 208 × 208 tiles). The park is chunk (0,0). **The sea** surrounds it: every chunk outside that square is open sea, and the island's outer chunks end in coastline inside them (sea cliffs under Spire Heights and Observatory Hill in the north, rocky shore in the east and west, beaches in the south). A bay fills every chunk with z ≥ 3 and x ≤ 1, so Saltwind Beach, directly below the park's south steps, faces the bay. Bloombot lands there, so the beach is open from the start. Sea mist hangs a few chunks out to sea; nothing beyond it can be reached until the finale. The Long Causeway leaves the east shore of Clock Plaza toward the mainland, broken in the middle until the Great Bloom.

| # | Region | Area type | Chunks (x, z) | Landmark | Material | In the way | Keeper |
|---|---|---|---|---|---|---|---|
| 1 | Mast Row | street | 0…1, −2…−1 | Signal Mast | Copper | Barricade (Pry) | Pylon |
| 2 | Old Market | market | 1…2, 0…1 | Market Hall | Glass | Barricade (Pry) | Tally |
| 3 | Saltwind Beach | beach (new) | −1…0, 1…2 | The Sea Lock (lock-gate model, where the canal meets the sea) | Timber | Nothing at first: the boat lands here. A barricade (Pry) blocks the boardwalk to the Sea Lock | Tide |
| 4 | Elder Grove | grove | −2…−1, −1…0 | Elder Tree | Seeds | Barricade (Pry) | Moss |
| 5 | Cistern Basin | reservoir | 2…4, 2…3 | Old Cistern | Clay | Deep water (Hover) | Sluice |
| 6 | Clock Plaza | plaza | 3…4, −1…1 | Clock Tower | Gears | Canal; the lock bridge rises when the Sea Lock wakes (Hover also works) | Tock |
| 7 | The Terraces | rooftops | −1…1, −4…−3 | Rooftop Core | Sunstone | Roofs only (Climb) | Gable |
| 8 | Glasshouse Gardens | grove | −4…−3, −2…0 | Great Greenhouse (skyline-dome model) | rich Seeds and Glass; Heart Seed | Broken bridge: repair for 30 Timber, 20 Copper, 10 Gears | Fern |
| 9 | Observatory Hill | rooftops | 2…4, −5…−3 | Sky Observatory (satellite-dish model) | rich Copper and Sunstone; Star Lens | Cliff (Glide from The Terraces) | Vega |
| 10 | Spire Heights | downtown (new) | −5…−2, −6…−3 | The Solar Spire (skyline-tower model, scaled) | rich Glass and Gears | A collapsed skybridge across the only avenue (Climb over it) | Atlas |

- Regions 1–4 form a pinwheel round the park. The beach is open from the start; Mast Row, Old Market and Elder Grove each sit behind a barricade, and any of them can be opened first.
- **The `beach` area type:** sand ground, a band of shallow surf that can be waded, then open sea that nothing crosses. Props: driftwood, barrels, mooring posts, crates. It can be restored into dune grass and sea flowers.
- Pulse cost multiplier: ring 1 (regions 1–4) ×1.0, ring 2 (5–7) ×1.2, ring 3 (8–10) ×1.4.
- Every other land chunk inside the Old City is a **backstreet**: generated street ground with no landmark, loose Scrap and cat nooks. Its fog lifts when a neighbouring region's gate is opened. Restoring it is optional.
- Region ground is still generated by area type. What is authored per region is a list of set pieces at fixed cells: the landmark, the Keeper, the seam, salvage piles, the gate, two caches, two journal pages, ladders and perches, and the patch for the Keeper's second request.
- This is generation 5 (`GROUND_GEN`), used only under old-city rules. Roads keep a clear avenue from the park to each ring-1 barricade.
- Sealed-area prices (`TUNING.city.unlock`) are not used inside the Old City.

### Height
Today all ground is flat at one height; only rooftops are raised. The Old City gets **terraced ground**, like the plateaus in Dreamlight Valley: flat levels with cliffs between them, joined by ramps and stairs.

- Every ground tile has a `level` from 0 to 4. One level is 1.2 tiles high. Levels come from generation (a pure function of the cell, never saved), under old-city rules only; classic stays flat.
- **Moving between levels:** only by a ramp (one level over 3 tiles), a stair (one level over 2 tiles, one tile wide), a ladder on a cliff face (Climb), or a perch (Glide). A cliff edge blocks walking both ways. Bloombot never falls.
- **Building:** a machine, chest or decoration needs every tile of its footprint on one level and not on a ramp or stair.
- **The simulation is otherwise unchanged:** pulses, spread, chains and helpers treat neighbours as neighbours whatever their level. Height changes walking, building, looking and nothing else.
- Cliff faces draw as old retaining walls (brick and stone) that grow ivy and hanging plants once the ground above is restored.
- Water sits at the level of its bed. The sea and the canals are level 0. A level drop along a canal is a weir with falling water.
- **Lookouts:** one per region, a set piece on a cliff edge with a bench. Interact plays a short vista across the city. They are the best places to spot beacons and caches.

| Place | Levels | Shape |
|---|---|---|
| The park | 1 | A low rise. Broad steps lead down to the beach, so the sea is seen from the fountain |
| Saltwind Beach | 0 | Dunes falling to the tide line; the Sea Lock at the canal mouth |
| Mast Row | 1 | Level street; one raised tram embankment |
| Old Market | 1, with a sunken square at 0 | Steps down into the market square |
| Elder Grove | 1 → 2 | The Elder Tree on a hill; its lookout faces the park |
| Cistern Basin | 0 inside a rim at 1 | A sunken basin; the cistern on an island |
| Clock Plaza | 2 | A grand stair up from the lock bridge |
| The Terraces | 2, with roofs above | Roofs stepped up a slope |
| Glasshouse Gardens | 2 | Across a ravine (level 0) spanned by the broken bridge |
| Observatory Hill | 3 → 4 | The highest ground in the city, behind a cliff; reached by gliding from The Terraces |
| Spire Heights | 2 at street level; towers rise to 12 | A downtown of five towers on a raised plateau; the Solar Spire is the tallest thing in the city |
| Backstreets | Blend between neighbours | Ramps on avenues, stairs in alleys |

### Spire Heights: skyscrapers to climb and decorate
The north-west of the Old City is a downtown of five glass towers, dead and dark at the start. It is the climbing and decorating showcase, and the Solar Spire is visible from everywhere.

**Getting there:** a collapsed skybridge blocks the only avenue in from Elder Grove's side. Bloombot climbs over it with Climb (tier 3). Spire Heights is in ring 3, so the earliest it opens is tier 3.

**The towers** (heights in levels of 1.2 tiles; each tower is a stack of raised layers like today's rooftops)

| Tower | Footprint | Floors with a terrace | Top | Climbing |
|---|---|---|---|---|
| The Solar Spire (landmark) | 6 × 6 | 4, 6, 8, 10, 12 | Crown platform with the landmark core | Ladders up to 8, then an outside stair spiralling to 12 |
| Glass Tower | 5 × 5 | 4, 6, 8 | Roof garden | Ladders and scaffold |
| The Twins (two towers) | 4 × 4 each | 4, 6 | Joined by a skybridge at 6 | Ladders; the skybridge needs repairing (20 Copper, 10 Gears) |
| Old Exchange | 6 × 4 | 4 | A wide roof plaza | Outside stair |

- **Terraces** are open floors running round the outside of a tower, three tiles deep. Each is its own layer with restorable ground (dead planters and cracked paving), salvage piles (Glass, Gears, Scrap), and sometimes a cache or journal page.
- **Climbing a tower:**
  - Ladders between terraces need Climb. Outside stairs can be walked.
  - Each tower's **lift** is dead until the Keeper's landmark delivery. After that, Interact at the lift rides to any terrace already visited.
- **Gliding:** every tower top and its highest terrace has a perch. From the Spire's crown, glides reach the park, Observatory Hill and The Terraces. With the Long Glide blueprint, glides from any tower top reach twice as far.
- **Decorating:**
  - Every terrace and roof is open to decorations once half of its ground is restored. The limit is 60 per tower, or 120 on the Spire.
  - The roofs of Glass Tower and the Old Exchange each hold one 4 × 4 garden where any plot option can be planted.
  - Restored terraces light up at night, and the towers' windows light up floor by floor as each terrace is restored. This shows on the skyline from the park.
- **Restoring:** the region is ready to wake when half of all its restorable tiles (street, terraces and roofs together) are restored and the second request is done. Bloombot's share counts tiles on terraces too.
- **Never falling:** terrace edges have railings. Bloombot can only leave a terrace by stair, ladder, lift or glide.
- **Models:** each tower is built from the `skyline-tower` GLB scaled up, with procedural terrace floors and railings, plus the existing building kit. The towers are drawn as close meshes inside Spire Heights and as skyline impostors everywhere else.

## 8. Keepers
Each region has one dormant robot near its entrance.

1. **Wake it:** pulse it and hand over 5 of anything. It introduces itself and marks the seam and the landmark on the minimap.
2. **First request:** bring something from another region.
3. **Second request:** restore a named patch in the region.
4. **Wake the landmark** with a delivery. The region is cleared, the Keeper starts wandering it, the seam accepts a Reclaimer, and the region gives a lasting reward.

| Region | First request | Second request (restore) | Landmark delivery | Lasting reward |
|---|---|---|---|---|
| Mast Row | 8 Seeds | The tram stop | 20 Copper, 10 Scrap | Every landmark beacon shows on the minimap |
| Old Market | 10 Timber | The market square | 20 Glass, 10 Timber | Tally trades 3 for 1 |
| Saltwind Beach | 10 Copper | The boardwalk | 20 Timber, 10 Copper | The lock bridge to Clock Plaza rises; canals fill |
| Elder Grove | 10 Glass | The ring of stumps | 20 Seeds, 40 Biomass | Loose Seeds piles give double |
| Cistern Basin | 12 Gears | The spillway | 30 Clay, 15 Copper | Water storage doubled |
| Clock Plaza | 12 Glass | The plaza | 30 Gears, 15 Glass | Helpers work 25% faster |
| The Terraces | 15 Clay | The roof garden | 30 Sunstone, 15 Gears | Energy storage doubled |
| Glasshouse Gardens | 15 Sunstone | The nursery beds | 40 Glass, 40 Seeds, 20 Clay | The Heart Seed |
| Observatory Hill | 20 Glass | The hilltop | 40 Sunstone, 30 Copper, 20 Gears | The Star Lens; caches show on the map |
| Spire Heights | 20 Clay | Spire Square, at the foot of the towers | 40 Glass, 30 Gears, 20 Sunstone | Every tower lift runs; the Spire's top becomes a travel point |

- Keepers speak in short speech bubbles of one to three lines. No voice, no choices.
- One request is pinned in the objective card at a time; the backpack's Requests tab lists the rest.
- Under old-city rules, area specialty milestones (`Milestones.ts`) are not used in regions.

## 9. Restoring a region: bloombot first
- A region is ready to wake when half its restorable tiles are restored and the second request is done.
- **Bloombot's share:** drones, Cultivators and Mother Tree pulses do nothing in a region until bloombot has personally restored a quarter of that target. `AreaState.byBot` counts it.
- Helpers work in the park, in woken regions and in regions where the share is met. #287's "prefer tiles near bloombot" stays.
- Landmarks are always woken by bloombot, by hand.

## 10. Caches, blueprints and the journal
- Two caches per region (20), in out-of-the-way spots. Interact opens one.
- One cache in each region holds a **blueprint**; the other holds a **keepsake decoration** (one per region, from existing models, listed in `oldcity.ts`).
- The Upgrades drawer becomes the **Workbench**. It stands at the fountain until the house reaches level 1, then inside the house. Each upgrade has at most 3 levels. Level L costs 10 × L Scrap and 8 × L of the group's material: Pulse → Copper, Machines → Gears, Drones → Glass, Storage → Timber, Networks → Sunstone, Fog → Clay.
- Blueprints, one per region in map order: Networks group; Fog group; level 3 of Pulse; level 3 of Machines; level 3 of Drones; level 3 of Storage; Reclaimer Mk 2 (12 a minute); Pack Frame (+40 to every stack); Sprint Servos (sprint 4.6 → 5.6); Long Glide (glides from a tower top reach twice as far).
- **Journal:** 22 pages (two per region, two in the park) telling what happened to the city. Each is two or three sentences.
- **Lucky Cat rewards** under old-city rules: 10, 25 or 60 of the local material for a standard, Golden or Rainbow cat. Keepsakes are unchanged.

## 11. Bloombot's house
A ruined shed stands in the park, north-west of the fountain (set in `PARK_LAYOUT`). From tier 1, Interact at its door opens the house panel; each level is a delivery.

| Level | Delivery | Outside | Inside | Gives |
|---|---|---|---|---|
| 1 Shed | 15 Scrap, 10 Timber | Patched shed | 6 × 6 room | A bed, a storage chest, the Workbench moves in |
| 2 Cottage | 30 Timber, 20 Glass, 20 Clay | Cottage with a porch | 8 × 8 | Keepsake shelf; Journal desk; 40 decorations inside |
| 3 House | 40 Gears, 40 Copper, 30 Glass | Two storeys, lit windows at night | 10 × 10 | A 6 × 6 fenced garden outside for free planting; 80 decorations |
| 4 Home | 40 Sunstone, 60 Timber, 40 Clay | Roof garden and a weathervane | 12 × 12 | Travel home from anywhere on the map; 140 decorations |

- **Inside is its own layer** (`home`), entered through the door with the same ride used by the rooftop lift. The room is a flat floor with walls; walls facing the camera are hidden.
- Decorations can be placed inside (the cozy layer's ground-only rule is lifted for `home`). Floor and wall colour: 6 choices each, free.
- **The bed** skips to 6:00 the next morning (§12). It does nothing else.
- The outside is built from the existing building kit in four stages, so no new model is needed.

## 12. Day and night
- One day is 24 real minutes: day 16, dusk 2, night 4, dawn 2. A new game starts at 8:00.
- Time of day is derived from sim time plus `salvage.clockOffset` (changed only by the bed), so it is deterministic and adds no ticking state. Under classic rules it is always day.
- **No penalties.** Solar panels, helpers and pulses work the same at night.
- At night: lamp posts and lanterns on restored ground glow, woken landmarks and house windows light up, beacons are brighter, fireflies come out, Keepers stand still and doze (they still answer), and the music drops to its quiet layers.
- Light budget: glows are emissive; at most 8 real lights, the nearest to bloombot; no extra shadow casters.
- A small clock sits beside the minimap. Settings: day length 24 min, 48 min, or always day.

## 13. Weather
- Kinds: clear 50%, cloudy 20%, rain 15%, mist 10%, windy 5%. A new kind is rolled every 6–12 minutes from its own seeded stream (as world events have), saved as `salvage.weather = {kind, until}`.
- Region lean: Saltwind Beach doubles windy; Cistern Basin doubles mist; The Terraces and Observatory Hill double clear.
- **One game effect:** in rain, water income is doubled. Everything else is looks and sound: wet ground and puddles, rain on water, mist that shortens the view, swaying foliage and blown leaves in wind, a rainbow when rain ends in daylight.
- Under old-city rules the "rain" world event is removed in favour of weather.
- Inside the house, weather is heard, not seen. Settings: weather effects full, light or off (the rain bonus stays).

## 14. The camera
A third-person orbit camera made for walking and looking.
- **Orbit:** full turn left and right; pitch from 20° to 60°, default 35°. Pad: right stick, both axes. Mouse: hold the right button and drag.
- **Zoom:** three steps: close 2.4, normal 3.2 (today's), far 5.0.
- **Follow:** 0.15 s smoothing, looking 1.5 tiles ahead of where bloombot is walking. After 3 s of walking with no camera input it drifts back behind bloombot (a setting, on by default).
- **Seeing bloombot:** anything between the camera and bloombot (buildings, trees, tall props) fades to 30%. The camera never jumps in to avoid a wall.
- **Places:** on roofs, hovering and gliding it eases to the far step and back. Inside the house it is a fixed dollhouse view with orbit limited to 90° steps.
- **Vistas:** the first time a region's gate opens, the camera rises for 2 s to show the region and its landmark, then returns. Skippable; off with reduced motion.
- **Build mode** keeps the same camera (no pull-back), as decided on #245.
- Settings: sensitivity, invert X, invert Y, auto-recentre, vistas.
- View distance and budgets (#272) are re-measured at the far step on the Deck preset.

## 15. Finding your way
- Every Old City landmark has a dim amber beacon and a silhouette that show above the fog from anywhere in the Old City, drawn as far impostors by `Skyline.ts`. It brightens when the landmark wakes.
- The minimap has fog of war. A beacon bloombot has seen shows as "?" until visited.
- **The region map** replaces the city overview under old-city rules. It shows the whole Old City as ten labelled regions and the sea. A region is under cloud until its gate is open. Selecting one shows a card: its name, what is in the way, its material (once seen), its Keeper (once met), how much is restored, and its pinned request. Woken landmarks and the house are travel points.
- The advisor suggests, in order: the pinned request, a fountain tier that can be delivered, a landmark that can be woken, an unvisited beacon, then nothing. Potter pace still hides it.

## 16. The first 15 minutes
1. A small boat brings bloombot to the Landing, a jetty on Saltwind Beach a short walk below the park's south steps. Bloombot steps ashore, walks up the steps, and wakes the dry fountain's first spark. The arrival takes about 20 s and can be skipped. The beach is open to explore from the start.
2. Salvage a rubble pile. The tile under it is now bare.
3. Pulse four tiles.
4. Find Seeds in the broken pots.
5. Restore 60 tiles (starter lamp, Harvest Sunlight).
6. Deliver 20 Scrap and 6 Seeds: water returns, bloombot gets Pry.
7. Build a Solar Panel.
8. Three beacons show through the fog to the north, east and west, and the Sea Lock stands at the far end of the beach. Pry open any of the four barricades.
9. Wake the Keeper there.

No step mentions clicks, taps, rates or upgrades. The intro card and `hintFor()` are rewritten to match; the stale `TUTORIAL` array is deleted.

## 17. The finale and the Outskirts
- The tier-5 delivery plays the Great Bloom: the fog lifts off the whole island, every landmark lights, the sea mist clears, and the Long Causeway rises out of the water to the mainland.
- Across the causeway is the mainland: every chunk with x ≥ 9 (the chunks between are sea, except the causeway along z = 0). It goes on for ever under today's rules: sealed areas bought with biomass and energy, specialties, merging, superstructures, Frenzy, all world events, district blooms. Old-city recipes keep applying to machines.

## 18. The idle layer before the finale (old-city rules)

| System | Before tier 5 |
|---|---|
| Frenzy | Hidden; overflow charges nothing |
| Merging, superstructures | Hidden |
| World events | Migration only (rain is weather) |
| District blooms | Off |
| Offline progress | On: biomass, energy, water and Reclaimers; "your helpers kept the garden going" |
| Bloom Chains | On; they pay biomass |
| Drone roles | On from tier 2 |
| Machine price growth, permits, sealed prices | Off |
| Resource bar | Energy and water; everything else is in the backpack |

## 19. Proof
- **Walking bot** (`npm run bot:oldcity`, seeds 7 and 21). Targets: tier 1 in 8–12 min; first landmark in 25–40 min; tier 2 in 50–80 min; tier 3 in 2–3 h; tier 4 in 3.5–5 h; tier 5 in 6–9 h. Never more than 3 minutes with nothing reachable to do.
- **Enough to go round:** for every material, the loose yield reachable before its Reclaimer is at least 1.5 times what tiers, landmarks, requests, house levels and one of each machine ask for by then.
- **Reachability:** from a new game, every pile, cache, page, Keeper and landmark can be reached with the abilities held at the tier that needs it.
- **Determinism:** same seed and inputs give byte-identical saves under both rule sets; classic saves and tests are unchanged.
- **Budgets:** the Old City with everything restored, at night in rain, meets the Deck preset's targets (`npm run test:perf:browser` at `?gfx=deck`).

## 20. Order
**Milestone A, the slice (park, house level 1 and Mast Row):** E21.0 → E21.1 → E21.2 → E21.3 → E21.4 (park and Mast Row only) → E21.24 (height) → E21.5 (barricade) → E21.6 (tier 1) → E21.8 (Pylon) → E21.9 → E21.12 → E21.22 (camera). Run the full suite; the owner plays it.

**Milestone B, the whole city:** E21.7, E21.10, E21.11, E21.13, E21.18, E21.19, E21.20, E21.21 in any order; E21.26 (the island) early; E21.14 → E21.15 → E21.16 (the rings); E21.25 (Spire Heights) after E21.7; E21.17; E21.23 last.

E22 (controls and UI) can run alongside from the start; E22.1 should land before Milestone A is played.

## Done when
- A new game can be played from waking up to the Great Bloom with bloombot, once on a gamepad and once on keyboard and mouse, without buying fog, opening an upgrade drawer or seeing Frenzy.
- All ten regions differ in material, landmark, obstacle and Keeper, and each can be recognised from the park by its silhouette. The beach can be reached within two minutes of tier 1.
- The city has real height: the sea is seen from the park, Observatory Hill is the highest ground, and the Solar Spire is the tallest thing on the island.
- It feels like an island: sea on every side, a boat arrival, and a causeway to the mainland at the end.
- Each of the five towers in Spire Heights can be climbed to the top and decorated on its terraces.
- The house can be taken from shed to home and decorated inside.
- A full day, a night and every kind of weather can be seen in one hour of play.
- The walking bot meets §19's targets on both seeds.
- A save from before E21 loads and plays as before.
- The owner has played the slice and the whole city.

## Out of scope
People, combat, hunger or a battery for bloombot, crafting chains, conveyors, multiplayer, voice, phones and tablets, new paid models, seasons, rebalancing classic rules.

## Replaces or changes
- #287 (helpers work around bloombot): its drone preference stays; its open numbers question is settled by §9.
- #245 (E19): "no residents" now reads "no people"; Keepers are robots. Decorations may be placed inside the house.
- Region unlocks (#306): prices apply only in the Outskirts and under classic rules.
- Follow camera (#238) and view distance (#272): superseded by §14.
