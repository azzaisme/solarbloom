"""Frames (numbered PNGs in a folder) into a GIF: cropped round the middle, scaled down, one shared palette.

    python tools/frames-to-gif.py <frames dir> <out.gif> [fps=25] [width=720]
"""
import sys
from pathlib import Path

from PIL import Image

src = Path(sys.argv[1])
out = Path(sys.argv[2])
fps = int(sys.argv[3]) if len(sys.argv) > 3 else 25
width = int(sys.argv[4]) if len(sys.argv) > 4 else 720

frames = []
for p in sorted(src.glob('*.png')):
    im = Image.open(p).convert('RGB')
    w, h = im.size
    # the middle of the picture, where Bloombot and the wave are (a 16:9 crop, a little low)
    cw, ch = int(w * 0.78), int(h * 0.78)
    left, top = (w - cw) // 2, int((h - ch) * 0.7)
    im = im.crop((left, top, left + cw, top + ch)).resize((width, round(width * ch / cw)), Image.LANCZOS)
    frames.append(im)
if not frames:
    sys.exit(f'no frames in {src}')
# one palette from a few frames spread through, so colours don't flicker between frames
sample = Image.new('RGB', (frames[0].width, frames[0].height * 4))
for k in range(4):
    sample.paste(frames[min(len(frames) - 1, k * len(frames) // 4 + len(frames) // 8)], (0, frames[0].height * k))
pal = sample.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
q = [f.quantize(palette=pal, dither=Image.Dither.FLOYDSTEINBERG) for f in frames]
out.parent.mkdir(parents=True, exist_ok=True)
q[0].save(out, save_all=True, append_images=q[1:], duration=round(1000 / fps), loop=0, optimize=True)
print(f'{out}: {len(frames)} frames, {out.stat().st_size // 1024} KB')
