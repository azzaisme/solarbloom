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

## Owner / lead follow-ups (same branch)

- **Beach zone** (`'beach'` from `zoneAt`, `beachDepth`): Old City sand within a wavy ~2–4.4 tile band of open sea or
  surf stays clean pale sand once restored (`PALETTE.beachSand`): a wet gradient band at the waterline, a few shells and
  pebbles, the odd bleached log, dune grass only on the inner part; no flowers, no trees. Beach and lawn blend through
  shared turf corners, and lawn bordering the beach grows no flowers (dune grass → sparse grass → lawn). Visual only.
  Canal and pond banks stay `shoreline`.
- **Lime lawn fixed**: the lawn greens (tones, sunlit, shadow, stages 1–3) are pulled to a natural mid-green
  (R×0.85, G×0.91, B×1.3 kept under R); Radiant is pulled less and stays the warm, bright stage. On screen the late
  third-person lawn averages (139, 188, 72), inside the brief's lit range (110–140, 165–190, 65–85).
- **Ragged restored edge**: `Surfaces.lawnFringe` spills turf over same-level dead natural ground as a wavy strip
  (world-noise outline, continuous across tiles) with young tufts, instead of tile squares.

- **Restored vs dead beach** (final lead review): restored beach is a warmer, lighter cream-gold with sparse low dune
  grass across the strip (thicker toward the lawn) and the odd sea thrift near the inner edge. **Dead sand was adjusted
  (E27-final, with the lead's OK)**: `GroundTex.paintSand` desaturated toward a dusty grey-beige with drab wrack lines
  and grit specks, and `PALETTE.ground.painted.sand` (its average) `#e9dfc2` → `#d8d0bd`; `sunlit-look` still passes.
  `early-day-third` (all dead) still reads as a beach, dull and abandoned. Third-person early/mid/late re-shot for this
  (draw calls 1039 / 1090 / 1705; clip ≤ 0.05%). Extra litter/cracks on dead tiles were not added: that dressing is
  in ChunkRenderer's dead-tile branch, outside this epic's functions.

## Metrics (day)

| Shot | Draw calls | Clipped % | Mean sat |
|---|---|---|---|
| mid-day-third | 1098 → 1092 (-1%) | 0.02 → 0.05 | 0.513 → 0.417 |
| mid-day-iso | 1056 → 1072 (+2%) | 0 → 0 | 0.161 → 0.142 |
| mid-day-shore | 807 → 619 (-23%) | 0 → 0 | 0.468 → 0.438 |
| late-day-third | 1673 → 1690 (+1%) | 0.03 → 0.05 | 0.562 → 0.452 |
| late-day-iso | 1485 → 1485 (+0%) | 0 → 0 | 0.292 → 0.28 |
| late-day-shore | 1309 → 1307 (-0%) | 0 → 0 | 0.505 → 0.464 |

Draw calls within the +25% budget everywhere (largest +2%; the mid shore camera drops 23%).

## Tests

`npx vitest run`: 136 files, 1358 passed, 2 skipped (E27's 1351 + 7 new in `tests/planting-zones.test.ts`).
`tsc --noEmit` clean. Palette lint passes (new swatches `reed`, `reedHead`, `wetStone`).

## What still looks wrong

- From the iso camera beds read only as faint speckle: the zones work at player height, but from far up the restored
  ground is mostly flat lawn. Trees (P7-E29) are what should break it up there.
- The near foreground right of the jetty is meadow/shoreline by zone, so it is mostly grass and reeds at the start
  view; the colourful beds sit in the mid-ground.
- Not yet checked on screen: the redraw when a machine is built beside a bed (by design it becomes clearance + a ring
  bed; unit-tested, not shot).
