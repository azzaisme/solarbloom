"""Sample docs/reference/target-look.png into the named swatches of docs/art/palette.md (Look 2.1).

    python tests/art/sample_reference.py [out-swatch.png]

Each swatch is a masked region of the reference: "lit" is the 80th luminance percentile of the
matching pixels, "shadow" the 20th (both as the median colour of the pixels near that percentile).
Prints a markdown table and the colour-family coverage of the reference (HUD masked out).
"""
import sys
import os
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
from colour import load, hsv, luma, hexof, classify, FAMILIES  # noqa: E402

REF = os.path.join(os.path.dirname(__file__), '..', '..', 'docs', 'reference', 'target-look.png')
img = load(REF)
H_, S_, V_ = hsv(img)
Y_ = luma(img)
HUD = [(0, 0, 340, 380), (510, 800, 1170, 941), (1330, 0, 1672, 140), (0, 840, 250, 941), (0, 0, 240, 50)]
hud = np.zeros(Y_.shape, dtype=bool)
for x0, y0, x1, y1 in HUD:
    hud[y0:y1, x0:x1] = True


def box(x0, y0, x1, y1):
    m = np.zeros(Y_.shape, dtype=bool)
    m[y0:y1, x0:x1] = True
    return m & ~hud


def hue(lo, hi):
    return (H_ >= lo) & (H_ < hi) if lo < hi else (H_ >= lo) | (H_ < hi)


def at(mask, p, band=6):
    """Median colour of the masked pixels whose luminance sits within +-band percentiles of p."""
    y = Y_[mask]
    lo, hi = np.percentile(y, max(0, p - band)), np.percentile(y, min(100, p + band))
    sel = mask & (Y_ >= lo) & (Y_ <= hi)
    return np.median(img[sel], axis=0), int(mask.sum())


# name, mask, (lit percentile, shadow percentile)
SW = [
    ('limestone.light', (box(540, 470, 700, 525) | box(1240, 190, 1300, 340)) & (S_ < 0.25) & (V_ > 0.6), (80, 40)),
    ('limestone.mid', box(1180, 640, 1330, 860) & (S_ < 0.25) & (V_ > 0.35), (75, 35)),
    ('limestone.dark', box(0, 380, 380, 840) & (S_ < 0.3) & (V_ > 0.2) & (V_ < 0.6), (70, 25)),
    ('paving.slab', box(300, 520, 720, 760) & (S_ < 0.25) & (V_ > 0.3), (80, 35)),
    ('paving.grout', box(300, 520, 720, 760) & (S_ < 0.35), (6, 2)),
    ('grass.sunlit', box(700, 330, 1400, 720) & hue(62, 130) & (S_ > 0.35), (88, 70)),
    ('grass.mid', box(700, 330, 1400, 720) & hue(62, 130) & (S_ > 0.35), (55, 40)),
    ('grass.shadow', box(700, 330, 1400, 720) & hue(62, 130) & (S_ > 0.35), (15, 5)),
    ('grass.dryTip', box(700, 330, 1400, 720) & hue(50, 66) & (S_ > 0.45) & (V_ > 0.55), (75, 40)),
    ('moss', box(300, 520, 720, 760) & hue(55, 130) & (S_ > 0.25), (75, 30)),
    ('flower.pink', ~hud & hue(305, 350) & (S_ > 0.4) & (V_ > 0.55), (75, 30)),
    ('flower.magenta', ~hud & hue(315, 345) & (S_ > 0.6) & (V_ > 0.45), (50, 15)),
    ('flower.lavender', ~hud & hue(250, 295) & (S_ > 0.25) & (V_ > 0.45), (75, 30)),
    ('flower.yellow', box(820, 360, 950, 440) & hue(40, 60) & (S_ > 0.6) & (V_ > 0.7), (75, 30)),
    ('flower.yellowCore', box(840, 370, 940, 430) & hue(15, 45) & (V_ < 0.55) & (V_ > 0.12), (60, 20)),
    ('flower.white', box(700, 480, 1250, 760) & (S_ < 0.12) & (V_ > 0.9), (70, 30)),
    ('flower.whiteCore', box(700, 480, 1250, 760) & hue(42, 60) & (S_ > 0.55) & (V_ > 0.8), (60, 30)),
    ('flower.orange', box(700, 360, 1300, 520) & hue(14, 36) & (S_ > 0.65) & (V_ > 0.75), (70, 30)),
    ('leaf.light', box(330, 0, 470, 120) & hue(62, 140) & (S_ > 0.4) & (V_ > 0.4), (80, 45)),
    ('leaf.dark', box(0, 250, 300, 700) & hue(62, 140) & (S_ > 0.3), (25, 8)),
    ('wood', box(380, 710, 540, 800) & hue(18, 50) & (S_ > 0.2), (75, 30)),
    ('rust', box(40, 600, 520, 900) & hue(8, 32) & (S_ > 0.35) & (V_ > 0.2) & (V_ < 0.75), (70, 30)),
    ('plastic.cream', box(890, 180, 1000, 360) & (S_ < 0.18) & (V_ > 0.6), (80, 35)),
    ('gold.banner', (box(560, 120, 620, 250) | box(1225, 580, 1295, 820)) & hue(32, 52) & (S_ > 0.45), (75, 30)),
    ('solar.navy', box(670, 235, 850, 320) & hue(205, 250) & (S_ > 0.35), (70, 25)),
    ('glass.cyan', box(900, 200, 990, 290) & hue(170, 205) & (S_ > 0.25), (80, 35)),
    ('sky.zenith', box(1290, 0, 1340, 40) & hue(190, 235) & (S_ > 0.25), (50, 20)),
    ('sky.horizon', box(1255, 100, 1672, 200) & hue(190, 235) & (S_ > 0.12) & (V_ > 0.8), (85, 60)),
    ('haze', box(1450, 230, 1672, 460) & (S_ < 0.3) & (V_ > 0.55), (60, 30)),
]

rows = []
for name, m, (pl, ps) in SW:
    lit, n = at(m, pl)
    sh, _ = at(m, ps)
    rows.append((name, hexof(lit), hexof(sh), n))

print('| swatch | lit | shadow | pixels |')
print('|---|---|---|---|')
for name, lit, sh, n in rows:
    print(f'| {name} | `{lit}` | `{sh}` | {n} |')

fam = classify(img)
total = (~hud).sum()
print('\nfamily coverage (HUD masked):')
for i, (fname, _) in enumerate(FAMILIES):
    print(f'  {fname:12s} {100 * ((fam == i) & ~hud).sum() / total:5.1f}%')

if len(sys.argv) > 1:
    W = 220
    out = Image.new('RGB', (W * 2 + 200, 26 * len(rows)), 'white')
    d = ImageDraw.Draw(out)
    for i, (name, lit, sh, _) in enumerate(rows):
        d.rectangle([0, i * 26, W, i * 26 + 24], fill=lit)
        d.rectangle([W, i * 26, 2 * W, i * 26 + 24], fill=sh)
        d.text((2 * W + 6, i * 26 + 6), name, fill='black')
    out.save(sys.argv[1])
