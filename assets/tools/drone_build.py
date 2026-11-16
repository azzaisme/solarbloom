"""Builds the base drone, Solarbloom's mascot, to the redesign turnaround (docs/art/SOLARBLOOM_DRONE_REDESIGN.md,
epics D01/D02): a premium ceramic designer toy.

Shape (drone space: face +X, up +Z; body from drone_shape.py, 10% squat):
- warm white upper shell and a champagne lower shell, split by a raised, rounded gold belt
- a wide rounded-rectangle face: thick rounded gold bezel, the screen inset behind it
- a navy top cap with a slim gold rim, a small gold status button above the face
- a short antenna on the cap: striped cream/gold shaft, rounded navy tip, tilted back
- two chunky lime leaf ears (midrib and secondary veins) on short stems in dark side sockets
- a central thruster and two angled side thrusters with glowing cyan nozzles
- one small recessed side vent with cyan marks (right side)

Objects (separate so the game can animate them; each object's origin is its pivot):
drone_body, visor_eyes (the screen: eye sprite sheet as emission, UVs on frame 0, u 0..0.25),
antenna, leaf_L, leaf_R, thruster_C, thruster_L, thruster_R.
Materials are pal_<key> with the spec's values (Materials.ts PALETTE gets the same values).
All quads except a small triangle fan at the centre of the screen.

blender -b --python assets/tools/drone_build.py -- <eyes.png> <out.blend>   (also writes <out>.glb)
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drone_shape as S
import model_io

eyes_png, out = (os.path.abspath(a) for a in sys.argv[sys.argv.index("--") + 1:][:2])

# ---------------------------------------------------------------- materials (spec D02, sRGB)
PAL = {  # key: (hex, roughness, metallic, emission strength)
    "shell": ("#F5F3E8", 0.30, 0.00, 0), "shellLow": ("#BEBBA7", 0.35, 0.15, 0),
    "gold": ("#E8BA40", 0.28, 0.55, 0), "darkFace": ("#101D26", 0.18, 0.00, 0),
    "leafFin": ("#A5D94D", 0.50, 0.00, 0), "leafVein": ("#589D32", 0.55, 0.00, 0),
    "eyeCyan": ("#71F5FF", 0.25, 0.00, 2.0),
}
N = 8                               # pole caps are N x N quad grids -> 4N segments round
BELT_LIFT = 0.013
# Shell profile, bottom to top: (latitude deg, lift along the normal, material of the band below)
RINGS = [(-76, 0, None), (-60, 0, "shellLow"), (-44, 0, "shellLow"), (-29, 0, "shellLow"),
         (-14.5, 0, "shellLow"),
         # raised, rounded gold belt
         (-13, 0.4 * BELT_LIFT, "gold"), (-11.5, 0.85 * BELT_LIFT, "gold"), (-9.5, BELT_LIFT, "gold"),
         (-7.5, BELT_LIFT, "gold"), (-5.5, 0.85 * BELT_LIFT, "gold"), (-4, 0.4 * BELT_LIFT, "gold"),
         (-2.5, 0, "gold"),
         (8, 0, "shell"), (20, 0, "shell"), (32, 0, "shell"), (43, 0, "shell"), (50, 0, "shell"),
         # slim gold rim round the top cap, then the cap
         (52, 0.006, "shell"), (54, 0.009, "gold"), (56, 0.006, "gold"), (56.5, 0.0, "gold"),
         (66, 0.003, "darkFace"), (76, 0.005, "darkFace"), (84, 0.006, "darkFace")]
TOP_LIFT = 0.006
# Face: a rounded rectangle (superellipse) in the tangent plane at FACE_DIR.
FACE_DIR = Vector((1.0, 0.0, -0.03))
FACE_A, FACE_B, FACE_N = 0.275, 0.19, 3.6      # half width, half height, squareness
HOLE = 1.09                                      # shell is cut back to this outline
BEZEL = 0.032                                    # bezel crown height off the shell
# (outline fraction, lift, material of the band outside this ring), from the hole edge inward:
# a round bezel tube, then a wall down into the inset screen
FACE_RINGS = [(1.065, 0.45 * BEZEL, "gold"), (1.04, 0.85 * BEZEL, "gold"), (1.01, BEZEL, "gold"),
              (0.98, 0.85 * BEZEL, "gold"), (0.958, 0.45 * BEZEL, "gold"), (0.95, 0.0, "gold"),
              (0.95, -0.010, "darkFace")]
SCREEN = [0.88, 0.74, 0.58, 0.42, 0.26, 0.12]   # screen rings; the centre is a small fan
SCREEN_LIFT = lambda f: -0.010 + 0.012 * (1 - f * f)
EYE_SQUARE, EYE_UP = 0.64, 0.01                   # the eye sheet frame covers this square on the screen


def srgb_to_linear(hexs):
    c = [int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1]


def mat(key):
    if key == "eyes":
        return eyes_mat()
    m = bpy.data.materials.get("pal_" + key)
    if m:
        return m
    hexs, rough, metal, glow = PAL[key]
    m = bpy.data.materials.new("pal_" + key); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = srgb_to_linear(hexs)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if glow:
        b.inputs["Emission Color"].default_value = srgb_to_linear(hexs)
        b.inputs["Emission Strength"].default_value = glow
    return m


def eyes_mat():
    m = bpy.data.materials.get("visor_eyes")
    if m:
        return m
    m = bpy.data.materials.new("visor_eyes"); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = srgb_to_linear(PAL["darkFace"][0])
    b.inputs["Roughness"].default_value = 0.12
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = bpy.data.images.load(eyes_png); tex.extension = "CLIP"
    nt.links.new(tex.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 1.0
    return m


def link(me, key=None):
    if key:
        me.materials.append(mat(key))
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(me.name, me); bpy.context.scene.collection.objects.link(o)
    return o


# ---------------------------------------------------------------- small-part helpers
def tube(name, pts, radius, key, taper=0.0, res=2):
    cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "3D"
    sp = cu.splines.new("POLY"); sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1)
        sp.points[i].radius = 1 - taper * i / max(1, len(pts) - 1)
    cu.bevel_depth = radius; cu.bevel_resolution = res; cu.use_fill_caps = False
    o = bpy.data.objects.new(name, cu); bpy.context.scene.collection.objects.link(o)
    for x in bpy.context.scene.objects:
        x.select_set(x is o)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.active_object
    o.data.materials.clear(); o.data.materials.append(mat(key))
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def blob(name, centre, size, key, rot=Matrix.Identity(4), cuts=2, shape=None, squareness=0.0):
    """Cube rounded toward a sphere (all quads); squareness > 0 keeps flatter sides (a soft box)."""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    for v in bm.verts:
        v.co = v.co.lerp(v.co.normalized() * 0.5, 1.0 - squareness)
        if shape:
            v.co = shape(v.co)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    me.transform(Matrix.Translation(Vector(centre)) @ rot @ Matrix.Diagonal((*(2 * s for s in size), 1)))
    return link(me, key)


def facing(n):
    """Rotation taking +Z to direction n."""
    return Vector((0, 0, 1)).rotation_difference(Vector(n)).to_matrix().to_4x4()


def disk(X, Y):
    """Square grid -> unit disk (elliptical grid mapping)."""
    return X * math.sqrt(1 - Y * Y / 2), Y * math.sqrt(1 - X * X / 2)


# ---------------------------------------------------------------- shell (surface of revolution)
bpy.ops.wm.read_factory_settings(use_empty=True)
keys = ["shell", "shellLow", "gold", "darkFace", "eyes"]
MI = {k: i for i, k in enumerate(keys)}
bm = bmesh.new()
# Ring segments follow the boundary of an N x N grid mapped to a disk, so the poles close with that
# grid: quads all the way.
border = [(i, 0) for i in range(N)] + [(N, j) for j in range(N)] + \
         [(i, N) for i in range(N, 0, -1)] + [(0, j) for j in range(N, 0, -1)]


def grid_xy(i, j):
    return disk(-1 + 2 * i / N, -1 + 2 * j / N)


AZ = [math.atan2(*reversed(grid_xy(i, j))) for i, j in border]
rings = [[bm.verts.new(S.at(math.radians(phi), az, lift)) for az in AZ] for phi, lift, _ in RINGS]
for k in range(1, len(rings)):
    a, b = rings[k - 1], rings[k]
    for i in range(len(AZ)):
        j = (i + 1) % len(AZ)
        bm.faces.new((a[i], a[j], b[j], b[i])).material_index = MI[RINGS[k][2]]


def cap(ring, phi0, lift0, lift_top, key):
    grid = {ij: v for ij, v in zip(border, ring)}
    for j in range(1, N):
        for i in range(1, N):
            x, y = grid_xy(i, j)
            rf = math.hypot(x, y)
            phi = phi0 + (math.copysign(90, phi0) - phi0) * (1 - rf)
            grid[i, j] = bm.verts.new(S.at(math.radians(phi), math.atan2(y, x), lift0 + (lift_top - lift0) * (1 - rf)))
    for j in range(N):
        for i in range(N):
            bm.faces.new((grid[i, j], grid[i + 1, j], grid[i + 1, j + 1], grid[i, j + 1])).material_index = MI[key]


cap(rings[0], RINGS[0][0], RINGS[0][1], 0.0, "shellLow")
cap(rings[-1], RINGS[-1][0], RINGS[-1][1], TOP_LIFT, "darkFace")

# ---------------------------------------------------------------- face cut into the front
va = FACE_DIR.normalized(); vu = Vector((0, 1, 0)); vu = (vu - va * vu.dot(va)).normalized(); vv = va.cross(vu)


def tangent(p):
    d = (p - S.C).normalized()
    if d.dot(va) <= 0.05:
        return None
    return S.RX * d.dot(vu) / d.dot(va), S.RX * d.dot(vv) / d.dot(va)


def rho(s, t):
    return (abs(s / FACE_A) ** FACE_N + abs(t / FACE_B) ** FACE_N) ** (1 / FACE_N)


def on_outline(s, t, frac, lift):
    k = frac / rho(s, t)
    p = S.toward(va * S.RX + vu * (s * k) + vv * (t * k))
    return p + S.normal(p) * lift


def surf_lift(p):
    q = S.toward(p - S.C)
    return (p - S.C).length - (q - S.C).length


bmesh.ops.delete(bm, geom=[f for f in bm.faces if (st := tangent(f.calc_center_median())) and rho(*st) < HOLE],
                 context="FACES_ONLY")
for v in [v for v in bm.verts if not v.link_faces]:
    bm.verts.remove(v)
# Order the hole edge round the outline and snap it onto the HOLE outline, keeping each vertex's
# height off the shell (vertices on the raised belt stay raised).
edge = [e for e in bm.edges if len(e.link_faces) == 1]
nxt = {}
for e in edge:
    a, b = e.verts
    nxt.setdefault(a, []).append(b); nxt.setdefault(b, []).append(a)
loop, prev = [edge[0].verts[0]], None
while True:
    n = [w for w in nxt[loop[-1]] if w is not prev][0]
    if n is loop[0]:
        break
    prev = loop[-1]; loop.append(n)
dirs = []
for v in loop:
    s, t = tangent(v.co)
    v.co = on_outline(s, t, HOLE, surf_lift(v.co))
    dirs.append((s, t))

uvl = bm.loops.layers.uv.new("UVMap")
prev_ring = loop
for frac, lift, key in FACE_RINGS + [(f, SCREEN_LIFT(f), "eyes") for f in SCREEN]:
    ring = [bm.verts.new(on_outline(s, t, frac, lift)) for s, t in dirs]
    for i in range(len(ring)):
        j = (i + 1) % len(ring)
        bm.faces.new((prev_ring[i], prev_ring[j], ring[j], ring[i])).material_index = MI[key]
    prev_ring = ring
centre = bm.verts.new(S.toward(va) + S.normal(S.toward(va)) * SCREEN_LIFT(0))
for i in range(len(prev_ring)):
    bm.faces.new((prev_ring[i], prev_ring[(i + 1) % len(prev_ring)], centre)).material_index = MI["eyes"]
for f in bm.faces:
    if f.material_index == MI["eyes"]:
        for l in f.loops:
            st = tangent(l.vert.co) or (0.0, 0.0)
            l[uvl].uv = ((0.5 + st[0] / EYE_SQUARE) * 0.25, 0.5 + (st[1] - EYE_UP) / EYE_SQUARE)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
if sum(f.normal.dot(f.calc_center_median() - S.C) * f.calc_area() for f in bm.faces) < 0:
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])


def split(keep_eyes, name):
    b2 = bm.copy()
    bmesh.ops.delete(b2, geom=[f for f in b2.faces if (f.material_index == MI["eyes"]) != keep_eyes],
                     context="FACES")
    me = bpy.data.meshes.new(name); b2.to_mesh(me); b2.free()
    for k in keys:
        me.materials.append(mat(k))
    o = link(me)
    used = {p.material_index for p in me.polygons}
    for x in bpy.context.scene.objects:
        x.select_set(x is o)
    bpy.context.view_layer.objects.active = o
    for i in reversed(range(len(me.materials))):
        if i not in used:
            o.active_material_index = i
            bpy.ops.object.material_slot_remove()
    return o


visor = split(True, "visor_eyes")
body_parts = [split(False, "shell")]
bm.free()

# ---------------------------------------------------------------- details on the body
up = S.toward((0.62, 0.0, 1.0))                                                   # gold status button
body_parts.append(blob("button", up, (0.022, 0.022, 0.009), "gold", rot=facing(S.normal(up)), cuts=2))

vent = S.toward((0.12, -1.0, -0.12))                                              # side vent (right side)
vn = S.normal(vent)
vrot = facing(vn) @ Matrix.Rotation(math.radians(90), 4, "Z")
body_parts.append(blob("vent_rim", vent - vn * 0.004, (0.056, 0.032, 0.012), "shellLow", rot=vrot, squareness=0.6))
body_parts.append(blob("vent", vent - vn * 0.001, (0.045, 0.022, 0.012), "darkFace", rot=vrot, squareness=0.6))
for k in (-1, 0, 1):
    side = (vrot.to_3x3() @ Vector((1, 0, 0))).normalized()
    body_parts.append(blob(f"vent_mark{k}", vent + vn * 0.011 + side * (0.022 * k), (0.008, 0.004, 0.003),
                           "eyeCyan", rot=vrot, cuts=1))

SOCKETS = {}
for side, name in ((1, "L"), (-1, "R")):                                          # dark leaf sockets
    p = S.toward((-0.12, 0.82 * side, 0.62))
    n = S.normal(p)
    SOCKETS[name] = (p, n)
    body_parts.append(blob(f"socket_{name}", p, (0.042, 0.042, 0.02), "darkFace", rot=facing(n), cuts=2))

# ---------------------------------------------------------------- antenna (pivot at its base)
top = S.toward((0.0, 0.0, 1.0))
tilt = Matrix.Rotation(math.radians(-12), 3, "Y")                                 # leans back (-X)
axis = (tilt @ Vector((0, 0, 1))).normalized()
antenna = []
seg_len, z0 = 0.034, top - axis * 0.01
for k, key in enumerate(("gold", "shell", "gold", "shell")):                       # striped shaft
    a = z0 + axis * (seg_len * k); b = a + axis * seg_len
    antenna.append(tube(f"ant{k}", [a, b], 0.016, key, res=1))
antenna.append(blob("ant_foot", top, (0.032, 0.032, 0.012), "gold", rot=facing(axis), cuts=2))
tip_c = z0 + axis * (seg_len * 4 + 0.03)
antenna.append(blob("ant_tip", tip_c, (0.026, 0.026, 0.04), "darkFace", rot=facing(axis), cuts=2))
ANTENNA_PIVOT = top

# ---------------------------------------------------------------- leaf ears (pivot at the socket)
LEAF_SIZE = (0.19, 0.16, 0.03)                    # half length, half width, half thickness (chunky)
LEAF_FOLD, LEAF_CURL = 0.45, 0.55


def leaf_width(x):
    """Broad leaf outline: narrow at the stalk, widest around 45%, a softly rounded point."""
    x = min(max(x, 0.0), 1.0)
    return math.sin(math.pi * x ** 0.85) ** 0.6


def leaf_shape(p):
    x = p.x + 0.5
    w = leaf_width(x)
    y = p.y * w * 1.1
    z = p.z * (0.45 + 0.55 * w)
    return Vector((x, y, z + LEAF_FOLD * abs(y) + LEAF_CURL * x * x))


def leaf_top(x, y):
    """Local point on the leaf's upper surface (before scaling)."""
    w = max(leaf_width(x), 1e-3)
    return Vector((x, y, 0.5 * (0.45 + 0.55 * w) * math.sqrt(max(0.0, 1 - (y / (0.55 * w)) ** 2))
                   + LEAF_FOLD * abs(y) + LEAF_CURL * x * x))


leaves = {}
for side, name, rise, yaw, roll in ((1, "L", 30, -12, 55), (-1, "R", 25, -8, 50)):
    p, n = SOCKETS[name]
    root = p + n * 0.012 + Vector((0, 0.035 * side, 0.045))
    rot = (Matrix.Rotation(math.radians(90 * side + yaw * side), 4, "Z")
           @ Matrix.Rotation(math.radians(-rise), 4, "Y")
           @ Matrix.Rotation(math.radians(roll * side), 4, "X"))    # blade turned to face forward
    out_dir = (rot.to_3x3() @ Vector((1, 0, 0))).normalized()
    m = (Matrix.Translation(root - out_dir * 0.01) @ rot
         @ Matrix.Diagonal((2 * LEAF_SIZE[0], 2 * LEAF_SIZE[1], 2 * LEAF_SIZE[2], 1)))
    parts = [tube(f"stem_{name}", [p - n * 0.005, p + n * 0.02, root, root + out_dir * 0.035], 0.013, "leafVein",
                  taper=0.25),
             blob(f"leaf_{name}", root - out_dir * 0.01, LEAF_SIZE, "leafFin", rot=rot, cuts=5, shape=leaf_shape)]
    rib = [m @ (leaf_top(x, 0.0) + Vector((0, 0, 0.02))) for x in (0.1, 0.3, 0.5, 0.7, 0.86)]
    parts.append(tube(f"rib_{name}", rib, 0.0045, "leafVein", taper=0.6, res=1))
    for x0 in (0.3, 0.5, 0.68):                                                  # secondary veins
        for sy in (1, -1):
            w = leaf_width(x0 + 0.1)
            pts = [m @ (leaf_top(x0, 0.0) + Vector((0, 0, 0.02))),
                   m @ (leaf_top(x0 + 0.12, sy * 0.3 * w) + Vector((0, 0, 0.02)))]
            parts.append(tube(f"vein_{name}{x0}{sy}", pts, 0.003, "leafVein", taper=0.6, res=1))
    leaves[name] = (parts, p)

# ---------------------------------------------------------------- thrusters (pivot at the mount)
thrusters = {}
for name, d, big in (("C", (0, 0, -1), True), ("L", (0.25, 0.75, -0.8), False), ("R", (0.25, -0.75, -0.8), False)):
    p = S.toward(d, -0.006)
    n = S.normal(p)
    if big:
        n = Vector((0, 0, -1))
    r = 0.06 if big else 0.05
    housing = blob(f"thr_house_{name}", p + n * 0.012, (r, r, 0.032), "shellLow", rot=facing(n), cuts=2,
                   squareness=0.35)
    nozzle = blob(f"thr_glow_{name}", p + n * 0.042, (r * 0.78, r * 0.78, r * 0.42), "eyeCyan", rot=facing(n), cuts=2)
    thrusters[name] = ([housing, nozzle], p)


# ---------------------------------------------------------------- assemble the objects
def join(name, objs, pivot=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = o.data.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if pivot is not None:
        o.data.transform(Matrix.Translation(-Vector(pivot)))
        o.location = pivot
    bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
    return o


objs = [join("drone_body", body_parts), join("visor_eyes", [visor]), join("antenna", antenna, ANTENNA_PIVOT)]
for name, (parts, pivot) in leaves.items():
    objs.append(join(f"leaf_{name}", parts, pivot))
for name, (parts, pivot) in thrusters.items():
    objs.append(join(f"thruster_{name}", parts, pivot))

tris = 0
for o in objs:
    q = sum(len(p.vertices) == 4 for p in o.data.polygons)
    t = sum(len(p.vertices) - 2 for p in o.data.polygons)
    tris += t
    print(f"{o.name}: {len(o.data.polygons)} faces, {q} quads, {t} tris")
print(f"TOTAL {tris} triangles")
model_io.save(os.path.splitext(out)[0] + ".glb", objs)
model_io.save(out, objs)
