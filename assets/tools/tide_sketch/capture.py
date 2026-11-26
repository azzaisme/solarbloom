"""Run inside Blender to capture a beauty render and screen-space data for the sketch."""
import argparse
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector


def matte(name, color):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1)
    return material


def lily_pad():
    # Leave a wedge open at the front so the lily pad reads clearly under the frog.
    angles = [0.17 + i * (math.tau - 0.34) / 79 for i in range(80)]
    points = [(-0.26, -0.12, -0.018)]
    for angle in angles:
        scallop = 1 + 0.017 * math.sin(11 * angle) + 0.018 * math.sin(5 * angle)
        points.append((-0.26 + 1.74 * scallop * math.sin(angle),
                       -0.12 - 1.39 * scallop * math.cos(angle),
                       -0.018 + 0.047 * math.cos(angle) ** 2))
    mesh = bpy.data.meshes.new("Lily pad")
    mesh.from_pydata(points, [], [(0, i + 1, i) for i in range(1, len(points) - 1)])
    mesh.update()
    obj = bpy.data.objects.new("Lily pad", mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(matte("Lily leaf", (0.19, 0.32, 0.082)))
    for face in mesh.polygons:
        face.use_smooth = True
    return obj


def field_material(name, object_id=None):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    link = material.node_tree.links.new
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    link(emission.outputs[0], output.inputs["Surface"])
    if object_id is None:
        geometry = nodes.new("ShaderNodeNewGeometry")
        camera_normal = nodes.new("ShaderNodeVectorTransform")
        camera_normal.vector_type = "NORMAL"
        camera_normal.convert_from = "WORLD"
        camera_normal.convert_to = "CAMERA"
        link(geometry.outputs["Normal"], camera_normal.inputs[0])
        encode = nodes.new("ShaderNodeVectorMath")
        encode.operation = "MULTIPLY_ADD"
        encode.inputs[1].default_value = (0.5, 0.5, 0.5)
        encode.inputs[2].default_value = (0.5, 0.5, 0.5)
        link(camera_normal.outputs[0], encode.inputs[0])
        link(encode.outputs[0], emission.inputs["Color"])
    else:
        depth = nodes.new("ShaderNodeCameraData")
        remap = nodes.new("ShaderNodeMapRange")
        remap.inputs["From Min"].default_value = 3
        remap.inputs["From Max"].default_value = 11
        link(depth.outputs["View Z Depth"], remap.inputs["Value"])
        channels = nodes.new("ShaderNodeCombineColor")
        link(remap.outputs[0], channels.inputs[0])
        channels.inputs[1].default_value = object_id
        link(channels.outputs[0], emission.inputs["Color"])
    return material


def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def area(name, position, energy, size):
    bpy.ops.object.light_add(type="AREA", location=position)
    lamp = bpy.context.object
    lamp.name = name
    lamp.data.energy = energy
    lamp.data.shape = "DISK"
    lamp.data.size = size
    point_at(lamp, (0, 0, 0.55))


def render(scene, directory, name):
    scene.render.filepath = str(directory / (name + ".png"))
    bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--angle", type=float, default=32, help="Camera angle from the front, in degrees.")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    args.output.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=str(args.model.resolve()))
    frog = next(obj for obj in bpy.context.selected_objects if obj.type == "MESH")
    rig = frog.parent
    if rig and rig.animation_data:
        rig.animation_data_clear()
    bpy.context.view_layer.update()
    points = [frog.matrix_world @ Vector(point) for point in frog.bound_box]
    span = max(point.x for point in points) - min(point.x for point in points)
    scale = 2.05 / span
    root = rig or frog
    root.scale *= scale
    root.location.z -= min(point.z for point in points) * scale
    pad = lily_pad()

    a = math.radians(args.angle)
    bpy.ops.object.camera_add(location=(6 * math.sin(a), -6 * math.cos(a), 3.75))
    scene.camera = bpy.context.object
    scene.camera.data.type = "ORTHO"
    scene.camera.data.ortho_scale = 4.6
    point_at(scene.camera, (0, 0, 0.61))

    area("Window", (-3.2, -4, 6), 520, 4)
    area("Bounce", (3, -1, 3), 105, 3)
    scene.world = bpy.data.worlds.new("Ambient")
    scene.world.color = (0.22, 0.22, 0.22)
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 760
    scene.render.resolution_y = 660
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "AgX"
    render(scene, args.output, "scene")

    # Render the data passes in linear space. Emission preserves the encoded data.
    scene.view_settings.view_transform = "Raw"
    scene.cycles.samples = 8
    bpy.context.view_layer.material_override = field_material("View-space normals")
    render(scene, args.output, "normals")

    bpy.context.view_layer.material_override = None
    for obj, object_id in [(frog, 0.25), (pad, 0.75)]:
        obj.data.materials.clear()
        obj.data.materials.append(field_material(obj.name + " depth and ID", object_id))
    scene.render.image_settings.color_depth = "16"
    render(scene, args.output, "geometry")


if __name__ == "__main__":
    main()
