"""Fences and the bean trellis (#466, hand-built, see prop_kit conventions).

Fences are decoration only. Each style has three pieces that snap along tile edges (1 tile = 1 m):
  fence-<style>-run    one tile edge, from x = -0.5 to 0.5 on the line y = 0 (no posts: posts go at the corners)
  fence-<style>-post   the corner or end post, centred on the origin (a tile corner)
  fence-<style>-gate   one tile edge with a gate; the part "gate" swings about Z on its hinge at its origin
                       (the left end, x < 0), so the game opens it by turning that part as bloombot walks through
Styles, all salvaged materials: picket (salvaged planks), willow (woven willow hurdle), pipe (scrap metal and pipe
rail), stone (low dry-stone wall), hedge (clipped hedge; its part "leaves" is the bit the wind sways).

trellis: a crop support for beans, standing on a planter or farmland tile (not a fence).
"""
import math
import random

import prop_kit as K
from prop_kit import box, cyl, place, slab, sphere, tube
from prop_models import model
from prop_models_clutter_a import cbox

K.PAL.update({
    "willow": ("#A9824F", 0.85, 0.0, 0, 1), "willowDark": ("#7E5D3A", 0.85, 0.0, 0, 1),
    "plankGrey": ("#B9A88C", 0.8, 0.0, 0, 1),
    "hedge": ("#4F8A3A", 0.9, 0.0, 0, 1), "hedgeLight": ("#6FA84A", 0.9, 0.0, 0, 1),
})

PLANKS = ("kraft", "trunk", "plankGrey", "sandstoneDark")


def far(n0, n1):
    return n0 if K.LOD == 0 else n1


def picket_board(x, w, h, key, tilt, y=0.0):
    """One salvaged picket: a plank with a pointed top, its foot at z = 0.04."""
    o = [(-w / 2, 0), (w / 2, 0), (w / 2, h - w * 0.55), (0, h), (-w / 2, h - w * 0.55)]
    return slab("picket", o, 0.022, key, place((x, y, 0.04), (0, tilt, 0)), bevel=0.004)


# ================================================================ salvaged-plank picket
def picket_panel(x0, x1, R, h=0.78):
    parts = []
    span = x1 - x0
    for z in (0.22, 0.56):
        parts.append(box("rail", (span, 0.035, 0.06), "trunk", place(((x0 + x1) / 2, 0.03, z)), bevel=0.008))
    n = max(2, round(span / 0.16))
    for i in range(n):
        x = x0 + span * (i + 0.5) / n
        parts.append(picket_board(x, 0.1 + R.uniform(-0.01, 0.015), h + R.uniform(-0.06, 0.03),
                                  PLANKS[R.randrange(len(PLANKS))], R.uniform(-3, 3)))
    return parts


@model("fence-picket-run", "fence")
def fence_picket_run():
    return {"fence": picket_panel(-0.5, 0.5, random.Random(11))}


@model("fence-picket-post", "fence")
def fence_picket_post():
    p = [box("post", (0.09, 0.09, 0.86), "trunk", place((0, 0, 0.43)), bevel=0.01),
         slab("cap", [(-0.06, 0), (0.06, 0), (0.06, 0.03), (0, 0.08), (-0.06, 0.03)], 0.11, "kraft",
              place((0, 0, 0.86)), bevel=0.006)]
    if K.LOD == 0:
        p.append(cyl("nail", 0.012, 0.006, "rust", place((0, -0.046, 0.6), (90, 0, 0)), n=6, bevel=0))
    return {"post": p}


@model("fence-picket-gate", "fence")
def fence_picket_gate():
    R = random.Random(12)
    leaf = picket_panel(-0.45, 0.45, R, 0.74)
    leaf.append(box("brace", (0.84, 0.03, 0.05), "trunk", place((0, 0.03, 0.39), (0, -24, 0)), bevel=0.006))
    leaf.append(box("latch", (0.06, 0.03, 0.03), "iron", place((0.4, -0.03, 0.5)), bevel=0.004))
    for z in (0.22, 0.56):
        leaf.append(box("hinge", (0.12, 0.012, 0.03), "iron", place((-0.39, 0.055, z)), bevel=0.003))
    return {"gate": (leaf, (-0.45, 0, 0))}


# ================================================================ woven willow hurdle
def hurdle(x0, x1, h, rows):
    parts = []
    span = x1 - x0
    stakes = max(3, round(span / 0.17)) + 1
    xs = [x0 + span * i / (stakes - 1) for i in range(stakes)]
    for x in xs:
        parts.append(K.cyl("stake", 0.016, h + 0.06, "willowDark", place((x, 0, 0)), n=6, bevel=0))
    for r in range(rows):
        z = 0.08 + (h - 0.12) * r / (rows - 1)
        ph = 1 if r % 2 else -1
        pts = []
        for i, x in enumerate(xs):
            pts.append((x, ph * (0.022 if i % 2 else -0.022), z))
        pts = K.smooth_path(pts, 3)
        parts.append(tube("withy", pts, 0.02, "willow" if r % 3 else "willowDark", n=4))
    return parts


@model("fence-willow-run", "fence")
def fence_willow_run():
    return {"fence": hurdle(-0.5, 0.5, 0.72, far(12, 6))}


@model("fence-willow-post", "fence")
def fence_willow_post():
    return {"post": [K.cyl("post", 0.035, 0.84, "willowDark", place(), n=10, bevel=0.01),
                     tube("tie", [(0.04 * math.cos(a), 0.04 * math.sin(a), 0.62) for a in
                                  [2 * math.pi * i / 8 for i in range(9)]], 0.008, "willow", n=4)]}


@model("fence-willow-gate", "fence")
def fence_willow_gate():
    leaf = hurdle(-0.43, 0.43, 0.66, far(11, 5))
    leaf.append(K.cyl("hingepost", 0.024, 0.74, "willowDark", place((-0.45, 0, 0)), n=8, bevel=0))
    leaf.append(tube("hoop", [(-0.45 + 0.03 * math.cos(a), 0.03 * math.sin(a), 0.55) for a in
                              [2 * math.pi * i / 8 for i in range(9)]], 0.008, "iron", n=4))
    return {"gate": (leaf, (-0.45, 0, 0))}


# ================================================================ scrap metal and pipe rail
def pipe_panel(x0, x1, R, h=0.86):
    parts = [tube("toprail", [(x0, 0, h), (x1, 0, h)], 0.024, "copper", n=10),
             tube("midrail", [(x0, 0, 0.5), (x1, 0, 0.5)], 0.02, "iron", n=8)]
    for ux in (x0 + (x1 - x0) * 0.25, x0 + (x1 - x0) * 0.75):     # pipe uprights tie the rails down
        parts.append(tube("upright", [(ux, -0.01, 0.0), (ux, -0.01, h)], 0.016, "iron", n=6))
    # salvaged sheets bolted below the mid rail, each a different scrap
    x = x0 + 0.02
    keys = ("rust", "iron", "concrete", "rust")
    i = 0
    while x < x1 - 0.1:
        w = min(x1 - 0.02 - x, R.uniform(0.28, 0.42))
        parts.append(box("sheet", (w, 0.012, 0.36), keys[i % 4],
                         place((x + w / 2, 0.022, 0.29 + R.uniform(-0.02, 0.02)), (0, R.uniform(-2.5, 2.5), 0)),
                         bevel=0.003))
        if K.LOD == 0:
            for bx in (x + 0.05, x + w - 0.05):
                parts.append(cyl("bolt", 0.011, 0.008, "gold", place((bx, 0.03, 0.44), (-90, 0, 0)), n=6, bevel=0))
        x += w + 0.015
        i += 1
    return parts


@model("fence-pipe-run", "fence")
def fence_pipe_run():
    return {"fence": pipe_panel(-0.5, 0.5, random.Random(21))}


@model("fence-pipe-post", "fence")
def fence_pipe_post():
    return {"post": [cyl("post", 0.04, 0.92, "iron", place(), n=12, bevel=0.008),
                     cyl("collar", 0.047, 0.03, "gold", place((0, 0, 0.84)), n=12, bevel=0.004),
                     cyl("cap", 0.05, 0.03, "copper", place((0, 0, 0.92)), n=12, bevel=0.01, top="copper"),
                     cyl("foot", 0.07, 0.04, "concrete", place(), n=12, bevel=0.01)]}


@model("fence-pipe-gate", "fence")
def fence_pipe_gate():
    leaf = [tube("frame", [(-0.45, 0, 0.06), (-0.45, 0, 0.82), (0.43, 0, 0.82), (0.43, 0, 0.06), (-0.45, 0, 0.06)],
                 0.02, "iron", n=8),
            tube("brace", [(-0.43, 0, 0.1), (0.41, 0, 0.78)], 0.014, "copper", n=8),
            box("sheet", (0.8, 0.012, 0.3), "rust", place((-0.01, 0.022, 0.25)), bevel=0.003),
            box("latch", (0.05, 0.04, 0.03), "gold", place((0.44, -0.02, 0.6)), bevel=0.004)]
    return {"gate": (leaf, (-0.45, 0, 0))}


# ================================================================ low dry-stone wall
STONES = ("sandstone", "limestone", "sandstoneDark", "limestoneDark", "sandstoneLight")


def stones(x0, x1, R, courses=3, h=0.48, depth=0.34):
    parts = []
    ch = (h - 0.08) / courses
    for c in range(courses):
        x = x0 + (0 if c % 2 == 0 else -0.08)
        while x < x1 - 0.02:
            w = R.uniform(0.18, 0.3)
            a, b = max(x, x0), min(x + w, x1)
            if b - a > 0.05:
                d = depth - c * 0.03
                parts.append(cbox("stone", (b - a - 0.012, d + R.uniform(-0.03, 0.02), ch * R.uniform(0.82, 0.98)),
                                  STONES[R.randrange(len(STONES))],
                                  place(((a + b) / 2, R.uniform(-0.015, 0.015), ch * (c + 0.5)),
                                        (R.uniform(-3, 3), R.uniform(-3, 3), R.uniform(-3, 3))), ch=0.02))
            x += w
    # capstones on edge along the top
    x = x0
    while x < x1 - 0.02:
        w = R.uniform(0.09, 0.14)
        b = min(x + w, x1)
        parts.append(cbox("cap", (b - x - 0.01, 0.2, 0.1), STONES[R.randrange(len(STONES))],
                          place(((x + b) / 2, 0, h - 0.04), (0, R.uniform(-8, 8), 0)), ch=0.015))
        x += w
    return parts


@model("fence-stone-run", "fence")
def fence_stone_run():
    return {"fence": stones(-0.5, 0.5, random.Random(31))}


@model("fence-stone-post", "fence")
def fence_stone_post():
    R = random.Random(32)
    p = []
    for c, z in enumerate((0.1, 0.27, 0.43)):
        p.append(cbox("block", (0.36 - c * 0.03, 0.36 - c * 0.03, 0.17), STONES[R.randrange(len(STONES))],
                      place((0, 0, z), (0, 0, R.uniform(-6, 6))), ch=0.02))
    p.append(cbox("top", (0.38, 0.38, 0.07), "limestone", place((0, 0, 0.55)), ch=0.02))
    return {"post": p}


@model("fence-stone-gate", "fence")
def fence_stone_gate():
    R = random.Random(33)
    stubs = stones(-0.5, -0.38, R) + stones(0.38, 0.5, R)
    leaf = []
    for z in (0.12, 0.42):
        leaf.append(box("rail", (0.72, 0.03, 0.06), "trunk", place((0, 0.02, z)), bevel=0.006))
    for i in range(5):
        x = -0.29 + 0.145 * i
        leaf.append(box("board", (0.13, 0.022, 0.5), PLANKS[R.randrange(len(PLANKS))],
                        place((x, -0.008, 0.29)), bevel=0.004))
    leaf.append(box("latch", (0.05, 0.03, 0.03), "iron", place((0.34, -0.035, 0.36)), bevel=0.004))
    return {"wall": stubs, "gate": (leaf, (-0.37, 0, 0))}


# ================================================================ clipped hedge
def hedge_block(x0, x1, R, h=0.86):
    """A clipped hedge: a squared body with soft lumps, light on top, darker below."""
    leaves = [box("body", (x1 - x0, 0.42, h - 0.12), "hedge", place(((x0 + x1) / 2, 0, (h - 0.12) / 2 + 0.06)),
                  bevel=0.12, keys={"top": "hedgeLight"})]
    n = max(1, round((x1 - x0) / 0.34))
    for i in range(n):
        x = x0 + (x1 - x0) * (i + 0.5) / n
        leaves.append(sphere("lump", 0.2, "hedgeLight", place((x + R.uniform(-0.04, 0.04), 0,
                                                                h - 0.16), scale=(1.0, 1.0, 0.45)), n=far(12, 8)))
        if K.LOD == 0:
            for sy in (-1, 1):
                leaves.append(sphere("tuft", 0.12, "hedge", place((x + R.uniform(-0.1, 0.1), sy * 0.17,
                                                                   R.uniform(0.25, 0.6)), scale=(1, 0.4, 0.9)), n=8))
    return leaves


@model("fence-hedge-run", "fence")
def fence_hedge_run():
    return {"leaves": hedge_block(-0.5, 0.5, random.Random(41))}


@model("fence-hedge-post", "fence")
def fence_hedge_post():
    R = random.Random(42)
    return {"leaves": [box("body", (0.44, 0.44, 0.8), "hedge", place((0, 0, 0.46)), bevel=0.1,
                           keys={"top": "hedgeLight"}),
                       sphere("knob", 0.21, "hedgeLight", place((0, 0, 0.8), scale=(1, 1, 0.5)), n=far(12, 8))]
            + ([sphere("tuft", 0.1, "hedge", place((0.2 * math.cos(a), 0.2 * math.sin(a), R.uniform(0.3, 0.6)),
                                                   scale=(0.7, 0.7, 1)), n=8)
                for a in (0.4, 2.0, 3.6, 5.2)] if K.LOD == 0 else [])}


@model("fence-hedge-gate", "fence")
def fence_hedge_gate():
    R = random.Random(43)
    stubs = hedge_block(-0.5, -0.36, R) + hedge_block(0.36, 0.5, R)
    leaf = []
    for z in (0.14, 0.58):
        leaf.append(box("rail", (0.7, 0.03, 0.05), "trunk", place((0, 0, z)), bevel=0.006))
    for i in range(6):
        leaf.append(picket_board(-0.29 + 0.116 * i, 0.09, 0.66, PLANKS[i % len(PLANKS)], 0, y=-0.025))
    return {"leaves": stubs, "gate": (leaf, (-0.35, 0, 0))}


# ================================================================ bean trellis
@model("trellis", "fence")
def trellis():
    """Two posts and a diamond lattice of thin slats, 0.8 m wide and 1.5 m tall, twine on the top bar."""
    p = []
    for sx in (-1, 1):
        p.append(box("post", (0.045, 0.045, 1.5), "trunk", place((sx * 0.4, 0, 0.75)), bevel=0.006))
    p.append(box("top", (0.88, 0.04, 0.04), "trunk", place((0, 0, 1.47)), bevel=0.006))
    # diagonal slats both ways, clipped to the frame by length
    w, z0, z1 = 0.78, 0.12, 1.42
    step = 0.2
    for d in (1, -1):
        k = -1.6
        while k < 1.6:
            # line x = d * (z - zc) + k*? : walk lines at 45 degrees, x - d*z = k
            pts = []
            for z in (z0, z1):
                x = k + d * (z - (z0 + z1) / 2)
                pts.append((x, z))
            (xa, za), (xb, zb) = pts
            # clip to |x| <= w/2
            def clip(xa, za, xb, zb):
                if xa > xb:
                    xa, za, xb, zb = xb, zb, xa, za
                if xb < -w / 2 or xa > w / 2:
                    return None
                t0 = max(0.0, (-w / 2 - xa) / (xb - xa)); t1 = min(1.0, (w / 2 - xa) / (xb - xa))
                return (xa + (xb - xa) * t0, za + (zb - za) * t0, xa + (xb - xa) * t1, za + (zb - za) * t1)
            c = clip(xa, za, xb, zb)
            if c:
                ax, az, bx, bz = c
                L = math.hypot(bx - ax, bz - az)
                if L > 0.08:
                    ang = math.degrees(math.atan2(bz - az, bx - ax))
                    p.append(box("slat", (L, 0.012, 0.022), "kraft",
                                 place(((ax + bx) / 2, d * 0.008, (az + bz) / 2), (0, -ang, 0)), bevel=0))
            k += step
    if K.LOD == 0:
        p.append(tube("twine", [(-0.38, -0.025, 1.43), (-0.1, -0.03, 1.4), (0.15, -0.03, 1.41), (0.38, -0.025, 1.43)],
                      0.006, "willow", n=4))
    return {"trellis": p}
