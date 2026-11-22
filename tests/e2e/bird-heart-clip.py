"""#689: the bird heart's frames (from bird-heart-shots.mjs) as a clip and strips, in the same folder:
<name>.gif (every frame, 0.3 s each, at 480 × 300 in 96 colours, to keep the repo light) and <name>-strip.png (ten frames picked evenly through the flight).
The frames are removed afterwards.
    python tests/e2e/bird-heart-clip.py docs/review/bird-heart
"""
import glob
import os
import sys

from PIL import Image


def clip(d: str, name: str) -> None:
    frames = sorted(glob.glob(os.path.join(d, f"{name}-[0-9][0-9].png")))
    if not frames:
        return
    ims = [Image.open(f).convert("RGB") for f in frames]
    small = [im.resize((480, 300), Image.LANCZOS).quantize(colors=96, method=Image.Quantize.MEDIANCUT) for im in ims]
    small[0].save(os.path.join(d, f"{name}.gif"), save_all=True, append_images=small[1:], duration=300, loop=0, optimize=True)
    pick = [round(i * (len(ims) - 1) / 9) for i in range(10)] if len(ims) > 10 else list(range(len(ims)))
    w, h = 512, 320
    per_row = 5
    rows = (len(pick) + per_row - 1) // per_row
    out = Image.new("RGB", (w * per_row, h * rows), (240, 236, 226))
    for k, i in enumerate(pick):
        out.paste(ims[i].resize((w, h), Image.LANCZOS), ((k % per_row) * w, (k // per_row) * h))
    out.save(os.path.join(d, f"{name}-strip.png"), optimize=True)
    for im in ims:
        im.close()
    for f in frames:
        os.remove(f)


if __name__ == "__main__":
    folder = sys.argv[1] if len(sys.argv) > 1 else "docs/review/bird-heart"
    for n in ("1-flight", "2-turn", "3-calm"):
        clip(folder, n)
