# Bloombot source (G.1, #236)

Generated in Meshy on 17 Nov 2026 from `docs/reference/bloombot-sheet.png`. 41 credits.

| File | What | Meshy task |
|---|---|---|
| `bloombot-tpose.png` | Clean front T-pose made from the sheet (image-to-image, nano-banana-2) | `01a1e778-a6b7-769c-9320-09fed4c6be2c` |
| `bloombot-mesh.glb` + `_base_color.png` | Static mesh, meshy-t2.5 smart topology, 8,347 tris, meshy-n1 texture | `01a1e779-1a80-735f-beb6-5f5fd8c85671` |
| `bloombot-meshy.glb` | Meshy's rig (24 bones) and clips, merged, untouched | rig `01a1e779-c5f4-7703-9e9d-27fb8eecfa24`, clips `01a1e77a-b1dd-75a7-9683-1af54d31c958` |
| `meshy-parts/` | Meshy's separate downloads, not committed (rebuild `bloombot.glb` from them) | |
| `bloombot.glb` | **The one to use.** `bloombot-meshy.glb` after `blender-pass.py` | |
| `preview-mesh.png`, `preview-clips.png` | Meshy output: front, 3/4, side, back; middle frame of each clip | |
| `preview-fixed.png` | After the Blender pass: pulse, assemble (top), cheer, idle (bottom), three frames each | |

Clip sources (Meshy preset ids): idle 0 Idle, pulse 259 Step Forward and Push, assemble 262 Crouch and Push
Forward, interact 290 Wave One Hand, cheer 298 Cheer with Both Hands Up; walk and run come with the rig.

## Blender pass

`blender -b -P blender-pass.py -- bloombot-meshy.glb bloombot.glb preview-fixed.png` (Blender 5.0):

- **Pulse and assemble** keep 35% of the hip and spine lean, so the big head no longer dives at the ground.
  The hips hand the removed rotation to the thighs, so the feet stay where they were.
- **Idle** keeps 12% of the hip twist and 25% of the spine and head turn, so it faces forward.
- **Cheer** brings the arms halfway back to the T-pose (a V that clears the head) and straightens the elbows.
- **Gold:** saturated yellows in the texture are pulled toward a deeper, warmer gold (hue toward 43°,
  saturation ×1.15).
- **Backpack:** the auto-rig spread its weights over the spine, arms and hips, so it bent and smeared in
  motion. Every pack vertex (behind the torso, between hips and shoulders) is now tied to the `Spine` bone
  alone, so it rides on the back as one rigid piece.
- **Texture:** halved to 1024² (the character budget in docs/art/meshy-assets.md); the GLB went from 3.5 to
  1.7 MB.
- **Visor:** the visor's triangles (an oval on the front of the head) are cut out as their own part with
  material `bloombot_visor`, still skinned to the head, with flat front-on UVs across the visor.

## Faces

`assets/tools/bloombot_faces.py` draws `bloombot-faces.png`: happy, surprised, wink and blink in one row. The
game puts it on the visor part (its own UVs span the visor, so the eyes sit on the real curved surface) and
swaps frames
(`BloombotVisuals.setFace`): it blinks now and then, winks while cheering, looks surprised when interacting.
