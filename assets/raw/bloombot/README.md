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
| `bloombot.blend` | The same model as a Blender file, saved by the pass | |
| `preview-fixed.png` | After the Blender pass: a turnaround (top), then pulse, assemble, cheer, idle, three frames each | |

Clip sources (Meshy preset ids): idle 0 Idle, pulse 259 Step Forward and Push, assemble 262 Crouch and Push
Forward, interact 290 Wave One Hand, cheer 298 Cheer with Both Hands Up; walk and run come with the rig.

## Blender pass

`timeout 120 blender -b -P blender-pass.py -- bloombot-meshy.glb bloombot.glb preview-fixed.png` (Blender 5.0):

- **Pulse and assemble** keep 35% of the hip and spine lean, so the big head no longer dives at the ground.
  The hips hand the removed rotation to the thighs, so the feet stay where they were.
- **Idle** keeps 12% of the hip twist and 25% of the spine and head turn, so it faces forward.
- **Idle's feet stay on the ground:** the hips and legs hold one pose for the whole clip and the hips are
  raised so the soles sit at ground level on every frame (they were 12 mm under it).
- **Robot joints:** each piece between the owner's swivel points (neck, shoulders, elbows, wrists, waist,
  hips; knees and ankles at the boot seams) moves rigidly. The waist is a real cut: torso and hips are two
  separate capped pieces and the torso swivels on that line.
- **Hover** replaces Meshy's run: bloombot floats 4.5 cm up and glides, for the Hover upgrade's sprint.
- **Walk** is a toddler waddle made in the pass (stiff legs, rocking body, arms out, feet lifting about 5 cm).
- **Assemble** keeps its feet planted with a shallower crouch; every clip is kept out of the floor.
- **Cheer** brings the arms halfway back to the T-pose (a V that clears the head) and straightens the elbows.
- **Backpack:** the auto-rig spread its weights over the spine, arms and hips, so it bent and smeared in
  motion. Every pack vertex (behind the torso, between hips and shoulders) is now tied to the `Spine` bone
  alone, so it rides on the back as one rigid piece.
- **Parts and materials:** the surface is sorted into parts by the colour Meshy painted, the mesh is cut along
  the part boundaries, and each part gets a real material (shell, champagne, metallic gold, joint, dark,
  glowing cyan, bulb, leaf, pack fabric, pack canvas). No baked texture; the GLB is 0.76 MB.
- **Chest speaker:** a plain dark disc with five modelled glowing bars for the wave motif.
- **Quads:** triangles are paired into quads inside each part: about 4,600 quads and 2,700 triangles left
  (11,900 triangles in the game, up from 8,347 because of the boundary cuts).
- **Visor:** two layers, both skinned to the head. The dark paint on the front of the head is cut out and
  smoothed; it becomes the face screen (material `bloombot_visor`, flat front-on UVs), sunk 8 mm into the head,
  under a sheet of dark see-through glass (`bloombot_glass`) at the surface.

Never add a remesh (voxel or Quadriflow) to the pass: it froze the PC. Details: `docs/art/bloombot-pipeline.md`.

## Faces

`assets/tools/bloombot_faces.py` draws `bloombot-faces.png`: happy, surprised, wink and blink in one row. The
game puts it on the visor part (its own UVs span the visor, so the eyes sit on the real curved surface) and
swaps frames
(`BloombotVisuals.setFace`): it blinks now and then, winks while cheering, looks surprised when interacting.
