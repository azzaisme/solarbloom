"""Shared kit for the hand-built prop, machine and landmark models (build_props.py, prop_models.py).

Every model is built from clean shapes, like the drone: lathed profiles with rounded corners, bevelled boxes,
bevelled slabs cut from 2D outlines, and tubes. Every colour is its own flat palette material (pal_<key>), so colour
edges are exact geometry edges.

Conventions: Blender metres (1 tile = 1 m), up +Z, front -Y (glTF +Z), pivot at the base centre (the origin).
Quality: the global LOD switches every helper between the near model (LOD0: round, bevelled) and the far one
(LOD1: fewer segments, no rounding), so both are built from the same code and keep the same silhouette.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

LOD = 0

# Shared palette: src/rendering/Materials.ts PALETTE plus the spec's prop colours (kraft, iron, brass, copper,
# limestone are new keys). key: (hex, roughness, metallic, emission strength, alpha)
PAL = {
    "shell": ("#F5F3E8", 0.35, 0.0, 0, 1), "shellLow": ("#BEBBA7", 0.4, 0.1, 0, 1),
    "limestone": ("#E6DCC4", 0.6, 0.0, 0, 1), "limestoneDark": ("#CDBF9F", 0.65, 0.0, 0, 1),
    "sandstone": ("#DDBB8A", 0.75, 0.0, 0, 1), "sandstoneDark": ("#C39A6B", 0.8, 0.0, 0, 1),
    "sandstoneLight": ("#EAD3AE", 0.7, 0.0, 0, 1),
    "gold": ("#E8BA40", 0.28, 0.55, 0, 1), "copper": ("#C9774A", 0.35, 0.6, 0, 1),
    "darkFace": ("#101D26", 0.2, 0.0, 0, 1), "iron": ("#4E555E", 0.45, 0.55, 0, 1),
    "glass": ("#7FD6F0", 0.08, 0.0, 0.25, 0.35), "water": ("#4CC3EA", 0.1, 0.0, 0.4, 1),
    "coreGlow": ("#7CF7C8", 0.3, 0.0, 1.5, 1), "eyeCyan": ("#71F5FF", 0.25, 0.0, 2.0, 1),
    "leafFin": ("#A5D94D", 0.5, 0.0, 0, 1), "leafVein": ("#589D32", 0.55, 0.0, 0, 1),
    "stem": ("#3F9A3A", 0.6, 0.0, 0, 1), "moss": ("#7FA35A", 0.85, 0.0, 0, 1),
    "trunk": ("#8B6243", 0.7, 0.0, 0, 1), "kraft": ("#D6A86C", 0.65, 0.0, 0, 1),
    "soil": ("#8A6A4B", 0.95, 0.0, 0, 1), "soilDark": ("#6F533A", 0.95, 0.0, 0, 1),
    "rust": ("#A0623C", 0.6, 0.3, 0, 1), "concrete": ("#8D9196", 0.85, 0.0, 0, 1),
    "concreteDark": ("#5D6166", 0.85, 0.0, 0, 1), "catRed": ("#E2483C", 0.45, 0.0, 0, 1),
    "pink": ("#FF8FBF", 0.45, 0.0, 0, 1), "flowerCore": ("#FFE28A", 0.4, 0.0, 0, 1),
    "panel": ("#1E3A6B", 0.25, 0.2, 0, 1), "verdigris": ("#6FB3A0", 0.55, 0.2, 0, 1),
    "terracotta": ("#D9774E", 0.7, 0.0, 0, 1), "canvasRed": ("#E46A5A", 0.8, 0.0, 0, 1),
    "windowLit": ("#FFE6A6", 0.3, 0.0, 1.2, 1),
    "glassPale": ("#CFE6EC", 0.1, 0.0, 0, 1),
}


# ---------------------------------------------------------------- quality
def seg(n):
    """Segments round a circle: n near, about a third (at least 8) far."""
    return n if LOD == 0 else max(8, (n // 3 + 3) // 4 * 4)


def rnd(k):
    """Segments in a rounded corner or bevel: k near, none far."""
    return k if LOD == 0 else 0


# ---------------------------------------------------------------- materials
def srgb_to_linear(hexs):
    c = [int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1]


def mat(key):
    m = bpy.data.materials.get("pal_" + key)
    if m:
        return m
    hexs, rough, metal, glow, alpha = PAL[key]
    m = bpy.data.materials.new("pal_" + key); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = srgb_to_linear(hexs)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if glow:
        b.inputs["Emission Color"].default_value = srgb_to_linear(hexs)
        b.inputs["Emission Strength"].default_value = glow
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    return m


def _object(name, bm, keys, matrix=None):
    me = bpy.data.meshes.new(name)
    if matrix is not None:
        bm.transform(matrix)
    bm.to_mesh(me); bm.free()
    for k in keys:
        me.materials.append(mat(k))
    for p in me.polygons:
        p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(48))
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    return o


def place(loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    """A transform: location, Euler rotation in degrees (XYZ), uniform or (x, y, z) scale."""
    s = scale if isinstance(scale, (tuple, list)) else (scale,) * 3
    return Matrix.Translation(loc) @ _euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((*s, 1))


def _euler(rot):
    from mathutils import Euler
    return Euler([math.radians(a) for a in rot], "XYZ").to_quaternion()


# ---------------------------------------------------------------- profiles
def rounded(points):
    """Rounds the corners of a profile. points: (r, z, key, radius); key paints the band from the previous point
    to this one, radius rounds the corner at this point. Returns (r, z, key) points."""
    out = []
    for i, p in enumerate(points):
        r, z, key = p[0], p[1], p[2]
        rad = p[3] if len(p) > 3 else 0
        k = rnd(2 if rad > 0.02 else 1)
        if rad <= 0 or k == 0 or i == 0 or i == len(points) - 1:
            out.append((r, z, key)); continue
        a, b, c = Vector(points[i - 1][:2]), Vector((r, z)), Vector(points[i + 1][:2])
        u, v = (a - b), (c - b)
        lu, lv = u.length, v.length
        if lu < 1e-6 or lv < 1e-6:
            out.append((r, z, key)); continue
        u.normalize(); v.normalize()
        d = min(rad, lu * 0.45, lv * 0.45)
        p0, p2 = b + u * d, b + v * d
        nkey = points[i + 1][2]
        for j in range(k + 2):          # quadratic Bezier from p0 through the corner to p2
            t = j / (k + 1)
            q = (1 - t) ** 2 * p0 + 2 * (1 - t) * t * b + t * t * p2
            out.append((max(q.x, 0.0), q.y, key if t <= 0.5 else nkey))
    return out


def lathe(name, points, n=32, matrix=None, radial=None, closed=False, start=0.0, angles=None, paint=None):
    """Surface of revolution round +Z. points: profile (r, z, key[, corner radius]) from one end to the other
    (r = 0 ends close as a pole). radial(theta, z) scales r per angle (grooves, stave edges); angles: explicit
    angles instead of n even steps; paint(theta, z, key) can repaint a face (stave lines)."""
    pts = rounded(points)
    keys = []
    for p in pts:
        if p[2] not in keys:
            keys.append(p[2])
    thetas = list(angles) if angles else [start + 2 * math.pi * i / seg(n) for i in range(seg(n))]
    n = len(thetas)
    bm = bmesh.new()
    rings = []
    for r, z, _ in pts:
        if r < 1e-5:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            ring = []
            for i in range(n):
                t = thetas[i]
                rr = r * (radial(t, z) if radial else 1)
                ring.append(bm.verts.new((rr * math.cos(t), rr * math.sin(t), z)))
            rings.append(ring)
    pairs = list(zip(range(len(pts) - 1), range(1, len(pts))))
    if closed:
        pairs.append((len(pts) - 1, 0))
    for i0, i1 in pairs:
        a, b = rings[i0], rings[i1]
        mi = keys.index(pts[i1][2])
        for i in range(n):
            j = (i + 1) % n
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                f = bm.faces.new((a[0], b[j], b[i]))
            elif len(b) == 1:
                f = bm.faces.new((a[i], a[j], b[0]))
            else:
                f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.material_index = mi
            if paint:
                t1 = thetas[j] if j else thetas[0] + 2 * math.pi
                k = paint((thetas[i] + t1) / 2, (pts[i0][1] + pts[i1][1]) / 2, pts[i1][2])
                if k not in keys:
                    keys.append(k)
                f.material_index = keys.index(k)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _object(name, bm, keys, matrix)


def torus(name, R, r, key, matrix=None, n=32, m=12):
    pts = [(R + r * math.cos(2 * math.pi * i / seg(m)), r * math.sin(2 * math.pi * i / seg(m)), key)
           for i in range(seg(m))]
    return lathe(name, pts, n, matrix, closed=True)


def cyl(name, r, h, key, matrix=None, n=32, bevel=0.01, top=None, bottom=None):
    """A closed cylinder from z = 0 to h with soft edges; top / bottom keys paint the caps."""
    top, bottom = top or key, bottom or key
    return lathe(name, [(0, 0, bottom), (r, 0, bottom, bevel), (r, h, key, bevel), (0, h, top)], n, matrix)


def sphere(name, r, key, matrix=None, n=24, squash=1.0):
    k = max(4, seg(n) // 2)
    pts = [(r * math.sin(math.pi * i / k), -r * squash * math.cos(math.pi * i / k), key) for i in range(k + 1)]
    return lathe(name, pts, n, matrix)


# ---------------------------------------------------------------- boxes and slabs
def box(name, size, key, matrix=None, bevel=0.02, keys=None):
    """A box centred on the origin with rounded edges. keys: optional per-side keys {'top','bottom','sides'}."""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bm.transform(Matrix.Diagonal((*size, 1)))
    used = [key]
    if keys:
        for f in bm.faces:
            nz = f.normal.z
            k = keys.get("top" if nz > 0.5 else "bottom" if nz < -0.5 else "sides", key)
            if k not in used:
                used.append(k)
            f.material_index = used.index(k)
    if bevel > 0 and rnd(2):
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, min(size) * 0.45), offset_type="OFFSET",
                        segments=rnd(2), profile=0.5, affect="EDGES", clamp_overlap=True)
    return _object(name, bm, used, matrix)


def slab(name, outline, depth, key, matrix=None, bevel=0.01, side=None):
    """A flat shape from a 2D outline (x, y) in the XZ plane, depth along +Y centred on 0, with rounded edges.
    side: optional key for the rim."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, -depth / 2, y)) for x, y in outline]
    f = bm.faces.new(vs)
    f.normal_update()
    if f.normal.y > 0:
        f.normal_flip()
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    nv = [g for g in r["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, depth, 0), verts=nv)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    used = [key]
    if side:
        used.append(side)
        for fc in bm.faces:
            if abs(fc.normal.y) < 0.5:
                fc.material_index = 1
    if bevel > 0 and rnd(2):
        rim = [e for e in bm.edges if len(e.link_faces) == 2 and
               (abs(e.link_faces[0].normal.y) > 0.5) != (abs(e.link_faces[1].normal.y) > 0.5)]
        bmesh.ops.bevel(bm, geom=rim, offset=bevel, offset_type="OFFSET", segments=rnd(2), profile=0.5,
                        affect="EDGES", clamp_overlap=True)
    bmesh.ops.triangulate(bm, faces=[fc for fc in bm.faces if len(fc.verts) > 4 and _concave(fc)])
    return _object(name, bm, used, matrix)


def _concave(f):
    n = f.normal
    vs = [v.co for v in f.verts]
    for i in range(len(vs)):
        if (vs[i] - vs[i - 1]).cross(vs[(i + 1) % len(vs)] - vs[i]).dot(n) < -1e-9:
            return True
    return False


def frame(name, outer, inner, depth, key, matrix=None, bevel=0.01):
    """A flat ring between two outlines with the same point count (an arch, a window frame), XZ plane,
    depth along Y centred on 0."""
    bm = bmesh.new()
    h = depth / 2
    of = [bm.verts.new((x, -h, y)) for x, y in outer]; ob = [bm.verts.new((x, h, y)) for x, y in outer]
    inf = [bm.verts.new((x, -h, y)) for x, y in inner]; ib = [bm.verts.new((x, h, y)) for x, y in inner]
    n = len(outer)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((of[i], of[j], inf[j], inf[i]))      # front
        bm.faces.new((ob[j], ob[i], ib[i], ib[j]))        # back
        bm.faces.new((of[j], of[i], ob[i], ob[j]))        # outer wall
        bm.faces.new((inf[i], inf[j], ib[j], ib[i]))      # inner wall
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bevel > 0 and rnd(2):
        rim = [e for e in bm.edges if len(e.link_faces) == 2 and
               abs(e.link_faces[0].normal.dot(e.link_faces[1].normal)) < 0.5]
        bmesh.ops.bevel(bm, geom=rim, offset=bevel, offset_type="OFFSET", segments=rnd(2), profile=0.5,
                        affect="EDGES", clamp_overlap=True)
    return _object(name, bm, [key], matrix)


def arch_outline(w, h, n=24, base=0.0):
    """A round-topped arch outline (x, y): straight sides from base, a half circle on top, counter-clockwise
    from the bottom right."""
    r = w / 2
    n = max(6, seg(n))
    pts = [(r, base), (r, h - r)]
    for i in range(1, n):
        a = math.pi * i / n
        pts.append((r * math.cos(a), h - r + r * math.sin(a)))
    pts += [(-r, h - r), (-r, base)]
    return pts


def rounded_rect(w, h, rad, n=4, cx=0.0, cy=0.0):
    """A rounded rectangle outline, counter-clockwise."""
    k = max(1, rnd(n)) if rad > 0 else 0
    pts = []
    for (sx, sy, a0) in ((1, -1, -90), (1, 1, 0), (-1, 1, 90), (-1, -1, 180)):
        ccx, ccy = cx + sx * (w / 2 - rad), cy + sy * (h / 2 - rad)
        if k == 0:
            pts.append((cx + sx * w / 2, cy + sy * h / 2)); continue
        for i in range(k + 1):
            a = math.radians(a0 + 90 * i / k)
            pts.append((ccx + rad * math.cos(a), ccy + rad * math.sin(a)))
    return pts


# ---------------------------------------------------------------- tubes
def tube(name, pts, radius, key, n=12, taper=0.0, caps=True):
    """A round tube through 3D points (a pipe, a rail, a curled iron leg)."""
    cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "3D"
    sp = cu.splines.new("POLY"); sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1)
        sp.points[i].radius = 1 - taper * i / max(1, len(pts) - 1)
    cu.bevel_depth = radius; cu.bevel_resolution = max(1, seg(n) // 4 - 1); cu.use_fill_caps = caps
    o = bpy.data.objects.new(name, cu); bpy.context.scene.collection.objects.link(o)
    _select(o)
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.active_object
    o.data.materials.clear(); o.data.materials.append(mat(key))
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.set_sharp_from_angle(angle=math.radians(48))
    return o


def smooth_path(ctrl, per=3):
    """Catmull-Rom points through control points (per points per span; fewer far)."""
    per = per if LOD == 0 else max(1, per // 2)
    c = [Vector(p) for p in ctrl]
    c = [c[0]] + c + [c[-1]]
    out = []
    for i in range(1, len(c) - 2):
        p0, p1, p2, p3 = c[i - 1], c[i], c[i + 1], c[i + 2]
        for j in range(per):
            t = j / per
            out.append(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(c[-2])
    return [tuple(p) for p in out]


# ---------------------------------------------------------------- assembly
def _select(o):
    for x in bpy.context.scene.objects:
        x.select_set(x is o)
    bpy.context.view_layer.objects.active = o


def join(name, objs, pivot=(0, 0, 0)):
    """Joins objects into one part with its origin at pivot (world)."""
    objs = [o for o in objs if o]
    for x in bpy.context.scene.objects:
        x.select_set(x in objs)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = o.data.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o.data.transform(Matrix.Translation(-Vector(pivot)))
    o.location = pivot
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(o.data); bm.free()
    # drop unused material slots
    used = {p.material_index for p in o.data.polygons}
    for i in reversed(range(len(o.data.materials))):
        if i not in used:
            o.data.materials.pop(index=i)
    return o


def mirror_x(objs):
    """Copies of objects mirrored across X (a model's right side from its left)."""
    out = []
    for o in objs:
        c = o.copy(); c.data = o.data.copy(); bpy.context.scene.collection.objects.link(c)
        c.data.transform(Matrix.Diagonal((-1, 1, 1, 1)) @ o.matrix_world)
        c.matrix_world = Matrix.Identity(4)
        c.data.flip_normals()
        out.append(c)
    return out


def array_round(objs, count, start=0.0):
    """Copies of objects turned evenly round +Z (count in total, the originals stay as the first)."""
    out = list(objs)
    for k in range(1, count):
        R = Matrix.Rotation(start + 2 * math.pi * k / count, 4, "Z")
        for o in objs:
            c = o.copy(); c.data = o.data.copy(); bpy.context.scene.collection.objects.link(c)
            c.data.transform(R @ o.matrix_world); c.matrix_world = Matrix.Identity(4)
            out.append(c)
    return out


def tri_count(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
