"""Paints the house's tiles with klad brush strokes (JSON lines for `klad apply`), into a 768 x 768 bundle made
without --wrap, the tile its middle square (see stroke). Light warm greys: the game tints
them with the palette colour of the piece they lie on. Usage: python paint.py <wood|weave|coir|cloth|tiles|brick|hearth> > ops.jsonl"""
import json, math, random, sys

S = 256
O = S  # where the tile starts on the canvas (see stroke)
out = []


def stroke(brush, size, color, pts, opacity=1.0, pressure=None):
    """A stroke, and a copy of it a tile over in each direction it reaches past an edge. The bundle doesn't wrap
    (klad 0.2.0's --wrap brings a path back across the edge but drops the part of a dab hanging over it), so the
    tile is made seamless here: each copy paints the overhang on the far side. Everything is drawn a tile right and
    down (O) on a canvas three tiles wide, as klad 0.2.0 also mis-draws dabs centred at negative coordinates; the
    tile is the middle square (klad render --region 256,256,256,256)."""
    m = size / 2 + 2
    xs, ys = [x for x, _ in pts], [y for _, y in pts]
    for ox in (-S, 0, S):
        for oy in (-S, 0, S):
            if min(xs) + ox - m > S or max(xs) + ox + m < 0 or min(ys) + oy - m > S or max(ys) + oy + m < 0:
                continue
            d = 'M ' + ' L '.join(f'{x + ox + O:.1f} {y + oy + O:.1f}' for x, y in pts)
            op = {'op': 'stroke', 'layer': 'l1', 'brush': brush, 'size': size, 'color': color, 'path': d, 'opacity': opacity}
            if pressure:
                op['pressure'] = [float(v) for v in pressure.split(',')]
            out.append(op)


def wood():
    R = random.Random(861)
    tones = ['#e2d2b8', '#d6c3a4', '#c4aa84', '#b3966f', '#f3ead9', '#a3845e']
    # broad soft bands first, then the grain lines
    y = 0.0
    while y < S:
        h = R.uniform(10, 26)
        stroke('flat-bristle', h, R.choice(tones[:2] + ['#f3ead9', '#cdb895']), [(x, y + h / 2 + 2 * math.sin(x / 40 + y)) for x in range(-20, S + 21, 8)], 0.45)
        y += h * 0.8
    knots = [(R.uniform(0, S), R.uniform(0, S)) for _ in range(2)]
    y = 1.0
    while y < S:
        x0 = R.uniform(0, S)
        L = R.uniform(90, 260)
        amp, ph = R.uniform(0.5, 2.0), R.uniform(0, 6.28)
        pts = []
        for i in range(int(L / 6) + 1):
            x = x0 + i * 6
            dy = amp * math.sin(x / 31 + ph)
            for kx, ky in knots:  # the grain swerves round a knot
                dx = ((x - kx + S / 2) % S) - S / 2
                d = y - ky
                if abs(d) < 18 and abs(dx) < 40:
                    dy += math.copysign(max(0, 18 - abs(d)) * 0.7, d if d else 1) * math.exp(-(dx / 22) ** 2)
            pts.append((x, y + dy))
        stroke(R.choice(['pencil', 'dry-brush']), R.uniform(1.4, 3.6), R.choice(tones[2:4] + tones[5:]), pts, R.uniform(0.7, 1.0), '0.3,1,0.8,0.2')
        y += R.uniform(3, 8)
    for kx, ky in knots:
        for r, c in [(7, '#b39874'), (5, '#a88c68'), (3, '#957a58')]:
            stroke('pencil', 2.2, c, [(kx + r * 1.6 * math.cos(a / 10), ky + r * 0.8 * math.sin(a / 10)) for a in range(0, 64)], 0.9)
        stroke('round-bristle', 4, '#8a6f50', [(kx - 1.5, ky), (kx + 1.5, ky)], 0.8)


def weave():
    R = random.Random(8610)
    C = 32  # a basket weave: each cell three strands one way, the next cell the other way
    for gy in range(S // C):
        for gx in range(S // C):
            horiz = (gx + gy) % 2 == 0
            x0, y0 = gx * C, gy * C
            for k in range(3):
                t = (k + 0.5) * C / 3
                tone = R.choice(['#f4ede2', '#ece3d4', '#f8f3ea'])
                if horiz:
                    pts = [(x0 + 0.5, y0 + t), (x0 + C - 0.5, y0 + t + R.uniform(-0.4, 0.4))]
                else:
                    pts = [(x0 + t, y0 + 0.5), (x0 + t + R.uniform(-0.4, 0.4), y0 + C - 0.5)]
                stroke('marker', 9.0, tone, pts, 1.0)
                # the strand's shade along one side, where it dips under the next cell
                sh = [(p[0], p[1] + 3.6) for p in pts] if horiz else [(p[0] + 3.6, p[1]) for p in pts]
                stroke('pencil', 1.8, '#b9a88e', sh, 0.8)
            # the gap where the cell meets its neighbours
            stroke('pencil', 2.2, '#a8967b', [(x0, y0), (x0 + C, y0)], 0.8)
            stroke('pencil', 2.2, '#a8967b', [(x0, y0), (x0, y0 + C)], 0.8)
    # fuzz: loose fibres over the weave
    for _ in range(260):
        x, y, a = R.uniform(0, S), R.uniform(0, S), R.uniform(0, 6.28)
        l = R.uniform(3, 8)
        stroke('pencil', 0.8, R.choice(['#ffffff', '#ddd1bd']), [(x, y), (x + l * math.cos(a), y + l * math.sin(a))], 0.5)


def coir():
    R = random.Random(8611)
    # ribs across the mat, then the bristle tufts in them
    for i in range(16):
        y = i * 16 + 8
        stroke('flat-bristle', 12, R.choice(['#efe3cc', '#e0cfb2']), [(x, y + R.uniform(-0.6, 0.6)) for x in range(-10, S + 11, 16)], 0.8)
        stroke('pencil', 2.6, '#8a7252', [(x, y + 7.5) for x in range(-10, S + 11, 16)], 0.7)
    for _ in range(1800):
        x, y = R.uniform(0, S), R.uniform(0, S)
        a = R.gauss(math.pi / 2, 0.7)
        l = R.uniform(4, 9)
        stroke(R.choice(['pencil', 'dry-brush']), R.uniform(1.4, 2.6), R.choice(['#fbf4e6', '#d8c39e', '#c0a47a', '#a8895f', '#f0e2c8', '#927552']),
               [(x, y), (x + l * math.cos(a), y + l * math.sin(a))], R.uniform(0.6, 1.0))


def fill(color, pts):
    """A filled polygon (crisp edges, for checks and tiles), wrapped like a stroke: a copy a tile over in each
    direction it reaches past an edge (klad's fills never wrap), drawn a tile right and down (O)."""
    xs, ys = [x for x, _ in pts], [y for _, y in pts]
    for ox in (-S, 0, S):
        for oy in (-S, 0, S):
            if min(xs) + ox >= S or max(xs) + ox <= 0 or min(ys) + oy >= S or max(ys) + oy <= 0:
                continue
            out.append({'op': 'fill', 'layer': 'l1', 'polygon': [[round(x + ox + O, 1), round(y + oy + O, 1)] for x, y in pts], 'color': color})


def band(x0, y0, x1, y1, R, wob=0.8):
    """A rectangle whose long edges wobble a little, as cloth is woven, not ruled."""
    across = (x1 - x0) > (y1 - y0)
    n = 8
    if across:
        top = [(x0 + (x1 - x0) * k / n, y0 + R.uniform(-wob, wob)) for k in range(n + 1)]
        bot = [(x0 + (x1 - x0) * k / n, y1 + R.uniform(-wob, wob)) for k in range(n, -1, -1)]
        return top + bot
    left = [(x0 + R.uniform(-wob, wob), y0 + (y1 - y0) * k / n) for k in range(n + 1)]
    right = [(x1 + R.uniform(-wob, wob), y0 + (y1 - y0) * k / n) for k in range(n, -1, -1)]
    return left + right


def cloth():
    """#858: gingham for the kitchen table's cloth: see-through bands across and down, darker where they cross."""
    R = random.Random(858)
    B = 32  # a check is 32 px: 8 across the tile
    for i in range(S // B):
        a = i * B
        fill('#a8987e70', band(-2, a, S + 2, a + B / 2, R))
        fill('#a8987e70', band(a, -2, a + B / 2, S + 2, R))
    # the cotton's threads, fine, both ways
    for _ in range(360):
        x, y = R.uniform(0, S), R.uniform(0, S)
        l = R.uniform(6, 16)
        d = (l, R.uniform(-0.3, 0.3)) if R.random() < 0.5 else (R.uniform(-0.3, 0.3), l)
        stroke('pencil', 0.8, R.choice(['#ffffff', '#cfc4b2']), [(x, y), (x + d[0], y + d[1])], 0.7)


def tiles():
    """#858: the kitchen's splashback: square glazed tiles, each its own shade, with grout between (the background)."""
    R = random.Random(8580)
    T = 64  # four tiles across the tile
    g = 2.2  # half the grout's width
    for gy in range(S // T):
        for gx in range(S // T):
            x0, y0 = gx * T + g, gy * T + g
            x1, y1 = (gx + 1) * T - g, (gy + 1) * T - g
            fill(R.choice(['#f7f3ec', '#efe9df', '#f3eee6', '#e9e2d6']), [(x0, y0), (x1, y0), (x1, y1), (x0, y1)])
            # the glaze: a soft shade along the bottom and right, a glint at the top left
            fill('#d6ccbc90', [(x0, y1 - 5), (x1, y1 - 5), (x1, y1), (x0, y1)])
            fill('#d6ccbc90', [(x1 - 5, y0), (x1, y0), (x1, y1 - 5), (x1 - 5, y1 - 5)])
            stroke('soft', 9, '#ffffff', [(x0 + 9, y0 + 11), (x0 + 22, y0 + 8)], 0.8)
            for _ in range(2):  # a faint brushed streak in the glaze
                y = R.uniform(y0 + 14, y1 - 12)
                stroke('pencil', 1.0, '#ffffff', [(x0 + 8, y), (x1 - 10, y + R.uniform(-1, 1))], 0.5)



def brick():
    """#859: the Home's fireplace: bricks in a running bond, each its own fired shade, with mortar between (the
    background). Each brick is a filled shape with soft corners, darker at its foot, with a few mottles and chips."""
    R = random.Random(859)
    W, H = 64, 32  # four bricks across, eight courses down
    g = 2.6  # half the mortar's width
    for row in range(S // H):
        shift = (W / 2) * (row % 2)
        for k in range(-1, S // W + 1):
            x0, y0 = k * W + shift + g, row * H + g
            x1, y1 = (k + 1) * W + shift - g, (row + 1) * H - g
            if x1 <= 0 or x0 >= S:
                continue
            c = 2.5  # the corners, a little worn
            j = lambda: R.uniform(-0.7, 0.7)
            fill(R.choice(['#f2e6dc', '#e8d6c8', '#ddc6b4', '#f6ede4', '#d4b9a6']),
                 [(x0 + c, y0 + j()), (x1 - c, y0 + j()), (x1 + j(), y0 + c), (x1 + j(), y1 - c), (x1 - c, y1 + j()), (x0 + c, y1 + j()), (x0 + j(), y1 - c), (x0 + j(), y0 + c)])
            fill('#9c806a60', [(x0 + 2, y1 - 5), (x1 - 2, y1 - 5), (x1 - 2, y1 - 0.5), (x0 + 2, y1 - 0.5)])  # its foot in shade
            for _ in range(3):  # mottles from the kiln
                mx, my = R.uniform(x0 + 6, x1 - 6), R.uniform(y0 + 5, y1 - 7)
                stroke('soft', R.uniform(5, 10), R.choice(['#c8a892', '#fbf3ea', '#b8967e']), [(mx, my), (mx + R.uniform(3, 9), my + R.uniform(-1, 1))], 0.45)
            if R.random() < 0.35:  # a chip off an edge
                cx = R.uniform(x0 + 8, x1 - 8)
                stroke('pencil', 2.0, '#a78c76', [(cx, y0 + 1), (cx + 3, y0 + 3), (cx + 6, y0 + 1)], 0.8)
    for _ in range(140):  # grit in the mortar
        x, y = R.uniform(0, S), R.uniform(0, S)
        stroke('pencil', 1.0, R.choice(['#9a8f80', '#ffffff']), [(x, y), (x + 1.2, y + 0.6)], 0.5)


def hearth():
    """#859: the hearth in front of the fire: big flagstones, uneven, with a thin dark joint between (the
    background), each stone its own grey with soft patches and a few pits."""
    R = random.Random(8590)
    N = 3  # three stones across the tile, three down, the corners nudged so none is square
    g = 2.0
    jit = {(i % N, k % N): (R.uniform(-14, 14), R.uniform(-14, 14)) for i in range(N) for k in range(N)}
    def corner(i, k):
        dx, dy = jit[(i % N, k % N)]
        return (i * S / N + dx, k * S / N + dy)
    for k in range(N):
        for i in range(N):
            a, b, c, d = corner(i, k), corner(i + 1, k), corner(i + 1, k + 1), corner(i, k + 1)
            cx, cy = (a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4
            shrink = lambda p: (p[0] + (cx - p[0]) * g / 60, p[1] + (cy - p[1]) * g / 60)
            pts = [shrink(p) for p in (a, b, c, d)]
            fill(R.choice(['#efeae2', '#e4ded4', '#f5f1ea', '#dcd5ca']), pts)
            for _ in range(5):  # patches where the stone is lighter or darker
                px, py = cx + R.uniform(-28, 28), cy + R.uniform(-28, 28)
                stroke('soft', R.uniform(12, 24), R.choice(['#fbf8f3', '#cfc7ba', '#e0d9ce']), [(px, py), (px + R.uniform(-10, 10), py + R.uniform(-6, 6))], 0.35)
            for _ in range(10):  # pits
                px, py = cx + R.uniform(-30, 30), cy + R.uniform(-30, 30)
                stroke('pencil', R.uniform(1.0, 2.0), '#a69d90', [(px, py), (px + 0.8, py + 0.5)], 0.7)


{'wood': wood, 'weave': weave, 'coir': coir, 'cloth': cloth, 'tiles': tiles, 'brick': brick, 'hearth': hearth}[sys.argv[1]]()
for op in out:
    print(json.dumps(op))
