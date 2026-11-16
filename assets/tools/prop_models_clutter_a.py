"""Clutter group A: ac-unit, copper-pipe, crate, vent, lantern, lamp-post (hand-built, see prop_kit conventions).

Style: cream shell bodies, sandstone bases and bands, gold only for thin rims, bolts, knobs, valves and finials.
The lantern hangs: its pivot (origin) is the top of its ring and the model hangs below z = 0.
"""
import math

import bmesh

import prop_kit as K
from prop_kit import box, cyl, lathe, place, slab, torus, tube
from prop_models import model, leaf_outline  # noqa: F401  (leaf_outline: shared kit for the group files)

S2 = math.sqrt(2)
SQUARE = [math.pi / 4 + k * math.pi / 2 for k in range(4)]
OCT = [math.pi / 8 + k * math.pi / 4 for k in range(8)]


def cbox(name, size, key, matrix=None, ch=0.01):
    """A cheap box with one chamfer round every edge near (44 triangles), a plain box far."""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bm.transform(K.Matrix.Diagonal((*size, 1)))
    if ch > 0 and K.LOD == 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(ch, min(size) * 0.45), offset_type="OFFSET",
                        segments=1, profile=0.5, affect="EDGES", clamp_overlap=True)
    return K._object(name, bm, [key], matrix)


def sq(name, pts, matrix=None):
    """A square lathe: profile radii are half-widths of the square (sides face X and Y)."""
    return lathe(name, [(p[0] * S2, *p[1:]) for p in pts], angles=SQUARE, matrix=matrix)


def far(n0, n1):
    """A count near, another far (spokes, slats)."""
    return n0 if K.LOD == 0 else n1


# ================================================================ ac-unit
@model("ac-unit", "clutter")
def ac_unit():
    S, SL, SD, SA, G, D, I = "shell", "shellLow", "sandstoneDark", "sandstone", "gold", "darkFace", "iron"
    body = [
        box("plinth", (0.9, 0.66, 0.08), SD, place((0, 0, 0.04)), bevel=0.025),
        box("body", (0.82, 0.58, 0.5), S, place((0, 0, 0.33)), bevel=0.04),
        box("rim", (0.86, 0.62, 0.07), SA, place((0, 0, 0.6)), bevel=0.025),
        cbox("deck", (0.78, 0.54, 0.03), S, place((0, 0, 0.64)), ch=0.012),
    ]
    z0 = 0.65
    # fan shroud: a dark well with a thin gold lip
    body.append(lathe("collar", [(0, z0 + 0.012, D), (0.235, z0 + 0.012, D), (0.235, z0 + 0.088, D),
                                 (0.26, z0 + 0.1, G, 0.012), (0.29, z0 + 0.085, G), (0.29, z0 + 0.075, S),
                                 (0.3, z0, S)], n=20))
    # grille over the fan: radial spokes and one ring, open enough to see the blades turn
    zg = z0 + 0.094
    ns = far(6, 3)
    for k in range(ns):
        a = k * 2 * math.pi / ns
        body.append(tube("spoke", [(0.04 * math.cos(a), 0.04 * math.sin(a), zg),
                                   (0.245 * math.cos(a), 0.245 * math.sin(a), zg)], 0.006, I, n=8))
    if K.LOD == 0:
        body.append(torus("ring", 0.15, 0.007, I, place((0, 0, zg)), n=16, m=4))
    body.append(cyl("cap", 0.045, 0.016, G, place((0, 0, zg - 0.006)), n=12, bevel=0))
    # front: louvres on the left, service door on the right; louvres on the back too
    for sy in (-1, 1):
        y = sy * 0.29
        body.append(box("recess", (0.38, 0.012, 0.3), D, place((-0.15, y, 0.33)), bevel=0))
        for z in (0.22, 0.29, 0.36, 0.43) if sy < 0 or K.LOD == 0 else ():
            body.append(cbox("louvre", (0.36, 0.03, 0.034), SL, place((-0.15, y + sy * 0.008, z), (sy * 25, 0, 0)),
                             ch=0.006 if sy < 0 else 0))
    body.append(cbox("door", (0.24, 0.03, 0.36), S, place((0.23, -0.295, 0.33)), ch=0.012))
    body.append(cbox("handle", (0.07, 0.022, 0.025), G, place((0.23, -0.315, 0.41)), ch=0.006))
    # side: two copper lines down to the plinth
    for y in (-0.1, 0.06):
        body.append(tube("line", [(0.41, y, 0.3), (0.455, y, 0.29), (0.47, y, 0.25), (0.47, y, 0.08)],
                         0.018, "copper", n=8))
        if K.LOD == 0:
            body.append(cyl("fitting", 0.026, 0.02, G, place((0.405, y, 0.3), (0, 90, 0)), n=8, bevel=0))
    fz = z0 + 0.045
    fan = [cyl("hub", 0.05, 0.035, I, place((0, 0, fz - 0.02)), n=10, bevel=0)]
    for k in range(4):
        fan.append(cbox("blade", (0.19, 0.095, 0.012), SL, place((0, 0, fz), (25, 0, k * 90 + 20)) @ place((0.135, 0, 0)),
                        ch=0.005))
    return {"body": body, "fan": (fan, (0, 0, fz))}


# ================================================================ copper-pipe
@model("copper-pipe", "clutter")
def copper_pipe():
    C, G, S, D, SA = "copper", "gold", "shell", "darkFace", "sandstone"
    zc = 0.17
    prof = [(0, -0.465, D), (0.078, -0.465, D), (0.078, -0.5, C), (0.15, -0.5, C, 0.012),
            (0.15, -0.445, C, 0.012), (0.105, -0.44, C), (0.105, -0.2, C), (0.13, -0.195, G),
            (0.13, -0.175, G), (0.122, -0.17, S), (0.122, 0.17, S), (0.13, 0.175, G), (0.13, 0.195, G),
            (0.105, 0.2, G), (0.105, 0.44, C), (0.15, 0.445, C, 0.012), (0.15, 0.5, C, 0.012),
            (0.078, 0.5, C), (0.078, 0.465, C), (0, 0.465, D)]
    if K.LOD:                   # far: the gold bands go, the sleeve stays
        prof = [p for p in prof if p[2] != G]
    body = [lathe("pipe", prof, n=16, matrix=place((0, 0, zc), (0, 90, 0)))]
    rr = 0.108
    k = far(8, 4)
    arc = [(rr * math.cos(-math.pi * i / k), zc + rr * math.sin(-math.pi * i / k)) for i in range(k + 1)]
    cradle = [(-0.12, 0), (0.12, 0), (0.12, zc)] + arc + [(-0.12, zc)]
    for x in (-0.3, 0.3):
        body.append(slab("saddle", cradle, 0.07, SA, place((x, 0, 0), (0, 0, 90)), bevel=0.01))
    # valve bonnet on top of the sleeve
    body.append(lathe("bonnet", [(0, zc + 0.1, G), (0.045, zc + 0.1, G), (0.045, zc + 0.14, G, 0.008),
                                 (0.03, zc + 0.15, G), (0.014, zc + 0.155, G), (0.014, zc + 0.215, G),
                                 (0, zc + 0.215, G)], n=12))
    wz = zc + 0.225
    rim = (torus("wheel", 0.085, 0.012, G, place((0, 0, wz)), n=20, m=6) if K.LOD == 0 else
           lathe("wheel", [(0.073, wz - 0.01, G), (0.097, wz - 0.01, G), (0.097, wz + 0.01, G), (0.073, wz + 0.01, G)],
                 n=8, closed=True))
    wheel = [rim,
             cyl("hub", 0.022, 0.025, G, place((0, 0, wz - 0.012)), n=8, bevel=0)]
    for j in range(2):          # two bars across make the four spokes
        a = math.pi / 4 + j * math.pi / 2
        wheel.append(tube("spoke", [(-0.08 * math.cos(a), -0.08 * math.sin(a), wz),
                                    (0.08 * math.cos(a), 0.08 * math.sin(a), wz)], 0.007, G, n=8))
    return {"pipe": body, "wheel": (wheel, (0, 0, wz))}


# ================================================================ crate
@model("crate", "clutter")
def crate():
    W, Dp, H, b = 0.7, 0.62, 0.6, 0.075
    P, T, C = "kraft", "trunk", "copper"
    parts = [box("core", (W - 0.08, Dp - 0.08, H - 0.08), T, place((0, 0, H / 2)), bevel=0)]
    # edge battens (trunk) on all twelve edges
    for sx in (1, -1):
        for sy in (1, -1):
            parts.append(cbox("post", (b, b, H - 0.02), T, place((sx * (W - b) / 2, sy * (Dp - b) / 2, H / 2)), 0.012))
    for z in (b / 2, H - b / 2):
        for sy in (1, -1):
            parts.append(cbox("rail", (W - 2 * b, b, b), T, place((0, sy * (Dp - b) / 2, z)), 0.012))
        for sx in (1, -1):
            parts.append(cbox("rail", (b, Dp - 2 * b, b), T, place((sx * (W - b) / 2, 0, z)), 0.012))
    # plank infill: three planks per side, with real grooves between them
    gap, t = 0.014, 0.03

    def planks(span, n):
        w = (span - gap * (n - 1)) / n
        return [(-span / 2 + w / 2 + i * (w + gap), w) for i in range(n)]
    ph = H - 2 * b - 0.01
    for sy in (1, -1):
        for x, w in planks(W - 2 * b - 0.01, 3):
            parts.append(cbox("plank", (w, t, ph), P, place((x, sy * (Dp / 2 - t / 2 - 0.012), H / 2)), 0.008))
    for sx in (1, -1):
        for y, w in planks(Dp - 2 * b - 0.01, 3):
            parts.append(cbox("plank", (t, w, ph), P, place((sx * (W / 2 - t / 2 - 0.012), y, H / 2)), 0.008))
    for x, w in planks(W - 2 * b - 0.01, 3):
        parts.append(cbox("plank", (w, Dp - 2 * b - 0.01, t), P, place((x, 0, H - t / 2 - 0.012)), 0.008))
    # copper corner brackets
    c = 0.115
    for sx in (1, -1):
        for sy in (1, -1):
            for z in (c / 2 - 0.012, H - c / 2 + 0.012):
                parts.append(cbox("bracket", (c, c, c), C, place((sx * (W / 2 - c / 2 + 0.012),
                                                                  sy * (Dp / 2 - c / 2 + 0.012), z)), 0.022))
    return {"crate": parts}


# ================================================================ vent
@model("vent", "clutter")
def vent():
    S, SL, SA, SD, G, D = "shell", "shellLow", "sandstone", "sandstoneDark", "gold", "darkFace"
    body = [
        cbox("plinth", (0.8, 0.56, 0.05), SD, place((0, 0, 0.025)), ch=0.016),
        box("housing", (0.74, 0.5, 0.25), S, place((0, 0, 0.175)), bevel=0.04),
        cbox("band", (0.76, 0.52, 0.04), SA, place((0, 0, 0.1)), ch=0.012),
        box("hump", (0.27, 0.36, 0.12), S, place((-0.21, 0, 0.32)), bevel=0.045),
        box("grate", (0.2, 0.012, 0.075), D, place((-0.21, -0.18, 0.325)), bevel=0),
        box("hatch", (0.2, 0.02, 0.12), SL, place((0.14, -0.252, 0.19)), bevel=0.012),
        cyl("knob", 0.016, 0.012, G, place((0.14, -0.262, 0.19), (90, 0, 0)), n=8, bevel=0),
    ]
    for z in (0.3, 0.325, 0.35):
        body.append(cbox("louvre", (0.2, 0.02, 0.014), SL, place((-0.21, -0.188, z)), ch=0.004))
    x0 = 0.1
    body.append(lathe("duct", [(0, 0.3, S), (0.2, 0.3, SA), (0.2, 0.34, SA, 0.01), (0.15, 0.36, S),
                               (0.15, 0.47, S), (0.17, 0.475, SA), (0.17, 0.5, SA, 0.006),
                               (0.11, 0.505, SA), (0, 0.505, SA)], n=16, matrix=place((x0, 0, 0))))
    body.append(cyl("throat", 0.105, 0.15, D, place((x0, 0, 0.5)), n=12, bevel=0))
    n = far(12, 6)
    for k in range(n):
        a = 2 * math.pi * k / n
        body.append(box("slat", (0.028, 0.016, 0.14), S,
                        place((x0 + 0.112 * math.cos(a), 0.112 * math.sin(a), 0.575), (0, 0, math.degrees(a))), bevel=0))
    dome = [(0.25 * math.cos(a), 0.69 + 0.08 * math.sin(a), S) for a in [math.pi / 2 * i / 4 for i in range(1, 4)]]
    body.append(lathe("cap", [(0, 0.645, SL), (0.24, 0.648, SL), (0.27, 0.66, G, 0.008), (0.27, 0.675, G),
                              (0.25, 0.69, S)] + dome + [(0, 0.77, S)],
                      n=20, matrix=place((x0, 0, 0))))
    body.append(lathe("finial", [(0, 0.765, G), (0.028, 0.768, G, 0.008), (0.02, 0.785, G), (0, 0.8, G)],
                      n=8, matrix=place((x0, 0, 0))))
    return {"vent": body}


# ================================================================ lantern (hangs: pivot at the top of its ring)
@model("lantern", "clutter")
def lantern():
    S, SA, G = "shell", "sandstone", "gold"
    frame = [torus("ring", 0.03, 0.009, G, place((0, 0, -0.039), (90, 0, 0)), n=16, m=6),
             lathe("neck", [(0, -0.064, G), (0.014, -0.066, G), (0.011, -0.08, G),
                            (0.024, -0.086, G, 0.005), (0.024, -0.1, G), (0, -0.104, G)], n=12),
             sq("roof", [(0, -0.1, S), (0.03, -0.104, S, 0.008), (0.095, -0.158, S), (0.1, -0.163, G),
                         (0.1, -0.176, G, 0.005), (0.08, -0.18, G), (0, -0.18, G)]),
             sq("base", [(0, -0.37, G), (0.088, -0.37, G), (0.088, -0.38, G, 0.004),
                         (0.094, -0.384, SA, 0.006), (0.094, -0.398, SA, 0.006), (0.05, -0.414, SA), (0, -0.414, SA)]),
             lathe("drop", [(0, -0.412, G), (0.034, -0.412, G, 0.006), (0.03, -0.428, G, 0.008),
                            (0.01, -0.446, G), (0, -0.45, G)], n=12)]
    for sx in (1, -1):
        for sy in (1, -1):
            frame.append(box("post", (0.022, 0.022, 0.2), G, place((sx * 0.072, sy * 0.072, -0.275)), bevel=0.006))
    if K.LOD == 0:
        for sy in (1, -1):         # a thin cross bar on each pane
            frame.append(box("bar", (0.13, 0.008, 0.009), G, place((0, sy * 0.068, -0.3)), bevel=0))
            frame.append(box("bar", (0.008, 0.13, 0.009), G, place((sy * 0.068, 0, -0.3)), bevel=0))
    glass = [box("glass", (0.135, 0.135, 0.19), "windowLit", place((0, 0, -0.275)), bevel=0.008)]
    return {"lantern": frame, "glass": glass}


# ================================================================ lamp-post
@model("lamp-post", "clutter")
def lamp_post():
    S, SA, SD, G, L = "shell", "sandstone", "sandstoneDark", "gold", "windowLit"
    post = [lathe("base", [(0, 0, SD), (0.25, 0, SD, 0.01), (0.25, 0.06, SD, 0.012), (0.21, 0.07, SD),
                           (0.195, 0.075, SA), (0.165, 0.5, SA), (0.175, 0.51, SA, 0.008),
                           (0.175, 0.55, SA), (0.12, 0.56, SA), (0, 0.56, SA)], angles=OCT),
            lathe("post", [(0, 0.55, G), (0.08, 0.555, G, 0.006), (0.08, 0.575, G), (0.06, 0.59, S),
                           (0.05, 1.7, S), (0.068, 1.71, SA, 0.006), (0.068, 1.75, SA), (0.05, 1.76, S),
                           (0.05, 1.84, S), (0.085, 1.86, S, 0.012), (0.085, 1.88, G), (0.1, 1.885, G),
                           (0.1, 1.915, SA, 0.01), (0.06, 1.96, SA), (0, 1.96, SA)], n=12),
            sq("tray", [(0, 1.955, G), (0.07, 1.955, G), (0.125, 2.02, G, 0.006), (0.125, 2.04, G), (0, 2.04, G)]),
            sq("roof", [(0, 2.35, G), (0.18, 2.35, G, 0.006), (0.195, 2.37, G), (0.2, 2.385, S, 0.008),
                        (0.185, 2.4, S), (0.045, 2.52, S, 0.01), (0, 2.53, S)]),
            lathe("finial", [(0, 2.52, G), (0.032, 2.52, G, 0.006), (0.036, 2.545, G, 0.008), (0.012, 2.58, G),
                             (0, 2.6, G)], n=10)]
    for sx in (1, -1) if K.LOD == 0 else ():        # gold corner bars of the lantern head
        for sy in (1, -1):
            post.append(tube("bar", [(sx * 0.115, sy * 0.115, 2.035), (sx * 0.172, sy * 0.172, 2.355)], 0.012, G, n=8))
    light = [sq("light", [(0, 2.04, L), (0.11, 2.04, L), (0.165, 2.352, L), (0, 2.352, L)])]
    return {"post": post, "light": (light, (0, 0, 2.2))}
