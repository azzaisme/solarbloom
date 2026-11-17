# Bloombot source (G.1, #236)

Generated in Meshy on 17 Nov 2026 from `docs/reference/bloombot-sheet.png`. 41 credits.

| File | What | Meshy task |
|---|---|---|
| `bloombot-tpose.png` | Clean front T-pose made from the sheet (image-to-image, nano-banana-2) | `01a1e778-a6b7-769c-9320-09fed4c6be2c` |
| `bloombot-mesh.glb` + `_base_color.png` | Static mesh, meshy-t2.5 smart topology, 8,347 tris, meshy-n1 texture | `01a1e779-1a80-735f-beb6-5f5fd8c85671` |
| `bloombot.glb` | Rigged (24 bones) with clips idle, walk, run, pulse, assemble, interact, cheer | rig `01a1e779-c5f4-7703-9e9d-27fb8eecfa24`, clips `01a1e77a-b1dd-75a7-9683-1af54d31c958` |
| `meshy-parts/` | Meshy's separate downloads, not committed (rebuild `bloombot.glb` from them) | |
| `preview-mesh.png`, `preview-clips.png` | Front, 3/4, side, back; and the middle frame of each clip | |

Clip sources (Meshy preset ids): idle 0 Idle, pulse 259 Step Forward and Push, assemble 262 Crouch and Push
Forward, interact 290 Wave One Hand, cheer 298 Cheer with Both Hands Up; walk and run come with the rig.

Not final: this is the Meshy pass. The Blender pass (#264) still has to stop pulse and assemble bending the big
head to the ground, and fix cheer's hands, which disappear into the head.
