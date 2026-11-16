#!/usr/bin/env sh
# Rebuilds every drone asset from scratch: eye sheets, base drone, role parts, role drones, previews.
# Run from the repo root. Needs Blender 5 (set BLENDER if it isn't on the default path) and Python + Pillow.
set -eu
BLENDER="${BLENDER:-/c/Program Files/Blender Foundation/Blender 5.0/blender.exe}"
D="$(pwd)/assets/raw/drone"
T="$(pwd)/assets/tools"
b() { "$BLENDER" -b --python "$@" > /dev/null 2>&1 || { echo "failed: $1"; exit 1; }; }

mkdir -p "$D/eyes" "$D/parts" "$D/roles" "$D/preview"
for r in restorer gardener scout courier spark harvester; do
  python "$T/drone_eye_sheet.py" "$D/eyes/drone-eyes-$r.png" "$r"
done
b "$T/drone_build.py" -- "$D/eyes/drone-eyes-restorer.png" "$D/drone-base.blend"
b "$T/drone_role_kit.py" -- "$D/parts"
b "$T/drone_parts_procedural.py" -- "$D/drone-base.blend" "$D/parts"
b "$T/drone_roles.py" -- "$D/drone-base.blend" "$D/parts" "$D/preview/roles-grid.png"
python "$T/roles_grid.py" "$D/preview"
echo "drones built in $D"
