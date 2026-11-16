"""Draws a drone's eye sprite sheet (docs/art/SOLARBLOOM_DRONE_REDESIGN.md, D03): 8 square frames in a row.

Frames (the game picks one by setting the screen texture's u offset to frame / 8):
  0 idle       the role's own idle face (Restorer: happy upward arcs)
  1 focused    two rounded vertical bars          (travelling to a target)
  2 excited    two four-point stars               (Bloom Chain milestone, Lucky Cat, Frenzy entry)
  3 working A  upward chevrons + tiny activity bars (preparing or doing a task)
  4 working B  the same with the bars moved, so they flicker between A and B
  5 restoring  upward chevrons, extra glow        (active restoration beam)
  6 sleeping   downward closed curves + small z marks (long inactivity)
  7 blink      flat lines (a short blink from any face)
Black is no glow. Eyes are cyan for every role (roles read by shape); strokes are thick, round-capped,
with a crisp near-white core and a soft halo so they read at the default camera distance.

Run: python assets/tools/drone_eye_sheet.py <out.png> [role]
"""
import math
import sys
from PIL import Image, ImageDraw, ImageFilter

F = 512
FRAMES = ["idle", "focused", "excited", "workingA", "workingB", "restoring", "sleeping", "blink"]
CYAN = (110, 242, 255)
CORE = (225, 253, 255)
EYE_X = (0.30, 0.70)     # wide apart
EYE_Y = 0.46
W = 0.24                 # eye width (fraction of frame)
STROKE = 0.075
ROLE_IDLE = {"restorer": "happy", "gardener": "blush", "scout": "focus", "courier": "determined",
             "spark": "star", "harvester": "heart"}
ROLE = sys.argv[2] if len(sys.argv) > 2 else "restorer"


def stroke_arc(d, cx, cy, rx, ry, a0, a1, col, s):
    """Centred, round-capped arc stroke (PIL's arc() strokes inward and has square ends)."""
    pts = [(cx + rx * math.cos(math.radians(a0 + (a1 - a0) * i / 40)),
            cy + ry * math.sin(math.radians(a0 + (a1 - a0) * i / 40))) for i in range(41)]
    d.line(pts, fill=col, width=int(s), joint="curve")
    for x, y in (pts[0], pts[-1]):
        d.ellipse([x - s / 2, y - s / 2, x + s / 2, y + s / 2], fill=col)


def polyline(d, pts, col, s):
    d.line(pts, fill=col, width=int(s), joint="curve")
    for x, y in pts:
        d.ellipse([x - s / 2, y - s / 2, x + s / 2, y + s / 2], fill=col)


def star(d, cx, cy, r, col, s):
    pts = []
    for i in range(8):
        a = math.radians(i * 45 - 90)
        rr = r if i % 2 == 0 else r * 0.3 + s * 0.3
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    d.polygon(pts, fill=col)


def eye(d, kind, cx, cy, col, stroke, side):
    w, s = W * F, stroke * F
    if kind == "happy":                  # upward arcs: the squinting smile eyes
        stroke_arc(d, cx, cy + w * 0.18, w * 0.42, w * 0.40, 195, 345, col, s)
    elif kind == "blush":
        stroke_arc(d, cx, cy + w * 0.18, w * 0.42, w * 0.40, 195, 345, col, s)
        bx = cx + (-1 if side == 0 else 1) * w * 0.38
        d.ellipse([bx - w * 0.16, cy + w * 0.42, bx + w * 0.16, cy + w * 0.58], fill=(255, 120, 170))
    elif kind == "focus":                # one squint, one lens ring (Scout)
        if side == 0:
            stroke_arc(d, cx, cy + w * 0.05, w * 0.40, w * 0.12, 200, 340, col, s)
        else:
            r = w * 0.40
            d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=int(s))
            d.ellipse([cx - s * 0.6, cy - s * 0.6, cx + s * 0.6, cy + s * 0.6], fill=col)
    elif kind == "determined":           # top cut on a slope toward the centre (Courier)
        d.rounded_rectangle([cx - w * 0.32, cy - w * 0.46, cx + w * 0.32, cy + w * 0.40], radius=w * 0.24, fill=col)
        k = 1 if side == 0 else -1
        d.polygon([(cx - w, cy - w * 0.9), (cx + w, cy - w * 0.9),
                   (cx + w, cy - w * 0.22 + k * w * 0.26), (cx - w, cy - w * 0.22 - k * w * 0.26)], fill=(0, 0, 0))
    elif kind == "heart":                # Harvester
        r = w * 0.22 + s * 0.15
        for dx in (-1, 1):
            d.ellipse([cx + dx * r * 0.9 - r, cy - r * 1.3, cx + dx * r * 0.9 + r, cy + r * 0.7], fill=col)
        d.polygon([(cx - r * 1.85, cy - r * 0.15), (cx + r * 1.85, cy - r * 0.15), (cx, cy + r * 1.9)], fill=col)
    elif kind in ("star", "excited"):
        star(d, cx, cy, w * 0.5, col, s)
    elif kind == "focused":              # rounded vertical bars
        d.rounded_rectangle([cx - s * 0.55, cy - w * 0.40, cx + s * 0.55, cy + w * 0.40], radius=s * 0.55, fill=col)
    elif kind in ("chevron",):           # upward chevrons ^ ^
        polyline(d, [(cx - w * 0.36, cy + w * 0.22), (cx, cy - w * 0.22), (cx + w * 0.36, cy + w * 0.22)], col, s)
    elif kind == "sleeping":             # downward-facing closed curves
        stroke_arc(d, cx, cy - w * 0.16, w * 0.40, w * 0.30, 20, 160, col, s)
    elif kind == "blink":
        d.rounded_rectangle([cx - w * 0.42, cy - s / 2, cx + w * 0.42, cy + s / 2], radius=s / 2, fill=col)


def extras(d, kind, col, s, core):
    """Things drawn once per frame, not per eye: activity bars, z marks."""
    if kind in ("workingA", "workingB"):
        heights = (0.5, 1.0, 0.7, 0.35) if kind == "workingA" else (0.9, 0.45, 1.0, 0.6)
        bw = F * 0.035
        x0 = F * 0.5 - bw * 3.35
        base = F * 0.745
        for i, h in enumerate(heights):
            x = x0 + i * bw * 1.9
            d.rounded_rectangle([x, base - F * 0.09 * h, x + bw, base], radius=bw / 2, fill=col)
    if kind == "sleeping" and not core:
        for (zx, zy, zs) in ((0.80, 0.30, 0.065), (0.87, 0.23, 0.045)):
            x, y, z = zx * F, zy * F, zs * F
            polyline(d, [(x, y), (x + z, y), (x, y + z), (x + z, y + z)], col, s * 0.35)


def face(kind, d, col, stroke, core):
    per_eye = {"idle": ROLE_IDLE[ROLE], "focused": "focused", "excited": "excited", "workingA": "chevron",
               "workingB": "chevron", "restoring": "chevron", "sleeping": "sleeping", "blink": "blink"}[kind]
    if core and per_eye in ("blush", "determined", "heart"):
        return                            # filled shapes: a thin core would garble them
    for i, ex in enumerate(EYE_X):
        eye(d, per_eye, ex * F, EYE_Y * F, col, stroke, i)
    extras(d, kind, col, stroke * F, core)


def frame(kind):
    halo = 1.9 if kind == "restoring" else 1.6
    glow = Image.new("RGB", (F, F))
    face(kind, ImageDraw.Draw(glow), CYAN, STROKE * halo, False)
    glow = glow.filter(ImageFilter.GaussianBlur(F * (0.032 if kind == "restoring" else 0.024)))
    face(kind, ImageDraw.Draw(glow), CYAN, STROKE, False)
    hi = Image.new("RGB", (F, F))
    face(kind, ImageDraw.Draw(hi), CORE, STROKE * 0.42, True)
    return Image.composite(hi, glow, hi.convert("L").point(lambda v: 255 if v > 10 else 0))


sheet = Image.new("RGB", (F * len(FRAMES), F))
for i, k in enumerate(FRAMES):
    sheet.paste(frame(k), (i * F, 0))
sheet.save(sys.argv[1])
print("wrote", sys.argv[1], sheet.size)
