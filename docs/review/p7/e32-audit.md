# P7-E32.1 (#755): what makes the pale blobs and featureless masses on the horizon

Audited on `p7-e32-skyline` with `p7-e27-lighting` merged (23 Nov 2026), from the fixed cameras
(`tests/e2e/p7-shots.mjs`, early stage, day). Nothing was removed on the strength of this audit alone; each source is
listed with who owns it and what E32 does about it.

| # | Source | Where it shows | Code | Owner | E32 action |
|---|---|---|---|---|---|
| 1 | **Cloud ring / cloud walls**: 8-puff sphere clusters (`wallCloudParts`), 2 rows per sealed edge, 4 rows (size 1.3) on every edge where revealed ground meets hidden city (`LOOK.cloudRing`) | Camera A: the whole left and right of the horizon is a wall of white balls; camera B: thick ball-rings round the open ground | `CloudWall.ts`, `Clouds.ts` (`PUFFS`, `puffMesh`), `data/look.ts` `cloudRing` | E32 (shape), E27 (ring size/rows) | Puffs reshaped into flat-bottomed cumulus banks (#760). Ring rows/size left to E27/owner |
| 2 | **Zoomed-out floating clouds**: 7 clouds of 13 sphere puffs between the camera and the city | Camera B (right edge, foreground): big round balls | `Clouds.ts` | E32 | Same bank shape (#760) |
| 3 | **Sky cloud ring**: 14 clusters of 3–5 soft disc fans low over the horizon | Cameras A and C: soft blobs and streaks in the sky | `Sky.buildClouds` | E27 file; geometry only changed by E32 (agreed with lead) | Banks with a flat shaded base, domed lobes (#760) |
| 4 | **Hidden-area fog**: chunks of hidden areas sunk and greyed (`grey 0.75`), cheap grey shapes only, fog sheets with soft curtains at their edges | Camera B: the flat grey slabs filling everything round the open ground; camera A: grey boxes over the walls | `ChunkRenderer.ts` (fog sheets, `curtain`, `facade`) | Owner decision (18 Nov: dense on purpose) | **Untouched.** Softening it needs the owner's say |
| 5 | **Grey retaining walls** of higher regions (terraces) | Camera A: the long grey wall across the back of the beach | `ChunkRenderer.ts` terraces / `core/Height.ts` | ChunkRenderer owner / P7-E30 | Untouched (playable geometry) |
| 6 | **Fogged city buildings** faded into the haze | Camera A: pale grey boxes on the horizon above the wall | `ChunkRenderer.ts` (towers, facades), scene fog | ChunkRenderer owner | Untouched; the ruined city now stands behind them |
| 7 | **The haze itself**: linear scene fog to the sky's horizon colour, `HAZE.end` 64–88 past the target, far clip 10 after it, plus `lookHorizonFog` | Everything past ~60 units fades to one flat colour, so there is nothing beyond it | `Game.syncView`, `data/sky.ts` `HAZE`, `LookShaders.ts` | E27 | Not changed. The distance beyond it is the new ruins layer (#756) |

## Why the distance was empty

The far clip is `dist + hazeEnd + 10`, so nothing in the world can stand further out than ~110 units from the
camera, and everything past `hazeEnd` is fully fogged. After #681 removed the backdrop, the only things left past the
island were the hidden areas' grey fog chunks and the cloud walls.

## What E32 adds

`src/rendering/Ruins.ts` + `src/data/ruins.ts`: three bands of ruined coast (near ~225, mid ~350, far ~500 units from
the island's centre) drawn in their own layer after the world's opaque pass, each vertex slid along its view ray onto a plane where the
horizon haze is full (so the visible world hides them and the haze-coloured distance doesn't), with light and distance fade baked into vertex colours toward the sky's horizon colour (read
from `Sky` at runtime). It is not the #681 backdrop: that was four retired GLB models floating at the horizon with
nothing under them, cream at night. These stand on coasts, fade blue, go to dark silhouettes at night, and the open
sea south of the start stays open.
