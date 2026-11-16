"""Builds the Spark tail (a thin coil ending in a glowing crystal) as clean quads.

- spark-tail: a gold pig-tail coil behind the drone ending in a glowing crystal.
(The Scout wings moved to drone_role_kit.py, built from the leaf-ear shape.)

Built directly in drone space (face +X, up +Z), so drone_roles.py places it as it is.
Writes <parts>/<name>.blend (quads) and <name>.glb.

blender -b --python assets/tools/drone_parts_procedural.py -- assets/raw/drone/drone-base.blend assets/raw/drone/parts
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model_io

args = sys.argv[sys.argv.index("--") + 1:]
base, parts_dir = (os.path.abspath(a) for a in args[:2])


def srgb_to_linear(hexs):
    c = [int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1]


def palette_mat(key, hexs, rough, metal, glow=0.0):
    """Same naming and values as drone_build.py, so the game swaps these for its shared materials."""
    name = "pal_" + key
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = srgb_to_linear(hexs)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if glow:
        b.inputs["Emission Color"].default_value = srgb_to_linear(hexs)
        b.inputs["Emission Strength"].default_value = glow
    return m


def stretch_along(d, k):
    """Matrix that scales by k along unit direction d and leaves the perpendicular plane alone."""
    m = Matrix.Identity(3)
    for i in range(3):
        for j in range(3):
            m[i][j] += (k - 1) * d[i] * d[j]
    return m.to_4x4()


def save(obj, name):
    obj.name = obj.data.name = name
    for o in list(bpy.context.scene.objects):
        o.select_set(o is obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
    model_io.save(os.path.join(parts_dir, name + ".glb"), [obj])
    model_io.save(os.path.join(parts_dir, name + ".blend"), [obj])
    quads = sum(len(p.vertices) == 4 for p in obj.data.polygons)
    print(f"{name}: {len(obj.data.polygons)} faces, {quads} quads")


# ---------------------------------------------------------------- spark tail
bpy.ops.wm.read_factory_settings(use_empty=True)
gold = palette_mat("gold", "#e8ba40", 0.28, 0.55)
spark = palette_mat("flowerCore", "#ffe28a", 0.3, 0.0, glow=1.2)

# Pig-tail spiral in the XZ plane behind the drone: starts just inside the back of the body and curls
# back, under and up, tightening as it goes.
root = Vector((-0.27, 0.0, -0.12))
centre = Vector((-0.45, 0.0, 0.0))
rel = root - centre
r0, th0 = math.hypot(rel.x, rel.z), math.atan2(rel.z, rel.x)
N, TURNS = 48, 1.15
cu = bpy.data.curves.new("tail", "CURVE"); cu.dimensions = "3D"
sp = cu.splines.new("POLY"); sp.points.add(N)
for i in range(N + 1):
    t = i / N
    th = th0 - 2 * math.pi * TURNS * t
    r = r0 * (1 - 0.62 * t)
    sp.points[i].co = (centre.x + r * math.cos(th), 0.0, centre.z + r * math.sin(th), 1)
    sp.points[i].radius = 1.0 - 0.45 * t                                # taper toward the tip
cu.bevel_depth = 0.016; cu.bevel_resolution = 2; cu.use_fill_caps = False
coil = bpy.data.objects.new("coil", cu); bpy.context.scene.collection.objects.link(coil)
bpy.context.view_layer.objects.active = coil; coil.select_set(True)
bpy.ops.object.convert(target="MESH")
coil = bpy.context.active_object
coil.data.materials.clear(); coil.data.materials.append(gold)
end = sp_end = Vector((centre.x + r0 * 0.38 * math.cos(th0 - 2 * math.pi * TURNS), 0.0,
                      centre.z + r0 * 0.38 * math.sin(th0 - 2 * math.pi * TURNS)))

# Crystal: a cube rounded toward a sphere and stretched into a gem, all quads.
cbm = bmesh.new()
bmesh.ops.create_cube(cbm, size=1.0)
bmesh.ops.subdivide_edges(cbm, edges=cbm.edges[:], cuts=1, use_grid_fill=True)
for v in cbm.verts:
    v.co = v.co.lerp(v.co.normalized() * 0.5, 0.55)
cm = bpy.data.meshes.new("crystal"); cbm.to_mesh(cm); cbm.free()
cm.transform(Matrix.Translation(end + Vector((0, 0, 0.035))) @ Matrix.Diagonal((0.055, 0.055, 0.095, 1)))
cm.materials.append(spark)
crystal = bpy.data.objects.new("crystal", cm); bpy.context.scene.collection.objects.link(crystal)

bpy.ops.object.select_all(action="DESELECT")
coil.select_set(True); crystal.select_set(True); bpy.context.view_layer.objects.active = coil
bpy.ops.object.join()
save(bpy.context.active_object, "spark-tail")
