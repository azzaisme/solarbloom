"""B3 (#467): the assembler's arms behind real glass. Run by meshy_finish.py (`extra=`), with obj, parts, bpy,
Vector, bounds, tris, decimate and tri_count in scope.

Meshy paints the window opaque and loses the two gold arms inside, so:
- the window's pale faces (inside the gold frame, which wraps the front-right corner: the front at -y and the right
  side at +x) become `glass`, a see-through part (alpha blend);
- an inward-facing box is set just behind the glass, so through it you see the cabinet's lit back walls and floor,
  not the far side of the shell;
- a ceramic work plate stands on that floor, and two gold arms, `arm-left` and `arm-right`, hang from its ceiling,
  each with its origin at its shoulder so the game can swing it.
"""
import colorsys
import math

import bmesh

# The window's glass, inside its gold frame, measured on the finished model (orthographic front and side views with
# a 0.1 m grid). The frame wraps the front-right corner: on the front (y = -0.5) the glass runs from x = 0 round to
# the corner, on the right side (x = 0.47) from the corner back to y = -0.02.
GLASS_X0 = 0.0  # its left edge on the front
GLASS_Y1 = -0.02  # its back edge on the right side
GLASS_Z = (0.52, 1.47)

me = obj.data
img = next((n.image for m in me.materials if m and m.use_nodes for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image), None)
px = list(img.pixels) if img else []
w, h = img.size if img else (0, 0)


def albedo_uv(u):
    x, y = min(w - 1, int(u.x % 1 * w)), min(h - 1, int(u.y % 1 * h))
    i = (y * w + x) * 4
    return px[i], px[i + 1], px[i + 2]


def outward(f):
    return f.normal.y < -0.3 or f.normal.x > 0.3


def on_window_side(c):
    return c.y < -0.35 or c.x > 0.35


# Smart topology made those flat sides from a few big triangles that run past the frame, so first cut them along
# the glass edges (bisecting the faces that reach into the window; the cut edges are shared, so no crack opens),
# then take the pieces inside the edges that aren't gold.
bm = bmesh.new()
bm.from_mesh(me)
uvk = bm.loops.layers.uv.active
def reaching():
    """The outward faces on the window's sides that overlap the glass rectangle."""
    return [f for f in bm.faces if outward(f) and on_window_side(f.calc_center_median())
            and max(v.co.z for v in f.verts) > GLASS_Z[0] and min(v.co.z for v in f.verts) < GLASS_Z[1]
            and max(v.co.x for v in f.verts) > GLASS_X0 and min(v.co.y for v in f.verts) < GLASS_Y1]


for co, no in (((GLASS_X0, 0, 0), (1, 0, 0)), ((0, GLASS_Y1, 0), (0, 1, 0)), ((0, 0, GLASS_Z[0]), (0, 0, 1)), ((0, 0, GLASS_Z[1]), (0, 0, 1))):
    fs = reaching()
    bmesh.ops.bisect_plane(bm, geom=list({e for f in fs for e in f.edges} | {v for f in fs for v in f.verts}) + fs, plane_co=co, plane_no=no)
glass_faces = set()
bm.faces.ensure_lookup_table()
for f in bm.faces:
    c = f.calc_center_median()
    if not (outward(f) and on_window_side(c) and GLASS_Z[0] < c.z < GLASS_Z[1] and c.x > GLASS_X0 and c.y < GLASS_Y1):
        continue
    u = sum((l[uvk].uv for l in f.loops), Vector((0, 0))) / len(f.loops)
    hh, s, v = colorsys.rgb_to_hsv(*albedo_uv(u))
    if 25 <= hh * 360 <= 65 and s > 0.3:
        continue  # the gold frame stays on the body
    glass_faces.add(f.index)
bm.to_mesh(me)
bm.free()
me.update()
area = sum(me.polygons[i].area for i in glass_faces)
# the pane is about 0.47 x 0.95 on the front and 0.48 x 0.95 on the side
if not 0.5 < area < 1.1:
    raise SystemExit(f"assembler: the glass found covers {area:.2f} m2, not the window's ~0.9 m2")

bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="DESELECT")
bpy.ops.object.mode_set(mode="OBJECT")
for p in me.polygons:
    p.select = p.index in glass_faces
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.separate(type="SELECTED")
bpy.ops.object.mode_set(mode="OBJECT")
glass = [x for x in bpy.context.selected_objects if x is not obj][0]
glass.name = glass.data.name = "glass"
gm = glass.data.materials[0].copy()
gm.name = "assembler-glass"
bsdf = next(n for n in gm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
for link in list(bsdf.inputs["Alpha"].links):  # the importer wires the texture's alpha in: the pane's own value instead
    gm.node_tree.links.remove(link)
bsdf.inputs["Alpha"].default_value = 0.15
bsdf.inputs["Roughness"].default_value = 0.08
for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
    if hasattr(gm, attr):
        try:
            setattr(gm, attr, val)
        except (TypeError, ValueError):
            pass
glass.data.materials[0] = gm
parts.append(glass)
ga, gb = bounds(glass)
print("GLASS", len(glass.data.polygons), "faces", round(area, 2), "m2", tuple(round(x, 2) for x in ga), tuple(round(x, 2) for x in gb))


def material(nm, rgb, metal, rough):
    m = bpy.data.materials.new(nm)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    return m


INSIDE = material("assembler-inside", (0.62, 0.56, 0.48), 0.0, 0.7)
GOLD = material("assembler-gold", (0.86, 0.64, 0.26), 0.85, 0.32)
CERAMIC = material("assembler-plate", (0.9, 0.86, 0.78), 0.0, 0.45)


def new_obj(nm, bm, mat, at=Vector()):
    m = bpy.data.meshes.new(nm)
    bm.to_mesh(m)
    bm.free()
    m.materials.append(mat)
    o = bpy.data.objects.new(nm, m)
    bpy.context.scene.collection.objects.link(o)
    o.location = at
    return o


# the room behind the glass: from the window's left edge to just inside the right face, from just inside the front
# to the window's back edge; faces turned inward so its far walls and floor show through the glass
x0, x1 = GLASS_X0 - 0.03, gb.x - 0.07
y0, y1 = ga.y + 0.07, GLASS_Y1 + 0.03
z0, z1 = GLASS_Z[0] + 0.02, GLASS_Z[1] - 0.02
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1.0)
for v in bm.verts:
    v.co = Vector(((x0 + x1) / 2 + v.co.x * (x1 - x0), (y0 + y1) / 2 + v.co.y * (y1 - y0), (z0 + z1) / 2 + v.co.z * (z1 - z0)))
bmesh.ops.reverse_faces(bm, faces=bm.faces)
room = new_obj("inside", bm, INSIDE)
cx, cy = (x0 + x1) / 2, (y0 + y1) / 2

# the work plate on the floor
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.13, radius2=0.12, depth=0.05)
bmesh.ops.translate(bm, verts=bm.verts, vec=Vector((cx, cy, z0 + 0.025)))
plate = new_obj("plate", bm, CERAMIC)


def rod(bm, a, b, r, seg=8):
    """A cylinder from a to b, plus a ball at b (the joint)."""
    d = b - a
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=d.length)
    rot = d.normalized().to_track_quat("Z", "Y").to_matrix().to_4x4()
    bmesh.ops.transform(bm, verts=res["verts"], matrix=rot)
    bmesh.ops.translate(bm, verts=res["verts"], vec=(a + b) / 2)
    ball = bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=5, radius=r * 1.5)
    bmesh.ops.translate(bm, verts=ball["verts"], vec=b)


def arm(nm, side):
    """Hangs from the ceiling over the plate, elbow out to `side`, claw down by the plate. Origin at the shoulder."""
    # across the room diagonal (the window faces the front-right corner, so the arms sit either side of it)
    ax = Vector((0.62, 0.62, 0)) * side
    shoulder = Vector((cx, cy, z1)) + ax * 0.16
    elbow = Vector((cx, cy, z1 - 0.26)) + ax * 0.26
    wrist = Vector((cx, cy, z1 - 0.5)) + ax * 0.09
    bm = bmesh.new()
    mount = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.07, radius2=0.055, depth=0.05)
    bmesh.ops.translate(bm, verts=mount["verts"], vec=shoulder + Vector((0, 0, -0.02)))
    rod(bm, shoulder, elbow, 0.034)
    rod(bm, elbow, wrist, 0.028)
    for f in (-1, 1):  # two claw fingers
        tip = wrist + Vector((0, 0, -0.08)) + Vector((0.62, -0.62, 0)) * 0.035 * f
        rod(bm, wrist, tip, 0.016, 6)
    for v in bm.verts:
        v.co -= shoulder
    return new_obj(nm, bm, GOLD, shoulder)


arms = [arm("arm-left", -1), arm("arm-right", 1)]
# within budget: the body gives up what the new parts take
extra = sum(tri_count(o) for o in [glass, room, plate, *arms])
decimate(obj, tris - extra - 20)
parts += [room, plate, *arms]
print("ARMS", [round(tri_count(o)) for o in arms], "room", tri_count(room), "plate", tri_count(plate), "body", tri_count(obj))
