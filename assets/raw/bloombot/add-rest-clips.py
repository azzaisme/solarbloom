"""E23.2.3: two new bloombot clips from the idle clip: 'sit' (on a bench: thighs forward, shins down) and
'meditate' (cross-legged on the ground, hands on knees, hips lowered). Upper body keeps idle's breathing.
    blender -b bloombot.blend -P add-rest-clips.py -- out.glb sheet.png
Light ops only (posing and keying). Run with a time limit."""
import bpy, sys, os, math, mathutils
from mathutils import Vector, Matrix
def P(*a): print(*a, flush=True)
out, sheet = (os.path.abspath(a) for a in sys.argv[sys.argv.index('--') + 1:][:2])
scene = bpy.context.scene
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
ad = arm.animation_data
acts = {a.name: a for a in bpy.data.actions}
for n in ('sit', 'meditate'):
    if n in acts: bpy.data.actions.remove(acts.pop(n))
idle = acts['idle']
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')

def bag(a): return a.layers[0].strips[0].channelbags[0]

# directions in armature space, from the rest pose
arm.data.pose_position = 'REST'; bpy.context.view_layer.update()
pb = arm.pose.bones
MW = arm.matrix_world.copy()
W = lambda v: MW @ v  # armature point -> world
TOARM = MW.inverted().to_3x3()  # world direction -> armature direction (normalised where used)
UP = Vector((0, 0, 1))
F = W(pb['headfront'].head) - W(pb['Head'].head); F.z = 0; F.normalize()
L = W(pb['LeftUpLeg'].head) - W(pb['RightUpLeg'].head); L.z = 0; L.normalize()
P('MW', [tuple(round(c, 3) for c in r) for r in MW], 'FRONT', tuple(round(c, 3) for c in F), 'LEFT', tuple(round(c, 3) for c in L))
foot0 = min(W(pb['LeftFoot'].head).z, W(pb['RightFoot'].head).z)
arm.data.pose_position = 'POSE'

POSES = {
    'sit': {
        'LeftUpLeg': F * 1.0 + L * 0.12 - UP * 0.05, 'LeftLeg': -UP * 1.0 + F * 0.15, 'LeftFoot': F * 1.0 - UP * 0.3,
        'RightUpLeg': F * 1.0 - L * 0.12 - UP * 0.05, 'RightLeg': -UP * 1.0 + F * 0.15, 'RightFoot': F * 1.0 - UP * 0.3,
        'LeftArm': -UP * 0.8 + L * 0.35 + F * 0.25, 'LeftForeArm': F * 0.8 - UP * 0.45 + L * 0.1,
        'RightArm': -UP * 0.8 - L * 0.35 + F * 0.25, 'RightForeArm': F * 0.8 - UP * 0.45 - L * 0.1,
    },
    'meditate': {
        'LeftUpLeg': F * 0.7 + L * 0.7 - UP * 0.1, 'LeftLeg': -L * 0.9 + F * 0.25 - UP * 0.05, 'LeftFoot': -L * 0.6 - F * 0.2,
        'RightUpLeg': F * 0.7 - L * 0.7 - UP * 0.1, 'RightLeg': L * 0.9 + F * 0.35 - UP * 0.05, 'RightFoot': L * 0.6 - F * 0.2,
        'LeftArm': -UP * 0.75 + L * 0.45 + F * 0.3, 'LeftForeArm': F * 0.75 - UP * 0.5 + L * 0.25,
        'RightArm': -UP * 0.75 - L * 0.45 + F * 0.3, 'RightForeArm': F * 0.75 - UP * 0.5 - L * 0.25,
    },
}
ORDER = ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot', 'LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm']

def aim(b, d):
    p = pb[b]
    m = p.matrix.copy()
    cur = Vector(m.col[1][:3]).normalized()
    r = cur.rotation_difference((TOARM @ d).normalized()).to_matrix().to_4x4()
    t = m.translation.copy()
    nm = r @ m; nm.translation = t
    p.matrix = nm
    bpy.context.view_layer.update()

for name, dirs in POSES.items():
    a = idle.copy(); a.name = name
    ad.action = a; ad.action_slot = a.slots[0]
    bg = bag(a)
    f0, f1 = (int(v) for v in a.frame_range)
    for b in ORDER + (['Hips'] if name == 'meditate' else []):
        for path in ('rotation_quaternion',) + (('location',) if b == 'Hips' else ()):
            for i in range(4 if path == 'rotation_quaternion' else 3):
                fc = bg.fcurves.find(f'pose.bones["{b}"].{path}', index=i)
                if fc: bg.fcurves.remove(fc)
    for b in ORDER:
        pb[b].rotation_quaternion = (1, 0, 0, 0)
    if name == 'meditate': pb['Hips'].location = (0, 0, 0)
    scene.frame_set(f0); bpy.context.view_layer.update()
    for b in ORDER: aim(b, dirs[b])
    if name == 'meditate':
        # lower the hips until the lowest knee or foot rests on the ground
        # heads only: the rig's tails are not where the joints are (centimetre bones)
        low = min(W(pb[b].head).z for b in ('LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'))
        drop = low - foot0  # metres (world): ankles end where they rest when standing
        m = pb['Hips'].matrix.copy(); m.translation = m.translation - TOARM @ Vector((0, 0, drop)); pb['Hips'].matrix = m
        bpy.context.view_layer.update()
        pb['Hips'].keyframe_insert('location', frame=f0); pb['Hips'].keyframe_insert('location', frame=f1)
        P('MEDITATE hips drop', round(drop, 3))
    for b in ORDER:
        pb[b].keyframe_insert('rotation_quaternion', frame=f0); pb[b].keyframe_insert('rotation_quaternion', frame=f1)
    acts[name] = a
    P('CLIP', name, f0, f1)

ad.action = None
for t in list(ad.nla_tracks): ad.nla_tracks.remove(t)
for n, a in acts.items():
    tr = ad.nla_tracks.new(); tr.name = n
    st = tr.strips.new(n, int(a.frame_range[0]), a); st.action_slot = a.slots[0]
bpy.ops.object.mode_set(mode='OBJECT')
P('SAVING')
bpy.ops.wm.save_as_mainfile(filepath=os.path.splitext(out)[0] + '.blend', compress=True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animation_mode='NLA_TRACKS', export_skins=True)
P('EXPORTED', os.path.getsize(out))

# check sheet: workbench, the two new clips from the front and the side
for t in ad.nla_tracks: t.mute = True
scene.render.engine = 'BLENDER_WORKBENCH'
scene.render.resolution_x = scene.render.resolution_y = 360
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.4
k = 0
for n in ('sit', 'meditate'):
    ad.action = acts[n]; ad.action_slot = acts[n].slots[0]; scene.frame_set(10)
    for yaw in (0, 90):
        d = F * math.cos(math.radians(yaw)) + L * math.sin(math.radians(yaw))
        cam.location = Vector((0, 0, 0.45)) + d * 4 + UP * 0.3
        cam.rotation_euler = (Vector((0, 0, 0.4)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = sheet.replace('.png', f'_{n}_{yaw}.png')
        bpy.ops.render.render(write_still=True); k += 1
P('DONE', k)
