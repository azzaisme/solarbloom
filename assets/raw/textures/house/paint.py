"""Paints the house's tiles with klad brush strokes (JSON lines for `klad apply`), into a 768 x 768 bundle made
without --wrap, the tile its middle square (see stroke). Light warm greys: the game tints
them with the palette colour of the piece they lie on. Usage: python paint.py <wood|weave|coir> > ops.jsonl"""
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


{'wood': wood, 'weave': weave, 'coir': coir}[sys.argv[1]]()
for op in out:
    print(json.dumps(op))
