"""Hand-built machines and characters: cultivator, lucky cat, pollinator garden, drone hub, mother-tree collar,
reservoir basin, bloom relay. Same conventions as prop_models.py (metres, up +Z, front -Y, pivot at the base centre).
"""
import math

import bmesh

import prop_kit as K
from prop_kit import box, cyl, frame, lathe, place, slab, sphere, torus, tube
from prop_models import model, leaf_outline


# ---------------------------------------------------------------- helpers
def gem(name, r, key, matrix=None, stretch=1.25):
    """A faceted crystal (flat-shaded icosphere, stretched along Z), centred on the origin."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2 if K.LOD == 0 else 1, radius=r)
    for v in bm.verts:
        v.co.z *= stretch
    o = K._object(name, bm, [key], matrix)
    for p in o.data.polygons:
        p.use_smooth = False
    return o


def stadium_ring(L, R, count):
    """Evenly spaced points round a stadium (length L along Y, end radius R) in the YZ plane, centred on 0:
    (y, z, outward normal angle in degrees)."""
    half = L / 2 - R
    per = [2 * half, math.pi * R, 2 * half, math.pi * R]
    total = sum(per)
    out = []
    for i in range(count):
        s = total * (i + 0.5) / count
        if s < per[0]:                                       # bottom, front to back
            out.append((-half + s, -R, -90)); continue
        s -= per[0]
        if s < per[1]:                                       # back end
            a = -90 + 180 * s / per[1]
            out.append((half + R * math.cos(math.radians(a)), R * math.sin(math.radians(a)), a)); continue
        s -= per[1]
        if s < per[2]:                                       # top, back to front
            out.append((half - s, R, 90)); continue
        s -= per[2]
        a = 90 + 180 * s / per[3]                            # front end
        out.append((-half + R * math.cos(math.radians(a)), R * math.sin(math.radians(a)), a))
    return out


# ================================================================ characters
@model("cultivator", "hero")
def cultivator():
    S, G, I = "shell", "gold", "iron"
    # ---- chassis: rounded white body on a gold skirt, fenders over the treads, a friendly face at the front
    ch = [box("body", (0.42, 0.5, 0.27), S, place((0, 0, 0.315)), bevel=0.07),
          box("skirt", (0.44, 0.52, 0.07), "sandstone", place((0, 0, 0.2)), bevel=0.03),
          box("belly", (0.3, 0.42, 0.1), I, place((0, 0, 0.14)), bevel=0.02)]
    for sx in (1, -1):
        ch.append(box("fender", (0.17, 0.58, 0.045), S, place((sx * 0.29, 0, 0.29)), bevel=0.02))
        ch.append(box("fenderTrim", (0.175, 0.04, 0.05), "sandstone", place((sx * 0.29, -0.27, 0.29)), bevel=0.012))
        if K.LOD == 0:
            ch.append(cyl("lampHouse", 0.042, 0.06, G, place((sx * 0.29, -0.17, 0.355), (90, 0, 0)), n=12,
                          bevel=0.01))
            ch.append(cyl("lamp", 0.03, 0.012, "windowLit", place((sx * 0.29, -0.226, 0.355), (90, 0, 0)), n=12,
                          bevel=0.0))
        # drum arms (front) and roller arms (rear), with stub axles
        arm = [(sx * 0.195, -0.2, 0.22), (sx * 0.195, -0.32, 0.19), (sx * 0.195, -0.4, 0.13)]
        ch.append(tube("drumArm", K.smooth_path(arm, 3) if K.LOD == 0 else arm[::2], 0.02, "copper", n=10))
        arm = [(sx * 0.2, 0.2, 0.24), (sx * 0.2, 0.32, 0.17), (sx * 0.2, 0.4, 0.09)]
        ch.append(tube("rollArm", K.smooth_path(arm, 3) if K.LOD == 0 else arm[::2], 0.018, "copper", n=10))
        if K.LOD == 0:
            ch.append(cyl("drumStub", 0.03, 0.04, G, place((sx * 0.175, -0.4, 0.13), (0, 90, 0)), n=12, bevel=0.0))
    # face: dark visor with two cyan eyes, a gold brow and grille below
    fy = -0.25
    ch.append(slab("visor", K.rounded_rect(0.28, 0.13, 0.05, 4), 0.03, "darkFace", place((0, fy, 0.335)),
                   bevel=0.008))
    for sx in (1, -1):
        ch.append(slab("eye", K.rounded_rect(0.05, 0.06, 0.024, 4), 0.012, "eyeCyan",
                       place((sx * 0.065, fy - 0.017, 0.34)), bevel=0.0))
    ch.append(slab("brow", K.rounded_rect(0.32, 0.025, 0.012, 2), 0.03, "sandstone", place((0, fy - 0.004, 0.415)),
                   bevel=0.006))
    if K.LOD == 0:
        for z in (0.245, 0.27):
            ch.append(box("grille", (0.2, 0.02, 0.012), I, place((0, fy - 0.004, z)), bevel=0.0))
        for sx in (1, -1):           # side vents and bolts
            for z in (0.29, 0.33):
                ch.append(box("vent", (0.02, 0.22, 0.014), "sandstoneDark", place((sx * 0.213, 0.03, z)), bevel=0.0))
    # sockets on top: canopy mast (front) and hopper collar (back)
    ch.append(cyl("mastBase", 0.06, 0.03, G, place((0, -0.07, 0.445)), n=16, bevel=0.01))
    ch.append(cyl("mast", 0.032, 0.2, S, place((0, -0.07, 0.46)), n=16, bevel=0.0))
    ch.append(cyl("hopperCollar", 0.085, 0.035, "sandstone", place((0, 0.13, 0.44)), n=16, bevel=0.01))

    # ---- treads: a dark belt with cleats round three gold-hubbed wheels
    def tread(sx):
        x, zc, L, R = sx * 0.29, 0.13, 0.6, 0.112
        loc = place((x, 0, zc), (0, 0, 90))
        t = [frame("belt", K.rounded_rect(L, 2 * R, R - 0.001, 6), K.rounded_rect(L - 0.07, 2 * R - 0.07, R - 0.036, 6),
                   0.13, I, loc, bevel=0.0),
             slab("web", K.rounded_rect(L - 0.06, 2 * R - 0.06, R - 0.031, 6), 0.09, "concreteDark", loc, bevel=0.0)]
        for y in ((-0.19, 0.0, 0.19) if K.LOD == 0 else ()):
            t.append(cyl("hub", 0.04, 0.02, G, place((x + sx * 0.055 if sx > 0 else x - 0.075, y, zc), (0, 90, 0)),
                         n=12, bevel=0.0))
        if K.LOD == 0:
            for y, z, a in stadium_ring(L + 0.02, R + 0.008, 20):
                t.append(box("cleat", (0.13, 0.03, 0.022), I, place((x, y, zc + z), (a - 90, 0, 0)), bevel=0.0))
        return t

    # ---- tine drum: shaft, two rim hoops and curved white tines, pivot on its axle
    dy, dz = -0.4, 0.13
    drum = [cyl("shaft", 0.035, 0.34, I, place((-0.17, dy, dz), (0, 90, 0)), n=16, bevel=0.006)]
    for sx in (1, -1):
        if K.LOD == 0:
            drum.append(torus("rim", 0.105, 0.012, S, place((sx * 0.15, dy, dz), (0, 90, 0)), n=20, m=6))
            drum.append(cyl("hubcap", 0.045, 0.03, G, place((sx * 0.15 - 0.015, dy, dz), (0, 90, 0)), n=12,
                            bevel=0.006))
        else:
            drum.append(cyl("rimDisc", 0.11, 0.02, S, place((sx * 0.15 - 0.01, dy, dz), (0, 90, 0)), n=8, bevel=0.0))
        for k in range(4 if K.LOD == 0 else 0):        # spokes to the rims
            a = math.radians(45 + k * (90 if K.LOD == 0 else 180))
            drum.append(tube("spoke", [(sx * 0.15, dy + 0.03 * math.cos(a), dz + 0.03 * math.sin(a)),
                                       (sx * 0.15, dy + 0.1 * math.cos(a), dz + 0.1 * math.sin(a))], 0.008, S, n=8))
    rings = (-0.09, 0.0, 0.09) if K.LOD == 0 else (0.0,)
    for i, x in enumerate(rings):
        for k in range(3 if K.LOD == 0 else 3):
            a0 = k * 120 + i * 40
            pts = [(x, dy + r * math.cos(math.radians(a0 + da)), dz + r * math.sin(math.radians(a0 + da)))
                   for r, da in ((0.03, 0), (0.07, 14), (0.105, 40))]
            drum.append(tube("tine", K.smooth_path(pts, 3), 0.014, S, n=8, taper=0.3))

    # ---- moss roller at the rear: ribbed moss drum with gold caps, pivot on its axle
    ry, rz = 0.4, 0.09
    prof = [(0, -0.185, "copper"), (0.06, -0.185, "copper", 0.01), (0.065, -0.17, "copper"), (0.088, -0.165, "moss", 0.01)]
    ribs = 3 if K.LOD == 0 else 0
    for j in range(ribs):
        z = -0.14 + 0.28 * j / max(1, ribs - 1)
        prof += [(0.088, z - 0.012, "moss"), (0.096, z, "moss", 0.006), (0.088, z + 0.012, "moss")]
    prof += [(0.088, 0.165, "moss", 0.01), (0.065, 0.17, "copper"), (0.06, 0.185, "copper", 0.01), (0, 0.185, "copper")]
    roller = [lathe("roller", prof, n=16, matrix=place((0, ry, rz), (0, 90, 0)))]

    # ---- glass seed hopper on the back, with a gold rim and lid, and the seed fill inside
    hy, hz = 0.13, 0.47
    hopper = [lathe("hopperGlass", [(0, hz, "glass"), (0.07, hz, "glass", 0.01), (0.115, hz + 0.13, "glass"),
                                    (0, hz + 0.13, "glass")], n=24, matrix=place((0, hy, 0))),
              torus("hopperRim", 0.115, 0.012, G, place((0, hy, hz + 0.13)), n=20, m=6) if K.LOD == 0 else None,
              lathe("hopperLid", [(0, hz + 0.135, G), (0.1, hz + 0.135, G, 0.01), (0.1, hz + 0.155, G, 0.02),
                                  (0.03, hz + 0.17, G, 0.01), (0.03, hz + 0.19, G, 0.01), (0, hz + 0.19, G)],
                    n=16, matrix=place((0, hy, 0)))]
    for sx in ((1, -1) if K.LOD == 0 else ()):          # gold ribs down the glass
        for sy in (1, -1):
            a = math.radians(45 + (0 if sx > 0 else 90) + (0 if sy > 0 else 180))
            hopper.append(tube("rib", [(0.074 * math.cos(a), hy + 0.074 * math.sin(a), hz + 0.005),
                                       (0.115 * math.cos(a), hy + 0.115 * math.sin(a), hz + 0.128)], 0.008, G, n=8))
    seeds = [lathe("seedFill", [(0, hz + 0.008, "kraft"), (0.064, hz + 0.008, "kraft", 0.008),
                                (0.096, hz + 0.08, "kraft", 0.01), (0.06, hz + 0.09, "kraft"), (0, hz + 0.095, "kraft")],
                   n=16, matrix=place((0, hy, 0)))]

    # ---- solar canopy: a framed blue panel on a gold hinge, tilted toward the front; pivot at the mount
    P = (0, -0.07, 0.68)
    tilt = place(P, (12, 0, 0))
    canopy = [cyl("hinge", 0.026, 0.14, G, place((-0.07, P[1], P[2]), (0, 90, 0)), n=16, bevel=0.006),
              box("bracket", (0.06, 0.06, 0.05), "sandstone", tilt @ place((0, 0, 0.02)), bevel=0.012),
              box("frame", (0.58, 0.46, 0.04), S, tilt @ place((0, 0, 0.055)), bevel=0.016),
              box("cells", (0.52, 0.4, 0.012), "panel", tilt @ place((0, 0, 0.076)), bevel=0.004)]
    if K.LOD == 0:
        for x in (-0.13, 0.0, 0.13):
            canopy.append(box("lineX", (0.006, 0.4, 0.004), G, tilt @ place((x, 0, 0.083)), bevel=0.0))
        for y in (-0.067, 0.067):
            canopy.append(box("lineY", (0.52, 0.006, 0.004), G, tilt @ place((0, y, 0.083)), bevel=0.0))
    return {"chassis": ch, "treadL": (tread(-1), (-0.29, 0, 0.13)), "treadR": (tread(1), (0.29, 0, 0.13)),
            "tineDrum": (drum, (0, dy, dz)), "mossRoller": (roller, (0, ry, rz)),
            "hopper": (hopper, (0, hy, hz)), "seedFill": (seeds, (0, hy, hz)), "canopy": (canopy, P)}


@model("lucky-cat", "hero")
def lucky_cat():
    S, R, PK, D = "shell", "catRed", "pink", "darkFace"
    body = [lathe("body", [(0, 0, S), (0.1, 0, S, 0.03), (0.125, 0.07, S, 0.04), (0.112, 0.15, S, 0.03),
                           (0.08, 0.215, S), (0, 0.235, S)], n=28, matrix=place(scale=(1, 0.9, 1))),
            sphere("head", 0.105, S, place((0, -0.005, 0.285), scale=(1.12, 1, 1)), n=28, squash=0.86),
            torus("collar", 0.088, 0.016, R, place((0, -0.004, 0.205), scale=(1.05, 0.95, 1)), n=28, m=10 if K.LOD == 0 else 4),
            sphere("bell", 0.022, "gold", place((0, -0.102, 0.18)), n=14),
            sphere("muzzle", 0.04, S, place((0, -0.082, 0.262), scale=(1.25, 0.8, 0.8)), n=16) if K.LOD == 0 else None]
    ear = [slab("ear", [(-0.045, 0), (0.045, 0), (0.01, 0.07), (-0.008, 0.072)], 0.03, S,
                place((0.062, 0.0, 0.335), (0, 22, 0)), bevel=0.01),
           slab("earIn", [(-0.03, 0.006), (0.03, 0.006), (0.006, 0.055), (-0.005, 0.056)], 0.012, PK,
                place((0.062, -0.014, 0.337), (0, 22, 0)), bevel=0.0)]
    body += ear + K.mirror_x(ear)
    for sx in (1, -1):
        body.append(sphere("eye", 0.019, D, place((sx * 0.042, -0.094, 0.296), scale=(1, 0.45, 1.3)), n=12))
        if K.LOD == 0:
            body.append(sphere("blush", 0.016, PK, place((sx * 0.07, -0.082, 0.262), scale=(1.2, 0.35, 0.8)), n=12))
        body.append(sphere("foot", 0.036, S, place((sx * 0.055, -0.085, 0.018), scale=(1, 1.2, 0.6)), n=14))
        if K.LOD == 0:
            for dz, tilt in ((0.004, 6), (-0.008, -8)):
                body.append(tube("whisker", [(sx * 0.07, -0.088, 0.262 + dz),
                                             (sx * 0.125, -0.07, 0.262 + dz + 0.05 * math.tan(math.radians(tilt)))],
                                 0.0025, D, n=4))
    body += [sphere("nose", 0.011, PK, place((0, -0.112, 0.27), scale=(1.3, 1, 0.9)), n=10),
             sphere("lapPaw", 0.034, S, place((0.05, -0.1, 0.12), scale=(1, 0.9, 1.25)), n=14)]
    if K.LOD == 0:
        body.append(tube("mouth", K.smooth_path([(-0.018, -0.111, 0.256), (-0.009, -0.114, 0.25),
                                                 (0, -0.113, 0.256), (0.009, -0.114, 0.25),
                                                 (0.018, -0.111, 0.256)], 2), 0.0028, D, n=4))
        body.append(box("bellSlit", (0.024, 0.006, 0.004), D, place((0, -0.123, 0.173)), bevel=0.0))
        body.append(sphere("lapPad", 0.01, PK, place((0.052, -0.13, 0.115), scale=(1, 0.5, 1)), n=8))
    body.append(tube("tail", K.smooth_path([(0.02, 0.09, 0.03), (0.08, 0.1, 0.035), (0.125, 0.04, 0.05),
                                           (0.12, -0.02, 0.07)], 3), 0.02, S, n=10, taper=0.3))
    # raised paw (the cat's right, -X), pivot at the shoulder
    sh = (-0.085, -0.03, 0.185)
    paw = [tube("arm", K.smooth_path([sh, (-0.118, -0.05, 0.24), (-0.13, -0.06, 0.29)], 3), 0.03, S, n=12),
           sphere("pawBall", 0.036, S, place((-0.132, -0.064, 0.312), scale=(1, 0.85, 1.05)), n=16),
           sphere("pawPad", 0.014, PK, place((-0.132, -0.095, 0.31), scale=(1, 0.45, 1)), n=10)]
    if K.LOD == 0:
        for dx in (-0.018, 0.0, 0.018):
            paw.append(sphere("toe", 0.006, PK, place((-0.132 + dx, -0.093, 0.333), scale=(1, 0.5, 1)), n=8))
    return {"body": body, "paw": (paw, sh)}


# ================================================================ machines
def flower(x, y, h, key, lean=0.0):
    """A chunky daisy: stem, a scalloped five-petal head and a gold core."""
    a = math.atan2(y, x)
    tx, ty = x + lean * math.cos(a), y + lean * math.sin(a)
    out = [tube("stem", K.smooth_path([(x, y, 0.33), (x + (tx - x) * 0.3, y + (ty - y) * 0.3, h * 0.6), (tx, ty, h)], 2),
                0.016, "stem", n=8)]
    tilt = math.degrees(math.atan2(lean, h - 0.33)) * 0.8
    m = place((tx, ty, h), (0, 0, math.degrees(a))) @ place(rot=(0, tilt, 0))
    out.append(lathe("petals", [(0, -0.012, key), (0.1, 0.0, key), (0.1, 0.022, key),
                                (0, 0.03, key)], n=15, matrix=m,
                     radial=lambda t, z: 0.62 + 0.38 * abs(math.cos(2.5 * t))))
    if K.LOD == 0:
        out.append(sphere("core", 0.04, "flowerCore", m @ place((0, 0, 0.026)), n=8, squash=0.6))
    return out


@model("pollinator-garden", "machine")
def pollinator_garden():
    L, LD, G, S = "sandstone", "sandstoneDark", "gold", "sandstoneLight"
    basin = [lathe("basin", [(0, 0, LD), (0.86, 0, LD, 0.02), (0.9, 0.04, LD, 0.03), (0.9, 0.1, LD, 0.02),
                             (0.83, 0.11, L), (0.84, 0.3, L), (0.845, 0.31, G), (0.845, 0.34, G),
                             (0.84, 0.35, L), (0.85, 0.41, S, 0.03), (0.82, 0.45, S, 0.02), (0.72, 0.45, S, 0.02),
                             (0.7, 0.42, LD), (0.7, 0.34, LD), (0, 0.34, LD)], n=32)]
    if K.LOD == 0:              # chunky stones set into the wall
        for k in range(10):
            a = 2 * math.pi * (k + 0.5 * (k % 2)) / 10
            z = 0.2 if k % 2 else 0.24
            basin.append(box("stone", (0.15, 0.04, 0.08), S,
                             place((0.835 * math.cos(a), 0.835 * math.sin(a), z), (0, 0, math.degrees(a) + 90)),
                             bevel=0.0))
    soil = [lathe("soil", [(0, 0.37, "soil"), (0.71, 0.35, "soil")], n=36)]
    flowers = []
    for x, y, h, key, lean in ((0.15, -0.3, 0.6, "shell", 0.08), (-0.25, -0.15, 0.66, "pink", 0.06),
                               (0.4, 0.05, 0.58, "shell", 0.1), (0.1, 0.25, 0.72, "shell", 0.0), (-0.45, -0.4, 0.55, "shell", 0.1),
                               (0.35, -0.48, 0.52, "pink", 0.08), (-0.05, -0.05, 0.78, "pink", 0.02),
                               (0.5, 0.4, 0.6, "pink", 0.08), (-0.5, 0.0, 0.6, "pink", 0.1),
                               (0.12, 0.55, 0.6, "shell", 0.1)):
        if K.LOD == 0 or key == "pink" or h > 0.7:
            flowers += flower(x, y, h, key, lean)
    clumps = ((0.3, -0.2, 0.17), (-0.2, -0.42, 0.15), (0.05, 0.05, 0.2), (0.45, 0.25, 0.15),
              (-0.15, 0.4, 0.15), (-0.5, -0.2, 0.13), (0.2, 0.42, 0.14))
    for x, y, r in clumps if K.LOD == 0 else clumps[:4]:   # leafy clumps
        flowers.append(sphere("clump", r, "leafFin", place((x, y, 0.33), scale=(1, 1, 0.75)), n=10))
    nl = 8 if K.LOD == 0 else 0
    for k in range(nl):           # leaves spilling over the clumps
        a = 2 * math.pi * k / max(1, nl) + 0.3
        r = 0.2 + 0.3 * (k % 3) / 2
        flowers.append(slab("leaf", leaf_outline(0.24, 0.13, 8), 0.02, "leafVein" if k % 2 else "leafFin",
                            place((r * math.cos(a), r * math.sin(a), 0.4), (0, 0, math.degrees(a) + 90)) @
                            place(rot=(-60, 0, 0)), bevel=0.0))
    # a wooden hive on a stone post, at the back left
    hx, hy, hz = -0.38, 0.3, 0.34

    def hive_part(x, y, z, turn):
        m = place((x, y, z), (0, 0, turn), 1.2)
        h = [cyl("post", 0.07, 0.12, "sandstoneLight", m, n=12, bevel=0.015),
             box("stand", (0.36, 0.3, 0.03), "trunk", m @ place((0, 0, 0.135)), bevel=0.01),
             box("box1", (0.32, 0.26, 0.14), "kraft", m @ place((0, 0, 0.22)), bevel=0.02),
             box("box2", (0.32, 0.26, 0.14), "kraft", m @ place((0, 0, 0.365)), bevel=0.02),
             box("seam", (0.33, 0.27, 0.012), "trunk", m @ place((0, 0, 0.292)), bevel=0.0),
             box("roof", (0.38, 0.32, 0.045), "sandstone", m @ place((0, 0, 0.455)), bevel=0.015),
             box("cap", (0.26, 0.2, 0.03), "sandstoneDark", m @ place((0, 0, 0.49)), bevel=0.0),
             box("door", (0.16, 0.02, 0.03), "darkFace", m @ place((0, -0.131, 0.175)), bevel=0.0),
             box("board", (0.2, 0.06, 0.015), "kraft", m @ place((0, -0.15, 0.15)), bevel=0.0)]
        if K.LOD == 0:
            for z2 in (0.22, 0.365):
                h.append(cyl("knob", 0.016, 0.014, G, m @ place((0, -0.13, z2 + 0.02), (90, 0, 0)), n=8,
                             bevel=0.0))
        return h
    hive = hive_part(hx, hy, hz, -25)
    return {"basin": basin, "soil": soil, "flowers": flowers, "hive": (hive, (hx, hy, hz))}


@model("drone-hub", "machine")
def drone_hub():
    L, LD, G, S = "sandstone", "sandstoneDark", "gold", "shell"
    pad = [box("pedestal", (1.36, 1.36, 0.36), L, place((0, 0, 0.2)), bevel=0.06),
           box("plinth", (1.42, 1.42, 0.06), LD, place((0, 0, 0.03)), bevel=0.025),
           box("band", (1.39, 1.39, 0.045), "sandstoneLight", place((0, 0, 0.33)), bevel=0.015),
           lathe("disc", [(0, 0.37, L), (0.72, 0.37, L, 0.01), (0.74, 0.42, L, 0.02), (0.74, 0.47, L, 0.02),
                          (0.71, 0.49, S), (0.64, 0.495, S), (0.6, 0.495, G), (0.17, 0.495, S),
                          (0, 0.5, "sandstoneLight")], n=32)]
    for sx in (1, -1):
        for sy in (1, -1):
            prof = ([(0, 0, LD), (0.23, 0, LD, 0.015), (0.24, 0.06, LD), (0.2, 0.07, S), (0.2, 0.4, S),
                     (0.225, 0.405, G), (0.225, 0.46, G), (0.2, 0.47, S, 0.03), (0.12, 0.53, S, 0.03), (0, 0.54, S)]
                    if K.LOD == 0 else
                    [(0, 0, LD), (0.24, 0, LD), (0.21, 0.07, S), (0.21, 0.44, S), (0.17, 0.5, S), (0, 0.54, S)])
            pad.append(lathe("pod", prof, n=16, matrix=place((sx * 0.62, sy * 0.62, 0))))
    for k in range(4):          # gold plaques with a cyan light strip on each side
        r = place(rot=(0, 0, 90 * k))
        pad.append(box("plaque", (0.46, 0.03, 0.16), "sandstoneLight", r @ place((0, -0.685, 0.19)), bevel=0.012))
        if K.LOD == 0:
            pad.append(box("strip", (0.32, 0.012, 0.025), "eyeCyan", r @ place((0, -0.702, 0.19)), bevel=0.0))
    mast = [cyl("mastBase", 0.11, 0.05, L, place((0, 0, 0.495)), n=16, bevel=0.015),
            lathe("column", [(0, 0.54, S), (0.07, 0.54, S), (0.055, 1.2, S), (0.06, 1.21, G, 0.006),
                             (0.06, 1.25, G, 0.006), (0.03, 1.26, G), (0, 1.26, G)], n=20),
            sphere("cap", 0.05, G, place((0, 0, 1.28)), n=12)]
    for k in range(3):          # three arms that cradle the ring
        a = math.radians(90 + 120 * k)
        c, s = math.cos(a), math.sin(a)
        arm = [(0.02 * c, 0.02 * s, 1.26), (0.14 * c, 0.14 * s, 1.31), (0.27 * c, 0.27 * s, 1.36)]
        mast.append(tube("arm", K.smooth_path(arm, 3) if K.LOD == 0 else arm[::2], 0.018, G, n=10))
        mast.append(box("clip", (0.05, 0.05, 0.06), G, place((0.3 * c, 0.3 * s, 1.37), (0, 0, math.degrees(a))),
                        bevel=0.0))
    rz = 1.42
    ring = [torus("ring", 0.3, 0.04, "eyeCyan", place((0, 0, rz)), n=28, m=8)]
    return {"pad": pad, "mast": mast, "ring": (ring, (0, 0, rz))}


@model("mother-tree-collar", "machine")
def mother_tree_collar():
    L, LD, S, G = "sandstone", "sandstoneDark", "sandstoneLight", "gold"
    top = 0.84
    def stones(t, z, key):        # staggered courses of stone blocks, every third one lighter
        if key != L or K.LOD == 1:
            return key
        course = 0 if z < 0.3 else 1 if z < 0.47 else 2
        idx = int((t / (2 * math.pi) * 10 + 0.5 * course) % 10)
        return S if (idx + course) % 3 == 0 else L

    base = [lathe("planter", [(0, 0.0, LD), (0.44, 0.0, LD, 0.03), (0.58, 0.07, LD, 0.06), (0.62, 0.1, L),
                              (0.72, 0.26, L, 0.12), (0.75, 0.42, L, 0.1), (0.735, 0.47, LD), (0.745, 0.48, L),
                              (0.7, 0.6, L, 0.06), (0.65, 0.64, LD), (0.62, 0.66, S), (0.62, top, S, 0.025),
                              (0.45, top, S), (0.25, top, LD), (0.25, top - 0.2, LD), (0, top - 0.2, "soilDark")],
                    n=30, paint=stones)]
    # brushed brass collar: an inner lip round the trunk hole and a flat flange, sitting on the planter top
    collar = [lathe("collar", [(0.25, top, G), (0.25, top + 0.08, G, 0.02), (0.31, top + 0.085, G, 0.02),
                               (0.32, top + 0.04, G, 0.01), (0.42, top + 0.04, G, 0.015), (0.45, top, G)], n=32)]
    if K.LOD == 0:                # rivets on the flange
        for k in range(8):
            a = 2 * math.pi * k / 8
            collar.append(sphere("rivet", 0.017, G, place((0.37 * math.cos(a), 0.37 * math.sin(a), top + 0.04)),
                                 n=8, squash=0.6))
    return {"base": base, "collar": collar}


@model("reservoir-basin", "machine")
def reservoir_basin():
    S, SL, G = "shell", "shellLow", "gold"
    basin = [lathe("basin", [(0, 0.0, SL), (0.62, 0.0, SL, 0.04), (0.82, 0.06, S, 0.1), (0.9, 0.15, S, 0.05),
                             (0.915, 0.16, G, 0.005), (0.915, 0.185, G, 0.005), (0.905, 0.19, SL),
                             (0.915, 0.26, SL, 0.01), (0.92, 0.27, S), (0.93, 0.47, S, 0.02),
                             (0.95, 0.475, G, 0.01), (0.95, 0.53, G, 0.025), (0.86, 0.535, G, 0.02),
                             (0.86, 0.49, S), (0.84, 0.17, S, 0.08), (0.7, 0.13, S), (0, 0.13, S)], n=44)]
    if K.LOD == 0:              # small gold feet
        for k in range(6):
            a = 2 * math.pi * (k + 0.5) / 6
            basin.append(sphere("foot", 0.06, "sandstone",
                                place((0.66 * math.cos(a), 0.66 * math.sin(a), 0.03)), n=10, squash=0.5))
    return {"basin": basin}


@model("bloom-relay", "machine")
def bloom_relay():
    L, LD, SL, G = "sandstone", "sandstoneDark", "sandstoneLight", "gold"
    pylon = [lathe("base", [(0, 0, LD), (0.62, 0, LD, 0.015), (0.63, 0.055, LD, 0.02), (0.6, 0.065, L),
                            (0.6, 0.11, L, 0.03), (0.34, 0.14, L, 0.03), (0.32, 0.15, LD, 0.01),
                            (0.32, 0.19, LD, 0.01), (0, 0.19, LD)], n=40),
             cyl("socket", 0.2, 0.07, SL, place((0, 0, 0.18)), n=8, bevel=0.02),
             box("column", (0.22, 0.22, 1.02), SL, place((0, 0, 0.75)), bevel=0.045),
             box("band", (0.25, 0.25, 0.05), G, place((0, 0, 1.1)), bevel=0.014),
             lathe("capital", [(0, 1.2, L), (0.15, 1.2, L), (0.26, 1.29, L, 0.03), (0.275, 1.3, G, 0.006),
                               (0.275, 1.34, G, 0.01), (0.22, 1.35, G), (0, 1.35, G)], n=32)]
    for k in range(6):          # light tiles on the base
        a = 2 * math.pi * k / 6
        pylon.append(box("tile", (0.12, 0.07, 0.03), SL,
                         place((0.47 * math.cos(a), 0.47 * math.sin(a), 0.122), (0, 0, math.degrees(a) + 90)),
                         bevel=0.01))
    for k in range(6):          # prongs curling up round the crystal
        a = 2 * math.pi * (k + 0.5) / 6
        c, s = math.cos(a), math.sin(a)
        pylon.append(tube("prong", K.smooth_path([(0.17 * c, 0.17 * s, 1.33), (0.24 * c, 0.24 * s, 1.45),
                                                  (0.22 * c, 0.22 * s, 1.57), (0.16 * c, 0.16 * s, 1.67)], 3),
                          0.026, G, n=10, taper=0.5))
    cz = 1.58
    crystal = [gem("crystal", 0.19, "coreGlow", place((0, 0, cz)))]
    return {"pylon": pylon, "crystal": (crystal, (0, 0, cz))}
