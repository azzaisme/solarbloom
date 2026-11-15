"""Shared load/save for the Blender asset scripts.

.fbx and .blend keep quads; .glb is always triangles (glTF can't store quads), so pass .blend between
steps and export .glb only at the end.
"""
import os

import bpy


def load(path):
    """Opens or imports a model into an empty scene and returns its mesh objects."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".blend":
        bpy.ops.wm.open_mainfile(filepath=path)
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        if ext in (".glb", ".gltf"):
            bpy.ops.import_scene.gltf(filepath=path)
        elif ext == ".fbx":
            bpy.ops.import_scene.fbx(filepath=path)
        elif ext == ".obj":
            bpy.ops.wm.obj_import(filepath=path)
        else:
            raise ValueError(f"unsupported model format: {path}")
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def save(path, objects):
    """Saves the given objects: .blend keeps the whole file (quads intact), .glb exports a triangulated copy."""
    if path.lower().endswith(".blend"):
        for o in list(bpy.context.scene.objects):
            if o not in objects:
                bpy.data.objects.remove(o)
        bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    else:
        bpy.ops.object.select_all(action="DESELECT")
        for o in objects:
            o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True)
    print("SAVED", path, os.path.getsize(path) // 1024, "KB")


def base_color_image(obj):
    """The image wired into the first material's Base Color (the albedo), or None."""
    for m in obj.data.materials:
        if not m or not m.use_nodes:
            continue
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                links = n.inputs["Base Color"].links
                node = links[0].from_node if links else None
                while node is not None and node.type != "TEX_IMAGE":  # walk through mix/gamma nodes
                    ins = [i for i in node.inputs if i.links]
                    node = ins[0].links[0].from_node if ins else None
                if node is not None:
                    return node.image
    return None
