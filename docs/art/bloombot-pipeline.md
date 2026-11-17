# Bloombot: the Meshy → Blender → game pipeline

How the player character goes from the owner's character sheet to the game (#264, #236). The same route works
for any future rigged character.

## 1. Meshy (about 41 credits)

1. **A clean front T-pose** from `docs/reference/bloombot-sheet.png`: image-to-image, `nano-banana-2`, asking
   for the same design in a T-pose on plain white with no ground. Rigging needs straight limbs and a clear
   silhouette; the sheet's hero pose has neither.
2. **Image to 3D** from that image: `meshy-t2.5` smart topology at `target_polycount` 8000 (the 3–8k character
   budget in `docs/art/meshy-assets.md`), texture `meshy-n1` (textures straight from the image, so it matches the
   sheet), `pose_mode: "t-pose"`.
3. **Auto-rig** (`height_meters` 0.9). Gives a 24-bone humanoid rig plus walk and run clips.
4. **Animate**: preset ids bundled into one file (idle 0, pulse 259, assemble 262, interact 290, cheer 298).

Task ids and the files that came out of each step: `assets/raw/bloombot/README.md`.

## 2. Blender (`assets/raw/bloombot/blender-pass.py`)

Run with Blender 5.0:

```
blender -b -P blender-pass.py -- bloombot-meshy.glb bloombot.glb preview-fixed.png
```

`bloombot-meshy.glb` is Meshy's rig with every clip merged and named (one NLA track per clip). The pass:

- **Fits the human clips to a big-headed robot.** Human bows tip the oversized head to the floor, so pulse and
  assemble keep a third of the hip and spine lean (the thighs take back what the hips lose, so the feet stay
  put). Idle keeps 12% of its hip twist. Cheer's arms open into a V that clears the head.
- **Makes the backpack rigid.** Its vertices are tied to the `Spine` bone alone.
- **Warms the gold** in the texture and **halves the texture** to 1024².
- **Cuts out the visor** as its own part (`bloombot_visor`, skinned to the head) with flat front-on UVs, so face
  frames lie on the real curved surface. A flat panel in front of the visor floated off the head; don't.
- Renders a check sheet of the changed clips.

Blender 5 notes: actions need their slot set (`strip.action_slot`, `animation_data.action_slot`) or they bind
to nothing; export with `export_animation_mode='NLA_TRACKS'` to get one glTF animation per clip.

## 3. Game (`src/rendering/BloombotVisuals.ts`)

- The glTF root is the rig's `Armature` node and carries a 0.01 scale (the rig is in centimetres). Keep it;
  scale a holder entity around it instead. Overwriting that node's scale makes the model 100× too big.
- `anim` component on the rig root; each glTF animation is assigned by name (`assignAnimation(name, track,
  undefined, speed, loop)`). Loops (idle, walk, run) blend with `baseLayer.transition(name, 0.18)`; one-shots
  play and blend back on a timer. Walk and run speed follow how fast bloombot really moves, so feet don't slide.
- Faces: `assets/tools/bloombot_faces.py` → `bloombot-faces.png`, as the emissive map of the visor part's
  material, frames picked with `emissiveMapOffset`.
- Until the GLB loads (or if it fails) a capsule stands in.

## Still to do

- A far (LOD1) version is not made yet. The near model is 8.3k triangles and one draw call, so it isn't urgent.
- Look sign-off from the owner (#236), and an in-game shot beside the drone and a bench for scale.
