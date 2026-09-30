"""Exports each asset collection of rally_assets.blend to web/src/assets/models.

Modelling happens by hand in Blender; exporting goes through this script so
every model leaves with the same settings.

    blender tools/blender/rally_assets.blend --background --python tools/blender/export.py
"""
import os

import bpy

COLLECTIONS = {"Table": "table.glb", "Paddle": "paddle.glb", "Arena": "arena.glb"}
ROOT = os.path.abspath(os.path.join(os.path.dirname(bpy.data.filepath), "..", ".."))
OUT = os.path.join(ROOT, "web", "src", "assets", "models")


def export(collection_name, filename):
    collection = bpy.data.collections.get(collection_name)
    meshes = [o for o in collection.all_objects if o.type == "MESH"] if collection else []
    if not meshes:
        print(f"skip {filename}: collection {collection_name} is empty")
        return None
    for obj in bpy.context.view_layer.objects:
        obj.select_set(obj in meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    path = os.path.join(OUT, filename)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,  # bevels and weighted normals are modifiers
        export_yup=True,  # Blender is Z-up, the game is Y-up
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
    print(f"wrote {filename}: {os.path.getsize(path)} bytes, {len(meshes)} meshes")
    return path


def main():
    os.makedirs(OUT, exist_ok=True)
    for collection_name, filename in COLLECTIONS.items():
        export(collection_name, filename)


main()
