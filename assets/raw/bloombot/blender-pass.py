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

# Backpack: the auto-rig spread its weights over spine, arms and hips, so it bent and smeared as bloombot
# moved. Tie every pack vertex to the upper spine alone so it rides on the back as one rigid piece.
# The pack is the geometry behind the torso (Blender: front is -Y), between the hips and the shoulders.
PACK_BONE = 'Spine'
pack_vg = mesh.vertex_groups[PACK_BONE]
mw = mesh.matrix_world
pack = [v.index for v in mesh.data.vertices if (lambda w: w.y > 0.05 and 0.15 < w.z < 0.5 and abs(w.x) < 0.24)(mw @ v.co)]
for vg in mesh.vertex_groups:
    if vg.name != PACK_BONE:
        vg.remove(pack)
pack_vg.add(pack, 1.0, 'REPLACE')
print('PACK vertices', len(pack))

# Visor: cut the visor's triangles out as their own part (still skinned to the head) with flat, front-on UVs,
# so the game can swap face frames on the real curved surface. Front is -Y; the visor is the oval at
# x ±0.125, z 0.52–0.68 on the front of the head.
VX, VZ0, VZ1 = 0.125, 0.517, 0.679
vzc, vrx, vrz = (VZ0 + VZ1) / 2, VX * 0.99, (VZ1 - VZ0) / 2 * 0.99
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = mesh
mesh.select_set(True)
n3 = mesh.matrix_world.to_3x3()
bpy.ops.object.mode_set(mode='EDIT')
import bmesh as _bm
ebm = _bm.from_edit_mesh(mesh.data)
for el in (*ebm.verts, *ebm.edges, *ebm.faces):
    el.select = False
picked = 0
for f in ebm.faces:
    c = mesh.matrix_world @ f.calc_center_median()
    nn = (n3 @ f.normal).normalized()
    if nn.y < -0.3 and c.y < -0.12 and (c.x / vrx) ** 2 + ((c.z - vzc) / vrz) ** 2 < 1:
        f.select = True
        picked += 1
ebm.select_flush(True)
_bm.update_edit_mesh(mesh.data)
bpy.ops.mesh.separate(type='SELECTED')
bpy.ops.object.mode_set(mode='OBJECT')
visor = next(o for o in bpy.context.selected_objects if o is not mesh)
visor.name = 'bloombot_visor'
vm = visor.matrix_world
uvd = visor.data.uv_layers.active.data
for poly in visor.data.polygons:
    for li in poly.loop_indices:
        co = vm @ visor.data.vertices[visor.data.loops[li].vertex_index].co
        uvd[li].uv = ((co.x + VX) / (2 * VX), (co.z - VZ0) / (VZ1 - VZ0))
vmat = bpy.data.materials.new('bloombot_visor')
vmat.use_nodes = True
vmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.02, 0.025, 0.035, 1)
visor.data.materials.clear()
visor.data.materials.append(vmat)
print('VISOR faces', picked)

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
# Budget (docs/art/meshy-assets.md): characters get a 1024² texture.
if img.size[0] > 1024:
    img.scale(1024, 1024)
img.pack()

# Visor: where the black visor sits on the model in the rest (T) pose, for the game's face panel. Rays from the
# front hit the mesh; hits whose texture is near black are the visor. Printed in glTF space (Y up, +Z front).
import bmesh
from mathutils.bvhtree import BVHTree
arm.data.pose_position = 'REST'
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
ev = mesh.evaluated_get(dg)
me = ev.to_mesh()
bm = bmesh.new(); bm.from_mesh(me); bm.transform(mesh.matrix_world); bmesh.ops.triangulate(bm, faces=bm.faces)
bvh = BVHTree.FromBMesh(bm)
bm.faces.ensure_lookup_table()
uvl = bm.loops.layers.uv.active
tw, th = img.size
tp = np.array(img.pixels[:], dtype=np.float32).reshape(th, tw, 4)
hits = []
for ix in range(-30, 31):
    for iz in range(30, 95):
        x, z = ix * 0.01, iz * 0.01
        loc, nrm, fi, dist = bvh.ray_cast(mathutils.Vector((x, -2, z)), mathutils.Vector((0, 1, 0)))
        if loc is None: continue
        f = bm.faces[fi]
        # barycentric UV
        a_, b_, c_ = [l.vert.co for l in f.loops]
        w = mathutils.geometry.barycentric_transform(loc, a_, b_, c_, mathutils.Vector((1, 0, 0)), mathutils.Vector((0, 1, 0)), mathutils.Vector((0, 0, 1)))
        uv = sum((f.loops[k][uvl].uv * w[k] for k in range(3)), mathutils.Vector((0, 0)))
        px = tp[min(th - 1, max(0, int(uv.y * th))), min(tw - 1, max(0, int(uv.x * tw)))]
        if px[0] + px[1] + px[2] < 0.25 and nrm.y < -0.5:
            hits.append((x, z, loc.y))
bm.free()
arm.data.pose_position = 'POSE'
if hits:
    xs = [h[0] for h in hits]; zs = [h[1] for h in hits]; ys = [h[2] for h in hits]
    cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
    front = min(ys)
    print(f'VISOR gltf centre=({cx:.3f}, {cz:.3f}, {-front:.3f}) size=({max(xs) - min(xs):.3f}, {max(zs) - min(zs):.3f}) hits={len(hits)}')

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
