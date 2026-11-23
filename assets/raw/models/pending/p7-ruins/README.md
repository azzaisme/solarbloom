# P7-E32 distant ruins: Meshy pilot

Pending, not loaded by the game (MODELS reads `final/` only). Built for the ruined skyline (#756).

| File | What |
|---|---|
| `ruin-aqueduct.meshy.glb` / `.meshy.png` | Meshy text-to-3D **preview** (untextured), task `01a20846-04ad-766d-9427-bc3cb9e07fd0`, 20 credits |
| `ruin-aqueduct.glb` | finished by `assets/tools/meshy_flat.py`: 12 m tall, pivot at the base centre, 1,495 triangles, flat palette materials (no textures) plus matching vertex colours |
| `ruin-aqueduct.png` | Cycles preview from a low, follow-camera-like angle |

Prompt: "stylized low poly ruined stone aqueduct segment, a row of four tall round arches on thick square pillars, one
arch collapsed and broken off at the right end, jagged broken top edge, chunky simple shapes with soft bevels,
standing on a low rocky base, game background prop, clean readable silhouette" (art_style realistic, latest model,
triangle topology, target 6,000, remesh on).

Finish: `python assets/tools/meshy_flat.py -- ruin-aqueduct.meshy.glb out ruin-aqueduct 12 1500`
(Blender 5 as a Python module, `pip install bpy`; runs headless in the cloud container, preview via Cycles on CPU).

Findings:
- A collapse decimate alone to the skyline budget (500) turned the round arches into triangles. A planar dissolve
  first, then collapse to about 1,500, keeps the arches. Over `meshy-assets.md`'s "<500" for skyline pieces; fine on
  desktop for the few near-band copies, owner to confirm.
- Materials: `stone` #d8d0bf, `low` #a99d88 (the bottom 16%), `moss` #7d9658 (up-facing faces above 12%). Palette in
  `PALETTES` in the script.
