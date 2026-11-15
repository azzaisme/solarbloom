"""Builds the base drone from clean shapes, matching the proportions of the Tripo drone-v2 the art
direction picked, but with exact material edges (every coloured part is its own smooth mesh, so
nothing bleeds or saw-tooths). All quads.

Parts (drone space: face +X, up +Z; body sphere centre C, radius R):
- shell: cube-sphere, pal_shell
- visor: a gently domed oval screen on the front. It is the `visor_eyes` object: dark glass with the
  eye sprite sheet as emission, UVs on frame 0 (u 0..0.25), so the game animates it as before.
- visor rim, belt, hatch rim: raised round gold trim (pal_gold, recoloured per role). The belt runs
  round the equator and ends inside the visor rim on both sides.
- hatch: dark disc on top (pal_darkFace)
- antenna: white stick with a red ball (pal_shell / pal_catRed), behind the hatch
- leaves: two paddle leaves on curved stems at the shoulders (pal_leafFin / pal_stem)
- thruster: a white nub underneath with a glowing cyan tip (pal_glass)

blender -b --python assets/tools/drone_build.py -- <eyes.png> <out.blend>   (also writes <out>.glb)
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model_io

eyes_png, out = (os.path.abspath(a) for a in sys.argv[sys.argv.index("--") + 1:][:2])

C, R = Vector((0, 0, -0.05)), 0.335       # body sphere, measured from the Tripo shell (least squares)
VISOR = dict(a=0.20, b=0.27, z=-0.045)    # half width / half height (tangent plane), centre height above C
VISOR_BULGE = 0.018
EYE_SQUARE, EYE_UP = 0.40, 0.065          # eye sheet frame covers this square, centred this far above
HATCH = dict(r=0.12, tilt=7)              # radius, tilt toward the front (degrees)
TRIM = 0.021                              # gold trim tube radius
BELT_H, BELT_LIFT = 0.075, 0.014


# ---------------------------------------------------------------- materials (Materials.ts PALETTE)
def srgb_to_linear(hexs):
    c = [int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1]


PAL = {"shell": ("#e9e6df", 0.45, 0, 0), "gold": ("#e7b54a", 0.3, 0.6, 0), "darkFace": ("#1d2633", 0.15, 0, 0),
       "leafFin": ("#7fd36a", 0.55, 0, 0), "stem": ("#3f9a3a", 0.6, 0, 0), "catRed": ("#e2483c", 0.4, 0, 0),
       "glass": ("#7fd6f0", 0.1, 0, 1.5)}


def mat(key):
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


def link(me, key=None):
    if key:
        me.materials.append(mat(key) if isinstance(key, str) else key)
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(me.name, me); bpy.context.scene.collection.objects.link(o)
    return o


# ---------------------------------------------------------------- shape helpers
def frame(axis, side=Vector((0, 1, 0))):
    """Orthonormal (A, U, V) with A the patch centre direction, U sideways, V 'up' along the surface."""
    a = axis.normalized()
    u = (side - a * side.dot(a)).normalized()
    return a, u, a.cross(u)


def on_sphere(fr, s, t, lift=0.0):
    a, u, v = fr
    return C + (a * R + u * s + v * t).normalized() * (R + lift)


def disk(X, Y):
    """Square grid -> unit disk (elliptical grid mapping): a patch of quads with no centre triangles."""
    return X * math.sqrt(1 - Y * Y / 2), Y * math.sqrt(1 - X * X / 2)


def patch(name, fr, a, b, lift_fn, key, n=16, uv=None):
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap") if uv else None
    ls, lt = bm.verts.layers.float.new("s"), bm.verts.layers.float.new("t")
    vs = []
    for j in range(n + 1):
        row = []
        for i in range(n + 1):
            X, Y = disk(-1 + 2 * i / n, -1 + 2 * j / n)
            v = bm.verts.new(on_sphere(fr, a * X, b * Y, lift_fn(X * X + Y * Y)))
            v[ls], v[lt] = a * X, b * Y
            row.append(v)
        vs.append(row)
    for j in range(n):
        for i in range(n):
            f = bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
            if uv:
                for l in f.loops:
                    l[uvl].uv = uv(l.vert[ls], l.vert[lt])
    bm.normal_update()
    if sum(f.normal.dot(f.calc_center_median() - C) for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    return link(me, key)


def tube(name, pts, radius, key, cyclic=False, taper=0.0):
    cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "3D"
    sp = cu.splines.new("POLY"); sp.points.add(len(pts) - 1); sp.use_cyclic_u = cyclic
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1)
        sp.points[i].radius = 1 - taper * i / max(1, len(pts) - 1)
    cu.bevel_depth = radius; cu.bevel_resolution = 3; cu.use_fill_caps = False
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


def blob(name, centre, size, key, rot=Matrix.Identity(4), cuts=3, shape=None):
    """Cube rounded into a sphere (all quads), optionally reshaped, then scaled/rotated/placed."""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    for v in bm.verts:
        v.co = v.co.normalized() * 0.5
        if shape:
            v.co = shape(v.co)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    me.transform(Matrix.Translation(Vector(centre)) @ rot @ Matrix.Diagonal((*(2 * s for s in size), 1)))
    return link(me, key)


# ---------------------------------------------------------------- build
bpy.ops.wm.read_factory_settings(use_empty=True)
parts = []

# shell
bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=13, use_grid_fill=True)
for v in bm.verts:
    v.co = C + v.co.normalized() * R
me = bpy.data.meshes.new("shell"); bm.to_mesh(me); bm.free()
parts.append(link(me, "shell"))

# visor screen = visor_eyes
vz = VISOR["z"]
vfr = frame(Vector((math.sqrt(R * R - vz * vz), 0, vz)))
eyes = bpy.data.materials.new("visor_eyes"); eyes.use_nodes = True
nt = eyes.node_tree; bsdf = nt.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.008, 0.02, 0.05, 1)
bsdf.inputs["Roughness"].default_value = 0.08
tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = bpy.data.images.load(eyes_png); tex.extension = "CLIP"
nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
bsdf.inputs["Emission Strength"].default_value = 1.0
visor = patch("visor_eyes", vfr, VISOR["a"], VISOR["b"], lambda q: 0.003 + VISOR_BULGE * (1 - q), eyes, n=20,
              uv=lambda s, t: ((0.5 + s / EYE_SQUARE) * 0.25, 0.5 + (t - EYE_UP) / EYE_SQUARE))


def ellipse(fr, a, b, lift, n=96):
    return [on_sphere(fr, a * math.cos(2 * math.pi * i / n), b * math.sin(2 * math.pi * i / n), lift)
            for i in range(n)]


parts.append(tube("visor_rim", ellipse(vfr, VISOR["a"], VISOR["b"], 0.006), TRIM, "gold", cyclic=True))

# hatch
th = math.radians(HATCH["tilt"])
hfr = frame(Vector((math.sin(th), 0, math.cos(th))), side=Vector((0, 1, 0)))
parts.append(patch("hatch", hfr, HATCH["r"], HATCH["r"], lambda q: 0.002 + 0.008 * (1 - q), "darkFace", n=10))
parts.append(tube("hatch_rim", ellipse(hfr, HATCH["r"], HATCH["r"], 0.004, 64), TRIM * 0.85, "gold", cyclic=True))


# belt: a band round the equator; each row ends where it meets the visor outline (under the rim)
def rho2(p):
    a, u, v = vfr
    d = (p - C).normalized()
    if d.dot(a) <= 0:
        return 99.0
    s, t = R * d.dot(u) / d.dot(a), R * d.dot(v) / d.dot(a)
    return (s / VISOR["a"]) ** 2 + (t / VISOR["b"]) ** 2


ROWS, COLS = 6, 120
bm = bmesh.new(); vs = []
for r in range(ROWS + 1):
    q = r / ROWS
    z = (q - 0.5) * BELT_H
    lift = BELT_LIFT * math.sin(math.pi * q) ** 0.6 - 0.003
    rr = math.sqrt(R * R - z * z)
    lo, hi = 0.0, math.pi                       # bisect for the azimuth where this row meets the outline
    for _ in range(40):
        mid = (lo + hi) / 2
        if rho2(C + Vector((rr * math.cos(mid), rr * math.sin(mid), z))) < 1:
            lo = mid
        else:
            hi = mid
    a0 = lo
    row = []
    for i in range(COLS + 1):
        az = a0 + (2 * math.pi - 2 * a0) * i / COLS
        n = Vector((math.cos(az) * rr, math.sin(az) * rr, z)).normalized()
        row.append(bm.verts.new(C + n * (R + lift)))
    vs.append(row)
for r in range(ROWS):
    for i in range(COLS):
        bm.faces.new((vs[r][i], vs[r][i + 1], vs[r + 1][i + 1], vs[r + 1][i]))
bm.normal_update()
if sum(f.normal.dot(f.calc_center_median() - C) for f in bm.faces) < 0:
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
me = bpy.data.meshes.new("belt"); bm.to_mesh(me); bm.free()
parts.append(link(me, "gold"))

# antenna, behind the hatch
d = Vector((-math.sin(math.radians(32)), 0.12, math.cos(math.radians(32)))).normalized()
foot = C + d * (R - 0.01)
tip = foot + Vector((-0.03, 0.0, 0.16))
parts.append(tube("antenna", [foot, foot + (tip - foot) * 0.5, tip], 0.009, "shell"))
parts.append(blob("antenna_foot", C + d * R, (0.03, 0.03, 0.015), "gold",
                  rot=Vector((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4(), cuts=2))
parts.append(blob("antenna_ball", tip + Vector((0, 0, 0.018)), (0.026, 0.026, 0.026), "catRed", cuts=2))


# leaves on stems at the shoulders
def leaf_shape(p):
    x = p.x + 0.5                                     # 0 at the stem end .. 1 at the tip
    w = 0.55 + 0.75 * x - 0.35 * x * x                # egg-shaped: widest past the middle
    y = p.y * w
    return Vector((x, y, p.z + 0.9 * y * y))          # slight cup


for side, rise in ((1, 18), (-1, 34)):                # a little asymmetric, like the reference
    base = C + Vector((0.0, 0.80 * side, 0.60)).normalized() * (R - 0.01)
    root = Vector((0.0, 0.30 * side, 0.235))
    rot = (Matrix.Rotation(math.radians(90 * side), 4, "Z")          # local +X -> outward (+-Y)
           @ Matrix.Rotation(math.radians(-rise), 4, "Y")            # tip up
           @ Matrix.Rotation(math.radians(8 * side), 4, "X"))
    out_dir = (rot.to_3x3() @ Vector((1, 0, 0))).normalized()
    # the stem runs on into the leaf so its open end is hidden inside
    parts.append(tube(f"stem{side}", [base, base.lerp(root, 0.5) + Vector((0, 0, 0.03)), root,
                                      root + out_dir * 0.05], 0.017, "stem", taper=0.3))
    parts.append(blob(f"leaf{side}", root - out_dir * 0.01, (0.15, 0.13, 0.024), "leafFin", rot=rot, cuts=4,
                      shape=leaf_shape))

# thruster underneath
parts.append(blob("thruster", C + Vector((0, 0, -R - 0.005)), (0.075, 0.075, 0.05), "shell", cuts=3))
parts.append(blob("thruster_glow", C + Vector((0, 0, -R - 0.05)), (0.05, 0.05, 0.02), "glass", cuts=3))

# join everything but the visor into drone_body
bpy.ops.object.select_all(action="DESELECT")
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
body = bpy.context.active_object
body.name = body.data.name = "drone_body"
for o in (body, visor):
    o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

for o in (body, visor):
    q = sum(len(p.vertices) == 4 for p in o.data.polygons)
    print(f"{o.name}: {len(o.data.polygons)} faces, {q} quads")
model_io.save(os.path.splitext(out)[0] + ".glb", [body, visor])
model_io.save(out, [body, visor])
