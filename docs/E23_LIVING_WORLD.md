# E23: A living world — restore it with nature, for wildlife

Epic #354. The GitHub issues are the source of truth for status; this doc is the reference for what to build. Each heading carries its issue number. **E23 overrides E21 (`docs/E21_OLD_CITY.md`) wherever they disagree** (see "Changes to E21"). E22 (#337, controls and UI) is unchanged. This doc names actions (Interact, Pulse), never keys.

## Goal
Solarbloom is a cozy sandbox about exploring, restoring and building, with the idle layer gone for good. Bloombot restores a foggy island as its maker's last wish, builds a small working farm at home, and wires power and water across the regions. Day and night, weather, a short farm chain, crafting and research give the world its rhythm. The reward is a place alive enough that its wildlife comes to sit with the robot that brought it back.

Four influences: **Oxygen Not Included** (systems that depend on each other), **Satisfactory** (building, automating, wiring regions together), **Merge Mayor** (regions under cloud, each with a speciality) and **Disney Dreamlight Valley** (a cozy hero, friends, a home, decorating and gifts). What is ours: the pulse and Bloom Chains, painting a dead city back to life and choosing what grows.

Builds on E20 (#283) and E21 (#312).

## The story
Humanity wrecked the world by working against it, and is long gone. The old city ran on machines that only took: they pumped the water dry, stripped the soil and burned what they couldn't use. The fog was the world's answer. One maker stayed to the end and built machines that work *with* the world. Bloombot was his last creation, and restoring the world was his last wish: not for people, but for the world and its wildlife. He is never seen, only his handwriting, drawings and half-built projects. **No humans appear in the game.** The Keepers (other robots) are bloombot's friends and the only characters.

**Theme: give back what you take, and restore with nature instead of bending it to your will.** The systems tell the story: compost returns what crops take, water runs down and comes back with rain, power comes from sun and wind.

## The loop
explore → run low on charge → extend the grid → restore the region → gather biomass and food → feed bloombot, compost it or digest it → grow and power more → push further.

| Timescale | What I do | What I get |
|---|---|---|
| Seconds | Walk, pulse dead ground, watch chains bloom, pick up salvage | The world coming back |
| Minutes | Fill the backpack, carry it home, craft, build, lay pipes and poles | A home and farm that work better |
| A session | Reach a region, clear its obstacle, restore my share, wake its Keeper, extend the grid | A region that is alive, powered and mine |
| The whole game | Fountain tiers and Keepers unlock abilities, regions and systems | The Great Bloom, then the endless mainland sandbox |

## Rules for the whole epic
1. **One rule set.** No classic rules. Pre-release saves are dropped (the owner is the only player): bump `SAVE_VERSION`, no conversion.
2. **Cozy wins every tie.** A shortage is a puzzle, never a loss. Out of power, machines switch off one at a time and come back by themselves. Out of water, land fades from lush to plain restored ground, never back to dead ground, and crops never die. Bloombot never gets stranded. Weather never destroys anything. Animals are never hurt.
3. **No idle mechanics anywhere.** No offline progress (the world pauses when closed), passive income, multipliers, big numbers or buying fog.
4. **No resource counters in the HUD.** Bloombot's charge is the only meter. Biomass, food, compost and fertiliser are backpack items. Power and water are networks shown in the world and in build-mode overlays.
5. **A game day is 48 minutes of play.** Every timer counts in game days, never real days, in both clock modes.
6. **Two short chains, no deeper.** Farm: water → food → compost → fertiliser. Crafting: material → component → machine. No conveyor belts: items move by drones between chests; fertiliser moves through pipes.
7. **Systems unlock one region at a time**, handed over by each Keeper. Ring 1 unlocks don't depend on each other.
8. **The Lucky Cats stay hidden** (E20). Nothing in this epic hints at them: not the pulse ripple, not companions, not the HUD.
9. **All numbers live in data** (`src/data/`), as starting values for tuning.
10. **From E21:** desktop and Steam Deck only, full controller support for every new panel, calm HUD by default, real models for every new object (no stand-ins). Work lands on `testing`, then `testing` → `main` when the epic is done. `npm test` per ticket.
11. **Show, don't tell, except when introducing a new concept.** The world explains itself: water levels on the water, dark machines, wilting planters, animals that come to visit. A new concept gets one short introduction the first time it appears. After that, no tooltips, toasts or lectures.

---

## 1. Strip the idle layer — E23.1 (#355)
Remove every system that exists only to serve the idle economy, so one rule set and one save format remain.

Done when: no offline payout, Frenzy, merging, superstructures, world events, multipliers, big numbers, buying fog or per-second readouts remain in code or UI. `npm test` passes with the removed systems' tests deleted, not skipped.

### 1.1 One rule set — drop classic rules and old saves (#365)
- Do not build E21.0's `rules: 'oldcity' | 'classic'` split. New games are the Old City.
- Bump `SAVE_VERSION` in `src/app/SaveService.ts`. A save from an older version is discarded with a calm "starting fresh" message. No conversion.
- Delete code paths and tests that exist only for the old fountain rules, sealed-area prices and permits.
- Done when: loading an old save starts a new game without errors; no `classic` branch remains in `src/`.

### 1.2 Remove Frenzy, merging, superstructures, world events and modifiers (#366) — DONE (closed, merged in PR #476)
- Deleted `FrenzySystem`, `MergeSystem`, `SuperSystem`, `WorldEventSystem`, `Modifiers`, `EconomyLedger` and their wiring in `Sim.ts` and `Game.ts`, plus their HUD, toasts, VFX hooks, Advisor suggestions, DevTools commands, save fields and tests.
- **1.2.1 Frenzy and Modifiers (#408), done.** Anything that read a modifier (drone speed, pulse reach, production) uses its base value.
- **1.2.2 Merging and superstructures (#409), done.** Merge previews, Superstructure Cores and abilities gone. Machines are one tier. Research (§6.2) is the only way to improve them.
- **1.2.3 World events and the economy ledger (#410), done.** Weather takes over the role of events.

### 1.3 Remove offline progress (#367) — DONE (closed, merged in PR #476)
- `OfflineSystem` and the welcome-back payout deleted. The world pauses when closed; nothing is earned or lost while away.
- Transitions and Cultivator work in progress resume where they stopped.

### 1.4 Plain numbers and no resource bar (#368)
- Replace `src/core/Big.ts` and `break_infinity.js` with plain integers. Remove the dependency from `package.json`.
- Remove the energy, water and biomass counters and per-second readouts from the HUD. Bloombot's charge (§2.1) is the only meter.
- Passive income in `ProductionSystem` stops. The grid and water simulation (§3.1, §4.1) replace it.
- Done when: `break_infinity.js` is not in the bundle; the walking HUD shows no resource numbers.

### 1.5 Remove buying fog, milestones and the upgrade drawer; rewrite the Advisor (#369)
- Remove buying sealed fog with biomass and energy, area specialty `Milestones`, and the exponential `UpgradeSystem` drawer. Research (§6.2) replaces upgrades. Regions open through abilities and Keepers.
- Keep the Advisor's hint system. Rewrite its suggestions around the new loop: charge, grid, water, farm, the next Keeper.
- Done when: no price grows with purchases anywhere; every Advisor hint refers to something in the new loop.

### 1.6 Commit the design doc (#370)
- Commit `docs/E23_LIVING_WORLD.md` (this doc) with the epic's text, the full tables from its sub-epics and the changes to E21. Link it from `README.md` and `docs/E21_OLD_CITY.md`.
- Done when: the doc is on `testing` and linked from both places.

---

## 2. Bloombot — charge, the loaded pulse, resting and wildlife — E23.2 (#356)
Bloombot runs on a charge, paints the land with a pulse you load, and can stop to enjoy a world that comes to visit. Done when charge, pulse loads, benches, meditation, wildlife visits and companions all work with a gamepad and keyboard.

### 2.1 Bloombot's charge (#371)
- One meter, the only number on screen. A full charge lasts about **10 minutes of active play**.
- **Costs charge:** pulses, abilities, sprinting. **Free:** walking. Sprinting on a path costs less (§6.7).
- **Refills:**

| Way | Speed | Cost |
|---|---|---|
| Eat biomass or food, anywhere | Slow | Uses items (food gives more than biomass) |
| Sit on a bench | Trickle | Free |
| Meditate at a charger (on the grid, §3.3) | Fast | Free |
| Sleep in the house | Full | Skips the night |

- **At zero:** a low-power walk. Bloombot can walk anywhere but can't pulse or use abilities. Never stranded, nothing lost.
- Research (§6.2) adds battery cells for a bigger charge and better efficiency.
- Done when: a walking-bot run never ends stranded; the charge numbers live in data.

### 2.2 The loaded pulse (#372)
The pulse restores ground, and what you load into it decides what grows.

| Loaded with | What grows |
|---|---|
| Nothing | Plain grass and moss |
| Seeds | A wildflower meadow (biomass, pollinators) |
| A region's rare seed | That region's special plants |
| Fertiliser | Trees and full bloom, with a bigger radius |

- Bloom Chains still fire; chained tiles grow whatever the pulse was loaded with.
- Done when: each load produces its own visible result and the load item is used up; a test proves the ripple never reveals a Lucky Cat.

**2.2.1 Pulse load wheel and cost (#411).** A quick wheel (pad and keyboard) picks the load: nothing, seeds, a rare seed, fertiliser. A pulse uses a little charge plus one unit of its load. When the load runs out, the next pulse fires empty, so you're never stuck. Test covers load choice and costs on both input types.

**2.2.2 What grows from each load (#412).** Each load gives its own look and its own biomass and pollinator effects (table above). Chained tiles grow the same load.

**2.2.3 The reveal ripple (#413).** Every pulse sends a ripple that lights up nearby salvage, buried seeds and journal pages for a few seconds. It never reveals or hints at a Lucky Cat; a test proves its targets exclude every Lucky Cat.

### 2.3 Benches and meditating at chargers (#373)
- Restore old park benches or craft new ones (`bench` model exists).
- Sitting eases the camera out to a calm view, hides the HUD, lets the music swell, and offers to let time run faster. It trickles a little charge back.
- At a charger, bloombot sits cross-legged and meditates (new animation clip) while it charges.
- Keepers who are friends can sit beside bloombot on a bench.
- Photo mode works while sitting.
- Done when: sit and stand work on pad and keyboard, and the camera returns to where it was.

### 2.4 Wildlife visits by diversity (#374)
While bloombot sits, animals come over. The more diverse the area, the more come and the closer they get.

| Diversity tier | While you sit |
|---|---|
| Bare | Nothing, or a butterfly passes |
| Some variety | A butterfly lands on bloombot, a bird perches nearby |
| Lively | Birds on head and shoulders, a hedgehog or squirrel sniffs |
| Thriving | Animals climb on bloombot: a fox curls up beside it, a frog in its lap, birds nest on its head |
| Rare mix | Rare visitors only found in the most diverse places |

- Animals are wild: no taming from visits alone.
- Done when: visits scale with diversity in a test, and the same area always gives the same tier.

**2.4.1 Area diversity score (#414).** A number per area from the existing `Ecosystem` biodiversity inputs: kinds of plants, how much is in bloom, fauna arrived, wildlife homes built. Recounted only when the area changes. Five tiers as above. Deterministic tests for each tier.

**2.4.2 Visiting animals and climbing on bloombot (#415).** Visit behaviours per tier: pass by, land on, perch on head and shoulders, curl up beside, sit in lap, nest on head. Attach points on bloombot's rig. Animations for approaching, settling and leaving. Each tier plays on a bench and at a charger without clipping.

**2.4.3 The visitor log (#416).** A page in the backpack screen (E22.6): each visitor kind, where it was seen, rare visitors marked. Saves and shows correctly on pad and keyboard.

### 2.5 Animal companions (#375)
Some animals can become friends who travel with bloombot. Befriended, never tamed: the animal chooses you.

**2.5.1 Friendship (#417).** A friendship meter per kind of animal, filled by sitting near it, bringing its favourite food and restoring its habitat. Favourite foods in data. Each companion kind can be befriended in a test run.

**2.5.2 Follow and swap (#418).** One companion travels with bloombot at a time. Others live in their home habitats; swap there. Follow movement keeps up with walking, sprinting, hovering and gliding without getting stuck. If a home habitat fades, that companion goes home to look after it and returns when it's green again.

**2.5.3 Bonuses (#419).** Starting list, all in data, each with a test:

| Companion | Bonus |
|---|---|
| Fox | Finds buried salvage and seeds |
| Bumblebee | Speeds crops near bloombot |
| Hedgehog | Finds mushrooms and biomass |
| Magpie | Brings back scrap, gears or glass |
| Frog | Keeps ground near bloombot green longer when water is low |
| Owl | Shows night-only finds |
| Otter | Finds food in water and shows water levels |
| Squirrel | Plants wildflowers, so pulses use fewer seeds |
| Butterfly | Draws more and rarer visitors |

- **Gentle rule:** a companion never leaves for good and never needs feeding to survive.
- **No companion bonus reveals or hints at a Lucky Cat**; a test proves it.

---

## 3. The power grid — E23.3 (#357)
Power is something you build into the world, not a number. Done when networks of sources, storage and consumers work across regions, and their state shows on the machines and in the overlay.

### 3.1 Grid simulation (#376)
- Networks found by flood fill over poles in range (like `CanalNetwork`), cached until something is built or removed.
- Sources add supply; batteries take surplus and cover deficits; consumers draw.
- **Shed order when short:** lamps (grid lights) → pumps → helpers → chargers last. Everything comes back by itself.
- Deterministic and headless-testable. Tests cover surplus, deficit, battery charge and drain, and the shed order.

### 3.2 Solar panels, wind turbines, batteries and power poles (#377)

| Piece | Behaviour |
|---|---|
| Solar panel | Daytime only; cloud −20%; none at night |
| Wind turbine | Only on windy days and in storms; built on high ground |
| Battery | Stores surplus, covers the night |
| Power pole | Links automatically within range. `RelaySystem`'s Bloom Relays become power poles |

- Region strengths (§8.1): about 1.5× for a matching machine in its region.
- Done when: a small home grid runs through a full day and night on solar and batteries.

**3.2.1 Solar panels and batteries (#420).** Solar output by time of day and weather (cloud −20%, none at night). Battery charge and discharge. A home grid runs through a full day and night.

**3.2.2 Wind turbines (#421).** Output on windy days and in storms, more on high ground and in wind-strength regions. Test: output follows the weather.

**3.2.3 Bloom Relays become power poles (#422).** Reuse `RelaySystem` for the grid's links. Poles link automatically within range. Relay chain-carrying is kept, so Bloom Chains still pass through poles. Existing relay models become pole models where they fit.

### 3.3 Chargers and powered helpers (#378)
- Charger: bloombot sits and meditates (§2.3) and refills fast.
- Drone hubs, Cultivators and lamps need grid power and stop gently without it.
- Helpers still only work where bloombot has restored its share (E21.9).
- Done when: extending poles into a new region lets you recharge there and switch on helpers.

### 3.4 The Power overlay (#380)
- Build-mode toggle: poles and their links, what each network powers, battery levels, which machines are dark.
- Works on pad and keyboard and reads clearly at night.

### 3.5 Night lighting (#471)
Craft and place lights anywhere. They come on by themselves at dusk, so the island glows at night.
- Crafted at the crafting table, placed in decoration mode.
- **On poles and lines:** festoon bulbs strung between poles, fairy lights, paper lanterns, hanging glass lanterns (reuse `lantern`).
- **Free-standing:** lamp posts (reuse `lamp-post`), path and bollard lights (reuse `bollard` where it fits), garden lanterns, uplights for trees and landmarks, wall and porch lights for the house and ruins, lights on tables and benches.

| Power | How |
|---|---|
| Grid | Placed within reach of a pole |
| Solar garden light | Own tiny panel and battery; works anywhere with no grid. Dimmer, and shorter-lived after a cloudy day |
| Glow-pod | Grown from a bioluminescent plant; needs no power |

- Turn on by themselves at dusk and off at dawn, fading in gradually. Also on in fog and storms. No switch, no menu.
- Grid lights are first in the shed order (§3.1): they dim and go out gently, and come back when power returns.
- Warm and low. Fireflies and moths gather near them at night. They never scare wildlife.
- **Cost:** components (Wire, Glass pane; Sun cell for solar lights). New styles from Decor research and finds.
- Lights can share a line with overgrowth (§6.6), e.g. vines with fairy lights.
- Done when: each kind crafted and placed on pad and keyboard; fade on at dusk and off at dawn in both clock modes; grid lights dim on a short grid and solar lights dim after a cloudy day; a night scene with many lights stays within the Deck preset's budgets.

---

## 4. The water network — E23.4 (#358)
Water is a network you build, and it runs out and comes back. Done when ponds, canals and reservoirs drain with use and refill from rain, springs and desalination, and land fades and recovers around them.

### 4.1 Water levels (#381)
- Every pond, canal and reservoir has a level.
- **Draws:** pumps, planters, Gardener drones and Cultivators draw from the water they're connected to. Sunny days add a little evaporation.
- **Refills:** rain fills everything; Cistern Basin's springs top up their own water; desalination plants (§4.3).
- Levels are visible on the water itself.
- Tests cover draw, evaporation, rain and springs over several game days.

### 4.2 Reservoirs, pumps, pipes and gravity feeds (#382)
- Canals stay the big water: restoring one still brings water to an area and can fill a reservoir on its bank.
- Done when: a planter far from water can be fed by pump and pipe, and by gravity from higher ground.

**4.2.1 Reservoirs (#423).** Storage with a visible level, filled by rain, canals on its bank, pipes and springs. Fill and drain work over game days.

**4.2.2 Pumps and pipe placement (#424).** Pipe laid tile by tile in build mode, with corners and junctions, separate from the world's canals. Pumps draw grid power and push water uphill or across distance.

**4.2.3 Gravity feeds (#425).** A reservoir on higher ground feeds pipes below with no pump (uses E21.24 height). Works with the grid switched off.

### 4.3 Desalination plant (#383)
- Built on any shoreline. Turns seawater into fresh water on grid power, in any weather. A heavy load on the grid.
- Outputs into a pipe, canal or pond on the network.
- Unlocked in Cistern Basin. Recipe: 10 Scrap, 4 Pipe, 4 Glass pane, 2 Wire.
- Done when: a farm can be kept alive through a dry spell with a plant and enough power.

### 4.4 Land fades around low water (#384)
- Ground near an empty pond or canal dries out step by step: lush bloom fades to plain restored ground, flowers close, planters wilt.
- **Never back to dead fog-ground. Nothing built or planted is lost.** Refilling the water greens it all up again.
- Test: drain a pond; no tile drops below restored and no crop is removed.

### 4.5 The Water overlay (#385)
- Build-mode toggle: pipes, flow direction, reservoir and pond levels, dry planters. Works on pad and keyboard.

---

## 5. The farm — E23.5 (#359)
A small working farm that feeds bloombot and fertilises the land. Done when water → food → compost → fertiliser works, with variety in crops and other things to tend.

### 5.1 Biomass, food, compost and fertiliser as items (#386)

| Item | From | Used for |
|---|---|---|
| Biomass | Clippings, leaves and spent crops gathered from restored ground | Charge, compost, the digester, some recipes |
| Food | Planters | Better charge than biomass; Keeper gifts and requests; compost |
| Compost | Compost bin | Becomes fertiliser |
| Fertiliser | Compost bin | Full bloom, big trees, rare flowers, landmark trees; a pulse load |

- Backpack items with stacks, like E21.1's materials.
- Done when: biomass no longer grows as a counter; it is gathered.

### 5.2 Planter boxes and crops (#387)
**5.2.1 Planter growth (#426).** Planter boxes grow food over game days while watered. Growth stages, watering, harvesting. Wilting pauses growth. **Crops never die.** Tests cover growth over game days and wilting.

**5.2.2 The crop set and what each likes (#427).** Growth times, likes (sun, rain, shade, night, running water, trellis, fertiliser, salt air) and uses in data. Likes change growth. Trellises and flooded beds are buildable extras. Test: every crop's likes change its growth.

| Crop | Grows in (game days) | Likes | Good for |
|---|---|---|---|
| Radish | 1 | Anything | — |
| Lettuce | 1 | Rain | — |
| Potato | 2 | Shade | — |
| Beans | 2 | Trellis | Less fertiliser needed nearby |
| Tomato | 3 | Sun | Keeper favourite |
| Sweetcorn | 3 | Sun, wind | Lots of biomass |
| Pumpkin | 5 | Fertiliser | Biggest charge |
| Sunflower | 3 | Sun | Seeds and biomass |
| Watercress | 2 | Running water only | — |
| Rice | 4 | Flooded beds | — |
| Lavender and mint | 2 | — | Bring pollinators |
| Moonflower | 2 nights | Night only | — |
| Flowers | 2 | — | Decoration, gifts |
| Sea kale | 3 | — (see Open questions) | Saltwind Beach seeds only |

**5.2.3 Seeds from exploring (#428).** Seeds found in salvage, caches and restored ground. Each region has at least one crop only found there. A reachability test finds every crop's seed.

### 5.3 Compost bin, fertiliser and the Bio Digester (#388)
- **Compost bin:** takes biomass and food scraps, makes compost, then fertiliser, over game days.
- **Fertiliser:** full bloom, big trees, rare flowers, landmark trees; a pulse load (§2.2). The chain stops here.
- **Bio Digester:** turns biomass into grid power, day or night, while fed. An empty one just stops. Biomass becomes a choice between plants and power.
- Done when: a night can be carried by a fed digester alone.

### 5.4 Beyond planters (#389)
More to tend, each plugged into an existing system. Wild creatures you attract, never livestock. Done when each works and raises its area's diversity.

| Thing | Issue | Rule | Done when |
|---|---|---|---|
| Beehive | #429 | Placed near flowers and herbs. Honey (a strong snack); faster crops in range | Honey and crop bonus work in a test |
| Fish pond | #430 | Kept filled from the water network. Water piped from it fertilises the planters it reaches | A planter fed from a fish pond needs no fertiliser |
| Orchard | #431 | Fruit trees planted once. Fruit every few game days; pruning now and then gives timber | Fruit and pruning work over game days |
| Mushroom log | #432 | Shade and compost; food that grows at night or in fog | Covered by tests |
| Worm bin | #432 | Fed scraps; compost twice as fast | Covered by tests |
| Wildlife homes | #433 | Bird boxes, bat boxes, hedgehog houses, butterfly gardens, each wanting the right habitat. Bring new fauna, raise diversity (§2.4) | Each attracts its creature in the right habitat |
| Keeper gardens | #434 | A plot near each Keeper; grow what it asks for. Requests give recipes, rare seeds or decorations | Each Keeper has at least one garden request |

---

## 6. Crafting, research, drones and automation — E23.6 (#360)
Make things at the crafting table, unlock more at the research station, and automate jobs you've done by hand. Done when every machine in the epic is crafted from a recipe and a fully automated farm can be built.

### 6.1 The crafting table and recipes (#390)
Raw materials become components; components become machines and decorations. Replaces E21.3's direct recipes.

**6.1.1 The crafting table (#435).** In the house from the start, with Craft and Upgrade tabs (E22 panel rules, full controller support). Crafting takes a few seconds and pays from the backpack, then the store. Works on pad and keyboard.

**6.1.2 Components (#436).** Recipes in data; a data test checks each.

| Component | Recipe | Makes |
|---|---|---|
| Wire | 2 Copper | 2 |
| Planks | 1 Timber | 2 |
| Glass pane | 2 Glass | (not stated) |
| Pipe | 1 Copper, 2 Clay | 4 tiles |
| Motor | 2 Gears, 1 Wire | (not stated) |
| Battery cell | 2 Scrap, 2 Wire | (not stated) |
| Sun cell | 1 Sunstone, 1 Glass pane | (not stated) |

**6.1.3 Machine and decoration recipes (#437).** Every machine recipe in data, unlocked by Keepers (core machines), research (upgrades and extras) or finds (decorations). Removing a built thing gives everything back. A data test checks every recipe names real items and is unlocked somewhere reachable.

| Machine | Recipe | Unlocked in |
|---|---|---|
| Planter box | 3 Planks | Home |
| Compost bin | 4 Planks, 2 Scrap | Home |
| Power pole | 1 Planks, 1 Wire | Mast Row |
| Charger | 4 Scrap, 2 Wire | Mast Row |
| Solar panel | 4 Scrap, 2 Glass pane, 1 Wire | Old Market |
| Wind turbine | 6 Planks, 4 Scrap, 2 Wire | Saltwind Beach |
| Storage chest | 4 Planks, 2 Scrap | Saltwind Beach |
| Beehive | 4 Planks, 2 Seeds | Elder Grove |
| Reservoir | 10 Clay, 4 Scrap | Cistern Basin |
| Pump | 6 Scrap, 2 Wire, 2 Clay | Cistern Basin |
| Desalination plant | 10 Scrap, 4 Pipe, 4 Glass pane, 2 Wire | Cistern Basin |
| Battery | 4 Battery cells | Clock Plaza |
| Bio Digester | 10 Scrap, 2 Motors, 4 Clay | Clock Plaza |
| Drone | 1 Motor, 2 Wire, 1 Glass pane | Clock Plaza |
| Large solar array | 4 Sun cells, 6 Scrap, 2 Wire | Observatory Hill |
| Assembler | 4 Motors, 10 Gears, 6 Glass pane | Spire Heights |

### 6.2 The research station (#391)
Turn what you find into recipes and upgrades. Replaces E21.10's fixed Workbench list and the upgrade drawer.

**6.2.1 Station and projects (#438).**
- At home, unlocked when the first Keeper wakes.
- Finding something new (material, crop, creature, old tech) and analysing it opens projects.
- A project takes materials and runs over game time on grid power; it pauses if power runs dry. One at a time; a second station can be researched.
- Done when: a project runs, pauses without power and finishes.

**6.2.2 Branches (#439).** At least three projects each, in data. Upgrades still cost materials, at most 3 levels each. Finished projects appear at the crafting table. A data test checks every project unlocks something real.

| Branch | Covers |
|---|---|
| Bloombot | Charge, efficiency, sprint, pulse radius, backpack |
| Power | — |
| Water | — |
| Farm | Crossbreeds, compost |
| Drones | Range, speed, carry, running cost |
| Decor | New overgrowth kinds, light styles, path materials (§3.5, §6.6, §6.7) |

### 6.3 What drones run on (#392)

| Role | Draws from its hub |
|---|---|
| Restorer | Power, biomass |
| Gardener | Power, water |
| Scout | More power |
| Courier | Power |
| Harvester | Power |
| Cultivator | More power, water |

- A hub needs the grid, a pipe for water roles, and a chest of biomass for biomass roles.
- Short supply: drones finish their job, dock and wait, and start again by themselves.
- Done when: starving a hub of each input stops only the roles that need it, and supply restarts them.

### 6.4 Automation (#393)
Jobs you've done by hand a few times can be automated. No conveyor belts. Each machine unlocks after the matching job has been done by hand a few times. Done when a fully automated farm runs a game day with no player input.

| Thing | Issue | What it does | Done when |
|---|---|---|---|
| Courier drones | #440 | Existing Courier role. Move items between chests on a route the player sets (pick source and target chests) | A route runs unattended for a game day |
| Mulcher | #441 | Gathers biomass from restored land in range into a chest, on grid power | Output matches its range and the land's growth |
| Hopper composter | #442 | Biomass and scraps from one chest, fertiliser into another | A planter line is watered and fertilised with no hand work |
| Feed tank | #442 | Mixes fertiliser into a pipe line, so every planter on it is fertilised | (as above) |
| Sprinklers | #442 | Water a patch from a pipe | (as above) |
| Harvester drones | #443 | Existing Gardener role, extended. Pick ripe crops into a chest | A planter row cycles for a game day unattended |
| Seed drills | #443 | Replant what was harvested | (as above) |
| Auto-feeder | #444 | Keeps a Bio Digester topped up from a chest | A digester runs a night unattended |

### 6.5 The Assembler (#394)
- Automation's last step. Crafts any known recipe from a chest of inputs into a chest of outputs, on grid power. Unlocked in Spire Heights.
- Done when: an Assembler line keeps a mainland build supplied with components.

### 6.6 Overgrowth — vines and plants on power lines, pipes and machines (#470)
In decoration mode, let nature grow over what you've built, so infrastructure looks like it belongs to the world.
- **Attaches to:** power poles and the lines between them, pipes, machines, chests, benches, fences, walls and ruins.
- **Kinds (starting set):** ivy, moss, flowering vines (clematis, morning glory), climbing roses, wisteria, hanging baskets.
- **How:** vines drape along power lines between poles; vines wrap along pipe runs; plants climb machines and walls at snap points. Generated along the object's shape (splines and snap points), so no hand-made model per object.
- **Grows in:** starts as a sprout and fills out over a game day.
- **Cost:** cuttings or seeds from plants you've grown. New kinds from Decor research (§6.2.2) and finds. Removing refunds the cost, like any decoration (E19.2).
- **Purely good:** never changes how a machine works. Each kind counts as plant variety toward its area's diversity (§2.4).
- Done when: each kind can be placed on a power line, a pipe run and a machine on pad and keyboard; it grows in over a game day and adds to diversity in a test; a heavily overgrown base stays within the Deck preset's budgets.

### 6.7 Paths — draw, curve, reshape and depave (#472)
- **Path tool in build mode.** Place points; the path follows a smooth spline through them. Drag points to reshape, add or remove points, set the width (narrow trail to wide promenade).
- **Materials (starting set):** gravel, stepping stones, old brick, wood chip, mossy cobbles, boardwalk (over shallow water and wet ground), sand trail (beach). More from Decor research and finds.
- **Edit existing paths:** reroute, repave, widen or remove the park's and regions' paths.
- **Depave the old city:** breaking up old asphalt and concrete turns it back into dead ground that can be restored.
- **Sits on the land:** follows terrain height (E21.24), with steps on slopes. Edges blend into grass; flowers and moss can creep on. Works with overgrowth (§6.6) and path lights (§3.5).
- **Reason to walk them:** sprinting on a path costs less charge (§2.1). No tooltip.
- **Under the hood:** stored as points, drawn as a ground decal, rasterised to tiles for walking, building and restoring, reusing `RoadRaster`. Removing a path refunds its materials.
- Done when: a curved path can be drawn, reshaped and removed on pad and keyboard; a park path rerouted and a stretch of old road depaved and restored; paths follow height and blend at the edges; a region full of paths stays within the Deck preset's budgets.

---

## 7. Time, weather and salvage — E23.7 (#361)
Day, night and weather drive the farm and decide what each day is good for. Done when a full day, night and every weather can be seen in one session, and each changes how the systems behave.

### 7.1 A 48-minute day, and "follow my clock" (#395)
Replaces E21.20's timing and its "no penalties at night".

**7.1.1 The day cycle (#445).** 48 minutes of play: **32 day, 16 night**. A game-day clock that every timer uses; a test proves every timer counts in game days.

**7.1.2 Follow my clock (#446).** Starting a new game from the menu asks: the game's own day, or follow my clock. Switchable in Settings. Both ship at launch. In follow-my-clock mode only sky, light and solar follow the real clock; timers still count in game days. A crop takes the same play time in both modes.

**7.1.3 Night content and sleeping (#447).** At night solar stops; batteries and the digester carry the grid. Night-only finds: fireflies, glowing plants, salvage; each appears only at night. Sleeping in the house skips to morning with a full charge.

### 7.2 Weather and the forecast (#396)
Every weather helps one part of the farm and challenges another. Replaces E21.21's effects. Weather never destroys anything.

| Weather | Helps | Challenges |
|---|---|---|
| Sunny | Solar at full | Planters dry faster, ponds evaporate a little |
| Cloudy | — | Solar −20% |
| Rain | Fills ponds and reservoirs, waters planters, ground blooms faster | Solar low |
| Wind | Turbines spin; blown leaves make biomass easy to gather | — |
| Storm | Turbines at full, fast refills, fresh salvage blown in | No solar; lightning can trip a pole, reset with one press |
| Fog | Fog-only finds and fauna | Shorter views |

**7.2.1 Weather effects (#448).** Every row in data, applied to solar, turbines, water, crops and salvage. Each effect has a test.

**7.2.2 The forecast (#449).** A weather vane or radio at the house shows the next game day's weather. It always matches the next day.

**7.2.3 Storms (#450).** Fresh salvage blown in; lightning can trip a power pole (reset with one press); nothing ever destroyed. A storm test proves nothing is lost.

### 7.3 Photo mode — time and weather (#397)
- Photo mode (E19.4.1) gets a time-of-day slider and a weather picker (sun, rain, fog, storm, golden hour), plus depth of field and filters if missing.
- Nothing set in photo mode changes the game. Leaving restores the real time and weather.

### 7.4 Salvage respawns (#398)
Finished regions stay worth visiting. Replaces E21.2's "piles never come back" and its Reclaimers.
- Piles refill slowly over a few game days. Storms blow in fresh salvage at once.
- Drop the Reclaimer and its offline income.
- Test: piles refill over game days and after a storm.

---

## 8. Regions and the mainland — E23.8 (#362)
Each region specialises, systems unlock region by region, and the mainland is an endless sandbox. Ring 1 is regions 1–4 (E21 §7).

### 8.1 Region strengths (#399) and 8.2 What each region unlocks (#400)
Each region has a natural strength as well as E21's material, which is why you link regions together. About **1.5× output** for a matching machine in its strength region (starting value). Strengths live in `src/data/oldcity.ts` and apply in a test. Systems arrive one region at a time, handed over by each Keeper; ring 1 unlocks don't depend on each other. A reachability test proves every unlock is reachable with the abilities held when it's needed.

| Region | Ring | Material | Strength | Unlocks |
|---|---|---|---|---|
| Home | — | — | — | Charge, eating, planter boxes, watering can, compost bin, crafting table |
| Mast Row | 1 | Copper | Wind | Power poles, chargers, wire |
| Old Market | 1 | Glass | Trade (swap materials, buy seeds) | Solar panels, lamps, trading |
| Saltwind Beach | 1 | Timber | Wind and tide, strongest wind | Wind turbines, storage chests |
| Elder Grove | 1 | Seeds | Fertile soil: faster crops, more biomass | More crop seeds, beehives, orchards |
| Cistern Basin | 2 | Clay | Water: springs refill for free | Reservoirs, pumps, pipes, desalination plants, flooded beds, gravity feeds |
| Clock Plaza | 2 | Gears | Machinery | Motors, batteries, the Bio Digester, mulcher, courier drones |
| The Terraces | 2 | Sunstone | Sun: more solar on roofs | Hopper composter, feed tank, sprinklers, roof gardens |
| Glasshouse Gardens | 3 | Seeds and Glass | Shelter: greenhouses ignore weather | Greenhouses, mushroom logs, harvester drones, seed drills |
| Observatory Hill | 3 | Copper and Sunstone | Sun and wind | Auto-feeder, large solar arrays, big batteries |
| Spire Heights | 3 | Glass and Gears | Scrap and metals: richest salvage | The Assembler, large reservoirs, turbine fields |

### 8.3 The endless mainland sandbox (#401)
After the Great Bloom, the mainland is where you build big. Replaces E21.17's idle Outskirts.
- No ceilings on building: large grids, long pipe runs, turbine fields, big farms.
- The best salvage: big fields that respawn fast.
- The same gentle-failure rules. No idle mechanics.
- Done when: a large build (hundreds of machines) runs within the Deck preset's budgets.

**8.3.1 Mainland generation (#451).** Endless land past the causeway in the island's style, using `Generation`, with fog, ruins and salvage fields, restored with the same tools and rules. Generates deterministically and streams in.

**8.3.2 Mainland materials and machines (#452).** Steel from industrial ruins; mainland-only machines (grid-scale batteries, long-range pumps) with recipes. Each has a recipe and is only found on the mainland.

**8.3.3 Performance for very large builds (#453).** Grid, water and drone simulation and rendering stay within the Deck preset's budgets with hundreds of machines. A perf test with a large saved build passes `npm run test:perf:browser` at `?gfx=deck`.

---

## 9. Story, friends and the ending — E23.9 (#363)
The player knows why they're doing this: to carry out the maker's last wish and bring the world back for its wildlife. Done when the story can be followed from arrival to the Great Bloom through the journal and the Keepers.

### 9.1 The maker's journal (#402)
Rewrites E21's journal pages.

| When | What you learn |
|---|---|
| Arrival | The maker's first note: "Start with the park." |
| Ring 1 | How the old city ran and what it took from the land |
| Ring 2 | How the fog came, and how humanity faded away |
| Ring 3 | The maker's plan for the Great Bloom, and what he never finished |
| Great Bloom | His last message |

- The maker is "he", never seen. No humans appear.
- Hopeful, never guilt-tripping. The game shows the theme through what you build and never lectures.
- Done when: every page is written and placed, and reachable in order.

### 9.2 Keepers as friends (#403)
- Each Keeper has a personality, requests and gifts (crops from §5 count).
- Arc: **from taker to tender.** Each remembers the old way; restoring its region shows it the new way.
- Woken Keepers hang around their regions, help out, and can sit with bloombot on a bench.
- Done when: each Keeper has an arc of at least three beats in data. Per Keeper: the arc plays from waking to friendship.

| Keeper | Region | Issue | Notes |
|---|---|---|---|
| Pylon | Mast Row | #454 | Personality, requests, gifts, arc in three or more beats |
| Tally | Old Market | #455 | Also trading |
| Tide | Saltwind Beach | #456 | |
| Moss | Elder Grove | #457 | |
| Sluice | Cistern Basin | #458 | |
| Tock | Clock Plaza | #459 | |
| Gable | The Terraces | #460 | |
| Fern | Glasshouse Gardens | #461 | |
| Vega | Observatory Hill | #462 | |
| Atlas | Spire Heights | #463 | |

### 9.3 The Great Bloom ending (#404)
Changes E21.17.
- The maker's last message. Wildlife floods back across the whole island. The Long Causeway rises to the still-fogged mainland, to keep restoring the world for wildlife (§8.3).
- No lights or people answer from the mainland.
- Done when: the ending plays from the last fountain delivery and leads into the mainland.

---

## 10. Proof and art — E23.10 (#364)
Prove the new loop paces well and stays gentle, and give every new object real art. Done when the walking bot passes, the gentle-failure tests pass, and every new object has its model.

### 10.1 Walking bot and gentle-failure proof (#405)
Updates E21.23's proof.
- **Walking bot** plays the charge, grid, water and farm loop. Never more than 3 minutes with nothing reachable to do; never stranded at zero charge.
- **Gentle-failure suite:** drain power, water, charge and the digester, and run storms. Prove nothing reverts to dead ground, no crop dies, no build is lost, and everything recovers.
- **Determinism:** same seed and inputs give byte-identical saves.
- Done when: both suites pass on seeds 7 and 21.

### 10.2 Models for the new machines and animals (#406)
Every new object has real art, in the house style. Reuse existing models where they fit. Done when `docs/art/` lists every model with its budget, and each is in the game within budget.

| Group | Issue | Models |
|---|---|---|
| Power | #464 | Charger, battery, wind turbine, power pole (from `bloom-relay` where it fits), large solar array |
| Water | #465 | Pump, pipe pieces, reservoir (from `reservoir-basin` where it fits), desalination plant, sprinkler, feed tank |
| Farm | #466 | Planter box (from `planter-*`), compost bin, Bio Digester, beehive, fish pond, mushroom log, worm bin, wildlife homes, crops by stage |
| Crafting and automation | #467 | Crafting table, research station, mulcher, Assembler, chests (from `crate`) |
| Companions and clips | #468 | Rigged companion animals with follow, sit and climb clips; bloombot's meditate clip |

Also reused: `bench` (§2.3), `drone-hub`, `lantern`, `lamp-post`, `bollard` (§3.5).

### 10.3 Owner playtests per milestone (#407)
- The owner plays each layer before the next goes on: Milestone A (home loop), B (the island), C (mainland and ending). Each gets a build on `testing` and a short notes list.
- Done when: the owner has played all three.

---

## Changes to E21

| E21 says | Now |
|---|---|
| Two rule sets; classic saves stay (E21.0) | One rule set; old saves dropped (§1.1) |
| Idle layer hidden until the Outskirts, which run on today's rules (E21.13, E21.17) | Idle layer removed (§1). The mainland is an endless creative sandbox (§8.3) |
| No intermediate items or crafting stations (rule 3, E21.3) | Crafting table with components (§6.1) |
| No battery for bloombot (out of scope) | Bloombot has a charge (§2.1) |
| No penalties at night (E21.20) | Night drains batteries; solar stops (§7.1) |
| Energy and water pay for pulses and helpers; biomass grows without limit | Pulses cost charge plus their load; helpers run on the grid; biomass is a gathered item |
| Offline progress on; Reclaimers earn while away (E21.2, §18) | Off. Reclaimers dropped; salvage respawns instead (§7.4) |
| Piles never come back (E21.2) | Piles refill over game days and after storms |
| Fixed Workbench upgrades (E21.10) | Research station unlocks upgrades and recipes (§6.2) |
| Rain doubles water income (E21.21) | Weather table with effects on every system (§7.2) |
| Great Bloom opens the idle Outskirts (E21.17) | Wildlife floods back; the mainland is a sandbox (§9.3) |
| Direct recipes (E21.3, §4) | Crafting-table recipes (§6.1.3) |
| Journal pages (E21) | Rewritten as the maker's journal (§9.1) |
| Proof (E21.23, §19) | Updated for the new loop (§10.1) |

## Order
1. **E23.1 (strip the idle layer)** first, together with E21's foundations (E21.1 materials, E21.2 salvage, E21.4 map). E23.1.2 and E23.1.3 are done (PR #476).
2. **Milestone A, the home loop:** E23.2.1 charge, E23.2.2 pulse, E23.5.1–E23.5.3 farm basics, E23.6.1 crafting, E23.3.1–E23.3.3 grid, E23.7.1 day. The owner plays it.
3. **Milestone B, the island:** the rest in region-unlock order (§8.2), with water (E23.4) arriving with Cistern Basin.
4. **Milestone C:** the mainland sandbox (E23.8.3), story ending (E23.9.3), proof (E23.10).

## Done when
- A new game plays from waking up to the Great Bloom with no idle mechanics, on a gamepad and on keyboard and mouse.
- The power grid, water network, farm chain, crafting and research all work and unlock one region at a time.
- Every shortage fades and recovers, and nothing ever returns to dead ground or dies.
- Sitting on a bench in a thriving area brings wildlife that climbs on bloombot.
- The endless mainland supports large player-built systems.
- The owner has played each milestone.

## Open questions
Places where the issues conflict, or leave a number or rule out. Settle with the owner; don't guess.
1. **Ring 1 independence vs Wire.** Rule 7 says ring 1 unlocks don't depend on each other, but Wire is unlocked in Mast Row (§8.2) and the Old Market solar panel (1 Wire) and Saltwind Beach wind turbine (2 Wire) need it. Is Wire craftable from Home, or do those regions depend on Mast Row?
2. **Milestone A's home grid.** Milestone A (home loop) includes the grid, and #377/#420 want "a small home grid runs through a full day and night on solar and batteries". But solar panels unlock in Old Market and batteries in Clock Plaza (ring 2). Which regions does Milestone A assume?
3. **"Battery cells" means two things.** #371 says research adds battery cells for bloombot's bigger charge; #390 has Battery cell as a crafted component (2 Scrap, 2 Wire). Same item or not?
4. **Missing recipes.** #360's done-when says every machine is crafted from a recipe, but #390 gives none for: lamps and lights, watering can, bench, trellis, flooded bed, research station, drone hub, Cultivator, fish pond, orchard, mushroom log, worm bin, wildlife homes, mulcher, hopper composter, feed tank, sprinkler, seed drill, auto-feeder, greenhouse, roof garden, big battery, large reservoir, turbine field, path materials.
5. **Component output counts.** Glass pane, Motor, Battery cell and Sun cell don't say how many one craft makes.
6. **Crop count.** #427 says 14 starting crops; #387's list is 14 only if "lavender and mint" is one crop (15 if two). Sea kale's like isn't stated; "salt air" is in #427's likes list but no crop names it.
7. **Wind turbine placement.** #377 says "built on high ground" (a placement rule); #421 says "more on high ground" (a bonus). Which?
8. **Missing numbers.** Charge cost per pulse/ability/sprint, refill rates, solar in rain ("low"), evaporation, pile refill time ("a few game days"), compost timings, orchard fruit interval, pole range, "a few times" before automation unlocks, battery capacity, digester output. All starting values to set in data.
9. **Trade without a currency.** Old Market's strength is "swap materials, buy seeds". Buy with what? E21's 3-for-1 trade (Tally) is still the only stated rate.
10. **E21 fountain tiers vs region unlocks.** E21 §5 tiers give recipes (Solar Panel, Condenser, Drone Hub, Reclaimer, Relay, Cultivator…) that now clash with §8.2's region unlocks and the dropped Reclaimer. E23 keeps fountain tiers and abilities but doesn't restate what each tier gives.
11. **E21 Keeper lasting rewards.** Some reference removed counters ("water storage doubled", "energy storage doubled", "helpers 25% faster", Reclaimer seams). Not restated in E23.
12. **Art rule citation.** #406 cites "E21 rule 7: no stand-ins", but E21 rule 7 says no new paid models are needed and everything uses existing GLBs. E23 rule 10 asks for real models for every new object and #406 asks to generate them. E23 wins, but the budget/tooling for new models isn't stated.
13. **Photo-mode weather picker** includes "golden hour", which is a time of day, not one of the six weathers.
14. **Shed order for other machines.** Shed order covers lamps, pumps, helpers, chargers; where desalination plants, research stations, mulchers, Assemblers and other powered machines sit in it isn't stated.
