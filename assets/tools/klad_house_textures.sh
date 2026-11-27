#!/usr/bin/env bash
# Paints the house's floor and wall finishes (#846) with klad: one seamless 512 px tile each.
#   bash assets/tools/klad_house_textures.sh            every finish
#   bash assets/tools/klad_house_textures.sh floor-tile one finish
# Needs klad (https://github.com/klad-app/klad: `just compile`, then `klad install`), or KLAD=/path/to/klad.
# Writes assets/raw/textures/house/<name>.klad (the drawing, to repaint by hand in the klad editor), <name>.png
# (what the game loads) and review/<name>-repeat.png (3x3), then checks the seams (klad_tile_check.py).
#
# The tile is painted in the middle of a 1024 px canvas, not with `klad new --wrap`: --wrap wraps a stroke's path
# but not the overhang of its dabs, so marks along an edge left seams. klad_house_textures.py paints every mark
# that reaches past an edge again a tile over, and this renders only the middle 512 px.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dest="$here/../raw/textures/house"
review="$dest/review"
mkdir -p "$dest" "$review"
klad="${KLAD:-klad}"
names=("$@")
[ ${#names[@]} -gt 0 ] || mapfile -t names < <(python "$here/klad_house_textures.py" --list | tr -d '\r')
for n in "${names[@]}"; do
  b="$dest/$n.klad"
  rm -rf "$b"
  "$klad" new "$b" --width 1024 --height 1024 >/dev/null
  python "$here/klad_house_textures.py" "$n" > "$review/$n.ops.jsonl"
  "$klad" apply "$b" --file "$review/$n.ops.jsonl" >/dev/null
  rm -f "$review/$n.ops.jsonl"
  "$klad" render "$b" --region 256,256,512,512 --scale 1 -o "$dest/$n.png" >/dev/null
  "$klad" render "$b" --region 512,512,512,512 --scale 1 -o "$review/$n-half.png" >/dev/null
  python "$here/klad_tile_check.py" "$dest/$n.png" "$review/$n-half.png" "$review/$n-repeat.png"
  rm -f "$review/$n-half.png"
done
