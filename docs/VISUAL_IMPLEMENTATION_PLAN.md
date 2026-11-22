# Phase 7 implementation plan

Spec: `SOLARBLOOM_PHASE_7_LIVING_LANDSCAPE_EPICS.md`. Direction: `docs/VISUAL_DIRECTION.md`. Tests:
`docs/VISUAL_ACCEPTANCE_TESTS.md`. Tracker: `docs/AGENT_TASKS.md`.

## Audit (main @ ab2e5cd6, 22 Nov 2026)

**Renderer.** PlayCanvas 2.23, WebGL2. HDR CameraFrame on Medium/High: Khronos PBR Neutral tone mapping, exposure
1.1, sRGB output, bloom (threshold 1.8 scene-referred), SSAO on High, grading (warm/dead blend by restoration),
MSAA 4×, cascaded PCF shadows (4096², 3 cascades on High). Lights: sun `#ffdcaa` 2.1 following a day arc (8°→50°),
fill `#d0dcf0` 0.45, sky/ground env atlas 0.7, custom rim term. Atmosphere: linear scene fog to `LOOK.haze`
(`#f4ecdc`) from ~6–8 to 44–76 world units past the camera target, plus a horizon-band haze shader, 90 light motes
and 5 light shafts on High. All numbers in `src/data/look.ts` / `src/data/sky.ts`; live-editable in dev builds via
`window.solarbloom.look.cfg` + `look.apply()`.

**World.** An endless chunked grid (16×16 chunks, `layer:x:z` tile ids). The opening map is the Old City island:
regions with terrace levels 0–4 (1.2 tiles per level, `core/Height.ts`, ramps/stairs, never saved), sea all round,
canals with weirs and falls, a jetty and plank bridges. Bloombot starts on the jetty of **Saltwind Beach** (region
type `beach`, ground `sand`, level 0). E28 water (#694–#699) is recent and polished: one surface, depth colour,
ripples, foam, reflections, living water (lilies, fish, reeds), culvert outlets and falls.

**Vegetation.** Per tile, in `ChunkRenderer.restoredTile` → `Surfaces.ts` (`grassTufts`, `flowerDrifts`,
`thrivingExtras`, `radiantExtras`), geometry from `Flora.ts`, trees from `TreeGen.ts` (oak, cherry, birch, pine,
willow; 4 growth stages, LODs) placed by `TreePlacement.treeSpot` per area type. **Beach has no tree rule and sand
is not "natural" ground, so the restored start area grows no trees at all**, and every restored tile gets the same
flower drifts — the uniform carpet in the screenshots.

**Horizon.** The distant skyline backdrop was removed in #681. Beyond the island the view is fogged city chunks
(flat grey slabs under fog sheets), raised grey terrace walls, CloudWall puff-ball clouds along sealed edges, and
the haze. Hence "pale indistinct placeholder shapes".

**Baseline shots:** `docs/review/p7/before/` (3 cameras × early/mid/late, with and without HUD, `metrics.json`).

## Biggest gaps against the target (in order of visual impact)

1. Milky warm veil: cream haze colour, short haze distance, light shafts and motes, pale sky low down. (P7-E27)
2. No trees in the start area; flowers carpet every restored tile evenly. (P7-E29, P7-E28)
3. Horizon is grey fog blocks and ball clouds rather than a ruined city. (P7-E32)
4. Saturated orange sand on dead ground. (P7-E27 / palette)
5. Flat beach; little relief in view; no showcase waterfall. (P7-E30)
6. No single focal landmark in the start view. (P7-E31)

## Workstreams, ownership and order

| Stream | Owner | Files owned | Depends on |
|---|---|---|---|
| P7-E27 lighting, haze, sky colour, dead-sand tone | Lead (Agent A) | `data/look.ts`, `data/sky.ts`, `Sky.ts`, `Atmosphere.ts`, `LookController.ts`, `PostFx.ts`, `DayNight.ts`, palette dead-ground colours | — (first) |
| P7-E28 planting zones + P7-E29 trees | Agent B | `TreePlacement.ts`, `TreeGen.ts`, `Flora.ts`, `Foliage.ts`, `Surfaces.ts`, new `PlantingZones.ts`, `ChunkRenderer.restoredTile/plantExtras/addTree/farTile` | E27 values for judging colour |
| P7-E32 ruined skyline + clouds | Agent E | new `Ruins.ts` (skyline), `CloudWall.ts`, `Clouds.ts`, Game wiring (one hook) | E27 haze colour |
| P7-E30 relief + waterfall, P7-E31 landmark | Agent C/D | new modules for backdrop relief / showcase fall, `WaterLife.ts` falls, landmark art in its own module | E27 |
| Integration + QA | Lead (Agent F role) | `tests/e2e/p7-shots.mjs`, docs, merges | all |

Agents work in isolated git worktrees on their own branches; the lead merges them into
`claude/trusting-fermi-cgucwe`, resolving any `ChunkRenderer.ts` / `Game.ts` overlaps. Each agent changes only its
own files plus a minimal, clearly marked hook in shared files.

## Integration checkpoints

1. **CP1** after E27: re-shoot, compare, commit. Agents B/E/C rebase on it.
2. **CP2** after B, E and C/D land: typecheck, full unit suite, p7-shots (all stages, day), fix regressions.
3. **CP3** polish pass: golden hour and night shots, scorecard, remaining-issues list.
