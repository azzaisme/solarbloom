# P7-E28 (#714): vegetation composition and readable landscaping — results

Branch `p7-e28-vegetation` (on top of final P7-E27, `p7-e27-lighting` @ 86d8aa40). Shots from
`tests/e2e/p7-shots.mjs` (1920×1080, High, noon, sunny), mid and late stages. Baseline: a build of 86d8aa40 alone
(its metrics: `e28-after/metrics-before.json`; its images match `after/` from E27). After: [`e28-after/`](e28-after/).

## What changed

- **Planting zones (#726)**: `src/rendering/PlantingZones.ts`, `zoneAt(x, z, ctx)` → `open_lawn`, `meadow`,
  `flower_garden`, `shoreline`, `woodland_understory`, `path_edge`, `landmark_clearance`. A pure function of the cell,
  its neighbours (paths/roads, water, machines), the area's landmark, feature and area type, plus seeded low-frequency
  noise. `ctx.ignoreOccupants` drops machines (for P7-E29's trees, so they never pop in or out). Tunables in `ZONES`.
- **Dressing by zone**: `ChunkRenderer.restoredTile` → `Surfaces.zonedPlanting` replaces the same
  grassTufts + flowerDrifts + thrivingExtras + radiantExtras on every natural tile (paving unchanged).
  - layers (#731): turf, sparse grass clumps, medium bushes, flowering masses, rare statement pieces;
  - density hierarchy (#728): ~41–52% calm / 30–36% moderate / 17–26% dense over a sample park (unit test);
  - families (#729, #733): 2–3 primary colours + one accent per bed, shared across neighbouring tiles by noise; a rare
    red variety in about one garden bed in forty;
  - view corridors (#730): `path_edge` is one low row set back from the path; `landmark_clearance` (≤1 tile of the
    landmark or a machine) stays short grass; the next ring (2–3 tiles) is a full destination bed;
  - shoreline: new reeds (`Flora.reedGeo`) toward the water and wet stones, a couple of low bank flowers, no flowers in
    the water;
  - progressive by zone (#732): stages 1–2 mostly grass; gardens fill in by Thriving; Radiant adds a gold daisy in beds
    and meadows only (the golden grass carries the stage).
- **Deterministic (#727)**: everything seeded by cell; nothing saved or read by the sim; a rebuild draws identical
  plants (unit test). Barren tiles untouched.

## Metrics (day)

| Shot | Draw calls | Clipped % | Mean sat |
|---|---|---|---|
| mid-day-third | 1098 → 1093 (-0%) | 0.02 → 0.04 | 0.513 → 0.495 |
| mid-day-iso | 1056 → 1159 (+10%) | 0 → 0 | 0.161 → 0.162 |
| mid-day-shore | 807 → 719 (-11%) | 0 → 0.01 | 0.468 → 0.468 |
| late-day-third | 1673 → 1677 (+0%) | 0.03 → 0.04 | 0.562 → 0.549 |
| late-day-iso | 1485 → 1492 (+0%) | 0 → 0 | 0.292 → 0.296 |
| late-day-shore | 1309 → 1074 (-18%) | 0 → 0 | 0.505 → 0.501 |

Draw calls within the +25% budget everywhere (mid iso +10%; the shore camera drops, fewer foliage pieces).

## Tests

`npx vitest run`: 136 files, 1358 passed, 2 skipped (E27's 1351 + 7 new in `tests/planting-zones.test.ts`).
`tsc --noEmit` clean. Palette lint passes (new swatches `reed`, `reedHead`, `wetStone`).

## What still looks wrong

- **Lime lawn**: with the carpet gone the turf shows; it probes at ~(140–150, 188–207, 53–64) on screen, at the top of
  the brief's green range and a little low in blue. Turf colour is E27's calibration (stageGrass); flagging, not
  changed here.
- From the iso camera beds read only as faint speckle: the zones work at player height, but from far up the restored
  ground is mostly flat lawn. Trees (P7-E29) are what should break it up there.
- The near foreground right of the jetty is meadow/shoreline by zone, so it is mostly grass and reeds at the start
  view; the colourful beds sit in the mid-ground.
- Not yet checked on screen: the redraw when a machine is built beside a bed (by design it becomes clearance + a ring
  bed; unit-tested, not shot).
