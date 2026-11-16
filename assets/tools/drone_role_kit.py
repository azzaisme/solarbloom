"""Builds every drone role part in Blender, as clean quads, directly in drone space.

Each coloured piece is its own smooth mesh, so material edges are exact (Tripo's parts had colours
painted face by face, with ragged edges, and Tripo models thin tubes and blades badly). Drone space: face +X, up +Z,
origin at the body centre; the shell top is at about z 0.235 and the antenna stands near (0, 0.05).

- scout-periscope: a tall gold periscope rising from the top, its lens looking forward.
- courier-rotor: a mast on top with a spinning hub of three leaf blades (the game spins `rotor`
  around Z; the blades are a separate object for that reason, see ROTOR_PIVOT).
- spark-bolt: a glowing zig-zag lightning rod standing on the top.
- harvester-arms: two gold arms reaching forward and down to hold the basket in front.
- harvester-fruit: a pile of round fruit sitting in the basket's mouth.
- gardener-kit: a water canister on the back with gold straps, a glass window and a sprinkler spout.
- gardener-pot: a cream pot with a gold rim, soil and a three-leaf seedling, sitting on the head.
- scout-lens: a gold spyglass by the visor.
- courier-parcel: a kraft parcel on the back, tied with crossed gold straps and a buckle.
- harvester-basket: a woven wooden basket (ridged) with a gold rim, held out in front.

Gold parts use pal_gold, which the game recolours to the role's accent (see drone_roles.py).
Writes <parts>/<name>.blend (quads) and <name>.glb.

blender -b --python assets/tools/drone_role_kit.py -- <parts dir>
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drone_shape
import model_io

parts_dir = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
ROTOR_PIVOT = (-0.12, -0.04, 0.60)       # the courier rotor's spin axis passes through here, along Z
surf = drone_shape.surface_z             # height of the body's top above (x, y): parts are seated on it



def srgb_to_linear(hexs):
    c = [int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1]


PAL = {  # key: (hex, roughness, metallic, glow) - same values as drone_build.py / Materials.ts
    "gold": ("#e7b54a", 0.35, 0.6, 0), "shell": ("#e9e6df", 0.55, 0, 0), "leafFin": ("#7fd36a", 0.6, 0, 0),
    "glass": ("#7fd6f0", 0.1, 0, 0.4), "flowerCore": ("#ffe28a", 0.3, 0, 2.0), "catRed": ("#e2483c", 0.45, 0, 0),
    "pink": ("#ff8fbf", 0.45, 0, 0), "trunk": ("#8b6243", 0.7, 0, 0), "soil": ("#6f533a", 0.9, 0, 0),
    "spark": ("#ffd23f", 0.3, 0, 1.2), "stem": ("#3f9a3a", 0.6, 0, 0),
    "kraft": ("#d6a86c", 0.75, 0, 0),   # new: parcel cardboard; add to Materials.ts PALETTE
}


def mat(key):
    name = "pal_" + key
    m = bpy.data.materials.get(name)
    if m:
        return m
    hexs, rough, metal, glow = PAL[key]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = srgb_to_linear(hexs)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if glow:
        b.inputs["Emission Color"].default_value = srgb_to_linear(hexs)
        b.inputs["Emission Strength"].default_value = glow
    return m


def obj_from(mesh, key):
    mesh.materials.clear(); mesh.materials.append(mat(key))
    o = bpy.data.objects.new(mesh.name, mesh); bpy.context.scene.collection.objects.link(o)
    return o


def tube(pts, radius, key, taper=0.0):
    """Quad tube along a poly line (open ends; cap them with knobs)."""
    cu = bpy.data.curves.new("tube", "CURVE"); cu.dimensions = "3D"
    sp = cu.splines.new("POLY"); sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1)
        sp.points[i].radius = 1 - taper * i / (len(pts) - 1)
    cu.bevel_depth = radius; cu.bevel_resolution = 2; cu.use_fill_caps = False
    o = bpy.data.objects.new("tube", cu); bpy.context.scene.collection.objects.link(o)
    for x in bpy.context.scene.objects:
        x.select_set(x is o)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.active_object
    o.data.materials.clear(); o.data.materials.append(mat(key))
    return o


def knob(centre, size, key, rot=Matrix.Identity(4), cuts=1):
    """Cube rounded toward a sphere: all quads. `size` is per-axis radius."""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    for v in bm.verts:
        v.co = v.co.lerp(v.co.normalized() * 0.5, 0.75)
    me = bpy.data.meshes.new("knob"); bm.to_mesh(me); bm.free()
    me.transform(Matrix.Translation(Vector(centre)) @ rot @ Matrix.Diagonal((*(2 * s for s in size), 1)))
    return obj_from(me, key)


def ring(centre, R, r, axis, key):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=24, minor_segments=8,
                                     location=centre)
    o = bpy.context.active_object
    o.rotation_euler = Vector((0, 0, 1)).rotation_difference(Vector(axis)).to_euler()
    bpy.ops.object.transform_apply(rotation=True, location=False)
    o.data.materials.clear(); o.data.materials.append(mat(key))
    return o


def finish(name, objs=None):
    objs = objs or [o for o in bpy.context.scene.objects if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = o.data.name = name
    o.matrix_world = Matrix.Identity(4)
    bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
    model_io.save(os.path.join(parts_dir, name + ".glb"), [o])
    model_io.save(os.path.join(parts_dir, name + ".blend"), [o])
    quads = sum(len(p.vertices) == 4 for p in o.data.polygons)
    print(f"{name}: {len(o.data.polygons)} faces, {quads} quads")


def rbox(centre, half, key, p=6.0, cuts=6, rot=Matrix.Identity(4)):
    """Rounded box (superellipsoid from a subdivided cube): flat sides, soft edges, all quads.
    `half` is the half size per axis; higher p = sharper edges."""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    for v in bm.verts:
        d = v.co.normalized()
        k = (abs(d.x) ** p + abs(d.y) ** p + abs(d.z) ** p) ** (1 / p)
        v.co = d / k
    me = bpy.data.meshes.new("rbox"); bm.to_mesh(me); bm.free()
    me.transform(Matrix.Translation(Vector(centre)) @ rot @ Matrix.Diagonal((*half, 1)))
    return obj_from(me, key)


def lathe(profile, centre, key, segs=40):
    """Surface of revolution round Z from (r, z) points (z relative to centre): quads, open ends."""
    bm = bmesh.new(); c = Vector(centre)
    rings = [[bm.verts.new(c + Vector((r * math.cos(2 * math.pi * i / segs), r * math.sin(2 * math.pi * i / segs), z)))
              for i in range(segs)] for r, z in profile]
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.normal_update()
    me = bpy.data.meshes.new("lathe"); bm.to_mesh(me); bm.free()
    return obj_from(me, key)


def disc(centre, r, key, n=8):
    """Flat round disc facing +Z, quads only (square grid mapped onto the disk)."""
    bm = bmesh.new(); c = Vector(centre); vs = []
    for j in range(n + 1):
        row = []
        for i in range(n + 1):
            X, Y = -1 + 2 * i / n, -1 + 2 * j / n
            row.append(bm.verts.new(c + Vector((X * math.sqrt(1 - Y * Y / 2), Y * math.sqrt(1 - X * X / 2), 0)) * r))
        vs.append(row)
    for j in range(n):
        for i in range(n):
            bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
    me = bpy.data.meshes.new("disc"); bm.to_mesh(me); bm.free()
    return obj_from(me, key)


def leaf(root, direction, length, width, key="leafFin", thick=0.008):
    """Egg-shaped, slightly cupped leaf growing from `root` along `direction`."""
    def shape(p):
        x = p.x + 0.5
        w = 0.55 + 0.75 * x - 0.35 * x * x
        y = p.y * w
        return Vector((x, y, p.z + 0.9 * y * y))
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=3, use_grid_fill=True)
    for v in bm.verts:
        v.co = shape(v.co.normalized() * 0.5)
    me = bpy.data.meshes.new("leaf"); bm.to_mesh(me); bm.free()
    d = Vector(direction).normalized()
    rot = Vector((1, 0, 0)).rotation_difference(d).to_matrix().to_4x4()
    me.transform(Matrix.Translation(Vector(root)) @ rot @ Matrix.Diagonal((length, width, thick * 2, 1)))
    return obj_from(me, key)


def fresh():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# ---------------------------------------------------------------- scout periscope
fresh()
base = Vector((-0.06, -0.17, surf(-0.06, -0.17) - 0.035))
top = Vector((-0.06, -0.17, 0.72))
head = Vector((0.10, -0.17, 0.72))
tube([base, top - Vector((0, 0, 0.05)), top + Vector((0.05, 0, 0)), head], 0.03, "gold")
knob(base + Vector((0, 0, 0.04)), (0.06, 0.06, 0.035), "gold")                 # collar on the shell
knob(top + Vector((0.01, 0, -0.01)), (0.045, 0.045, 0.045), "gold")            # elbow
ring(head, 0.06, 0.016, (1, 0, 0), "gold")                                     # lens rim
knob(head + Vector((0.005, 0, 0)), (0.02, 0.055, 0.055), "glass")              # lens
finish("scout-periscope")

# ---------------------------------------------------------------- courier rotor
fresh()
pv = Vector(ROTOR_PIVOT)
tube([Vector((pv.x, pv.y, surf(pv.x, pv.y) - 0.03)), pv - Vector((0, 0, 0.02))], 0.022, "gold")
knob((pv.x, pv.y, surf(pv.x, pv.y) + 0.005), (0.055, 0.055, 0.03), "gold")                          # mast foot
knob(pv, (0.05, 0.05, 0.035), "gold")                                           # hub
for i in range(3):                                                              # leaf blades, slightly pitched
    a = math.radians(90 + i * 120)
    rot = Matrix.Rotation(a, 4, "Z") @ Matrix.Rotation(math.radians(12), 4, "X")
    knob(pv + Vector((math.cos(a), math.sin(a), 0)) * 0.20, (0.17, 0.05, 0.010), "leafFin", rot, cuts=2)
finish("courier-rotor")

# ---------------------------------------------------------------- spark bolt
fresh()
zig = [(-0.10, -0.15, surf(-0.10, -0.15) - 0.02), (-0.10, -0.15, 0.46), (-0.04, -0.15, 0.56), (-0.13, -0.15, 0.62), (-0.06, -0.15, 0.78)]
tube([Vector(p) for p in zig], 0.042, "spark", taper=0.6)
knob((-0.10, -0.15, surf(-0.10, -0.15) + 0.005), (0.06, 0.06, 0.035), "gold")                          # gold socket
knob((-0.06, -0.15, 0.795), (0.026, 0.026, 0.034), "spark")                  # glowing tip
finish("spark-bolt")

# ---------------------------------------------------------------- harvester arms
fresh()
objs = []
for s in (1, -1):
    pts = [Vector((0.06, 0.27 * s, -0.16)), Vector((0.22, 0.33 * s, -0.22)),
           Vector((0.36, 0.27 * s, -0.27)), Vector((0.42, 0.19 * s, -0.27))]
    objs.append(tube(pts, 0.024, "gold"))
    objs.append(knob(pts[0], (0.045, 0.045, 0.045), "gold"))                    # shoulder
    objs.append(knob(pts[2], (0.034, 0.034, 0.034), "gold"))                    # elbow
    hand = pts[-1]
    objs.append(knob(hand, (0.035, 0.035, 0.035), "gold"))
    for dz in (0.025, -0.025):                                                   # two curled fingers on the rim
        objs.append(tube([hand, hand + Vector((0.02, -0.04 * s, dz)), hand + Vector((0.0, -0.065 * s, dz * 0.4))],
                         0.011, "gold"))
finish("harvester-arms", objs)

# ---------------------------------------------------------------- harvester fruit
fresh()
FRUIT = [((0.42, 0.06, -0.27), 0.055, "catRed"), ((0.44, -0.06, -0.27), 0.05, "flowerCore"),
         ((0.36, -0.01, -0.26), 0.05, "pink"), ((0.49, 0.0, -0.29), 0.045, "catRed"),
         ((0.41, 0.0, -0.22), 0.05, "catRed")]
for c, r, key in FRUIT:
    knob(c, (r, r, r * 0.92), key, cuts=2)
for c, r, key in FRUIT[:2] + FRUIT[4:]:                                         # little stalks and leaves
    top = Vector(c) + Vector((0, 0, r * 0.9))
    tube([top - Vector((0, 0, 0.01)), top + Vector((0.004, 0, 0.022))], 0.006, "stem")
    knob(top + Vector((0.018, 0.01, 0.012)), (0.022, 0.011, 0.004), "leafFin",
         Matrix.Rotation(math.radians(30), 4, "Z"))
finish("harvester-fruit")

# ---------------------------------------------------------------- gardener kit (on the back)
fresh()
K = Vector((-0.405, 0.0, 0.0))                                                    # canister centre
rbox(K, (0.075, 0.14, 0.13), "shell")
for y in (-0.075, 0.075):                                                        # two gold straps
    rbox(K + Vector((0, y, 0)), (0.083, 0.02, 0.138), "gold", p=8)
rbox(K + Vector((-0.07, 0, 0.0)), (0.012, 0.045, 0.075), "glass", p=8)          # water window
spout = [K + Vector((0.0, 0.10, 0.11)), K + Vector((-0.01, 0.17, 0.17)), K + Vector((-0.02, 0.23, 0.26))]
tube(spout, 0.02, "gold")
knob(spout[0], (0.032, 0.032, 0.022), "gold", cuts=2)                            # spout collar
tip = spout[-1]; d = (spout[-1] - spout[-2]).normalized()
rot = Vector((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4()
knob(tip + d * 0.012, (0.05, 0.05, 0.018), "gold", rot=rot, cuts=2)              # sprinkler rose
knob(tip + d * 0.028, (0.038, 0.038, 0.006), "glass", rot=rot, cuts=2)           # its face
finish("gardener-kit")

# ---------------------------------------------------------------- gardener pot (on the head)
fresh()
P = Vector((-0.04, -0.06, surf(-0.04, -0.06) - 0.012))                           # pot base centre
lathe([(0.02, 0.0), (0.07, 0.0), (0.088, 0.012), (0.1, 0.045), (0.108, 0.09), (0.108, 0.118),
       (0.094, 0.118), (0.09, 0.098)], P, "shell")                                # outer wall, lip, inner wall
ring(P + Vector((0, 0, 0.12)), 0.104, 0.014, (0, 0, 1), "gold")                   # gold rim
disc(P + Vector((0, 0, 0.1)), 0.092, "soil")
stem = [P + Vector((0, 0, 0.09)), P + Vector((0.006, 0, 0.16)), P + Vector((-0.004, 0.004, 0.22))]
tube(stem, 0.011, "stem", taper=0.3)
top = stem[-1]
for i in range(3):                                                               # three leaves
    a = math.radians(30 + i * 120)
    leaf(top + Vector((0, 0, -0.02 - 0.012 * i)), (math.cos(a), math.sin(a), 0.55), 0.11, 0.075)
curl = [top + Vector((0.02 * math.cos(t) - 0.02, 0, 0.02 * math.sin(t))) for t in
        (math.radians(x) for x in range(0, 300, 30))]
tube(curl, 0.008, "leafFin", taper=0.5)                                          # curled shoot
finish("gardener-pot")

# ---------------------------------------------------------------- scout spyglass (by the visor)
fresh()
L0, L1 = Vector((0.43, -0.2, 0.12)), Vector((0.29, -0.2, 0.12))                  # front, back
tube([L0, L1], 0.03, "gold", taper=0.35)
ring(L0, 0.03, 0.009, (1, 0, 0), "gold")
knob(L0 + Vector((0.004, 0, 0)), (0.008, 0.026, 0.026), "glass", cuts=2)        # lens
knob(L1, (0.022, 0.022, 0.022), "gold", cuts=2)                                 # back cap
rbox((0.315, -0.17, 0.11), (0.03, 0.035, 0.015), "gold", p=4)                    # clip to the body
finish("scout-lens")

# ---------------------------------------------------------------- courier parcel (on the back)
fresh()
Q = Vector((-0.43, 0.0, 0.0))
rbox(Q, (0.11, 0.15, 0.14), "kraft", p=8)
rbox(Q, (0.116, 0.025, 0.146), "gold", p=10)                                     # strap: front to back over the top
rbox(Q, (0.025, 0.156, 0.146), "gold", p=10)                                     # strap: side to side over the top
rbox(Q + Vector((0, 0, 0.148)), (0.04, 0.04, 0.01), "gold", p=4)                 # buckle
finish("courier-parcel")

# ---------------------------------------------------------------- harvester basket (held in front)
fresh()
B = Vector((0.43, 0.0, -0.46))
outer = [(0.03, 0.0), (0.1, 0.0), (0.125, 0.015)]
for k in range(9):                                                               # woven ridges
    z = 0.03 + k * 0.016
    r = 0.13 + 0.042 * (z / 0.16) + (0.006 if k % 2 == 0 else 0.0)
    outer.append((r, z))
outer += [(0.172, 0.165), (0.158, 0.165), (0.14, 0.09), (0.1, 0.03), (0.03, 0.03)]
lathe(outer, B, "trunk")
ring(B + Vector((0, 0, 0.165)), 0.168, 0.014, (0, 0, 1), "gold")
finish("harvester-basket")
