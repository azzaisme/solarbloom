# Phase 7 visual acceptance tests

## Fixed cameras and stages

`npm run build && node tests/e2e/p7-shots.mjs [outDir]` (default `docs/review/p7/<TAG>`), 1920×1080, High tier,
noon (day fraction 0.3), weather forced sunny. Software GL renders High at ~1 fps in the cloud container, so the
script pauses rendering while the world streams and resumes it only to take each shot (frame times are not
meaningful there; draw calls and triangles are).

| Camera | What | How |
|---|---|---|
| **A third** | Third-person follow camera at Bloombot's start on the jetty | the game's own opening zoom and pitch, yaw 20° |
| **B iso** | High isometric overview | furthest zoom over (2, 30), yaw 200° |
| **C shore** | Shoreline: canal bank by the plank bridge, looking along the canal past restored and ruined ground | follow camera at (−3.75, 30.5) looking +z |

| Stage | Ground |
|---|---|
| early | fresh game, nothing restored |
| mid | the start's and the canal's own areas cleared, radius 8 round each spot at full bloom |
| late | radius 20 round each spot at full bloom, every area in that radius cleared |

Each shot is saved with and without the HUD (`-ui.png`). Options: `ONLY=day,golden,night`, `STAGES=…`, `CAMS=…`,
`NOUI=1`, `DIST=<dir>` (serve another build), `PORT`, `GFX=medium`.

## Measured per shot (`metrics.json`)

- `clipPct`: % of pixels below the top 22% of the frame with any channel ≥ 254. Target **< 1%** by day.
- `meanLum`, `meanSat`: overall brightness and saturation (to catch wholesale darkening or fluorescence).
- `drawCalls`, `triangles`: the last frame's render stats. Budget: no more than +25% draw calls over baseline.

## Visual QA scorecard (1–5, from the fixed shots, before and after)

1. Lighting / tonality: highlights keep detail, depth reads, no fluorescent wash or veil.
2. Composition: hierarchy, paths and focal points are readable.
3. Vegetation: clusters with negative space; habitat-consistent.
4. Canopy / depth: tree silhouettes and vertical layering.
5. Landform: meaningful relief without clutter.
6. Water integration: shores and reflections support the scene.
7. Landmarks: recognisable and tied to goals.
8. Horizon: coherent ruined city with controlled atmospheric perspective.
9. Restoration storytelling: dead → thriving is unmistakable.
10. Usability: player, prompts and targets visible; no clipping.

## Regression gates (every integration checkpoint)

- `npm run typecheck` clean.
- `npx vitest run`: same pass count as baseline (baseline: 1325 passed, 1 failing suite that fails on `main` too).
- p7-shots runs with **no page errors** at every stage.
- Save compatibility: nothing new is written to `GameState`; cosmetic placement is a pure function of the cell.
- Walkability/picking: no change to `core/Height.ts` levels, ramps or `Solids` for playable tiles unless a story says
  so and its tests pass.

## Per-epic acceptance (summarised from the spec)

- **P7-E27 lighting:** no yellow-white veil; sand, ivory, white and sky distinguishable; grass natural green;
  grounded soft shadows; water keeps its colour; clipPct < 1% by day; golden hour and night still readable.
- **P7-E28 vegetation:** calm lawn areas and colourful beds both present; clusters of 2–3 colours; paths, bridge and
  Bloombot legible; barren tiles carry no bright plants; deterministic.
- **P7-E29 trees:** big layered trees in the restored start area, at least one shaded grove; no lollipop spheres;
  trees never block the jetty, the bridge or prompts.
- **P7-E30 terrain/water:** visible relief from cameras A and B; a showcase waterfall where water really drops; no
  floating props or gaps at banks; walkability unchanged.
- **P7-E31 landmarks:** at least one restored focal point recognisable without labels.
- **P7-E32 horizon:** a layered ruined skyline instead of empty haze / grey blocks; distance fades blue, not milky;
  clouds read as cohesive banks, not balls.
