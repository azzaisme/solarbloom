"""Colour-blind simulation of screenshots and a tile-state separation check (Look 2.9).

    python tests/art/cvd.py shot.png out-grid.png [states.json]

Writes a 2x2 grid: normal, protanopia, deuteranopia, tritanopia (Machado, Oliveira & Fernandes 2009, severity 1.0,
applied in linear RGB). With the states shot's probe JSON (block centres from tests/e2e/look2-shots.mjs), prints,
for each vision type, the median colour of each tile-state block and the smallest CIE76 colour difference and
lightness difference between any two states, so a state pair that collapses under a simulation shows up as a number.
"""
import json
import os
import sys
import numpy as np
from PIL import Image, ImageDraw

MACHADO = {
    'protanopia': [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    'deuteranopia': [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    'tritanopia': [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
}


def to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def simulate(img, kind):
    if kind == 'normal':
        return img
    return to_srgb(to_lin(img) @ np.asarray(MACHADO[kind]).T)


def lab(rgb):
    l = to_lin(np.asarray(rgb, dtype=np.float64))
    x = (l @ [0.4124, 0.3576, 0.1805]) / 0.95047
    y = l @ [0.2126, 0.7152, 0.0722]
    z = (l @ [0.0193, 0.1192, 0.9505]) / 1.08883
    f = lambda t: np.where(t > 0.008856, np.cbrt(t), 7.787 * t + 16 / 116)
    return np.stack([116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))], -1)


KINDS = ['normal', 'protanopia', 'deuteranopia', 'tritanopia']

if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    img = np.asarray(Image.open(src).convert('RGB')).astype(np.float64) / 255
    sims = {k: simulate(img, k) for k in KINDS}
    h, w, _ = img.shape
    grid = Image.new('RGB', (w, h))
    for i, k in enumerate(KINDS):
        tile = Image.fromarray((sims[k] * 255).round().astype(np.uint8)).resize((w // 2, h // 2))
        ImageDraw.Draw(tile).text((8, 8), k, fill='white')
        grid.paste(tile, ((i % 2) * (w // 2), (i // 2) * (h // 2)))
    grid.save(out)
    if len(sys.argv) > 3:
        probes = json.load(open(sys.argv[3]))
        r = 16
        for k in KINDS:
            cols = {}
            for name, (x, y) in probes.items():
                if 0 <= x < w and 0 <= y < h:
                    cols[name] = np.median(sims[k][max(0, y - r):y + r, max(0, x - r):x + r].reshape(-1, 3), 0)
            labs = {n: lab(c) for n, c in cols.items()}
            names = list(labs)
            worst, worstL = (None, 1e9), (None, 1e9)
            for i in range(len(names)):
                for j in range(i + 1, len(names)):
                    a, b = labs[names[i]], labs[names[j]]
                    d = float(np.linalg.norm(a - b))
                    dl = abs(float(a[0] - b[0]))
                    if d < worst[1]:
                        worst = (f'{names[i]}~{names[j]}', d)
                    if dl < worstL[1]:
                        worstL = (f'{names[i]}~{names[j]}', dl)
            print(f'{k:13s} min dE {worst[1]:5.1f} ({worst[0]})   min dL {worstL[1]:5.1f} ({worstL[0]})')
            print('              ' + '  '.join(f'{n}={"#%02x%02x%02x" % tuple((c * 255).round().astype(int))}' for n, c in cols.items()))
