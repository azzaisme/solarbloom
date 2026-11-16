# Look 3: surfaces, foliage and detail

Epic #105 (part of #102). Shots: `npm run shots:look3` → `docs/review/look3/`.

## Texture and material pipeline (#128)

**Approach: world-space detail textures over vertex colours.** The ground, props and foliage stay merged,
vertex-coloured meshes (one draw call per chunk for solids, one for foliage). A shader chunk on the shared
vertex-colour material (`DetailTex.ts`, patching `diffusePS` and `normalMapPS`) multiplies in detail:

- **Layer:** from the vertex colour (green → grass, low saturation → stone, anything else → generic grain), or
  forced per material with `mat(hex, { detail: 'stone' | 'metal' | 'bark' | 'plaster' | 'grass' })`. The option
  is part of the material cache key.
- **Projection:** onto the dominant world axis of the normal, so no UVs are needed. Two scales are mixed (one
  rotated), so nothing visibly repeats over a 10×10 area.
- **Distance:** faded with camera distance (bands per quality tier), so the far view is plain colour.
- **Foliage:** the foliage material is deliberately left out; the stone and grass normals made canopies crinkly.
- **Leaves (Look 3.7, owner review against the reference):** the foliage material draws its own leaves instead:
  a 3D cellular pattern in world space (`Foliage.ts`, `diffusePS` / `normalMapPS`) over every clump whose vertices
  carry `LEAF_FLAG` (+2 on the flex in `position.w`). Each cell is a rounded leaf, lighter toward the sun, with dark
  gaps and a bent normal. It costs no triangles or textures and fades out by screen size (`fwidth`) so far trees
  don't shimmer. Strength per tier via `setLeafTier`.

**Textures:** two 256² RGBA maps, generated procedurally at startup a slice per frame after first paint, with
flat 1×1 placeholders until then.
- detail: R stone, G grass, B grain, A cracks
- normal: RG stone, BA grass

**Budget:** 0 KB download, about 0.7 MB GPU memory with mips. `detailTextures.useTextures()` is the hook for a
KTX2/Basis atlas loaded through the asset registry later. No third-party textures are used.

| Source | Licence |
|---|---|
| All textures (procedural, `DetailTex.ts`) | own work |
| All geometry (procedural: `Flora.ts`, `Props.ts`, `TreeGen.ts`, `MachineParts.ts`) | own work |

## Where things live

| File | What |
|---|---|
| `Flora.ts` | Swaying templates: grass clumps, five flower species (bud and open), leafy and flowering shrubs, ivy, banners |
| `Props.ts` | Solid templates: bevelled boxes, paving slabs, planters, railings / balustrades / parapets, the clutter kit |
| `Surfaces.ts` | Per-stage tile dressing that `ChunkRenderer` calls: turf, grass, drifts, paving, extras, planters, area edges, facades. Look 6 can call these for in-between stages |
| `TreeGen.ts` | Trees: the Phase 5 WIP, with soft leaf-card shells over the canopy puffs (#134) |
| `Pollinators.ts` | Bees, hoverflies, drifting leaves, falling blossom (#143) |

Templates use the tree format (`TreeGeo`: x, y, z, flex; linear RGBA bytes), are built once and cached, and are
warmed a few milliseconds per frame. Placement is seeded by tile position, so a tile renders the same after a
reload.

## Decisions

- **Instancing (#144): merged per-chunk meshes, not GPU instancing.** Each chunk is already 1 solid and 1 foliage
  draw call. Instancing every template (5 flower species × colours, grass, shrubs, props) would multiply draw calls
  per chunk, and the wind and see-through tree shader would need an instanced variant. The cost of merging is
  rebuild time and memory, so detail is budgeted by:
  - zoom band: near > 1.3, mid; far chunks keep only slabs. Mid zoom uses plain slabs and 0.6× density.
  - tier: low 0.4×, medium 0.7×, high 1×.
  - fog: hidden chunks keep only cheap shapes.

  `chunks.detailStats()` reports triangles, and `test:perf:browser` gates the heaviest chunk.
- **Planters (#136):** decorative only, no gameplay effect.
- **Area edges (#137):** each shared boundary is drawn once (by the park, otherwise by the area whose id sorts
  first), with gaps where roads, water or paths cross. Railings are props placed on the boundary, so Look 4's
  facades and heights can sit under them without changes to its geometry.
- **Wind (#143):** everything swaying uses the existing foliage wind (`position.w` flex). Reduced motion and
  `?still` freeze it.

## Meshy hooks

The clutter kit, planters and machine parts are candidates for generated models (`docs/art/meshy-assets.md`).
Load them like the drone (`DroneVisuals.ts` GLB path through the asset registry), flatten them to a `TreeGeo`,
and return them from the caches in `Props.ts` / `Flora.ts`. Placement stays as it is. No Meshy credits have been
spent.
