"""Renders the hall as a 360-degree environment map for the game's reflections.

The camera stands where the table is (the table itself is hidden, or it would
reflect in its own top) and looks along the game's +X axis, which is where
three.js puts the centre of an equirectangular map.

    blender tools/blender/rally_assets.blend --background --python tools/blender/render_env.py

RALLY_ENV_SAMPLES overrides the sample count for quick trials. A trial never
replaces what the game ships: it renders to the temp directory (or RALLY_ENV_OUT).
The scene is left as it was found, so the script is safe in an open Blender too.
"""
import os
import tempfile
from math import radians

import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(bpy.data.filepath), "..", ".."))
TRIAL = "RALLY_ENV_SAMPLES" in os.environ
SHIPPED = os.path.join(ROOT, "web", "src", "assets", "env", "arena_1k.hdr")
OUT = os.environ.get("RALLY_ENV_OUT") or (os.path.join(tempfile.gettempdir(), "rally_env_trial.hdr") if TRIAL else SHIPPED)
WIDTH, HEIGHT = 1024, 512
SAMPLES = int(os.environ.get("RALLY_ENV_SAMPLES", 128))

scene = bpy.context.scene


def main():
    render = scene.render
    hidden = [(obj, obj.hide_render) for obj in bpy.data.objects]
    previous = (render.engine, scene.cycles.device, scene.cycles.samples, scene.cycles.use_denoising, scene.camera,
                render.resolution_x, render.resolution_y, render.resolution_percentage, render.image_settings.file_format, render.filepath)
    data = bpy.data.cameras.new("env_camera")
    camera = bpy.data.objects.new("env_camera", data)
    try:
        render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = SAMPLES
        scene.cycles.use_denoising = True

        # Lists, not the collections themselves: changing visibility while walking one breaks the walk.
        for name in ("Table", "Paddle"):
            for obj in list(bpy.data.collections[name].all_objects):
                obj.hide_render = True
        for obj in list(bpy.data.collections["Arena"].all_objects):  # another script may have hidden the hall
            obj.hide_render = False
        for obj in list(bpy.data.collections["Lights"].all_objects):
            if obj.name.startswith("preview_"):
                obj.hide_render = True

        data.type = "PANO"
        data.panorama_type = "EQUIRECTANGULAR"
        camera.location = (0.0, 0.0, 1.0)
        camera.rotation_euler = (radians(90), 0.0, radians(-90))  # forward = Blender +X = game +X, up = Z
        scene.collection.objects.link(camera)
        scene.camera = camera

        render.resolution_x = WIDTH
        render.resolution_y = HEIGHT
        render.resolution_percentage = 100
        render.image_settings.file_format = "HDR"
        render.filepath = OUT
        bpy.ops.render.render(write_still=True)
    finally:
        (render.engine, scene.cycles.device, scene.cycles.samples, scene.cycles.use_denoising, scene.camera,
         render.resolution_x, render.resolution_y, render.resolution_percentage, render.image_settings.file_format, render.filepath) = previous
        for obj, was_hidden in hidden:
            obj.hide_render = was_hidden
        bpy.data.objects.remove(camera)
        bpy.data.cameras.remove(data)
    print(f"[env] wrote {OUT}{' (trial)' if TRIAL else ''}: {os.path.getsize(OUT)} bytes")


main()
