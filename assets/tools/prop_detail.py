"""Surface detail for the hand-built models (build_props.py runs it on the near version, LOD0):

1. wobble: a gentle low-frequency push along the normals, so shapes look hand-made instead of CAD-perfect;
2. UVs: one shared UV layout over all of a model's parts (smart project + pack);
3. bake, in Cycles, from procedural shaders in world space (so parts line up):
   - a normal map: soft undulation, pits and dents (metal more, ceramic less), stone grain, wood grain;
   - an albedo map: the palette colour with grime: dirt in crevices (ambient occlusion), stains, dirt near the
     ground, darker pits, and a slight colour variation;
4. every pal_<key> material then reads the two maps (the key stays in its name, so the game can still tell
   glass, glow and the rest apart). Glass, water and glowing parts stay flat and clean.
"""
import math

import bmesh
import bpy
from mathutils import Vector, noise

import prop_kit as K

FLAT = {"glass", "glassPale", "water", "coreGlow", "eyeCyan", "windowLit"}
NO_WOBBLE = {"leafFin", "leafVein", "stem"}
METAL = {"gold", "copper", "iron", "rust"}
STONE = {"sandstone", "sandstoneDark", "sandstoneLight", "limestone", "limestoneDark", "concrete", "concreteDark",
         "terracotta", "soil", "soilDark"}
WOOD = {"kraft", "trunk"}
# (undulation, pits, grain, grime) by surface kind
AMOUNT = {"metal": (0.9, 1.4, 0.2, 1.0), "stone": (1.0, 1.0, 1.4, 1.1), "wood": (0.7, 0.5, 1.4, 1.0),
          "ceramic": (0.8, 0.6, 0.15, 1.1)}
TEX = {"hero": 1024, "machine": 1024, "landmark": 1024, "obstacle": 512, "clutter": 512, "planter": 512,
       "skyline": 256}


def kind(key):
    return "metal" if key in METAL else "stone" if key in STONE else "wood" if key in WOOD else "ceramic"


def key_of(m):
    return m.name[4:] if m.name.startswith("pal_") else m.name


# ---------------------------------------------------------------- 1. wobble
def wobble(objs, size):
    amp = 0.0035 * min(max(size, 0.4), 6) ** 0.6
    freq = 2.2 / min(max(size, 0.4), 6) ** 0.5
    for o in objs:
        me = o.data
        flat = {i for i, m in enumerate(me.materials) if m and key_of(m) in FLAT | NO_WOBBLE}
        a = min(amp, 0.04 * min(o.dimensions))         # thin parts barely move, so outlines keep their shape
        skip = {v for p in me.polygons if p.material_index in flat for v in p.vertices}
        mw = o.matrix_world; rot = mw.to_3x3()
        bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
        for v in bm.verts:
            if v.index in skip:
                continue
            w = mw @ v.co
            d = noise.noise(w * freq) + 0.4 * noise.noise(w * freq * 2.7 + Vector((7.1, 3.3, 1.9)))
            v.co += v.normal * (a * d)
        bm.to_mesh(me); bm.free()


# ---------------------------------------------------------------- 2. UVs
def unwrap(objs):
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    for x in bpy.context.scene.objects:
        x.select_set(x in objs)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")


# ---------------------------------------------------------------- 3. bake
class Nodes:
    def __init__(self, m):
        self.nt = m.node_tree; self.n = self.nt.nodes; self.l = self.nt.links

    def new(self, t, **kw):
        nd = self.n.new(t)
        for k, v in kw.items():
            if k.startswith("in_"):
                nd.inputs[k[3:].replace("_", " ")].default_value = v
            else:
                setattr(nd, k, v)
        return nd

    def link(self, a, b):
        self.l.new(a, b)

    def math(self, op, a, b=None, clamp=False):
        nd = self.new("ShaderNodeMath", operation=op, use_clamp=clamp)
        for i, x in enumerate((a, b)):
            if x is None:
                continue
            if isinstance(x, (int, float)):
                nd.inputs[i].default_value = x
            else:
                self.link(x, nd.inputs[i])
        return nd.outputs[0]

    def noise(self, pos, scale, detail=3.0, rough=0.55, stretch=None):
        v = pos
        if stretch:
            mp = self.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = stretch
            self.link(pos, mp.inputs["Vector"]); v = mp.outputs[0]
        nd = self.new("ShaderNodeTexNoise", in_Scale=scale, in_Detail=detail, in_Roughness=rough)
        self.link(v, nd.inputs["Vector"])
        return nd.outputs["Fac"]

    def remap(self, x, a, b, c=0.0, d=1.0):
        nd = self.new("ShaderNodeMapRange", clamp=True)
        nd.inputs["From Min"].default_value = a; nd.inputs["From Max"].default_value = b
        nd.inputs["To Min"].default_value = c; nd.inputs["To Max"].default_value = d
        self.link(x, nd.inputs["Value"])
        return nd.outputs["Result"]


def detail_shader(m, size, img_target):
    """Adds the procedural detail to a palette material; returns (bsdf normal socket source, final colour, emit)."""
    key = key_of(m)
    und, pits, grain, grime = AMOUNT[kind(key)]
    N = Nodes(m)
    bsdf = N.n["Principled BSDF"]; out = N.n["Material Output"]
    base = tuple(bsdf.inputs["Base Color"].default_value)
    pos = N.new("ShaderNodeNewGeometry").outputs["Position"]
    # height: undulation, clustered pits, grain
    h_und = N.noise(pos, 3.5, 4, 0.6)
    vor = N.new("ShaderNodeTexVoronoi", in_Scale=22.0); N.link(pos, vor.inputs["Vector"])
    pit = N.remap(vor.outputs["Distance"], 0.0, 0.16, 1.0, 0.0)
    cluster = N.remap(N.noise(pos, 2.2, 2), 0.4, 0.55)
    pit = N.math("MULTIPLY", pit, cluster)
    if kind(key) == "wood":
        g = N.noise(pos, 40.0, 4, 0.6, stretch=(1.0, 1.0, 0.08))
    else:
        g = N.noise(pos, 70.0, 3, 0.7)
    h = N.math("MULTIPLY", h_und, und)
    h = N.math("SUBTRACT", h, N.math("MULTIPLY", pit, pits))
    h = N.math("ADD", h, N.math("MULTIPLY", g, grain * 0.35))
    bump = N.new("ShaderNodeBump", in_Strength=0.9, in_Distance=0.004)
    N.link(h, bump.inputs["Height"]); N.link(bump.outputs["Normal"], bsdf.inputs["Normal"])
    # grime
    ao = N.new("ShaderNodeAmbientOcclusion", samples=16, in_Distance=min(0.25, 0.08 + 0.03 * size))
    crev = N.math("SUBTRACT", 1.0, ao.outputs["AO"])
    crev = N.remap(crev, 0.03, 0.45)
    stain = N.remap(N.noise(pos, 2.5, 5, 0.6), 0.52, 0.78)
    sep = N.new("ShaderNodeSeparateXYZ"); N.link(pos, sep.inputs[0])
    ground = N.remap(sep.outputs["Z"], 0.0, 0.12 + 0.05 * min(size, 4), 1.0, 0.0)
    dirt = N.math("ADD", N.math("MULTIPLY", crev, 0.7), N.math("MULTIPLY", stain, 0.3))
    dirt = N.math("ADD", dirt, N.math("MULTIPLY", ground, 0.45))
    dirt = N.math("ADD", dirt, N.math("MULTIPLY", pit, 0.5))
    streak = N.remap(N.noise(pos, 3.0, 4, 0.6, stretch=(9.0, 9.0, 0.5)), 0.58, 0.75)   # drip marks
    dirt = N.math("ADD", dirt, N.math("MULTIPLY", streak, 0.35))
    dirt = N.math("MULTIPLY", dirt, grime * 0.75, clamp=True)
    var = N.remap(N.noise(pos, 1.3, 2), 0.3, 0.7, 0.93, 1.05)
    col = N.new("ShaderNodeRGB"); col.outputs[0].default_value = base
    tv = N.new("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")      # colour x grime, by dirt
    N.link(col.outputs[0], tv.inputs[6]); tv.inputs[7].default_value = (0.5, 0.42, 0.33, 1)
    N.link(dirt, tv.inputs[0])
    shade = N.new("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")   # x slight brightness variation
    shade.inputs[0].default_value = 1.0
    N.link(tv.outputs[2], shade.inputs[6])
    vcol = N.new("ShaderNodeCombineColor")
    for i in range(3):
        N.link(var, vcol.inputs[i])
    N.link(vcol.outputs[0], shade.inputs[7])
    emit = N.new("ShaderNodeEmission"); N.link(shade.outputs[2], emit.inputs["Color"])
    tex = N.new("ShaderNodeTexImage"); tex.image = img_target
    N.n.active = tex
    return N, bsdf, out, emit, tex


def bake(objs, size, px, name):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"; sc.cycles.samples = 16; sc.cycles.device = "CPU"
    sc.render.bake.margin = 4
    alb = bpy.data.images.new(name + "_albedo", px, px); alb.colorspace_settings.name = "sRGB"
    nrm = bpy.data.images.new(name + "_normal", px, px); nrm.colorspace_settings.name = "Non-Color"
    nrm.generated_color = (0.5, 0.5, 1.0, 1.0)
    mats = {m for o in objs for m in o.data.materials if m and key_of(m) not in FLAT}
    if not mats:
        return None
    rig = {m: detail_shader(m, size, nrm) for m in mats}
    flat = {m for o in objs for m in o.data.materials if m and key_of(m) in FLAT}
    for m in flat:             # flat materials still need a bake target; they get a neutral result
        N = Nodes(m); t = N.new("ShaderNodeTexImage"); t.image = nrm; N.n.active = t
    for x in bpy.context.scene.objects:
        x.select_set(x in objs)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", use_clear=False)
    for m, (N, bsdf, out, emit, tex) in rig.items():
        tex.image = alb
        N.link(emit.outputs[0], out.inputs["Surface"])
    for m in flat:
        for nd in m.node_tree.nodes:
            if nd.type == "TEX_IMAGE":
                nd.image = alb
    bpy.ops.object.bake(type="EMIT", use_clear=False)
    # final materials: palette roughness / metal, the two maps
    for m, (N, bsdf, out, emit, tex) in rig.items():
        rough, metal = bsdf.inputs["Roughness"].default_value, bsdf.inputs["Metallic"].default_value
        emis_c = tuple(bsdf.inputs["Emission Color"].default_value); emis_s = bsdf.inputs["Emission Strength"].default_value
        for nd in list(N.n):
            N.n.remove(nd)
        b = N.new("ShaderNodeBsdfPrincipled"); o = N.new("ShaderNodeOutputMaterial")
        N.link(b.outputs[0], o.inputs["Surface"])
        b.inputs["Roughness"].default_value = rough; b.inputs["Metallic"].default_value = metal
        b.inputs["Emission Color"].default_value = emis_c; b.inputs["Emission Strength"].default_value = emis_s
        ta = N.new("ShaderNodeTexImage"); ta.image = alb; N.link(ta.outputs["Color"], b.inputs["Base Color"])
        tn = N.new("ShaderNodeTexImage"); tn.image = nrm
        nm = N.new("ShaderNodeNormalMap"); N.link(tn.outputs["Color"], nm.inputs["Color"])
        N.link(nm.outputs["Normal"], b.inputs["Normal"])
    for m in flat:
        for nd in list(m.node_tree.nodes):
            if nd.type == "TEX_IMAGE":
                m.node_tree.nodes.remove(nd)
    sc.render.engine = "BLENDER_EEVEE"
    return alb, nrm


def apply(objs, size, klass, name):
    wobble(objs, size)
    unwrap(objs)
    return bake(objs, size, TEX[klass], name)
