"""E23.10.2: finishes a Meshy prop for the game (Blender 5.0, background).

    timeout 180 blender -b -P meshy_finish.py -- in.glb out_dir name size_m axis tris tex [crop|leafy]

- Real scale: the model's height (axis "h") or widest side (axis "w") becomes `size_m` metres (1 tile = 1 m).
- Pivot at the base centre, transforms applied.
- Textures resized to `tex` pixels (512 for clutter and crops, 1024 for machines).
- Over budget: Decimate (collapse) down to `tris`. Never a remesh (a voxel remesh froze the PC).
- `crop`: the mesh is split by loose parts and every part whose albedo isn't leafy green is moved to an object
  named `fruit` (fruit, pods, heads, flowers); the rest is `plant`. The game hides `fruit` and scales the plant
  down for the growing stage and shows it at ripe. Leafy greens, blue-greens and dark stems are plant; white
  (flowers) and every other colour are fruit.
- `crop-faces`: the same, but each face is sorted by its own colour (flowers or grain heads fused to their stems).
  Add `pale=S,V` for a model whose flowers are pale tints close to its leaves (moonflower 0.35,0.65; mint 0.25,0.65).
- `leafy`: a crop with nothing to hide (seedling, lettuce, watercress): one `plant` object, no split.
- `part=NAME:x0,x1,y0,y1,z0,z1[:pivot]` (machines, repeatable): every loose piece of the finished mesh whose centre
  lies in that box (metres, after scaling: x across, y depth with the front at -y, z up from the base) becomes its
  own object NAME, so the game can turn or hide it (a rotor, a drum, a weathervane). Its origin is its pivot:
  `base` (default: centre of its footprint, at its bottom), `centre`, or `x,y,z` in metres.
- `extra=script.py` (machines): runs that script after the split, with `obj`, `parts`, `name` and `bpy` in scope,
  for hand-built parts Meshy cannot make (the assembler's arms behind real glass). It appends to `parts`.
- Writes <name>.glb, <name>.lod1.glb (Decimate to a quarter, at least 150 triangles) and <name>.png, a preview
  from the game camera (pitch 40°, yaw 45°).
"""
import colorsys
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model_io import base_color_image, load  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
src, out_dir, name, size_m, axis, tris, tex = argv[:7]
mode = argv[7] if len(argv) > 7 and "=" not in argv[7] else ""
SPLITS = []  # (name, box, pivot)
for a in argv[7:]:
    if a.startswith("part="):
        bits = a[5:].split(":")
        box = [float(x) for x in bits[1].split(",")]
        piv = bits[2] if len(bits) > 2 else "base"
        SPLITS.append((bits[0], box, piv))
EXTRA = next((a[6:] for a in argv[7:] if a.startswith("extra=")), None)
# optional `pale=S,V`: a per-model cutoff measured on its albedo; faces under saturation S and at or over value V are
# flowers (moonflower's cream trumpets, mint's lilac tips sit too close to their leaves for the general rule)
pale = next((tuple(float(x) for x in a[5:].split(",")) for a in argv[8:] if a.startswith("pale=")), None)
crop = mode in ("crop", "crop-faces")  # crop-faces: flowers fused to their stems, so each face is sorted alone
size_m, tris, tex = float(size_m), int(tris), int(tex)

meshes = load(src)
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
# drop the importer's empties so the object has no parent, then bake every transform into the mesh
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
for o in list(bpy.context.scene.objects):
    if o is not obj:
        bpy.data.objects.remove(o)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def bounds(o):
    vs = [o.matrix_world @ v.co for v in o.data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    return lo, hi


lo, hi = bounds(obj)
ext = hi - lo
k = size_m / (ext.z if axis == "h" else max(ext.x, ext.y))
centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
for v in obj.data.vertices:
    v.co = (v.co - centre) * k
obj.data.update()

# textures: resize and pack so the GLB carries them
for img in {n.image for m in obj.data.materials if m and m.use_nodes for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image}:
    if max(img.size) > tex:
        img.scale(tex, tex)
    img.pack()


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def decimate(o, target):
    have = tri_count(o)
    if have <= target:
        return
    mod = o.modifiers.new("dec", "DECIMATE")
    mod.ratio = target / have * 0.98
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=mod.name)


decimate(obj, tris)
parts = [obj]

if crop:
    img = base_color_image(obj)
    px = list(img.pixels) if img else []
    w, h = (img.size[0], img.size[1]) if img else (0, 0)

    def albedo(uv):
        x = min(w - 1, max(0, int(uv.x % 1 * w)))
        y = min(h - 1, max(0, int(uv.y % 1 * h)))
        i = (y * w + x) * 4
        return px[i], px[i + 1], px[i + 2]

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uvl = bm.loops.layers.uv.active
    bm.faces.ensure_lookup_table()
    # loose parts by flood fill over shared vertices
    seen, islands = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, isl = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            isl.append(g.index)
            for v in g.verts:
                for n in v.link_faces:
                    if n.index not in seen:
                        seen.add(n.index)
                        stack.append(n)
        islands.append(isl)

    def leafy(isl):
        if not px or uvl is None:
            return True
        r = g = b = 0.0
        n = 0
        for fi in isl:
            uvs = [loop[uvl].uv for loop in bm.faces[fi].loops]
            mid = sum((u for u in uvs), uvs[0] * 0) / len(uvs)
            # the face's UV centre counts three times: corners sit on atlas seams and pick up neighbouring colours
            for u, k in [(mid, 3)] + [(u, 1) for u in uvs]:
                c = albedo(u)
                r, g, b, n = r + c[0] * k, g + c[1] * k, b + c[2] * k, n + k
        hh, s, v = colorsys.rgb_to_hsv(r / n, g / n, b / n)
        hue = hh * 360
        if pale and s < pale[0] and v >= pale[1]:
            return False  # this model's measured flower colour
        if s < 0.2 and v > 0.6 or s < 0.35 and v > 0.75:
            return False  # white, cream and pale tints: flowers
        if v < 0.45 and 10 <= hue <= 60:
            return True  # dark browns: soil and pebbles at the base stay with the plant
        return s < 0.18 and v < 0.5 or 60 <= hue <= 230  # greens, blue-greens (sea kale) and dark stems are plant

    if mode == "crop-faces":
        islands = [[f.index] for f in bm.faces]
    fruit_faces = {fi for isl in islands if not leafy(isl) for fi in isl}
    bm.free()
    if fruit_faces and len(fruit_faces) < len(obj.data.polygons):
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="DESELECT")
        bpy.ops.object.mode_set(mode="OBJECT")
        for p in obj.data.polygons:
            p.select = p.index in fruit_faces
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.separate(type="SELECTED")
        bpy.ops.object.mode_set(mode="OBJECT")
        fruit = [o for o in bpy.context.scene.objects if o.type == "MESH" and o is not obj][0]
        fruit.name = "fruit"
        parts = [obj, fruit]
    obj.name = "plant"
else:
    obj.name = "plant" if mode == "leafy" else name


def loose_islands(o):
    """Face-index lists, one per loose piece (flood fill over shared vertices)."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    seen, out = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, isl = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            isl.append(g.index)
            for v in g.verts:
                for n in v.link_faces:
                    if n.index not in seen:
                        seen.add(n.index)
                        stack.append(n)
        out.append(isl)
    bm.free()
    return out


def split_part(o, pname, box, piv):
    """Moves the loose pieces whose centre is in `box` to a new object `pname`, origin at its pivot."""
    me = o.data
    take = set()
    for isl in loose_islands(o):
        vs = {vi for fi in isl for vi in me.polygons[fi].vertices}
        c = sum((me.vertices[vi].co for vi in vs), Vector()) / len(vs)
        lo_, hi_ = Vector((box[0], box[2], box[4])), Vector((box[1], box[3], box[5]))
        if lo_.x <= c.x <= hi_.x and lo_.y <= c.y <= hi_.y and lo_.z <= c.z <= hi_.z:
            take.update(isl)
    if not take or len(take) == len(me.polygons):
        raise SystemExit(f"part {pname}: the box {box} takes {len(take)} of {len(me.polygons)} faces")
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for p in me.polygons:
        p.select = p.index in take
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    new = [x for x in bpy.context.selected_objects if x is not o][0]
    new.name = pname
    new.data.name = pname
    a, b = bounds(new)
    if piv == "centre":
        at = (a + b) / 2
    elif piv == "base":
        at = Vector(((a.x + b.x) / 2, (a.y + b.y) / 2, a.z))
    else:
        at = Vector([float(x) for x in piv.split(",")])
    for v in new.data.vertices:
        v.co -= at
    new.location = at
    print("PART", pname, len(new.data.polygons), "faces, pivot", tuple(round(x, 3) for x in at))
    return new


for pname, box, piv in SPLITS:
    parts.append(split_part(obj, pname, box, piv))
if EXTRA:
    exec(compile(open(EXTRA).read(), EXTRA, "exec"), {"obj": obj, "parts": parts, "name": name, "bpy": bpy, "Vector": Vector, "bounds": bounds, "tex": tex, "tris": tris, "decimate": decimate, "tri_count": tri_count})

os.makedirs(out_dir, exist_ok=True)


def export(path, objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_image_format="JPEG", export_jpeg_quality=90)


export(os.path.join(out_dir, f"{name}.glb"), parts)
lod0 = sum(tri_count(o) for o in parts)
print("LOD0", name, lod0, "tris", " ".join(o.name for o in parts))

# LOD1 on copies
copies = []
# the far copies keep the near parts' names (the game finds a moving part by name at every distance), so the near
# ones step aside while the copies are named and exported
near_names = [o.name for o in parts]
for o in parts:
    o.name = o.name + "~near"
for o, nm in zip(parts, near_names):
    c = o.copy()
    c.data = o.data.copy()
    bpy.context.scene.collection.objects.link(c)
    # a quarter of the near version, never over the machine class's far budget (1,000; docs/art/meshy-assets.md)
    decimate(c, max(150 // len(parts), min(tri_count(o) // 4, 1000 // len(parts))))
    c.name = nm
    copies.append(c)
export(os.path.join(out_dir, f"{name}.lod1.glb"), copies)
print("LOD1", name, sum(tri_count(o) for o in copies))
for c in copies:
    bpy.data.objects.remove(c)
for o, nm in zip(parts, near_names):
    o.name = nm

# preview from the game camera
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = scene.render.resolution_y = 512
scene.render.film_transparent = True
scene.eevee.taa_render_samples = 16
scene.view_settings.view_transform = "Standard"
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.9, 0.88, 0.84, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.45
scene.world = world
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
scene.collection.objects.link(sun)
lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
for o in parts:
    a, b = bounds(o)
    lo = Vector(map(min, lo, a))
    hi = Vector(map(max, hi, b))
mid = (lo + hi) / 2
r = max((hi - lo).length / 2, 0.05)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type = "ORTHO"
cam.data.ortho_scale = r * 2.3
pitch, yaw = math.radians(40), math.radians(45)
d = r * 6
cam.location = mid + Vector((math.sin(yaw) * math.cos(pitch) * d, -math.cos(yaw) * math.cos(pitch) * d, math.sin(pitch) * d))
cam.rotation_euler = (math.radians(90) - pitch, 0, yaw)
scene.collection.objects.link(cam)
scene.camera = cam
scene.render.filepath = os.path.join(out_dir, f"{name}.png")
bpy.ops.render.render(write_still=True)
print("PREVIEW", scene.render.filepath)
if crop and len(parts) > 1:
    # the growing stage: the plant without its fruit (a check image, next to the preview)
    parts[1].hide_render = True
    scene.render.filepath = os.path.join(out_dir, f"{name}.growing.png")
    bpy.ops.render.render(write_still=True)
    print("PREVIEW", scene.render.filepath)
if SPLITS:
    # a check image of what each box took: the split parts alone, the body hidden
    obj.hide_render = True
    scene.render.filepath = os.path.join(out_dir, f"{name}.parts.png")
    bpy.ops.render.render(write_still=True)
    obj.hide_render = False
    print("PREVIEW", scene.render.filepath)
