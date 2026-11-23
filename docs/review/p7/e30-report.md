# P7-E30 (#716): terrain elevation, banks and waterfalls, plus the on-island wasteland (#758)

Branch `p7-e30-terrain`, on the Phase 7 base `claude/trusting-fermi-cgucwe` @25f8be47 (E27 + E28 + E29 + E32).
Baseline shots: `cp2/` (that base). After: [`e30/after/`](e30/after/) (`tests/e2e/p7-shots.mjs`, every stage, day).
The waterfall framed on its own: [`e30/falls/`](e30/falls/) (`tests/e2e/p7-falls-shots.mjs`); its "before" is
`e30/falls/before/` (the same cameras on the base build). Audit: [`e30-audit.md`](e30-audit.md).

| Key frame | What it shows |
|---|---|
| `e30/falls/late-day-beach.png` | The showcase fall from the beach: a sheet off the overlook's lip, foam and mist at the foot, the canal running on to the sea |
| `e30/falls/late-day-wide.png` | The fall, the bluff and the park's steps together; the beach walls rocky and mossy |
| `e30/falls/late-day-overlook.png` | On the overlook, looking south over the beach to the sea, its lip rail in front |
| `e30/falls/early-day-waste.png` | Dead ground close up: broken path slabs, a toppled panel, the cracked earth |
| `e30/after/early-day-third.png` | The dead beach: still sand, dull and abandoned, with a little wrack, rope and plank litter |

## What was built

- **One real height change (#742, #743): the Falls overlook.**
  - A level-2 stamp in Elder Grove, `x −5…−1, z 12…15`, over the head of Saltwind's canal. It stands 2.4 tiles over
    the beach and the canal, and 1.2 tiles over the grove.
  - It's reached by a two-tile stair from the grove (`x −2…−1, z 10…11`). Every other edge is a cliff, both ways.
  - It extends the region data (`stamps`/`ramps` in `data/oldcity.ts`), not a parallel system. The rectangles are
    named in `data/terrain.ts`, so the renderer and tests agree.
  - A low timber rail runs along its lip, and its lip row and rill stay low and open (see the zone hook below).
- **The showcase waterfall (#745).** It pours over the overlook's lip into the canal's head: a real two-level drop,
  with downstream water to the sea.
  - New WaterLife kind `sheet`. It shares the culvert falls' scrolling streak material, so the sheet runs downward;
    a 600 ms strip shows ~4× the frame difference of the swaying lawn round it. It still costs one instanced draw.
  - The source: a spring of mossy boulders and a stone-kerbed rill across the overlook, with a pale lip stone. The
    face behind the sheet is wet and dark, with moss each side. Rocks at the plunge ring the water.
  - Foam churns across the plunge and mist rises at the foot.
  - Tied to restoration. While the six source cells are dead, the sheet is a trickle (0.2 wide), the rill bed dry
    and cracked, the moss dry. Restored, the rill runs and the sheet is 1.55 wide, with mist.
  - It replaces the culvert outlet at the canal's head. The facade case is kept: while Elder Grove is hidden, the
    culvert still sits on the facade's face, and the fall isn't drawn (it's behind the cloud wall).
- **Saltwind's walls: stepped, rocky, mossy (#743).** A wall over restored Saltwind ground gains:
  - a stepped foot of rough rock blocks, mossy on top, and boulders against it;
  - mossy rock ledges standing out of the face (two on the 2.4-tile bluff);
  - moss over the coping, in place of the ivy strips.
  It all stays within ~0.3 of the face, where bloombot (who stops at the cliff edge) doesn't walk.
  - Walls are drawn by their upper tile, which is in another chunk. So restoring a beach tile at a chunk edge now
    also rebuilds the neighbouring chunk that draws its wall (`markTile`).
- **The wasteland (#758) and dead-tile detail.** On dead Old City ground, as a pure function of the cell (no plants):
  - cracked earth (55% of dead earth tiles): a wandering crack with branches;
  - broken pieces of an old path (9%);
  - derelict clean-energy debris (2.8%): a toppled solar panel on its bent stand, or a snapped pole with its fallen
    length and a loop of dead wire;
  - extra cracks on dead paving (27%).
  - **Dead sand stays a beach:** no cracks, only light litter (12%): wrack strands, a rope's end, the odd plank.
    E28's sand colour is untouched.
- **Banks (#744).** Audited, not reworked: E28's shore (#700, `Shore.ts`) already joins banks, shelves and wet bands
  to the water with no gaps (its own tests pass). New dressing only touches water at the plunge (rocks that ring the
  surface). The rocky wall dressing is skipped where the ground below is water, which already has E28's wet band.

All moving water goes to WaterLife as spots; everything else lands in the chunk's merged mesh. None of it adds a
draw call.

## Respecting E28 / E29 / E32

- **E28 zones:** one marked hook in `zoneAt`. The rill's cells and the overlook's lip row are `landmark_clearance`
  (short grass, no beds). The beach zone, `beachDepth` and `lawnFringe` are untouched; the wasteland draws only on
  dead tiles, under the fringe.
- **E29 trees:** tree spots still come from the generated world. The clearance removes the trees that would have
  stood on the rill and the lip. Tree tiles (seed 7, the pacing test's area):

  | Area type | Base | After |
  |---|---|---|
  | grove | 522 | 516 |
  | street | 142 | 142 |
  | plaza | 41 | 41 |
  | park | 23 | 23 |
  | market | 30 | 30 |
  | beach | 45 | 45 |
  | reservoir | 113 | 113 |

  The songbird pacing proxy (park ≥ 20) is unaffected, and every tree test passes.
- **E32:** the fall follows the `ruin-cliff` falls' reference (a pale sheet with a mist foot) and adds the motion they
  lack. Fog of war, `LOOK.cloudRing` and world height fog (#757) are untouched.

## Numbers (day, High, software GL)

| Shot | Draw calls (cp2 → after) | Clipped % | Mean lum |
|---|---|---|---|
| early-day-third | 1039 → 1051 (+1%) | 0.01 → 0.01 | 176.4 → 175.2 |
| early-day-iso | 1073 → 1031 (−4%) | 0 → 0 | 191.3 → 195.3 |
| early-day-shore | 800 → 822 (+3%) | 0 → 0 | 191 → 190.2 |
| mid-day-third | 1093 → 1101 (+1%) | 0.05 → 0.05 | 171.7 → 171.5 |
| mid-day-iso | 1091 → 1161 (+6%) | 0 → 0 | 195.1 → 196 |
| mid-day-shore | 806 → 728 (−10%) | 0 → 0 | 161.4 → 159.1 |
| late-day-third | 1710 → 1691 (−1%) | 0.05 → 0.06 | 167.2 → 164.9 |
| late-day-iso | 1527 → 1495 (−2%) | 0 → 0 | 182.3 → 184.4 |
| late-day-shore | 1063 → 1058 (−0%) | 0 → 0 | 158.3 → 158.2 |

Draw calls stay within the +25% budget (largest +6%). They swing with chunk streaming by about that much; the new
work adds no draw calls of its own. No page errors at any stage.

## Tests

- **`tests/p7-terrain.test.ts`** (new, in the quick suite, 12 cases):
  - the overlook's levels, and nothing else moved;
  - cliffs both ways, with the stair as the only way up;
  - walking up the stair onto every cell of the pad and back to the gate;
  - stopping at the lip, and stopping at the bluff's foot from the beach;
  - reloads settle on legal ground;
  - picking: straight down onto the pad, and a low ray from the beach meets the bluff's face;
  - the beach start still reaches its piles, and nothing new is saved;
  - the fall: a trickle while dead and full when restored; it lands on the canal's water, inside its two cells;
  - the clearance: zone and no trees;
  - the wasteland and beach-litter mix, and its determinism.
- **`tests/water-life.test.ts`:** the two canal-head culvert cases now expect the showcase fall instead. The
  hidden-grove facade culvert case is unchanged.
- **Regression suites (all pass):** walk bots (`oldcity-walkbot`), `goal-reachable`, `oldcity-height`, gates,
  keepers, `tree-placement`, `planting-zones`, `shore`, `wall-edges`, palette lint.
- **Quick suite (`npx vitest run`):** 139 files, 1,392 passed, 2 skipped (base: 1,380 + 12 new).
- **Full mode:** six tests fail exactly as they do on the base (salvage-reachability, cozy, ecosystem, decor,
  lucky-cat-city, mega-pulse), checked on a 25f8be47 worktree. They are not from this branch. `tsc --noEmit` is clean.

## What still looks wrong

- From the start camera (A) the fall is mostly hidden behind the beach's trees and the canal-side willow. It reads
  from the beach, the wide view and the shore side; the third-person opening shows the bluff, not the sheet.
- While Elder Grove is hidden (a fresh game), the fall isn't drawn: the overlook's chunk is sunk behind the cloud
  wall. You meet it as the grove opens.
- The overlook is grove ground, so beyond its cleared lip and rill it grows woodland. Seen from on top, the near
  canopy crowds the view.
- The rocky dressing is Saltwind only (the brief's scope). Other regions' walls are still plain stone and brick.
- Drones step a level when crossing a wall (unchanged, see the audit). Nothing can be built beside the overlook yet.
- The painted dead-earth texture already carries cracks, so the new geometric cracks read mainly at player height,
  not from the overview.
