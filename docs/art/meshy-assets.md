# Meshy asset list

Which objects come from Meshy (AI-generated meshes) and which stay procedural, with budgets for each.
Tracked by Look 3.18 (import pipeline) and Look 3.19 (this list) under the art-direction epic #102.
Reference: `docs/reference/target-look.png`. Current state: `docs/reference/comparison.jpg`.

## Rule of thumb

**Meshy:** standalone, characterful objects that appear a few times on screen.
**Procedural:** anything with hundreds of copies, anything that tiles, anything that follows an outline, and anything
that morphs through a Look 6 transition. Trees are procedural already (`TreeGen.ts`).

Roughly 40 models plus about 20 small upgrade parts. That's about 30% of what you see on screen. The other 70%
(ground, grass, flowers, moss, cracks, vines, railings, trees) stays in code.

## Camera note

The camera is perspective with a zoom-dependent pitch: 25° close up, 40° zoomed out. Close up you see the sides
and partly the backs of models, so every model must hold up from all around (no billboards, and no unfinished backs
on the 45° yaw side). Detail matters most at near zoom. At far zoom, use the LOD1 version.

## Budgets

| Class | LOD0 tris | LOD1 tris | Texture | Notes |
|---|---|---|---|---|
| Character / hero | 3–8k | ~1k | 1024² | Split into moving parts |
| Machine | 2–5k | 600–1k | 1024² (shared atlas per machine) | Upgrade parts are separate meshes |
| Landmark | 4–8k | ~1.5k | 1024² | One per area, so it can afford detail |
| Area obstacle | 300–1.2k | 150–300 | 512² atlas | Dozens per area, so instanced |
| Edge clutter prop | 300–1.5k | 150–400 | 512² atlas | Instanced, many per area |
| Planter shell | 400–800 | 200 | 512² atlas | Flowers inside are procedural |
| Skyline piece | <500 | none | 256–512² | Background only, fogged and blurred |

All textures are PBR (albedo, normal, ORM) with **no baked lighting or shadows**. Export as GLB, then convert to
KTX2. Real-world scale: 1 tile = 1 m, and the pivot goes at the base centre.

## Style prompt prefix (use for every generation)

> stylized solarpunk game asset, soft bevelled edges, cream ceramic and white plastic, brushed gold trim, warm
> limestone, rusty copper pipes, clean readable silhouette, hand-painted PBR, no baked shadows, isometric game prop

Attach `docs/reference/target-look.png` as the style image. Use **re-texture on the same mesh** for dead and
restored variants so their shapes match for the Look 6 crossfade.

## Asset list

Priority: **P0** = pilot (proves the pipeline), **P1** = on screen in the first session, **P2** = later areas
and polish.

### Characters (3)
| Asset | Pri | Parts to split | Variants | Notes |
|---|---|---|---|---|
| Drone | P0 | body, visor, eyes (emissive), leaf sprout ×2, nozzle | none | Replaces `DroneVisuals.ts` (Look 3.13) |
| Cultivator | P1 | chassis, treads, tine drum (spins), solar canopy (tracks sun), seed hopper (glass, fill level), moss roller | tier 1–3 silhouettes | Look 6.9 |
| Lucky cat | P2 | body, paw (waves) | none | `CatVisuals.ts`, sits in the wall-niche prop |

### Machines (8 bases plus upgrade parts)
Today's upgrade extras are added in code per level (`MachineVisuals.ts`: extra wing panels, tanks, mist rings).
Keep that system and make the extras Meshy parts too.

| Asset | Pri | Parts to split | Upgrade parts | Notes |
|---|---|---|---|---|
| Solar Panel | P0 | pedestal, tilt arm, panel (cell grid, tracks sun) | wing panel | Look 3.12 |
| Water Condenser | P1 | body, glass tank (water as separate emissive mesh), lid, valves | extra tank, mist ring | |
| Rooftop Core | P1 | stepped dais, arch, leaf emblem (emissive) | none (dormant and awake use re-texture) | |
| Pollinator Garden | P1 | basin, hive boxes | extra hive | |
| Drone Hub | P1 | pad, mast, charging ring | extra pad | |
| Mother Tree | P2 | planter base and collar only (tree is `TreeGen`) | brass collar tiers | |
| Reservoir Garden | P2 | white basin (water level is procedural) | none | |
| Bloom Relay | P2 | pylon, crystal (emissive) | antenna | |

### Landmarks (8)
| Asset | Pri | Variants | Notes |
|---|---|---|---|
| Dry Fountain (park) | P1 | dry and flowing (water is procedural or animated) | The first landmark the player sees |
| Signal Mast (street) | P2 | dead and lit | |
| Clock Tower (plaza) | P2 | dead and restored | Hands are a separate part |
| Lock Gate (canal) | P2 | closed and open | Gates are separate parts |
| Market Hall (market) | P2 | dead and restored | |
| Old Cistern (reservoir) | P2 | dry and full | |
| Bandstand (park) | P1 | dead and restored | Bunting stays procedural |
| Elder Tree (grove) | none | none | **Procedural** (`TreeGen`); a planter or collar at most |

### Area obstacles (8), instanced
| Asset | Pri | Variants |
|---|---|---|
| Bench | P1 | rusty, restored |
| Stump | P1 | dead, mossy or overgrown |
| Bollard | P1 | rusty, restored |
| Cracked pillar | P2 | dead, vine-covered |
| Mooring post | P2 | dead, restored |
| Market stall | P2 | broken, restored |
| Dry drain | P2 | dry, flowing |
| Barrel | P2 | rusty, planter |

### Edge clutter (12), instanced (Look 3.11)
AC unit (fan grille as a separate spinning part) · copper wall pipe (straight, elbow, valve) · wooden crate (2
sizes) · vent / duct · lantern (emissive glass) · lamp post (dead and lit) · broken pot · rubble pile · stone block
· wall niche · banner pole with gold finial (banner cloth stays procedural for wind) · satellite dish.
All P1 except the dish and niche (P2).

### Planter shells (3) (Look 3.9)
Long stone trough, square raised bed, round pot. P1. Flowers and soil inside are procedural.

### Skyline (6–8), optional (Look 4.8)
Terraced tower ×3 variants, bridge span, glass dome, waterfall cliff block. P2. Waterfalls are scrolling-texture
cards added in code.

## Keep procedural (do not generate)
Ground tiles and paving slabs (including breakup) · cracks, moss, soil, turf, wet mask · grass and flowers ·
vines and roots · railings and balustrades (follow outlines) · banner cloth · trees and shrubs (`TreeGen`,
`Foliage`) · water surfaces · fog · all VFX.

## Pilot

Run the **Drone** and **Solar Panel** through the whole Look 3.18 pipeline first, and compare them in the
`shots:look` scenes before generating anything else.
