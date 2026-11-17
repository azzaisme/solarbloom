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

`bloombot-meshy.glb` is Meshy's rig with every clip merged and named (one NLA track per clip): triangles and
one baked colour texture. The pass rebuilds it with one real material per part and mostly quads:

- **Sorts the surface into parts by the colour painted on it.** Every texel of Meshy's texture is labelled
  (shell, champagne, gold, joint, dark, glow, green), the labels are smoothed, and position decides the rest
  (green on the head is leaf, on the back is pack fabric; everything else on the pack is canvas; the antenna
  tip is the bulb).
- **Cuts the mesh along the part boundaries.** Meshy's triangles ignore the paint, so colouring whole faces
  gave saw-toothed edges. Each edge that crosses from one part to another gets a new vertex at the crossing,
  and those are joined up, so every part ends on a real edge. No vertex moves; new ones blend their
  neighbours' skin weights. This raises the model from 8,347 to about 11,900 triangles.
- **Gives each part a material** (`bloombot_shell`, `_champagne`, `_gold` (metal), `_joint`, `_dark`, `_glow`
  and `_bulb` (emissive), `_leaf`, `_fabric`, `_canvas`). The baked texture and the body's UVs are dropped.
  Painted details smaller than a triangle are lost: the ear and palm rings become discs, the leaf veins go.
- **Models the chest speaker's wave motif.** As face colours the painted bars collapsed into a blob, so the
  whole disc is made dark and five glowing bars (three quads each) are laid on it, 2 mm proud, skinned like
  the disc.
- **Pairs triangles into quads** inside each part (`tris_convert_to_quads`, 75°): about 4,600 quads and 2,700
  triangles, 77% of the surface in quads. All-quad is not reachable without a remesh.
- **Fits the human clips to a big-headed robot.** Human bows tip the oversized head to the floor, so pulse and
  assemble keep a third of the hip and spine lean (the thighs take back what the hips lose, so the feet stay
  put). Idle keeps 12% of its hip twist. Cheer's arms open into a V that clears the head.
- **Moves like a robot, on the owner's swivel points** (marked on a front render, 18 Nov 2026): neck, shoulder
  balls, elbows, wrists, waist and hips, plus knees at the boot tops and ankles at the gold shoes (not marked,
  but natural seams, so crouches still work). Each piece between them is weighted 100% to one bone, so it
  moves rigidly; at the seams the shared vertices are split between the two pieces, so joints hinge without
  opening holes. Arm-or-chest is decided by Meshy's own skin weights; the elbow and wrist cuts are the
  owner's lines.
- **Splits the torso at the waist.** The body is cut through the line across the top of the gold belly band
  into two separate pieces, each capped (joint colour), and the torso's bone (`Spine02`) is moved to that
  line, so the upper half swivels exactly there.
- **Rebuilds every clip on those pivots.** The three spine bones turn as one at the waist, the head turns at
  the neck, the shoulder (clavicle) bones stay with the torso, and each limb keeps Meshy's rotation about
  its own joint. In the non-walking clips the rigid shoes stay flat (turning only left and right).
- **Assemble keeps its feet planted.** Meshy's crouch drops the hips 14 cm (more than bloombot's legs can
  fold) and tangles the legs; it is scaled to 6 cm and the legs bend their knees forward to keep the feet
  where they stand.
- **A toddler walk** replaces Meshy's human walk: stiff legs swing from the hips, the body rocks over the
  planted foot, wide stance, toes out, arms held up and out, and the knee comes up to lift the free foot
  about 5 cm. 14 frames a cycle (3.4 steps a second), 0.48 m/s at clip speed 1, which is `STRIDE.walk` in
  `BloombotVisuals.ts` (times the model scale). Change the clip and that number together.
- **A hover** replaces Meshy's human run (the clip is renamed `hover`; the game plays it while the sprint
  key is held, once the Hover upgrade is bought). Bloombot lifts 4.5 cm off the ground and glides: leaning
  into the motion, head up, legs together and trailing with the toes pointed, arms swept back, bobbing
  gently (36 frames, 1.5 s). No feet touch the ground, so it always plays at speed 1.
- **Keeps every clip on the ground.** Idle stands at exactly 0 the whole clip and the walk is grounded frame
  by frame; the other clips are lifted on any frame that would sink into the floor (they may still hop).
- **Keeps idle's feet on the ground.** The hips and both legs hold their first-frame pose for the whole clip
  (the spine, arms and head keep their sway), and the hips are raised by the measured gap so the lowest point
  of the mesh sits at exactly 0 on every frame. The pass prints that measurement.
- **Makes the backpack rigid.** Its vertices are tied to the `Spine` bone alone.
- **Builds the visor in two layers**, both skinned to the head. The dark paint on the front of the head is cut
  out and its lumps (up to 3 mm) are eased onto one smooth bowl. That surface becomes the face screen
  (`bloombot_visor`, flat front-on UVs, where the game swaps face frames), sunk 8 mm into the head, and a copy
  stays at the surface as a sheet of dark glass (`bloombot_glass`, 30% opaque, glossy) that meets the gold
  bezel. A flat panel in front of the visor floated off the head; don't.
- Saves `bloombot.blend` beside the GLB and renders a check sheet (Standard view transform): a turnaround,
  then three frames each of the changed clips.

**Never remesh in this pass.** A voxel remesh followed by Quadriflow hung Blender and froze the PC. Run Blender
with a time limit (`timeout 120 blender -b -P ...`); the whole pass takes about 20 seconds.

Blender 5 notes: actions need their slot set (`strip.action_slot`, `animation_data.action_slot`) or they bind
to nothing; export with `export_animation_mode='NLA_TRACKS'` to get one glTF animation per clip.

## 3. Game (`src/rendering/BloombotVisuals.ts`)

- The glTF root is the rig's `Armature` node and carries a 0.01 scale (the rig is in centimetres). Keep it;
  scale a holder entity around it instead. Overwriting that node's scale makes the model 100× too big.
- `anim` component on the rig root; each glTF animation is assigned by name (`assignAnimation(name, track,
  undefined, speed, loop)`). Loops (idle, walk, hover) blend with `baseLayer.transition(name, 0.18)`; one-shots
  play and blend back on a timer. Walk speed follows how fast bloombot really moves (`WALK_STRIDE`); hover plays at speed 1.
- Faces: `assets/tools/bloombot_faces.py` → `bloombot-faces.png`, as the emissive map of the visor part's
  material, frames picked with `emissiveMapOffset`.
- Until the GLB loads (or if it fails) a capsule stands in.

## Still to do

- A far (LOD1) version is not made yet. The near model is 11.9k triangles (over the 8k character budget) and
  11 draw calls, one per material, so it now matters more.
- Look sign-off from the owner (#236), and an in-game shot beside the drone and a bench for scale.
