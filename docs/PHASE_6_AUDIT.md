# Phase 6 audit: where the park stands against the target

The spec is *Solarbloom, Phase 6: Beauty Without Compromise* (E18–E26). The primary target is
[`docs/reference/target-park-phase6.png`](reference/target-park-phase6.png) (the fountain-awakening concept).
Baseline shots, each next to the target: [`docs/review/phase6-baseline/`](review/phase6-baseline/), produced by
`npm run build && node tests/e2e/phase6-baseline.mjs` (1920×1080, High tier, HUD visible).

Everything below was read from the code on `main` (689bea6) or seen in those shots. Frame rates are **not** measured:
this container renders with SwiftShader (software GL, about 5 fps), so only draw calls are meaningful here.

## Re-render after Look 3 and City 16 (2026-11-16, 09:30 UTC)

Main gained Look 3 (surfaces, foliage, machine models) and City 16 (roads). The same shots, on the merged code:
[`docs/review/phase6-latest/`](review/phase6-latest/). Draw calls rose from 180–300 to 220–390.

- **Better:** restored lawn is now one continuous textured grass carpet, with no checkerboard. Trees are rounded
  leafy clusters with real trunks, including pink blossom trees. There are fuller flowers and a modelled solar
  panel.
- **Unchanged:** the camera framing (24°, wide lens) and the grey columns behind the park. Paths are still square
  slabs with gaps, and plants still sit on pale hexagonal pads. The fountain is still a small dark cylinder, there
  is no other water, and the dead park is still tan slabs.

So E20 is now half done (lawn yes, paths and pads no), and the rest of the order below stands. Camera framing,
paths and pads, then the fountain and water, give the most visible gains.

## What the renderer already has (E18 is mostly built)

| Spec item | State on `main` | Where |
|---|---|---|
| Engine | PlayCanvas 2.23, WebGL2 | `package.json` |
| Colour management and tone mapping | HDR target, Khronos PBR Neutral tone mapping, sRGB output, exposure 1.0 | `data/look.ts`, `PostFx.ts` |
| Warm key light and cool fill | Directional sun (3.1) with a cool fill (`#8fb4ff`, 0.42) and a warm rim term in a shader chunk | `data/look.ts`, `LookShaders.ts` |
| Environment light | A 32² sky-and-ground gradient cubemap, baked to an env atlas (no HDRI, so reflections are only a gradient) | `SceneBuilder.ts` |
| Shadows | PCF3 2048² (Medium), PCF5 (High), 1024² on Low | `LookController.ts` |
| Contact AO | SSAO on High (CameraFrame) | `PostFx.ts` |
| Bloom, grading, antialiasing | Bloom (threshold 1.5, emissive only), grading, colour enhance, MSAA 2× / 4× | `PostFx.ts` |
| Vignette, depth of field | **On by default on High**: a brown vignette (0.32) and far depth of field. The spec says neither during normal play | `data/look.ts` |
| Quality tiers | Auto / Low / Medium / High | `Quality.ts` |
| UI outside post | Yes: the HUD is DOM over the canvas | `ui/` |
| Camera | Perspective with a zoom-dependent pitch: **24° at default zoom, 52° lens**, 42° at the overview; fixed 45° yaw; no rotation | `CameraController.ts` (`VIEW`) |

## What the asset side has (E19)

- **Only the drone is an authored model** (`assets/raw/drone/*.glb`, built by Blender Python scripts in
  `assets/tools/`). Everything else is built in code from boxes, cylinders and lumpy ellipsoids (`Shapes.ts`,
  `TreeGen.ts`, `MachineVisuals.ts`, `ChunkRenderer.ts`).
- The drone scripts expect **Blender 5 on a Windows path**. There is no Blender in this cloud container, so any
  new Blender-built asset has to be built on your machine (or we install Blender's Python module here; untested).
- There is no `visualId → prefab` registry yet; props are named strings switched on in the renderers.
- A palette exists and a test enforces it (`Palette.ts`, `tests/palette-lint.test.ts`), sampled from the *old*
  target (`target-look.png`). The Phase 6 swatches are close in spirit but not the same values.

## The park layout (the constraint for E23 and E26)

- The park is one 16×16 chunk (`PARK_LAYOUT` in `data/city.ts`): 242 restorable tiles, paths crossing at the
  centre, four benches, a 2×2 bandstand, a lamp, a rain barrel.
- **The fountain's footprint is 2×2 tiles** (cell 7,7). In the target the fountain plaza is about a third of the
  park's width, and a pond, a stream, a waterfall and a bridge take another 10–20%.
- The fountain's water today is a flat turquoise disc in a plain cylinder.
- The park's goal needs 130 restored tiles and 52 full blooms. A pond on playable tiles lowers the restorable
  count, so the goal numbers and the pacing bots would need retuning. Per the spec, a new layout needs your
  approval first.

## What the shots show, against the target

| | Now | Target |
|---|---|---|
| Framing | Pitch 24° with a 52° lens: a big foreground, the park recedes, and the top half of the frame is grey city | About 35° with a narrow lens: the whole park fills the frame, the city is a bright fringe |
| Ground | Every tile is a separate raised slab with a dark gap: a strong checkerboard, even on restored lawn | A continuous lawn; the grid shows only under the active pulse |
| Paths | Square pale slabs with gaps, the same grid as the lawn | Curved ivory paths with edging, laid out around the fountain |
| Plants | A pale **hexagonal pad under every plant**, stick-and-ball flowers spread evenly, blobby lime trees | Designed beds, hedges, layered trees with real trunks, a few strong silhouettes (the pink blossom tree) |
| Fountain | Small dark-blue cylinder, flat water disc | Three-tier ivory and gold fountain with falling water, the hero of the frame |
| Water | Only the fountain disc | Pond with lilies, waterfall, stream, bridge |
| Props | Box benches, a stick lamp, a plain bandstand | Timber-and-ivory benches, pergola with wisteria, greenhouse, arched gate |
| Surroundings | Giant grey columns and slabs in fog fill the top half | Bright solarpunk towers, terraces, waterfalls, greenery |
| Dead park | Tan, cardboard-like slabs with drawn-on cracks | (Not shown in the target; the spec wants "worn and dormant", warm grey) |
| Colour | Lime greens, saturated tan, brown vignette | Softer greens, ivory, gold accents, airy light |
| HUD | Already laid out like the target (resources top left, objective top right, toolbar bottom). A hint toast sits over the middle of the park | Same layout, softer cream cards |
| Draw calls | 180–300 | — |

**The biggest gaps, in order:** framing and the backdrop; the slab grid and plant pads; the fountain and water;
the plant designs; then props. Lighting is already reasonable once those change, and the HUD is close.

## Recommendation: what to take from Phase 6

**Do, in this order:**

1. **E18, trimmed (small).** Reframe the default camera to about 35° with a narrower lens, so the whole park fills
   1080p. Keep the perspective camera rather than switching to orthographic: a narrow lens already looks nearly
   isometric, and it keeps the picking, zoom bands and overview from Look 4. Turn off the vignette and the depth of
   field during play (keep them for a photo mode later). Add a brighter sky environment so ivory and water pick up
   reflections. Re-shoot the baseline.
2. **E20, seamless ground (the biggest single visual win).** Draw restored lawn as one continuous surface (no slab
   gaps, no checkerboard), paths as connected ivory paving with edging, and show the grid only in build and inspect
   mode and under the pulse preview. The simulation does not change.
3. **E21, landscaping.** Remove the hexagonal pads, group flowers into beds by zone (fountain beds, path edges,
   perimeter hedges, a shade grove), and add three proper tree shapes, including a blossom tree. All in code,
   seeded, so it fits the existing transitions.
4. **E23 + E26, fountain and water.** This needs a decision from you first: a new park layout with a larger
   fountain plaza (about 6×6), a pond, a short stream and a bridge. The plan: bump the save version (as before,
   while there are no players), retune the park goal, and re-run the pacing bots. Without a new layout, all the
   water has to fit into the non-playable edges, and the result will look token.
5. **E24, backdrop.** Replace the giant grey columns around the park with a lighter skyline of terraced towers and
   greenery that still reads as fogged. Small HUD polish: softer cards, and move hint toasts off the park.
6. **E22, props.** Bench, lamp, pergola, greenhouse, solar panel and condenser. These are best as authored
   models, which means Blender on your machine (the same route as the drone). I can write the Blender scripts here,
   but I can't run them in this container.

**Defer or skip:**

- **90° camera rotation:** every hand-placed composition would have to work from four sides, for little gameplay
  value. Later, if ever.
- **Orthographic projection:** see item 1.
- **Planar reflections, an Ultra tier, photo mode:** after the park looks right.
- **A separate art-test scene:** use the fixed park shots instead (`phase6-baseline.mjs`). It's cheaper and tests
  the real thing.
- **Drone audit (E19):** already done (#211).
- **E25 spectacle:** most of it exists (pulse rings, chain presentation, Frenzy, cat reveal, sound sliders,
  reduced motion). Revisit only after the new look, to make sure the effects still read on it.
- **Phone work:** none needed; keep the phone tests running but stop treating them as pass/fail requirements.

## Open decisions

1. **Park layout:** may the park be redrawn with a bigger fountain plaza, a pond and a stream (save version bump,
   goal retune)?
2. **Assets:** build props as Blender-scripted models on your machine (as the drone), or better code-built models
   for now?
3. **Camera:** confirm perspective with a narrower lens (recommended) over orthographic.
