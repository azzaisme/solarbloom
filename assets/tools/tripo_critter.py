"""Finishes a Tripo animal for the game: palette colours instead of a texture, the triangle budget, real size.

    blender -b --factory-startup -P assets/tools/tripo_critter.py -- <in_dir> <out_dir> [name ...]

Reads <in_dir>/<name>.glb (a textured Tripo model, made from the wildlife sheet) and writes <out_dir>/<name>.glb and
<name>.lod1.glb, ready for rig_animals.py (which adds the skeleton and the idle / follow / sit / climb clips):

- Turned to the game's convention: metres, up +Z, front -Y (glTF +Z), pivot at the feet, longest side = its length.
  Tripo's animals face +X; the butterflies come upright (a front picture) and are laid flat, wings out to the sides.
- Coloured per face from the 12-colour animal palette only. Each face takes the palette colour nearest (in Lab) to
  the texture under it, chosen from that animal's own short list, so shading in the texture cannot pick a stray
  colour. Lone faces that differ from every neighbour take their neighbours' colour. Butterfly wings are one solid
  colour (the owner: no spots at this size).
- Decimated (collapse, no remesh) to the budget. The colours are written per face corner before decimating, so the
  colour edges are kept as seams; afterwards each face is snapped back to one palette colour. Smooth shaded.
- Eyes (owner: glossy, black, cute and round): the texture's two dark eye patches are found (a matching pair of
  Charcoal patches, high and to the front), painted over, and replaced with round Charcoal domes with a small Cream
  highlight, in a second, glossy material. The butterflies have none (a few pixels across in the game).
- No textures: the materials read the vertex colour (COLOR_0).
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

PAL = {
    "charcoal": "#28231F", "dark_brown": "#5B4628", "warm_brown": "#95602E", "cream": "#F2E7C8",
    "orange": "#E48D33", "golden_yellow": "#F4BD37", "coral": "#E86F4E", "frog_green": "#8EB94A",
    "leaf_green": "#5F9537", "bright_blue": "#3A93D8", "deep_navy": "#364968", "cool_grey_blue": "#98A9C1",
}
# "eye" is not a colour the model keeps: listed for an animal, it gathers the texture's blackest region (its eyes)
# apart from Charcoal stripes or legs, so the eyes are easy to find; it is painted Charcoal afterwards.
MATCH = dict(PAL, eye="#050505")

# name: (length m, LOD0 triangle budget, colours it may use, options)
# "yaw": degrees to turn it (anticlockwise from above) so it faces forward: Tripo kept the sheet's three-quarter pose
# for a few. "eyes": each eye's spot by hand (see eye_specs). "ring": colours round the eyes to repaint (the owl's orange irises). "eye_scale": bigger eyes.
# "regions": the texture is first split into as many colour regions as the list is long (k-means in Lab), then each
# region gets one list colour (the best one-to-one match), so a light tan chest stays apart from a brown back even
# when shading pulls both toward the same palette colour. A colour may be listed twice (two regions, one colour).
ANIMALS = {
    "butterfly": (0.18, 600, ["orange", "charcoal"], {"upright": True, "wings": ("orange", "charcoal"), "no_eyes": True}),
    "swallowtail": (0.20, 600, ["golden_yellow", "charcoal"], {"upright": True, "wings": ("golden_yellow", "charcoal"),
                                                           "no_eyes": True}),
    "bumblebee": (0.12, 800, ["golden_yellow", "charcoal", "cream", "eye"], {"regions": True, "yaw": 34}),
    "songbird": (0.24, 1500, ["warm_brown", "dark_brown", "orange", "cream", "charcoal"], {}),
    "squirrel": (0.31, 2000, ["orange", "cream", "charcoal"], {"regions": True, "yaw": 43}),
    "magpie": (0.27, 2000, ["charcoal", "deep_navy", "bright_blue", "cream"], {"regions": True}),
    "hedgehog": (0.28, 2000, ["dark_brown", "warm_brown", "cream", "charcoal"], {"regions": True}),
    "fox": (0.38, 3000, ["orange", "cream", "charcoal", "dark_brown"], {}),
    "frog": (0.13, 1000, ["frog_green", "cream", "golden_yellow", "charcoal"], {"regions": True, "recolour": {"golden_yellow": "cream"},
                                                                    "eyes": [(-0.0318, -0.0342, 0.08), (0.0279, -0.0366, 0.0865)]}),
    "owl": (0.28, 2500, ["cream", "cream", "cream", "orange", "charcoal"], {"regions": True, "ring": {"orange": "cream"},
                                                              "eye_scale": 1.35}),  # white (owner)
    "otter": (0.38, 3000, ["warm_brown", "cream", "charcoal"], {"regions": True}),
    "kingfisher": (0.22, 1200, ["bright_blue", "orange", "cream", "charcoal", "coral"], {}),
    "badger": (0.36, 3000, ["eye", "charcoal", "charcoal", "cream"], {"regions": True, "yaw": -51,
               "eyes": [(-0.033, -0.112, 0.094), (0.025, -0.108, 0.095)]}),
    "heron": (0.60, 3000, ["cool_grey_blue", "cream", "golden_yellow", "charcoal", "deep_navy"], {}),
    "fawn": (0.38, 2500, ["orange", "cream", "charcoal", "dark_brown"], {"regions": True}),
    "koi": (0.17, 1000, ["cream", "orange", "coral", "charcoal"], {"yaw": 31}),
    "golden-carp": (0.16, 1000, ["golden_yellow", "orange", "charcoal"], {}),
    "rainbow-minnow": (0.10, 1000, ["bright_blue", "cool_grey_blue", "cream", "coral", "eye"],
                       {"eyes": [(-0.0145, -0.034, 0.033), (0.0145, -0.034, 0.033)]}),
}
FILL = 0.92  # aim a little under each budget


def log(*a):
    print("[tripo-critter]", *a, flush=True)


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lab(rgb):
    """sRGB (0..1, N×3) to CIE Lab."""
    lin = srgb_to_lin(np.asarray(rgb, np.float64))
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = lin @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], 1)


def hex_rgb(h):
    n = int(h[1:], 16)
    return np.array([(n >> 16) & 255, (n >> 8) & 255, n & 255]) / 255


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.data.transform(mw)
        o.matrix_world = Matrix.Identity(4)
    for o in [o for o in bpy.context.scene.objects if o.type != "MESH"]:
        bpy.data.objects.remove(o)
    for o in bpy.context.scene.objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def texture_of(ob):
    for m in ob.data.materials:
        for n in m.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image:
                return n.image
    raise RuntimeError("no texture")


def kmeans(X, k, iters=30):
    """Plain k-means (deterministic k-means++ start: the farthest points)."""
    C = [X[np.argmin(np.linalg.norm(X - X.mean(0), axis=1))]]
    for _ in range(1, k):
        d = np.min([((X - c) ** 2).sum(1) for c in C], 0)
        C.append(X[d.argmax()])
    C = np.array(C)
    for _ in range(iters):
        lab_ = ((X[:, None] - C[None]) ** 2).sum(-1).argmin(1)
        C = np.array([X[lab_ == j].mean(0) if (lab_ == j).any() else C[j] for j in range(k)])
    return lab_, C


def match(C, P):
    """The one-to-one region -> colour assignment with the least total Lab distance."""
    from itertools import permutations
    best, best_d = None, 1e18
    for perm in permutations(range(len(P))):
        d = sum(np.linalg.norm(C[i] - P[j]) for i, j in enumerate(perm))
        if d < best_d:
            best, best_d = perm, d
    return best


def classify(ob, allowed, regions=False):
    """Palette name per face, from the texture under it."""
    img = texture_of(ob)
    img.scale(1024, 1024)
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[..., :3]
    if img.colorspace_settings.name != "sRGB":
        pass  # Tripo base colour is sRGB; pixels hold the stored (sRGB) values either way for byte images
    me = ob.data
    uv = me.uv_layers.active.data
    samples = []
    for p in me.polygons:
        cs = [Vector(uv[i].uv) for i in p.loop_indices]
        c = sum(cs, Vector((0, 0))) / len(cs)
        pts = [c] + [c + (q - c) * 0.6 for q in cs]
        col = np.zeros(3)
        for q in pts:
            x = min(w - 1, max(0, int((q.x % 1.0) * w)))
            y = min(h - 1, max(0, int((q.y % 1.0) * h)))
            col += px[y, x]
        samples.append(col / len(pts))
    L = lab(np.array(samples))
    P = lab(np.array([hex_rgb(MATCH[n]) for n in allowed]))
    if regions:
        lab_, C = kmeans(L, len(allowed))
        perm = match(C, P)
        log("regions", [(allowed[perm[j]], [round(x) for x in C[j]], int((lab_ == j).sum())) for j in range(len(C))])
        return [allowed[perm[j]] for j in lab_]
    # lightness counts for less than hue: the texture has soft shading baked in
    wgt = np.array([0.8, 1.0, 1.0])
    d = (((L[:, None, :] - P[None, :, :]) * wgt) ** 2).sum(-1)
    return [allowed[i] for i in d.argmin(1)]


def tidy(bm, cls, rounds=3):
    """Evens out speckle: a face takes the colour most of its neighbourhood (itself and the faces round its corners)
    has, when that colour is a clear majority."""
    bm.faces.ensure_lookup_table()
    ring = [{g.index for v in f.verts for g in v.link_faces} for f in bm.faces]
    for _ in range(rounds):
        new = list(cls)
        for f in bm.faces:
            ns = [cls[i] for i in ring[f.index]]
            best = max(set(ns), key=ns.count)
            if best != cls[f.index] and ns.count(best) > len(ns) * 0.55:
                new[f.index] = best
        cls = new
    return cls


def paint(me, cls):
    """One crisp colour per face, as face-corner colours (linear, as Blender stores them)."""
    if "Col" in me.color_attributes:
        me.color_attributes.remove(me.color_attributes["Col"])
    attr = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    lin = {n: tuple(srgb_to_lin(hex_rgb(h))) + (1.0,) for n, h in PAL.items()}
    for p in me.polygons:
        c = lin[cls[p.index]]
        for i in p.loop_indices:
            attr.data[i].color = c
    me.color_attributes.active_color = attr


def read_classes(me, allowed):
    """After decimating: each face's palette colour from its (interpolated) corner colours."""
    attr = me.color_attributes["Col"]
    P = {n: np.array(srgb_to_lin(hex_rgb(PAL[n]))) for n in allowed}
    out = []
    for p in me.polygons:
        votes = {}
        for i in p.loop_indices:
            c = np.array(attr.data[i].color[:3])
            n = min(P, key=lambda k: ((P[k] - c) ** 2).sum())
            votes[n] = votes.get(n, 0) + 1
        out.append(max(votes, key=votes.get))
    return out


def tris_of(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def decimate_to(ob, target):
    """Collapse-decimate to at most `target` triangles (the corner colours act as seams, so colour edges hold)."""
    src = ob.data.copy()
    ratio = target / tris_of(ob)
    for _ in range(12):
        ob.data = src.copy()
        mod = ob.modifiers.new("dec", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = min(1.0, ratio)
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=mod.name)
        n = tris_of(ob)
        if n <= target:
            return n
        ratio *= target / n * 0.98
    return tris_of(ob)


def material(name, roughness=0.8):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = roughness
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


# ---------------------------------------------------------------- eyes
def patches(bm, cls, colour):
    """Edge-connected groups of faces of one colour: (faces, area, centre, normal)."""
    bm.faces.ensure_lookup_table()
    seen, out = set(), []
    for f in bm.faces:
        if f.index in seen or cls[f.index] != colour:
            continue
        group, stack = [], [f]
        seen.add(f.index)
        while stack:
            g = stack.pop()
            group.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen and cls[h.index] == colour:
                        seen.add(h.index)
                        stack.append(h)
        area = sum(g.calc_area() for g in group)
        c = sum((g.calc_center_median() * g.calc_area() for g in group), Vector()) / max(area, 1e-12)
        n = sum((g.normal * g.calc_area() for g in group), Vector()).normalized()
        out.append((group, area, c, n))
    return out


def find_eyes(bm, cls, dims, colour):
    """The two eye patches: a pair of similar Charcoal patches, level with each other, either side of the head,
    looking out to either side; the highest and most forward such pair."""
    W, L, H = dims
    ps = [p for p in patches(bm, cls, colour) if p[1] > (0.004 * L) ** 2]
    best, best_s = None, None
    for i in range(len(ps)):
        for j in range(i + 1, len(ps)):
            a, b = ps[i], ps[j]
            if max(a[1], b[1]) > 2.5 * min(a[1], b[1]):
                continue
            if abs(a[2].z - b[2].z) > 0.08 * H or (a[2] - b[2]).length > 0.45 * max(W, L) or abs(a[2].x - b[2].x) < 0.04 * W:
                continue
            if max(a[1], b[1]) > (0.2 * max(L, H)) ** 2:        # a stripe or a leg, not an eye
                continue
            if (a[3].x - b[3].x) * (a[2].x - b[2].x) < 0:      # the normals must part along x
                continue
            front = 1 - ((a[2].y + b[2].y) / 2 + L / 2) / L     # 1 at the front
            up = (a[2].z + b[2].z) / 2 / H
            score = front + 0.6 * up
            if best_s is None or score > best_s:
                best, best_s = (a, b), score
    return best


def paint_over(cls, group):
    """An old eye patch takes the colour round its edge."""
    ids = {g.index for g in group}
    ring = [cls[h.index] for g in group for e in g.edges for h in e.link_faces if h.index not in ids]
    if ring:
        c = max(set(ring), key=ring.count)
        for i in ids:
            cls[i] = c


def eye_specs(bm, cls, dims, length, colour, placed=None):
    """The two eyes: (centre on the surface, outward normal, radius). `placed` (the animal's "eyes" option) names
    each eye's spot by hand, (x, y, z) in metres, for heads turned aside or eyes inside a stripe: the biggest patch of
    the eye colour near each spot is used, or, if none is close, the surface there."""
    if os.environ.get("CRITTER_PATCHES"):
        for col in sorted(set(cls)):
            for g, a, c, n in patches(bm, cls, col):
                if a > (0.004 * length) ** 2 and a < (0.15 * length) ** 2:
                    log("patch", col, "area", round(a / length ** 2, 5), "at", tuple(round(x, 4) for x in c),
                        "n", tuple(round(x, 2) for x in n))
    if placed:
        ps = [p for col in {colour, "charcoal", "eye"} for p in patches(bm, cls, col) if p[1] < (0.2 * length) ** 2]
        pair = []
        for spot in placed:
            spot = Vector(spot[:3])
            close = [p for p in ps if (p[2] - spot).length < 0.04 * length]
            if close:
                pair.append(max(close, key=lambda p: p[1]))     # the whole eye patch, not a fleck beside it
            else:
                f = min(bm.faces, key=lambda f: (f.calc_center_median() - spot).length)
                pair.append(([], 0.0, f.calc_center_median(), f.normal.copy()))
    else:
        pair = find_eyes(bm, cls, dims, colour)
    if not pair:
        return []
    specs = []
    for group, area, c, n in pair:
        if not group:
            specs.append((c.copy(), n.copy(), 0.035 * length))
            continue
        # as wide as the patch (a ring round a pupil counts whole), a touch bigger: cute eyes
        span = max(((v.co - c) - n * (v.co - c).dot(n)).length for g in group for v in g.verts)
        r = min(max(span * 1.1, 0.02 * length), 0.07 * length)
        paint_over(cls, group)
        specs.append((c.copy(), n.copy(), r))
    return specs


EYE_RES = {False: (10, 6, 6, 4), True: (6, 4, 4, 3)}   # lod1 -> eye segments, rings, highlight segments, rings


def eye_tris(lod1):
    s, r, hs, hr = EYE_RES[lod1]
    return 2 * (2 * s * (r - 1) + 2 * hs * (hr - 1))


def add_eyes(me, specs, lod1):
    """Round Charcoal eye domes with a Cream highlight, on material slot 1 (glossy). Returns the new faces' colours."""
    bm = bmesh.new()
    bm.from_mesh(me)
    base = len(bm.faces)
    colours = []
    segs, rings, hsegs, hrings = EYE_RES[lod1]

    def dome(centre, frame, r, flat, colour, segs, rings):
        t, b, n = frame
        top = bm.verts.new(centre + n * r * flat)
        bot = bm.verts.new(centre - n * r * flat)
        grid = []
        for i in range(1, rings):
            ph = math.pi * i / rings
            row = []
            for s in range(segs):
                a = 2 * math.pi * s / segs
                row.append(bm.verts.new(centre + (t * math.cos(a) + b * math.sin(a)) * r * math.sin(ph)
                                        + n * r * flat * math.cos(ph)))
            grid.append(row)
        for s in range(segs):
            s2 = (s + 1) % segs
            bm.faces.new((top, grid[0][s2], grid[0][s]))
            colours.append(colour)
            bm.faces.new((bot, grid[-1][s], grid[-1][s2]))
            colours.append(colour)
            for i in range(len(grid) - 1):
                bm.faces.new((grid[i][s], grid[i][s2], grid[i + 1][s2], grid[i + 1][s]))
                colours.append(colour)

    for c, n, r in specs:
        up = Vector((0, 0, 1))
        t = up - n * up.dot(n)
        t = t.normalized() if t.length > 1e-4 else Vector((0, 1, 0))
        b = n.cross(t)
        centre = c - n * r * 0.3
        dome(centre, (t, b, n), r, 0.75, "charcoal", segs, rings)
        # the highlight: up and a little toward the front of the eye, sitting on its surface
        fwd = -0.2 if b.y > 0 else 0.2
        q = (t * 0.45 + b * fwd + n * 0.85).normalized()
        hp = centre + (t * q.dot(t) + b * q.dot(b)) * r + n * (q.dot(n) * r * 0.75 + r * 0.02)
        dome(hp, (t, b, n), r * 0.3, 0.45, "cream", hsegs, hrings)
    bm.faces.ensure_lookup_table()
    new = bm.faces[base:]
    bmesh.ops.recalc_face_normals(bm, faces=new)   # each dome is closed, so this points them all outward
    for f in new:
        f.material_index = 1
        f.smooth = True
    bm.to_mesh(me)
    bm.free()
    return colours


def finish(src, out_dir, name):
    length, budget, allowed, opt = ANIMALS[name]
    ob = load(src)
    me = ob.data
    # orientation: Tripo faces +X; turn so the front is -Y
    if opt.get("upright"):
        # a front picture: body up +Z, wings along Y, the picture's face toward +X -> lay it flat, head -Y, wings X
        R = Matrix(((0, -1, 0), (0, 0, -1), (1, 0, 0)))
    else:
        R = Matrix.Rotation(math.radians(-90), 3, "Z")
    me.transform(R.to_4x4())
    if opt.get("yaw"):
        me.transform(Matrix.Rotation(math.radians(opt["yaw"]), 4, "Z"))
    # clean: merge doubles, drop loose bits
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(me)
    bm.free()
    # real size, pivot at the feet
    vs = np.array([v.co[:] for v in me.vertices])
    lo, hi = vs.min(0), vs.max(0)
    k = length / (hi - lo).max()
    me.transform(Matrix.Translation(Vector((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]))))
    me.transform(Matrix.Scale(k, 4))

    cls = classify(ob, allowed, opt.get("regions", False))
    if "wings" in opt:
        wing, body = opt["wings"]
        vs = np.array([v.co[:] for v in me.vertices])
        span = vs[:, 0].max() - vs[:, 0].min()
        front = vs[:, 1].min() + 0.1 * (vs[:, 1].max() - vs[:, 1].min())   # the antenna tips, ahead of the wings
        cls = [body if abs(p.center.x) < 0.07 * span or (p.center.y < front and abs(p.center.x) < 0.25 * span) else wing
               for p in me.polygons]
    bm = bmesh.new()
    bm.from_mesh(me)
    cls = tidy(bm, cls)
    vs = np.array([v.co[:] for v in me.vertices])
    dims = tuple(vs.max(0) - vs.min(0))
    eye_colour = opt.get("eye_patch", "eye" if "eye" in allowed else "charcoal")
    specs = [] if opt.get("no_eyes") else eye_specs(bm, cls, dims, length, eye_colour, opt.get("eyes"))
    if opt.get("eye_scale"):
        specs = [(c, n, r * opt["eye_scale"]) for c, n, r in specs]
    if opt.get("ring"):
        for f in bm.faces:
            if cls[f.index] in opt["ring"] and any((f.calc_center_median() - c).length < 2.2 * r for c, n, r in specs):
                cls[f.index] = opt["ring"][cls[f.index]]
    cls = ["charcoal" if c == "eye" else c for c in cls]
    if "recolour" in opt:          # the frog: its pale belly region came out as the yellow one
        cls = [opt["recolour"].get(c, c) for c in cls]
    log(name, "eyes", [(tuple(round(x, 4) for x in c), round(r, 4)) for c, n, r in specs] or "NONE FOUND")
    bm.free()
    paint(me, cls)
    # textures and UVs go: the colours are the vertex colours now (and UV seams would cost triangles)
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.materials.clear()
    for img in list(bpy.data.images):
        bpy.data.images.remove(img)
    me.materials.append(material(name))
    me.materials.append(material(name + "-eyes", 0.12))
    hi_tris = tris_of(ob)

    outs = {}
    for suffix, target in (("", int(budget * FILL)), (".lod1", int(min(1000, math.ceil(budget / 2)) * FILL))):
        lod1 = bool(suffix)
        decimate_to(ob, target - (eye_tris(lod1) if specs else 0))
        cls2 = read_classes(ob.data, sorted({("charcoal" if c == "eye" else c) for c in allowed}))
        out = ob.copy()
        out.data = ob.data.copy()
        bpy.context.scene.collection.objects.link(out)
        for p in out.data.polygons:
            p.use_smooth = True
            p.material_index = 0
        cls2 = cls2 + add_eyes(out.data, specs, lod1)
        paint(out.data, cls2)
        n = tris_of(out)
        path = os.path.join(out_dir, name + suffix + ".glb")
        bpy.ops.object.select_all(action="DESELECT")
        out.select_set(True)
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                                  export_vertex_color="MATERIAL", export_normals=True)
        used = sorted(set(cls2))
        outs[suffix] = n
        log(name + suffix, "tris", hi_tris, "->", n, "colours", used)
        bpy.data.objects.remove(out)
    return outs


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:]
    in_dir, out_dir = args[0], args[1]
    os.makedirs(out_dir, exist_ok=True)
    for n in args[2:] or list(ANIMALS):
        finish(os.path.join(in_dir, n + ".glb"), out_dir, n)
