# Tide’s sketchbook prototype

From the repository root, with Blender 4.3 and Python with NumPy, Pillow, and SciPy installed:

```sh
blender -b --python-exit-code 1 --python assets/tools/tide_sketch/capture.py -- \
  --model assets/raw/models/visitors/frog.glb --output /tmp/tide-frog
python assets/tools/tide_sketch/draw.py /tmp/tide-frog docs/review/tide-sketch
```

The capture also takes `--angle` in degrees from the front. The drawing takes `--seed` for repeatable changes to the pencil marks and paper grain. The comparison uses DejaVu Sans and Serif.

Blender captures the posed geometry, lighting, camera-space normals, depth, and object IDs from one camera. The drawing follows the projected normals with short pencil strokes. It uses the lit render for tonal detail such as pupils, and the depth and IDs to stop strokes at edges and overlaps.

Contours use two passes. Long, light construction marks drift across the projected edge. Shorter accents reinforce selected edges in shadow, leaving gaps around the subject.
