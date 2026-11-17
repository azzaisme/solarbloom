"""Bloombot's visor faces (G.1): happy, surprised, wink and blink, as one sprite sheet in a row.

The owner's character sheet: a glossy black visor with soft cyan glowing eyes. The game lays this over the visor
on a thin panel tied to the head bone and swaps frames (src/rendering/BloombotVisuals.ts, FACES).

    python assets/tools/bloombot_faces.py   ->   assets/raw/bloombot/bloombot-faces.png
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

W, H = 256, 176  # one frame: the visor's proportions (about 0.27 x 0.19 m)
FRAMES = ['happy', 'surprised', 'wink', 'blink']
VISOR = (14, 17, 24, 255)
CYAN = (110, 236, 255, 255)
OUT = Path(__file__).resolve().parents[1] / 'raw' / 'bloombot' / 'bloombot-faces.png'


def eye_happy(d, cx, cy, s):
    d.arc([cx - s, cy - s * 0.7, cx + s, cy + s * 1.1], start=200, end=340, fill=CYAN, width=int(s * 0.42))


def eye_open(d, cx, cy, s):
    d.rounded_rectangle([cx - s * 0.28, cy - s * 0.75, cx + s * 0.28, cy + s * 0.75], radius=int(s * 0.28), fill=CYAN)


def eye_wink(d, cx, cy, s):
    # "<" for the winking eye, as on the sheet
    w = int(s * 0.38)
    d.line([(cx + s * 0.55, cy - s * 0.55), (cx - s * 0.45, cy), (cx + s * 0.55, cy + s * 0.55)], fill=CYAN, width=w, joint='curve')


def eye_closed(d, cx, cy, s):
    d.rounded_rectangle([cx - s * 0.7, cy - s * 0.12, cx + s * 0.7, cy + s * 0.12], radius=int(s * 0.12), fill=CYAN)


def frame(kind):
    img = Image.new('RGBA', (W, H), VISOR)
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    s = 34
    left, right, cy = W * 0.32, W * 0.68, H * 0.5
    if kind == 'happy':
        eye_happy(d, left, cy, s)
        eye_happy(d, right, cy, s)
    elif kind == 'surprised':
        eye_open(d, left, cy, s)
        eye_open(d, right, cy, s)
    elif kind == 'wink':
        eye_happy(d, left, cy, s)
        eye_wink(d, right, cy, s)
    else:
        eye_closed(d, left, cy, s)
        eye_closed(d, right, cy, s)
    halo = glow.filter(ImageFilter.GaussianBlur(9))
    img.alpha_composite(halo)
    img.alpha_composite(halo)
    img.alpha_composite(glow)
    return img


sheet = Image.new('RGBA', (W * len(FRAMES), H))
for i, k in enumerate(FRAMES):
    sheet.paste(frame(k), (i * W, 0))
OUT.parent.mkdir(parents=True, exist_ok=True)
sheet.save(OUT)
print(OUT)
