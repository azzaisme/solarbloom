"""Draws a drone's eye sprite sheet: 4 frames side by side (idle, open, blink, sleepy).

Each role has its own idle expression (frame 0) and eye colour, so roles read apart by their faces:
Restorer happy arcs, Gardener happy arcs with blush, Scout one squint and one lens ring, Courier
determined slanted eyes, Spark star eyes, Harvester heart eyes. Frames 1-3 are shared shapes.

Black is no glow; the cyan strokes are the emissive eyes. The visor_eyes mesh's UVs cover frame 0
(u 0..0.25); the game animates by setting texture.offset.x = frame * 0.25.
Run: python assets/tools/drone_eye_sheet.py <out.png> [role]
"""
import math
import sys
from PIL import Image, ImageDraw, ImageFilter

F = 512                   # one frame, square
ROLES = {   # role -> (idle frame, glow colour)
    "restorer": ("happy", (90, 230, 255)),
    "gardener": ("blush", (120, 245, 120)),
    "scout": ("focus", (110, 190, 255)),
    "courier": ("determined", (255, 170, 80)),
    "spark": ("star", (255, 225, 70)),
    "harvester": ("heart", (205, 150, 255)),
}
ROLE = sys.argv[2] if len(sys.argv) > 2 else "restorer"
IDLE, CYAN = ROLES[ROLE]
FRAMES = [IDLE, "open", "blink", "sleepy"]
CORE = tuple(min(255, 150 + c // 2) for c in CYAN)   # near-white core, tinted
EYE_X = (0.33, 0.67)      # eye centres across the visor
EYE_Y = 0.45              # a little above the visor centre, as in the target art
W = 0.22                  # eye width (fraction of frame)
STROKE = 0.06


def stroke_arc(d, cx, cy, rx, ry, a0, a1, col, s):
    """Centred, round-capped arc stroke (PIL's arc() strokes inward and has square ends)."""
    pts = [(cx + rx * math.cos(math.radians(a0 + (a1 - a0) * i / 40)),
            cy + ry * math.sin(math.radians(a0 + (a1 - a0) * i / 40))) for i in range(41)]
    d.line(pts, fill=col, width=int(s), joint="curve")
    for x, y in (pts[0], pts[-1]):
        d.ellipse([x - s / 2, y - s / 2, x + s / 2, y + s / 2], fill=col)


def star(d, cx, cy, r, col, s):
    """Four-point sparkle; `s` fattens it so the glow pass is wider than the core."""
    pts = []
    for i in range(8):
        a = math.radians(i * 45 - 90)
        rr = r if i % 2 == 0 else r * 0.3 + s * 0.3
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    d.polygon(pts, fill=col)


def draw(d, kind, cx, cy, col, stroke, side=0):
    w, s = W * F, stroke * F
    if kind == "blush":      # happy arcs plus a soft cheek dot under the outer corner
        stroke_arc(d, cx, cy + w * 0.18, w * 0.42, w * 0.40, 195, 345, col, s)
        bx = cx + (-1 if side == 0 else 1) * w * 0.38
        d.ellipse([bx - w * 0.16, cy + w * 0.42, bx + w * 0.16, cy + w * 0.58], fill=(255, 120, 170))
    elif kind == "focus":    # left eye squints, right eye is a big lens ring
        if side == 0:
            stroke_arc(d, cx, cy + w * 0.05, w * 0.40, w * 0.12, 200, 340, col, s)
        else:
            r = w * 0.40
            d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=int(s))
            d.ellipse([cx - s * 0.6, cy - s * 0.6, cx + s * 0.6, cy + s * 0.6], fill=col)
    elif kind == "determined":   # rounded eyes with the top cut on a slope toward the centre
        d.rounded_rectangle([cx - w * 0.32, cy - w * 0.46, cx + w * 0.32, cy + w * 0.40], radius=w * 0.24, fill=col)
        k = 1 if side == 0 else -1        # inner corner lower: a frown of concentration
        d.polygon([(cx - w, cy - w * 0.9), (cx + w, cy - w * 0.9),
                   (cx + w, cy - w * 0.22 + k * w * 0.26), (cx - w, cy - w * 0.22 - k * w * 0.26)], fill=(0, 0, 0))
    elif kind == "star":
        star(d, cx, cy, w * 0.48, col, s)
    elif kind == "heart":
        r = w * 0.22 + s * 0.15
        for dx in (-1, 1):
            d.ellipse([cx + dx * r * 0.9 - r, cy - r * 1.3, cx + dx * r * 0.9 + r, cy + r * 0.7], fill=col)
        d.polygon([(cx - r * 1.85, cy - r * 0.15), (cx + r * 1.85, cy - r * 0.15), (cx, cy + r * 1.9)], fill=col)
    elif kind == "happy":      # upside-down U arcs: the squinting smile eyes from target-look.png
        stroke_arc(d, cx, cy + w * 0.18, w * 0.42, w * 0.40, 195, 345, col, s)
    elif kind == "sleepy":   # U arcs, drooping
        stroke_arc(d, cx, cy - w * 0.12, w * 0.40, w * 0.28, 25, 155, col, s)
    elif kind == "open":     # tall rounded ovals
        d.rounded_rectangle([cx - w * 0.26, cy - w * 0.42, cx + w * 0.26, cy + w * 0.42], radius=w * 0.26, fill=col)
    elif kind == "blink":    # flat lines
        d.rounded_rectangle([cx - w * 0.42, cy - s / 2, cx + w * 0.42, cy + s / 2], radius=s / 2, fill=col)


def frame(kind):
    glow = Image.new("RGB", (F, F))
    gd = ImageDraw.Draw(glow)
    for i, ex in enumerate(EYE_X):
        draw(gd, kind, ex * F, EYE_Y * F, CYAN, STROKE * 1.6, i)
    glow = glow.filter(ImageFilter.GaussianBlur(F * 0.025))
    core = ImageDraw.Draw(glow)
    for i, ex in enumerate(EYE_X):
        draw(core, kind, ex * F, EYE_Y * F, CYAN, STROKE, i)
    img = glow
    hi = Image.new("RGB", (F, F))
    hd = ImageDraw.Draw(hi)
    for i, ex in enumerate(EYE_X):
        if kind not in ("blush", "determined", "heart"):     # these shapes draw extra fills a thin core would garble
            draw(hd, kind, ex * F, EYE_Y * F, CORE, STROKE * 0.45, i)
    return Image.composite(hi, img, hi.convert("L").point(lambda v: 255 if v > 10 else 0))


sheet = Image.new("RGB", (F * len(FRAMES), F))
for i, k in enumerate(FRAMES):
    sheet.paste(frame(k), (i * F, 0))
sheet.save(sys.argv[1])
print("wrote", sys.argv[1], sheet.size)
