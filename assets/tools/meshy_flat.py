"""P7 (Meshy pilot): finishes an untextured Meshy mesh with flat palette materials instead of textures.

    python meshy_flat.py -- in.glb out_dir name height_m tris [palette]
      (Blender 5 as a Python module: `pip install bpy`; or `blender -b -P meshy_flat.py -- ...`)

- Joins every mesh, applies transforms, recentres: pivot at the base centre, the model's height becomes `height_m`.
- Cleans the mesh (merge by distance, delete loose, recalculate normals) and decimates (collapse) to `tris` triangles.
- Colours it with a few flat materials (no textures) chosen per face from its height and facing, so the palette stays
  the game's own and nothing needs a texture budget:
    stone   most faces
    low     faces near the base (weathered, darker)
    moss    faces that look up (ledges, broken tops), the greenery overgrowing the ruin
  The colours come from PALETTES below (sRGB hex); `palette` picks one (default `ruin`).
- Each material's colour is also written as a vertex colour (COLOR_0), so the game can draw the model either with its
  materials or with its vertex-coloured chunk material.
- Writes <name>.glb and <name>.png (a preview from the low follow camera's angle, pitch ~12°, yaw 30°, on a sky
  background), and prints the triangle count and size.
"""
import math
import os
import sys

import bpy  # first: as a Python module, bpy brings bmesh and mathutils with it
import bmesh
from mathutils import Vector

PALETTES = {
    # ivory ruined stone with moss (the distant ruined city, P7-E32)
    "ruin": {"stone": "#d8d0bf", "low": "#a99d88", "moss": "#7d9658"},
    # warm sea-cliff rock with a grassy top (what the ruins stand on)
    "cliff": {"stone": "#b8a88f", "low": "#8c7e6a", "moss": "#6f9150"},
}

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
src, out_dir, name, height_m, tris = argv[:5]
pal = PALETTES[argv[5] if len(argv) > 5 else "ruin"]
height_m = float(height_m)
tris = int(tris)


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h: str):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))


# ── load and join ──────────────────────────────────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
for o in bpy.context.scene.objects:
    o.select_set(o.type == "MESH")
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
for o in list(bpy.context.scene.objects):
    if o is not obj:
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# ── clean ──────────────────────────────────────────────────────────────────────────────────────────
bm = bmesh.new()
bm.from_mesh(obj.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4 * max(obj.dimensions))
loose = [v for v in bm.verts if not v.link_faces]
bmesh.ops.delete(bm, geom=loose, context="VERTS")
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(obj.data)
bm.free()
for uv in list(obj.data.uv_layers):
    obj.data.uv_layers.remove(uv)
obj.data.materials.clear()

# ── decimate ───────────────────────────────────────────────────────────────────────────────────────
def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)

before = tri_count(obj)
# planar first: flat walls and pillar faces merge into a few polygons (blocky shapes keep their silhouette), then a
# collapse takes the rest; collapse alone turns round arches into triangles
if before > tris:
    pl = obj.modifiers.new("planar", "DECIMATE")
    pl.decimate_type = "DISSOLVE"
    pl.angle_limit = math.radians(4)
    bpy.ops.object.modifier_apply(modifier=pl.name)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.quads_convert_to_tris()
    bpy.ops.object.mode_set(mode="OBJECT")
if tri_count(obj) > tris:
    mod = obj.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = tris / tri_count(obj)
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)

# ── scale and pivot: base centre at the origin, +Z up in Blender (glTF +Y up) ──────────────────────
co = [v.co for v in obj.data.vertices]
lo = Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co)))
hi = Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
k = height_m / max(hi.z - lo.z, 1e-6)
off = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
for v in obj.data.vertices:
    v.co = (v.co - off) * k
H = height_m

# ── flat materials per face ────────────────────────────────────────────────────────────────────────
order = ["stone", "low", "moss"]
for key in order:
    m = bpy.data.materials.new(f"{name}-{key}")
    r, g, b = (srgb_to_linear(c) for c in hex_rgb(pal[key]))
    m.diffuse_color = (r, g, b, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (r, g, b, 1)
    bsdf.inputs["Roughness"].default_value = 0.9
    bsdf.inputs["Metallic"].default_value = 0.0
    obj.data.materials.append(m)

counts = {k: 0 for k in order}
for p in obj.data.polygons:
    z = p.center.z / H
    up = p.normal.z
    if up > 0.55 and z > 0.12:
        key = "moss"
    elif z < 0.16:
        key = "low"
    else:
        key = "stone"
    p.material_index = order.index(key)
    counts[key] += 1

# vertex colours (per corner, so faces keep their material's colour)
attr = obj.data.color_attributes.new("COLOR_0", "BYTE_COLOR", "CORNER")
for p in obj.data.polygons:
    r, g, b = hex_rgb(pal[order[p.material_index]])
    for li in p.loop_indices:
        attr.data[li].color = (r, g, b, 1)
obj.data.validate()
obj.data.shade_flat()

# ── export ─────────────────────────────────────────────────────────────────────────────────────────
os.makedirs(out_dir, exist_ok=True)
obj.name = name
glb = os.path.join(out_dir, f"{name}.glb")
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=glb, use_selection=True, export_format="GLB", export_yup=True, export_apply=True,
                          export_vertex_color="ACTIVE", export_all_vertex_colors=False)

# ── preview: the low follow camera's angle on a sky background ─────────────────────────────────────
scene = bpy.context.scene
# Cycles on the CPU: the workbench and EEVEE need a GPU context, which a headless container hasn't got
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 24
scene.render.resolution_x = 960
scene.render.resolution_y = 540
world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.12, 0.33, 0.72, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.5
sun.data.color = (1.0, 0.94, 0.84)
sun.rotation_euler = (math.radians(50), 0, math.radians(35))
scene.collection.objects.link(sun)
w = max(obj.dimensions.x, obj.dimensions.y, H)
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 50
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
# frame the whole model: fit the larger of its width (16:9 frame) and its height
fit = max(max(obj.dimensions.x, obj.dimensions.y) / 1.6, H)
yaw, pitch, dist = math.radians(30), math.radians(12), fit * 4.2
cam.location = (math.sin(yaw) * math.cos(pitch) * dist, -math.cos(yaw) * math.cos(pitch) * dist, H * 0.5 + math.sin(pitch) * dist)
direction = Vector((0, 0, H * 0.5)) - cam.location
cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
scene.camera = cam
scene.render.filepath = os.path.join(out_dir, f"{name}.png")
bpy.ops.render.render(write_still=True)

print(f"{name}: {before} → {tri_count(obj)} triangles, {obj.dimensions.x:.2f} × {obj.dimensions.y:.2f} × {H:.2f} m, faces {counts}")
