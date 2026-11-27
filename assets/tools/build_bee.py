"""The bumblebee, modelled by hand in quads (its Tripo model lost its stripes when cut down to the budget).

A round body turned on a lathe: each stripe is a band between two rings, so the stripes stay crisp at any level of
detail. Golden Yellow and Dark Brown stripes, Cream wings, Dark Brown legs and antennae, and the shared round glossy
Charcoal eyes from tripo_critter.py. Metres, up +Z, front -Y, feet at the origin; LOD0 and LOD1 like the others.

    blender -b --factory-startup -P assets/tools/build_bee.py -- <out_dir>
Then rig it: rig_animals.py <out_dir> bumblebee
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tripo_critter as tc  # noqa: E402

LENGTH = 0.12            # longest side, as VISITOR_LOOK has it (the game scales to that anyway)
AXIS_Z = 0.62            # the body's axis above the feet (model units, before scaling)

# stripes along the body, front to back: (from y, to y, colour); the head is yellow, the tail tip brown
STRIPES = [(-1.0, -0.30, "golden_yellow"), (-0.30, -0.12, "dark_brown"), (-0.12, 0.04, "golden_yellow"),
           (0.04, 0.20, "dark_brown"), (0.20, 0.36, "golden_yellow"), (0.36, 0.52, "dark_brown"),
           (0.52, 0.62, "golden_yellow"), (0.62, 1.0, "dark_brown")]
HEAD_C, HEAD_R = Vector((0, -0.50, AXIS_Z + 0.02)), 0.25
BODY_C, BODY_HALF, BODY_R = 0.20, 0.52, 0.45


def radius(y):
    """The lathe profile: the round head and the plump body, whichever is wider there."""
    h = HEAD_R ** 2 - (y - HEAD_C.y) ** 2
    b = 1 - ((y - BODY_C) / BODY_HALF) ** 2
    return max(math.sqrt(h) if h > 0 else 0.0, BODY_R * math.sqrt(b) if b > 0 else 0.0)


def stripe(y):
    return next(c for a, b, c in STRIPES if a <= y < b)


def build(lod1):
    segs = 8 if lod1 else 10
    head = [-0.68, -0.56, -0.44, -0.34] if not lod1 else [-0.68, -0.54, -0.40]
    body = [-0.30, -0.12, -0.04, 0.04, 0.12, 0.20, 0.28, 0.36, 0.44, 0.52, 0.62, 0.68] if not lod1 else \
        [-0.30, -0.12, 0.04, 0.20, 0.36, 0.52, 0.62]
    rings = head + body
    front, back = HEAD_C.y - HEAD_R, BODY_C + BODY_HALF
    bm = bmesh.new()
    cls = []

    def axis_z(y):           # the head sits a touch higher, as in the picture
        return AXIS_Z + 0.02 * max(0.0, min(1.0, (-0.30 - y) / 0.2))

    # body and head: one lathe, poles at the nose and the tail
    nose = bm.verts.new((0, front, axis_z(front)))
    tail = bm.verts.new((0, back, AXIS_Z))
    grid = []
    for y in rings:
        r = radius(y)
        grid.append([bm.verts.new((r * math.sin(2 * math.pi * s / segs), y,
                                   axis_z(y) + r * math.cos(2 * math.pi * s / segs))) for s in range(segs)])
    for s in range(segs):
        s2 = (s + 1) % segs
        bm.faces.new((nose, grid[0][s], grid[0][s2])); cls.append(stripe(front))
        for i in range(len(rings) - 1):
            bm.faces.new((grid[i][s], grid[i + 1][s], grid[i + 1][s2], grid[i][s2]))
            cls.append(stripe((rings[i] + rings[i + 1]) / 2))
        bm.faces.new((grid[-1][s], tail, grid[-1][s2])); cls.append(stripe(back - 1e-3))
    smooth = set(range(len(cls)))

    def tube(points, r, sides, colour, cap_ball=0.0):
        """A small bent tube through `points` (legs, antennae), closed at the far end, optionally with a ball."""
        rows = []
        for k, p in enumerate(points):
            d = (points[min(k + 1, len(points) - 1)] - points[max(k - 1, 0)]).normalized()
            t = d.orthogonal().normalized()
            b = d.cross(t)
            rows.append([bm.verts.new(p + (t * math.cos(2 * math.pi * s / sides) + b * math.sin(2 * math.pi * s / sides)) * r)
                         for s in range(sides)])
        for k in range(len(rows) - 1):
            for s in range(sides):
                s2 = (s + 1) % sides
                bm.faces.new((rows[k][s], rows[k][s2], rows[k + 1][s2], rows[k + 1][s]))
                cls.append(colour); smooth.add(len(cls) - 1)
        end = bm.verts.new(points[-1] + (points[-1] - points[-2]).normalized() * r * 0.6)
        for s in range(sides):
            bm.faces.new((rows[-1][s], rows[-1][(s + 1) % sides], end)); cls.append(colour); smooth.add(len(cls) - 1)
        if cap_ball:
            c = points[-1] + (points[-1] - points[-2]).normalized() * cap_ball
            n, m = (4, 3) if lod1 else (5, 3)
            top, bot = bm.verts.new(c + Vector((0, 0, cap_ball))), bm.verts.new(c - Vector((0, 0, cap_ball)))
            lat = [[bm.verts.new(c + Vector((math.cos(2 * math.pi * s / n) * math.sin(math.pi * i / m),
                                             math.sin(2 * math.pi * s / n) * math.sin(math.pi * i / m),
                                             math.cos(math.pi * i / m))) * cap_ball) for s in range(n)] for i in range(1, m)]
            for s in range(n):
                s2 = (s + 1) % n
                bm.faces.new((top, lat[0][s], lat[0][s2])); cls.append(colour); smooth.add(len(cls) - 1)
                bm.faces.new((bot, lat[-1][s2], lat[-1][s])); cls.append(colour); smooth.add(len(cls) - 1)
                for i in range(len(lat) - 1):
                    bm.faces.new((lat[i][s], lat[i + 1][s], lat[i + 1][s2], lat[i][s2]))
                    cls.append(colour); smooth.add(len(cls) - 1)

    sides = 3
    # six legs from the underside, bent at the knee, feet on the ground
    for side in (-1, 1):
        for y in (-0.16, 0.04, 0.24):
            hip = Vector((side * 0.16, y, AXIS_Z - radius(y) * 0.80))
            knee = Vector((side * 0.30, y + 0.02, 0.16))
            foot = Vector((side * 0.34, y + 0.06, 0.03))
            tube([hip, foot] if lod1 else [hip, knee, foot], 0.035, sides, "dark_brown")
    # antennae: up and forward off the top of the head, little balls on the ends
    for side in (-1, 1):
        root = HEAD_C + Vector((side * 0.08, -0.06, HEAD_R * 0.92))
        mid = root + Vector((side * 0.06, -0.08, 0.16))
        tip = mid + Vector((side * 0.06, -0.10, 0.10))
        tube([root, tip] if lod1 else [root, mid, tip], 0.022, sides, "dark_brown", cap_ball=0.045)

    # wings: flat Cream ovals on the back, rising up and out; two-sided (a face each way, a hair apart)
    wn = 8
    for side in (-1, 1):
        hinge = Vector((side * 0.10, 0.02, AXIS_Z + radius(0.02) * 0.92))
        along = Vector((side * 0.55, 0.30, 0.78)).normalized()      # hinge to tip
        across = Vector((0, 1, -0.38)).normalized()                  # the wing's width runs front to back
        across = (across - along * across.dot(along)).normalized()
        n = along.cross(across).normalized()
        half_l, half_w = 0.40, 0.24
        c = hinge + along * half_l
        for flip in (1, -1):
            ring = [bm.verts.new(c + along * half_l * math.cos(2 * math.pi * k / wn)
                                 + across * half_w * math.sin(2 * math.pi * k / wn) + n * flip * 0.004)
                    for k in range(wn)]
            bm.faces.new(ring if flip > 0 else list(reversed(ring)))
            cls.append("cream")

    me = bpy.data.meshes.new("bumblebee")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = p.index in smooth
    ob = bpy.data.objects.new("bumblebee", me)
    bpy.context.scene.collection.objects.link(ob)
    bmo = bmesh.new(); bmo.from_mesh(me)
    bmesh.ops.recalc_face_normals(bmo, faces=[f for f in bmo.faces if f.index in smooth])
    bmo.to_mesh(me); bmo.free()

    # eyes: big, round and glossy, on the sides of the head looking forward
    specs = []
    for side in (-1, 1):
        d = Vector((side * 0.62, -0.68, 0.22)).normalized()
        specs.append((HEAD_C + d * HEAD_R, d, 0.085))
    cls = cls + tc.add_eyes(me, specs, lod1)

    # to metres, feet at the origin, longest side LENGTH
    vs = [v.co for v in me.vertices]
    lo = Vector([min(v[i] for v in vs) for i in range(3)]); hi = Vector([max(v[i] for v in vs) for i in range(3)])
    me.transform(Matrix.Translation(Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))))
    me.transform(Matrix.Scale(LENGTH / max(hi - lo), 4))
    me.update()
    tc.paint(me, cls)
    me.materials.append(tc.material("bumblebee"))
    me.materials.append(tc.material("bumblebee-eyes", 0.12))
    return ob


if __name__ == "__main__":
    out_dir = sys.argv[sys.argv.index("--") + 1]
    for lod1, suffix in ((False, ""), (True, ".lod1")):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        ob = build(lod1)
        quads = sum(1 for p in ob.data.polygons if len(p.vertices) == 4)
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        path = os.path.join(out_dir, "bumblebee" + suffix + ".glb")
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                                  export_vertex_color="MATERIAL", export_normals=True)
        print("[bee]", suffix or "lod0", "faces", len(ob.data.polygons), "quads", quads, "tris", tris, flush=True)
