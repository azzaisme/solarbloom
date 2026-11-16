"""Area obstacles and planters, hand-built with prop_kit (see prop_models.py for the conventions):
stump, cracked-pillar, mooring-post, market-stall, dry-drain, planter-trough, planter-bed.

The Tripo models in assets/raw/tripo/models/ are the shape guides. Obstacles are one part (nothing moves);
planters split the soil off as its own part, like planter-pot.
"""
import math

import bmesh
from mathutils import Matrix

import prop_kit as K
from prop_kit import cyl, lathe, place, torus, tube
from prop_models import model, leaf_outline  # noqa: F401  (leaf_outline: shared style helper)


# ---------------------------------------------------------------- cheap helpers (one-segment chamfers)
def _chamfer(bm, edges, bevel, segs):
    if bevel > 0 and K.LOD == 0 and edges:
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, offset_type="OFFSET", segments=segs, profile=0.5,
                        affect="EDGES", clamp_overlap=True)


def cbox(name, size, key, matrix=None, bevel=0.015, segs=1, keys=None):
    """A box centred on the origin with chamfered edges (one segment near, sharp far): cheaper than K.box."""
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
    _chamfer(bm, list(bm.edges), min(bevel, min(size) * 0.45), segs)
    return K._object(name, bm, used, matrix)


def plate(name, outline, z0, z1, key, matrix=None, bevel=0.01, segs=1, side=None):
    """A flat shape from a 2D outline (x, y) in the XY plane, from z0 to z1, chamfered rims."""
    bm = bmesh.new()
    lo = [bm.verts.new((x, y, z0)) for x, y in outline]
    hi = [bm.verts.new((x, y, z1)) for x, y in outline]
    n = len(outline)
    bm.faces.new(hi); bm.faces.new(list(reversed(lo)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    used = [key]
    if side:
        used.append(side)
        for f in bm.faces:
            if abs(f.normal.z) < 0.5:
                f.material_index = 1
    rim = [e for e in bm.edges if len(e.link_faces) == 2 and
           (abs(e.link_faces[0].normal.z) > 0.5) != (abs(e.link_faces[1].normal.z) > 0.5)]
    _chamfer(bm, rim, bevel, segs)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4 and K._concave(f)])
    return K._object(name, bm, used, matrix)


def ring(name, outer, inner, z0, z1, key, matrix=None, bevel=0.01, segs=1, inner_key=None):
    """A flat ring (a trough wall, a rim) between two outlines with the same point count, from z0 to z1."""
    bm = bmesh.new()
    ol = [bm.verts.new((x, y, z0)) for x, y in outer]; oh = [bm.verts.new((x, y, z1)) for x, y in outer]
    il = [bm.verts.new((x, y, z0)) for x, y in inner]; ih = [bm.verts.new((x, y, z1)) for x, y in inner]
    n = len(outer)
    walls = []
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((oh[i], oh[j], ih[j], ih[i]))       # top
        bm.faces.new((ol[j], ol[i], il[i], il[j]))       # bottom
        bm.faces.new((ol[i], ol[j], oh[j], oh[i]))       # outer wall
        walls.append(bm.faces.new((il[j], il[i], ih[i], ih[j])))   # inner wall
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    used = [key]
    if inner_key:
        used.append(inner_key)
        for f in walls:
            f.material_index = 1
    rim = [e for e in bm.edges if len(e.link_faces) == 2 and
           abs(e.link_faces[0].normal.dot(e.link_faces[1].normal)) < 0.5]
    _chamfer(bm, rim, bevel, segs)
    return K._object(name, bm, used, matrix)


def rrect(w, h, rad, n=2):
    """A rounded rectangle outline; plain corners far (LOD1) to save triangles."""
    return K.rounded_rect(w, h, rad if K.LOD == 0 else 0.0, n)


def _wrap(a):
    return (a + math.pi) % (2 * math.pi) - math.pi


# ================================================================ area obstacles
def _capsule(t, z):
    """Squares a round section off a little (superellipse), so a stretched dome ends in a blunt, round tip."""
    c, s = abs(math.cos(t)), abs(math.sin(t))
    return 1 / (c ** 2.7 + s ** 2.7) ** (1 / 2.7)


@model("stump", "obstacle")
def stump():
    T, W, RG, M = "trunk", "kraft", "sandstoneDark", "moss"
    H = 0.42
    n = 28

    def paint(t, z, key):                       # a moss cap over the front-left rim (overgrown variant key)
        if key == T and H - 0.08 < z < H and abs(_wrap(t + 1.95)) < 0.6:
            return M
        return key

    # bark flares out at the foot so the roots grow out of it; soft rounded rim; thin growth rings on the cut
    pts = [(0.25, 0, T), (0.225, 0.03, T), (0.2, 0.08, T), (0.188, 0.16, T),
           (0.19, H - 0.08, T), (0.196, H - 0.008, T),
           (0.178, H, W), (0.148, H + 0.004, W), (0.14, H + 0.004, RG), (0.098, H + 0.006, W),
           (0.09, H + 0.006, RG), (0.048, H + 0.008, W), (0.041, H + 0.008, RG), (0, H + 0.01, W)]
    if K.LOD:
        pts = [p for p in pts if p[0] in (0.25, 0.2, 0.19, 0.196, 0.178, 0.148, 0.14, 0)]
    body = lathe("stump", pts, n=n, paint=paint if K.LOD == 0 else None)
    # roots: half-domes, open underneath, rising into the bark and rounding off at the tip
    dome = [(1, 0, T), (0.94, 0.4, T), (0.72, 0.76, T), (0.36, 0.96, T), (0, 1, T)]
    if K.LOD:
        dome = [(1, 0, T), (0.75, 0.7, T), (0, 1, T)]
    roots = []
    for ang, ln, wd, ht in ((15, 0.25, 0.1, 0.2), (88, 0.21, 0.09, 0.17), (160, 0.25, 0.1, 0.19),
                            (232, 0.22, 0.095, 0.18), (300, 0.25, 0.1, 0.2)):
        c = math.radians(ang)
        roots.append(lathe("root", dome, n=14, radial=_capsule, matrix=place((0.09 * math.cos(c), 0.09 * math.sin(c), 0), (0, 0, ang),
                                                              (ln, wd, ht))))
    for o in [body] + roots:                    # one smooth surface: no hard facet edges
        o.data.set_sharp_from_angle(angle=math.radians(80))
    return {"stump": [body] + roots}


@model("cracked-pillar", "obstacle")
def cracked_pillar():
    L, LD, LL, G = "sandstone", "sandstoneDark", "sandstoneLight", "gold"
    Ht = 1.52                                   # the broken top's lowest level; teeth reach 1.8
    plinth = [cbox("foot", (0.88, 0.88, 0.06), LD, place((0, 0, 0.03)), bevel=0.015),
              cbox("plinth", (0.8, 0.8, 0.17), L, place((0, 0, 0.145)), bevel=0.035)]
    flutes = 16
    step = 2 * math.pi / flutes
    angles = ([k * step + p * step for k in range(flutes) for p in (0.0, 0.5)] if K.LOD == 0
              else [k * 2 * step for k in range(flutes // 2)])

    def radial(t, z):
        if z < 0.35 or K.LOD:
            return 1.0
        f = (t % step) / step
        return 1.0 if f < 0.25 or f > 0.75 else 0.93

    r = lambda z: 0.32 - 0.03 * (z - 0.35) / (Ht - 0.35)      # noqa: E731  (slight taper)
    prof = [(0, 0.23, L), (0.39, 0.23, L, 0.01), (0.39, 0.26, L, 0.025), (0.35, 0.3, L),
            (0.345, 0.305, G), (0.345, 0.33, G, 0.006), (0.32, 0.35, L)]
    prof += [(r(Ht), Ht, L), (r(Ht) - 0.035, Ht + 0.01, LL), (0.13, Ht - 0.04, LL), (0, Ht - 0.02, LL)]
    shaft = lathe("shaft", prof, angles=angles, radial=radial)
    # break the top: lift the top rings by a jagged height round the column
    teeth = [0.28, 0.16, 0.26, 0.09, 0.03, 0.11, 0.0, 0.05, 0.13, 0.06, 0.2, 0.27]

    def jag(t):
        u = (t % (2 * math.pi)) / (2 * math.pi) * len(teeth)
        i = int(u) % len(teeth)
        return teeth[i] + (teeth[(i + 1) % len(teeth)] - teeth[i]) * (u - int(u))

    for v in shaft.data.vertices:
        x, y, z = v.co
        if z > Ht - 0.05:
            rr = math.hypot(x, y)
            k = 1.0 if rr > 0.2 else (0.55 if rr > 0.01 else 0.3)
            v.co.z = z + jag(math.atan2(y, x)) * k
    rubble = [cbox("chunk", (0.14, 0.12, 0.1), L, place((0.3, -0.29, 0.28), (8, -6, 30)), bevel=0.025),
              cbox("chip", (0.08, 0.07, 0.06), LL, place((0.13, -0.35, 0.26), (0, 10, -20)), bevel=0.015)]
    return {"cracked-pillar": plinth + [shaft] + rubble}


@model("mooring-post", "obstacle")
def mooring_post():
    I, G, L, LD = "iron", "gold", "sandstone", "sandstoneDark"
    base = [cbox("base", (0.6, 0.6, 0.1), L, place((0, 0, 0.05)), bevel=0.025, keys={"bottom": LD}),
            cbox("collar", (0.38, 0.38, 0.04), LD, place((0, 0, 0.12)), bevel=0.012)]
    post = lathe("post", [(0, 0.14, I), (0.165, 0.14, I, 0.01), (0.165, 0.165, I, 0.012), (0.125, 0.2, I),
                          (0.12, 0.33, I), (0.132, 0.335, G), (0.132, 0.375, G, 0.006), (0.12, 0.38, I),
                          (0.105, 0.41, I, 0.01), (0.165, 0.45, I, 0.012), (0.17, 0.48, I, 0.015)] +
                 [(0.17 * math.cos(a), 0.48 + 0.1 * math.sin(a), I) for a in (0.6, 1.15)] +
                 [(0, 0.58, I)], n=20)
    return {"mooring-post": base + [post]}


@model("market-stall", "obstacle")
def market_stall():
    W, T, S, R, G = "kraft", "trunk", "shell", "canvasRed", "gold"
    parts = [cbox("skirt", (1.38, 0.68, 0.08), T, place((0, 0, 0.04)), bevel=0.02),
             cbox("body", (1.3, 0.6, 0.72), W, place((0, 0, 0.44)), bevel=0.02),
             cbox("band", (1.44, 0.74, 0.08), S, place((0, -0.02, 0.76)), bevel=0.03),
             cbox("top", (1.5, 0.8, 0.06), W, place((0, -0.02, 0.83)), bevel=0.02)]
    for sx in (1, -1):                          # corner posts on the counter body
        for sy in (1, -1):
            parts.append(cbox("corner", (0.09, 0.09, 0.66), T, place((sx * 0.64, sy * 0.29, 0.41)), bevel=0.015))
    if K.LOD == 0:
        parts += [cbox("batten", (1.22, 0.03, 0.05), T, place((0, -0.305, 0.25)), bevel=0.01),
                  lathe("emblem", [(0.07, 0.0, G), (0.1, 0.0, G), (0.1, 0.02, G), (0.07, 0.02, G)], n=12, closed=True,
                        matrix=place((0, -0.3, 0.52), (90, 0, 0))),
                  cyl("disc", 0.075, 0.012, S, place((0, -0.3, 0.52), (90, 0, 0)), n=16, bevel=0.0)]
    # uprights: front ones shorter, so the awning slopes forward
    yb, yf, zb, zf = 0.3, -0.33, 1.72, 1.42
    for sx in (1, -1):
        for y, z in ((yb, zb), (yf, zf)):
            if K.LOD == 0:
                parts.append(cyl("post", 0.035, z - 0.86, W, place((sx * 0.66, y, 0.86)), n=8, bevel=0.0))
            else:
                parts.append(cbox("post", (0.06, 0.06, z - 0.86), W, place((sx * 0.66, y, (z + 0.86) / 2))))
    # awning: canvas stripes on a slope, a scalloped valance at the front, a roll at the back
    yb2, yf2 = yb + 0.13, yf - 0.17
    zb2 = zb + 0.04 + (zb - zf) / (yb - yf) * (yb2 - yb)
    zf2 = zb + 0.04 - (zb - zf) / (yb - yf) * (yb - yf2)
    ang = math.degrees(math.atan2(zb2 - zf2, yb2 - yf2))
    ln = math.hypot(zb2 - zf2, yb2 - yf2)
    stripes, sw = 6, 1.62 / 6
    for i in range(stripes):
        x = -0.81 + sw * (i + 0.5)
        key = R if i % 2 == 0 else S
        parts.append(cbox("stripe", (sw + 0.002, ln, 0.035), key,
                          place((x, (yb2 + yf2) / 2, (zb2 + zf2) / 2), (ang, 0, 0)), bevel=0.01))
        k = 6 if K.LOD == 0 else 2
        sc = [(sw / 2 * math.cos(math.pi * j / k), -0.1 - 0.1 * math.sin(math.pi * j / k)) for j in range(k + 1)]
        outline = [(-sw / 2 - 0.001, 0.0), (sw / 2 + 0.001, 0.0), (sw / 2 + 0.001, -0.1)] + sc[1:-1] + \
                  [(-sw / 2 - 0.001, -0.1)]
        # the outline drawn in XY, stood upright facing the front
        if K.LOD == 0:
            parts.append(plate("valance", outline, -0.012, 0.012, key,
                               place((x, yf2 + 0.006, zf2 + 0.02), (90, 0, 0)), bevel=0.0))
    parts.append(cyl("roll", 0.05, 1.66, W, place((-0.83, yb2 + 0.01, zb2 + 0.005), (0, 90, 0)), n=10, bevel=0.0))
    return {"market-stall": parts}


@model("dry-drain", "obstacle")
def dry_drain():
    L, LD, LL, G, I, D = "sandstone", "sandstoneDark", "sandstoneLight", "gold", "iron", "darkFace"
    parts = [cbox("bed", (0.8, 0.8, 0.13), LD, place((0, 0, 0.065)), bevel=0.02)]
    # paving: four corner stones and four side stones round the grate, grout gaps between
    g, a, c = 0.012, 0.22, 0.4                  # gap, border width, grate opening
    for sx in (1, -1):
        for sy in (1, -1):
            parts.append(cbox("stone", (a - g, a - g, 0.06), L,
                              place((sx * (c / 2 + a / 2), sy * (c / 2 + a / 2), 0.15)), bevel=0.018))
    for sx, sy, w, d in ((1, 0, a - g, c - g), (-1, 0, a - g, c - g), (0, 1, c - g, a - g), (0, -1, c - g, a - g)):
        parts.append(cbox("stone", (w, d, 0.06), L,
                          place((sx * (c / 2 + a / 2), sy * (c / 2 + a / 2), 0.15)), bevel=0.018))
    # the grate: a stone frame with gold studs, a dark pit, iron bars
    parts.append(ring("frame", rrect(c - g, c - g, 0.02, 1), rrect(0.3, 0.3, 0.005, 1), 0.12, 0.175, LL,
                      bevel=0.01))
    parts.append(cbox("pit", (0.31, 0.31, 0.02), D, place((0, 0, 0.11)), bevel=0.0))
    for i in range(5):
        x = -0.12 + 0.06 * i
        parts.append(cbox("bar", (0.03, 0.31, 0.04), I, place((x, 0, 0.145)), bevel=0.008))
    parts.append(cbox("cross", (0.31, 0.03, 0.03), I, place((0, 0, 0.14)), bevel=0.008))
    if K.LOD == 0:
        for sx in (1, -1):
            for sy in (1, -1):
                parts.append(cyl("stud", 0.016, 0.01, G, place((sx * 0.17, sy * 0.17, 0.172)), n=8, bevel=0.0))
    return {"dry-drain": parts}


# ================================================================ planters
def stone_courses(hx, hy, corner, depth, courses, gap=0.012, key="sandstone"):
    """Slightly proud stone blocks round a rectangular core, between corner blocks. hx, hy: half extents of the
    block faces; courses: (z0, z1, blocks on a long side, blocks on a short side)."""
    out = []
    for z0, z1, nx, ny in courses:
        h, zc = z1 - z0 - gap, (z0 + z1) / 2
        for side, half, other, cnt in (("x", hx, hy, nx), ("y", hy, hx, ny)):
            if not cnt:
                continue
            span = 2 * (half - corner)
            ln = span / cnt
            for s in (1, -1):
                for i in range(cnt):
                    a = -span / 2 + ln * (i + 0.5)
                    c = s * (other - depth / 2)
                    loc, size = ((a, c, zc), (ln - gap, depth, h)) if side == "x" else ((c, a, zc), (depth, ln - gap, h))
                    out.append(cbox("block", size, key, place(loc), bevel=0.014))
    return out


def corner_blocks(hx, hy, corner, z0, z1, key, gap=0.006):
    c = corner - gap
    return [cbox("corner", (c, c, z1 - z0), key, place((sx * (hx - corner / 2), sy * (hy - corner / 2), (z0 + z1) / 2)),
                 bevel=0.02) for sx in (1, -1) for sy in (1, -1)]


@model("planter-trough", "planter")
def planter_trough():
    L, LD, LL, G = "sandstone", "sandstoneDark", "sandstoneLight", "gold"
    hx, hy, cw = 0.87, 0.3, 0.2
    if K.LOD == 0:      # a dark core shows in the joints between the blocks
        trough = [cbox("core", (1.68, 0.54, 0.33), LD, place((0, 0, 0.165)), bevel=0.0)]
        trough += corner_blocks(hx, hy, cw, 0.0, 0.32, LL)
        trough += stone_courses(hx, hy, cw, 0.06, ((0.0, 0.165, 2, 1), (0.165, 0.32, 3, 0)), key=L)
        trough += [cbox("endblock", (0.06, 2 * (hy - cw) - 0.012, 0.155), L, place((sx * (hx - 0.03), 0, 0.2425)),
                        bevel=0.014) for sx in (1, -1)]
    else:
        trough = [cbox("core", (2 * hx, 2 * hy, 0.32), L, place((0, 0, 0.16)), bevel=0.0)]
    trough += [ring("band", rrect(1.77, 0.63, 0.05, 1), rrect(1.6, 0.46, 0.03, 1), 0.31, 0.325, G, bevel=0.0),
               ring("lip", rrect(1.8, 0.66, 0.07, 1), rrect(1.5, 0.36, 0.04, 1), 0.32, 0.42, LL, bevel=0.035)]
    soil = [plate("soil", rrect(1.5, 0.36, 0.04, 1), 0.33, 0.375, "soil", bevel=0.0)]
    return {"trough": trough, "soil": soil}


@model("planter-bed", "planter")
def planter_bed():
    L, LD, LL, G = "sandstone", "sandstoneDark", "sandstoneLight", "gold"
    h, cw = 0.48, 0.2
    if K.LOD == 0:
        bed = [cbox("core", (0.86, 0.86, 0.41), LD, place((0, 0, 0.205)), bevel=0.0)]
        bed += stone_courses(h, h, cw, 0.06, ((0.0, 0.2, 2, 2), (0.2, 0.4, 1, 1)), key=L)
    else:
        bed = [cbox("core", (2 * h, 2 * h, 0.41), L, place((0, 0, 0.205)), bevel=0.0)]
    bed += [ring("lip", rrect(1.0, 1.0, 0.06, 1), rrect(0.72, 0.72, 0.04, 1), 0.4, 0.49, LL, bevel=0.035)]
    # chunky corner posts standing proud of the lip, each with a thin gold cap
    bed += corner_blocks(h + 0.01, h + 0.01, cw + 0.01, 0.0, 0.56, LL)
    for sx in (1, -1):
        for sy in (1, -1):
            bed.append(cbox("cap", (0.15, 0.15, 0.025), G, place((sx * 0.39, sy * 0.39, 0.5725)), bevel=0.0))
    soil = [plate("soil", rrect(0.72, 0.72, 0.04, 1), 0.38, 0.44, "soil", bevel=0.0)]
    return {"bed": bed, "soil": soil}
