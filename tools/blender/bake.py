"""Bakes the hall's lighting and the table's ambient occlusion, then saves the file.

Big flat surfaces get a lightmap texture (second UV set, "Lightmap"); cluttered
objects with thousands of small parts are lit per vertex instead. Both are
normalised by the same factor so the game can scale them with one number.

    blender tools/blender/rally_assets.blend --background --python tools/blender/bake.py

RALLY_BAKE_SIZE and RALLY_BAKE_SAMPLES override the defaults for quick trials.
"""
import os
import time

import bpy
import numpy as np

LIGHTMAPPED = ["floor", "barriers", "hall", "backwall_home", "backwall_away", "umpire_desk", "towel_box_home", "towel_box_away"]
VERTEX_LIT = ["stands", "rig", "lamps", "backstage_home", "backstage_away"]
SIZE = int(os.environ.get("RALLY_BAKE_SIZE", 2048))
SAMPLES = int(os.environ.get("RALLY_BAKE_SAMPLES", 128))
ROOT = os.path.abspath(os.path.join(os.path.dirname(bpy.data.filepath), "..", ".."))
OUT = os.path.join(ROOT, "web", "src", "assets", "models", "arena_lightmap.webp")
# Light balance: the fixtures over the court carry the scene, the stage spots add cross light.
ENERGY = {"lamp_": 320.0, "spot_": 500.0}

scene = bpy.context.scene


def select(objects):
    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def prepare():
    for layer in bpy.context.view_layer.layer_collection.children:
        layer.hide_viewport = False
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    for obj in bpy.data.collections["Paddle"].objects:  # held by a player, never part of the hall
        obj.hide_render = True
    for obj in bpy.data.collections["Lights"].objects:
        if obj.name.startswith("preview_"):  # viewport stand-ins for emissive meshes
            obj.hide_render = True
        for prefix, energy in ENERGY.items():
            if obj.name.startswith(prefix):
                obj.data.energy = energy
    settings = scene.render.bake
    settings.use_pass_direct = True
    settings.use_pass_indirect = True
    settings.use_pass_color = False  # light only; the game multiplies it with its own colours
    settings.margin = 8
    settings.use_clear = True


def bake_lightmap():
    objects = [bpy.data.objects[name] for name in LIGHTMAPPED]
    image = bpy.data.images.get("arena_lightmap")
    if image:
        bpy.data.images.remove(image)
    image = bpy.data.images.new("arena_lightmap", SIZE, SIZE, alpha=False, float_buffer=True)
    nodes = []
    for obj in objects:
        obj.data.uv_layers.active = obj.data.uv_layers["Lightmap"]
        for material in obj.data.materials:
            if any(node.name == "BakeTarget" for node in material.node_tree.nodes):
                continue
            node = material.node_tree.nodes.new("ShaderNodeTexImage")
            node.name = "BakeTarget"
            node.image = image
            material.node_tree.nodes.active = node
            nodes.append((material, node))
    select(objects)
    scene.render.bake.target = "IMAGE_TEXTURES"
    bpy.ops.object.bake(type="DIFFUSE")
    for material, node in nodes:
        material.node_tree.nodes.remove(node)
    for obj in objects:  # leave the first UV set active for modelling
        obj.data.uv_layers.active = obj.data.uv_layers[0]
    return image


def bake_vertices(objects, kind, attribute):
    for obj in objects:
        mesh = obj.data
        existing = mesh.color_attributes.get(attribute)
        if existing:
            mesh.color_attributes.remove(existing)
        layer = mesh.color_attributes.new(attribute, "FLOAT_COLOR", "CORNER")
        mesh.color_attributes.active_color = layer
        mesh.color_attributes.render_color_index = list(mesh.color_attributes).index(layer)
    select(objects)
    scene.render.bake.target = "VERTEX_COLORS"
    bpy.ops.object.bake(type=kind)


def corner_colors(mesh, attribute):
    layer = mesh.color_attributes[attribute]
    values = np.empty(len(layer.data) * 4, dtype=np.float32)
    layer.data.foreach_get("color", values)
    return layer, values.reshape(-1, 4)


def normalise(image):
    """Scales light so the brightest part of the court sits at 1.0 and everything fits 8 bits."""
    pixels = np.array(image.pixels[:], dtype=np.float32).reshape(-1, 4)
    luminance = pixels[:, :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    lit = luminance[luminance > 1e-5]
    peak = float(np.percentile(lit, 99.5))
    scale = 1.0 / peak
    pixels[:, :3] = np.clip(pixels[:, :3] * scale, 0.0, 1.0)
    image.pixels.foreach_set(pixels.ravel())
    for name in VERTEX_LIT:
        layer, colors = corner_colors(bpy.data.objects[name].data, "Light")
        colors[:, :3] = np.clip(colors[:, :3] * scale, 0.0, 1.0)
        layer.data.foreach_set("color", colors.ravel())
    return peak, float(np.median(lit) * scale)


def save(image):
    previous = (scene.view_settings.view_transform, scene.render.image_settings.file_format,
                scene.render.image_settings.color_mode, scene.render.image_settings.quality)
    try:
        scene.view_settings.view_transform = "Standard"  # plain sRGB encoding, no film look
        scene.render.image_settings.file_format = "WEBP"
        scene.render.image_settings.color_mode = "RGB"
        scene.render.image_settings.quality = 90
        image.save_render(OUT, scene=scene)
    finally:
        (scene.view_settings.view_transform, scene.render.image_settings.file_format,
         scene.render.image_settings.color_mode, scene.render.image_settings.quality) = previous


def main():
    started = time.time()
    prepare()
    print(f"[bake] lightmap {SIZE}px, {SAMPLES} samples")
    image = bake_lightmap()
    print(f"[bake] lightmap done after {time.time() - started:.0f}s")
    bake_vertices([bpy.data.objects[name] for name in VERTEX_LIT], "DIFFUSE", "Light")
    print(f"[bake] vertex light done after {time.time() - started:.0f}s")
    bake_vertices([obj for obj in bpy.data.collections["Table"].objects if obj.type == "MESH"], "AO", "AO")
    print(f"[bake] table AO done after {time.time() - started:.0f}s")
    peak, median = normalise(image)
    save(image)
    bpy.data.images.remove(image)
    bpy.ops.wm.save_mainfile()
    print(f"[bake] wrote {OUT}: {os.path.getsize(OUT)} bytes; peak {peak:.3f} -> 1.0, median {median:.3f}; total {time.time() - started:.0f}s")


main()
