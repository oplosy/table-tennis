# Environment maps

| File | Source | Author | License |
|---|---|---|---|
| `arena_1k.hdr` | [Poly Haven — Dancing Hall](https://polyhaven.com/a/dancing_hall), 1k HDR | Sergej Majboroda | CC0 |

Used only for image-based lighting (`scene.environment`); the visible hall is
modelled geometry. Imported with `?url` so Vite emits it under `assets/` with a
hashed name. Phase 2 replaces it with an env map rendered from the
Blender hall.
