"""Colour-family coverage of screenshots (Look 2 "done when": >= 3 families, no single hue above ~50%).

    python tests/art/coverage.py shot.png [shot2.png ...] [--crop x0,y0,x1,y1]

Prints, per image: the share of each colour family (tests/art/colour.py FAMILIES), the number of families above
5%, and the largest 30-degree hue bin as a share of the whole frame. Every pixel counts (shots are taken with
the HUD hidden).
"""
import os
import sys
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from colour import load, classify, hue_histogram, FAMILIES  # noqa: E402


def report(path, crop=None):
    img = load(path)
    if crop:
        x0, y0, x1, y1 = crop
        img = img[y0:y1, x0:x1]
    fam = classify(img)
    total = fam.size
    shares = {name: (fam == i).sum() / total for i, (name, _) in enumerate(FAMILIES)}
    hist, neutral = hue_histogram(img)
    top = int(np.argmax(hist))
    big = [n for n, v in shares.items() if v >= 0.05]
    print(f'{os.path.basename(path)}' + (f' crop={crop}' if crop else ''))
    for n, v in sorted(shares.items(), key=lambda kv: -kv[1]):
        print(f'  {n:12s} {100 * v:5.1f}%')
    print(f'  families >= 5%: {len(big)} ({", ".join(big)})')
    print(f'  largest hue bin: {top * 30}-{top * 30 + 30} deg = {100 * hist[top]:.1f}% of frame (neutral/unsaturated {100 * neutral:.1f}%)')
    return shares, hist[top]


if __name__ == '__main__':
    args = sys.argv[1:]
    crop = None
    if '--crop' in args:
        i = args.index('--crop')
        crop = tuple(int(v) for v in args[i + 1].split(','))
        del args[i:i + 2]
    for p in args:
        report(p, crop)
