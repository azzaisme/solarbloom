# E23 models (A living world)

Every new object in epic #354 needs real art (E21 rule 7: no stand-ins). This is the list for E23.10.2 (#406) and
its children: power (#464), water (#465), farm (#466), crafting and automation (#467), companions and clips (#468).
It follows the style, budgets and routes in `docs/art/meshy-assets.md` and `docs/art/old-city-models.md`.
The same list lives in data as `src/data/e23models.ts`, and `tests/e23-models.test.ts` checks it: reuse sources
exist, every child issue's objects are listed, the batch costs match this page, and every new model that has landed
is within its LOD0 budget.

Files go to `assets/raw/models/final/<name>.glb` (plus `.lod1.glb` and a `.png` preview) and are loaded by name
through `src/rendering/Models.ts`; machines are mapped in `MACHINE_MODELS` (`src/rendering/MachineVisuals.ts`).
Real-world scale (1 tile = 1 m), pivot at the base centre, PBR with no baked lighting.

**Status (18 Nov 2026):** the owner approved batch A plus the crops (B6). Those 19 models and bloombot's five clips
are made, within budget and in `assets/raw/` (see "What has been made" at the end). Every other batch waits for the
owner's OK. Meshy spends always need it first.

## Routes and budgets

| Route | How | Credits |
|---|---|---|
| Text | `meshy_text_to_3d` with smart topology (`meshy-t2`, `target_polycount` = the class budget), then refine | 15 |
| Image | concept from `meshy_image_to_image` (nano-banana, style image `docs/reference/target-look.png`), then `meshy_image_to_3d` (`meshy-t2` + `meshy-n1`) | 18 |
| Clip | `meshy_animate` on an existing Meshy rig (bloombot, Keepers), then refitted in Blender | 3 per action |
| Reuse | an existing model, scaled or with a code-side part | 0 |
| Procedural | built in code (anything that tiles, follows an outline, or has hundreds of copies) | 0 |

| Class | LOD0 tris | LOD1 tris | Texture |
|---|---|---|---|
| Machine | 2–5k | 600–1k | 1024² |
| Small machine / home prop | 1–2k | 300–500 | 512² |
| Clutter prop | 300–1.5k | 150–400 | 512² atlas |
| Animal | 1.5–3k | 500–800 | 512² |
| Small animal (insect, frog, koi) | 600–1.2k | 200–300 | 256² |

**Style prefix for every prompt:** stylized solarpunk game asset, soft bevelled edges, cream ceramic and white plastic,
brushed gold trim, warm limestone, rusty copper pipes, clean readable silhouette, hand-painted PBR, no baked shadows,
isometric game prop.

**Art direction for E23 machines.** These are the maker's machines, built to work *with* the world (the epic's theme):
cream ceramic shells, gold trim, honest timber and copper, visible moving parts (a turning rotor, a bubbling sight
glass, a spinning sprinkler head) so the world can show their state without a HUD (rule 11). Each machine needs a
clear **off** look, made in code, not in the model: emissive parts go dark, moving parts stop. Every model splits
its moving and glowing parts into separate meshes for that. Moss and vines (E23.6.6 overgrowth) stay procedural.

Dead and worn looks come from the neglected-look shader (E20.6), not re-textures.

## Reused models (0 credits)

| E23 object | Reuses | Notes |
|---|---|---|
| Power pole (E23.3.2) | `bloom-relay` | Relays become poles (#422). Wires between poles are procedural catenaries. A tripped pole dims its crystal. |
| Lamps, night lights (E23.3.5) | `lantern`, `lamp-post` | String lights stay procedural. |
| Big battery (Observatory Hill) | `battery` (new, below) at 1.6× with a second cell bank | |
| Reservoir (E23.4.2.1) | `reservoir-basin` | The water level is procedural. |
| Large reservoir (Spire Heights) | `reservoir-basin` at 1.6× | |
| Pipe pieces (E23.4.2.2) | joints and valves from `copper-pipe`; runs are procedural copper tubes | Pipes tile, so code builds straight, corner, tee, cross and end runs, capped by the `copper-pipe` joint. |
| Planter box (E23.5.2) | `planter-bed` | Crops and soil are procedural (growth stages scale and recolour). |
| Flooded bed (rice) | `planter-trough` | Procedural water surface inside. |
| Keeper garden, butterfly garden, roof garden (The Terraces) | `planter-bed` | Procedural flowers. |
| Worm bin | `crate` | A procedural soil top and lid. |
| Fish pond | procedural stone rim and water | It follows an outline. The koi is a new animal (below). |
| Orchard trees | `TreeGen` | Procedural fruit. |
| Trellis (beans) | procedural lattice | |
| Night finds (fireflies, glowing plants) | procedural | Like today's fireflies. |
| Bench (E23.2.3) | `bench` | |
| Crafting table (E23.6.1) | `workbench` | Already in the house. |
| Storage chest | `storage-chest` | The E21 model. |
| Small chest (courier and mulcher drop-offs) | `crate` | #467 asks for chests from `crate`; the big chest already has its own model. |
| Harvester and courier drones | the drone | Role parts are built with the drone in Blender (drone redesign), not Meshy. |
| Sleeping in the house | `bed` | |

## New models

### Power (#464)
| Name | Route | Class | Look |
|---|---|---|---|
| charger | Image | Machine 3k | A low round ceramic pad with a gold ring and a cushion-shaped seat where bloombot sits cross-legged. A cyan ring glows as it charges; a short mast holds the pole insulator. |
| battery | Text | Small machine 2k | A squat cream cabinet with four glass cell windows that fill with cyan light as it charges, a gold terminal on top. |
| wind-turbine | Image | Machine 4k | A slim limestone-and-copper tower with a three-blade cream rotor (separate mesh, spins) and a little weathervane tail. Reads tall on high ground. |
| large-solar-array | Image | Machine 3k | Four dark-blue panels with gold cell lines in a two by two grid on a low cream ceramic frame, on limestone posts, a brass tracking motor underneath. One whole model: an empty gantry for procedural panels came out as an upright board twice on the text route, and a whole array reads better as one object. Observatory Hill. |

### Water (#465)
| Name | Route | Class | Look |
|---|---|---|---|
| pump | Text | Small machine 2k | A copper hand-pump-style housing with a ceramic motor drum, a pressure dial and a flywheel (separate mesh, turns when powered). |
| desalination-plant | Image | Machine 5k | A shoreline machine: a cream ceramic boiler with a glass condensing dome, copper coils, a seawater intake pipe and a fresh-water spout. Steam is VFX. |
| sprinkler | Text | Clutter 600 | A brass pop-up head on a short copper riser; the head is separate and spins. Spray is VFX. |
| feed-tank | Text | Small machine 1.5k | A copper tank with a ceramic lid and a glass sight tube showing the fertiliser mix, on a pipe stand. |

### Farm (#466)
| Name | Route | Class | Look |
|---|---|---|---|
| compost-bin | Text | Small machine 1.5k | A slatted timber bin in three bays with a hinged lid, a gold latch and a little hand-lettered sign. Contents are procedural. |
| bio-digester | Image | Machine 4k | A rounded ceramic dome on a timber base with a glass sight window (separate mesh, bubbles when fed), a feed hatch and a copper outlet to the grid. |
| beehive | Text | Small machine 1.5k | A stacked timber hive with a cream ceramic roof, gold entrance plate and a landing board. Bees are procedural. |
| mushroom-log | Text | Clutter 1k | A mossy fallen log with shelf mushrooms. Mushroom caps are separate so they can grow. |
| bird-box | Image | Clutter 800 | A small honey timber nest box with a cream roof, a round hole and a perch peg, on a tall slim post with a flat foot (as e23-farm's bird box stands). Text prompts twice left off the post. |
| bat-box | Image | Clutter 800 | A closed, tall, narrow box of dark weathered planks, no front hole, a cream roof and a slot along the bottom with a ridged landing board, high on a slim post. Text prompts twice made an open feeder. |
| hedgehog-house | Text | Clutter 1k | A low domed timber-and-leaf shelter with an arched entrance. |
| greenhouse | Image | Machine 5k | A small cream-framed glasshouse with gold ridge trim and opening roof vents (separate). Plants inside are procedural. Glasshouse Gardens unlock. |
| watering-can | Text | Clutter 500 | A cream ceramic can with a gold rose. Held by bloombot and hung by the door. |

### Crops by stage (#466)
Each crop shows three stages in its planter: **seedling**, **growing** and **ripe**. One shared `crop-seedling`
(300 tris) is every crop's first stage. Each crop then has one model (1.2k tris, text route, batch B6) with its
fruit, pods, heads or flowers as separate parts: the growing stage is the plant scaled down with those parts hidden,
the ripe stage shows them. Wilting is a droop and desaturation in the shader, never a dead model (crops never die).

| Crop | Ripe look |
|---|---|
| crop-radish | Leafy rosette with pink-red radish shoulders showing |
| crop-lettuce | Loose round head of frilly pale-green leaves |
| crop-potato | Bushy leafy plant with small white flowers |
| crop-beans | Climbing vine with long green pods (grows up the procedural trellis) |
| crop-tomato | Staked plant with clusters of red tomatoes |
| crop-sweetcorn | Tall stalks with tassels and husked cobs |
| crop-pumpkin | Sprawling vine with big leaves and one fat orange pumpkin |
| crop-sunflower | Tall stem with one big gold sunflower head that turns to the sun (head separate) |
| crop-watercress | Low dense mat of round leaves |
| crop-rice | Tufts of grass with drooping golden grain heads |
| crop-lavender | Silvery mound with purple flower spikes |
| crop-mint | Bright square-stemmed leafy clump |
| crop-moonflower | Twining vine with big white trumpet flowers (emissive at night) |
| crop-flowers | A mixed posy of cottage flowers |
| crop-sea-kale | Blue-grey crinkled leaves with a white flower spray |

### Crafting and automation (#467)
| Name | Route | Class | Look |
|---|---|---|---|
| research-station | Image | Machine 4k | A writing desk grown into a machine: a brass microscope, seed jars, a glass specimen dome and the maker's open notebook. |
| assembler | Image | Machine 5k | A tall cream ceramic cabinet with two gold arms behind a glass front (arms separate, animated), input and output hatches. Spire Heights. |
| mulcher | Text | Small machine 2k | A wheeled ceramic hopper with a rake-tined front drum (separate, spins) and a chute into a chest. |
| hopper-composter | Text | Small machine 1.5k | A timber hopper on legs feeding a ceramic drum with a crank. |
| auto-feeder | Text | Clutter 800 | A small copper chute and timer dial that clips onto a Bio Digester's feed hatch. |
| seed-drill | Text | Small machine 1.5k | A wheeled timber seed box with copper tubes down to little disc coulters. |
| forecast-board | Text | Clutter 1k | A chalk board on a post outside the house, with a turning weathervane on top (separate). Weather symbols are drawn in code. |

### Companions and visitors (#468)
The wildlife of E23.2.4 and E23.2.5. Wild animals, drawn the way the Keepers are: rounded, soft, a little toy-like,
never cute-ified to plush. Each is split into parts (head, body, tail, wings, legs) so it can be animated by hand.

**No cat of any kind.** The Lucky Cats stay hidden (rule 8), so no visitor or companion may look like one.

| Name | Route | Class | Role |
|---|---|---|---|
| fox | Image | Animal 3k | Companion; curls up beside bloombot |
| hedgehog | Image | Animal 2k | Companion and visitor |
| squirrel | Image | Animal 2k | Companion and visitor |
| otter | Image | Animal 3k | Companion |
| owl | Image | Animal 2.5k | Companion; night |
| magpie | Image | Animal 2k | Companion |
| frog | Image | Small animal 1k | Companion; sits in bloombot's lap |
| bumblebee | Image | Small animal 800 | Companion; replaces the procedural bee when it is a friend |
| songbird | Image | Animal 1.5k | Visitor; perches and nests on bloombot's head (replaces `Fauna.ts` `makeBird`) |
| koi | Image | Small animal 1k | Fish ponds (replaces `makeKoi`) |
| heron | Image | Animal 3k | Rare visitor |
| badger | Image | Animal 3k | Rare visitor |
| kingfisher | Image | Small animal 1.2k | Rare visitor |
| butterfly | Image | Small animal 600 | Visitor: passes by, lands on bloombot (#374); added by the owner on 19 Nov |
| swallowtail | Image | Small animal 600 | Visitor; added by the owner on 19 Nov |
| fawn | Image | Animal 2.5k | Visitor; added by the owner on 19 Nov |

The wild butterflies over the flowers stay procedural; the butterfly and swallowtail visitors that come to bloombot use these models.

**Every animal is rigged in Blender**, not by Meshy (Meshy's auto-rig is for bipeds). Each gets a small armature
over its split parts and four clips, as #468 asks: `idle`; `follow` (its own gait: trot, waddle, hop, swim or fly,
for travelling with bloombot); `sit` (sit, curl or roost, beside bloombot or in its lap); and `climb` (onto
bloombot's head, shoulders or lap, ending in a perch). The koi and the bumblebee `climb` by swimming or flying to
the spot. Keep every Blender run short and time-limited.

**Done (19 Nov):** `assets/tools/rig_animals.py` rigs all 16 in one short Blender run (no credits). Each animal has a body
plan: four-legged (fox, hedgehog, squirrel, otter, badger, fawn), frog, bird (owl, magpie, songbird, kingfisher,
heron), winged insect (bumblebee, butterfly, swallowtail) or fish (koi). From the plan it places 4 to 7 bones, weights
the mesh by distance to each bone, and keys the four clips at 24 fps. `idle`, `follow` and `sit` loop. `climb` plays once:
a crouch, a spring and a landing, ending in the `sit` pose, while the game moves the animal to the perch. Its sit tips
the body just enough to keep the feet on the ground, and a roosting bird tucks its legs up. Run it again after a model
changes: it strips the old rig first. `tests/e23-models.test.ts` checks every file has a skeleton and the four clips.

### Bloombot's clips (#468, E23.2)
From bloombot's existing Meshy rig with `meshy_animate`, then refitted to the big head and toddler proportions by the
pipeline in `docs/art/bloombot-pipeline.md` (the same fixes the walk and hover got).

| Clip | Meshy action | Used for |
|---|---|---|
| `meditate` | Sit Cross-legged on Floor (363) | Charging at a charger (E23.2.3) |
| `sit-down` | Stand to Sit Transition (57) | Sitting on a bench |
| `sit` | Chair Sit Idle (33) | On a bench; animals climb on |
| `stand-up` | Sit to Stand Transition (53) | Leaving the bench |
| `doze` | Sit and Doze Off (268) | Sleeping in the house |

Two clips are keyed by hand in Blender (no credits): `eat` (a one-shot bite, for refilling charge) and `low-walk`
(the slow, droopy low-power walk at zero charge). Bloombot also needs four sockets (head, left shoulder, right
shoulder, lap) for animals to perch on; they are empties added in the same Blender pass.

### Keepers on benches (E23.2.3)
Keepers who are friends sit beside bloombot. Each of the 10 Keepers gets `sit-down`, `sit` and `stand-up`. They
were planned as Meshy clips (20 × 3 credits), but the Keepers were rigged by the same auto-rigger as bloombot (the
same 24 joints, the same names), so bloombot's own chair clips are retargeted onto each Keeper's rig instead, for
nothing: `assets/tools/retarget_keeper_clips.mjs` (see "What has been made").

## Batches and cost

The batches follow the milestones, so the owner can approve Milestone A's art first and play it before more is spent.
Prices are from `meshy-assets.md`'s routes as of 2026-10-12 (check https://docs.meshy.ai/en/api/pricing).

| Batch | What | Count | Credits |
|---|---|---|---|
| **A: the home loop** | charger (18), compost-bin (15), watering-can (15), bloombot clips (5 × 3) | 3 models, 5 clips | **63** |
| B1: power and water | battery, wind-turbine, large-solar-array, pump, desalination-plant, sprinkler, feed-tank | 7 | 114 |
| B2: farm | bio-digester, beehive, mushroom-log, bird-box, bat-box, hedgehog-house, greenhouse | 7 | 117 |
| B3: crafting and automation | research-station, assembler, mulcher, hopper-composter, auto-feeder, seed-drill, forecast-board | 7 | 111 |
| B4: animals | 16 animals (the owner added butterfly, swallowtail and fawn on 19 Nov) | 16 | 288 |
| B5: Keepers on benches | bloombot's `sit-down`, `sit` and `stand-up` retargeted onto the 10 Keepers (no Meshy) | 30 clips | 0 |
| B6: crops | crop-seedling and 15 crops | 16 | 240 |
| **Total** | | **56 models, 35 clips** | **933** |

Crops first appear in Milestone A, so until B6 is approved the planters have no crop model. The owner may want B6
folded into A (303 credits for A then).

Batch A and B6 are done (303 credits), plus a lavender redo the owner approved on 19 Nov (15 credits). B1 is done (approved 19 Nov): 124 credits spent against 114 planned, because the large solar array failed twice on the text route before the image route worked; the owner gave standing permission for regenerations. B2 is done (approved 19 Nov): 137 credits spent against 117 planned (the bird and bat boxes each missed twice on the text route before the image route). B4 is done (approved 19 Nov, "both lists combined": the doc's 13 and the wildlife visitors of #544, 16 animals): 288 credits, as planned, with no redos. B3 is done (approved 20 Nov): 116 credits spent against 111 planned (the seed drill's first text preview was a tangle and was made again, 5). B5 is done (approved 20 Nov) at no cost: retargeted, not generated.

## Getting each model into the game

Each child issue is done when its models are in the game within budget (#464–#467), or when each animal and clip
plays (#468). That takes three things, in order:

1. **The owner approves the batch** and it is generated by the routes above, then reduced and split in Blender, with
   a `.lod1.glb`. `tests/e23-models.test.ts` then checks its budget.
2. **The system that places the object has landed** (E23.3 power, E23.4 water, E23.5 farm, E23.6 crafting, E23.2
   bloombot and companions). Its machine type gets an entry in `MACHINE_MODELS` (`src/rendering/MachineVisuals.ts`),
   reused models included. In the same change its files move from `assets/raw/models/pending/` to
   `assets/raw/models/final/`: everything in `final` is downloaded before the loading screen ends, so a model waits in
   `pending` (committed, never fetched) until something draws it. On 20 Nov the 38 not yet drawn moved there (A's
   charger and watering can, all of B1 and B3, B2 but the bio-digester, the fences and the trellis), taking the
   startup models from 63.4 MB to 36.0 MB. The Keepers stay in `final` but are fetched only by `KeeperVisuals`.
3. **It is played in the browser** and checked from all round at near zoom, both on and off.

## What has been made

Batch A and the crops (B6), approved by the owner on 18 Nov 2026: 303 credits. Meshy task ids are in
`assets/raw/models/e23-meshy-tasks.md`.

| Model | LOD0 / budget | LOD1 | Notes |
|---|---|---|---|
| charger | 2,898 / 3,000 | 709 | Image route; matches its concept (pad, gold ring, cyan glow, seat, pole mast) |
| compost-bin | 1,342 / 1,500 | 328 | Reads as one timber bin with a lid rather than three open bays |
| watering-can | 490 / 500 | 147 | |
| crop-seedling, crop-lettuce, crop-watercress | 294, 1,176, 837 / 300, 1,200, 1,200 | | One `plant` part (nothing to hide) |
| 13 other crops | 700–1,176 / 1,200 | 195–341 | `plant` and `fruit` parts |
| **B1** (19 Nov) | | | |
| wind-turbine | 3,920 / 4,000 | 960 | Image route; limestone tower, copper bands, cream rotor, weathervane tail |
| desalination-plant | 4,835 / 5,000 | 980 | Image route; ceramic boiler, glass dome, copper coils, intake and tap |
| large-solar-array | 2,939 / 3,000 | 719 | Image route; four panels on a low frame (see its row above) |
| battery | 1,948 / 2,000 | 477 | Cyan cell windows |
| pump | 1,960 / 2,000 | 480 | Flywheel and pressure dial |
| sprinkler | 587 / 600 | 147 | On a stone foot with its hose |
| feed-tank | 1,469 / 1,500 | 359 | Copper tank, green sight glass |
| **B2** (19 Nov) | | | |
| bio-digester | 3,919 / 4,000 | 959 | Image route; cream dome on a brick ring, gold hatch, copper gas pipe |
| greenhouse | 4,899 / 5,000 | 979 | Image route; timber frame, pale glass, brick footing, a roof vent |
| beehive | 1,468 / 1,500 | 359 | Round kraft hive on legs, cream roof, landing board |
| mushroom-log | 904 / 1,000 | 221 | Bark log with orange caps and moss |
| hedgehog-house | 874 / 1,000 | 213 | Leaf-thatched mound with a cream doorway |
| bird-box | 702 / 800 | 171 | Image route; on a post, gable roof, round hole |
| bat-box | 794 / 800 | 194 | Image route; tall slatted box on a post, landing ramp |
| **Fences and trellis** (#466, hand-built, no credits) | | | |
| fence-<style>-run, -post, -gate | ≤ 800 | ≤ 200 | In `pending/` until the farm draws them. Built by `assets/tools/prop_models_fences.py` (`build_props.py`, out to `assets/raw/models/pending`): five styles of salvaged materials (picket, willow hurdle, pipe rail, dry-stone wall, clipped hedge). A run spans one tile edge (x −0.5…0.5), a post sits on a tile corner, a gate's part `gate` swings about Z on its hinge (its origin). The hedge's part `leaves` is the one the wind sways. Decoration only. |
| trellis | ≤ 800 | ≤ 200 | Two posts and a diamond lattice, 0.8 × 1.5 m, on a planter or farmland tile |
| farmland ground (#466) | 2 triangles a tile (+ fade band) | | Painted at startup, no file: `src/rendering/FarmlandArt.ts`. Tilled soil `#5f4733` with moss dots, furrows 4 a metre in world space (seamless across tiles). **dry** paler with dusty crests and hairline cracks; **watered** darker, water in the furrow bottoms, a glossier sheen; **fertilised** rich and dark with compost flecks and straw. A side with no farmland beyond fades into the ground over a ragged 0.28 m band, so a field reads as one patch. `game.farmland.set(tiles)` draws them; #517 will call it with its tilled tiles. Checked by `tests/farmland-art.test.ts` and by day and night in `docs/review/e23-farmland-*.png`. |
| **B4** (19 Nov), in `assets/raw/models/visitors/<id>.glb` | | | Image route (concept on the November reference, then meshy-t2.5 smart topology). Real size, pivot at the feet, facing +z; the butterfly is laid flat. Rigged with `idle`, `follow`, `sit` and `climb` (see below). |
| fox | 2,939 / 3,000 | 719 | |
| hedgehog | 1,960 / 2,000 | 480 | |
| squirrel | 1,960 / 2,000 | 480 | |
| otter | 2,940 / 3,000 | 720 | |
| owl | 2,450 / 2,500 | 599 | |
| magpie | 1,960 / 2,000 | 480 | |
| frog | 980 / 1,000 | 240 | |
| bumblebee | 784 / 800 | 192 | |
| songbird | 1,470 / 1,500 | 359 | |
| koi | 980 / 1,000 | 240 | |
| heron | 2,940 / 3,000 | 720 | |
| badger | 2,939 / 3,000 | 719 | |
| kingfisher | 1,176 / 1,200 | 288 | |
| butterfly | 481 / 600 | 147 | |
| swallowtail | 584 / 600 | 147 | |
| fawn | 2,449 / 2,500 | 599 | |
| **B3** (20 Nov) | | | Finished by `meshy_finish.py` with real sizes; the moving parts split out with its `part=` boxes (below). |
| research-station | 3,919 / 4,000 | 959 | Image route; a honey-timber desk with ceramic drawers, a brass microscope, seed jars, a glass dome with a seedling, the open notebook and a gold lamp. 1.6 m wide. |
| assembler | 4,403 / 5,000 | 410 | Image route; a cream cabinet, 1.9 m. Meshy painted its window opaque and lost the arms, so `assets/tools/meshy_extra_assembler.py` cuts the window along its gold frame into a see-through `glass` part (alpha 0.15), sets an inward-facing room behind it (`inside`) with a ceramic work `plate`, and hangs two gold arms, `arm-left` and `arm-right`, from its ceiling, each with its origin at its shoulder so the game swings them. |
| mulcher | 1,935 / 2,000 | 473 | A wheeled ceramic hopper. Its drum (`drum`, origin at its centre) spins about its long (x) axis. 1 m long. |
| hopper-composter | 1,470 / 1,500 | 359 | Reads as a tall timber barrel with a hopper on top, a gold crank and feet. 1.3 m. |
| auto-feeder | 798 / 800 | 195 | A copper canister with a gold timer dial, 0.4 m, to sit on the Bio Digester's hatch. |
| seed-drill | 1,470 / 1,500 | 358 | A timber seed cart on two spoked wheels with a push handle. The first text preview was a tangle; made again. The copper tubes and discs did not come through: it reads as a seed cart. 1.2 m. |
| forecast-board | 980 / 1,000 | 239 | A blank slate-green board under a little timber roof, on a post; the weather is drawn in code. Its gold cockerel weathervane (`vane`, origin at its foot) turns about z. 1.8 m. |
| **B5** (20 Nov), the 10 Keepers | as before | as before | `sit-down`, `sit` and `stand-up` added to every `keeper-<id>.glb` and its `.lod1.glb` by `assets/tools/retarget_keeper_clips.mjs`: bloombot's clips retargeted through world space (each bone turned from its rest pose as bloombot's turns from its own), the leg bones first laid along bloombot's (a few Keepers' legs splay at rest) so a seated Keeper's thighs are level and its shins hang straight, and the hips' travel scaled by leg length. No Meshy credits. `tests/e23-models.test.ts` poses each one halfway through `sit` and checks it; `npm run test:e23models` sets them on park benches in the game (`docs/review/e23-models-keepers-sit-*.png`) and the B3 machines beside bloombot; those renders wait for the final pass (owner, 20 Nov: no renders before it). The hips are also raised or lowered on every frame so the feet stay planted where they stand. `KeeperVisuals` plays them on a bench (`sit-down` once, `sit` while bloombot sits, `stand-up` once as it gets up; `src/rendering/KeeperSeat.ts`), lifting the body by each Keeper's measured seated hip height, and falls back to `SeatPose`'s hand-bent legs for a model without them (`tests/keeper-seat.test.ts`). |

Every model is finished by `assets/tools/meshy_finish.py` (Blender 5.0): real scale, pivot at the base centre,
textures 512 (1024 for the charger and the big B1 machines), LOD1 by Decimate (a quarter, never over 1,000), a preview
from the game camera. For crops it sorts the
fruit, pods, heads and flowers into a `fruit` node: the game hides it and scales the plant down for the growing
stage.

B3's arguments (`name size axis tris tex [options]`), so they can be finished again from the raw downloads:

```
research-station 1.6 w 4000 1024
assembler 1.9 h 5000 1024 extra=assets/tools/meshy_extra_assembler.py
mulcher 1.0 w 2000 512 part=drum:-0.52,-0.02,-0.4,0.4,0.0,0.55:centre
hopper-composter 1.3 h 1500 512
auto-feeder 0.4 h 800 512
seed-drill 1.2 w 1500 512
forecast-board 1.8 h 1000 512 part=vane:-0.3,0.25,-0.06,0.06,1.48,1.85:base
```

The B1 and B2 machines were finished before `part=` existed, as one mesh each: the wind turbine's rotor, the pump's
flywheel, the sprinkler head, the digester's sight window and the greenhouse vents are not yet their own parts. They
can be split the same way from their raw downloads when their systems want to turn them.

**Known limits, for the owner:**
- **crop-lavender** first came out as a grey spiky mound with no purple spikes. The owner approved a redo (15 credits, 19 Nov). The new one has chunky violet spikes, 1,051 triangles; its growing stage keeps the leaves and soil base on bare stems (a couple of spike tips are fused on and stay).
- **crop-moonflower** (fixed 19 Nov): its trumpets are pale cream-green, so it is finished with a cutoff measured on its own
  albedo (`pale=0.35,0.65`, faces sorted one by one); the growing stage now drops them.
- **crop-mint** (19 Nov): the same treatment (`pale=0.3,0.55`) takes off its flower pieces, but some grey-lilac is painted
  onto the leaves themselves, so it stays at both stages and reads as variegated mint. Cutting those faces would hole
  the leaves.

**Bloombot's clips** (`meditate`, `sit-down`, `sit`, `stand-up`, `doze`, 15 credits) are in `bloombot.glb`, rebuilt by
`blender-pass.py` from `bloombot-e23-clips.glb`. They get the same fixes as the E20 clips: the hip and spine lean is
damped to 35% so the big head doesn't dive at the floor, and the feet stay flat on the ground on every frame.
`meditate` sits cross-legged on the ground. The chair clips put the hips 0.203 m up (`BLOOMBOT_CLIPS.seatHips` in
`src/data/e23models.ts`), so on the park bench bloombot is lifted onto the seat and its legs dangle.

**In the game:** `npm run test:e23models` starts a game headless, checks each new model loaded in the ModelLibrary,
sets them out beside bloombot and plays each clip (screenshots in `docs/review/e23-models-*.png` and
`e23-clip-*.png`). Placing them for real waits on the systems that build them: the charger on E23.3.3, the compost
bin, planters and crops on E23.5, the watering can and the bench clips on E23.2.3. Eating (`eat`) and the low-power
walk (`low-walk`) are Blender-keyed clips still to do with E23.2.1.
