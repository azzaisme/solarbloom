"""The hand-built models, one function each, using prop_kit (see its conventions: metres, up +Z, front -Y,
pivot at the base centre). Each function returns {part name: objects or (objects, pivot)}; build_props.py joins
each part into one object, so a part is anything the game moves on its own (a lid, a fan, a wheel).

The Tripo models in assets/raw/tripo/models/ are the shape guides: same layout and proportions, rebuilt clean.
Sizes follow docs/art/meshy-assets.md (1 tile = 1 m).
"""
import math

import prop_kit as K
from prop_kit import box, cyl, frame, join, lathe, place, slab, sphere, torus, tube

MODELS = {}


def model(name, klass):
    def reg(fn):
        MODELS[name] = (klass, fn)
        return fn
    return reg


def leaf_outline(length, width, n=14, lobes=0.0):
    """A pointed leaf from its base (0, 0) to its tip (0, length), counter-clockwise."""
    n = n if K.LOD == 0 else max(5, n // 2)
    right = []
    for i in range(1, n):
        t = i / n
        w = width / 2 * math.sin(math.pi * t) ** 0.75 * (1 - 0.35 * t)
        w *= 1 + lobes * math.cos(5 * math.pi * t) * math.sin(math.pi * t)
        right.append((w, length * t))
    return [(0, 0)] + right + [(0, length)] + [(-x, y) for x, y in reversed(right)]


# ================================================================ machines
@model("water-condenser", "machine")
def water_condenser():
    body = [
        box("plinth", (0.62, 0.62, 0.07), "sandstoneDark", place((0, 0, 0.035)), bevel=0.02),
        box("base", (0.54, 0.54, 0.13), "sandstone", place((0, 0, 0.13)), bevel=0.035),
        lathe("body", [(0, 0.19, "shell"), (0.25, 0.19, "shell", 0.02), (0.25, 0.29, "shell"),
                       (0.258, 0.30, "sandstone", 0.005), (0.258, 0.33, "sandstone", 0.005), (0.245, 0.34, "sandstone"),
                       (0.225, 0.60, "shell"), (0.25, 0.61, "sandstone", 0.01), (0.25, 0.665, "sandstone", 0.01),
                       (0.25, 0.68, "gold"), (0.18, 0.68, "gold"), (0, 0.68, "gold")], n=32),
    ]
    for sx in (1, -1):        # side pipes down to the plinth, gold flanges at the body
        body.append(tube("pipe", K.smooth_path([(0.2 * sx, 0, 0.5), (0.31 * sx, 0, 0.5), (0.35 * sx, 0, 0.44),
                                                (0.35 * sx, 0, 0.22), (0.31 * sx, 0, 0.16)], 3), 0.024, "copper", n=12))
        body.append(cyl("flange", 0.04, 0.025, "gold", place((0.235 * sx, 0, 0.5), (0, 90 * sx, 0)), n=16, bevel=0.006))
    for k in range(4):        # gold struts round the glass
        a = math.pi / 4 + k * math.pi / 2
        x, y = 0.21 * math.cos(a), 0.21 * math.sin(a)
        body.append(tube("strut", [(x, y, 0.68), (x, y, 1.12)], 0.012, "gold", n=8))
    tank = [cyl("tank", 0.19, 0.44, "glass", place((0, 0, 0.68)), n=32, bevel=0.0)]
    water = [cyl("water", 0.172, 0.25, "water", place((0, 0, 0.69)), n=32, bevel=0.01)]
    lid = [lathe("lid", [(0, 1.12, "gold"), (0.225, 1.12, "gold", 0.008), (0.225, 1.16, "gold", 0.008),
                         (0.205, 1.165, "shell", 0.01)] +
                 [(0.205 * math.cos(a), 1.165 + 0.13 * math.sin(a), "shell")
                  for a in [math.pi / 2 * i / 5 for i in range(1, 5)]] +
                 [(0.05, 1.29, "shell"), (0.045, 1.30, "gold", 0.005), (0.045, 1.34, "gold", 0.01), (0, 1.35, "gold")],
                 n=32)]
    valve = [cyl("spout", 0.035, 0.12, "gold", place((0, -0.22, 0.43), (90, 0, 0)), n=12, bevel=0.008),
             cyl("tip", 0.045, 0.03, "gold", place((0, -0.33, 0.43), (90, 0, 0)), n=12, bevel=0.008),
             lathe("nozzle", [(0.02, 0.0, "gold"), (0.03, -0.06, "gold", 0.01), (0, -0.06, "gold")],
                   n=12, matrix=place((0, -0.335, 0.43))),
             cyl("stem", 0.012, 0.07, "gold", place((0, -0.28, 0.455)), n=8, bevel=0.0),
             torus("wheel", 0.045, 0.01, "copper", place((0, -0.28, 0.525)), n=16, m=6),
             cyl("hub", 0.015, 0.02, "copper", place((0, -0.28, 0.515)), n=8, bevel=0.004)]
    return {"body": body, "tank": tank, "water": water, "lid": (lid, (0, 0, 1.12)),
            "valve": (valve, (0, -0.28, 0.43))}


@model("rooftop-core", "machine")
def rooftop_core():
    L, LD, G, SL = "sandstone", "sandstoneDark", "gold", "sandstoneLight"
    dais = [lathe("dais", [(0, 0, LD), (0.95, 0, LD, 0.02), (0.95, 0.15, L, 0.04), (0.78, 0.15, L, 0.015),
                           (0.78, 0.175, SL, 0.006), (0.77, 0.19, SL, 0.006), (0.765, 0.20, L),
                           (0.765, 0.31, L, 0.03), (0.6, 0.31, L, 0.015), (0.6, 0.335, G, 0.006),
                           (0.59, 0.35, G, 0.006), (0.585, 0.36, L), (0.585, 0.44, L, 0.025), (0, 0.44, L)], n=40)]
    y0, z0, depth = 0.2, 0.44, 0.28
    outer = K.arch_outline(1.12, 1.5, 20)
    inner = K.arch_outline(0.74, 1.3, 20, base=0.12)
    trim_out = K.arch_outline(0.82, 1.34, 20, base=0.08)
    arch = [frame("arch", outer, inner, depth, "shell", place((0, y0, z0)), bevel=0.035),
            slab("niche", inner, 0.05, "sandstoneDark", place((0, y0 + 0.1, z0)), bevel=0.0),
            frame("trim", trim_out, inner, 0.03, G, place((0, y0 - depth / 2 - 0.004, z0)), bevel=0.008),
            cyl("seat", 0.2, 0.05, SL, place((0, y0 - 0.04, z0 + 0.12)), n=32, bevel=0.015),
            box("footL", (0.28, 0.38, 0.08), "sandstone", place((-0.47, y0, z0 + 0.04)), bevel=0.025),
            box("footR", (0.28, 0.38, 0.08), "sandstone", place((0.47, y0, z0 + 0.04)), bevel=0.025)]
    # leaf emblem in the niche (the game makes it glow when the core wakes), with raised veins
    lz, ly, ln = z0 + 0.2, y0 - 0.03, 0.85
    leaf = slab("leaf", leaf_outline(ln, 0.56, 18, lobes=0.04), 0.05, "leafFin", place((0, ly, lz)), bevel=0.014)
    fy = ly - 0.027
    veins = [tube("midrib", [(0, fy, lz - 0.06), (0, fy, lz + ln * 0.9)], 0.011, "leafVein", n=8)]
    for t, s in ((0.2, 0.17), (0.38, 0.16), (0.56, 0.12), (0.72, 0.07)):
        for sx in (1, -1):
            veins.append(tube("vein", [(0, fy, lz + ln * t), (sx * s, fy, lz + ln * t + 0.1)], 0.007, "leafVein", n=8))
    return {"dais": dais, "arch": arch, "emblem": ([leaf] + veins, (0, ly, lz + ln / 2))}


# ================================================================ area obstacles
@model("bench", "obstacle")
def bench():
    left = []
    x = -0.66
    left.append(tube("frontleg", K.smooth_path([(x, -0.2, 0.0), (x, -0.27, 0.04), (x, -0.25, 0.14),
                                                (x, -0.2, 0.3), (x, -0.22, 0.42)], 2), 0.034, "iron", n=8))
    left.append(tube("backleg", K.smooth_path([(x, 0.25, 0.0), (x, 0.2, 0.2), (x, 0.17, 0.42),
                                               (x, 0.24, 0.62), (x, 0.3, 0.86)], 2), 0.034, "iron", n=8))
    left.append(tube("arm", K.smooth_path([(x, 0.21, 0.6), (x, -0.05, 0.62), (x, -0.26, 0.6),
                                           (x, -0.31, 0.55), (x, -0.27, 0.51), (x, -0.23, 0.54)], 2),
                     0.03, "iron", n=8))
    left.append(tube("rail", [(x, -0.25, 0.41), (x, 0.2, 0.41)], 0.02, "iron", n=8))
    left.append(box("foot", (0.09, 0.1, 0.035), "iron", place((x, -0.21, 0.015)), bevel=0.01))
    left.append(box("foot", (0.09, 0.1, 0.035), "iron", place((x, 0.25, 0.015)), bevel=0.01))
    frame_r = K.mirror_x(left)
    slats = []
    for y in (-0.19, -0.05, 0.09):
        slats.append(box("seat", (1.46, 0.12, 0.035), "kraft", place((0, y, 0.445)), bevel=0.012))
    for z, y in ((0.6, 0.235), (0.76, 0.275)):
        slats.append(box("back", (1.46, 0.035, 0.12), "kraft", place((0, y, z), (-14, 0, 0)), bevel=0.012))
    bolts = []
    if K.LOD == 0:
        for sx in (1, -1):
            for y in (-0.19, -0.05, 0.09):
                bolts.append(cyl("bolt", 0.014, 0.006, "gold", place((sx * 0.66, y, 0.462)), n=6, bevel=0))
            for z, y in ((0.6, 0.235), (0.76, 0.275)):
                bolts.append(cyl("bolt", 0.014, 0.006, "gold",
                                 place((sx * 0.66, y - 0.018, z), (90 - 14, 0, 0)), n=6, bevel=0))
    return {"bench": left + frame_r + slats + bolts}


@model("bollard", "obstacle")
def bollard():
    G, S, D = "sandstone", "shell", "sandstoneDark"
    dome = [(0.12 * math.cos(a), 0.55 + 0.13 * math.sin(a), S) for a in [math.pi / 2 * i / 4 for i in range(1, 4)]]
    return {"bollard": [lathe("bollard", [(0, 0, D), (0.17, 0, D, 0.015), (0.17, 0.06, D, 0.02), (0.125, 0.07, D),
                                          (0.125, 0.075, S, 0.008), (0.115, 0.39, S), (0.117, 0.392, "gold"),
                                          (0.118, 0.405, "gold"), (0.125, 0.415, G, 0.01),
                                          (0.165, 0.47, G, 0.02), (0.165, 0.515, G, 0.02), (0.13, 0.54, G),
                                          (0.12, 0.55, S)] + dome + [(0, 0.68, S)], n=24)]}


@model("barrel", "obstacle")
def barrel():
    H, W, G = 0.8, "kraft", "iron"
    staves = 12
    hoops = ((0.12, 0.17), (0.63, 0.68), (0.75, H + 0.01))
    step = 2 * math.pi / staves
    gap = step * 0.05
    per = [0.0, gap, gap + (step - gap) / 2] if K.LOD == 0 else [0.0, gap]
    angles = [k * step + a for k in range(staves) for a in per]

    def on_hoop(z):
        return any(a - 0.003 <= z <= b + 0.003 for a, b in hoops)

    def radial(t, z):       # the line between staves is inset a little, not on the hoops
        return 1.0 if on_hoop(z) or (t % step) > gap * 1.01 else 0.982

    def paint(t, z, key):
        return "trunk" if key == W and 0.031 < z < H - 0.03 and (t % step) < gap else key

    def r(z):
        return 0.25 + 0.055 * math.sin(math.pi * z / H)
    hp = 0.012
    pts = [(0, 0.03, W), (r(0) - 0.01, 0.03, W), (r(0), 0.0, W, 0.01),
           (r(0.12), 0.12, W), (r(0.12) + hp, 0.122, G), (r(0.17) + hp, 0.168, G),
           (r(0.17), 0.17, W), (r(0.4), 0.4, W), (r(0.63), 0.63, W), (r(0.63) + hp, 0.632, G),
           (r(0.68) + hp, 0.678, G), (r(0.68), 0.68, W), (r(0.75), 0.75, W),
           (r(0.75) + hp, 0.752, G), (r(H) + hp, H, G, 0.006),
           (r(H) - 0.02, H, G, 0.004), (r(H) - 0.022, H - 0.025, W), (0, H - 0.025, W)]
    body = (lathe("barrel", pts, angles=angles, radial=radial, paint=paint) if K.LOD == 0
            else lathe("barrel", pts, n=12))
    bung = cyl("bung", 0.035, 0.012, "gold", place((0.1, 0.06, H - 0.025)), n=12, bevel=0.004)
    return {"barrel": [body, bung]}


# ================================================================ planters
@model("planter-pot", "planter")
def planter_pot():
    S, G, SL = "shell", "sandstone", "sandstoneDark"
    pot = lathe("pot", [(0, 0.0, SL), (0.24, 0.0, SL, 0.02), (0.27, 0.11, SL), (0.29, 0.12, G),
                        (0.31, 0.165, G), (0.305, 0.17, S), (0.34, 0.26, S), (0.345, 0.33, S),
                        (0.33, 0.41, S), (0.30, 0.46, S), (0.31, 0.47, G), (0.335, 0.49, G, 0.015),
                        (0.335, 0.53, G, 0.015), (0.285, 0.535, G), (0.28, 0.42, SL), (0, 0.42, SL)], n=24)
    soil = lathe("soil", [(0, 0.47, "soil"), (0.283, 0.45, "soil")], n=24)
    return {"pot": [pot], "soil": [soil]}


# ================================================================ more models, one file per group
# prop_models_<group>.py files register their own models with @model (they import it from here).
def _load_groups():
    import glob
    import importlib
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    for f in sorted(glob.glob(os.path.join(here, "prop_models_*.py"))):
        importlib.import_module(os.path.splitext(os.path.basename(f))[0])


_load_groups()
