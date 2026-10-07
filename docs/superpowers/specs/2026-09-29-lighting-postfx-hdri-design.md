# Phase 1 — Lighting, post-processing and HDRI

- **Date:** 2026-09-29
- **Status:** Implemented (see "Outcome"). The stand-in HDRI described here was later replaced by our own hall render (phase 2).
- **Branch:** `feat/visual-lighting-postfx` (from `feat/real-3d-table-tennis`)

## Context

The visual overhaul of the frontend was split into three sub-projects, each
going through its own spec → plan → implementation cycle:

1. **Phase 1 (this document):** light rig, post-processing, HDRI.
2. Phase 2: table, paddle and hall models in Blender + light baking.
3. Phase 3: player characters with IK. (Never started; the project was completed without it.)

Current state: the scene is entirely procedural Three.js (r179). The ambient
light is `RoomEnvironment` (0.3), the lights are a hemisphere + key + fill + two
spots, tone mapping is ACES, and textures are drawn on canvases. There is no
post-processing and no binary assets. A `low`/`high` quality setting and
touch/portrait support exist.

## Goal

- **Look:** a WTT broadcast feel — dark stands, a court lit like a stage by cold
  white overhead light, strong contrast, light bloom and a vignette.
- **Performance:** the full chain on desktop (`high`); a cheap chain on mobile
  (`low` / "Fast").
- **Out of scope:** models, baking, characters, a WebGPU migration, and changes
  to the simulation (`packages/core`). Only the presentation layer changes;
  local and online modes work as before.

## Chosen approach

`postprocessing` (pmndrs, `^6.39`, compatible with three `>=0.168 <0.187`) +
`n8ao` (`^2`). Effects are merged into a single full-screen pass; N8AO gives
fast, low-noise AO at half resolution.

Rejected: three `examples/jsm` passes (every effect is a separate pass,
`UnrealBloomPass` is expensive and selective bloom is hard); `WebGPURenderer` +
TSL (needs a migration of the material layer, a separate project).

## Architecture

New folder `web/src/game/render/`:

| Unit | Job | Interface |
|---|---|---|
| `render/profile.ts` | Quality → settings table (pixel ratio, shadow map size, enabled effects, grading values). Pure data. | `renderProfile(quality: Quality): RenderProfile` |
| `render/environment.ts` | Loads the HDRI (`RGBELoader` → `PMREMGenerator`; r179 has no `HDRLoader` yet) and puts it in `scene.environment`. Until it loads, and on failure, `RoomEnvironment` stays. | `loadEnvironment(scene, url, baker, look?, load?): { ready: Promise<void>; dispose(): void }` — the PMREM work is behind `pmremBaker(renderer)` so it can be tested without WebGL |
| `render/postfx.ts` | Builds and owns the `EffectComposer`. | `createPostFx(renderer, scene, camera, profile): PostFx` — `render(dt)`, `setSize(w, h)`, `enabled`, `dispose()` |
| `world/arena.ts` → `createLights` | Rebuilt to the WTT layout. | `createLights(profile: RenderProfile)` (shadow map size comes from the profile) |

Changes to `GameRenderer`:

- `renderer.render(scene, camera)` → `postfx.render(dt)`.
- `resize()` sizes the composer too; `dispose()` also releases the composer and
  the environment loader.
- Renderer: `toneMapping = NoToneMapping` (tone mapping moves into the chain),
  `antialias: false` (AA is in the composer).
- Renderer settings (pixel ratio, shadow type) are read from `renderProfile`.

Asset location: `web/src/assets/env/arena_1k.hdr` (imported with `?url`, so it
is served under `/assets/` with a hashed name and a long-lived cache header)
— (Poly Haven `dancing_hall`, 1k, 1.7 MB) with a `README.md` in the same folder
stating the source and the CC0 licence. In phase 2, our own hall environment
map rendered in Blender comes to the same folder and the `loadEnvironment` URL
changes. (Done: see the phase 2 spec.)

## Light rig

| Light | Setting |
|---|---|
| `scene.environment` | Poly Haven `dancing_hall` (dark ceiling, neutral LED grids; `circus_arena` was rejected because of its red floor reflection), `environmentIntensity` ≈ 0.5, rotated so the bright area is overhead. |
| Hemisphere | 0.55 → ≈ 0.12. |
| Key (the only shadow caster) | A directional light almost directly above the table, slightly offset. Cold white `#f3f6ff`. Shadow map 2048 (`high`) / 1024 (`low`). A short, sharp ball/paddle shadow is kept for depth perception. |
| Court wash | 4 shadowless spots; a pool of light on the court that falls off toward the barriers. |
| Rim | A weak cold light from behind at both ends; separates the paddle and ball from the dark background. |
| Ceiling light bars | Emissive, intensity > 1. Only these and the hit flash pass the bloom threshold. |

All values are starting points; they are tuned during visual verification.

## Post chain

| | `high` | `low` |
|---|---|---|
| AA | Composer MSAA ×4 | FXAA (a separate, last `EffectPass`) |
| AO | N8AO, half resolution | none |
| Bloom | Mipmap bloom, threshold ≈ 0.9, intensity ≈ 0.7 | Same, fewer mip levels |
| Tone mapping | AgX | AgX |
| Grading | Contrast +, saturation + (compensating for AgX's flatness), vignette ≈ 0.35 | Same |
| Pixel ratio | ≤ 2 | ≤ 1.25 |

Bloom, tone mapping and grading are merged into one `EffectPass`. FXAA samples
neighbouring pixels, so it runs in a separate pass on the finished image.
Grading is parameters, not a LUT file.

**Known risk:** if N8AO and composer MSAA cause problems together, `high` falls
back to SMAA + N8AO. This is verified in the first step of the implementation.

## Error handling

- If the HDRI fails to load: `console.warn`, `RoomEnvironment` stays, the game
  does not wait.
- If `dispose()` is called while loading (a quality change rebuilds the
  canvas), the incoming result is discarded and the texture is released.
- No WebGL2 branch: since three r163, `WebGLRenderer` works only with WebGL2, so
  in a browser without WebGL2 the renderer cannot be created anyway (existing
  behaviour).
- Development aid: `rally.renderer.postfx.enabled = false` draws directly with
  the renderer (for before/after and performance comparisons).

## Tests and verification

Unit tests (vitest, `web/`):

- `profile.test.ts`: `high` has AO + MSAA and `low` does not; pixel ratio caps;
  shadow map sizes; both tiers share the same grading.
- `environment.test.ts`: with a fake loader, the fallback stays on failure; a
  result arriving after dispose is discarded.
- `postfx` cannot draw in jsdom; a smoke check is done in the browser preview.

Browser preview:

- Before/after screenshots from the same `simulate()` frame: the demo trajectory
  and the player camera, landscape and portrait.
- `renderer.info` + a 300-frame timing measurement: `high` and `low`, compared
  with the value measured with postfx off.
- There must be no shader/WebGL warnings in the console.

Gates: `npm test`, `npm run typecheck`, `npm run build` green.

## Success criteria

1. `high`: contact shadows under the table/net, bloom on the lamps, and a clear
   dark-stands / bright-court separation in the screenshots.
2. `low`: the chain's added cost is ≲ 1 ms/frame compared with postfx off.
3. Ball readability is no worse than today, preferably better.
4. All gates green.

## Documentation

In `architecture.md` → Client, the sentence "there are no binary assets" and the
description of the visual world are updated; the `render/` folder is added. An
entry is made in `CHANGELOG.md`.

## Outcome (2026-09-30)

- Grading is done with a single `GradingEffect` that clamps the result at zero,
  instead of the library's contrast/saturation effects (negative values
  produced NaN in the colour-space conversion).
- Tuned values: key 1.7, court wash 9, rim 0.35, hemisphere 0.12, environment
  0.15 (the initial ≈ 0.5 lit the stands too much).
- N8AO + composer MSAA ×4 work together; the SMAA fallback was not needed.
- On first launch, touch devices start on `low` and the rest on `high`.
- Measurement (Intel UHD integrated GPU, 1280×720): `high` +12 ms/frame (N8AO ≈
  8.5 ms), `low` +2.1 ms/frame. Success criterion 2 (`low` ≲ 1 ms) was **not
  met**; `high` stays below 60 fps on this GPU. Not measured on a discrete GPU.
- For this reason, `high` turns AO off for the rest of the session if the
  average frame time exceeds 18 ms (on the same GPU 23.1 → 15.5 ms/frame, after
  ~3.5 s).
