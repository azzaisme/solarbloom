"""
House floor and wall finishes for epic #846, painted with klad (https://github.com/klad-app/klad).

Each finish is a seamless 512 px tile, painted in the middle of a 1024 px canvas (see out()). This script writes
the klad ops for one finish as JSON lines; `assets/tools/klad_house_textures.sh` pipes them into `klad apply`,
renders the middle 512 px to `assets/raw/textures/house/<name>.png`, and measures the seams. The `.klad` bundle is
kept next to the PNG so a finish can be opened in the klad editor and repainted by hand.

    python assets/tools/klad_house_textures.py boards > ops.jsonl

Colours follow PALETTE.house (src/rendering/Palette.ts): warm boards, cream plaster, terracotta, sage.
"""
import json
import math
import random
import re
import sys

S = 512  # the tile, px
O = 256  # where the tile sits on the canvas: a margin all round, so marks over an edge are painted whole
C = S + 2 * O  # the canvas, px
L = 'l1'  # the paint layer `klad new` makes
BOOST = {'pencil': 2.6, 'soft': 2.0, 'chalk': 1.4}
_NUM = re.compile(r'-?\d+(?:\.\d+)?')


def out(op):
    """
    Writes one op, in tile coordinates. klad's --wrap wraps a stroke's path but not the overhang of its dabs, so a
    mark running along an edge leaves a seam (found by the #845 session). Instead the tile is painted in the middle
    of a bigger canvas, and every mark that reaches past an edge is painted again a tile over, where it comes back
    in; the .sh then renders only the middle. Copies fill the whole canvas, so the canvas repeats the tile and
    the .sh can render it half a tile over to check the seams.
    """
    if op['op'] == 'fill':
        pts = op['polygon']
        for dx in (0, -S, S):
            for dy in (0, -S, S):
                if _area_on_tile([(x + dx, y + dy) for x, y in pts], -O, S + O) < 2:
                    continue
                _emit({**op, 'polygon': [[round(x + dx + O, 1), round(y + dy + O, 1)] for x, y in pts]})
        return
    nums = [float(n) for n in _NUM.findall(op['path'])]
    xs, ys = nums[0::2], nums[1::2]
    pad = op['size'] / 2 + 6
    for dx in (0, -S, S):
        for dy in (0, -S, S):
            if max(xs) + dx < -O - pad or min(xs) + dx > S + O + pad or max(ys) + dy < -O - pad or min(ys) + dy > S + O + pad:
                continue
            k = iter(range(len(nums)))
            path = _NUM.sub(lambda m: f'{float(m.group()) + (dx if next(k) % 2 == 0 else dy) + O:.1f}', op['path'])
            _emit({**op, 'path': path})


def _emit(op):
    sys.stdout.write(json.dumps(op) + '\n')


def poly(points, color, opacity=None):
    """A filled polygon (out() paints it again wherever it comes back in over an edge)."""
    op = {'op': 'fill', 'layer': L, 'polygon': [[x, y] for x, y in points], 'color': color}
    if opacity is not None:
        op['opacity'] = opacity
    out(op)


def _area_on_tile(pts, lo=0, hi=S):
    """The area of a polygon inside the square lo..hi (Sutherland-Hodgman clip), so copies that miss it are skipped."""
    def clip(ps, inside, cross):
        res = []
        for i, cur in enumerate(ps):
            prev = ps[i - 1]
            if inside(cur):
                if not inside(prev):
                    res.append(cross(prev, cur))
                res.append(cur)
            elif inside(prev):
                res.append(cross(prev, cur))
        return res

    def at_x(v):
        return lambda a, b: (v, a[1] + (b[1] - a[1]) * (v - a[0]) / (b[0] - a[0]))

    def at_y(v):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]), v)

    ps = list(pts)
    for inside, cross in ((lambda p: p[0] >= lo, at_x(lo)), (lambda p: p[0] <= hi, at_x(hi)),
                          (lambda p: p[1] >= lo, at_y(lo)), (lambda p: p[1] <= hi, at_y(hi))):
        ps = clip(ps, inside, cross)
        if not ps:
            return 0
    return abs(sum(ps[i - 1][0] * p[1] - p[0] * ps[i - 1][1] for i, p in enumerate(ps))) / 2


def rect(x, y, w, h, color, opacity=None):
    """A filled box; one that runs past the tile's edge is split so it comes back in on the other side."""
    xs = [(x, w)] if x >= 0 and x + w <= S else _split(x, w)
    ys = [(y, h)] if y >= 0 and y + h <= S else _split(y, h)
    for ax, aw in xs:
        for ay, ah in ys:
            poly([(ax, ay), (ax + aw, ay), (ax + aw, ay + ah), (ax, ay + ah)], color, opacity)


def _split(a, n):
    a %= S
    if a + n <= S:
        return [(a, n)]
    return [(a, S - a), (0, a + n - S)]


def stroke(path, color, size, brush='pencil', opacity=None, pressure=None, taper=None):
    op = {'op': 'stroke', 'layer': L, 'brush': brush, 'size': size, 'color': color, 'path': path}
    if opacity is not None:
        # klad's pencil is grainy and soft's edge fades wide, so both read far lighter than their opacity says
        op['opacity'] = min(1.0, opacity * BOOST.get(brush, 1.0))
    if pressure is not None:
        op['pressure'] = pressure
    if taper is not None:
        op['taper'] = taper
    out(op)


def line(x0, y0, x1, y1, color, size, brush='pencil', opacity=None, pressure=None, taper=(0, 0)):
    stroke(f'M{x0:.1f} {y0:.1f} L{x1:.1f} {y1:.1f}', color, size, brush, opacity, pressure, list(taper))


def mix(a, b, t):
    pa = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    pb = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return '#' + ''.join(f'{round(x + (y - x) * t):02x}' for x, y in zip(pa, pb))


def jitter(c, r, amt):
    """A colour a little lighter or darker, warm-biased."""
    t = r.uniform(-amt, amt)
    return mix(c, '#fff4e0' if t > 0 else '#3a2618', abs(t))


def wash(r, base, n=14, amt=0.06, size=(120, 220)):
    """Broad, quiet tonal patches first (big masses before texture)."""
    for _ in range(n):
        x, y = r.uniform(0, S), r.uniform(0, S)
        a = r.uniform(0, math.pi)
        d = r.uniform(80, 200)
        x1, y1 = x + math.cos(a) * d, y + math.sin(a) * d
        line(x, y, x1, y1, jitter(base, r, amt), r.uniform(*size), 'soft', 0.18, [0.4, 1, 0.4])


# ─────────────── floors ───────────────

def boards(r, light, mid, dark, gap, rows, knots=True):
    """Planks running across, end joints staggered, grain along each board."""
    h = S / rows
    for i in range(rows):
        y = i * h
        # end joints: two per row, staggered from the row above
        j0 = r.uniform(0, S)
        joints = sorted([j0, (j0 + r.uniform(200, 312)) % S])
        cuts = joints + [joints[0] + S]
        for k in range(2):
            a, b = cuts[k], cuts[k + 1]
            tone = r.choice([light, mid, mid, dark])
            rect(a, y, b - a, h, jitter(tone, r, 0.05))
            # figure: a few broad dry-brush drags along the board, a shade darker and lighter
            for _ in range(r.randint(2, 4)):
                gy = y + r.uniform(h * 0.15, h * 0.85)
                x0 = a + r.uniform(4, 20)
                x1 = b - r.uniform(4, 20)
                if x1 - x0 > 40:
                    c = jitter(tone, r, 0.12)
                    line(x0, gy, x1, gy + r.uniform(-3, 3), c, r.uniform(8, h * 0.35), 'dry-brush', r.uniform(0.25, 0.45), [0.5, 1, 0.6], (20, 40))
            # grain: long, faint, slightly wavy lines along the board
            for _ in range(r.randint(5, 8)):
                gy = y + r.uniform(5, h - 5)
                x0 = a + r.uniform(0, 30)
                ln = min(b - a - 10, r.uniform(120, 260))
                w = r.uniform(-2.5, 2.5)
                path = f'M{x0:.1f} {gy:.1f} C {x0 + ln / 3:.1f} {gy + w:.1f} {x0 + 2 * ln / 3:.1f} {gy - w:.1f} {x0 + ln:.1f} {gy:.1f}'
                if x0 + ln > S:
                    path = f'M{x0 - S:.1f} {gy:.1f} L{x0 + ln - S:.1f} {gy + w / 2:.1f}' if x0 > S else path
                stroke(path, jitter(dark, r, 0.15), r.uniform(1.2, 2.6), 'pencil', r.uniform(0.18, 0.34), [0.2, 1, 0.2], [30, 60])
            if knots and r.random() < 0.35:
                kx, ky = r.uniform(a + 20, b - 20), y + r.uniform(h * 0.3, h * 0.7)
                stroke(f'M{kx - 9:.1f} {ky:.1f} C {kx - 4:.1f} {ky - 6:.1f} {kx + 4:.1f} {ky - 6:.1f} {kx + 9:.1f} {ky:.1f} C {kx + 4:.1f} {ky + 6:.1f} {kx - 4:.1f} {ky + 6:.1f} {kx - 9:.1f} {ky:.1f}',
                       mix(dark, gap, 0.4), 2.2, 'pencil', 0.45, None, [0, 0])
            # the joint at the board's start
            line(a % S, y + 1, a % S, y + h - 1, gap, 2.4, 'ink', 0.85)
        # the long seam under the row, with a lit lip above it
        line(-4, y + 0.8, S + 4, y + 0.8, gap, 2.4, 'ink', 0.9)
        line(-4, y + 3, S + 4, y + 3, mix(light, '#fff8ea', 0.4), 1.6, 'pencil', 0.35)
    wash(r, mid, 10, 0.05)


def floor_boards(r):
    boards(r, '#cfa476', '#c79a6b', '#bd8f61', '#8d6a4b', 6)


def floor_palewood(r):
    boards(r, '#ead6b2', '#e2c9a0', '#d4b88c', '#a88f6c', 8, knots=False)


def floor_tile(r):
    """Terracotta squares, cream grout, each tile its own tone with a worn middle."""
    n, g = 4, 5
    w = S / n
    rect(0, 0, S, S, '#e7dcc6')  # grout
    for i in range(n):
        for j in range(n):
            x, y = i * w + g / 2, j * w + g / 2
            c = jitter('#c46a46', r, 0.09)
            poly([(x, y), (x + w - g, y), (x + w - g, y + w - g), (x, y + w - g)], c)
            # worn, lighter middle, and a darker rim on the side away from the light
            line(x + w * 0.3, y + w * 0.45, x + w * 0.7, y + w * 0.55, mix(c, '#f0c8a0', 0.25), w * 0.45, 'soft', 0.35, [0.5, 1, 0.5])
            line(x + w - g - 3, y + 4, x + w - g - 3, y + w - g - 3, mix(c, '#5a2c1c', 0.35), 4, 'soft', 0.5)
            line(x + 4, y + w - g - 3, x + w - g - 3, y + w - g - 3, mix(c, '#5a2c1c', 0.35), 4, 'soft', 0.5)
            line(x + 3, y + 3, x + w - g - 6, y + 3, mix(c, '#ffe6c8', 0.35), 2.5, 'soft', 0.5)
            for _ in range(r.randint(2, 4)):  # a few pits and flecks, in clusters
                px, py = x + r.uniform(10, w - 15), y + r.uniform(10, w - 15)
                line(px, py, px + r.uniform(-4, 4), py + r.uniform(-4, 4), mix(c, '#4a2418', 0.45), r.uniform(1.5, 3), 'chalk', 0.5)


def floor_stone(r):
    """Flagstones in staggered courses, cream-grey, dark joints, a few chips."""
    rect(0, 0, S, S, '#6f685e')  # joint bed
    rows = 4
    h = S / rows
    for i in range(rows):
        y = i * h
        off = r.uniform(0, S)
        widths = []
        left = S
        while left > 0:
            w = min(left, r.uniform(140, 230))
            if 0 < left - w < 110:
                w = left
            widths.append(w)
            left -= w
        x = off
        for w in widths:
            c = jitter(r.choice(['#bdb3a2', '#c6bcaa', '#b2a897']), r, 0.07)
            j = lambda: r.uniform(-3, 3)
            pts = [(x + 4 + j(), y + 4 + j()), (x + w - 4 + j(), y + 4 + j()), (x + w - 4 + j(), y + h - 4 + j()), (x + 4 + j(), y + h - 4 + j())]
            _wrapped_poly(pts, c)
            # top lit, side away from the light darker; texture in the halftone only
            line(x + 10, y + 9, x + w - 12, y + 9, mix(c, '#f3ead8', 0.35), 5, 'soft', 0.45)
            line(x + w - 9, y + 10, x + w - 9, y + h - 10, mix(c, '#4f483f', 0.3), 6, 'soft', 0.45)
            line(x + 10, y + h - 9, x + w - 10, y + h - 9, mix(c, '#4f483f', 0.3), 6, 'soft', 0.45)
            for _ in range(r.randint(3, 6)):
                px, py = x + r.uniform(20, w - 20), y + r.uniform(20, h - 20)
                _wrapped_line(px, py, px + r.uniform(-14, 14), py + r.uniform(-6, 6), mix(c, '#5d554b', 0.35), r.uniform(2, 4), 'chalk', 0.35)
            if r.random() < 0.4:  # a hairline crack
                cx, cy = x + r.uniform(30, w - 30), y + r.uniform(20, h - 20)
                _wrapped_line(cx, cy, cx + r.uniform(-40, 40), cy + r.uniform(-25, 25), mix(c, '#3f3a33', 0.5), 1.4, 'pencil', 0.6)
            x += w


def _wrapped_poly(pts, c):
    """A polygon that may run past an edge (out() paints it again where it comes back in)."""
    poly(pts, c)


def _wrapped_line(x0, y0, x1, y1, c, size, brush, opacity):
    """A line that may start or end past an edge: it is brought onto the tile, and out() repeats it over the edge."""
    dx = -S if min(x0, x1) > S else (S if max(x0, x1) < 0 else 0)
    dy = -S if min(y0, y1) > S else (S if max(y0, y1) < 0 else 0)
    line(x0 + dx, y0 + dy, x1 + dx, y1 + dy, c, size, brush, opacity)


def floor_matting(r):
    """Woven rush matting: a basket weave of straw strands, squares alternating across and down."""
    n = 8
    w = S / n
    rect(0, 0, S, S, '#9c7c4c')
    strands = 4
    for i in range(n):
        for j in range(n):
            x, y = i * w, j * w
            across = (i + j) % 2 == 0
            for k in range(strands):
                c = jitter(r.choice(['#d8b878', '#cfae6c', '#e0c487']), r, 0.06)
                s = w / strands
                if across:
                    ys = y + k * s + 1
                    poly([(x + 1, ys), (x + w - 1, ys), (x + w - 1, ys + s - 2), (x + 1, ys + s - 2)], c)
                    line(x + 2, ys + s - 3, x + w - 2, ys + s - 3, '#8a6a3c', 1.6, 'pencil', 0.45)
                    line(x + 3, ys + 2, x + w - 3, ys + 2, '#f2dca4', 1.4, 'pencil', 0.4)
                else:
                    xs = x + k * s + 1
                    poly([(xs, y + 1), (xs + s - 2, y + 1), (xs + s - 2, y + w - 1), (xs, y + w - 1)], c)
                    line(xs + s - 3, y + 2, xs + s - 3, y + w - 2, '#8a6a3c', 1.6, 'pencil', 0.45)
                    line(xs + 2, y + 3, xs + 2, y + w - 3, '#f2dca4', 1.4, 'pencil', 0.4)
    wash(r, '#cfae6c', 8, 0.05)


def floor_checker(r):
    """Cream and sage checkerboard tiles, glazed, with a thin joint."""
    n, g = 4, 3
    w = S / n
    rect(0, 0, S, S, '#b9b0a2')
    for i in range(n):
        for j in range(n):
            x, y = i * w + g / 2, j * w + g / 2
            c = jitter('#efe6d4' if (i + j) % 2 == 0 else '#7f9a78', r, 0.04)
            poly([(x, y), (x + w - g, y), (x + w - g, y + w - g), (x, y + w - g)], c)
            # a glaze: one deliberate streak of highlight, a soft darker lower edge
            line(x + w * 0.18, y + w * 0.3, x + w * 0.42, y + w * 0.16, mix(c, '#ffffff', 0.45), 6, 'soft', 0.45, [0.2, 1, 0.2])
            line(x + 3, y + w - g - 3, x + w - g - 3, y + w - g - 3, mix(c, '#3c4a38', 0.25), 4, 'soft', 0.4)
            for _ in range(r.randint(0, 2)):
                px, py = x + r.uniform(10, w - 15), y + r.uniform(10, w - 15)
                line(px, py, px + r.uniform(-3, 3), py + r.uniform(-3, 3), mix(c, '#5a5448', 0.3), 2, 'chalk', 0.4)


# ─────────────── walls ───────────────

def wall_plaster(r):
    """Cream lime plaster: broad, quiet trowel strokes and a few hairlines."""
    rect(0, 0, S, S, '#efe6d4')
    wash(r, '#efe6d4', 22, 0.12, (90, 180))
    for _ in range(10):  # a few broad, soft clouds of a warmer and a cooler cream, as limewash dries
        x, y = r.uniform(0, S), r.uniform(0, S)
        c = r.choice(['#e8dcc2', '#f5eedf', '#e4d9c6'])
        _wrapped_line(x, y, x + r.uniform(-60, 60), y + r.uniform(-40, 40), c, r.uniform(70, 140), 'soft', 0.5)
    for _ in range(40):  # trowel marks: short, wide, faint arcs
        x, y = r.uniform(0, S), r.uniform(0, S)
        a = r.uniform(-0.5, 0.5)
        d = r.uniform(40, 90)
        _wrapped_line(x, y, x + math.cos(a) * d, y + math.sin(a) * d, jitter('#e6dbc4', r, 0.06), r.uniform(18, 34), 'flat-bristle', 0.12)
    for _ in range(3):
        x, y = r.uniform(0, S), r.uniform(0, S)
        _wrapped_line(x, y, x + r.uniform(-30, 30), y + r.uniform(10, 40), '#cfc2a8', 1.2, 'pencil', 0.4)


def wall_stripes(r):
    """Painted stripes: cream ground, wide sage bands with a thin rust pinstripe between."""
    wall_plaster(r)
    n = 4
    w = S / n
    for i in range(n):
        x = i * w
        rect(x + w * 0.1, 0, w * 0.42, S, '#a9bf9c', 0.85)
        for _ in range(6):  # brush texture along the band
            bx = x + w * 0.1 + r.uniform(4, w * 0.42 - 4)
            line(bx, -10, bx + r.uniform(-2, 2), S + 10, jitter('#97ae8a', r, 0.06), r.uniform(6, 12), 'flat-bristle', 0.18)
        rect(x + w * 0.76 - 1.5, 0, 3, S, '#c86f5a', 0.85)


def _leaf(x, y, a, ln, wd, c, vein):
    """One leaf as a filled shape: a pointed oval along angle `a`, with a midrib."""
    ca, sa = math.cos(a), math.sin(a)
    pts = []
    for k in range(13):
        t = k / 12
        half = math.sin(math.pi * t) ** 0.8 * wd
        pts.append((x + ca * ln * t - sa * half, y + sa * ln * t + ca * half))
    for k in range(11, 0, -1):
        t = k / 12
        half = math.sin(math.pi * t) ** 0.8 * wd
        pts.append((x + ca * ln * t + sa * half, y + sa * ln * t - ca * half))
    poly(pts, c)
    line(x, y, x + ca * ln * 0.85, y + sa * ln * 0.85, vein, 1.2, 'pencil', 0.6)


def wall_leaves(r):
    """Wallpaper: a sprig of leaves repeated on a half-drop grid, printed sage on cream."""
    wall_plaster(r)
    cols, rows = 4, 4
    cw, rh = S / cols, S / rows
    for i in range(cols):
        for j in range(rows):
            x = i * cw + cw / 2
            y = j * rh + rh / 2 + (rh / 2 if i % 2 else 0)
            y %= S
            a0 = -math.pi / 2 + r.uniform(-0.2, 0.2)
            # stem
            sx, sy = x - math.cos(a0) * 36, y - math.sin(a0) * 36
            ex, ey = x + math.cos(a0) * 30, y + math.sin(a0) * 30
            stroke(f'M{sx:.1f} {sy:.1f} Q {x + 8:.1f} {y:.1f} {ex:.1f} {ey:.1f}', '#6f8f65', 2.4, 'ink', 0.9, None, [6, 12])
            for k, side in enumerate([-1, 1, -1, 1]):
                t = 0.2 + k * 0.2
                lx = sx + (ex - sx) * t
                ly = sy + (ey - sy) * t
                c = jitter('#8fae7a', r, 0.08)
                _leaf(lx, ly, a0 + side * 0.9, r.uniform(20, 26), r.uniform(6, 8), c, '#5f7f56')
            _leaf(ex, ey, a0, 22, 7, jitter('#8fae7a', r, 0.08), '#5f7f56')
            # a small rust berry cluster, now and then
            if (i + j) % 3 == 0:
                for b in range(3):
                    bx, by = x + 14 + b * 5, y + 8 + (b % 2) * 5
                    stroke(f'M{bx:.1f} {by:.1f} L{bx + 0.5:.1f} {by:.1f}', '#c86f5a', 5, 'ink', 0.95, None, [0, 0])


def wall_panelling(r):
    """Tongue-and-groove panelling, painted soft sage: upright boards, shadowed grooves, a bead on each."""
    n = 6
    w = S / n
    for i in range(n):
        x = i * w
        c = jitter('#a9bf9c', r, 0.035)
        rect(x, 0, w, S, c)
        for _ in range(4):  # paint over grain: faint upright drags
            gx = x + r.uniform(6, w - 6)
            line(gx, -10, gx + r.uniform(-3, 3), S + 10, jitter('#8ea683', r, 0.08), r.uniform(1.5, 3), 'dry-brush', 0.25)
        line(x + 1.5, -4, x + 1.5, S + 4, '#5f7458', 3.2, 'ink', 0.85)      # the groove, in shadow
        line(x + 5, -4, x + 5, S + 4, '#d3e0c8', 2, 'pencil', 0.55)        # its lit lip
        line(x + w * 0.5, -4, x + w * 0.5, S + 4, '#8aa17e', 1.6, 'pencil', 0.5)  # the bead down the middle
    wash(r, '#a9bf9c', 8, 0.05)


def wall_brick(r):
    """Old brick, limewashed in places: staggered courses, cream mortar, each brick its own tone."""
    rect(0, 0, S, S, '#ddd2bd')
    rows, cols = 8, 4
    bh, bw = S / rows, S / cols
    for j in range(rows):
        y = j * bh
        off = bw / 2 if j % 2 else 0
        for i in range(cols):
            x = i * bw + off
            c = jitter(r.choice(['#a8573c', '#b4623f', '#9a4f37', '#b86b48']), r, 0.08)
            pts = [(x + 3, y + 3), (x + bw - 3, y + 3), (x + bw - 3, y + bh - 3), (x + 3, y + bh - 3)]
            _wrapped_poly(pts, c)
            # the top face catches the light, the lower edge sits in shadow: thin bands the brick's full length
            poly([(x + 3, y + 3), (x + bw - 3, y + 3), (x + bw - 3, y + 7), (x + 3, y + 7)], mix(c, '#f0b890', 0.18))
            poly([(x + 3, y + bh - 7), (x + bw - 3, y + bh - 7), (x + bw - 3, y + bh - 3), (x + 3, y + bh - 3)], mix(c, '#3a1c12', 0.22))
            for _ in range(r.randint(2, 4)):
                px, py = x + r.uniform(10, bw - 10), y + r.uniform(8, bh - 8)
                _wrapped_line(px, py, px + r.uniform(-3, 3), py + r.uniform(-2, 2), mix(c, '#3a1c12', 0.4), r.uniform(1.5, 3), 'chalk', 0.5)
    wash(r, '#a8573c', 6, 0.05)
    for _ in range(4):  # old limewash, left in broad soft patches over a few bricks at a time
        x, y = r.uniform(0, S), r.uniform(0, S)
        _wrapped_line(x, y, x + r.uniform(-80, 80), y + r.uniform(-50, 50), '#eee4d0', r.uniform(90, 150), 'soft', 0.16)


def wall_trellis(r):
    """A trellis paper: thin rust diagonals crossing on cream, a small cream-and-gold flower at each crossing."""
    wall_plaster(r)
    n = 4
    w = S / n
    t = 1.6  # half the lath's width
    for k in range(-n, 2 * n + 1):
        x0 = k * w
        # each lath a thin band, so it stays solid (fills come back in over the edges)
        poly([(x0 - t, 0), (x0 + t, 0), (x0 + S + t, S), (x0 + S - t, S)], '#c86f5a', 0.8)
        poly([(x0 - t, S), (x0 + t, S), (x0 + S + t, 0), (x0 + S - t, 0)], '#c86f5a', 0.8)
    for i in range(n):
        for j in range(n):
            for (cx, cy) in ((i * w, j * w), (i * w + w / 2, j * w + w / 2)):
                # a five-petal flower where the laths cross: cream petals with a rust rim, a gold heart
                for p in range(5):
                    a = p * 2 * math.pi / 5 + 0.3
                    _disc(cx + math.cos(a) * 7, cy + math.sin(a) * 7, 6.5, '#c86f5a')
                for p in range(5):
                    a = p * 2 * math.pi / 5 + 0.3
                    _disc(cx + math.cos(a) * 7, cy + math.sin(a) * 7, 5, '#f6f0e2')
                _disc(cx, cy, 4.5, '#d9a648')


def _disc(cx, cy, rad, c):
    poly([(cx + math.cos(k * math.pi / 8) * rad, cy + math.sin(k * math.pi / 8) * rad) for k in range(16)], c)


FINISHES = {
    'floor-boards': floor_boards,
    'floor-palewood': floor_palewood,
    'floor-tile': floor_tile,
    'floor-stone': floor_stone,
    'floor-matting': floor_matting,
    'floor-checker': floor_checker,
    'wall-plaster': wall_plaster,
    'wall-stripes': wall_stripes,
    'wall-leaves': wall_leaves,
    'wall-panelling': wall_panelling,
    'wall-brick': wall_brick,
    'wall-trellis': wall_trellis,
}

if __name__ == '__main__':
    name = sys.argv[1]
    if name == '--list':
        print('\n'.join(FINISHES))
    else:
        FINISHES[name](random.Random(sum(map(ord, name))))
