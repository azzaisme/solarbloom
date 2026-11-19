# Old City models (E21)

New Meshy models for the Old City epic (#312), in the style and budgets of `docs/art/meshy-assets.md`.
Files go to `assets/raw/models/final/<name>.glb` (plus `.lod1.glb` and a `.png` preview), loaded by name through
`src/rendering/Models.ts`.

**Routes**
- **Text:** `meshy_text_to_3d` with smart topology (`meshy-t2`, `target_polycount` = the class budget), then refine. 15 credits.
- **Image:** a concept from `meshy_image_to_image` (nano-banana, style reference `docs/reference/target-look.png`), then `meshy_image_to_3d` (`meshy-t2` + `meshy-n1`). 18 credits.
- **Character:** the image route with `meshy-t2.5` in T-pose, then `meshy_rig` and `meshy_animate` (idle, wave, sleep). 32 credits.

Dead and restored looks come from the existing neglected-look shader (E20.6, #289), not from re-textures.

**Style prefix for every prompt:** stylized solarpunk game asset, soft bevelled edges, cream ceramic and white plastic,
brushed gold trim, warm limestone, rusty copper pipes, clean readable silhouette, hand-painted PBR, no baked shadows,
isometric game prop.

## Characters: Keepers (10), character route, budget 6k
| Name | Region | Look |
|---|---|---|
| keeper-pylon | Mast Row | Tall thin robot with a radio antenna head and cable coils over its shoulders |
| keeper-tally | Old Market | Round shopkeeper robot with an abacus belly and a glass display visor |
| keeper-tide | Saltwind Beach | Stout fisher robot with a sou'wester hat, rope and a hanging lantern |
| keeper-moss | Elder Grove | Mossy gardener robot with leafy shoulders and a trowel hand |
| keeper-sluice | Cistern Basin | Barrel-bodied robot with a valve wheel on its chest and wading boots |
| keeper-tock | Clock Plaza | Clockwork robot with a clock-face head and visible gears |
| keeper-gable | The Terraces | Roofer robot with a tile-shaped helmet and a ladder on its back |
| keeper-fern | Glasshouse Gardens | Botanist robot with a glass-dome head holding a seedling |
| keeper-vega | Observatory Hill | Astronomer robot with a telescope eye and a star-chart cape |
| keeper-atlas | Spire Heights | Tall lift-operator robot with a brass uniform and a lift-dial chest |

## Landmarks and towers (7), image route, landmark budget 8k
solar-spire · glass-tower · twin-tower (placed twice) · old-exchange · great-greenhouse · sky-observatory · sea-lock-light (a small lighthouse beacon for the Sea Lock; the lock gate itself already exists)

## House (8), image route for the four stages, text route for furniture
house-shed · house-cottage · house-two-storey · house-home (budget 8k) · bed · workbench · keepsake-shelf · journal-desk (budget 1.5k)

## Island (5)
boat (image route, 5k) · jetty · causeway-span · causeway-broken · sea-cliff (landmark budget, close-range; the skyline cliff stays for distance)

## Machines and storage (3), text route, machine budget 5k
storage-chest · grid-battery (E23.8.3.2, mainland only: a 2 × 2 grid-scale battery bank). (E23.7.4 dropped the Reclaimer and its model.)

## Salvage piles (7), text route, obstacle budget 1.2k
salvage-copper · salvage-driftwood · salvage-glass · salvage-clay · salvage-gears · salvage-sunstone · salvage-steel (E23.8.3.2: girders from the mainland's industrial ruins)
(Scrap uses rubble-pile, crate and stone-block; Seeds uses broken-pot and stump.)

## Gates and getting about (8), text route
barricade · skybridge-collapsed · bridge-broken · bridge-repaired · lift-bridge · glide-perch · tower-lift · lookout-telescope

## Finds (2), text route, clutter budget 1.5k
cache-box · journal-page-post

## Keepsakes (10), text route, clutter budget 1.5k
keepsake-tram-sign (Mast Row) · keepsake-scales (Old Market) · keepsake-ship-bell (Beach) · keepsake-acorn-lamp (Elder Grove) ·
keepsake-water-jug (Cistern Basin) · keepsake-cuckoo-clock (Clock Plaza) · keepsake-weathercock (Terraces) ·
keepsake-terrarium (Glasshouse) · keepsake-orrery (Observatory) · keepsake-lift-dial (Spire Heights)

## Procedural, not generated
Ladders, railings, terrace floors, seams, ground, sea surface, surf, cliffs between terrace levels, vines, flowers,
VFX, journal paper.

## Cost
| Group | Count | Credits |
|---|---|---|
| Keepers | 10 | 320 |
| Landmarks, towers, house stages, boat | 12 | 216 |
| Text-route props | 38 | 570 |
| **Total** | **60** | **1,106** |
