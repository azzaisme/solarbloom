"""Fits each role part onto the base drone and renders every role drone.

Each part is scaled so its largest side is `size` and its bounding-box centre lands on `at` (Blender
axes, drone origin: face +X, up +Z), with an optional Z turn. That placement is baked into the part,
so the game parents the part to the drone at the origin with no offsets. Outputs:
- <parts>/<name>.fit.glb per part (game),
- <drone>/roles/drone-<role>.blend per role: body, eyes and fitted parts as separate quad objects,
  with that role's trim colour on pal_gold and its eye sheet on the visor,
- role-<role>.png renders next to <grid.png> (tile them with roles_grid.py).

blender -b --python assets/tools/drone_roles.py -- assets/raw/drone/drone-base.blend assets/raw/drone/parts assets/raw/drone/preview/roles-grid.png
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model_io

args = sys.argv[sys.argv.index("--") + 1:]
base, parts_dir, grid_png = (os.path.abspath(a) for a in args[:3])

# role -> parts. Positions follow docs/DRONE_ROLES_EPIC.md section 2.9, pushed up and out so each
# role changes the silhouette seen from the game camera (which looks down at ~40 degrees).
ROLES = {
    "Restorer": [],
    "Gardener": [("gardener-kit", dict(at=(-0.35, 0.0, 0.0), size=0.42, turn=0)),
                 ("gardener-pot", dict(at=(-0.06, -0.10, 0.44), size=0.36, turn=30))],
    "Scout": [("scout-lens", dict(at=(0.36, -0.13, 0.11), size=0.15, turn=0)),
              ("scout-wings", dict(placed=True)),      # built in drone space by drone_parts_procedural.py
              ("scout-periscope", dict(placed=True))],  # built in drone space by drone_role_kit.py
    "Courier": [("courier-parcel", dict(at=(-0.40, 0.0, 0.0), size=0.38, turn=0)),
                ("courier-rotor", dict(placed=True))],
    "Spark": [("spark-tail", dict(placed=True)), ("spark-bolt", dict(placed=True))],
    "Harvester": [("harvester-basket", dict(at=(0.43, 0.0, -0.38), size=0.36, turn=0)),
                  ("harvester-arms", dict(placed=True)), ("harvester-fruit", dict(placed=True))],
}
# Role accent: replaces pal_gold (trim) on the body and every part. The game does the same swap.
# Spark's trim also glows (ACCENT_GLOW), which is what keeps its yellow apart from the Restorer's gold.
ACCENT = {"Restorer": "#e7b54a", "Gardener": "#5fbf43", "Scout": "#4cc3ea", "Courier": "#ff9a5a",
          "Spark": "#ffe14a", "Harvester": "#b48cff"}
ACCENT_GLOW = {"Spark": 0.8}
ROLES_DIR = os.path.join(os.path.dirname(parts_dir), "roles")
os.makedirs(ROLES_DIR, exist_ok=True)
EYES_DIR = os.path.join(os.path.dirname(parts_dir), "eyes")   # drone-eyes-<role>.png


def srgb_to_linear(hexs):
    c = [int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1]


def append_objects(path):
    with bpy.data.libraries.load(path) as (src, dst):
        dst.objects = list(src.objects)
    objs = [o for o in dst.objects if o is not None and o.type == "MESH"]
    for o in objs:
        bpy.context.scene.collection.objects.link(o)
    return objs


def fit(obj, at, size, turn):
    """Bakes rotation, scale and position into the mesh so the object sits at the origin transform."""
    obj.data.transform(Matrix.Rotation(math.radians(turn), 4, "Z"))
    pts = [v.co for v in obj.data.vertices]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    s = size / max(hi - lo)
    centre = (lo + hi) / 2
    obj.data.transform(Matrix.Translation(Vector(at)) @ Matrix.Scale(s, 4) @ Matrix.Translation(-centre))
    obj.matrix_world = Matrix.Identity(4)
    obj.data.update()


meshes = model_io.load(base)
drone = [o for o in meshes]
fitted = {}
for role, parts in ROLES.items():
    for name, how in parts:
        src = os.path.join(parts_dir, name + ".blend")
        if not os.path.exists(src):
            print("MISSING", src)
            continue
        (part,) = append_objects(src)
        part.name = part.data.name = name
        if not how.get("placed"):
            fit(part, **how)
        fitted[name] = part
        bpy.ops.object.select_all(action="DESELECT"); part.select_set(True)
        bpy.ops.export_scene.gltf(filepath=os.path.join(parts_dir, name + ".fit.glb"), export_format="GLB",
                                  use_selection=True)
print("fitted:", sorted(fitted))

# Grid render: each role on its own from a 3/4 side view (face and back both visible), tiled with labels.
sc = bpy.context.scene
for o in list(sc.objects):
    if o.type != "MESH":
        bpy.data.objects.remove(o)
sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x = sc.render.resolution_y = 600
sc.render.film_transparent = True
sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.9, 0.95, 1.0, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.6
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.0; sun.rotation_euler = (math.radians(50), 0, math.radians(-60))
sc.collection.objects.link(sun)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam)
cam.data.type = "ORTHO"; cam.data.ortho_scale = 2.2; sc.camera = cam
tgt = Vector((-0.05, 0.0, 0.05))
cam.location = tgt + Vector((1.9, 1.9, 2.25))          # game-like: 45° yaw, ~40° pitch
cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()
tiles = []
for role, parts in ROLES.items():
    show = set(drone) | {fitted[n] for n, _ in parts if n in fitted}
    for o in sc.objects:
        if o.type == "MESH":
            o.hide_render = o not in show
    for m in bpy.data.materials:
        if m.name.startswith("pal_gold"):
            b = m.node_tree.nodes["Principled BSDF"]
            b.inputs["Base Color"].default_value = srgb_to_linear(ACCENT[role])
            b.inputs["Emission Color"].default_value = srgb_to_linear(ACCENT[role])
            b.inputs["Emission Strength"].default_value = ACCENT_GLOW.get(role, 0.0)
    eyes = os.path.join(EYES_DIR, f"drone-eyes-{role.lower()}.png")
    for n in bpy.data.materials["visor_eyes"].node_tree.nodes:
        if n.type == "TEX_IMAGE" and os.path.exists(eyes):
            n.image = bpy.data.images.load(eyes, check_existing=True)
    # Assembled role file: only this role's objects, written in their own scene with the materials as
    # they are set right now (the role's accent and eyes).
    rsc = bpy.data.scenes.new(f"drone-{role.lower()}")
    for o in show:
        rsc.collection.objects.link(o)
    role_blend = os.path.join(ROLES_DIR, f"drone-{role.lower()}.blend")
    bpy.data.libraries.write(role_blend, {rsc}, path_remap="RELATIVE_ALL", compress=True)
    bpy.data.scenes.remove(rsc)
    print("SAVED", role_blend)
    path = os.path.join(os.path.dirname(grid_png), f"role-{role.lower()}.png")
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    tiles.append((role, path))
print("TILES", ";".join(f"{r}={p}" for r, p in tiles))

