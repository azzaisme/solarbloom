"""Tiles the role-<name>.png renders from drone_roles.py into one labelled 3 x 2 grid.
python assets/tools/roles_grid.py <preview dir>"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

d = sys.argv[1]
roles = ["Restorer", "Gardener", "Scout", "Courier", "Spark", "Harvester"]
T = 600
out = Image.new("RGB", (T * 3, T * 2 + 60), (234, 240, 245))
dr = ImageDraw.Draw(out)
try:
    font = ImageFont.truetype("segoeui.ttf", 34)
except OSError:
    font = ImageFont.load_default()
for i, r in enumerate(roles):
    x, y = (i % 3) * T, (i // 3) * (T + 30)
    tile = Image.open(os.path.join(d, f"role-{r.lower()}.png")).convert("RGBA")
    out.paste(tile, (x, y + 30), tile)
    dr.text((x + 20, y + 10), r, fill=(30, 40, 55), font=font)
out.save(os.path.join(d, "roles-grid.png"))
print("wrote", os.path.join(d, "roles-grid.png"))
