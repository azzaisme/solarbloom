# P7-E29 tree canopy: before / after

`base/`: P7-E27 lighting + P7-E28 zones, old trees (`p7-e29-trees` before tree work, mid/late, day, no HUD).
`after/`: `p7-e29-trees` after the lead's review, on the final P7-E27 (@86d8aa40) (mid/late; early from the run before,
which has no trees). Base was taken on E27 work in progress, so part of the luminance change is E27's. Both from `tests/e2e/p7-shots.mjs`
(High tier, software GL); `foliageTris` is `ChunkRenderer.foliageTris()` (all foliage: trees, shrubs, grass, flowers).

| shot | draw calls | foliage triangles | mean lum | clip % |
|---|---|---|---|---|
| mid third | 1090 → 1097 | 258k → 444k | 164.6 → 150.1 | 0.04 → 0.04 |
| mid iso | 1102 → 1096 | 118k → 260k | 195.7 → 193 | 0 → 0 |
| mid shore | 808 → 904 | 265k → 439k | 175.8 → 156.6 | 0 → 0 |
| late third | 1674 → 1674 | 1095k → 1493k | 157 → 140.2 | 0.04 → 0.05 |
| late iso | 1487 → 1492 | 582k → 963k | 183.2 → 182.5 | 0 → 0 |
| late shore | 1310 → 1309 | 1102k → 1503k | 171.2 → 154.4 | 0.01 → 0 |

Early (nothing restored, no trees): 1040 / 1042 / 800 draw calls, 14–25k foliage triangles.

Draw calls stay within +12% (trees merge into each chunk's foliage mesh; budget +25%). mid shore and late third
were re-shot after the polish pass (softer sunlit tops, no fade speckle). Foliage triangles rise 28–98% with the new canopy: per tree, normal detail is
636–4.4k (pine–oak), far 296–480.
Mean luminance falls in the third-person and shore views because shade now falls on the restored ground.

After review: crowns have scalloped leaf-cluster rims, a darker cooler heart and warm tops; each template variant
has its own green (olive … yellow-green); the beach is a broadleaf coast (pines <10%); only small trees within 6
cells of the jetty or a bridge, so the opening view frames the island.

Still looks wrong / next:
- Up close the crowns are still soft masses, not individual leaves like the reference's foreground oak.
- Stage-2 (young) trees are small clustered versions of the grown shape. They could look more distinct.
