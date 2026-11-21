"""Joins frames <dir>/<name>-NN.png into one strip, <dir>/<name>-strip.png (two rows when there are many), and removes
the frames. Used by the e2e scripts that film a short move (bot-turn-shots.mjs).
    python tests/e2e/strip.py <dir> <name>
"""
import glob
import os
import sys

from PIL import Image


def main(d: str, name: str) -> None:
    frames = sorted(glob.glob(os.path.join(d, f"{name}-[0-9][0-9].png")))
    if not frames:
        return
    ims = [Image.open(f).convert("RGB") for f in frames]
    scale = 0.5
    w, h = int(ims[0].width * scale), int(ims[0].height * scale)
    per_row = 5 if len(ims) > 5 else len(ims)
    rows = (len(ims) + per_row - 1) // per_row
    out = Image.new("RGB", (w * per_row, h * rows), (240, 236, 226))
    for i, im in enumerate(ims):
        out.paste(im.resize((w, h), Image.LANCZOS), ((i % per_row) * w, (i // per_row) * h))
    out.save(os.path.join(d, f"{name}-strip.png"))
    for im in ims:
        im.close()
    for f in frames:
        os.remove(f)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
