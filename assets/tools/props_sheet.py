"""Side-by-side sheet: Tripo shape guide (left) and the hand-built model (right) for each model.
python assets/tools/props_sheet.py <built dir> <out.png> name ..."""
import sys
from PIL import Image, ImageDraw
built, out, names = sys.argv[1], sys.argv[2], sys.argv[3:]
S = 320
cols = 2
sheet = Image.new("RGB", (cols * 2 * S, ((len(names) + cols - 1) // cols) * (S + 24)), (236, 240, 244))
d = ImageDraw.Draw(sheet)
for i, n in enumerate(names):
    x, y = (i % cols) * 2 * S, (i // cols) * (S + 24)
    g = Image.open(f"assets/raw/tripo/models/{n}.preview.webp").convert("RGB").resize((S, S))
    sheet.paste(g, (x, y + 24))
    b = Image.open(f"{built}/{n}.png").convert("RGBA").resize((S, S))
    sheet.paste(b, (x + S, y + 24), b)
    d.text((x + 6, y + 6), f"{n}: Tripo guide | hand-built", fill=(30, 30, 30))
sheet.save(out)
