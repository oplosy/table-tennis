# Environment maps

| File | Source | License |
|---|---|---|
| `arena_1k.hdr` | A 360° Cycles render of our own hall, made by `tools/blender/render_env.py` from `tools/blender/rally_assets.blend` | Ours |

Used only for image-based lighting and reflections (`scene.environment`); the
visible hall is the `arena.glb` model. Imported with `?url` so Vite emits it
under `assets/` with a hashed name.

It replaced Poly Haven's "Dancing Hall" HDRI, which stood in until the hall
was modelled.
