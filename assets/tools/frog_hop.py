"""The frog from "Frog Hopping" by radicalindigo (https://skfb.ly/6S6uZ, CC BY 4.0), made ready for the game: its own
skeleton and hop, turned to face the game's front, and the four visitor clips (owner, 27 Nov: "Start here, we shall
cutify once we know it's working").

    blender -b --factory-startup -P assets/tools/frog_hop.py -- <frog_hopping.glb> <out_dir>

Writes <out_dir>/frog.glb and frog.lod1.glb (the same model: it is 614 triangles). Metres, up +Z, front -Y (glTF +Z),
feet at 0, its rest pose the crouch the hop starts from (the game sizes an animal by its rest shape; the source's
rest pose has its legs spread). The clips, as rig_animals.py makes them for the other animals (NLA tracks, 24 fps):
- follow: the hop (crouch, kick, straight up, landing back on the spot it left): the game moves the frog along while
  it plays.
- climb: one hop, then holding the crouch (the game lifts it onto its perch while this plays).
- idle and sit: the crouch, breathing, the throat puffing out now and then.
Cute: a bigger head (and so bigger eyes) and shorter legs (CUTE), baked into the rest shape so the clips keep them.
Frog green with a cream belly, smooth shaded; two big glossy black eye spheres (owner: "a couple-a-big ol black eye
spheres") on the head's eye bumps, following the head bone.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

FPS = 24
LENGTH = 0.13                          # VISITOR_LOOK.frog.length (src/data/wildlife.ts)
GREEN = (0.267, 0.485, 0.068, 1)       # frog_green #8EB94A, linear
BELLY = (0.888, 0.799, 0.578, 1)       # cream #F2E7C8, linear
EYE = (0.02, 0.017, 0.014, 1)          # charcoal #28231F, linear
SRC_CLIP = "Take 001"
THROAT = "GothGirlHeadRibbite001_017"
SPINE = "GothGirlSpine_07"
HEAD = "GothGirlHead003_016"
EYES = [(-36.0, 86.0, 84.0), (36.0, 86.0, 84.0)]    # the eye bumps in the crouch (the source's units, front +Y)
EYE_R = 17.0
# cute (owner, 27 Nov: "Cutify it"): a bigger head (and so bigger eyes), shorter legs; baked into the rest shape
CUTE = {HEAD: 1.3, "GothGirlLBackLeg1_01": 0.85, "GothGirlRBackLeg1_04": 0.85,
        "GothGirlLFrontLeg1_09": 0.85, "GothGirlRFrontLeg1_012": 0.85}


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    for o in [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("Icosphere")]:
        bpy.data.objects.remove(o)    # (the importer's bone-shape helper)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH")
    return arm, mesh


def flatten(arm, mesh):
    """No parents above the armature and the mesh: the empties' transforms go into them, then the frog is turned to
    face -Y. (The importer's objects rotate by quaternion: their Euler angles do nothing.)"""
    turn = Matrix.Rotation(math.pi, 4, "Z")
    for o in (arm, mesh):
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = turn @ mw
    for o in [o for o in bpy.data.objects if o.type == "EMPTY"]:
        bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action="DESELECT")
    for o in (arm, mesh):
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    mesh.parent = arm
    mesh.matrix_parent_inverse = Matrix.Identity(4)
    for m in mesh.modifiers:
        if m.type == "ARMATURE":
            m.object = arm


def order(arm):
    out = []

    def walk(b):
        out.append(b.name)
        for c in b.children:
            walk(c)
    for b in arm.data.bones:
        if not b.parent:
            walk(b)
    return out


def sample(arm, act, frames):
    """Every bone's pose (armature space) at each whole frame of the source clip."""
    arm.animation_data_create()
    arm.animation_data.action = act
    sc = bpy.context.scene
    poses = []
    for f in frames:
        sc.frame_set(f)
        bpy.context.view_layer.update()
        poses.append({pb.name: pb.matrix.copy() for pb in arm.pose.bones})
    arm.animation_data.action = None
    return poses


def set_pose(arm, mats, names):
    for n in names:
        arm.pose.bones[n].matrix = mats[n]
        bpy.context.view_layer.update()


def rest_on(arm, mesh, mats=None, names=None):
    """The pose (the crouch, or whatever is on the skeleton) becomes the mesh's shape and the skeleton's rest pose;
    the weights stay."""
    if mats:
        set_pose(arm, mats, names)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = mesh
    mesh.select_set(True)
    for m in list(mesh.modifiers):
        if m.type == "ARMATURE":
            bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    mod = mesh.modifiers.new("rig", "ARMATURE")
    mod.object = arm


def normalise(arm, mesh):
    """Feet on 0, centred over its footprint, longest side LENGTH (metres)."""
    pts = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    lo = Vector([min(p[i] for p in pts) for i in range(3)]); hi = Vector([max(p[i] for p in pts) for i in range(3)])
    k = LENGTH / max(hi - lo)
    T = Matrix.Scale(k, 4) @ Matrix.Translation(-Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z)))
    mesh.parent = None
    mesh.data.transform(mesh.matrix_world)
    mesh.matrix_world = Matrix.Identity(4)
    mesh.data.transform(T)
    arm.matrix_world = T @ arm.matrix_world
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    mesh.parent = arm
    mesh.matrix_parent_inverse = Matrix.Identity(4)
    print("[frog] crouch", tuple(round(x * k, 4) for x in (hi - lo)), "m", flush=True)
    return T


def key(arm, frame, basis, k, extra=None):
    """basis: each bone's pose relative to its rest (its moves scaled by k, as the skeleton was)."""
    for pb in arm.pose.bones:
        loc, rot, scl = basis[pb.name].decompose()
        pb.matrix_basis = Matrix.LocRotScale(loc * k, rot, scl)
    for n, m in (extra or {}).items():
        pb = arm.pose.bones[n]
        pb.matrix_basis = pb.matrix_basis @ m
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        for path in ("location", "rotation_quaternion", "scale"):
            pb.keyframe_insert(path, frame=frame)


def make_clip(arm, name, keys, k):
    """keys: [(frame, basis, extra basis changes)] -> an action on its own muted NLA track."""
    act = bpy.data.actions.new(name)
    arm.animation_data.action = act
    for f, basis, extra in keys:
        key(arm, f, basis, k, extra)
    tr = arm.animation_data.nla_tracks.new()
    tr.name = name
    tr.strips.new(name, 0, act)
    tr.mute = True
    arm.animation_data.action = None
    act.use_fake_user = True


def breath(puff, breathe):
    """The throat puffed out by `puff` (0..1), the back rising a touch with `breathe` (-1..1)."""
    k = 1 + 0.55 * puff
    return {THROAT: Matrix.Diagonal((k, k, k, 1)), SPINE: Matrix.Rotation(math.radians(1.2 * breathe), 4, "X")}


def material(name, c, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = c
    bsdf.inputs["Roughness"].default_value = rough
    return m


def colour(mesh):
    """Frog green, the belly and throat cream (faces facing down), all smooth shaded."""
    me = mesh.data
    me.materials.clear()
    me.materials.append(material("frog_green", GREEN, 0.6))
    me.materials.append(material("cream", BELLY, 0.6))
    for p in me.polygons:
        p.material_index = 1 if p.normal.z < -0.55 else 0
        p.use_smooth = True
    # the source carries its own flat normals, which would win over smooth shading; and its seams split the surface
    # into pieces that shade apart: welded (by distance) and the normals worked out again
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    if me.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.object.mode_set(mode="OBJECT")
    for e in me.edges:
        e.use_edge_sharp = False


def eyes(mesh, src_to_out):  # (before normalise: the source's units, turned)
    """Two big glossy black spheres, skinned wholly to the head bone, joined into the frog's mesh."""
    m = material("eye", EYE, 0.12)
    parts = []
    r = EYE_R * src_to_out.to_scale()[0]
    for c in EYES:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=r, location=src_to_out @ Vector(c))
        e = bpy.context.object
        for p in e.data.polygons:
            p.use_smooth = True
        e.data.materials.append(m)
        e.vertex_groups.new(name=HEAD).add([v.index for v in e.data.vertices], 1.0, "REPLACE")
        parts.append(e)
    bpy.ops.object.select_all(action="DESELECT")
    for e in parts:
        e.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.join()


def run(src, out_dir):
    arm, mesh = load(src)
    src_act = bpy.data.actions[SRC_CLIP]
    f0, f1 = (int(round(x)) for x in src_act.frame_range)
    frames = list(range(f0, f1 + 1))
    # where the eyes go, in the source's world (before it is turned), kept with the turn and scale applied after
    flatten(arm, mesh)
    to_turned = Matrix.Rotation(math.pi, 4, "Z")
    names = order(arm)
    poses = sample(arm, src_act, frames)
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    arm.animation_data_create()
    for t in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(t)
    rest_on(arm, mesh, poses[0], names)
    # each frame relative to the crouch: the same turns work on the cute skeleton (it only differs in size)
    basis = []
    for p in poses:
        set_pose(arm, p, names)
        basis.append({pb.name: pb.matrix_basis.copy() for pb in arm.pose.bones})
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    colour(mesh)
    eyes(mesh, to_turned)
    for n, c in CUTE.items():
        arm.pose.bones[n].scale = (c, c, c)
    bpy.context.view_layer.update()
    rest_on(arm, mesh)
    T = normalise(arm, mesh)
    k = T.to_scale()[0]
    crouch = {n: Matrix.Identity(4) for n in names}
    make_clip(arm, "follow", [(i, basis[i], None) for i in range(len(frames))], k)
    make_clip(arm, "climb", [(i, basis[i], None) for i in range(len(frames))] + [(36, crouch, None)], k)
    make_clip(arm, "idle", [(f, crouch, breath(max(0.0, math.sin(4 * math.pi * f / 48)) ** 3, math.sin(2 * math.pi * f / 48)))
                            for f in range(0, 49, 2)], k)
    make_clip(arm, "sit", [(f, crouch, breath(max(0.0, math.sin(2 * math.pi * f / 48)) ** 4, math.sin(2 * math.pi * f / 48)))
                           for f in range(0, 49, 2)], k)
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.scene.render.fps = FPS
    os.makedirs(out_dir, exist_ok=True)
    for f in ("frog.glb", "frog.lod1.glb"):
        bpy.ops.object.select_all(action="DESELECT")
        arm.select_set(True)
        mesh.select_set(True)
        bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, f), export_format="GLB", use_selection=True,
                                  export_yup=True, export_animations=True, export_animation_mode="NLA_TRACKS",
                                  export_skins=True)
        print("[frog] wrote", f, flush=True)


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:]
    run(args[0], args[1])
