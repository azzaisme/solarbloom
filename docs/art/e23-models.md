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
| large-solar-array | Text | Machine 3k | A cream ceramic gantry with gold bracing and a slow tracking motor that holds four of the procedural solar panels (the panels stay procedural, like every solar panel). Observatory Hill. |

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
| bird-box | Text | Clutter 800 | A timber nest box with a cream roof and a round hole, on a short post. |
| bat-box | Text | Clutter 800 | A tall narrow timber box with a slotted underside, on a post. |
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

The companion butterfly stays procedural like every other butterfly.

**Every animal is rigged in Blender**, not by Meshy (Meshy's auto-rig is for bipeds). Each gets a small armature
over its split parts and four clips, as #468 asks: `idle`; `follow` (its own gait: trot, waddle, hop, swim or fly,
for travelling with bloombot); `sit` (sit, curl or roost, beside bloombot or in its lap); and `climb` (onto
bloombot's head, shoulders or lap, ending in a perch). The koi and the bumblebee `climb` by swimming or flying to
the spot. Keep every Blender run short and time-limited.

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
Keepers who are friends sit beside bloombot. Each of the 10 Keepers gets `sit-down` (57) and `sit` (33); standing
up plays `sit-down` in reverse.

## Batches and cost

The batches follow the milestones, so the owner can approve Milestone A's art first and play it before more is spent.
Prices are from `meshy-assets.md`'s routes as of 2026-10-12 (check https://docs.meshy.ai/en/api/pricing).

| Batch | What | Count | Credits |
|---|---|---|---|
| **A: the home loop** | charger (18), compost-bin (15), watering-can (15), bloombot clips (5 × 3) | 3 models, 5 clips | **63** |
| B1: power and water | battery, wind-turbine, large-solar-array, pump, desalination-plant, sprinkler, feed-tank | 7 | 111 |
| B2: farm | bio-digester, beehive, mushroom-log, bird-box, bat-box, hedgehog-house, greenhouse | 7 | 111 |
| B3: crafting and automation | research-station, assembler, mulcher, hopper-composter, auto-feeder, seed-drill, forecast-board | 7 | 111 |
| B4: animals | 13 animals | 13 | 234 |
| B5: Keepers on benches | 10 Keepers × 2 clips × 3 | 20 clips | 60 |
| B6: crops | crop-seedling and 15 crops | 16 | 240 |
| **Total** | | **53 models, 25 clips** | **930** |

Crops first appear in Milestone A, so until B6 is approved the planters have no crop model. The owner may want B6
folded into A (303 credits for A then).

Batch A and B6 are done (303 credits), plus a lavender redo the owner approved on 19 Nov (15 credits).

## Getting each model into the game

Each child issue is done when its models are in the game within budget (#464–#467), or when each animal and clip
plays (#468). That takes three things, in order:

1. **The owner approves the batch** and it is generated by the routes above, then reduced and split in Blender, with
   a `.lod1.glb`. `tests/e23-models.test.ts` then checks its budget.
2. **The system that places the object has landed** (E23.3 power, E23.4 water, E23.5 farm, E23.6 crafting, E23.2
   bloombot and companions). Its machine type gets an entry in `MACHINE_MODELS` (`src/rendering/MachineVisuals.ts`),
   reused models included.
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

Every model is finished by `assets/tools/meshy_finish.py` (Blender 5.0): real scale, pivot at the base centre,
textures 512 (1024 for the charger), LOD1 by Decimate, a preview from the game camera. For crops it sorts the
fruit, pods, heads and flowers into a `fruit` node: the game hides it and scales the plant down for the growing
stage.

**Known limits, for the owner:**
- **crop-lavender** first came out as a grey spiky mound with no purple spikes. The owner approved a redo (15 credits, 19 Nov). The new one has chunky violet spikes, 1,051 triangles; its growing stage keeps the leaves and soil base on bare stems (a couple of spike tips are fused on and stay).
- **crop-moonflower and crop-mint** still keep some flowers on the growing stage: their flowers are fused to the stems and
  too close to the leaves in colour to sort automatically. A hand pass in Blender can move them to `fruit`.

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
