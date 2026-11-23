# P7-E27.1 (#719): light transport and exposure audit

Measured 23 Nov 2026 with `tests/e2e/p7-tune.mjs` on the **mid** stage, Bright Day (day fraction 0.3), High tier,
starting from the WIP values of fd2a8502. Each row turns one more thing off (rows are cumulative from d4 on).
`meanLum` / `meanSat` are over the frame below the top 22% (the sky), as in `p7-shots` metrics.

| Shot | What changed | third: lum / sat | shore: lum / sat |
|---|---|---|---|
| d0 | WIP as built | 149.2 / 0.609 | 155.8 / 0.571 |
| d1 | bloom off | 148.3 / 0.612 | 153.9 / 0.580 |
| d2 | bloom on, depth fog off | 145.9 / 0.620 | 152.7 / 0.589 |
| d3 | fog on, motes and shafts off | 149.2 / 0.604 | 155.7 / 0.572 |
| d4 | + neutral grade (sat 1, vibrance 0, white tint, no highlight roll-off) | 154.0 / 0.451 | 159.0 / 0.429 |
| d5 | + rim off | 150.9 / 0.453 | 156.3 / 0.428 |
| d6 | + bloom, fog, motes, shafts and horizon haze all off | 145.0 / 0.470 | 151.6 / 0.450 |

Pixel probes (third-person camera, sRGB):

| Region | d0 (WIP) | d4 (no grade) | Target (docs/VISUAL_DIRECTION.md) |
|---|---|---|---|
| Sunlit grass, near | 135, 156, 37 | 136, 155, 70 | 110–150, 170–200, 60–90 |
| Dead sand | 207, 171, 116 | 206, 176, 132 | ~226, 207, 164 |
| Deck timber | 187, 107, 40 | 183, 117, 74 | ~154, 100, 56 |
| Sky, top of frame (~17° up) | 199, 223, 237 | 202, 222, 238 | ~142, 195, 240 |

Live state read from the game at the same moment: sky clarity 0.16 (the fogged sky colours dominate until areas are
woken), sun elevation ~38°, sun `#ffe8c6` × 2.1, exposure 1.1, fog 14 → 92 units, far clip 102, grade mood 1 (warm).

## Diagnosis

- **Units.** Every light is arbitrary-intensity (sun 2.1, fill 0.45, environment atlas 0.7, rim 1.2), tone mapped by
  Khronos PBR Neutral after exposure 1.1, sRGB output once. No physical units anywhere, so nothing mixes the two.
  No double gamma: materials and vertex colours are decoded to linear once, and the sky dome and clear colour are
  written as display values on purpose (see `Sky.horizonSeen`, `fogMatchingSky`).
- **Bloom is not the veil.** Threshold 1.8 (scene-referred) sits above sunlit ground (~1.7). Off, the image barely
  changes (≤ 2 lum).
- **Motes and shafts were part of the veil at the old counts (90 at glow 3, 5 shafts), but not at the WIP counts**
  (28 at 1.4, 1 shaft at 0.1): turning them off now changes nothing measurable.
- **The depth fog adds ~3 lum** over the near scene: a mild lift, not the milky distance.
- **The grade is the main source of the fluorescent / orange look.** Saturation 1.1 + vibrance 0.15 + a warm tint
  roughly halve the blue channel of every warm or green surface (grass 70 → 37, timber 74 → 40), which pushes
  grass to lime and timber and sand to orange. With a neutral grade the picture is also ~5 lum brighter (the
  highlight roll-off −0.15 was pulling it down).
- **The rim adds ~3 lum** of gold edge light on every silhouette: minor, but warm.
- **The milky distance is geometry, not post.** With every effect off the hidden city is still near-white: hidden
  areas are drawn greyed to 0.75 (`ChunkRenderer`, `b.grey`), with fog sheets over them. Handled by the cloud ring
  prototype (`LOOK.cloudRing`) and P7-E32.
- **The pale sky is the sky's own colours.** At mid stage the clarity is 0.16, so the fogged entries (`SKY.*[0]`)
  dominate, and the low follow camera sees only the lowest ~17°, where the dome is still in its pale glow band.
  The grade does not touch it (d0 vs d4).
