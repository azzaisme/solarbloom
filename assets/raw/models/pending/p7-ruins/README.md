# P7-E32 distant ruins (Meshy set)

The five finished `.glb`s now live in `assets/raw/models/ruins/`, loaded by `src/rendering/RuinModels.ts` for the ruined
skyline (`Ruins.ts`); the previews, the raw Meshy meshes and this README stay here. For the ruined skyline (#756), to replace the
procedural pieces in `Ruins.ts` that read as thin pale sticks. Contact sheet: `ruins-sheet.png`.

| Model | What | Height | Palette | Meshy task |
|---|---|---|---|---|
| `ruin-aqueduct` | row of four round arches, broken blocky top | 12 m | `ruin` | `01a20846-04ad-766d-9427-bc3cb9e07fd0` |
| `ruin-tower` | twin slender towers with ring ledges, one with a jagged broken crown | 30 m | `ruin` | `01a2084a-38c7-724f-9760-492e808d9d76` |
| `ruin-dome` | broken dome (a section missing, ribs showing) on an arched drum | 14 m | `ruin` | `01a2084a-40e2-74a5-b4b5-374f2d0a3489` |
| `ruin-solarframe` | six-pane tilted collector frame, one cracked panel, on a stone column | 18 m | `ruin` | `01a2084c-285e-72ef-a531-2e374e660683` |
| `ruin-cliff` | flat-topped layered sea-cliff mesa with a grassy top | 22 m | `cliff` | `01a2084a-51f3-75bc-bfdd-ce338db2c210` |

Each model has:
- `<name>.glb`: finished, 1,495–1,496 triangles, pivot at the base centre, real height, flat palette materials
  (no textures) and matching vertex colours (`COLOR_0`).
- `<name>.png`: a preview from a low, follow-camera-like angle.
- `<name>.meshy.glb` / `.meshy.png`: the untextured Meshy preview and its thumbnail.

Meshy: text-to-3D **preview** only, no texturing: art_style realistic, latest model, triangle topology, remesh on,
target 6,000 (4,000 for the solar frame retry). 20 credits each, 120 credits in all, including a first solar
frame whose thin lattice decimated badly; it was replaced by a bolder prompt.

Finish (Blender 5 as a Python module, `pip install bpy`; runs headless, preview via Cycles on CPU):
`python assets/tools/meshy_flat.py -- <name>.meshy.glb out <name> <height_m> 1500 <palette>`

Palettes (`PALETTES` in the script):
- `ruin`: stone #d8d0bf, low #a99d88, moss #7d9658.
- `cliff`: stone #b8a88f, low #8c7e6a, moss #6f9150.

Faces in the bottom 16% are `low`, and up-facing faces above 12% are `moss`.

Findings:
- A collapse decimate straight to 500 turned round arches into triangles. A planar dissolve first, then collapse
  to about 1,500, keeps the shapes. That's over `meshy-assets.md`'s "<500" for skyline pieces; the owner approved
  about 1,500 per piece for the few near-band copies.
- Thin lattices (the first solar frame) don't survive decimation. Prompt for few thick members instead.
- Meshy often ignores secondary asks: the aqueduct's collapsed end and rocky base, the cliff's waterfall notch.
  The cliff top is a broad flat plateau that the ruins can stand on.

Prompts:
- `ruin-aqueduct`: "stylized low poly ruined stone aqueduct segment, a row of four tall round arches on thick square pillars, one arch collapsed and broken off at the right end, jagged broken top edge, chunky simple shapes with soft bevels, standing on a low rocky base, game background prop, clean readable silhouette"
- `ruin-tower`: "ruined tall slender solarpunk stone tower, cylindrical with ring ledges every few floors, the top third snapped off leaving a jagged broken crown, a few window openings, a small balcony ring, chunky simple shapes with soft bevels, game background prop, clean readable silhouette, stylized low poly"
- `ruin-dome`: "ruined domed observatory building, a large round dome with a big section of the dome broken away showing the curved ribs, on a square stone base with a row of arched windows, chunky simple shapes with soft bevels, game background prop, clean readable silhouette, stylized low poly"
- `ruin-solarframe`: "derelict giant solar collector, one large flat rectangular panel frame made of a few thick bold beams in a simple grid of six big square openings, tilted toward the sky, mounted on one thick central column with a broad stone footing, two of the big panels still in place and cracked, chunky simple shapes with soft bevels, game background prop, clean readable silhouette, stylized low poly"
- `ruin-cliff`: "wide flat-topped rocky sea cliff mesa, steep layered rock faces with vertical cracks and ledges, a notch at the top edge for a waterfall to pour over, broad base, chunky simple shapes with soft bevels, game background prop, clean readable silhouette, stylized low poly"
