"""Blender rebuild of bloombot from Meshy's rigged model (docs/art/bloombot-pipeline.md).

Meshy's mesh is triangles with one baked colour texture. This sorts the faces into parts by the colour painted
on them, gives each part a real material (ceramic shell, champagne panels, metallic gold, dark joints, glowing
cyan, leaves, pack), pairs the triangles into quads inside each part, makes the pack rigid, cuts the visor out
for the face frames, and fits the human clips to a big-headed robot. The vertices never move, so Meshy's skin
weights and UVs carry over untouched. Writes the GLB, a .blend beside it, and a check sheet.

    blender -b -P blender-pass.py -- bloombot-meshy.glb bloombot.glb preview-fixed.png [extra-clips.glb]

The optional fourth file is more Meshy clips on the same rig (E23: meditate, sit-down, sit, stand-up, doze); its
animations are renamed by EXTRA_CLIPS and rebuilt like the rest.

Never remesh here (voxel remesh + Quadriflow hung Blender and froze the PC). Run with a time limit."""
import bpy, bmesh, sys, os, math, mathutils
from mathutils.bvhtree import BVHTree
import numpy as np

QUAD_ANGLE = 75  # degrees a pair of triangles may bend or skew and still be joined into a quad
BAR_LIFT = 0.002      # metres the chest speaker's wave bars stand off the disc
GLASS_ALPHA = 0.3     # how much the visor glass darkens the face screen behind it
SCREEN_DEPTH = 0.008  # metres the face screen sits behind the glass
KEEP_UV_ISLANDS = False  # True: never join two triangles across a seam of Meshy's UV atlas (fewer quads)

def P(*a): print(*a, flush=True)

_args = sys.argv[sys.argv.index('--') + 1:]
src, out, sheet = (os.path.abspath(a) for a in _args[:3])
extra = os.path.abspath(_args[3]) if len(_args) > 3 else None
# E23 (#468, docs/art/e23-models.md): Meshy preset clips added on the same rig, and their names in the game
EXTRA_CLIPS = {'Sit_Cross_Legged_on_Floor': 'meditate', 'Stand_to_Sit_Transition_M': 'sit-down', 'Chair_Sit_Idle_M': 'sit',
               'Sit_to_Stand_Transition_M': 'stand-up', 'Sit_and_Doze_Off': 'doze'}
SITTING = ('sit-down', 'sit', 'stand-up', 'doze')   # on a bench: feet flat and on the ground every frame
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
if extra:
    keep = set(bpy.data.objects)
    had = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=extra)
    for a in set(bpy.data.actions) - had:
        name = next((v for k, v in EXTRA_CLIPS.items() if a.name.startswith(k)), None)
        if name is None:
            bpy.data.actions.remove(a)
        else:
            a.name = name; a.use_fake_user = True
    for o in set(bpy.data.objects) - keep:
        bpy.data.objects.remove(o)
    P('EXTRA CLIPS', sorted(a.name for a in bpy.data.actions if a.name in EXTRA_CLIPS.values()))
for o in [o for o in bpy.data.objects if o.type == 'MESH' and o.name != 'char1']:
    bpy.data.objects.remove(o)  # the importer's bone-shape helper
mesh = next(o for o in bpy.data.objects if o.type == 'MESH')
mesh.name = 'bloombot_body'
me = mesh.data
mw = mesh.matrix_world
n3 = mw.to_3x3()
P('IMPORTED', len(me.polygons), 'faces')

# -- the painted texture, as raw sRGB values, for sorting faces into parts --
img = next(i for i in bpy.data.images if i.size[0] > 0)
tw, th = img.size
buf = np.empty(tw * th * 4, dtype=np.float32); img.pixels.foreach_get(buf)
tex = buf.reshape(th, tw, 4)[:, :, :3]

def srgb(hexs):
    c = [int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1,)

#   part:        colour     metal rough glow
PARTS = {
    'shell':     ('#efe7da', 0.0, 0.32, 0),
    'champagne': ('#dcc39a', 0.0, 0.38, 0),
    'gold':      ('#e3ad45', 1.0, 0.28, 0),
    'joint':     ('#75665a', 0.0, 0.6, 0),
    'dark':      ('#1b1d24', 0.0, 0.35, 0),
    'glow':      ('#6eecff', 0.0, 0.4, 2.5),
    'bulb':      ('#ffe08a', 0.0, 0.4, 2.0),
    'leaf':      ('#6db83a', 0.0, 0.55, 0),
    'fabric':    ('#86b043', 0.0, 0.85, 0),
    'canvas':    ('#b99a6b', 0.0, 0.85, 0),
    'visor':     ('#05060a', 0.0, 0.35, 0),  # last: cut out as its own object below
}
order = list(PARTS)
me.materials.clear()
for n, (hexs, metal, rough, glow) in PARTS.items():
    m = bpy.data.materials.new('bloombot_' + n); m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = srgb(hexs)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    if glow:
        bsdf.inputs['Emission Color'].default_value = srgb(hexs)
        bsdf.inputs['Emission Strength'].default_value = glow
    me.materials.append(m)

# Visor: the oval at x +-0.125, z 0.52-0.68 on the front of the head (front is -Y).
VX, VZ0, VZ1 = 0.125, 0.517, 0.679
vzc, vrx, vrz = (VZ0 + VZ1) / 2, VX * 0.99, (VZ1 - VZ0) / 2 * 0.99

def in_pack(p):
    """The pack is the geometry behind the torso, between the hips and the shoulders."""
    return p.y > 0.05 and 0.15 < p.z < 0.5 and abs(p.x) < 0.24

# Label every texel with the colour family painted there, then smooth the labels (a majority vote over a small
# window) so brush noise and shading don't turn into speckles.
FAMILY = ['void', 'dark', 'glow', 'green', 'joint', 'gold', 'champagne', 'shell']
_r, _g, _b = tex[..., 0], tex[..., 1], tex[..., 2]
_v = tex.max(-1); _d = np.maximum(_v - tex.min(-1), 1e-6); _s = _d / np.maximum(_v, 1e-6)
_h = np.where(_v == _r, ((_g - _b) / _d) % 6, np.where(_v == _g, (_b - _r) / _d + 2, (_r - _g) / _d + 4)) * 60
raw = np.full(_v.shape, 7, dtype=np.int8)                               # shell: pale, unsaturated
raw[_s > 0.34] = 6                                                      # champagne: warmer tan
raw[_s > 0.5] = 5                                                       # gold: saturated yellow
raw[((_v < 0.62) & (_s < 0.5)) | (_v < 0.45)] = 4                       # joint: taupe and the brown outlines
raw[(_h > 62) & (_h < 150) & (_s > 0.3)] = 3                            # green: leaves and pack fabric
raw[(_h > 150) & (_h < 215) & (_s > 0.25) & (_v > 0.35)] = 2            # glow: cyan
raw[_v < 0.25] = 1                                                      # dark: visor, speaker, antenna stripes
raw[_v < 0.02] = 0                                                      # void: the empty atlas between UV islands
RAD = 4
best = np.zeros(raw.shape, np.float32); texel = raw.copy()
for k in range(1, len(FAMILY)):
    m = (raw == k).astype(np.float32)
    c = np.cumsum(np.pad(m, ((RAD + 1, RAD), (0, 0))), 0); m = c[2 * RAD + 1:] - c[:-2 * RAD - 1]
    c = np.cumsum(np.pad(m, ((0, 0), (RAD + 1, RAD))), 1); m = c[:, 2 * RAD + 1:] - c[:, :-2 * RAD - 1]
    upd = m > best; best[upd] = m[upd]; texel[upd] = k
texel[raw == 0] = 0
del raw, best, tex, buf
P('LABELLED texture')

def part_at(u, p):
    """The part at a UV point whose position on the model is p (None in the void between UV islands)."""
    n = FAMILY[texel[min(th - 1, max(0, int(u.y * th))), min(tw - 1, max(0, int(u.x * tw)))]]
    if n == 'void': return None
    if n in ('dark', 'glow'):
        # The painted visor (and the eyes painted on it) becomes the visor part, which shows the face frames.
        if p.y < -0.12 and (p.x / vrx) ** 2 + ((p.z - vzc) / vrz) ** 2 < 1.15: return 'visor'
        return n
    if n == 'green': return 'leaf' if p.z > 0.72 else 'fabric'
    if p.z > 0.875 and abs(p.x) < 0.06: return 'bulb'
    if in_pack(p): return 'canvas'
    return n

# -- weld: the importer splits vertices along every UV seam, and Meshy's atlas is hundreds of scraps --
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = mesh; mesh.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=1e-5)
bpy.ops.object.mode_set(mode='OBJECT')
P('WELDED to', len(me.vertices), 'vertices')

# -- cut: Meshy's triangles ignore the paint, so colouring whole faces gives saw-toothed part edges. Put a new
# vertex wherever an edge crosses from one part to another and join those vertices up, so every part ends on
# a real edge. Only edges are split: no vertex moves, and new vertices blend their neighbours' weights and UVs.
N_SAMPLES, PULL, MARGIN, MIN_BAND = 12, 0.12, 0.14, 0.2
V2 = mathutils.Vector((0, 0))
bm = bmesh.new(); bm.from_mesh(me)
uvl = bm.loops.layers.uv.active
world = {v: mw @ v.co for v in bm.verts}
cuts = []
for e in bm.edges:
    l = e.link_loops[0]; f = l.face
    ua, ub = l[uvl].uv, l.link_loop_next[uvl].uv
    um = sum((x[uvl].uv for x in f.loops), V2) / len(f.loops)
    pa, pb = world[l.vert], world[l.link_loop_next.vert]
    def at(t):  # sampled a little inside the face, clear of the atlas void beside a seam
        return part_at(ua.lerp(ub, t).lerp(um, PULL), pa.lerp(pb, t))
    found = []; prev = None
    for i in range(N_SAMPLES):
        t = (i + 0.5) / N_SAMPLES; c = at(t)
        if c is None: continue
        if prev is not None and prev[1] != c:
            lo, hi = prev[0], t
            for _ in range(6):
                mid = (lo + hi) / 2
                if at(mid) in (prev[1], None): lo = mid
                else: hi = mid
            found.append((lo + hi) / 2)
        prev = (t, c)
    found = [t for t in found if MARGIN < t < 1 - MARGIN]   # a crossing near a corner: let the corner be the edge
    if len(found) > 2: found = [found[0], found[-1]]
    if len(found) == 2 and found[1] - found[0] < MIN_BAND: found = []  # a band too thin to model
    if found: cuts.append((e, l.vert, found))
fresh = set()
for e, v0, found in cuts:
    t = found[-1]
    _e, nv = bmesh.utils.edge_split(e, v0, t); fresh.add(nv)
    if len(found) == 2:
        _e, nv1 = bmesh.utils.edge_split(bm.edges.get((v0, nv)), v0, found[0] / t); fresh.add(nv1)
P('CUT', len(cuts), 'edges,', len(fresh), 'new vertices')

def split(f):
    """Join a face's new vertices: one cut goes to the far corner, two cut a corner off (leaving a quad), four
    (a band crossing a corner) leave two quads and a triangle. Anything odder is left for triangulation."""
    vs = [l.vert for l in f.loops]; n = len(vs)
    isnew = [v in fresh for v in vs]; k = sum(isnew)
    if n == 4 and k == 1:
        i = isnew.index(True); bmesh.utils.face_split(f, vs[i], vs[(i + 2) % 4])
    elif n == 5 and k == 2:
        i, j = [x for x in range(5) if isnew[x]]
        if (j - i) % 5 not in (1, 4): bmesh.utils.face_split(f, vs[i], vs[j])
    elif n == 7 and k == 4:
        for b in range(7):
            if not isnew[b] and all(isnew[(b + d) % 7] for d in (-2, -1, 1, 2)):
                nf, _l = bmesh.utils.face_split(f, vs[(b - 1) % 7], vs[(b + 1) % 7])
                big = f if len(f.verts) > len(nf.verts) else nf
                bmesh.utils.face_split(big, vs[(b - 2) % 7], vs[(b + 2) % 7])
                break
for f in [f for f in bm.faces if any(v in fresh for v in f.verts)]: split(f)
bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
bm.faces.ensure_lookup_table(); bm.faces.index_update()
P('AFTER CUT', len(bm.faces), 'faces =', sum(len(f.verts) - 2 for f in bm.faces), 'triangles')

# -- sort the faces into parts: each face votes with a handful of points inside it --
lab = []
for f in bm.faces:
    us = [l[uvl].uv for l in f.loops]; ps = [mw @ l.vert.co for l in f.loops]
    um = sum(us, V2) / len(us); pm = sum(ps, mathutils.Vector((0, 0, 0))) / len(ps)
    pts = [(um, pm)] + [(um.lerp(u, w), pm.lerp(p, w)) for u, p in zip(us, ps) for w in (0.35, 0.7)]
    votes = {}
    for u, p in pts:
        k = part_at(u, p)
        if k: votes[k] = votes.get(k, 0) + 1
    lab.append(max(votes, key=votes.get) if votes else None)
# Speckle clean-up: a face none of whose neighbours agree with it takes their majority (small rings survive).
nb = [[g.index for e in f.edges for g in e.link_faces if g is not f] for f in bm.faces]
for _pass in range(3):
    new = list(lab)
    for i, ns in enumerate(nb):
        kinds = [lab[n] for n in ns if lab[n]]
        if kinds and lab[i] not in kinds: new[i] = max(set(kinds), key=kinds.count)
    lab = new
lab = [k or 'shell' for k in lab]

# Chest speaker: its painted wave bars are thinner than the triangles, so as face colours they collapse into
# one blob. Make the whole disc dark and model the motif instead: five glowing bars lying on the disc.
def on_front(c): return abs(c.x) < 0.09 and 0.2 < c.z < 0.5 and c.y < -0.03
chest = [f for f in bm.faces if lab[f.index] in ('dark', 'glow') and on_front(mw @ f.calc_center_median())]
cpts = [mw @ v.co for v in {v for f in chest for v in f.verts}]
cx = (min(p.x for p in cpts) + max(p.x for p in cpts)) / 2; cz = (min(p.z for p in cpts) + max(p.z for p in cpts)) / 2
rad = min(max(p.x for p in cpts) - min(p.x for p in cpts), max(p.z for p in cpts) - min(p.z for p in cpts)) / 2
# the painted glow's dim halo was sorted as 'joint': everything inside the disc that isn't trim goes dark
chest = [f for f in bm.faces if lab[f.index] in ('dark', 'glow', 'joint') and (lambda c: on_front(c) and math.hypot(c.x - cx, c.z - cz) < rad * 1.1)(mw @ f.calc_center_median())]
for f in chest: lab[f.index] = 'dark'
for f in bm.faces: f.material_index = order.index(lab[f.index])
P('CHEST disc', len(chest), 'faces, centre x %.3f z %.3f, radius %.3f' % (cx, cz, rad))
inv = mw.inverted(); unit = 1 / mw.to_scale().x
tree = BVHTree.FromBMesh(bm)
dl = bm.verts.layers.deform.active
chest_verts = list({v for f in chest for v in f.verts})
front = (inv.to_3x3() @ mathutils.Vector((0, -1, 0))).normalized()
def on_chest(x, z):
    """A new vertex on the disc's surface at world (x, z), raised a little, skinned like the disc beside it."""
    hit, _n, _i, _d = tree.ray_cast(inv @ mathutils.Vector((x, -1, z)), -front)
    v = bm.verts.new(hit + front * BAR_LIFT * unit)
    near = min(chest_verts, key=lambda c: (c.co - hit).length_squared)
    for g, w in near[dl].items(): v[dl][g] = w
    return v
gi = order.index('glow')
half = rad * 0.07
for k, tall in enumerate((0.26, 0.48, 0.66, 0.48, 0.26)):
    x = cx + (k - 2) * rad * 0.27; h = rad * tall
    # a bar with chamfered ends: three quads
    ring = [(x - half, cz - h + half), (x - half, cz + h - half), (x + half, cz + h - half), (x + half, cz - h + half)]
    cap = [(x - half * 0.4, cz - h), (x - half * 0.4, cz + h), (x + half * 0.4, cz + h), (x + half * 0.4, cz - h)]
    a, b, c, d = (on_chest(*q) for q in ring); e, f_, g_, h_ = (on_chest(*q) for q in cap)
    for quad in ((a, b, c, d), (b, f_, g_, c), (e, a, d, h_)):
        nf = bm.faces.new(quad); nf.material_index = gi; nf.smooth = True; nf.normal_update()
        if nf.normal.dot(front) < 0: nf.normal_flip()
    lab += ['glow'] * 3
P('PARTS', {k: lab.count(k) for k in order})
bm.to_mesh(me); bm.free()
bpy.data.images.remove(img)

# -- quads: pair up triangles, never across a part boundary --
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.tris_convert_to_quads(face_threshold=math.radians(QUAD_ANGLE), shape_threshold=math.radians(QUAD_ANGLE), topology_influence=1.0, uvs=KEEP_UV_ISLANDS, materials=True)
bpy.ops.object.mode_set(mode='OBJECT')
nq = sum(1 for p in me.polygons if len(p.vertices) == 4); nt = len(me.polygons) - nq
P('QUADS', nq, 'TRIANGLES', nt, '| in the game:', 2 * nq + nt, 'triangles | share of surface in quads %.0f%%' % (200 * nq / (2 * nq + nt)))

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
PACK_BONE = 'Spine'
pack_vg = mesh.vertex_groups[PACK_BONE]
pack = [v.index for v in me.vertices if in_pack(mw @ v.co)]
for vg in mesh.vertex_groups:
    if vg.name != PACK_BONE:
        vg.remove(pack)
pack_vg.add(pack, 1.0, 'REPLACE')
P('PACK vertices', len(pack))

# Visor: two layers, both skinned to the head. The visor's faces are cut out and become a face screen
# (material `bloombot_visor`, flat front-on UVs: the game finds it by that name and swaps face frames on it),
# sunk a little into the head. A copy stays at the surface as a sheet of dark glass over it.
vi = order.index('visor')
bpy.ops.object.mode_set(mode='EDIT')
ebm = bmesh.from_edit_mesh(me)
for el in (*ebm.verts, *ebm.edges, *ebm.faces): el.select = False
picked = 0
for f in ebm.faces:
    if f.material_index == vi:
        f.select = True; picked += 1
ebm.select_flush(True)
bmesh.update_edit_mesh(me)
bpy.ops.mesh.separate(type='SELECTED')
bpy.ops.object.mode_set(mode='OBJECT')
visor = next(o for o in bpy.context.selected_objects if o is not mesh)
visor.name = 'bloombot_visor'
vm = visor.matrix_world
uvd = visor.data.uv_layers.active.data
for poly in visor.data.polygons:
    for li in poly.loop_indices:
        co = vm @ visor.data.vertices[visor.data.loops[li].vertex_index].co
        uvd[li].uv = (min(1, max(0, (co.x + VX) / (2 * VX))), min(1, max(0, (co.z - VZ0) / (VZ1 - VZ0))))
# Meshy's visor is lumpy. Fit one smooth bowl (a quadric in x and z) to it and ease the vertices onto that,
# fully in the middle and not at all on the rim, so the glass still meets the gold bezel.
vme = visor.data
wco = [vm @ v.co for v in vme.vertices]
A = np.array([[1, p.x, p.z, p.x * p.x, p.x * p.z, p.z * p.z] for p in wco])
off = A @ np.linalg.lstsq(A, np.array([p.y for p in wco]), rcond=None)[0] - np.array([p.y for p in wco])
P('VISOR bumps up to %.1f mm' % (1000 * float(np.abs(off).max())))
uses = {}
for poly in vme.polygons:
    for ek in poly.edge_keys: uses[ek] = uses.get(ek, 0) + 1
rim = [wco[i] for i in {i for ek, c in uses.items() if c == 1 for i in ek}]
flat = []
for i, p in enumerate(wco):
    w = min(1, min((p - q).length for q in rim) / 0.03); w = w * w * (3 - 2 * w)
    flat.append(mathutils.Vector((p.x, p.y + w * off[i], p.z)))
inv = vm.inverted()
glass = visor.copy(); glass.data = vme.copy(); glass.name = 'bloombot_glass'
bpy.context.scene.collection.objects.link(glass)
for v, p in zip(glass.data.vertices, flat): v.co = inv @ p
for _l in list(glass.data.uv_layers): glass.data.uv_layers.remove(_l)
gmat = bpy.data.materials.new('bloombot_glass'); gmat.use_nodes = True
gb = gmat.node_tree.nodes['Principled BSDF']
gb.inputs['Base Color'].default_value = (0.02, 0.035, 0.06, 1)
gb.inputs['Alpha'].default_value = GLASS_ALPHA
gb.inputs['Roughness'].default_value = 0.06
gmat.surface_render_method = 'BLENDED'
glass.data.materials.clear(); glass.data.materials.append(gmat)
for poly in glass.data.polygons: poly.material_index = 0
# The screen: the same surface, a touch wider so its edge hides behind the bezel, sunk SCREEN_DEPTH into the head.
for v, p in zip(vme.vertices, flat):
    v.co = inv @ mathutils.Vector((p.x * 1.03, p.y + SCREEN_DEPTH, vzc + (p.z - vzc) * 1.03))
vmat = bpy.data.materials['bloombot_visor']
visor.data.materials.clear(); visor.data.materials.append(vmat)
for poly in visor.data.polygons: poly.material_index = 0
me.materials.pop(index=vi)
if not KEEP_UV_ISLANDS:  # nothing on the body is textured any more, and quads now straddle the old seams
    for _l in list(me.uv_layers): me.uv_layers.remove(_l)
P('VISOR faces', picked)

acts = {a.name: a for a in bpy.data.actions}
LEGS = ('LeftUpLeg', 'RightUpLeg')
# Pulse and assemble: a human bow tips the oversized head to the floor. Keep a third of the lean.
# E23: a human leaning forward to sit down (or dozing off) tips the big head at the floor too. Same third of the lean.
for n in SITTING:
    if n in acts:
        damp(acts[n], ['Hips'], 0.35, compensate=LEGS)
        damp(acts[n], ['Spine02', 'Spine01', 'Spine', 'neck', 'Head'], 0.35)
for n in ('pulse', 'assemble'):
    damp(acts[n], ['Hips'], 0.35, compensate=LEGS)
    damp(acts[n], ['Spine02', 'Spine01', 'Spine', 'neck', 'Head'], 0.35)
# Idle: the hip twist turned the head away from the camera.
damp(acts['idle'], ['Hips'], 0.12, compensate=LEGS)
damp(acts['idle'], ['Spine02', 'Spine01', 'Spine', 'neck', 'Head'], 0.25)
# Idle again: its feet must never leave the ground. Hold the hips and both legs in their first-frame pose for
# the whole clip; the spine, arms and head keep their sway.
def freeze(a, bones):
    bag = curves(a); f0, f1 = a.frame_range
    for b in bones:
        for prop, n in (('rotation_quaternion', 4), ('location', 3), ('scale', 3)):
            for i in range(n):
                fc = bag.fcurves.find(f'pose.bones["{b}"].{prop}', index=i)
                if not fc: continue
                v = fc.evaluate(f0); fc.keyframe_points.clear(); fc.keyframe_points.add(2)
                for k, f in enumerate((f0, f1)):
                    fc.keyframe_points[k].co = (f, v); fc.keyframe_points[k].interpolation = 'LINEAR'
LOWER = [b.name for b in arm.pose.bones if b.name == 'Hips' or any(k in b.name for k in ('Leg', 'Foot', 'Toe'))]
freeze(acts['idle'], LOWER)
# Cheer: straight-up arms vanish behind the head. Halfway back to the T-pose makes a V clear of it.
damp(acts['cheer'], ['LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm'], 0.5)
damp(acts['cheer'], ['LeftForeArm', 'RightForeArm'], 0.4)


# ---- Robot joints: the owner's swivel points (18 Nov 2026) ----
# Bloombot is a robot, so each piece between the marked swivel points moves as one rigid part instead of the
# skin stretching. The waist is a real cut: torso and hips are two separate, capped pieces and the torso
# swivels on a pivot exactly at that line. At the other joints the pieces share their seam vertices, so they
# hinge crisply without opening holes.
from mathutils import Matrix
V = mathutils.Vector
WAIST_Z = 0.285                  # the line across the top of the gold belly band
NECK_Z = 0.44                    # the bottom edge of the head shell
SHOULDER_X, ELBOW_X, WRIST_X = 0.09, 0.185, 0.27   # |x| of the shoulder ball, the elbow band, the start of the hand
KNEE_Z, ANKLE_Z = 0.16, 0.06     # boot top and gold shoe: not marked, but natural seams, so crouches still work
mi = {m.name.replace('bloombot_', ''): i for i, m in enumerate(me.materials)}
W = lambda v: mw @ v.co
inv = mw.inverted()

def islands(b):
    seen = {}; out = []
    for f in b.faces:
        if f in seen: continue
        stack = [f]; seen[f] = len(out); isl = [f]
        while stack:
            g = stack.pop()
            for e in g.edges:
                for h in e.link_faces:
                    if h not in seen: seen[h] = len(out); stack.append(h); isl.append(h)
        out.append(isl)
    return out

bm = bmesh.new(); bm.from_mesh(me)
lay = bm.faces.layers.int.new('main')
for f in max(islands(bm), key=len): f[lay] = 1
band = [f for f in bm.faces if f[lay] and abs((mw @ f.calc_center_median()).x) < 0.18 and any(abs(W(v).z - WAIST_Z) < 0.08 for v in f.verts)]
geom = list({v for f in band for v in f.verts}) + list({e for f in band for e in f.edges}) + band
cut = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=inv @ V((0, 0, WAIST_Z)), plane_no=(mw.to_3x3().transposed() @ V((0, 0, 1))).normalized(), dist=1e-6)
on_plane = lambda v: abs(W(v).z - WAIST_Z) < 1e-5
cut_edges = [e for e in cut['geom_cut'] if isinstance(e, bmesh.types.BMEdge) and all(on_plane(v) for v in e.verts)]
ring = [W(v) for e in cut_edges for v in e.verts]
pivot = V((sum(p.x for p in ring) / len(ring), sum(p.y for p in ring) / len(ring), WAIST_Z))
bmesh.ops.split_edges(bm, edges=cut_edges)
bnd = [e for e in bm.edges if e.is_boundary and all(on_plane(v) for v in e.verts)]
caps = bmesh.ops.holes_fill(bm, edges=bnd, sides=0)['faces']
cap_side = {}
for f in caps:
    f.material_index = mi['joint']; f.smooth = False; f[lay] = 1; f.normal_update()
    nbr = [g for e in f.edges for g in e.link_faces if g is not f]
    upper = sum((mw @ g.calc_center_median()).z for g in nbr) / len(nbr) > WAIST_Z
    nz = (mw.to_3x3() @ f.normal).z
    if (upper and nz > 0) or (not upper and nz < 0): f.normal_flip()
    cap_side[f] = 'Spine02' if upper else 'Hips'
P('WAIST cut through', len(cut_edges), 'edges, capped with', len(caps), 'faces, pivot (%.3f, %.3f, %.3f)' % tuple(pivot))

isl_minz = {}
for isl in islands(bm):
    z = min(W(v).z for f in isl for v in f.verts)
    for f in isl: isl_minz[f] = z
P('WAIST pieces:', sorted(sum(1 for f in isl if f[lay]) for isl in islands(bm) if any(f[lay] for f in isl)))

# Arm or chest? Meshy's skin weights already know: a face is arm when most of its weight is on the arm's bones.
dl = bm.verts.layers.deform.active
gidx = {g.name: g.index for g in mesh.vertex_groups}
def arm_share(f, side):
    arm_g = {gidx[side + n] for n in ('Arm', 'ForeArm', 'Hand') if side + n in gidx}
    tot = armw = 0.0
    for v in f.verts:
        for gi, w in v[dl].items():
            tot += w
            if gi in arm_g: armw += w
    return armw / tot if tot else 0

def piece(f):
    if f in cap_side: return cap_side[f]
    c = mw @ f.calc_center_median(); ax = abs(c.x); side = 'Left' if c.x > 0 else 'Right'
    if not f[lay]: return 'Head' if isl_minz[f] > NECK_Z else 'Spine02'   # leaves, antenna / pack, chest bars
    if c.z >= WAIST_Z:
        if ax > WRIST_X: return side + 'Hand'
        if ax > SHOULDER_X and arm_share(f, side) > 0.5:
            return side + ('Arm' if ax < ELBOW_X else 'ForeArm')
        return 'Head' if c.z > NECK_Z else 'Spine02'
    if c.z >= 0.24 or (f.material_index == mi['gold'] and c.z > 0.17) or (ax < 0.02 and c.z > 0.17): return 'Hips'   # band, crotch
    if c.z >= KNEE_Z: return side + 'UpLeg'
    if c.z < ANKLE_Z and f.material_index in (mi['gold'], mi['joint']): return side + 'Foot'
    return side + 'Leg'

segs = [piece(f) for f in bm.faces]
bm.to_mesh(me); bm.free()
for vg in list(mesh.vertex_groups): mesh.vertex_groups.remove(vg)
G = {}
acc = [dict() for _ in me.vertices]
for p in me.polygons:
    for vi in p.vertices: acc[vi][segs[p.index]] = acc[vi].get(segs[p.index], 0) + 1
for vi, d in enumerate(acc):
    tot = sum(d.values())
    for n, c in d.items():
        if n not in G: G[n] = mesh.vertex_groups.new(name=n)
        G[n].add([vi], c / tot, 'REPLACE')
for ob in (visor, glass):
    for vg in list(ob.vertex_groups): ob.vertex_groups.remove(vg)
    ob.vertex_groups.new(name='Head').add([v.index for v in ob.data.vertices], 1.0, 'REPLACE')
P('PIECES', {n: segs.count(n) for n in sorted(set(segs))})

# -- the clips: every piece now turns about its own swivel point --
order = [b.name for b in arm.data.bones]   # parents first
par = {b.name: (b.parent.name if b.parent else None) for b in arm.data.bones}
rest_old = {b.name: b.matrix_local.copy() for b in arm.data.bones}

def basis(bag, b, f):
    def ev(path, n, d):
        r = []
        for i in range(n):
            fc = bag.fcurves.find(f'pose.bones["{b}"].{path}', index=i)
            r.append(fc.evaluate(f) if fc else d[i])
        return r
    return Matrix.LocRotScale(V(ev('location', 3, (0, 0, 0))), Q(ev('rotation_quaternion', 4, (1, 0, 0, 0))).normalized(), V((1, 1, 1)))

def fk(bases, rest):
    M = {}
    for b in order:
        p = par[b]
        M[b] = (rest[b] if p is None else M[p] @ rest[p].inverted() @ rest[b]) @ bases[b]
    return M

deltas, roots = {}, {}
for n, a in acts.items():
    bag = curves(a)
    for f in frames(a):
        Mo = fk({b: basis(bag, b, f) for b in order}, rest_old)
        deltas[(n, f)] = {b: Mo[b].to_quaternion() @ rest_old[b].to_quaternion().inverted() for b in order}
        roots[(n, f)] = Mo['Hips'].translation.copy()

# The torso's bone starts at the waist cut, so the torso swivels exactly there.
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = arm; arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones['Spine02']
d = arm.matrix_world.inverted() @ pivot - eb.head
eb.head += d; eb.tail += d
bpy.ops.object.mode_set(mode='OBJECT')
rest_new = {b.name: b.matrix_local.copy() for b in arm.data.bones}

def pose_from(D, root):
    M = {}
    for b in order:
        p = par[b]
        head = root if p is None else (M[p] @ rest_new[p].inverted() @ rest_new[b]).translation
        M[b] = Matrix.Translation(head) @ (D[b] @ rest_new[b].to_quaternion()).to_matrix().to_4x4()
    return M

def write_pose(a, poses):
    bag = curves(a)
    rows = {b: [] for b in order}
    for f in sorted(poses):
        M = poses[f]
        for b in order:
            p = par[b]
            B = rest_new[b].inverted() @ (M[b] if p is None else rest_new[p] @ M[p].inverted() @ M[b])
            q = B.to_quaternion()
            if rows[b] and rows[b][-1][1].dot(q) < 0: q = -q
            rows[b].append((f, q, B.translation.copy()))
    for b, rs in rows.items():
        for path, n, k in (('rotation_quaternion', 4, 1), ('location', 3, 2)):
            for i in range(n):
                dp = f'pose.bones["{b}"].{path}'
                fc = bag.fcurves.find(dp, index=i) or bag.fcurves.new(dp, index=i)
                fc.keyframe_points.clear(); fc.keyframe_points.add(len(rs))
                for j, r in enumerate(rs):
                    kp = fc.keyframe_points[j]; kp.co = (r[0], r[k][i]); kp.interpolation = 'LINEAR'
                fc.update()

# A rigid piece moves with the bone it is weighted to; bones inside a piece take that piece's turn.
SAME = {'Spine02': 'Spine', 'Spine01': 'Spine', 'LeftShoulder': 'Spine', 'RightShoulder': 'Spine',
        'neck': 'Head', 'head_end': 'Head', 'headfront': 'Head', 'LeftToeBase': 'LeftFoot', 'RightToeBase': 'RightFoot'}
# The shoes are rigid, so they stay flat on the floor (turning only left and right). Meshy's crouch pointed the
# feet straight down like a dancer on tiptoe, which with bloombot's big boots looked like standing on a stick.
FLAT_FEET = ('idle', 'pulse', 'assemble', 'interact', 'cheer') + SITTING
def yaw_only(q):
    return Q((q.w, 0, 0, q.z)).normalized()
# Meshy's crouch also tangles the legs (it even starts with them folded). In assemble the feet stay planted
# where they stand at rest and the knees bend forward to follow the body down.
PLANT = ('assemble',)
POLE = V((0, -1, 0))
def two_bone(H, A, l1, l2):
    d = A - H; dist = min(d.length, (l1 + l2) * 0.999); u = d.normalized()
    ca = max(-1.0, min(1.0, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)))
    perp = (POLE - u * POLE.dot(u)).normalized()
    knee = H + (u * ca + perp * math.sqrt(1 - ca * ca)) * l1
    return (knee - H).normalized(), (H + u * dist - knee).normalized()
def seg(a_, b_):
    return rest_new[b_].translation - rest_new[a_].translation
MAX_CROUCH = 0.06   # metres the hips may drop in a planted clip: what bloombot's short legs can fold to
for n, a in acts.items():
    if n in ('walk', 'run'): continue   # made below
    poses = {}
    if n in PLANT:   # scale the crouch so its deepest frame drops the hips MAX_CROUCH
        h0 = rest_new['Hips'].translation
        deepest = max(h0.z - roots[(n, f)].z for f in frames(a)) * arm.matrix_world.to_scale().z
        squash = min(1.0, MAX_CROUCH / deepest) if deepest > 0 else 1.0
        P('%s crouch: Meshy drops the hips %.0f mm, scaled to %.0f mm' % (n.upper(), 1000 * deepest, 1000 * deepest * squash))
        for f in frames(a):
            r = roots[(n, f)]
            roots[(n, f)] = V((r.x, r.y, h0.z + (r.z - h0.z) * squash))
    for f in frames(a):
        D = {b: deltas[(n, f)][SAME.get(b, b)] for b in order}
        if n in FLAT_FEET:
            for side in ('Left', 'Right'):
                D[side + 'Foot'] = D[side + 'ToeBase'] = yaw_only(D[side + 'Foot'])
        M = pose_from(D, roots[(n, f)])
        if n in PLANT:
            for side in ('Left', 'Right'):
                up, kn, ft = side + 'UpLeg', side + 'Leg', side + 'Foot'
                t1, t2 = two_bone(M[up].translation, rest_new[ft].translation, seg(up, kn).length, seg(kn, ft).length)
                D[up] = seg(up, kn).normalized().rotation_difference(t1)
                D[kn] = seg(kn, ft).normalized().rotation_difference(t2)
            M = pose_from(D, roots[(n, f)])
        poses[f] = M
    write_pose(a, poses)
P('JOINTS: clips rebuilt on the swivel points')

# -- walk: a toddler's waddle. Stiff legs swing from the hips, the body rocks over the planted foot, wide
# stance, toes out, arms held up and out for balance. --
WALK_FRAMES = 14                 # one cycle (two steps) at 24 fps: about 3.4 steps a second
STEP, ROLL, YAW, SWAY = math.radians(20), math.radians(9), math.radians(6), 0.012
HIKE, KNEE = math.radians(45), math.radians(55)   # knee lift and bend at mid-swing: about 4 cm of clearance
SPLAY, TOE, LEAN, NOD =  math.radians(5), math.radians(10), math.radians(4), math.radians(2)
ARM_DOWN, ARM_FWD, ARM_SWING = math.radians(50), math.radians(15), math.radians(7)
FORE_DOWN, ELBOW_FWD = math.radians(30), math.radians(35)
Rx = lambda t: Q((1, 0, 0), t); Ry = lambda t: Q((0, 1, 0), t); Rz = lambda t: Q((0, 0, 1), t)
wa = acts['walk']
bag = curves(wa)
for fc in list(bag.fcurves): bag.fcurves.remove(fc)
hip_rest = rest_new['Hips'].translation.copy()
poses = {}
for f in range(WALK_FRAMES + 1):
    ph = 2 * math.pi * f / WALK_FRAMES; s, c = math.sin(ph), math.cos(ph)
    th, yaw = ROLL * s, -YAW * c                       # left foot planted while s > 0
    torso = Rz(-0.6 * yaw) @ Ry(0.45 * th) @ Rx(LEAN)
    head = Rz(-0.3 * yaw) @ Ry(0.15 * th) @ Rx(NOD * math.sin(2 * ph))
    D = {'Hips': Rz(yaw) @ Ry(th)}
    for b in ('Spine02', 'Spine01', 'Spine', 'LeftShoulder', 'RightShoulder'): D[b] = torso
    for b in ('neck', 'Head', 'head_end', 'headfront'): D[b] = head
    for side, sg, al, sw in (('Left', 1, STEP * c, max(0, -s) ** 2), ('Right', -1, -STEP * c, max(0, s) ** 2)):
        # sw: 0 while the foot is planted, rising to 1 mid-swing: the knee comes up and bends to lift the foot
        D[side + 'UpLeg'] = Rx(-(al + HIKE * sw)) @ Ry(-sg * SPLAY)
        D[side + 'Leg'] = Rx(-(al + HIKE * sw) + KNEE * sw) @ Ry(-sg * SPLAY)
        D[side + 'Foot'] = D[side + 'ToeBase'] = Rz(sg * TOE)
        fwd = ARM_FWD - sg * ARM_SWING * c
        D[side + 'Arm'] = torso @ Rz(-sg * fwd) @ Ry(sg * ARM_DOWN)
        D[side + 'ForeArm'] = D[side + 'Hand'] = torso @ Rz(-sg * (fwd + ELBOW_FWD)) @ Ry(sg * FORE_DOWN)
    poses[f] = pose_from(D, hip_rest + V((SWAY * s, 0, 0)) * 100)
write_pose(wa, poses)

# -- hover: the Hover upgrade's sprint. Bloombot lifts a few centimetres off the ground and glides: leaning
# into the motion, head up, legs together and trailing with the toes pointed, arms swept back, bobbing gently.
# It replaces Meshy's human run (the game plays it while the sprint key is held, once Hover is bought). --
HOVER_FRAMES, HOVER_Z, HOVER_BOB = 36, 0.045, 0.008   # 1.5 s bob cycle; clearance under the shoes; bob height
ha = acts.pop('run'); ha.name = 'hover'; acts['hover'] = ha
bag = curves(ha)
for fc in list(bag.fcurves): bag.fcurves.remove(fc)
poses = {}
deg = math.radians
for f in range(HOVER_FRAMES + 1):
    ph = 2 * math.pi * f / HOVER_FRAMES; s = math.sin(ph)
    body = Rx(deg(14) + deg(2) * s) @ Ry(deg(3) * math.sin(ph + 1.0))
    D = {'Hips': body}
    for b in ('Spine02', 'Spine01', 'Spine', 'LeftShoulder', 'RightShoulder'): D[b] = body
    for b in ('neck', 'Head', 'head_end', 'headfront'): D[b] = Rx(deg(4) - deg(1.5) * s)
    for side, sg, off in (('Left', 1, 0.0), ('Right', -1, 0.8)):
        k = math.sin(ph + off)
        D[side + 'UpLeg'] = Rx(deg(20) + deg(4) * k) @ Ry(-sg * deg(2))
        D[side + 'Leg'] = Rx(deg(45) + deg(6) * k) @ Ry(-sg * deg(2))
        D[side + 'Foot'] = D[side + 'ToeBase'] = Rx(deg(40) + deg(5) * k)
        D[side + 'Arm'] = body @ Rz(sg * deg(25)) @ Ry(sg * deg(65 + 3 * k))
        D[side + 'ForeArm'] = D[side + 'Hand'] = body @ Rz(sg * deg(18)) @ Ry(sg * deg(58 + 3 * k))
    poses[f] = pose_from(D, hip_rest + V((0, 0, HOVER_BOB * s)) * 100)
write_pose(ha, poses)

# -- stand on the ground: idle at one height, the walk frame by frame --
def lowest():
    ev = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    co = np.empty(len(ev.data.vertices) * 3, dtype=np.float32); ev.data.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3); m = np.array(ev.matrix_world)
    return float((co @ m[:3, :3].T + m[:3, 3])[:, 2].min())

def ground(a, each_frame, lift_only=False, clearance=0.0):
    ad_ = arm.animation_data; ad_.action = a; ad_.action_slot = a.slots[0]
    lows = {}
    for f in frames(a):
        bpy.context.scene.frame_set(f); lows[f] = lowest()
    conv = (arm.matrix_world.to_3x3() @ arm.data.bones['Hips'].matrix_local.to_3x3()).inverted()
    bag_ = curves(a)
    for i in range(3):
        fc = bag_.fcurves.find('pose.bones["Hips"].location', index=i)
        for kp in fc.keyframe_points:
            lo = lows.get(int(round(kp.co.x)), min(lows.values())) if each_frame else min(lows.values())
            if lift_only: lo = min(lo, 0)
            kp.co.y += (conv @ V((0, 0, clearance - lo)))[i]
        fc.update()
    after = []
    for f in frames(a):
        bpy.context.scene.frame_set(f); after.append(lowest())
    return min(lows.values()), max(lows.values()), min(after), max(after)

for n, each in (('idle', False), ('walk', True)):
    P('%s feet: lowest point was %.1f to %.1f mm from the ground, now %.1f to %.1f mm' % ((n.upper(),) + tuple(1000 * x for x in ground(acts[n], each))))
# The other clips may leave the ground (a hop), but never sink into it: Meshy's assemble crouch put the shoes
# about 6 cm under the floor. Lift any frame whose lowest point is below the ground.
for n in ('pulse', 'assemble', 'interact', 'cheer'):
    P('%s: lowest point was %.1f mm, now %.1f mm' % ((n.upper(),) + tuple(1000 * x for x in ground(acts[n], True, lift_only=True)[::2])))
# E23: sitting on the floor (meditate) or a bench (the rest) touches the ground on every frame, never sinks or floats
for n in ('meditate',) + SITTING:
    if n in acts:
        P('%s: lowest point was %.1f to %.1f mm, now %.1f to %.1f mm' % ((n.upper(),) + tuple(1000 * x for x in ground(acts[n], True))))
if 'sit' in acts:   # the game seats bloombot so its hips sit at this height above the bench's feet
    ad_ = arm.animation_data; ad_.action = acts['sit']; ad_.action_slot = acts['sit'].slots[0]
    bpy.context.scene.frame_set(int(acts['sit'].frame_range[0]))
    P('SIT seat height: hips %.3f m above the ground' % (arm.matrix_world @ arm.pose.bones['Hips'].head).z)
    ad_.action = None
P('HOVER: lowest point was %.1f to %.1f mm, now %.1f to %.1f mm above the ground' % tuple(1000 * x for x in ground(ha, False, clearance=HOVER_Z)))
ad_ = arm.animation_data; ad_.action = wa; ad_.action_slot = wa.slots[0]
foot = lambda: (arm.matrix_world @ arm.pose.bones['LeftFoot'].head).y
bpy.context.scene.frame_set(0); y0 = foot()
bpy.context.scene.frame_set(WALK_FRAMES // 2); y1 = foot()
fps = bpy.context.scene.render.fps
P('WALK stride: %.3f m per cycle of %.2f s = %.3f m/s at clip speed 1 (fps %d)' % (2 * abs(y1 - y0), WALK_FRAMES / fps, 2 * abs(y1 - y0) * fps / WALK_FRAMES, fps))
ad_.action = None

# export: one NLA track per clip
ad = arm.animation_data
ad.action = None
for t in list(ad.nla_tracks): ad.nla_tracks.remove(t)
for n, a in acts.items():
    tr = ad.nla_tracks.new(); tr.name = n
    st = tr.strips.new(n, int(a.frame_range[0]), a); st.action_slot = a.slots[0]
P('SAVING')
bpy.ops.wm.save_as_mainfile(filepath=os.path.splitext(out)[0] + '.blend', compress=True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animation_mode='NLA_TRACKS', export_skins=True)

# sheet: a turnaround in the rest pose, then 3 frames each of the clips that were changed
for t in ad.nla_tracks: t.mute = True
scene = bpy.context.scene
scene.view_settings.view_transform = 'Standard'  # true colours, as the game shows them
scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
S = 400
scene.render.resolution_x = scene.render.resolution_y = S
wd = bpy.data.worlds.new('w'); scene.world = wd; wd.use_nodes = True
wd.node_tree.nodes['Background'].inputs[0].default_value = (0.92, 0.93, 0.95, 1)
wd.node_tree.nodes['Background'].inputs[1].default_value = 0.6
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 2
sun.rotation_euler = (math.radians(50), 0, math.radians(30)); scene.collection.objects.link(sun)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.3
shots = []
def shot(yaw):
    ang = math.radians(yaw)
    cam.location = mathutils.Vector((math.sin(ang) * 4, -math.cos(ang) * 4, 0.45 + 0.6))
    cam.rotation_euler = (mathutils.Vector((0, 0, 0.45)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    f = sheet.replace('.png', f'_{len(shots)}.png'); scene.render.filepath = f
    bpy.ops.render.render(write_still=True); shots.append(f); P('SHOT', len(shots))
arm.data.pose_position = 'REST'
for yaw in (0, 40, 90, 140, 180, 270): shot(yaw)
arm.data.pose_position = 'POSE'
for n in ('pulse', 'assemble', 'cheer', 'idle', 'walk', 'hover', 'meditate', 'sit-down', 'sit', 'stand-up', 'doze'):
    if n not in acts: continue
    a = acts[n]; ad.action = a; ad.action_slot = a.slots[0]
    f0, f1 = a.frame_range
    for t in (0.3, 0.5, 0.7):
        scene.frame_set(int(f0 + (f1 - f0) * t))
        shot(35)
cols = 6; rows = math.ceil(len(shots) / cols)
big = np.ones((rows * S, cols * S, 4), dtype=np.float32)
for k, f in enumerate(shots):
    im = bpy.data.images.load(f); p = np.array(im.pixels[:], dtype=np.float32).reshape(S, S, 4)
    rr_, cc_ = rows - 1 - k // cols, k % cols
    big[rr_ * S:(rr_ + 1) * S, cc_ * S:(cc_ + 1) * S] = p
    os.remove(f)
out_img = bpy.data.images.new('sheet', cols * S, rows * S); out_img.pixels[:] = big.ravel()
out_img.filepath_raw = sheet; out_img.file_format = 'PNG'; out_img.save()
P('DONE')
