"""
Checks that a painted tile repeats without a seam, and writes a 3x3 repeat of it to look at.

    python klad_tile_check.py tile.png half.png repeat.png

`half.png` is the same drawing rendered half a tile over (its middle is where the tile's corners meet). If the tile
is truly seamless, `half` equals the tile rolled by half; a seam shows as a line of difference down the middle of
`half`. Brush grain differs a little from copy to copy, so the check compares the worst line against the typical
one. Exits 1 (and says where) when a seam stands out.
"""
import sys

import numpy as np
from PIL import Image

tile_path, half_path, repeat_path = sys.argv[1:4]
tile = np.asarray(Image.open(tile_path).convert('RGB')).astype(float)
half = np.asarray(Image.open(half_path).convert('RGB')).astype(float)
s = tile.shape[0]
assert tile.shape == half.shape == (s, s, 3), (tile.shape, half.shape)

d = np.abs(np.roll(tile, (-s // 2, -s // 2), axis=(0, 1)) - half).mean(axis=2)
rows, cols = d.mean(axis=1), d.mean(axis=0)
mid = slice(s // 2 - 3, s // 2 + 3)
typical = max(np.median(rows), np.median(cols), 0.5)
worst = max(rows[mid].max(), cols[mid].max())

Image.fromarray(np.tile(tile, (3, 3, 1)).astype(np.uint8)).save(repeat_path)
name = tile_path.replace('\\', '/').split('/')[-1]
verdict = 'seamless' if worst < typical * 3 + 1.5 else 'SEAM'
print(f'{name:22s} {verdict}  (edge {worst:.1f} vs typical {typical:.1f})')
sys.exit(0 if verdict == 'seamless' else 1)
