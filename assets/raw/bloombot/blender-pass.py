"""Blender pass for bloombot: damp body lean for the big head, open cheer's arms, warm the gold.
blender -b -P fix.py -- in.glb out.glb sheet.png"""
import bpy, sys, os, math, mathutils
import numpy as np

src, out, sheet = sys.argv[sys.argv.index('--') + 1:][:3]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
mesh = next(o for o in bpy.data.objects if o.type == 'MESH')
Q = mathutils.Quaternion

def curves(a):
    bag = a.layers[0].strips[0].channelbags[0]
    return bag

def get_q(a, bone):
    bag = curves(a)
    fcs = [bag.fcurves.find(f'pose.bones["{bone}"].rotation_quaternion', index=i) for i in range(4)]
    return fcs if all(fcs) else None

def frames(a):
    return range(int(a.frame_range[0]), int(a.frame_range[1]) + 1)

def sample(fcs, f):
    return Q([fc.evaluate(f) for fc in fcs])

def write(fcs, keys):
    for i, fc in enumerate(fcs):
        fc.keyframe_points.clear()
        fc.keyframe_points.add(len(keys))
        for k, (f, q) in enumerate(keys):
            p = fc.keyframe_points[k]
            p.co = (f, q[i]); p.interpolation = 'LINEAR'

def damp(a, bones, keep, ref=None, compensate=()):
    """Keep `keep` of each bone's rotation away from `ref` (identity = the bind T-pose). A damped parent
    hands its removed rotation to `compensate` children so the feet stay planted."""
    for b in bones:
        fcs = get_q(a, b)
        if not fcs: continue
        r = Q() if ref is None else ref
        old = {f: sample(fcs, f) for f in frames(a)}
        new = {f: r.slerp(q if r.dot(q) >= 0 else -q, keep) for f, q in old.items()}
        for c in compensate:
            cf = get_q(a, c)
            if not cf: continue
            cq = {f: sample(cf, f) for f in frames(a)}
            write(cf, [(f, (new[f].inverted() @ old[f] @ cq[f]).normalized()) for f in frames(a)])
        write(fcs, [(f, new[f]) for f in frames(a)])

acts = {a.name: a for a in bpy.data.actions}
LEGS = ('LeftUpLeg', 'RightUpLeg')
# Pulse and assemble: a human bow tips the oversized head to the floor. Keep a third of the lean.
for n in ('pulse', 'assemble'):
    damp(acts[n], ['Hips'], 0.35, compensate=LEGS)
    damp(acts[n], ['Spine02', 'Spine01', 'Spine', 'neck', 'Head'], 0.35)
# Idle: the hip twist turned the head away from the camera.
damp(acts['idle'], ['Hips'], 0.12, compensate=LEGS)
damp(acts['idle'], ['Spine02', 'Spine01', 'Spine', 'neck', 'Head'], 0.25)
# Cheer: straight-up arms vanish behind the head. Halfway back to the T-pose makes a V clear of it.
damp(acts['cheer'], ['LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm'], 0.5)
damp(acts['cheer'], ['LeftForeArm', 'RightForeArm'], 0.4)

# Gold: the n1 texture reads pale butter; push saturated yellows toward a warmer, deeper gold.
img = next(i for i in bpy.data.images if i.size[0] > 0)
w, h = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
rgb = px[:, :3]
mx, mn = rgb.max(1), rgb.min(1)
v = mx; s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
r, g, b = rgb.T
d = np.maximum(mx - mn, 1e-6)
hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
mask = (hue > 30) & (hue < 56) & (s > 0.42) & (v > 0.45)
print('GOLD pixels', int(mask.sum()), 'of', len(px))
s2 = np.clip(s * 1.15, 0, 1); v2 = v * 0.96; h2 = hue * 0.6 + 0.4 * 43
c = v2 * s2; x = c * (1 - np.abs((h2 / 60) % 2 - 1)); m = v2 - c
seg = (h2 // 60).astype(int) % 6
rr = np.choose(seg, [c, x, 0 * c, 0 * c, x, c]); gg = np.choose(seg, [x, c, c, x, 0 * c, 0 * c]); bb = np.choose(seg, [0 * c, 0 * c, x, c, c, x])
new = np.stack([rr + m, gg + m, bb + m], 1)
rgb[mask] = new[mask]
px[:, :3] = rgb
img.pixels[:] = px.ravel()
img.pack()

# export: one NLA track per clip
ad = arm.animation_data
ad.action = None
for t in list(ad.nla_tracks): ad.nla_tracks.remove(t)
for n, a in acts.items():
    tr = ad.nla_tracks.new(); tr.name = n
    st = tr.strips.new(n, int(a.frame_range[0]), a); st.action_slot = a.slots[0]
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animation_mode='NLA_TRACKS', export_skins=True)

# sheet: 3 frames each of the clips that changed, from the 3/4 front
for t in ad.nla_tracks: t.mute = True
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
S = 300
scene.render.resolution_x = scene.render.resolution_y = S
wd = bpy.data.worlds.new('w'); scene.world = wd; wd.use_nodes = True
wd.node_tree.nodes['Background'].inputs[0].default_value = (0.92, 0.93, 0.95, 1)
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3
sun.rotation_euler = (math.radians(50), 0, math.radians(30)); scene.collection.objects.link(sun)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.3
shots = []
for n in ('pulse', 'assemble', 'cheer', 'idle'):
    a = acts[n]; ad.action = a; ad.action_slot = a.slots[0]
    f0, f1 = a.frame_range
    for t in (0.3, 0.5, 0.7):
        scene.frame_set(int(f0 + (f1 - f0) * t))
        ang = math.radians(35)
        cam.location = mathutils.Vector((math.sin(ang) * 4, -math.cos(ang) * 4, 0.45 + 0.6))
        cam.rotation_euler = (mathutils.Vector((0, 0, 0.45)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        f = sheet.replace('.png', f'_{len(shots)}.png'); scene.render.filepath = f
        bpy.ops.render.render(write_still=True); shots.append(f)
cols = 6; rows = math.ceil(len(shots) / cols)
big = np.ones((rows * S, cols * S, 4), dtype=np.float32)
for k, f in enumerate(shots):
    im = bpy.data.images.load(f); p = np.array(im.pixels[:], dtype=np.float32).reshape(S, S, 4)
    rr_, cc_ = rows - 1 - k // cols, k % cols
    big[rr_ * S:(rr_ + 1) * S, cc_ * S:(cc_ + 1) * S] = p
    os.remove(f)
out_img = bpy.data.images.new('sheet', cols * S, rows * S); out_img.pixels[:] = big.ravel()
out_img.filepath_raw = sheet; out_img.file_format = 'PNG'; out_img.save()
print('DONE')
