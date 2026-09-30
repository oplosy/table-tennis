"""Renders the hall as a 360-degree environment map for the game's reflections.

The camera stands where the table is (the table itself is hidden, or it would
reflect in its own top) and looks along the game's +X axis, which is where
three.js puts the centre of an equirectangular map.

    blender tools/blender/rally_assets.blend --background --python tools/blender/render_env.py
"""
import os
from math import radians

import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(bpy.data.filepath), "..", ".."))
OUT = os.path.join(ROOT, "web", "src", "assets", "env", "arena_1k.hdr")
WIDTH, HEIGHT = 1024, 512
SAMPLES = int(os.environ.get("RALLY_ENV_SAMPLES", 128))

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True

for name in ("Table", "Paddle"):
    for obj in bpy.data.collections[name].objects:
        obj.hide_render = True
for obj in bpy.data.collections["Lights"].objects:
    if obj.name.startswith("preview_"):
        obj.hide_render = True

data = bpy.data.cameras.new("env_camera")
data.type = "PANO"
data.panorama_type = "EQUIRECTANGULAR"
camera = bpy.data.objects.new("env_camera", data)
camera.location = (0.0, 0.0, 1.0)
camera.rotation_euler = (radians(90), 0.0, radians(-90))  # forward = Blender +X = game +X, up = Z
scene.collection.objects.link(camera)
scene.camera = camera

scene.render.resolution_x = WIDTH
scene.render.resolution_y = HEIGHT
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "HDR"
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print(f"[env] wrote {OUT}: {os.path.getsize(OUT)} bytes")
