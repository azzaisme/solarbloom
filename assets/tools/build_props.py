"""Builds the hand-made prop, machine and landmark models (prop_models.py) with the shared kit (prop_kit.py).

blender -b --python assets/tools/build_props.py -- <out dir> [--detail] [name ...]     (no names: every model)
--detail adds the surface detail of prop_detail.py (shape wobble, baked normal map and grime) to the near version.

For each model writes to <out dir>:
  <name>.glb       near version (LOD0): one object per moving part, origins at their pivots
  <name>.lod1.glb  far version (LOD1): one object (not for skyline pieces)
  <name>.blend     the near version with quads
  <name>.png       a preview from the game's camera angle
and prints the triangle counts against the budgets in docs/art/meshy-assets.md.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import prop_kit as K
import prop_models as M

args = sys.argv[sys.argv.index("--") + 1:]
DETAIL = "--detail" in args          # wobble, normal map and grime (slow: Cycles bakes); off for quick shape checks
args = [a for a in args if a != "--detail"]
out_dir = os.path.abspath(args[0]); os.makedirs(out_dir, exist_ok=True)
names = args[1:] or list(M.MODELS)

# docs/art/meshy-assets.md budgets: (LOD0 max triangles, LOD1 max triangles; 0 = no far version)
BUDGET = {"hero": (8000, 1000), "machine": (5000, 1000), "landmark": (8000, 1500), "obstacle": (1200, 300),
          "clutter": (1500, 400), "planter": (800, 200), "skyline": (500, 0)}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def build(name, lod):
    K.LOD = lod
    reset()
    parts = M.MODELS[name][1]()
    objs = []
    for pname, spec in parts.items():
        ol, pivot = spec if isinstance(spec, tuple) else (spec, (0, 0, 0))
        objs.append(K.join(pname, ol, pivot))
    return objs


def export(path, objs):
    for o in bpy.context.scene.objects:
        o.select_set(o in objs)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_image_format="JPEG", export_jpeg_quality=88)


def render(path, objs):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = sc.render.resolution_y = 640
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"; sc.view_settings.exposure = -0.45
    w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.9, 0.95, 1.0, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.55
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 2.6; sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam)
    cam.data.type = "ORTHO"; sc.camera = cam
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)]); hi = Vector([max(p[i] for p in pts) for i in range(3)])
    tgt = (lo + hi) / 2
    d = Vector((0.62, -1.0, 0.78)).normalized()            # front-right, ~38 degrees down: the game's view
    cam.location = tgt + d * (hi - lo).length * 3
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()
    cp = [inv @ p for p in pts]
    span = max(max(p.x for p in cp) - min(p.x for p in cp), max(p.y for p in cp) - min(p.y for p in cp))
    cx = (max(p.x for p in cp) + min(p.x for p in cp)) / 2; cy = (max(p.y for p in cp) + min(p.y for p in cp)) / 2
    cam.location = cam.matrix_world @ Vector((cx, cy, 0))
    cam.data.ortho_scale = span * 1.12
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


report = []
for name in names:
    klass = M.MODELS[name][0]
    b0, b1 = BUDGET[klass]
    objs = build(name, 0)
    t0 = K.tri_count(objs)
    part_names = [o.name for o in objs]
    if DETAIL:
        import prop_detail
        pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
        size = max(max(p[i] for p in pts) - min(p[i] for p in pts) for i in range(3))
        prop_detail.apply(objs, size, klass, name)
    export(os.path.join(out_dir, name + ".glb"), objs)
    render(os.path.join(out_dir, name + ".png"), objs)
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o)
    if DETAIL:
        bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, name + ".blend"), compress=True)
    t1 = 0
    if b1:
        objs = build(name, 1)
        far = K.join(name + "_lod1", objs)
        t1 = K.tri_count([far])
        export(os.path.join(out_dir, name + ".lod1.glb"), [far])
    flag = "" if t0 <= b0 and (not b1 or t1 <= b1) else "  OVER BUDGET"
    report.append(f"{name:20s} {klass:9s} LOD0 {t0:6d}/{b0}  LOD1 {t1:5d}/{b1}  parts {part_names}{flag}")
print("\n".join(["PROPS"] + report))
