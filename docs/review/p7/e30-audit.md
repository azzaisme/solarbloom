# P7-E30.1 (#741): where the game assumes flat ground

Audit of branch `p7-e30-terrain` on the Phase 7 base (25f8be47). The Old City has had real terraces since E21.24:
`core/Height.ts` gives every ground cell a level 0–4 (1.2 tiles each) from region data, with ramps and stairs. Levels
are a pure function of the cell, never saved, and never read by the simulation. So the question for each system is
whether it samples that height, not whether the world is flat.

| System | Where | Samples height? | How |
|---|---|---|---|
| Tile picking (mouse, touch) | `core/Picking.ts` `pickTerraced`, used by `Game.pick` (`app/Game.ts` ~2750) | Yes | Ray-marches the terrace height field (`heightAt`), so a ray meets the first wall or top it hits. A sunk (hidden) chunk is offset by `SINK` |
| Ground y under a point (cursor, markers) | `Game` ~2769 | Yes | `levelY(heightAt(px, pz))` on a terraced layer |
| Targeting (prompts, the waymark, the trail, goal spots) | `rendering/Waymark.ts`, `Trail.ts`, `ui/GoalSpot.ts`, `gameplay/Advisor.ts` | Yes | Markers draw at `levelY`/`heightAt`; goals are chosen by walk cost (`Walker.costs`), which respects cliffs |
| Machine placement | `gameplay/BuildSystem.footprintProblem` | Yes | A footprint across two levels or on a ramp is refused ("Needs level ground"). The ghost and the machine stand at `grid.tileWorld` (with the level) |
| Machines, crops, pipes, lights, cats, keepers, overlays drawn | `rendering/*Visuals.ts`, `Overlays.ts`, `WaterOverlay.ts`, `PipeVisuals.ts` | Yes | `grid.groundOffset` or `tileWorld` per tile |
| Drones | `gameplay/DroneSystem.worldOf` | Yes, per cell | Flies at the ground offset of the cell under it. It steps when crossing a wall (see gaps) |
| Bloombot's movement | `gameplay/Walker.ts` (`fits`, `move`, `settle`) | Yes | A step is legal only where edge heights match (`canStep`/`connected`); cliffs block both ways, so bloombot never falls or climbs a wall |
| Bloombot's y and the follow camera | `app/BotController.ts` 132, 195 | Yes | `levelY(heightAt(x, z))`, continuous on ramps |
| Paths (A*, walk costs, the trail) | `Walker.path`, `Walker.costs`, `gameplay/TrailRoute.ts` | Yes | Neighbours only through `canStep` |
| Solids (the cats' CPU line of sight) | `core/Solids.ts` (`SOLID_SINK` from the chunk builder) | Yes | Records what is drawn at its real height, walls included |
| Harvestable spots (salvage piles, caches, pages, lookouts) | `ChunkRenderer.oldCityProp`, `KeeperSystem` | Yes | Drawn at the tile's top (`th`). Placement data is checked reachable by tests (`oldcity-height`, `goal-reachable`) |
| Trees, plants, water, banks, fog | `ChunkRenderer`, `TreePlacement`, `Shore.ts`, `WaterSurface` | Yes | Per tile at `th`; banks and walls (`terrace`, `wallDrop`) meet the lower side; fog follows the highest ground at each vertex |
| Saves | `core/GameState.ts` | n/a | Bloombot is saved as `{ roofId, x, z, facing }`; tiles as deltas by id (`layer:x:z`); machines by tile. No y and no level is ever saved. `Walker.settle` puts a reloaded bot on legal ground |

## Gaps found

1. **Drones step at walls.** A drone's height is the ground offset of the cell under it, so crossing a wall it jumps
   by a level (1.2 tiles; 2.4 at the new overlook). This is how it already behaved at every terrace edge. A hub would
   need to be built beside the overlook to fly over it, and the overlook sits in Elder Grove, where nothing is built
   yet. Left as is, noted for a later smoothing pass.
2. **Nothing else assumes flat ground in the Old City.** Every system above samples the terraces already. New height
   must therefore come as region `stamps`/`ramps` (data), not as a parallel system, which is what P7-E30 does (#742).
3. **The ground-generation fallback** (`GROUND_GEN` below 5, the old endless city) has no levels at all. `terraced()`
   is false there, and every height call returns 0. Unchanged.

## What P7-E30 changes

One real height change: the Falls overlook, a level-2 stamp in Elder Grove (`x −5…−1, z 12…15`) with a two-tile stair
from the grove (`x −2…−1, z 10…11`). Everything else is dressing, with no change to levels, walkability or ids.
Regression cases: `tests/p7-terrain.test.ts` (levels, cliffs both ways, walking up and stopping at the lip, reloads,
picking, the beach start's piles, nothing saved), plus the existing walk-bot, goal-reachable, height, tree and zone
suites.
