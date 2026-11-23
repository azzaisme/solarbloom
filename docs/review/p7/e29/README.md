# P7-E29 tree canopy: before / after

`base/`: P7-E27 (work in progress) + P7-E28 zones, the original leafy trees, no beach trees (mid/late, day, no HUD).
`after/`: `p7-e29-trees` on the final P7-E27 and P7-E28 (with its open `beach` zone). The third-person and shore
and iso shots are the final version (leafy trees with forms; mid third/shore from the pass just before the forms);
the early shots (no trees) are from an earlier pass. All from `tests/e2e/p7-shots.mjs` (High tier, software GL); `foliageTris` is
`ChunkRenderer.foliageTris()` (all foliage: trees, shrubs, grass, flowers).

| shot | draw calls | foliage triangles | mean lum |
|---|---|---|---|
| mid third | 1090 → 1099 | 258k → 475k | 164.6 → 171.9 |
| mid shore | 808 → 598 | 265k → 470k | 175.8 → 165.6 |
| mid iso | 1102 → 1103 | 118k → 231k | 195.7 → 197.2 |
| late third | 1674 → 1671 | 1095k → 1602k | 157 → 164.9 |
| late shore | 1310 → 902 | 1102k → 1352k | 171.2 → 160.8 |
| late iso | 1487 → 1641 | 582k → 844k | 183.2 → 183 |

Draw calls stay within the +25% budget (late third +4%; the shore views drop because the canopy and terrain hide
chunks behind them). No page errors.

What the epic ended with (owner's direction):
- the original leafy trees (`TreeGen.ts` as on the base branch: limbs, twigs, leaf sprays, original LODs), varied:
  six variants with their own proportions (crown width 0.84–1.22×, height 0.86–1.18×, a gentle lean) and natural
  greens (olive, mid, deeper, soft yellow-green); size classes (small, mid, large, rare hero specimens);
- tree forms in the same leafy style, as shapes of existing species: umbrella (oak; specimens and some large grove
  oaks), columnar (birch; rows two cells off paths and canals), fruit (cherry; garden accents) and coastal (oak;
  specimens by the water, leaning away from it); willows with longer weeping strands;
- placement by planting zone (P7-E28, machines ignored), a pure function of seed and cell: groves, specimens framing
  paths and water, willows on shores, blossom accents; none on path edges, round landmarks or near jetties and
  bridges (only small trees within 6 cells of a deck);
- Saltwind Beach: trees inland, thinned to a few specimens and small groves, no pines on the coast, and none on the
  open sand by the sea (P7-E28 `beach` zone);
- dappled shade (shadow pass) and a near-camera fade.

Pacing (owner-approved): songbirds after 450 restored tiles round the start (975 before P7-E29); see the commit
"P7-E29 tree forms".

Still open: young (stage-2) trees are small versions of the grown ones.

## Polish pass (on the Phase 7 base @9c1f2bd8, with P7-E30)

`polish/`: late third (camera A), mid shore, and E30's falls views `late-day-wide` and `late-day-overlook`
(`tests/e2e/p7-falls-shots.mjs`).
- Near-camera trees are left out whole (per tree, by view depth against its height), so no dither speckle on near
  crowns (the wide view's birch and blossom, the crown in the overlook viewer's face).
- The line from the jetty landing to the waterfall's lip carries only small trees; checked in camera A by projecting
  the lip (screen ≈ 975, 250–290 of 1920 × 1080): no crown covers it now. At 33 tiles the pale sheet still melts into
  the hazy bluff, which is atmosphere and the fall's own contrast, not trees.
- The overlook's top is open; its seaward and beachward edges carry only small trees.
- No columnar rows or big trees within 6 cells of a landmark: the Sea Lock reads from the canal path.
