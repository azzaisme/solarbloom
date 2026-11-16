"""Clutter group B and the skyline pieces: broken pot, rubble pile, stone block, wall niche, banner pole,
satellite dish, skyline tower / bridge / dome / cliff. Same conventions as prop_models.py (metres, up +Z,
front -Y, pivot at the base centre). Stone is sandstone; gold is kept to small accents.
"""
import math
import random

import bmesh
from mathutils import Matrix, Vector

import prop_kit as K
from prop_kit import box, cyl, frame, lathe, place, slab, sphere, torus, tube
from prop_models import model, leaf_outline  # noqa: F401  (leaf_outline: shared helper, imported per the brief)

SD, SDK, SDL = "sandstone", "sandstoneDark", "sandstoneLight"


# ================================================================ helpers
def rock(name, size, key, matrix=None, chips=(), chip=0.25, jitter=0.0, seed=0, bevel=0.02, segs=2,
         chip_key=None, top_key=None):
    """A rough block: a box (size, centred on the origin) with chipped corners (chips: corner indices 0-7, each
    cut back by chip x the smallest side), jittered corners, soft bevels. chip_key paints the slanted chip faces,
    top_key the upward faces."""
    rng = random.Random(seed)
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    d = chip * min(size)
    pts = []
    for i in range(8):
        sx, sy, sz = (1 if i & 1 else -1), (1 if i & 2 else -1), (1 if i & 4 else -1)
        c = Vector((sx * hx, sy * hy, sz * hz))
        if i in chips:
            pts += [c - Vector((sx * d, 0, 0)), c - Vector((0, sy * d, 0)), c - Vector((0, 0, sz * d))]
        else:
            pts.append(c)
    j = jitter * min(size)
    pts = [p + Vector((rng.uniform(-j, j), rng.uniform(-j, j), rng.uniform(-j, j))) for p in pts]
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in pts]
    r = bmesh.ops.convex_hull(bm, input=vs)
    junk = [g for g in r["geom_interior"] + r["geom_unused"] if isinstance(g, bmesh.types.BMVert)]
    if junk:
        bmesh.ops.delete(bm, geom=junk, context="VERTS")
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(6), verts=list(bm.verts), edges=list(bm.edges))
    used = [key]
    for f in bm.faces:
        f.normal_update()
        n = f.normal
        k = key
        if top_key and n.z > 0.8:
            k = top_key
        elif chip_key and max(abs(n.x), abs(n.y), abs(n.z)) < 0.85:
            k = chip_key
        if k not in used:
            used.append(k)
        f.material_index = used.index(k)
    if bevel > 0 and K.rnd(segs):
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, offset_type="OFFSET", segments=K.rnd(segs),
                        profile=0.5, affect="EDGES", clamp_overlap=True)
    return K._object(name, bm, used, matrix)


def block(name, size, key, matrix=None, bevel=0.012):
    """A small box with a single chamfer (cheap raised stones, bricks)."""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bm.transform(Matrix.Diagonal((*size, 1)))
    if bevel > 0 and K.rnd(1):
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, min(size) * 0.4), offset_type="OFFSET",
                        segments=1, profile=0.5, affect="EDGES", clamp_overlap=True)
    return K._object(name, bm, [key], matrix)


def settle(objs, centre=True):
    """Moves the objects so they sit on z = 0 (and centre their footprint on the origin)."""
    pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    lo = Vector([min(p[i] for p in pts) for i in range(3)]); hi = Vector([max(p[i] for p in pts) for i in range(3)])
    off = Vector(((-(lo.x + hi.x) / 2) if centre else 0, (-(lo.y + hi.y) / 2) if centre else 0, -lo.z))
    for o in objs:
        o.data.transform(o.matrix_world.inverted() @ Matrix.Translation(off) @ o.matrix_world)
    return objs


def transform(objs, M):
    for o in objs:
        o.data.transform(o.matrix_world.inverted() @ M @ o.matrix_world)
    return objs


def _ray_hit(poly, c, d):
    best = None
    for i in range(len(poly)):
        a, b = Vector(poly[i]), Vector(poly[(i + 1) % len(poly)])
        e = b - a
        den = d.x * e.y - d.y * e.x
        if abs(den) < 1e-12:
            continue
        w = a - c
        t = (w.x * e.y - w.y * e.x) / den
        s = (w.x * d.y - w.y * d.x) / den
        if t > 1e-9 and -1e-9 <= s <= 1 + 1e-9 and (best is None or t < best):
            best = t
    return c + d * best


def radial_pair(outer, inner, c, n=28):
    """Point-matched outlines for frame(): rays from c through every corner of both outlines plus n even ones."""
    c = Vector(c)
    angs = [2 * math.pi * i / n for i in range(n)]
    for p in list(outer) + list(inner):
        angs.append(math.atan2(p[1] - c.y, p[0] - c.x) % (2 * math.pi))
    angs.sort()
    uniq = [a for i, a in enumerate(angs) if i == 0 or a - angs[i - 1] > 0.01]
    if uniq[-1] - uniq[0] > 2 * math.pi - 0.01:
        uniq.pop()
    o, i_ = [], []
    for a in uniq:
        d = Vector((math.cos(a), math.sin(a)))
        o.append(tuple(_ray_hit(outer, c, d))); i_.append(tuple(_ray_hit(inner, c, d)))
    return o, i_


def arch_band(w_in, h_in, w_out, h_out, base, n=16):
    """The outline of an arch-shaped band with open feet (a trim round an arch)."""
    o = K.arch_outline(w_out, h_out, n, base)
    i = K.arch_outline(w_in, h_in, n, base)
    return o + list(reversed(i))


def drop(objs):
    """Drops each object straight down (in order) until it rests on the ground or on the ones before it."""
    from mathutils.bvhtree import BVHTree
    verts, polys = [], []
    for o in objs:
        ws = [o.matrix_world @ v.co for v in o.data.vertices]
        d = None
        tree = BVHTree.FromPolygons(verts, polys) if polys else None
        for p in ws:
            sup = 0.0
            if tree:
                hit = tree.ray_cast(Vector((p.x, p.y, 10.0)), Vector((0, 0, -1)))
                if hit[0] is not None:
                    sup = max(sup, hit[0].z)
            gap = p.z - sup
            d = gap if d is None else min(d, gap)
        o.data.transform(o.matrix_world.inverted() @ Matrix.Translation((0, 0, -d)) @ o.matrix_world)
        base = len(verts)
        verts += [o.matrix_world @ v.co for v in o.data.vertices]
        polys += [[base + i for i in p.vertices] for p in o.data.polygons]
    return objs


def centre_xy(objs):
    pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    off = Vector((-(min(p.x for p in pts) + max(p.x for p in pts)) / 2,
                  -(min(p.y for p in pts) + max(p.y for p in pts)) / 2, 0))
    return transform(objs, Matrix.Translation(off))


# ================================================================ clutter
@model("broken-pot", "clutter")
def broken_pot():
    T, G, S = "terracotta", "gold", "shell"
    rw = lambda z: 0.15 + 0.04 * (z - 0.1) / 0.2          # outer wall radius
    ri = lambda z: rw(z) - 0.034                           # inner wall radius: a thick clay wall
    pts = [(0, 0.0, T), (0.14, 0.0, T, 0.015), (0.15, 0.1, T), (0.154, 0.105, G), (0.156, 0.118, G),
           (rw(0.12), 0.12, S), (rw(0.24), 0.24, S), (rw(0.245), 0.245, T), (rw(0.3), 0.3, T),
           (0.218, 0.31, T, 0.012), (0.218, 0.355, T, 0.012), (0.2, 0.37, T, 0.01), (ri(0.36), 0.37, T, 0.01),
           (ri(0.34), 0.34, T), (ri(0.05), 0.05, T, 0.02), (0, 0.05, T)]
    pot = lathe("pot", pts, n=20)

    def jag(theta):                                    # how much of the wall is left (1 = intact rim)
        a = math.degrees(theta) % 360
        if not (35 <= a <= 145):
            return 1.0
        k = round(a / 14)
        return (0.12 if k % 2 else 0.45) + 0.22 * math.sin(math.radians(a - 35) * 1.6)

    z0 = 0.2
    for v in pot.data.vertices:
        x, y, z = v.co
        if z <= z0:
            continue
        t = math.atan2(y, x)
        s = jag(t)
        if s >= 1.0:
            continue
        r = math.hypot(x, y)
        if r > rw(z) + 0.004:                          # the rolled lip broke away here
            r = rw(z)
        v.co = (r * math.cos(t), r * math.sin(t), z0 + (z - z0) * s)
    pot.data.update()
    parts = [pot]
    if K.LOD == 0:                                     # crack lines running down from the break
        for a0, da in ((math.radians(62), 0.1), (math.radians(122), -0.09)):
            cp = []
            for k, z in enumerate((0.25, 0.2, 0.15, 0.11)):
                a = a0 + da * (k % 2) + 0.03 * k
                r = rw(z) + 0.003
                cp.append((r * math.cos(a), r * math.sin(a), z))
            parts.append(tube("crack", cp, 0.005, "soilDark", n=4))
    # lay it on its side (break on top, mouth to the front-right) resting on the ground
    transform(parts, place((0, 0, 0), (81, 0, 70)))
    settle(parts, centre=False)
    mouth = Matrix.Rotation(math.radians(70), 4, "Z") @ Vector((0, -0.4, 0))
    soil = sphere("soil", 0.12, "soil", place((mouth.x * 0.95, mouth.y * 0.95, 0.0), (0, 0, 20), (1.4, 1.0, 0.4)),
                  n=12)
    shards = []
    th = 0.034
    for ol, (x, y, rz, sc) in (
            ([(-0.07, -0.03), (0.02, -0.055), (0.08, -0.005), (0.03, 0.035), (-0.04, 0.05)], (0.27, -0.24, 30, 1.0)),
            ([(-0.055, -0.04), (0.06, -0.03), (0.05, 0.04), (-0.05, 0.03)], (-0.02, -0.26, -40, 0.9)),
            ([(-0.05, -0.03), (0.05, -0.04), (0.035, 0.04), (-0.03, 0.035)], (0.42, 0.04, 100, 0.8))):
        shards.append(slab("shard", ol, th, T, place((x, y, th / 2), (90, 0, rz), (sc, 1, sc)), bevel=0.008,
                           side="soil"))
    allp = parts + [soil] + shards
    centre_xy(allp)
    return {"broken-pot": allp}




def frame_front(name, outer, inner, depth, key, matrix=None, bevel=0.02):
    """Like prop_kit.frame, but only the front outline and the outer corners get a (single) chamfer: the back
    and the tunnel are hidden behind other parts, so they stay cheap."""
    bm = bmesh.new()
    h = depth / 2
    of = [bm.verts.new((x, -h, y)) for x, y in outer]; ob = [bm.verts.new((x, h, y)) for x, y in outer]
    inf = [bm.verts.new((x, -h, y)) for x, y in inner]; ib = [bm.verts.new((x, h, y)) for x, y in inner]
    n = len(outer)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((of[i], of[j], inf[j], inf[i]))
        bm.faces.new((ob[j], ob[i], ib[i], ib[j]))
        bm.faces.new((of[j], of[i], ob[i], ob[j]))
        bm.faces.new((inf[i], inf[j], ib[j], ib[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bevel > 0 and K.rnd(1):
        front = set(of)
        outer_set = set(of) | set(ob)
        edges = []
        for e in bm.edges:
            a, b = e.verts
            if a in front and b in front:
                edges.append(e)
            elif a in outer_set and b in outer_set and len(e.link_faces) == 2 and \
                    e.link_faces[0].normal.dot(e.link_faces[1].normal) < 0.5:
                edges.append(e)
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, offset_type="OFFSET", segments=1, profile=0.5,
                        affect="EDGES", clamp_overlap=True)
    return K._object(name, bm, [key], matrix)


@model("rubble-pile", "clutter")
def rubble_pile():
    C, CD, T = "concrete", "concreteDark", "terracotta"
    big = dict(bevel=0.03, segs=2, jitter=0.015)
    small = dict(bevel=0.02, segs=2, jitter=0.02)
    H = 1.0                                            # everything starts high and is dropped onto the pile
    order = [
        rock("chunkA", (0.38, 0.32, 0.26), SD, place((0.0, 0.05, H), (0, 0, 15)), chips=(5, 6), chip=0.3, seed=1,
             chip_key=SDK, **big),
        rock("chunkC", (0.24, 0.2, 0.18), C, place((0.25, -0.12, H), (0, 0, -20)), chips=(4, 7), chip=0.3, seed=3,
             chip_key=CD, **big),
        rock("chunkD", (0.2, 0.18, 0.15), SDK, place((-0.16, 0.2, H), (0, 0, 40)), chips=(6,), chip=0.35, seed=4,
             **small),
        rock("bitE", (0.12, 0.1, 0.08), C, place((-0.33, -0.18, H), (0, 0, 20)), chips=(7,), seed=5, **small),
        rock("bitG", (0.12, 0.1, 0.09), CD, place((0.36, 0.14, H), (0, 0, 60)), chips=(5,), seed=7, **small),
        block("brick", (0.2, 0.095, 0.065), T, place((-0.06, -0.26, H), (0, 0, 12)), bevel=0.018),
        block("brick", (0.2, 0.095, 0.065), T, place((-0.4, 0.02, H), (0, 0, 80)), bevel=0.018),
        rock("slabB", (0.34, 0.22, 0.075), C, place((-0.2, -0.02, H), (0, -24, 20)), chips=(1, 6), chip=0.35, seed=2,
             chip_key=CD, **small),
        rock("topslab", (0.22, 0.16, 0.06), CD, place((0.05, 0.04, H), (6, 8, -25)), chips=(3, 4), chip=0.4,
             seed=10, **small),
        block("brick", (0.2, 0.095, 0.065), T, place((0.2, 0.08, H), (0, -12, -30)), bevel=0.018),
        rock("halfbrick", (0.11, 0.095, 0.065), T, place((0.3, -0.3, H), (0, 0, -15)), chips=(1, 3, 5), chip=0.45,
             seed=9, bevel=0.015, segs=2),
    ]
    drop(order)
    a = order[0]
    top = max((a.matrix_world @ v.co).z for v in a.data.vertices)
    order.append(tube("rebar", K.smooth_path([(-0.06, 0.12, top - 0.06), (-0.04, 0.13, top + 0.1),
                                              (0.03, 0.1, top + 0.18), (0.1, 0.06, top + 0.19)], 2),
                      0.01, "rust", n=6))
    centre_xy(order)
    return {"rubble-pile": order}


@model("stone-block", "clutter")
def stone_block():
    w, d, h = 0.6, 0.42, 0.38
    body = rock("block", (w, d, h), SD, place((0, 0, h / 2)), chips=(5, 4, 1), chip=0.3, jitter=0.0, seed=11,
                bevel=0.025, segs=2, chip_key=SDK)
    bx = -0.13
    band = frame("band", K.rounded_rect(d + 0.03, h + 0.03, 0.035, 2), K.rounded_rect(d + 0.002, h + 0.002, 0.025, 2),
                 0.06, SDK, place((bx, 0, h / 2), (0, 0, 90)), bevel=0.01)
    stud = [cyl("stud", 0.02, 0.012, "gold", place((bx, -d / 2 - 0.018, h / 2 + s * 0.07), (90, 0, 0)), n=8,
                bevel=0.004) for s in (-1, 1)] if K.LOD == 0 else []
    return {"stone-block": [body, band] + stud}


@model("wall-niche", "clutter")
def wall_niche():
    W, D = 1.2, 0.5
    base_z = 0.05                      # plinth; the wall stands on it
    zf = 0.17                          # niche floor (local): 0.22 above the ground
    aw, ah = 0.46, 0.56                # the opening, roomy for the cat (0.3 x 0.4)
    # a flat-topped wall fragment, gently stepped: lower right shoulder, tallest middle, mid left shoulder
    top = [(W / 2, 0.84), (0.34, 0.84), (0.34, 1.05), (-0.4, 1.05), (-0.4, 0.95), (-W / 2, 0.95)]
    outline = [(W / 2, 0)] + top + [(-W / 2, 0)]
    hole = K.arch_outline(aw + 0.07, zf + ah + 0.035, 12, base=zf - 0.035)
    outer, inner = radial_pair(outline, hole, (0, zf + 0.28), n=12 if K.LOD == 0 else 8)
    yf, yb = -D / 2, 0.12              # front face, back of the niche
    M = lambda y: place((0, y, base_z))
    real = K.arch_outline(aw, zf + ah, 12, base=zf)
    parts = [
        block("plinth", (W + 0.08, D + 0.08, base_z), SDK, place((0, 0, base_z / 2)), bevel=0.02)
        if K.LOD == 0 else None,
        frame_front("wall", outer, inner, yb - yf, SD, M((yf + yb) / 2), bevel=0.03),
        slab("back", outline, D / 2 - yb, SD, M((yb + D / 2) / 2), bevel=0.0),
        frame("lining", hole, real, yb - yf - 0.01, SDL, M((yf + yb) / 2 - 0.005), bevel=0.0),
        slab("niche", hole, 0.02, SDK, M(yb - 0.01), bevel=0.0) if K.LOD == 0 else None,
        slab("trim", arch_band(aw + 0.07, zf + ah + 0.035, aw + 0.11, zf + ah + 0.055, zf - 0.035, n=10), 0.025,
             "gold", M(yf - 0.01), bevel=0.0),
        block("sill", (aw + 0.22, 0.15, 0.06), SDL, place((0, yf - 0.035, base_z + zf - 0.035)), bevel=0.02)
        if K.LOD == 0 else None,
    ]
    if K.LOD == 0:                     # staggered courses of proud stones (front), wrapping onto the ends
        t, g = 0.035, 0.022            # stone proud depth, joint gap
        rows = [  # (z0, z1, [(x0, x1), ...])
            (0.0, 0.2, [(-0.6, -0.3), (0.3, 0.6)]),
            (0.2, 0.42, [(-0.6, -0.42), (-0.42, -0.3), (0.3, 0.6)]),
            (0.42, 0.63, [(-0.6, -0.3), (0.3, 0.46), (0.46, 0.6)]),
            (0.63, 0.84, [(-0.6, -0.3), (0.3, 0.6)]),
            (0.84, 1.05, [(-0.4, -0.02), (-0.02, 0.34)]),
        ]
        for z0, z1, segs in rows:
            for x0, x1 in segs:
                if z0 >= 0.84 and x0 >= 0.34:
                    continue
                parts.append(block("stone", (x1 - x0 - g, t, z1 - z0 - g), SDL,
                                   place(((x0 + x1) / 2, yf - t / 2 + 0.012, base_z + (z0 + z1) / 2)), bevel=0.012))
        for sx, zs in ((1, ((0.2, 0.42),)), (-1, ((0.42, 0.63),))):
            for z0, z1 in zs:
                parts.append(block("stone", (t, D * 0.55, z1 - z0 - g), SDL,
                                   place((sx * (W / 2 + t / 2 - 0.012), -0.08, base_z + (z0 + z1) / 2)), bevel=0.012))
        parts.append(sphere("knob", 0.03, "gold", place((0, yf - 0.02, base_z + zf + ah + 0.075)), n=8))
    return {"wall-niche": [o for o in parts if o]}


@model("banner-pole", "clutter")
def banner_pole():
    S, G = "shell", "gold"
    base = lathe("base", [(0, 0, SDK), (0.27, 0, SDK, 0.012), (0.27, 0.08, SDK, 0.014), (0.21, 0.09, SD),
                          (0.21, 0.22, SD, 0.018), (0.15, 0.23, SD), (0.15, 0.27, SD, 0.01), (0, 0.27, SD)],
                 n=8, start=math.pi / 8)
    pole = lathe("pole", [(0, 0.26, S), (0.08, 0.26, S), (0.082, 0.28, G), (0.082, 0.31, G),
                          (0.07, 0.32, S), (0.058, 2.42, S), (0, 2.42, S)], n=16)
    cap = lathe("capital", [(0, 2.41, G), (0.075, 2.41, G), (0.077, 2.44, G), (0.13, 2.45, SD),
                            (0.13, 2.56, SD, 0.015), (0.075, 2.58, SD), (0.035, 2.6, G), (0.032, 2.66, G),
                            (0, 2.66, G)], n=8, start=math.pi / 8)
    finial = sphere("finial", 0.075, G, place((0, 0, 2.725)), n=12)
    arm_z = 2.3
    arm = [tube("crossbar", [(0.04, 0, arm_z), (0.78, 0, arm_z)], 0.026, S, n=8),
           sphere("knob", 0.042, G, place((0.8, 0, arm_z)), n=10) if K.LOD == 0 else
           cyl("knob", 0.04, 0.06, G, place((0.77, 0, arm_z), (0, 90, 0)), n=6, bevel=0.0),
           cyl("collar", 0.072, 0.07, SD, place((0, 0, arm_z - 0.035)), n=12, bevel=0.01) if K.LOD == 0 else None,
           None if K.LOD else tube("brace", K.smooth_path([(0.05, 0, arm_z - 0.3), (0.2, 0, arm_z - 0.18), (0.36, 0, arm_z - 0.03)], 2),
                0.015, S, n=8)]
    if K.LOD == 0:                     # banner rings along the bar
        for x in (0.2, 0.46, 0.72):
            arm.append(torus("ring", 0.032, 0.007, G, place((x, 0, arm_z), (0, 90, 0)), n=8, m=4))
    return {"banner-pole": [base, pole, cap, finial] + [a for a in arm if a]}


@model("satellite-dish", "clutter")
def satellite_dish():
    S, G = "shell", "gold"
    pz = 0.46                          # the tilt hinge
    yaw = -30
    mount = [
        block("foot", (0.5, 0.5, 0.05), SDK, place((0, 0, 0.025)), bevel=0.015),
        box("base", (0.46, 0.46, 0.1), S, place((0, 0, 0.1)), bevel=0.025),
        block("riser", (0.28, 0.28, 0.07), SD, place((0, 0, 0.185)), bevel=0.02),
        cyl("collar", 0.055, 0.03, G, place((0, 0, 0.22)), n=12, bevel=0.006),
        cyl("post", 0.026, pz - 0.25, "copper", place((0, 0, 0.25)), n=10, bevel=0.0),
    ]
    yoke = [block("yokebase", (0.2, 0.06, 0.025), SD, place((0, 0, pz - 0.075)), bevel=0.008),
            cyl("pin", 0.014, 0.22, G, place((-0.11, 0, pz), (0, 90, 0)), n=8, bevel=0.0)]
    for sx in (1, -1):
        yoke.append(block("yoke", (0.018, 0.06, 0.1), SD, place((sx * 0.09, 0, pz - 0.03)), bevel=0.006))
    transform(yoke, Matrix.Rotation(math.radians(yaw), 4, "Z"))
    R, dep = 0.34, 0.1
    prof = [(0, 0.0, S), (0.17, dep * 0.25, S), (R, dep, S), (R + 0.012, dep + 0.008, G, 0.004),
            (R + 0.012, dep + 0.03, G, 0.004), (R - 0.012, dep + 0.03, G), (0.2, dep * 0.35 + 0.022, S),
            (0, 0.022, S)]
    D = place((0, 0, pz), (50, 0, yaw)) @ Matrix.Translation((0, 0, 0.05))
    dish = [lathe("dish", prof, n=24, matrix=D),
            cyl("hub", 0.06, 0.06, SD, D @ Matrix.Translation((0, 0, -0.06)), n=12, bevel=0.008),
            tube("feedarm", [tuple(D @ Vector((0, -R * 0.92, dep * 0.85 + 0.02))),
                             tuple(D @ Vector((0, -0.05, 0.22))), tuple(D @ Vector((0, 0, 0.25)))], 0.009, G, n=8),
            sphere("feed", 0.035, S, D @ Matrix.Translation((0, 0, 0.27)), n=10),
            cyl("feedring", 0.03, 0.014, G, D @ Matrix.Translation((0, 0, 0.245)), n=8, bevel=0.0) if K.LOD == 0
            else None]
    dish = [d for d in dish if d]
    return {"mount": mount + yoke, "dish": (dish, (0, 0, pz))}


# ================================================================ skyline (no far version, < 500 triangles)
@model("skyline-tower", "skyline")
def skyline_tower():
    S, L, ST = "shell", "leafFin", "stem"
    pts = [(0, 0, SDK), (4.4, 0, SDK), (4.4, 1.0, SD), (3.6, 1.2, S)]
    z, r = 1.2, 3.6
    for i in range(4):
        zl = z + 5.0
        rn = r - 0.35
        pts += [(r, zl, S), (r + 0.95, zl, SD), (r + 1.0, zl - 0.8, ST), (r + 1.08, zl + 0.3, SD),
                (rn + 0.2, zl + 0.75, L)]
        z, r = zl + 0.95, rn
    pts += [(r, z + 2.2, S), (r + 0.5, z + 2.5, SD), (r * 0.5, z + 3.6, SD), (0.3, z + 3.8, "gold"), (0, 30.0, "gold")]
    return {"skyline-tower": [lathe("tower", pts, n=8, start=math.pi / 8)]}


@model("skyline-bridge", "skyline")
def skyline_bridge():
    S, L = "shell", "leafFin"
    half, N = 11.0, 10
    top = lambda x: 7.8 + 0.5 * math.cos(math.pi * x / (2 * half))
    bot = lambda x: 7.4 - 3.4 * (abs(x) / half) ** 2.2
    xs = [-half + 2 * half * i / N for i in range(N + 1)]
    deck = [(x, bot(x)) for x in xs] + [(x, top(x)) for x in reversed(xs)]   # counter-clockwise
    W = 3.6
    parts = [slab("deck", deck, W, S, bevel=0.0, side=SD)]
    rail = [(x, top(x)) for x in xs] + [(x, top(x) + 0.8) for x in reversed(xs)]
    for sy in (1, -1):
        parts.append(slab("parapet", rail, 0.25, S, place((0, sy * (W / 2 - 0.125), 0)), bevel=0.0, side=SD))
    for sx in (1, -1):
        parts.append(box("pier", (2.6, W + 0.8, 7.6), SD, place((sx * (half + 0.8), 0, 3.8)), bevel=0.0))
        parts.append(box("cap", (3.0, W + 1.2, 0.6), SDK, place((sx * (half + 0.8), 0, 7.9)), bevel=0.0))
        parts.append(box("tree", (1.8, 1.8, 1.6), L, place((sx * (half + 0.8), 0, 9.0), (0, 0, 45)), bevel=0.0))
        parts.append(box("finial", (0.5, 0.5, 1.2), "gold", place((sx * (half + 0.8), 0, 10.2)), bevel=0.0))
    for k in range(8):
        x = -half + 2 * half * (k + 0.5) / 8
        sy = 1 if k % 2 else -1
        parts.append(box("planter", (1.6, 1.0, 1.1), S, place((x, sy * (W / 2 - 0.75), top(x) + 0.45)), bevel=0.0,
                         keys={"top": L}))
    return {"skyline-bridge": parts}


@model("skyline-dome", "skyline")
def skyline_dome():
    G, GL = "gold", "glass"
    drum = lathe("drum", [(0, 0, SDK), (7.5, 0, SDK), (7.5, 0.8, SDK), (7.0, 0.9, SD), (7.0, 2.9, SD),
                          (7.3, 3.0, SDL), (7.3, 3.5, SDL), (0, 3.5, SDL)], n=8, start=math.pi / 8)
    ribs = 8
    step = 2 * math.pi / ribs
    gap = 0.07
    angles = [k * step + a + math.pi / 8 for k in range(ribs) for a in (0.0, gap)]
    R, zc = 6.3, 6.4
    prof = [(R, 3.5, G), (R, 3.9, G), (R, 6.2, GL), (R, 6.5, G)]
    for deg in (32, 58):
        a = math.radians(deg)
        prof.append((R * math.cos(a), zc + R * math.sin(a), GL))
    prof += [(R * math.cos(math.radians(62)), zc + R * math.sin(math.radians(62)), G),
             (R * math.cos(math.radians(78)), zc + R * math.sin(math.radians(78)), GL),
             (1.3, 12.9, SDL), (1.3, 13.6, SDL), (0.5, 13.7, G), (0, 15.0, G)]

    def paint(t, z, key):
        return G if key == GL and ((t - math.pi / 8) % step) < gap else key
    dome = lathe("dome", prof, angles=angles, paint=paint)
    trees = sphere("trees", 4.4, "leafFin", place((0, 0, 3.5)), n=8, squash=0.75)
    return {"skyline-dome": [drum, dome, trees]}


@model("skyline-cliff", "skyline")
def skyline_cliff():
    L = "leafFin"
    kw = dict(bevel=0.0, jitter=0.05)
    p = [
        rock("ledge", (17.5, 11.5, 1.6), SDK, place((0, 0.3, 0.8)), chips=(0, 1, 2, 3), chip=0.6, seed=21, **kw),
        rock("leftlow", (5.6, 8.0, 10.5), SD, place((-5.0, 0.6, 6.6), (0, 0, 4)), chips=(0, 4), chip=0.3, seed=22, **kw),
        rock("lefttop", (5.0, 7.0, 8.4), SDL, place((-4.8, 1.0, 15.4), (0, 0, -5)), chips=(4, 5, 6), chip=0.3,
             seed=23, **kw),
        rock("rightlow", (5.8, 8.4, 9.0), SD, place((5.1, 0.4, 5.9), (0, 0, -3)), chips=(1, 5), chip=0.3, seed=24, **kw),
        rock("righttop", (5.2, 7.4, 9.6), SDL, place((4.9, 0.9, 14.6), (0, 0, 6)), chips=(4, 5, 7), chip=0.3,
             seed=25, **kw),
        rock("back", (4.4, 4.6, 17.4), SDK, place((0, 2.8, 9.3)), seed=26, **kw),
        rock("boulder", (2.4, 2.0, 1.8), SD, place((-6.0, -4.6, 2.2), (0, 0, 20)), chips=(4, 7), chip=0.35, seed=27, **kw),
        rock("boulder", (2.0, 1.8, 1.4), SDL, place((6.2, -4.4, 2.0), (0, 0, -15)), chips=(5,), chip=0.35, seed=28, **kw),
    ]
    for (x, y, z, s, sd) in ((-5.4, 0.2, 19.9, (3.6, 4.6, 1.6), 31), (-3.6, 2.6, 19.7, (2.8, 3.2, 1.4), 36),
                             (4.6, -0.2, 19.6, (3.8, 4.6, 1.6), 32),
                             (-7.0, -3.0, 2.1, (2.4, 2.2, 1.6), 33), (7.2, -2.0, 2.0, (2.2, 2.0, 1.4), 34),
                             (2.6, -4.8, 1.9, (1.8, 1.6, 1.2), 35)):
        p.append(rock("green", s, L, place((x, y, z), (0, 0, sd * 7)), chips=tuple(range(8)), chip=0.32, seed=sd, **kw))
    settle(p, centre=False)
    return {"skyline-cliff": p}
