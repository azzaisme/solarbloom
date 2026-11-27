"""Rigs the B4 animals (#468) in Blender: a small armature from each animal's body plan, skin weights from the
distance to each bone, and four clips: idle, follow, sit, climb (docs/art/e23-models.md).

blender -b -P assets/tools/rig_animals.py -- <dir> [name ...]        (no names: every animal in PLANS)

Reads and rewrites <dir>/<name>.glb and <name>.lod1.glb (assets/raw/models/visitors/). Safe to run again: an existing
rig is stripped first. Cheap operations only (no remesh, no bone-heat solve): weights are computed here.

Conventions (as meshy_finish.py leaves the models): metres, up +Z, front -Y (glTF +Z), pivot at the feet.
Clips are 24 fps. idle, follow and sit loop; climb plays once and ends in the sit pose (the perch): the game moves
the animal to the perch while it plays.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

FPS = 24

# ---------------------------------------------------------------- body plans
# A bone: (name, parent, head, tail, kind). Points are (x, u, h): x across (-1 left … 1 right of the half-width),
# u along the body (0 the front … 1 the back), h up (0 the feet … 1 the top). kind limits which vertices it may
# take: 'leg' (its side, below its top, near it along the body), 'wing' (its side, away from the middle) or None.
QUAD = {
    "spine": ((0, .60, .55), (0, .28, .58)),
    "head": ((0, .24, .62), (0, .02, .70)),
    "tail": ((0, .64, .55), (0, 1.0, .60)),
    "legFL": ((-.45, .28, .45), (-.45, .28, 0)), "legFR": ((.45, .28, .45), (.45, .28, 0)),
    "legHL": ((-.45, .60, .45), (-.45, .60, 0)), "legHR": ((.45, .60, .45), (.45, .60, 0)),
}
BIRD = {
    "spine": ((0, .60, .35), (0, .35, .60)),
    "head": ((0, .35, .65), (0, .05, .80)),
    "tail": ((0, .62, .35), (0, 1.0, .35)),
    "legL": ((-.2, .50, .30), (-.2, .50, 0)), "legR": ((.2, .50, .30), (.2, .50, 0)),
    "wingL": ((-.55, .40, .55), (-.7, .80, .40)), "wingR": ((.55, .40, .55), (.7, .80, .40)),
}
INSECT = {
    "spine": ((0, .75, .50), (0, .25, .50)),
    "head": ((0, .25, .50), (0, 0, .50)),
    "wingL": ((-.12, .40, .55), (-1, .40, .60)), "wingR": ((.12, .40, .55), (1, .40, .60)),
}
FISH = {
    "spine": ((0, .35, .5), (0, 0, .5)),
    "tail1": ((0, .35, .5), (0, .58, .5)),
    "tail2": ((0, .58, .5), (0, .80, .5)),
    "tail3": ((0, .80, .5), (0, 1.0, .5)),
}


def plan(base, **over):
    p = dict(base)
    for k, v in over.items():
        if v is None:
            p.pop(k, None)
        else:
            p[k] = v
    return p


PLANS = {
    # kind, bones
    "fox": ("quad", plan(QUAD, spine=((0, .52, .55), (0, .2, .58)), head=((0, .18, .65), (0, 0, .75)),
                         tail=((0, .55, .55), (0, 1, .62)), legHL=((-.45, .48, .45), (-.45, .48, 0)),
                         legHR=((.45, .48, .45), (.45, .48, 0)), legFL=((-.45, .2, .45), (-.45, .2, 0)),
                         legFR=((.45, .2, .45), (.45, .2, 0)))),
    "hedgehog": ("quad", plan(QUAD, tail=None, head=((0, .3, .45), (0, 0, .3)),
                              legFL=((-.4, .3, .2), (-.4, .3, 0)), legFR=((.4, .3, .2), (.4, .3, 0)),
                              legHL=((-.4, .7, .2), (-.4, .7, 0)), legHR=((.4, .7, .2), (.4, .7, 0)),
                              spine=((0, .7, .45), (0, .3, .5)))),
    "squirrel": ("quad", plan(QUAD, spine=((0, .5, .25), (0, .35, .62)), head=((0, .35, .65), (0, .1, .78)),
                              tail=((0, .55, .3), (0, 1, .9)),
                              legFL=((-.3, .3, .5), (-.25, .15, .38)), legFR=((.3, .3, .5), (.25, .15, .38)),
                              legHL=((-.4, .4, .25), (-.4, .25, 0)), legHR=((.4, .4, .25), (.4, .25, 0)))),
    "otter": ("quad", plan(QUAD, spine=((0, .55, .45), (0, .2, .55)), head=((0, .18, .7), (0, 0, .75)),
                           tail=((0, .58, .4), (0, 1, .15)),
                           legFL=((-.45, .22, .35), (-.45, .22, 0)), legFR=((.45, .22, .35), (.45, .22, 0)),
                           legHL=((-.45, .5, .35), (-.45, .5, 0)), legHR=((.45, .5, .35), (.45, .5, 0)))),
    "badger": ("quad", plan(QUAD, spine=((0, .7, .55), (0, .3, .6)), head=((0, .3, .55), (0, 0, .4)),
                            tail=((0, .85, .55), (0, 1, .6)),
                            legFL=((-.45, .3, .3), (-.45, .3, 0)), legFR=((.45, .3, .3), (.45, .3, 0)),
                            legHL=((-.45, .72, .3), (-.45, .72, 0)), legHR=((.45, .72, .3), (.45, .72, 0)))),
    "fawn": ("quad", plan(QUAD, spine=((0, .75, .62), (0, .35, .65)), head=((0, .3, .72), (0, .1, .95)),
                          tail=((0, .85, .65), (0, 1, .6)),
                          legFL=((-.4, .35, .58), (-.4, .35, 0)), legFR=((.4, .35, .58), (.4, .35, 0)),
                          legHL=((-.4, .78, .58), (-.4, .78, 0)), legHR=((.4, .78, .58), (.4, .78, 0)))),
    "frog": ("frog", plan(QUAD, tail=None, spine=((0, .7, .3), (0, .3, .6)), head=((0, .3, .65), (0, .05, .6)),
                          legFL=((-.45, .25, .35), (-.5, .2, 0)), legFR=((.45, .25, .35), (.5, .2, 0)),
                          legHL=((-.6, .7, .3), (-.75, .45, 0)), legHR=((.6, .7, .3), (.75, .45, 0)))),
    "owl": ("bird", plan(BIRD, spine=((0, .5, .15), (0, .5, .55)), head=((0, .5, .55), (0, .3, 1.0)),
                         tail=((0, .7, .2), (0, 1, .1)),
                         legL=((-.2, .45, .15), (-.2, .4, 0)), legR=((.2, .45, .15), (.2, .4, 0)),
                         wingL=((-.75, .5, .55), (-.85, .65, .2)), wingR=((.75, .5, .55), (.85, .65, .2)))),
    "magpie": ("bird", plan(BIRD, spine=((0, .5, .4), (0, .25, .65)), head=((0, .25, .65), (0, 0, .7)),
                            tail=((0, .55, .5), (0, 1, .75)),
                            legL=((-.2, .4, .35), (-.2, .4, 0)), legR=((.2, .4, .35), (.2, .4, 0)),
                            wingL=((-.6, .3, .6), (-.6, .65, .55)), wingR=((.6, .3, .6), (.6, .65, .55)))),
    "songbird": ("bird", plan(BIRD, spine=((0, .55, .35), (0, .3, .65)), head=((0, .3, .65), (0, 0, .7)),
                              tail=((0, .6, .45), (0, 1, .85)),
                              wingL=((-.6, .35, .6), (-.7, .75, .5)), wingR=((.6, .35, .6), (.7, .75, .5)))),
    "kingfisher": ("bird", plan(BIRD, spine=((0, .6, .3), (0, .45, .65)), head=((0, .45, .65), (0, 0, .75)),
                                tail=((0, .65, .3), (0, 1, .25)),
                                legL=((-.2, .55, .25), (-.2, .55, 0)), legR=((.2, .55, .25), (.2, .55, 0)),
                                wingL=((-.6, .5, .6), (-.7, .85, .35)), wingR=((.6, .5, .6), (.7, .85, .35)))),
    "heron": ("bird", plan(BIRD, spine=((0, .6, .45), (0, .45, .65)), head=((0, .45, .65), (0, 0, .95)),
                           tail=((0, .65, .45), (0, 1, .45)),
                           legL=((-.15, .55, .45), (-.15, .55, 0)), legR=((.15, .55, .45), (.15, .55, 0)),
                           wingL=((-.6, .45, .65), (-.65, .9, .5)), wingR=((.6, .45, .65), (.65, .9, .5)))),
    "bumblebee": ("insect", plan(INSECT, spine=((0, .8, .4), (0, .3, .45)), head=((0, .3, .45), (0, 0, .4)),
                                 wingL=((-.2, .45, .65), (-.95, .35, 1.0)), wingR=((.2, .45, .65), (.95, .35, 1.0)))),
    "butterfly": ("insect", INSECT),
    "swallowtail": ("insect", INSECT),
    "koi": ("fish", FISH),
    "golden-carp": ("fish", FISH),
    "rainbow-minnow": ("fish", FISH),
}

# ---------------------------------------------------------------- rig
def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    for o in [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]:
        bpy.data.objects.remove(o)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for o in meshes:
        for m in list(o.modifiers):
            o.modifiers.remove(m)
        o.vertex_groups.clear()
        if o.data.shape_keys:
            o.shape_key_clear()
        mw = o.matrix_world.copy()
        o.parent = None
        o.data.transform(mw)
        o.matrix_world = Matrix.Identity(4)
    for o in [o for o in bpy.context.scene.objects if o.type not in ("MESH",)]:
        bpy.data.objects.remove(o)
    for o in bpy.context.scene.objects:
        o.select_set(o in meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def box(mesh):
    vs = [v.co for v in mesh.data.vertices]
    lo = Vector([min(v[i] for v in vs) for i in range(3)])
    hi = Vector([max(v[i] for v in vs) for i in range(3)])
    return lo, hi


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
    return (p - (a + ab * t)).length


def build(mesh, bones):
    lo, hi = box(mesh)
    W, L, H = hi.x - lo.x, hi.y - lo.y, hi.z
    xc = (lo.x + hi.x) / 2

    def P(x, u, h):
        return Vector((xc + x * W / 2, lo.y + u * L, h * H))

    arm = bpy.data.armatures.new("rig")
    ob = bpy.data.objects.new("rig", arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.edit_bones
    root = eb.new("root")
    root.head = Vector((xc, (lo.y + hi.y) / 2, 0)); root.tail = root.head + Vector((0, 0, max(H * 0.2, 0.01)))
    pts = {}
    for name, (h, t) in bones.items():
        b = eb.new(name)
        b.head, b.tail = P(*h), P(*t)
        if (b.tail - b.head).length < 1e-4:
            b.tail = b.head + Vector((0, 0, 0.01))
        pts[name] = (b.head.copy(), b.tail.copy())
    for name, b in [(b.name, b) for b in eb]:
        if name == "root":
            continue
        if name == "spine":
            b.parent = eb["root"]
        elif name.startswith("tail") and name != "tail" and name != "tail1":
            b.parent = eb["tail" + str(int(name[-1]) - 1)]
        elif name in ("head", "tail", "tail1") or name.startswith("wing") or name.startswith("legF") or \
                (name in ("legL", "legR") and False):
            b.parent = eb["spine"]
        else:
            b.parent = eb["root"]          # hind legs and bird legs stay with the root when the body tips
    bpy.ops.object.mode_set(mode="OBJECT")

    # weights: the nearest bones by distance to their segment, limited by kind
    groups = {n: mesh.vertex_groups.new(name=n) for n in bones}
    for v in mesh.data.vertices:
        p = v.co
        cand = []
        for n, (a, b) in pts.items():
            if n.startswith("leg"):
                side = -1 if n.endswith("L") else 1
                top = max(a.z, b.z) * 1.08
                if p.z > top or (p.x - xc) * side < -W * 0.04 or abs(p.y - (a.y + b.y) / 2) > L * 0.22:
                    continue
            if n.startswith("wing"):
                side = -1 if n.endswith("L") else 1
                if (p.x - xc) * side < W * 0.1:
                    continue
            cand.append((seg_dist(p, a, b), n))
        cand.sort()
        cand = cand[:3]
        ws = [(1.0 / (d + 0.02 * max(W, L, H)) ** 4, n) for d, n in cand]
        s = sum(w for w, _ in ws)
        for w, n in ws:
            if w / s > 0.02:
                groups[n].add([v.index], w / s, "REPLACE")
    mesh.parent = ob
    mod = mesh.modifiers.new("rig", "ARMATURE")
    mod.object = ob
    return ob, (W, L, H)


# ---------------------------------------------------------------- clips
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))


def pose_key(ob, frame, rots, offs):
    """rots: {bone: [(world axis, degrees), ...]} (applied in order), offs: {bone: world offset}."""
    for pb in ob.pose.bones:
        B = pb.bone.matrix_local.to_3x3()
        R = Matrix.Identity(3)
        k = 1.0
        for axis, deg in rots.get(pb.name, []):
            if axis is None:            # (None, f): shrink the bone to f of its length (a leg tucked up)
                k *= deg
                continue
            R = Matrix.Rotation(math.radians(deg), 3, axis) @ R
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (B.inverted() @ R @ B).to_quaternion()
        pb.location = B.inverted() @ offs.get(pb.name, Vector())
        pb.scale = (1.0, k, 1.0)
        pb.keyframe_insert("rotation_quaternion", frame=frame)
        pb.keyframe_insert("location", frame=frame)
        pb.keyframe_insert("scale", frame=frame)


def side(n):
    return -1 if n.endswith("L") else 1


def clip(ob, name, frames, fn, step=2):
    act = bpy.data.actions.new(name)
    ob.animation_data_create()
    ob.animation_data.action = act
    for f in list(range(0, frames, step)) + [frames]:
        rots, offs = fn(f / frames)
        pose_key(ob, f, rots, offs)
    tr = ob.animation_data.nla_tracks.new()
    tr.name = name
    tr.strips.new(name, 0, act)
    tr.mute = True
    ob.animation_data.action = None
    act.use_fake_user = True


def S(t, n=1.0, ph=0.0):
    return math.sin(2 * math.pi * (t * n + ph))


def ease(a, b, t):
    t = max(0.0, min(1.0, (t - a) / (b - a)))
    return t * t * (3 - 2 * t)


def clips_for(kind, bones, dims):
    W, L, H = dims
    legs = [b for b in bones if b.startswith("leg")]
    wings = [b for b in bones if b.startswith("wing")]
    has = lambda b: b in bones  # noqa: E731

    def top(b):
        """A leg's hip height (m): the higher end of its bone."""
        return max(bones[b][0][2], bones[b][1][2]) * H

    def spine_len():
        (x0, u0, h0), (x1, u1, h1) = bones["spine"]
        return math.hypot((u1 - u0) * L, (h1 - h0) * H) or 1e-3

    def sit_pose(k):
        """The sit, curl or roost pose, k from 0 (standing) to 1."""
        r, o = {}, {}
        if kind == "quad":
            # the hips sink by d; the hind legs fold forward just enough to keep the feet on the ground, and the
            # body tips up just enough that the front feet stay down too
            hind = [b for b in legs if "H" in b]
            d = 0.22 * min((top(b) for b in hind), default=0.45 * H)
            pitch = math.degrees(math.asin(min(0.9, d / spine_len())))
            r["spine"] = [(X, -pitch * k)]
            r["head"] = [(X, 0.6 * pitch * k)]
            for b in legs:
                if "F" in b:
                    r[b] = [(X, pitch * k)]
                else:
                    t = top(b)
                    r[b] = [(X, -math.degrees(math.acos(max(0.0, (t - d) / t))) * k)]
            if has("tail"):
                r["tail"] = [(Z, 25 * k)]
            o["root"] = Vector((0, 0, -d * k))
        elif kind == "frog":
            o["root"] = Vector((0, 0, -0.05 * H * k))
            r["spine"] = [(X, -6 * k)]
        elif kind == "bird":
            # roosting: it settles down and the legs tuck up into its belly feathers
            d = 0.85 * min(top(b) for b in legs)
            o["root"] = Vector((0, 0, -d * k))
            for b in legs:
                r[b] = [(X, 12 * k), (None, 1 - 0.85 * k)]
            r["head"] = [(X, 10 * k)]
        elif kind == "insect":
            for b in wings:
                r[b] = [(Y, -side(b) * 62 * k)]      # wings closed up over the back, as a perched butterfly
        elif kind == "fish":
            o["root"] = Vector((0, 0, -0.1 * H * k))
        return r, o

    def merge(*parts):
        r, o = {}, {}
        for pr, po in parts:
            for k, v in pr.items():
                r.setdefault(k, []).extend(v)
            for k, v in po.items():
                o[k] = o.get(k, Vector()) + v
        return r, o

    def idle(t):
        r, o = {}, {}
        r["spine"] = [(X, 1.5 * S(t, 2))]
        r["head"] = [(Z, 12 * S(t, 1)), (X, 3 * S(t, 2, .25))]
        if has("tail"):
            r["tail"] = [(Z, 14 * S(t, 2))]
        for b in wings:
            if kind == "insect":
                r[b] = [(Y, -side(b) * 35 * S(t, 12))]
            else:
                r[b] = [(Y, -side(b) * 3 * S(t, 2))]
        if kind == "insect":
            o["root"] = Vector((0, 0, 0.08 * H * S(t, 2)))
        if kind == "fish":
            for i, b in enumerate(["tail1", "tail2", "tail3"]):
                r[b] = [(Z, (6 + 4 * i) * S(t, 2, -0.12 * i))]
            r.pop("head", None)
        return r, o

    def follow(t):
        r, o = {}, {}
        if kind == "quad":                 # a trot: diagonal pairs, a bob each step
            for b in legs:
                pair = 0 if b in ("legFL", "legHR") else 0.5
                r[b] = [(X, 26 * S(t, 2, pair))]
            o["root"] = Vector((0, 0, 0.04 * H * abs(S(t, 2))))
            r["spine"] = [(X, 2 * S(t, 4))]
            r["head"] = [(X, 4 * S(t, 4, .2))]
            if has("tail"):
                r["tail"] = [(Z, 10 * S(t, 2)), (X, -10)]
        elif kind in ("bird", "frog"):     # hops: crouch, push off, an arc, land
            n = 2
            ph = (t * n) % 1
            up = math.sin(math.pi * min(1, ph / 0.6)) if ph < 0.6 else 0
            o["root"] = Vector((0, 0, (0.22 if kind == "bird" else 0.35) * H * up))
            for b in legs:
                hind = kind == "bird" or "H" in b
                r[b] = [(X, (35 if hind else -15) * up)]
            r["spine"] = [(X, -8 * up)]
            for b in wings:
                r[b] = [(Y, -side(b) * 25 * up)]
            if has("tail"):
                r["tail"] = [(X, -12 * up)]
        elif kind == "insect":             # flying along: fast wing beats, tipped forward
            for b in wings:
                r[b] = [(Y, -side(b) * 45 * S(t, 16))]
            r["spine"] = [(X, 12)]
            o["root"] = Vector((0, 0, 0.12 * H * S(t, 2)))
        elif kind == "fish":               # swimming: a travelling wave down the body
            r["spine"] = [(Z, 5 * S(t, 2, .25))]
            for i, b in enumerate(["tail1", "tail2", "tail3"]):
                r[b] = [(Z, (12 + 8 * i) * S(t, 2, -0.15 * i))]
        return r, o

    def sit(t):
        pr, po = sit_pose(1)
        br = {"spine": [(X, 1.2 * S(t, 1))]}
        if kind == "insect":
            br = {b: [(Y, -side(b) * 14 * S(t, 1))] for b in wings}   # slow open and close
        if kind == "fish":
            br = {b: [(Z, 4 * S(t, 1, -0.15 * i))] for i, b in enumerate(["tail1", "tail2", "tail3"])}
        return merge((pr, po), (br, {}), ({"head": [(Z, 8 * S(t, 0.5))]} if has("head") and kind != "fish" else {}, {}))

    def climb(t):
        # crouch (0–0.22), spring up (0.22–0.55), land (0.55–0.75), settle into the perch (0.75–1)
        crouch = ease(0, 0.22, t) * (1 - ease(0.22, 0.32, t)) + ease(0.55, 0.62, t) * (1 - ease(0.62, 0.75, t))
        up = math.sin(math.pi * ease(0.22, 0.6, t)) if 0.22 <= t <= 0.6 else 0
        r, o = {}, {}
        o["root"] = Vector((0, 0, -0.08 * H * crouch + 0.45 * H * up))
        if kind in ("quad", "frog"):
            for b in legs:
                hind = "H" in b
                r[b] = [(X, (-25 if hind else 25) * up + (20 if hind else -10) * crouch)]
            r["spine"] = [(X, -10 * up)]
        if kind == "bird" or kind == "insect":
            for b in wings:
                r[b] = [(Y, -side(b) * 50 * S(t, 6) * (up > 0.02))]
        if kind == "fish":
            for i, b in enumerate(["tail1", "tail2", "tail3"]):
                r[b] = [(Z, (16 + 10 * i) * S(t, 4, -0.15 * i))]
        return merge((r, o), sit_pose(ease(0.7, 1.0, t)))

    return [("idle", 48, idle), ("follow", 24 if kind in ("bird", "frog") else 16, follow), ("sit", 48, sit),
            ("climb", 36, climb)]


def rig(path, kind, bones):
    mesh = load(path)
    ob, dims = build(mesh, bones)
    for name, frames, fn in clips_for(kind, bones, dims):
        clip(ob, name, frames, fn)
    for o in bpy.context.scene.objects:
        o.select_set(o in (ob, mesh))
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                              export_animations=True, export_animation_mode="NLA_TRACKS", export_skins=True,
                              export_image_format="AUTO")
    return [a.name for a in bpy.data.actions]


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:]
    d = args[0]
    for n in args[1:] or list(PLANS):
        kind, bones = PLANS[n]
        for f in (n + ".glb", n + ".lod1.glb"):
            names = rig(os.path.join(d, f), kind, bones)
            print("RIGGED", f, kind, len(bones), "bones", names)
