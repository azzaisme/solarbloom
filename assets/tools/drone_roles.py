"""Puts each role's parts on the base drone and renders every role drone.

Parts are built in drone space (placed=True). A part made elsewhere can instead be fitted: scaled so its
largest side is `size` with its bounding-box centre on `at` (Blender axes, drone origin: face +X, up +Z),
with an optional Z turn. Either way the game parents the part to the drone at the origin. Outputs:
- <parts>/<name>.fit.glb per part (game),
- <drone>/roles/drone-<role>.blend per role: body, eyes and fitted parts as separate quad objects,
  with that role's eye sheet on the visor (frame 0 is the role's own idle face),
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

# role -> parts. Every part is built in drone space on the redesigned body (drone_role_kit.py,
# drone_parts_procedural.py), so it is placed as it is. Each role changes the silhouette seen from the
# game camera (which looks down at ~40 degrees), and roles read by shape, not colour.
ROLES = {
    "Restorer": [],
    "Gardener": [("gardener-kit", dict(placed=True)), ("gardener-pot", dict(placed=True))],
    "Scout": [("scout-lens", dict(placed=True)), ("scout-wings", dict(placed=True)), ("scout-periscope", dict(placed=True))],
    "Courier": [("courier-parcel", dict(placed=True)), ("courier-rotor", dict(placed=True))],
    "Spark": [("spark-tail", dict(placed=True)), ("spark-bolt", dict(placed=True))],
    "Harvester": [("harvester-basket", dict(placed=True)), ("harvester-arms", dict(placed=True)),
                  ("harvester-fruit", dict(placed=True))],
}
# Drone trim stays gold on every role (the redesign spec); a role's accent colour belongs to its hub and icon.
ROLES_DIR = os.path.join(os.path.dirname(parts_dir), "roles")
os.makedirs(ROLES_DIR, exist_ok=True)
EYES_DIR = os.path.join(os.path.dirname(parts_dir), "eyes")   # drone-eyes-<role>.png


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
cam.location = tgt + Vector((2.45, 1.05, 2.25))        # game-like ~40° pitch, turned 23° so the face reads
cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()
tiles = []
for role, parts in ROLES.items():
    show = set(drone) | {fitted[n] for n, _ in parts if n in fitted}
    for o in sc.objects:
        if o.type == "MESH":
            o.hide_render = o not in show
    eyes = os.path.join(EYES_DIR, f"drone-eyes-{role.lower()}.png")
    for n in bpy.data.materials["visor_eyes"].node_tree.nodes:
        if n.type == "TEX_IMAGE" and os.path.exists(eyes):
            n.image = bpy.data.images.load(eyes, check_existing=True)
    # Assembled role file: only this role's objects, written in their own scene with this role's eyes.
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

