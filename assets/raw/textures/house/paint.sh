#!/usr/bin/env bash
# #861: repaints the house's tiles (wood, weave, coir) from paint.py with klad, and cuts each out as <name>.png.
# Usage: bash assets/raw/textures/house/paint.sh [wood|weave|coir ...]   (all three by default)
# KLAD picks the binary (default: the Windows release build).
set -euo pipefail
KLAD="${KLAD:-/c/Users/AaronAnnuscheit/tools/klad/target/windows/release/klad.exe}"
cd "$(dirname "$0")"
declare -A BG=([wood]='#efe4d2' [weave]='#ece2d1' [coir]='#dccaa9')
for n in "${@:-wood weave coir}"; do
  for name in $n; do
    rm -rf "./${name:?}.klad"
    # three tiles wide, no --wrap: paint.py draws the tile in the middle square and wraps it itself (see its stroke())
    "$KLAD" new "$name.klad" --width 768 --height 768 --background "${BG[$name]}" >/dev/null
    python paint.py "$name" | "$KLAD" apply "$name.klad" >/dev/null
    "$KLAD" render "$name.klad" --region 256,256,256,256 -o "$name.png" >/dev/null
    rm -rf "./${name:?}.klad/.cache"
    echo "painted $name.png"
  done
done
