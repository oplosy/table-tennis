# Phase 2 — Blender models and light baking

- **Date:** 2026-09-30
- **Status:** Implemented (see "Outcome"). The project is complete; phase 3 was never started. Implemented at the user's request without writing a plan document.
- **Branch:** `feat/blender-models` (merged into `feat/real-3d-table-tennis`)
- **Previous phase:** `2026-09-29-lighting-postfx-hdri-design.md` (implemented)

## Context

Phase 1 brought the light rig, the post chain and the HDRI. The table, net,
paddle and hall are still built from Three.js boxes and cylinders under
`web/src/game/world/`. This phase replaces them with GLBs modelled in Blender
and bakes the hall's lighting into a lightmap. Phase 3 (player characters with
IK) is a separate cycle.

The old GLB pipeline (`tools/create_blender_assets.py`, `AssetLoader.ts`) was
deleted in the rewrite; it is not coming back, and this design replaces it.

## Decisions

| Topic | Decision |
|---|---|
| Modelling | Live: step by step in a Blender session over MCP. The source `.blend` goes into the repo. |
| Bake scope | A lightmap for the hall; only an AO texture for the table and paddle. Ball and paddle shadows stay real-time. |
| Budget | Models + textures total ≤ 6 MB (excluding the environment map, which replaces today's 1.7 MB one). |
| Binding | One GLB per part + a separate lightmap texture. |

Rejected: a single `scene.glb` (everything is re-exported on every change, and
backing up part by part gets harder); script generation and ready-made models
(the user chose live modelling).

## Out of scope

Player characters and IK (phase 3), changes to `packages/core` and `server`,
WebGPU, separate low-resolution textures for the `low` tier, a KTX2 pipeline.
The net cloth, ball, ball trail and hit effects stay procedural.

## Asset pipeline

### Source

- `tools/blender/rally_assets.blend`. The `tools/*.blend*` line in `.gitignore`
  is narrowed to exclude only `.blend1` backups.
- Textures are not embedded in the file; they live under
  `tools/blender/textures/`.
- Collections: `Table`, `Paddle`, `Arena`. Each is one GLB.
- Axes: modelled Z-up in Blender; the glTF export converts to Y-up. The game's
  coordinates: the table's long axis is Z, its width is X, up is Y; the table
  centre is at the origin, the floor at y = 0.

### Naming contract

| Model | Nodes | Materials |
|---|---|---|
| `table.glb` | `table_top`, `table_frame`, `net_post_L`, `net_post_R` | `table_surface`, `table_lines`, `metal` |
| `paddle.glb` | `blade`, `handle` | `rubber_forehand`, `rubber_backhand`, `wood`, `handle`, `accent` |
| `arena.glb` | `floor`, `barriers`, `stands`, `lamps` | a second UV channel on every mesh (`TEXCOORD_1`, lightmap) |

The paddle is modelled at real size; the 1.35× on-screen enlargement stays in
code. Its root is at the centre of the blade and the handle points toward −Y
(the same as today's `PaddleView`).

### Export and compression

- `tools/blender/export.py`: writes each collection to a GLB with the same
  settings (applied transforms, second UV, WebP textures).
- Compression: planned as an `npm run assets:optimize` script with
  `@gltf-transform/cli`; not added, because Blender's exporter does meshopt
  itself (see "Outcome").
- Output: `web/src/assets/models/{table,paddle,arena}.glb` and
  `arena_lightmap.webp`. Imported with `?url` (hashed name, long-lived cache).

### Budget breakdown

| Part | Textures | Estimate |
|---|---|---|
| Table | 2k colour + roughness/AO + normal | ~1.5 MB |
| Paddle | 2k colour + roughness/AO + normal | ~1.2 MB |
| Hall | 1k colour atlas + 2k lightmap | ~1.5 MB |
| Geometry (meshopt) | ~50–80k triangles | ~1 MB |

## Binding into the game

### Loader — `web/src/game/world/assets.ts`

- The three GLBs and the lightmap are loaded in parallel with `GLTFLoader` +
  `MeshoptDecoder`.
- The game does not wait: until the models arrive, and on failure, the
  procedural table, paddle and hall are shown; each model replaces its own part
  as it arrives.
- If `dispose()` is called while loading (a quality change), the result is
  discarded and the resources are released. The loader must be testable with a
  fake reader (the seam layout of `render/environment.ts`).

### Hall: unlit material + lightmap + shadow catcher

In Three.js, lights cannot be turned off per object; if the hall stays lit, it
is lit by both the lightmap and the real-time lights. Therefore:

- The hall's materials are `MeshBasicMaterial`: colour texture × lightmap
  (`lightMap.channel = 1`). Real-time lights cost the hall nothing.
- A transparent `ShadowMaterial` plane just above the floor shows only the
  shadows of moving objects (the ball and paddles).
- The table's shadow on the floor is baked into the lightmap; the table casts no
  real-time shadow on the floor (to avoid a double shadow).
- The ceiling lamps stay at HDR brightness as in phase 1 (bloom).

### Table and paddle: lit PBR

- Phase 1's lights (key, court wash, rim) light them; the AO texture comes with
  the glTF `occlusionTexture`.
- The tabletop receives the ball and paddle shadows in real time.
- The paddle is a single model used twice; rubber, handle and accent colours
  are assigned in code by material name. Grip switching and the swing are kept
  with the same pivot structure. The "ball in reach" glow stays procedural.
- The net posts and clamps move to the table model; the net cloth and the white
  tape stay procedural.

### Environment map

A 360° render of the hall from above the table (1k, `.hdr`) is taken in Blender
and replaces `web/src/assets/env/arena_1k.hdr`. `ARENA_LOOK.intensity` is
retuned; `env/README.md` is updated.

### Quality tiers

Both tiers use the same models and textures.

## Bake

- The phase 1 rig is built in Blender: an overhead key, four court lights, two
  rims, the ceiling lamps.
- Hall: a 2k lightmap in the second UV channel with Cycles (direct + indirect
  light, including the table's floor shadow).
- Table and paddle: AO, packed into a channel of the roughness texture.
- **Known risk:** the light units of Blender and Three.js differ; the bake
  brightness does not match the game's numerically. It is matched visually; the
  final adjustment is a single lightmap intensity value in code.

## Error handling

- If a GLB fails to load, that part stays procedural, with a single
  `console.warn`; other parts are unaffected.
- If the lightmap fails to load, the hall falls back to its procedural form (an
  unlit material without a lightmap would be black).
- If an expected node or material is missing, the model is rejected and the
  fallback stays.

## Order of work

| # | Step | Output |
|---|---|---|
| 1 | Pipeline skeleton | `.blend`, collections, `export.py`, dimension test (red first) |
| 2 | Table | `table.glb` |
| 3 | Paddle | `paddle.glb` |
| 4 | Hall | `arena.glb` |
| 5 | Bake | Hall lightmap, table and paddle AO |
| 6 | Environment map | 360° render of the hall |
| 7 | Binding into the game | Loader, fallback, shadow catcher, light tuning |
| 8 | Verification and docs | Measurements, images, `architecture.md` |

Because live modelling cannot be reproduced and the `.blend` cannot be reviewed
in git, a Blender image is sent to the user for approval at the end of steps 2,
3, 4 and 5.

## Tests and verification

Unit tests (vitest, `web/`):

- **Dimension contract:** the GLBs are read with `@gltf-transform/core` and
  compared with the `packages/core` constants (±1 mm): tabletop
  1.525 × 0.025 × 2.74 m, top surface at y = 0.76; net posts at x = ±0.915.
- **Naming contract:** the expected nodes and materials, and `TEXCOORD_1` on the
  hall meshes.
- **Loader:** the fallback stays on failure; a result arriving after dispose is
  discarded; resources are released.
- **Budget:** the test fails if `web/src/assets/models/` exceeds 6 MB in total.

Browser:

- Before/after images: the trajectory, the player camera, portrait; High and
  Fast.
- Frame time: measured at the commit before this phase, at the end of phase 1
  and at the end of this phase.
- The ball leaves a shadow on the table and the floor; the table's floor shadow
  is not doubled.
- Quality switching and an interrupted load: no errors and no leaks.

Gates: `npm test`, `npm run typecheck`, `npm run build`.

## Success criteria

1. The table, paddle and hall look like real objects in close-up (with the
   user's approval).
2. The dimension test is green.
3. Models + textures total ≤ 6 MB.
4. Frame time is no worse than the end of phase 1.
5. When assets fail to load, the game stays playable with the procedural models.

## Outcome (2026-09-30)

Deviations from the design:

- **No colour atlas for the hall.** Surfaces use plain material colours; the
  court floor, barrier lettering, logo panels and screens are painted with the
  game's canvas textures. The richness comes from the lightmap.
- **Two kinds of bake.** Large surfaces (floor, barriers, walls, the stage wall,
  the umpire's desk) are in the 2k lightmap; multi-part objects such as seats,
  truss beams and spots are in vertex colours. Thousands of small parts would
  have wasted most of the lightmap.
- **The table's AO is vertex colour, not a texture.** AO was not baked for the
  paddle (a convex object, no gain). The table and paddle have no textures;
  they use plain-coloured materials.
- **Compression in Blender.** Meshopt is built into 5.2's exporter; the
  `gltf-transform` command-line tool was not added.
- **Extra nodes:** `net_clamp_L/R`, `hall`, `rig`, `umpire_desk`,
  `towel_box_home/away`, `backstage_home/away`, `backwall_home/away`,
  `screen_home/away`.
- **The barriers** were remodelled after user feedback: a padded body, a rounded
  top edge, an inset advertising face, a rubber base, corner pieces.
- **The end areas** were added after user feedback: a sponsor wall, an LED
  screen, spot towers, a broadcast camera.
- **The environment map** is our own render of the hall (`render_env.py`); the
  Poly Haven stand-in from phase 1 is gone.

Measurements (Intel UHD integrated GPU, 1280x720, 300 frames):

| | End of phase 1 | End of phase 2 |
|---|---|---|
| Chain off | 6.6 ms | 4.4 ms |
| High, no AO | 15.5 ms | 10.2 ms |
| High, with AO | 18.7 ms | 15.0 ms |

Size: `arena.glb` 1.03 MB, `arena_lightmap.webp` 0.48 MB, `table.glb` 0.18 MB,
`paddle.glb` 0.04 MB; total 1.73 MB (budget 6 MB). The environment map is 1.0 MB
(replacing the previous one, down from 1.7 MB).

Added afterwards: the live score on the screens and the umpire's board
(`world/scoreboard.ts`); a rubber roughness and wood grain drawn on canvas on
the paddle. Not done: texture work for the floor and the table.
