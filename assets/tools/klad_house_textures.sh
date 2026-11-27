#!/usr/bin/env bash
# Paints the house's floor and wall finishes (#846) with klad: one seamless 512 px tile each.
#   bash assets/tools/klad_house_textures.sh            every finish
#   bash assets/tools/klad_house_textures.sh floor-tile one finish
# Needs `klad` on the PATH (https://github.com/klad-app/klad: `just compile`, then `klad install`).
# Writes assets/raw/textures/house/<name>.klad (the drawing, to repaint by hand in the klad editor), <name>.png
# (what the game loads) and, under review/, a 3x3 repeat of each to check the seams.
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
  "$klad" new "$b" --width 512 --height 512 --wrap >/dev/null
  python "$here/klad_house_textures.py" "$n" > "$review/$n.ops.jsonl"
  "$klad" apply "$b" --file "$review/$n.ops.jsonl" >/dev/null
  rm -f "$review/$n.ops.jsonl"
  "$klad" export "$b" --background -o "$dest/$n.png" >/dev/null
  r="$("$klad" render "$b" --repeat 3 --scale 0.5 | tail -1)"
  cp "$r" "$review/$n-repeat.png"
  echo "$n"
done
