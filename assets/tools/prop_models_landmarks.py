"""Landmarks, hand-built with prop_kit (see prop_models.py for the conventions): dry fountain, bandstand, signal
mast, clock tower, lock gate, market hall, old cistern. Shape guides: assets/raw/tripo/models/<name>.preview.webp.

Colour: cream / limestone walls over sandstone bases, steps, ledges and trims; gold only for small accents
(thin rims, finials, fittings).
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import prop_kit as K
from prop_kit import box, cyl, frame, lathe, place, slab, sphere
from prop_models import model, leaf_outline

L, LD, S = "limestone", "limestoneDark", "shell"
SS, SD, SL = "sandstone", "sandstoneDark", "sandstoneLight"
G, V = "gold", "verdigris"


# ---------------------------------------------------------------- helpers
def cbox(name, size, key, matrix=None, bevel=0.02, keys=None):
    """A cheap box: one chamfer segment on every edge (near), sharp (far). Smooth-shaded, so it still reads soft."""
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
    if bevel > 0 and K.LOD == 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, min(size) * 0.45), offset_type="OFFSET",
                        segments=1, profile=0.5, affect="EDGES", clamp_overlap=True)
    return K._object(name, bm, used, matrix)


def ltorus(name, R, r, key, matrix=None, n=24, m=6, n1=10, m1=4):
    """A torus with explicit segment counts near (n, m) and far (n1, m1)."""
    nn, mm = (n, m) if K.LOD == 0 else (n1, m1)
    pts = [(R + r * math.cos(2 * math.pi * i / mm), r * math.sin(2 * math.pi * i / mm), key) for i in range(mm)]
    return lathe(name, pts, matrix=matrix, closed=True, angles=[2 * math.pi * k / nn for k in range(nn)])


def ltube(name, pts, radius, key, res=1, res1=0, caps=True):
    """prop_kit.tube with an explicit bevel resolution near (res) and far (res1): 0 is a 4-sided bar."""
    cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "3D"
    sp = cu.splines.new("POLY"); sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1)
    cu.bevel_depth = radius; cu.bevel_resolution = res if K.LOD == 0 else res1; cu.use_fill_caps = caps
    o = bpy.data.objects.new(name, cu); bpy.context.scene.collection.objects.link(o)
    K._select(o)
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.active_object
    o.data.materials.clear(); o.data.materials.append(K.mat(key))
    for f in o.data.polygons:
        f.use_smooth = True
    o.data.set_sharp_from_angle(angle=math.radians(48))
    return o


def turn(objs, deg):
    """Turns objects round +Z in place (bakes the turn into the mesh)."""
    R = Matrix.Rotation(math.radians(deg), 4, "Z")
    for o in objs:
        o.data.transform(R @ o.matrix_world); o.matrix_world = Matrix.Identity(4)
    return objs


def turned(p, deg):
    return tuple(Matrix.Rotation(math.radians(deg), 3, "Z") @ Vector(p))


def notch(r, z, stone, joint, d=0.016, h=0.036):
    """A horizontal mortar groove in an upward wall profile at height z (near version only)."""
    if K.LOD:
        return []
    return [(r, z - h / 2, stone), (r - d, z - h / 4, joint), (r - d, z + h / 4, joint), (r, z + h / 2, joint)]


def coursed(name, pts, blocks, bands, matrix=None, gap=0.04, stone=L, joint=LD, fine=1):
    """A lathe of stone courses: within each band (z0, z1) the stone faces get vertical joints, staggered by
    half a block from one course to the next. Far version: a plain lathe."""
    if K.LOD:
        return lathe(name, pts, n=blocks * 2, matrix=matrix)
    step = 2 * math.pi / blocks
    g = step * gap
    angles = []
    for k in range(2 * blocks):
        a = k * step / 2
        angles += [a, a + g] + [a + g + (step / 2 - g) * j / (fine + 1) for j in range(1, fine + 1)]

    def paint(t, z, key):
        if key != stone:
            return key
        for i, (z0, z1) in enumerate(bands):
            if z0 < z < z1:
                off = 0 if i % 2 == 0 else step / 2
                if (t - off) % step < g:
                    return joint
        return key
    return lathe(name, pts, angles=angles, paint=paint, matrix=matrix)


def stone_wall_profile(r, z0, z1, courses, stone=L, joint=LD):
    """Upward outer-wall profile from z0 to z1 with mortar grooves between courses; returns (pts, bands)."""
    h = (z1 - z0) / courses
    pts, bands = [(r, z0, stone)], []
    for i in range(1, courses):
        pts += notch(r, z0 + i * h, stone, joint)
    pts.append((r, z1, stone))
    for i in range(courses):
        bands.append((z0 + i * h + 0.02, z0 + (i + 1) * h - 0.02))
    return pts, bands


def gear_outline(ro, ri, teeth):
    pts = []
    s = 2 * math.pi / teeth
    for k in range(teeth):
        a = k * s
        for f, r in ((0.0, ri), (0.15, ro), (0.4, ro), (0.55, ri)):
            pts.append((r * math.cos(a + f * s), r * math.sin(a + f * s)))
    return pts


def arc_pts(R, z, a0, a1, n):
    n = max(2, n if K.LOD == 0 else n // 2)
    return [(R * math.cos(a0 + (a1 - a0) * i / n), R * math.sin(a0 + (a1 - a0) * i / n), z) for i in range(n + 1)]


def finial(z, h, key=G, r=0.1, n=16):
    """A gold teardrop finial on a short collar, base at z, height h."""
    if K.LOD:
        return lathe("finial", [(0, z, key), (r * 0.9, z, key), (r * 0.45, z + h * 0.25, key),
                                (r, z + h * 0.5, key), (0, z + h, key)], n=8)
    return lathe("finial", [(0, z, key), (r * 0.9, z, key, 0.01), (r * 0.9, z + h * 0.12, key, 0.01),
                            (r * 0.45, z + h * 0.2, key), (r * 0.45, z + h * 0.3, key),
                            (r, z + h * 0.5, key, 0.02), (r * 0.8, z + h * 0.72, key, 0.02),
                            (r * 0.2, z + h * 0.94, key), (0, z + h, key)], n=n)


# ================================================================ dry fountain
@model("dry-fountain", "landmark")
def dry_fountain():
    wall, bands = stone_wall_profile(1.62, 0.17, 0.60, 2)
    f = [lathe("plinth", [(0, 0, SD), (1.70, 0, SD, 0.02), (1.70, 0.14, SS, 0.02), (1.60, 0.17, SS),
                          (0, 0.17, SS)], n=48),
         coursed("basinWall", wall + [(1.60, 0.60, L)], 18, bands, fine=0),
         # rim, inner wall and floor (kept clean for the procedural water)
         lathe("basinRim", [(0, 0.26, SL), (1.36, 0.26, SL, 0.02), (1.39, 0.72, L, 0.02), (1.45, 0.80, L, 0.02),
                            (1.63, 0.80, L, 0.02), (1.70, 0.74, L, 0.02), (1.66, 0.66, L), (1.61, 0.58, L),
                            (0, 0.58, L)], n=48),
         ltorus("goldLine", 1.635, 0.02, G, place((0, 0, 0.635)), n=48, m=6, n1=16, m1=3),
         lathe("pedBase", [(0, 0.24, SS), (0.54, 0.24, SS, 0.02), (0.54, 0.38, SS, 0.02), (0.46, 0.40, SS),
                           (0.44, 0.45, L, 0.02), (0.36, 0.48, L), (0, 0.48, L)], n=32)]
    flutes = 12

    def flute(t, z):
        return 1.0 if K.LOD or not (0.52 < z < 1.38) else 1 - 0.1 * max(0.0, math.cos(flutes * t)) ** 2
    f.append(lathe("shaft", [(0, 0.46, L), (0.31, 0.46, L), (0.31, 0.49, L), (0.30, 0.52, L),
                             (0.28, 1.38, L), (0.29, 1.42, L), (0, 1.42, L)], n=48, radial=flute))
    f.append(lathe("capital", [(0, 1.40, SS), (0.32, 1.40, SS, 0.015), (0.34, 1.46, SS, 0.015),
                               (0.31, 1.49, SS), (0.30, 1.50, G), (0.30, 1.52, G), (0.38, 1.60, SS, 0.02),
                               (0, 1.60, SS)], n=32))
    f.append(lathe("bowl", [(0, 1.58, L), (0.30, 1.58, L, 0.02), (0.60, 1.70, L, 0.05), (0.80, 1.82, SS, 0.02),
                            (0.85, 1.85, SS), (0.85, 1.92, SS), (0.82, 1.94, L),
                            (0.87, 2.03, L, 0.02), (0.85, 2.07, G), (0.75, 2.07, G),
                            (0.72, 2.01, L, 0.02), (0.58, 1.90, L, 0.05), (0, 1.86, L)], n=40))
    f.append(lathe("spout", [(0, 1.86, G), (0.09, 1.86, G), (0.06, 1.93, G), (0.05, 1.98, G),
                             (0.08, 2.01, G, 0.015), (0.05, 2.06, G), (0, 2.08, G)], n=12))
    return {"fountain": f}


# ================================================================ bandstand
@model("bandstand", "landmark")
def bandstand():
    parts = [lathe("platform", [(0, 0.45, S), (1.42, 0.45, S, 0.02), (1.47, 0.41, S), (1.47, 0.37, SS),
                                (1.49, 0.35, SS), (1.49, 0.10, SS, 0.02), (1.53, 0.08, SD, 0.02),
                                (1.53, 0, SD), (0, 0, SD)], n=48),
             cyl("inlay", 0.62, 0.01, SL, place((0, 0, 0.445)), n=24, bevel=0.0)]
    if K.LOD == 0:
        parts.append(ltorus("inlayRing", 0.62, 0.016, G, place((0, 0, 0.455)), n=24, m=4))
    # three steps at the front
    for k, (top, fy) in enumerate(((0.12, -1.90), (0.235, -1.75), (0.35, -1.60))):
        d = -1.0 - fy
        parts.append(box("step", (1.15 - 0.06 * k, d, top), SS, place((0, fy + d / 2, top / 2)), bevel=0.025,
                         keys={"top": SL}))
    # six columns, open bay at the front
    ang = [math.radians(a) for a in (-60, 0, 60, 120, 180, 240)]
    Rc = 1.2
    if K.LOD == 0:
        col = [(0, 0.45, SS), (0.19, 0.45, SS), (0.19, 0.62, SS, 0.02), (0.15, 0.64, S),
               (0.14, 0.98, S), (0.155, 0.99, G), (0.155, 1.03, G), (0.14, 1.04, S),
               (0.13, 1.92, S), (0.18, 2.02, SL), (0.19, 2.12, SL), (0, 2.12, SL)]
    else:
        col = [(0, 0.45, SS), (0.19, 0.45, SS), (0.19, 0.62, SS), (0.14, 0.64, S), (0.13, 1.95, S),
               (0.19, 2.12, SL), (0, 2.12, SL)]
    for a in ang:
        parts.append(lathe("column", col, n=12, matrix=place((Rc * math.cos(a), Rc * math.sin(a), 0))))
    # railing on the five closed bays
    for i in range(5):
        a0, a1 = ang[i] + 0.14, ang[i + 1] - 0.14
        parts.append(ltube("rail", arc_pts(Rc, 1.0, a0, a1, 6), 0.04, SS))
        nb = 3 if K.LOD == 0 else 0
        for j in range(nb):
            t = a0 + (a1 - a0) * (j + 1) / (nb + 1)
            parts.append(lathe("baluster", [(0.04, 0.45, S), (0.025, 0.55, S), (0.032, 0.75, S),
                                            (0.025, 0.96, S)], n=6,
                               matrix=place((Rc * math.cos(t), Rc * math.sin(t), 0))))
    # ring beam and roof
    parts.append(lathe("beam", [(1.04, 2.36, S), (1.04, 2.10, S), (1.38, 2.10, SS, 0.02),
                                (1.38, 2.20, SS), (1.36, 2.22, S), (1.36, 2.36, S)], n=48, closed=True))
    nd = 8 if K.LOD == 0 else 4
    dome = [(1.42 * math.cos(a), 2.50 + 0.62 * math.sin(a), V)
            for a in [math.pi / 2 * i / nd for i in range(1, nd)]]
    parts.append(lathe("roof", [(0, 2.42, S), (1.36, 2.36, S), (1.55, 2.36, SS, 0.02), (1.57, 2.48, SS, 0.02),
                                (1.45, 2.50, V)] + dome + [(0, 3.12, V)], n=48))
    parts.append(finial(3.06, 0.5, r=0.13))
    if K.LOD == 0:
        for k in range(8):
            a = 2 * math.pi * k / 8 + math.pi / 8
            pts = [(1.445 * math.cos(b) * math.cos(a), 1.445 * math.cos(b) * math.sin(a),
                    2.50 + 0.645 * math.sin(b)) for b in [math.pi / 2 * i / 8 for i in range(0, 8)]]
            parts.append(ltube("rib", pts, 0.03, S))
    return {"bandstand": parts}


# ================================================================ signal mast
@model("signal-mast", "landmark")
def signal_mast():
    body = [box("plinth", (1.0, 1.0, 0.12), SD, place((0, 0, 0.06)), bevel=0.03),
            box("step", (0.86, 0.86, 0.12), SS, place((0, 0, 0.18)), bevel=0.03),
            box("pedestal", (0.66, 0.66, 0.46), S, place((0, 0, 0.47)), bevel=0.04),
            box("band", (0.70, 0.70, 0.07), SS, place((0, 0, 0.67)), bevel=0.02),
            box("pedCap", (0.62, 0.62, 0.08), S, place((0, 0, 0.75)), bevel=0.025)]
    if K.LOD == 0:      # panel on the pedestal faces
        for k in range(4):
            body += turn([cbox("panel", (0.4, 0.02, 0.26), SL, place((0, -0.335, 0.46)), bevel=0.008)], 90 * k)
    z0, z1, secs = 0.79, 3.70, 5

    def half(z):
        return 0.25 - 0.08 * (z - z0) / (z1 - z0)
    corners = ((-1, -1), (1, -1), (1, 1), (-1, 1))
    for sx, sy in corners:
        body.append(ltube("post", [(sx * half(z0), sy * half(z0), z0), (sx * half(z1), sy * half(z1), z1)],
                          0.05, S, res=1, res1=1))
    for i in range(secs + 1):
        z = z0 + (z1 - z0) * i / secs
        h = half(z)
        if 0 < i < secs and (K.LOD == 0 or i % 2):
            for c in range(4):
                (ax, ay), (bx, by) = corners[c], corners[(c + 1) % 4]
                body.append(ltube("bar", [(ax * h, ay * h, z), (bx * h, by * h, z)], 0.032, SS))
        if i < secs:
            zb = z0 + (z1 - z0) * (i + 1) / secs
            hb = half(zb)
            for c in range(4):
                (ax, ay), (bx, by) = corners[c], corners[(c + 1) % 4]
                body.append(ltube("brace", [(ax * h, ay * h, z), (bx * hb, by * hb, zb)], 0.024, S))
                if K.LOD == 0 or (i + c) % 2:
                    body.append(ltube("brace", [(bx * h, by * h, z), (ax * hb, ay * hb, zb)], 0.024, S))
    body += [box("capBand", (0.48, 0.48, 0.06), SS, place((0, 0, 3.72)), bevel=0.02),
             box("cap", (0.54, 0.54, 0.14), S, place((0, 0, 3.82)), bevel=0.035),
             lathe("dome", [(0, 3.88, S), (0.24, 3.88, S), (0.24, 3.93, S)] +
                   [(0.24 * math.cos(a), 3.93 + 0.12 * math.sin(a), S)
                    for a in [math.pi / 2 * i / 4 for i in range(1, 4)]] + [(0, 4.05, S)], n=20),
             cyl("stem", 0.028, 0.18, G, place((0, 0, 4.03)), n=8, bevel=0.0)]
    # lamps: housings in the body, lenses as their own part (windowLit, so dead / lit can swap)
    lamps = []
    for sx in (1, -1):
        for z in (1.45, 2.15, 2.85):
            h = half(z)
            x0 = sx * (h + 0.05)
            M = place((x0, 0, z), (0, 90 * sx, 0))
            body.append(cbox("bracket", (0.12, 0.1, 0.1), S, place((sx * (h + 0.02), 0, z)), bevel=0.02))
            body.append(lathe("housing", [(0, 0.0, S), (0.2, 0.0, S, 0.03), (0.2, 0.18, S, 0.02),
                                          (0.165, 0.19, SS), (0.165, 0.17, SS)], n=16, matrix=M))
            if K.LOD == 0:
                body.append(ltorus("bezel", 0.18, 0.016, G, M @ place((0, 0, 0.19)), n=16, m=4))
            body.append(cbox("hood", (0.26, 0.3, 0.035), S, place((x0 + sx * 0.12, 0, z + 0.215), (0, -12 * sx, 0)),
                             bevel=0.012))
            lens = ([(0, 0.17, "windowLit"), (0.16, 0.17, "windowLit"), (0.12, 0.21, "windowLit"),
                     (0, 0.225, "windowLit")] if K.LOD == 0 else
                    [(0, 0.17, "windowLit"), (0.16, 0.17, "windowLit"), (0, 0.215, "windowLit")])
            lamps.append(lathe("lens", lens, n=16, matrix=M))
    # weather vane: spins round +Z on the stem
    zv = 4.21
    vane = [cyl("spindle", 0.024, 0.2, G, place((0, 0, zv)), n=8, bevel=0.0),
            finial(zv + 0.2, 0.09, r=0.04, n=12),
            ltube("arrow", [(-0.36, 0, zv + 0.09), (0.36, 0, zv + 0.09)], 0.02, G),
            slab("head", [(0.34, zv + 0.01), (0.52, zv + 0.09), (0.34, zv + 0.17)], 0.03, G, bevel=0.006),
            slab("tail", leaf_outline(0.3, 0.24, 10), 0.025, G, place((-0.22, 0, zv + 0.09), (0, -90, 0)),
                 bevel=0.006)]
    return {"mast": body, "lamps": lamps, "vane": (vane, (0, 0, zv))}


# ================================================================ clock tower
@model("clock-tower", "landmark")
def clock_tower():
    W = 0.8                       # half width of the shaft
    body = [box("plinth", (2.0, 2.0, 0.26), SD, place((0, 0, 0.13)), bevel=0.05),
            box("baseCourse", (1.82, 1.82, 0.34), SS, place((0, 0, 0.43)), bevel=0.05),
            box("ledge", (1.88, 1.88, 0.06), SS, place((0, 0, 0.62)), bevel=0.02),
            box("shaft", (2 * W, 2 * W, 2.72), L, place((0, 0, 0.62 + 1.36)), bevel=0.04),
            box("band", (1.7, 1.7, 0.08), SS, place((0, 0, 3.36)), bevel=0.025),
            box("cornice", (1.92, 1.92, 0.2), SS, place((0, 0, 3.5)), bevel=0.05),
            box("corniceTop", (1.76, 1.76, 0.1), L, place((0, 0, 3.65)), bevel=0.03),
            box("eave", (1.62, 1.62, 0.1), SD, place((0, 0, 3.75)), bevel=0.03)]
    # sandstone quoins up the corners, alternating long and short (far: one strip per corner)
    nq = 8
    zq0, zq1 = 0.66, 3.32
    hq = (zq1 - zq0) / nq
    for sx in (1, -1):
        for sy in (1, -1):
            if K.LOD:
                body.append(cbox("quoin", (0.28, 0.28, zq1 - zq0), SS,
                                 place((sx * (W + 0.02 - 0.14), sy * (W + 0.02 - 0.14), (zq0 + zq1) / 2))))
                continue
            for i in range(nq):
                a, b = (0.34, 0.22) if i % 2 == 0 else (0.22, 0.34)
                body.append(cbox("quoin", (a, b, hq - 0.04), SS,
                                 place((sx * (W + 0.025 - a / 2), sy * (W + 0.025 - b / 2), zq0 + hq * (i + 0.5))),
                                 bevel=0.03))
    # roof: square pyramid (four-sided lathe), gold hip lines and finial
    q = math.sqrt(2)
    body.append(lathe("roof", [(0, 3.80, V), (0.76 * q, 3.80, V), (0.70 * q, 3.92, V), (0.40 * q, 4.22, V),
                               (0.10 * q, 4.55, V), (0, 4.58, V)],
                      angles=[math.pi / 4 + k * math.pi / 2 for k in range(4)]))
    for sx, sy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        body.append(ltube("hip", [(sx * 0.76, sy * 0.76, 3.82), (sx * 0.70, sy * 0.70, 3.94),
                                  (sx * 0.4, sy * 0.4, 4.24), (sx * 0.1, sy * 0.1, 4.57)], 0.025, G))
    body.append(finial(4.52, 0.48, r=0.12))
    # four clock faces; hands: one part per hand, pivot at the face centre, turning round the face normal
    zc, fy = 2.2, -W
    prof = ([(0, 0.04, S), (0.40, 0.04, S), (0.42, 0.07, G), (0.45, 0.07, G), (0.47, 0.06, SS),
             (0.53, 0.09, SS, 0.02), (0.58, 0.05, SS), (0.58, -0.03, SS)] if K.LOD == 0 else
            [(0, 0.04, S), (0.42, 0.04, S), (0.47, 0.08, SS), (0.58, 0.05, SS), (0.58, -0.03, SS)])
    face = [lathe("face", prof, n=28, matrix=place((0, fy, zc), (90, 0, 0)))]
    fz = fy - 0.04
    if K.LOD == 0:
        for k in range(12):
            th = math.radians(30 * k)
            big = k % 3 == 0
            face.append(cbox("tick", (0.05, 0.02, 0.11) if big else (0.03, 0.016, 0.05), "darkFace",
                             place((0.32 * math.sin(th), fz, zc + 0.32 * math.cos(th)), (0, 30 * k, 0)),
                             bevel=0.0))
    hands = {}
    for name, deg in (("front", 0), ("right", 90), ("back", 180), ("left", 270)):
        fc = [o.copy() for o in face]
        for o in fc:
            o.data = o.data.copy(); bpy.context.scene.collection.objects.link(o)
        body += turn(fc, deg)
        hour = [cbox("hour", (0.065, 0.02, 0.26), "darkFace",
                     place((0.1 * math.sin(math.radians(305)), fz - 0.02, zc + 0.1 * math.cos(math.radians(305))),
                           (0, 305, 0)), bevel=0.01)]
        minute = [cbox("minute", (0.045, 0.02, 0.38), "darkFace",
                       place((0.15 * math.sin(math.radians(60)), fz - 0.045, zc + 0.15 * math.cos(math.radians(60))),
                             (0, 60, 0)), bevel=0.01),
                  cyl("hub", 0.045, 0.07, G, place((0, fz + 0.01, zc), (90, 0, 0)), n=10, bevel=0.0)]
        pivot = turned((0, fz, zc), deg)
        hands["hour_" + name] = (turn(hour, deg), pivot)
        hands["minute_" + name] = (turn(minute, deg), pivot)
    for o in face:
        bpy.data.objects.remove(o)
    return {"tower": body, **hands}


# ================================================================ lock gate
@model("lock-gate", "landmark")
def lock_gate():
    walls = [box("apron", (3.0, 1.7, 0.12), SS, place((0, 0, 0.06)), bevel=0.03, keys={"top": SL}),
             cbox("sill", (1.34, 0.22, 0.05), SD, place((0, 0.05, 0.145)), bevel=0.015)]
    # two stone piers of staggered blocks, sandstone at the bottom, cream cap stones
    courses = (0.42, 0.46, 0.44, 0.40)
    for sx in (1, -1):
        z = 0.12
        for i, h in enumerate(courses):
            splits = (-0.68, 0.08, 0.68) if i % 2 == 0 else (-0.68, -0.22, 0.68)
            for j in range(2):
                y0, y1 = splits[j], splits[j + 1]
                w = 0.80 if (i + j) % 2 == 0 else 0.76
                key = SS if i == 0 else (L if (i + j) % 2 else SL)
                walls.append(box("block", (w, y1 - y0 - 0.02, h - 0.02), key,
                                 place((sx * (0.66 + 0.40), (y0 + y1) / 2, z + h / 2)), bevel=0.06))
            z += h
        walls.append(box("cap", (0.92, 1.44, 0.12), SS, place((sx * 1.06, 0, z + 0.06)), bevel=0.04))
        top = z + 0.12
        walls.append(box("bearing", (0.2, 0.26, 0.3), S, place((sx * 1.02, 0.1, top + 0.15)), bevel=0.04))
        walls.append(cyl("bearingRing", 0.07, 0.24, G, place((sx * 1.02 - 0.12, 0.1, top + 0.32), (0, 90, 0)),
                         n=12, bevel=0.01))
    # cream beam across the top, behind the gates
    walls.append(box("beam", (1.5, 0.22, 0.2), S, place((0, 0.45, top - 0.12)), bevel=0.04))
    leaves = {}
    zb, H, Wd = 0.17, 1.55, 0.65
    for side, sx in (("leaf_left", -1), ("leaf_right", 1)):
        cx = sx * (0.66 - Wd / 2 - 0.005)
        lf = [box("leaf", (Wd - 0.02, 0.14, H), "kraft", place((cx, 0, zb + H / 2)), bevel=0.025)]
        for zz in (0.18, H / 2, H - 0.16):
            for fy in (-0.08, 0.08):
                lf.append(cbox("rail", (Wd - 0.06, 0.04, 0.12), "trunk", place((cx, fy, zb + zz)), bevel=0.015))
        for fy in (-0.08, 0.08):    # diagonal brace
            lf.append(cbox("brace", (0.09, 0.03, H * 0.62), "trunk",
                           place((cx, fy, zb + H / 2), (0, -38 * sx, 0)), bevel=0.012))
        if K.LOD == 0:
            for k in (-2, -1, 1, 2):     # plank lines
                for fy in (-0.071, 0.071):
                    lf.append(cbox("plank", (0.012, 0.004, H - 0.08), "trunk",
                                   place((cx + k * Wd / 5.5, fy, zb + H / 2)), bevel=0.0))
        for zz in (0.18, H - 0.16):         # hinge straps and pins
            lf.append(cbox("strap", (0.22, 0.16, 0.06), "iron", place((sx * 0.56, 0, zb + zz)), bevel=0.012))
            if K.LOD == 0:
                for fy in (-0.083, 0.083):
                    lf.append(cyl("bolt", 0.014, 0.008, G, place((sx * 0.5, fy, zb + zz), (90, 0, 0)), n=6, bevel=0))
        if K.LOD == 0:
            lf.append(ltorus("ring", 0.06, 0.013, G, place((cx - sx * 0.12, -0.085, zb + H * 0.62), (90, 0, 0)),
                             n=14, m=4))
        leaves[side] = (lf, (sx * 0.66, 0, zb))
    # winding gear: axle with two spoked hand wheels and two cogs, spins round X
    za = top + 0.32
    gear = [ltube("axle", [(-1.32, 0.1, za), (1.32, 0.1, za)], 0.035, "iron", res=2, res1=1)]
    for sx in (1, -1):
        x = sx * 1.32
        gear += [ltorus("wheel", 0.27, 0.03, G, place((x, 0.1, za), (0, 90, 0)), n=24, m=6, n1=10, m1=4),
                 cyl("hub", 0.06, 0.1, G, place((x - 0.05, 0.1, za), (0, 90, 0)), n=12, bevel=0.015)]
        for k in range(3):
            a = math.pi * k / 3
            gear.append(ltube("spoke", [(x, 0.1 + 0.26 * math.cos(a), za + 0.26 * math.sin(a)),
                                        (x, 0.1 - 0.26 * math.cos(a), za - 0.26 * math.sin(a))], 0.018, G))
        if K.LOD == 0:
            gear.append(slab("cog", gear_outline(0.17, 0.135, 10), 0.06, G, place((sx * 0.62, 0.1, za), (0, 0, 90)),
                             bevel=0.008))
    return {"walls": walls, **leaves, "gear": (gear, (0, 0.1, za))}


# ================================================================ market hall
@model("market-hall", "landmark")
def market_hall():
    LX, DY, WH = 3.7, 1.8, 1.45           # wall length, depth, height
    hall = [box("plinth", (LX + 0.16, DY + 0.16, 0.16), SS, place((0, 0, 0.08)), bevel=0.04),
            box("walls", (LX, DY, WH - 0.12), L, place((0, 0, 0.12 + (WH - 0.12) / 2)), bevel=0.03),
            box("band", (LX + 0.06, DY + 0.06, 0.08), SS, place((0, 0, WH - 0.04)), bevel=0.02)]
    for sx in (1, -1):        # corner pilasters
        for sy in (1, -1):
            hall.append(cbox("pilaster", (0.26, 0.26, WH - 0.12), SL,
                             place((sx * (LX / 2 - 0.1), sy * (DY / 2 - 0.1), 0.12 + (WH - 0.12) / 2)), bevel=0.04))
    # arches: three on the long sides (doors in the middle front), one on each end
    inner = K.arch_outline(0.78, 1.0, 10, base=0.16)
    outer = K.arch_outline(1.04, 1.13, 10, base=0.16)
    half_door = [(0.37, 0.16), (0.37, 0.66), (-0.37, 0.66), (-0.37, 0.16)]

    def arch(x, y, rot, kind, front):
        M = place((x, y, 0), (0, 0, rot))
        out = []
        if front or K.LOD == 0:
            out.append(frame("arch", outer, inner, 0.2, SS, M, bevel=0.02 if front else 0.0))
        if K.LOD == 0:
            out.append(cbox("key", (0.14, 0.22, 0.16), SD, M @ place((0, -0.02, 1.12)), bevel=0.02))
        if kind == "door":
            out.append(slab("door", inner, 0.06, "kraft", M @ place((0, -0.04, 0)), bevel=0.012))
            out.append(cbox("split", (0.025, 0.012, 0.82), "trunk", M @ place((0, -0.072, 0.58)), bevel=0.0))
            if K.LOD == 0:
                for k in (-2, -1, 1, 2):
                    out.append(cbox("plank", (0.012, 0.01, 0.68), "trunk", M @ place((k * 0.15, -0.072, 0.52)),
                                    bevel=0.0))
                for sx in (1, -1):
                    out.append(sphere("knob", 0.03, G, M @ place((sx * 0.06, -0.09, 0.62)), n=8))
        else:
            out.append(slab("shade", inner, 0.04, "darkFace", M @ place((0, -0.02, 0)), bevel=0.0))
            out.append(slab("shutter", half_door, 0.07, "kraft", M @ place((0, -0.045, 0)), bevel=0.012))
            if K.LOD == 0:
                out.append(cbox("counter", (0.9, 0.16, 0.05), SS, M @ place((0, -0.1, 0.68)), bevel=0.015))
                for k in (-1, 0, 1):
                    out.append(cbox("plank", (0.012, 0.01, 0.44), "trunk", M @ place((k * 0.19, -0.082, 0.41)),
                                    bevel=0.0))
        return out
    for i, x in enumerate((-1.2, 0.0, 1.2)):
        hall += arch(x, -DY / 2, 0, "door" if i == 1 else "shop", True)
        hall += arch(x, DY / 2, 180, "shop", False)
    for sx in (1, -1):
        hall += arch(sx * LX / 2, 0, 90 * sx, "shop", sx > 0)
    # attic prism under the roof (gable ends), roof plates, rolled eaves, ridge
    ridge, eave_y, eave_z = 2.42, 1.12, 1.45
    slope = (ridge - eave_z) / eave_y
    gz = ridge - (DY / 2) * slope
    hall.append(slab("gable", [(-DY / 2, WH - 0.02), (DY / 2, WH - 0.02), (DY / 2, gz), (0, ridge), (-DY / 2, gz)],
                     LX, L, place((0, 0, 0), (0, 0, 90)), bevel=0.02))
    ang = math.degrees(math.atan2(ridge - eave_z, eave_y))
    plen = math.hypot(eave_y, ridge - eave_z)
    th = 0.1
    RL = LX + 0.34
    roof = []
    so = K.rounded_rect(0.52, 0.44, 0.06, n=1)
    si = K.rounded_rect(0.38, 0.30, 0.03, n=1)
    for sy in (-1, 1):
        nrm = Vector((0, sy * math.sin(math.radians(ang)), math.cos(math.radians(ang))))
        c = Vector((0, sy * eave_y / 2, (ridge + eave_z) / 2)) + nrm * th / 2
        Mp = place(tuple(c), (-ang * sy, 0, 0))
        roof.append(box("roof", (RL, plen, th), "terracotta", Mp, bevel=0.03))
        if K.LOD == 0:      # tile courses
            for t in (-0.38, -0.08, 0.22):
                roof.append(cbox("course", (RL - 0.04, 0.05, 0.03), "terracotta",
                                 Mp @ place((0, t * sy, th / 2 + 0.01)), bevel=0.012))
        roof.append(ltube("eaveRoll", [(-RL / 2, sy * (eave_y + 0.02), eave_z + 0.03),
                                       (RL / 2, sy * (eave_y + 0.02), eave_z + 0.03)], 0.07, "terracotta", res=2))
        for x in (-1.15, 0.0, 1.15):      # skylights
            Ms = Mp @ place((x, 0.06 * -sy, th / 2 + 0.03), (-90, 0, 0))
            if K.LOD == 0:
                roof.append(frame("skyFrame", so, si, 0.1, S, Ms, bevel=0.015))
            else:
                roof.append(slab("skyFrame", so, 0.06, S, Ms @ place((0, 0.02, 0)), bevel=0.0))
            roof.append(slab("skyGlass", si, 0.05, "glassPale", Ms @ place((0, 0.005, 0)), bevel=0.0))
    roof.append(ltube("ridge", [(-RL / 2, 0, ridge + 0.06), (RL / 2, 0, ridge + 0.06)], 0.08, "terracotta", res=2))
    if K.LOD == 0:
        for sx in (1, -1):
            roof.append(sphere("ridgeEnd", 0.1, "terracotta", place((sx * RL / 2, 0, ridge + 0.06)), n=12))
    return {"hall": hall + roof}


# ================================================================ old cistern
@model("old-cistern", "landmark")
def old_cistern():
    R = 1.15
    wall, bands = stone_wall_profile(R, 0.20, 1.96, 4)
    body = [lathe("plinth", [(0, 0, SD), (1.30, 0, SD, 0.02), (1.30, 0.18, SS, 0.02), (1.20, 0.21, SS),
                             (0, 0.21, SS)], n=40),
            coursed("wall", wall + [(R - 0.03, 1.98, L)], 14, bands, fine=1)]
    # corbel ring under the cornice: scalloped
    nc = 18

    def scallop(t, z):
        return 1.0 if K.LOD else 1 + 0.05 * max(0.0, math.cos(nc * t)) ** 0.5 * (z - 1.9) / 0.14
    body.append(lathe("corbels", [(1.12, 1.90, SL), (1.18, 1.94, SL), (1.24, 2.04, SL), (1.0, 2.04, SL)],
                      n=72 if K.LOD == 0 else 16, radial=scallop))
    body.append(lathe("cornice", [(1.0, 2.02, SS), (1.34, 2.02, SS, 0.02), (1.38, 2.07, SS),
                                  (1.38, 2.18, SS, 0.02), (1.34, 2.22, G), (1.31, 2.23, SS), (1.12, 2.24, SS),
                                  (1.08, 2.24, L)], n=48))
    # dome in stone gores, a little cap stone stack on top
    gores = 12
    step = 2 * math.pi / gores
    nd = 7 if K.LOD == 0 else 4
    dome_pts = [(1.10 * math.cos(a), 2.24 + 0.6 * math.sin(a), L) for a in [math.pi / 2 * i / nd for i in range(0, nd)]]
    dome_pts += [(0.2, 2.83, L), (0, 2.84, L)]
    if K.LOD == 0:
        g = step * 0.035
        angs = [k * step + a for k in range(gores) for a in (0, g, g + (step - g) / 3, g + 2 * (step - g) / 3)]
        body.append(lathe("dome", dome_pts, angles=angs,
                          paint=lambda t, z, key: LD if (t % step) < g and z < 2.8 else key))
    else:
        body.append(lathe("dome", dome_pts, n=24))
    body.append(lathe("capStones", [(0, 2.8, SS), (0.26, 2.8, SS, 0.02), (0.26, 2.9, SS, 0.02), (0.18, 2.91, SL),
                                    (0.18, 2.97, SL), (0.1, 3.0, SL), (0, 3.0, SL)], n=20))
    # small arched door at the front, sandstone surround with a thin gold edge, stone threshold
    do = K.arch_outline(0.84, 1.36, 12, base=0.18)
    di = K.arch_outline(0.62, 1.22, 12, base=0.18)
    body.append(frame("doorFrame", do, di, 0.26, SS, place((0, -R + 0.03, 0)), bevel=0.025))
    if K.LOD == 0:
        body.append(frame("doorEdge", K.arch_outline(0.66, 1.24, 12, base=0.18), di, 0.27, G,
                          place((0, -R + 0.027, 0)), bevel=0.0))
    body.append(slab("door", di, 0.2, "kraft", place((0, -R + 0.07, 0)), bevel=0.012))
    if K.LOD == 0:
        for k in (-1, 1):
            body.append(cbox("plank", (0.014, 0.01, 0.95), "trunk", place((k * 0.1, -R - 0.031, 0.66)), bevel=0.0))
        body.append(ltorus("ring", 0.05, 0.012, G, place((0.18, -R - 0.05, 0.72), (90, 0, 0)), n=12, m=4))
    for z in (0.42, 0.98):
        body.append(cbox("strap", (0.6, 0.02, 0.05), "iron", place((0, -R - 0.032, z)), bevel=0.008))
    body.append(box("threshold", (1.0, 0.42, 0.18), SS, place((0, -R - 0.12, 0.09)), bevel=0.04, keys={"top": SL}))
    # brass spout on the front-right, with a valve wheel and a small stone trough under it
    th = math.radians(-48)
    phi = math.degrees(th) + 90
    p = (1.13 * math.cos(th), 1.13 * math.sin(th), 0.95)
    sp = [cyl("flange", 0.13, 0.08, SS, place((0, 0.02, 0), (90, 0, 0)), n=16, bevel=0.015),
          cyl("collar", 0.08, 0.07, G, place((0, -0.06, 0), (90, 0, 0)), n=12, bevel=0.01),
          ltube("pipe", K.smooth_path([(0, -0.06, 0), (0, -0.3, 0), (0, -0.4, -0.08), (0, -0.41, -0.22)], 3),
                0.055, G, res=2, res1=1),
          lathe("nozzle", [(0.055, 0.0, G), (0.075, -0.06, G, 0.01), (0, -0.06, G)], n=12,
                matrix=place((0, -0.41, -0.2)))]
    if K.LOD == 0:
        sp += [cyl("stem", 0.015, 0.1, G, place((0, -0.2, 0.04)), n=8, bevel=0.0),
               ltorus("valve", 0.065, 0.014, "copper", place((0, -0.2, 0.14)), n=14, m=4)]
    M = place(p, (0, 0, phi))
    for o in sp:
        o.data.transform(M @ o.matrix_world); o.matrix_world = Matrix.Identity(4)
    body += sp
    tp = Vector(p) + Vector((math.cos(th), math.sin(th), 0)) * 0.42
    body.append(box("trough", (0.56, 0.4, 0.26), SS, place((tp.x, tp.y, 0.13), (0, 0, phi)), bevel=0.05))
    body.append(cbox("troughIn", (0.44, 0.28, 0.02), SD, place((tp.x, tp.y, 0.255), (0, 0, phi)), bevel=0.0))
    return {"cistern": body}
