# House finishes (#846)

Twelve seamless 512 px tiles for the inside of the house, painted with [klad](https://github.com/klad-app/klad)
from `assets/tools/klad_house_textures.py`. Each `<name>.png` is what the game loads. Each `<name>.klad` is the
drawing, which can be opened in the klad editor and repainted by hand. `review/` holds a 3×3 repeat of each finish
(`<name>-repeat.png`) and `contact-sheet.png`, for checking the seams.

| Floors | Look | Suggested size of one tile |
| --- | --- | --- |
| `floor-boards` | today's warm boards, six rows, staggered joints | 2 m |
| `floor-palewood` | pale ash boards, eight rows | 2 m |
| `floor-tile` | terracotta squares, cream grout | 2 m (50 cm tiles) |
| `floor-stone` | cream-grey flagstones in staggered courses | 2.5 m |
| `floor-matting` | woven rush matting, basket weave | 1.5 m |
| `floor-checker` | cream and sage glazed checkerboard | 2 m (50 cm tiles) |

| Walls | Look | Suggested size of one tile |
| --- | --- | --- |
| `wall-plaster` | cream limewash plaster, today's wall | 2 m |
| `wall-stripes` | sage bands on cream with a rust pinstripe | 1.5 m |
| `wall-leaves` | wallpaper, sage leaf sprigs on a half-drop | 1.2 m |
| `wall-panelling` | sage tongue-and-groove boards | 1.5 m |
| `wall-brick` | old warm brick with traces of limewash | 1.5 m |
| `wall-trellis` | rust trellis on cream with small flowers | 1.2 m |

To repaint:

```
bash assets/tools/klad_house_textures.sh               # all twelve
bash assets/tools/klad_house_textures.sh floor-tile    # one
```

This needs `klad` on the PATH, or `KLAD=/path/to/klad.exe`. Run it through `~/.solarbloom/heavy.sh`.

Each `.klad` drawing is 1024 px with the tile in the middle (256 to 768), surrounded by its own repeats. klad's
`--wrap` isn't used: it wraps a stroke's path but not the edge of its dabs, so marks along an edge left seams. The
script paints every mark again one tile over, renders the middle 512 px, and runs `assets/tools/klad_tile_check.py`.
That check renders the drawing half a tile over, compares it with the tile, and fails if a seam stands out. To
repaint one by hand in the editor, paint inside the middle square and keep the edges matching.

These sit in a subfolder on purpose: `GroundTex` only loads `assets/raw/textures/*.png`, so the house tiles never
replace a ground texture.
