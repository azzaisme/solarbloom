"""Shared colour helpers for the art tooling (Look 2). Needs Pillow and numpy."""
import numpy as np
from PIL import Image


def load(path):
    return np.asarray(Image.open(path).convert('RGB')).astype(np.float32) / 255.0


def hsv(rgb):
    """rgb in [0,1], shape (..., 3) -> h in degrees, s, v."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(-1)
    mn = rgb.min(-1)
    d = mx - mn
    h = np.zeros_like(mx)
    m = d > 1e-6
    rm = m & (mx == r)
    gm = m & (mx == g) & ~rm
    bm = m & ~rm & ~gm
    h[rm] = ((g[rm] - b[rm]) / d[rm]) % 6
    h[gm] = (b[gm] - r[gm]) / d[gm] + 2
    h[bm] = (r[bm] - g[bm]) / d[bm] + 4
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    return h * 60.0, s, mx


def luma(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def hexof(c):
    c = np.clip(np.round(np.asarray(c) * 255), 0, 255).astype(int)
    return '#%02x%02x%02x' % tuple(c)


# Colour families used for the coverage measure. Order matters: first match wins.
# (name, test(h, s, v) -> bool mask)
FAMILIES = [
    ('pink', lambda h, s, v: (s > 0.28) & (v > 0.4) & ((h >= 300) | (h < 8))),
    ('purple', lambda h, s, v: (s > 0.2) & (v > 0.3) & (h >= 250) & (h < 300)),
    ('red-orange', lambda h, s, v: (s > 0.45) & (v > 0.45) & (h >= 8) & (h < 38)),
    ('yellow-gold', lambda h, s, v: (s > 0.45) & (v > 0.5) & (h >= 38) & (h < 62)),
    ('green', lambda h, s, v: (s > 0.22) & (v > 0.12) & (h >= 62) & (h < 165)),
    ('cyan-blue', lambda h, s, v: (s > 0.2) & (v > 0.2) & (h >= 165) & (h < 250)),
    ('white', lambda h, s, v: (s <= 0.12) & (v > 0.85)),
    ('stone', lambda h, s, v: (s <= 0.45) & (v > 0.18)),
    ('dark', lambda h, s, v: np.ones_like(v, dtype=bool)),
]


def classify(rgb):
    """Return an int array of family indices (into FAMILIES) for every pixel."""
    h, s, v = hsv(rgb)
    out = np.full(v.shape, -1, dtype=np.int16)
    for i, (_, test) in enumerate(FAMILIES):
        m = (out < 0) & test(h, s, v)
        out[m] = i
    return out


def hue_histogram(rgb, mask=None, bins=12):
    """Share of saturated pixels in each 360/bins hue bin, plus the share of unsaturated (neutral) ones."""
    h, s, v = hsv(rgb)
    if mask is None:
        mask = np.ones(v.shape, dtype=bool)
    sat = mask & (s > 0.2) & (v > 0.15)
    total = mask.sum()
    hist = np.histogram(h[sat], bins=bins, range=(0, 360))[0] / max(total, 1)
    return hist, 1 - sat.sum() / max(total, 1)
