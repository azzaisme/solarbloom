# P7-E29 tree canopy: before / after

`base/`: P7-E27 lighting + P7-E28 zones, old trees (`p7-e29-trees` before tree work, mid/late, day, no HUD).
`after/`: `p7-e29-trees` @ final shot run (early/mid/late, day, no HUD). Both from `tests/e2e/p7-shots.mjs`
(High tier, software GL); `foliageTris` is `ChunkRenderer.foliageTris()` (all foliage: trees, shrubs, grass, flowers).

| shot | draw calls | foliage triangles | mean lum | clip % |
|---|---|---|---|---|
| mid third | 1090 → 1107 | 258k → 409k | 164.6 → 135.1 | 0.04 → 0.04 |
| mid iso | 1102 → 1153 | 118k → 233k | 195.7 → 192.5 | 0 → 0 |
| mid shore | 808 → 615 | 265k → 416k | 175.8 → 155.5 | 0 → 0 |
| late third | 1674 → 1677 | 1095k → 1399k | 157 → 128.5 | 0.04 → 0.04 |
| late iso | 1487 → 1490 | 582k → 889k | 183.2 → 182.2 | 0 → 0 |
| late shore | 1310 → 1309 | 1102k → 1406k | 171.2 → 155.4 | 0.01 → 0 |

Early (nothing restored, no trees): 1040 / 1042 / 800 draw calls, 14–25k foliage triangles.

Draw calls stay within +5% (trees merge into each chunk's foliage mesh; the shore view drops because the canopy
hides chunks behind it). Foliage triangles rise 28–98% with the new canopy: per tree, normal detail is
636–4.4k (pine–oak), far 296–480.
Mean luminance falls in the third-person and shore views because shade now falls on the restored ground.

Still looks wrong / next:
- Broadleaf crowns up close read a little smooth and uniformly lime; the leaf pattern is subtle at play zoom.
- Stage-2 (young) trees are small clustered versions of the grown shape. They could look more distinct.
