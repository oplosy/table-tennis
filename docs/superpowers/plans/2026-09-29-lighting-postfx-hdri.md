# Lighting, Post-processing and HDRI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the table tennis client a WTT-broadcast look — HDRI image-based lighting, a rebuilt light rig and a pmndrs post-processing chain — with a full chain on `high` and a cheap one on `low`.

**Architecture:** A new `web/src/game/render/` folder holds three focused units: `profile.ts` (quality → render settings, pure data), `environment.ts` (HDRI → PMREM with a `RoomEnvironment` fallback and a dispose-safe async load) and `postfx.ts` (owns the `EffectComposer`). `GameRenderer` consumes them; `world/arena.ts` gets the new light rig. Nothing in `packages/core` or `server/` changes.

**Tech Stack:** three 0.179.1, postprocessing ^6.39.5, n8ao ^2.0.1, TypeScript 5.9, Vite 7, Vitest 3 (jsdom).

**Spec:** `docs/superpowers/specs/2026-09-29-lighting-postfx-hdri-design.md`

## Global Constraints

- three stays at `^0.179.0`; `postprocessing` `^6.39.5` (peer three `>=0.168 <0.187`); `n8ao` `^2.0.1`.
- No changes under `packages/core/` or `server/`. Presentation only; local and online modes keep working.
- Quality tiers are exactly `'high'` and `'low'` (`web/src/state/settings.ts`).
- Pixel ratio cap: `high` ≤ 2, `low` ≤ 1.25.
- HDRI: Poly Haven `dancing_hall`, 1k `.hdr` (1 725 266 bytes, md5 `2d8c98f2e75647367251284d9692a91a`), CC0, stored at `web/public/env/arena_1k.hdr` with its source in `web/public/env/README.md`.
- Downloading the HDRI requires the user's explicit yes in chat (file name, source, size) before running the download command.
- Branch: `feat/visual-lighting-postfx`. Conventional-commit subjects ≤ 72 chars, one concern per commit, every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Code and code comments in English; repo docs (`architecture.md`, specs) in Turkish; `CHANGELOG.md` in English (matches existing file).
- Gates before every commit that touches code: `npm test`, `npm run typecheck` (both from repo root). Before the final commit also `npm run build`.

## Review Focus

1. **Quality switch mid-session** (Graphics: High ↔ Fast remounts the canvas while the HDRI may still be loading) — expect no console errors, no write to a disposed scene, no growing WebGL context count. Pinned by the "drops an HDRI that arrives after dispose" test (Task 2) and the quality-toggle check (Task 5, Step 4).
2. **Portrait / resize** (phone rotation, window resize) — the composer must follow the canvas size; no stretched or blurry frame. Pinned by the mobile-viewport screenshot check (Task 3, Step 8 and Task 5, Step 3).
3. **Pointer mapping** after moving rendering into the composer — the paddle must still land under the cursor/finger; `composer.setSize(..., false)` must not change the canvas CSS size. Pinned by the pointer check in Task 3, Step 8.
4. **Additive/transparent objects under N8AO** (ball trail, hit flash, reach glow, landing marker, net with `alphaTest`) — expect no dark halos or AO smudges on them. Pinned by the rally screenshot inspection in Task 3, Step 8 (fallback: `transparencyAware = true`).
5. **HDRI unavailable in a deployed build** (wrong base path, 404, blocked) — expect the game to keep running on the fallback with one `console.warn`. Pinned by the "keeps the fallback and warns" test (Task 2) and the build-output check (Task 5, Step 6).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `web/src/game/render/profile.ts` | Create | `RenderProfile` type and `renderProfile(quality)` table. |
| `web/src/game/render/profile.test.ts` | Create | Tier differences and shared look. |
| `web/src/game/render/environment.ts` | Create | `loadEnvironment`, `pmremBaker`, looks. |
| `web/src/game/render/environment.test.ts` | Create | Swap, fallback on error, dispose race. |
| `web/src/game/render/postfx.ts` | Create | `createPostFx` → `PostFx`. |
| `web/src/types/n8ao.d.ts` | Create | Ambient types for the untyped `n8ao` package. |
| `web/public/env/arena_1k.hdr` | Create | HDRI binary. |
| `web/public/env/README.md` | Create | Source, author, license of env assets. |
| `web/src/game/GameRenderer.ts` | Modify | Use profile, environment, postfx. |
| `web/src/game/world/arena.ts` | Modify | WTT light rig, HDR light bars. |
| `web/package.json`, `package-lock.json` | Modify | New deps. |
| `web/vite.config.ts` | Modify | `postfx` manual chunk. |
| `architecture.md`, `CHANGELOG.md` | Modify | Docs. |

---

### Task 1: Render profile

**Files:**
- Create: `web/src/game/render/profile.ts`
- Test: `web/src/game/render/profile.test.ts`

**Interfaces:**
- Consumes: `Quality` from `web/src/state/settings.ts` (`'low' | 'high'`).
- Produces:
  ```ts
  export interface RenderProfile {
    tier: Quality
    pixelRatioCap: number
    shadowMapSize: number
    softShadows: boolean
    msaaSamples: number // 0 = off
    ao: boolean
    fxaa: boolean
    bloom: { intensity: number; threshold: number; levels: number }
    grading: { contrast: number; saturation: number; vignette: number }
  }
  export function renderProfile(quality: Quality): RenderProfile
  ```

- [ ] **Step 1: Write the failing test**

`web/src/game/render/profile.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { renderProfile } from './profile'

describe('renderProfile', () => {
  it('gives desktop the full chain', () => {
    expect(renderProfile('high')).toMatchObject({
      tier: 'high', pixelRatioCap: 2, shadowMapSize: 2048, softShadows: true, msaaSamples: 4, ao: true, fxaa: false,
    })
  })

  it('keeps the fast tier cheap', () => {
    const low = renderProfile('low')
    expect(low).toMatchObject({
      tier: 'low', pixelRatioCap: 1.25, shadowMapSize: 1024, softShadows: false, msaaSamples: 0, ao: false, fxaa: true,
    })
    expect(low.bloom.levels).toBeLessThan(renderProfile('high').bloom.levels)
  })

  it('grades both tiers alike so switching quality keeps the look', () => {
    const low = renderProfile('low')
    const high = renderProfile('high')
    expect(low.grading).toEqual(high.grading)
    expect(low.bloom.threshold).toBe(high.bloom.threshold)
  })

  it('returns a fresh object each call', () => {
    const a = renderProfile('high')
    a.bloom.intensity = 99
    expect(renderProfile('high').bloom.intensity).not.toBe(99)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace web run test -- src/game/render/profile.test.ts`
Expected: FAIL — `Failed to resolve import "./profile"`.

- [ ] **Step 3: Write minimal implementation**

`web/src/game/render/profile.ts`:

```ts
import type { Quality } from '../../state/settings'

/** Everything the renderer and post chain need to know about a quality tier. */
export interface RenderProfile {
  tier: Quality
  pixelRatioCap: number
  shadowMapSize: number
  softShadows: boolean
  /** Composer MSAA samples; 0 turns it off. */
  msaaSamples: number
  ao: boolean
  fxaa: boolean
  bloom: { intensity: number; threshold: number; levels: number }
  grading: { contrast: number; saturation: number; vignette: number }
}

// Shared by both tiers so switching quality changes cost, not the look.
const GRADING = { contrast: 0.12, saturation: 0.12, vignette: 0.35 }
const BLOOM_THRESHOLD = 0.9

/** Desktop gets the full chain; "Fast" keeps phones at 60 fps. */
export function renderProfile(quality: Quality): RenderProfile {
  if (quality === 'high') {
    return {
      tier: 'high', pixelRatioCap: 2, shadowMapSize: 2048, softShadows: true, msaaSamples: 4, ao: true, fxaa: false,
      bloom: { intensity: 0.7, threshold: BLOOM_THRESHOLD, levels: 7 },
      grading: { ...GRADING },
    }
  }
  return {
    tier: 'low', pixelRatioCap: 1.25, shadowMapSize: 1024, softShadows: false, msaaSamples: 0, ao: false, fxaa: true,
    bloom: { intensity: 0.6, threshold: BLOOM_THRESHOLD, levels: 4 },
    grading: { ...GRADING },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace web run test -- src/game/render/profile.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Gates and commit**

Run: `npm run typecheck` → exit 0.

```bash
git add web/src/game/render/profile.ts web/src/game/render/profile.test.ts
git commit -m "feat(web): add render profiles for quality tiers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: HDRI environment loader

**Files:**
- Create: `web/src/game/render/environment.ts`
- Test: `web/src/game/render/environment.test.ts`
- Create: `web/public/env/arena_1k.hdr`, `web/public/env/README.md`
- Modify: `web/src/game/GameRenderer.ts` (imports; constructor lines 51-54 `pmrem` block; `dispose()`)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  ```ts
  export interface EnvironmentBaker { fallback(): THREE.Texture; fromEquirect(texture: THREE.Texture): THREE.Texture; dispose(): void }
  export interface EnvironmentLook { intensity: number; rotationY: number }
  export interface EnvironmentHandle { ready: Promise<void>; dispose(): void }
  export const FALLBACK_LOOK: EnvironmentLook
  export const ARENA_LOOK: EnvironmentLook
  export function pmremBaker(renderer: THREE.WebGLRenderer): EnvironmentBaker
  export function loadEnvironment(
    scene: THREE.Scene, url: string, baker: EnvironmentBaker,
    look?: EnvironmentLook, load?: (url: string) => Promise<THREE.Texture>,
  ): EnvironmentHandle
  ```
  `GameRenderer` gains `private readonly environment: EnvironmentHandle`.

- [ ] **Step 1: Write the failing test**

`web/src/game/render/environment.test.ts`:

```ts
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FALLBACK_LOOK, loadEnvironment, type EnvironmentBaker } from './environment'

const LOOK = { intensity: 0.5, rotationY: 1.2 }

function fakeBaker() {
  const fallback = new THREE.Texture()
  const baked = new THREE.Texture()
  const baker = { fallback: vi.fn(() => fallback), fromEquirect: vi.fn(() => baked), dispose: vi.fn() } satisfies EnvironmentBaker
  return { baker, fallback, baked }
}

function watchDispose(texture: THREE.Texture) {
  const spy = vi.fn()
  texture.addEventListener('dispose', spy)
  return spy
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}

afterEach(() => { vi.restoreAllMocks() })

describe('loadEnvironment', () => {
  it('shows the fallback until the HDRI arrives, then swaps it in', async () => {
    const scene = new THREE.Scene()
    const { baker, fallback, baked } = fakeBaker()
    const hdr = new THREE.DataTexture()
    const pending = deferred<THREE.Texture>()
    const fallbackDisposed = watchDispose(fallback)
    const hdrDisposed = watchDispose(hdr)

    const env = loadEnvironment(scene, '/env/arena.hdr', baker, LOOK, () => pending.promise)
    expect(scene.environment).toBe(fallback)
    expect(scene.environmentIntensity).toBe(FALLBACK_LOOK.intensity)

    pending.resolve(hdr)
    await env.ready
    expect(baker.fromEquirect).toHaveBeenCalledWith(hdr)
    expect(scene.environment).toBe(baked)
    expect(scene.environmentIntensity).toBe(LOOK.intensity)
    expect(scene.environmentRotation.y).toBe(LOOK.rotationY)
    expect(fallbackDisposed).toHaveBeenCalledOnce()
    expect(hdrDisposed).toHaveBeenCalledOnce()
  })

  it('keeps the fallback and warns when the HDRI cannot load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scene = new THREE.Scene()
    const { baker, fallback } = fakeBaker()

    const env = loadEnvironment(scene, '/env/missing.hdr', baker, LOOK, () => Promise.reject(new Error('404')))
    await env.ready
    expect(scene.environment).toBe(fallback)
    expect(scene.environmentIntensity).toBe(FALLBACK_LOOK.intensity)
    expect(baker.fromEquirect).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('drops an HDRI that arrives after dispose', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scene = new THREE.Scene()
    const { baker, fallback } = fakeBaker()
    const hdr = new THREE.DataTexture()
    const pending = deferred<THREE.Texture>()
    const fallbackDisposed = watchDispose(fallback)
    const hdrDisposed = watchDispose(hdr)

    const env = loadEnvironment(scene, '/env/arena.hdr', baker, LOOK, () => pending.promise)
    env.dispose()
    pending.resolve(hdr)
    await env.ready
    expect(baker.fromEquirect).not.toHaveBeenCalled()
    expect(hdrDisposed).toHaveBeenCalledOnce()
    expect(fallbackDisposed).toHaveBeenCalledOnce()
    expect(scene.environment).toBeNull()
    expect(baker.dispose).toHaveBeenCalledOnce()
    expect(warn).not.toHaveBeenCalled()
  })

  it('stays quiet when a load fails after dispose', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pending = deferred<THREE.Texture>()
    const env = loadEnvironment(new THREE.Scene(), '/env/arena.hdr', fakeBaker().baker, LOOK, () => pending.promise)
    env.dispose()
    pending.reject(new Error('aborted'))
    await env.ready
    expect(warn).not.toHaveBeenCalled()
  })

  it('releases the baked map on dispose', async () => {
    const scene = new THREE.Scene()
    const { baker, baked } = fakeBaker()
    const bakedDisposed = watchDispose(baked)
    const env = loadEnvironment(scene, '/env/arena.hdr', baker, LOOK, () => Promise.resolve(new THREE.DataTexture()))
    await env.ready
    env.dispose()
    env.dispose()
    expect(bakedDisposed).toHaveBeenCalledOnce()
    expect(baker.dispose).toHaveBeenCalledOnce()
    expect(scene.environment).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace web run test -- src/game/render/environment.test.ts`
Expected: FAIL — `Failed to resolve import "./environment"`.

- [ ] **Step 3: Write minimal implementation**

`web/src/game/render/environment.ts`:

```ts
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'

/** Turns sources into prefiltered environment maps; a seam so loading is testable without WebGL. */
export interface EnvironmentBaker {
  fallback(): THREE.Texture
  fromEquirect(texture: THREE.Texture): THREE.Texture
  dispose(): void
}

export interface EnvironmentLook { intensity: number; rotationY: number }
export interface EnvironmentHandle { ready: Promise<void>; dispose(): void }

/** The procedural room shown until (or instead of) the HDRI. */
export const FALLBACK_LOOK: EnvironmentLook = { intensity: 0.3, rotationY: 0 }
/** Poly Haven `dancing_hall`: dark ceiling with neutral LED grids overhead. */
export const ARENA_LOOK: EnvironmentLook = { intensity: 0.5, rotationY: 0 }

export function pmremBaker(renderer: THREE.WebGLRenderer): EnvironmentBaker {
  const pmrem = new THREE.PMREMGenerator(renderer)
  return {
    fallback() {
      const room = new RoomEnvironment()
      const texture = pmrem.fromScene(room, 0.04).texture
      room.dispose()
      return texture
    },
    fromEquirect: (texture) => pmrem.fromEquirectangular(texture).texture,
    dispose: () => pmrem.dispose(),
  }
}

const loadHdr = (url: string): Promise<THREE.Texture> => new RGBELoader().loadAsync(url)

function apply(scene: THREE.Scene, texture: THREE.Texture, look: EnvironmentLook) {
  scene.environment = texture
  scene.environmentIntensity = look.intensity
  scene.environmentRotation.set(0, look.rotationY, 0)
}

/**
 * Lights the scene with the fallback immediately and swaps in the HDRI once
 * it arrives. The game never waits on it; a failed load only warns.
 */
export function loadEnvironment(
  scene: THREE.Scene,
  url: string,
  baker: EnvironmentBaker,
  look: EnvironmentLook = ARENA_LOOK,
  load: (url: string) => Promise<THREE.Texture> = loadHdr,
): EnvironmentHandle {
  let disposed = false
  let current = baker.fallback()
  apply(scene, current, FALLBACK_LOOK)

  const ready = load(url).then((hdr) => {
    // A quality switch may have torn the scene down while we were loading.
    if (disposed) { hdr.dispose(); return }
    const baked = baker.fromEquirect(hdr)
    hdr.dispose()
    current.dispose()
    current = baked
    apply(scene, current, look)
  }).catch((error: unknown) => {
    if (!disposed) console.warn(`Environment ${url} unavailable; keeping the fallback.`, error)
  })

  return {
    ready,
    dispose() {
      if (disposed) return
      disposed = true
      if (scene.environment === current) scene.environment = null
      current.dispose()
      baker.dispose()
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace web run test -- src/game/render/environment.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Ask the user, then download the HDRI**

Ask in chat and wait for an explicit yes:
> "May I download `dancing_hall_1k.hdr` (1.7 MB, CC0) from `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/dancing_hall_1k.hdr` into `web/public/env/arena_1k.hdr`?"

After yes, run (Bash, repo root):

```bash
mkdir -p web/public/env && curl -fL -o web/public/env/arena_1k.hdr https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/dancing_hall_1k.hdr && md5sum web/public/env/arena_1k.hdr
```

Expected: `2d8c98f2e75647367251284d9692a91a  web/public/env/arena_1k.hdr`. Any other hash → delete the file and stop.

`web/public/env/README.md`:

```md
# Environment maps

| File | Source | Author | License |
|---|---|---|---|
| `arena_1k.hdr` | [Poly Haven — Dancing Hall](https://polyhaven.com/a/dancing_hall), 1k HDR | Sergej Majboroda | CC0 |

Used only for image-based lighting (`scene.environment`); the visible hall is
modelled geometry. Phase 2 replaces it with an env map rendered from the
Blender hall.
```

- [ ] **Step 6: Wire it into `GameRenderer`**

In `web/src/game/GameRenderer.ts`:

Replace the import line
```ts
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
```
with
```ts
import { loadEnvironment, pmremBaker, type EnvironmentHandle } from './render/environment'
```

Add below the `AWAY_COLORS` constant:
```ts
const ENVIRONMENT_URL = `${import.meta.env.BASE_URL}env/arena_1k.hdr`
```

Add a field after `private readonly effects = new Effects()`:
```ts
  private readonly environment: EnvironmentHandle
```

Replace
```ts
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.3
    pmrem.dispose()
```
with
```ts
    this.environment = loadEnvironment(this.scene, ENVIRONMENT_URL, pmremBaker(this.renderer))
```

In `dispose()`, insert `this.environment.dispose()` directly before `this.renderer.dispose()`.

- [ ] **Step 7: Verify in the browser**

`preview_start {name: "web"}` (also `{name: "server"}` if the page needs `/api`). Then:
- `read_network_requests` with `urlPattern: "arena_1k.hdr"` → status 200, ~1.7 MB.
- `read_console_messages` with `onlyErrors: true` → none.
- `javascript_tool`: `rally.renderer.scene.environmentIntensity` → `0.5`.
- Screenshot: table/paddles show new reflections; scene otherwise unchanged.

- [ ] **Step 8: Gates and commit**

Run: `npm test` and `npm run typecheck` → both exit 0.

```bash
git add web/src/game/render/environment.ts web/src/game/render/environment.test.ts web/public/env web/src/game/GameRenderer.ts
git commit -m "feat(web): light the scene with an HDRI environment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Post-processing chain

**Files:**
- Modify: `web/package.json`, `package-lock.json` (deps)
- Create: `web/src/types/n8ao.d.ts`
- Create: `web/src/game/render/postfx.ts`
- Modify: `web/src/game/GameRenderer.ts` (constructor renderer setup, `frame()`, `resize()`, `dispose()`)
- Modify: `web/vite.config.ts` (`manualChunks`)

**Interfaces:**
- Consumes: `RenderProfile`, `renderProfile(quality)` from Task 1.
- Produces:
  ```ts
  export interface PostFx { enabled: boolean; render(dt: number): void; setSize(width: number, height: number): void; dispose(): void }
  export function createPostFx(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, profile: RenderProfile): PostFx
  ```
  `GameRenderer` gains `readonly postfx: PostFx` and `private readonly profile: RenderProfile` (Task 4 reads `this.profile`).

- [ ] **Step 1: Install dependencies**

Run (repo root): `npm install --workspace web postprocessing@^6.39.5 n8ao@^2.0.1`
Expected: `web/package.json` `dependencies` lists both; no peer-dependency errors.

- [ ] **Step 2: Add n8ao types**

`web/src/types/n8ao.d.ts`:

```ts
// n8ao ships JavaScript only; this covers the part of its API we use.
declare module 'n8ao' {
  import type { Camera, Color, Scene } from 'three'
  import { Pass } from 'postprocessing'

  export type N8AOQualityMode = 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'

  export interface N8AOConfiguration {
    aoRadius: number
    distanceFalloff: number
    intensity: number
    halfRes: boolean
    depthAwareUpsampling: boolean
    transparencyAware: boolean
    gammaCorrection: boolean
    screenSpaceRadius: boolean
    color: Color
  }

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number)
    configuration: N8AOConfiguration
    setQualityMode(mode: N8AOQualityMode): void
  }
}
```

Run: `npm run typecheck` → exit 0.

- [ ] **Step 3: Write `postfx.ts`**

`web/src/game/render/postfx.ts`:

```ts
import * as THREE from 'three'
import {
  BloomEffect, BrightnessContrastEffect, EffectComposer, EffectPass, FXAAEffect, HueSaturationEffect,
  RenderPass, ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing'
import { N8AOPostPass } from 'n8ao'
import type { RenderProfile } from './profile'

export interface PostFx {
  /** Development aid: `false` draws straight to the canvas with the same tone mapping. */
  enabled: boolean
  render(dt: number): void
  setSize(width: number, height: number): void
  dispose(): void
}

/**
 * Scene → (N8AO) → bloom, AgX tone mapping and grading merged into one pass
 * → (FXAA). Rendering happens in half float so the lamps keep their HDR
 * values until bloom picks them up.
 */
export function createPostFx(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, profile: RenderProfile): PostFx {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: profile.msaaSamples })
  composer.addPass(new RenderPass(scene, camera))

  if (profile.ao) {
    const ao = new N8AOPostPass(scene, camera)
    ao.setQualityMode('Medium')
    // World-space radius in metres: contact shadow under the table top, net and feet.
    Object.assign(ao.configuration, { aoRadius: 0.5, distanceFalloff: 0.5, intensity: 2.5, halfRes: true })
    composer.addPass(ao)
  }

  composer.addPass(new EffectPass(
    camera,
    new BloomEffect({
      mipmapBlur: true, luminanceThreshold: profile.bloom.threshold, luminanceSmoothing: 0.12,
      intensity: profile.bloom.intensity, levels: profile.bloom.levels,
    }),
    new ToneMappingEffect({ mode: ToneMappingMode.AGX }),
    new BrightnessContrastEffect({ contrast: profile.grading.contrast }),
    new HueSaturationEffect({ saturation: profile.grading.saturation }),
    new VignetteEffect({ offset: 0.3, darkness: profile.grading.vignette }),
  ))
  // FXAA samples neighbouring pixels, so it runs on the finished image in its own pass.
  if (profile.fxaa) composer.addPass(new EffectPass(camera, new FXAAEffect()))

  let enabled = true
  return {
    get enabled() { return enabled },
    set enabled(value: boolean) {
      enabled = value
      renderer.toneMapping = value ? THREE.NoToneMapping : THREE.AgXToneMapping
    },
    render(dt) {
      if (enabled) composer.render(dt)
      else renderer.render(scene, camera)
    },
    setSize(width, height) { composer.setSize(width, height, false) },
    dispose() { composer.dispose() },
  }
}
```

- [ ] **Step 4: Wire it into `GameRenderer`**

In `web/src/game/GameRenderer.ts`:

Add imports:
```ts
import { createPostFx, type PostFx } from './render/postfx'
import { renderProfile, type RenderProfile } from './render/profile'
```

Add fields after `private readonly environment: EnvironmentHandle`:
```ts
  readonly postfx: PostFx
  private readonly profile: RenderProfile
```

Replace the renderer setup block
```ts
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high', powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1.25))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap
```
with
```ts
    this.profile = renderProfile(quality)
    // Anti-aliasing and tone mapping live in the post chain (render/postfx.ts).
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.profile.pixelRatioCap))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = this.profile.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap
```

Directly after the line `this.scene.add(this.net.group, this.paddles.home.root, ...)` add:
```ts
    this.postfx = createPostFx(this.renderer, this.scene, this.camera, this.profile)
```
(It must come before `this.resize()` in the constructor.)

In `frame()` replace `this.renderer.render(this.scene, this.camera)` with `this.postfx.render(dt)`.

In `resize()` replace `this.renderer.setSize(width, height, false)` with `this.postfx.setSize(width, height)`.

In `dispose()` insert `this.postfx.dispose()` directly before `this.environment.dispose()`.

- [ ] **Step 5: Split the chunk**

In `web/vite.config.ts` change
```ts
      output: { manualChunks: { three: ['three'], react: ['react', 'react-dom', 'react-router-dom'] } },
```
to
```ts
      output: { manualChunks: { three: ['three'], postfx: ['postprocessing', 'n8ao'], react: ['react', 'react-dom', 'react-router-dom'] } },
```

- [ ] **Step 6: Gates**

Run: `npm test` and `npm run typecheck` → exit 0.

- [ ] **Step 7: Check N8AO + MSAA (spec risk)**

`preview_start {name: "web"}`; with Graphics = High:
- `read_console_messages` → no WebGL errors (e.g. `glBlitFramebuffer`, `INVALID_OPERATION`, `Framebuffer incomplete`).
- `javascript_tool`: `rally.renderer.postfx.enabled = false` → screenshot; `= true` → screenshot. With AO on, the area under the table top and around the net posts must be darker than with it off.
- If there are errors or no AO is visible: in `profile.ts` set `high.msaaSamples = 0`, add `import { SMAAEffect } from 'postprocessing'` and in `postfx.ts` append a final pass `if (profile.tier === 'high' && profile.msaaSamples === 0) composer.addPass(new EffectPass(camera, new SMAAEffect()))`; update the `high` expectation in `profile.test.ts` to `msaaSamples: 0`. Re-run Step 6.

- [ ] **Step 8: Review-focus checks**

- **Pointer mapping:** start a local match (Home → Play vs CPU), move the pointer to 3 points on the table (`computer` hover), screenshot each; the paddle must sit under the pointer.
- **Resize:** `resize_window {preset: "mobile"}`, reload, screenshot: frame fills the canvas without stretching; `resize_window {preset: "desktop"}` afterwards.
- **Transparent objects under AO:** during a rally, zoom screenshots on the ball trail, hit flash and landing marker: no dark halo. If present set `ao.configuration.transparencyAware = true` in `postfx.ts` and re-check.
- **Low tier:** switch Graphics → Fast, `read_console_messages` → no errors, screenshot.

- [ ] **Step 9: Commit**

```bash
git add web/package.json package-lock.json web/src/types/n8ao.d.ts web/src/game/render/postfx.ts web/src/game/GameRenderer.ts web/vite.config.ts
git commit -m "feat(web): add post-processing chain with AO, bloom and AgX

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(If Step 7 changed `profile.ts`/`profile.test.ts`, add them to this commit.)

---

### Task 4: WTT broadcast light rig

**Files:**
- Modify: `web/src/game/world/arena.ts` (`createLights`, ceiling light bars in `createArena`)
- Modify: `web/src/game/GameRenderer.ts` (`createLights` call)

**Interfaces:**
- Consumes: `RenderProfile` (Task 1); `this.profile` in `GameRenderer` (Task 3).
- Produces: `export function createLights(profile: RenderProfile): THREE.Group` (replaces `createLights(quality)`).

- [ ] **Step 1: Baseline screenshots**

With the preview running: `javascript_tool` → `rally.renderer.simulate(4000)`; screenshot (attract orbit). Start a local match, `rally.renderer.simulate(3000)`, screenshot (player camera). Keep both for comparison.

- [ ] **Step 2: Replace `createLights`**

In `web/src/game/world/arena.ts` add imports:
```ts
import { TABLE_HEIGHT } from '@rally/core'
import type { RenderProfile } from '../render/profile'
```

Replace the whole `createLights` function with:
```ts
/**
 * Broadcast rig: the court is lit like a stage and the stands fall into
 * darkness. Ambient light comes from the HDRI; only the key casts shadows.
 */
export function createLights(profile: RenderProfile) {
  const group = new THREE.Group()
  group.name = 'lights'
  group.add(new THREE.HemisphereLight('#b9c8ff', '#1a1210', 0.12))

  // Nearly overhead so ball and paddle shadows fall short and straight down.
  const key = new THREE.DirectionalLight('#f3f6ff', 2.6)
  key.position.set(0.6, 8, 0.9)
  key.target.position.set(0, TABLE_HEIGHT, 0)
  key.castShadow = true
  key.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize)
  const cam = key.shadow.camera
  cam.left = -3.4; cam.right = 3.4; cam.top = 4.2; cam.bottom = -4.2; cam.near = 1; cam.far = 12
  key.shadow.bias = -0.0004
  key.shadow.normalBias = 0.015
  key.shadow.radius = 3
  group.add(key, key.target)

  // Court wash: four pools that fade out before the barriers.
  for (const sx of [-1.5, 1.5]) {
    for (const sz of [-3, 3]) {
      const wash = new THREE.SpotLight('#eef2ff', 30, 14, 0.7, 0.85, 1.6)
      wash.position.set(sx, 6.5, sz)
      wash.target.position.set(sx * 0.4, 0, sz * 0.6)
      group.add(wash, wash.target)
    }
  }

  // Rim: weak cool back light from each end separates paddles and ball from the dark stands.
  for (const sz of [-1, 1]) {
    const rim = new THREE.DirectionalLight('#9fc0ff', 0.35)
    rim.position.set(0, 2.2, sz * 9)
    rim.target.position.set(0, TABLE_HEIGHT + 0.15, 0)
    group.add(rim, rim.target)
  }
  return group
}
```

- [ ] **Step 3: Make the light bars HDR**

In `createArena`, replace
```ts
  const lightBar = new THREE.MeshBasicMaterial({ color: '#fff6e6' })
```
with
```ts
  // Above 1.0 in linear HDR so the bloom threshold catches the lamps and little else.
  const lightBar = new THREE.MeshBasicMaterial({ color: new THREE.Color('#f3f6ff').multiplyScalar(6) })
```

- [ ] **Step 4: Update the call site**

In `web/src/game/GameRenderer.ts` replace `createLights(quality)` with `createLights(this.profile)`.

Run: `npm run typecheck` → exit 0.

- [ ] **Step 5: Tune visually**

Repeat the two Step 1 screenshots. Adjust only these values, one at a time, until the success criteria hold (court clearly brighter than stands; white table lines not clipped; ball reads against the floor and the dark background; lamps bloom, table does not):
- `key` intensity (range 2–3.5), wash intensity (20–45), `ARENA_LOOK.intensity` in `environment.ts` (0.35–0.7), `ARENA_LOOK.rotationY` (0 … 2π, pick the angle where the LED grid reflects on the table top from the player camera), light-bar multiplier (4–10).
Record the final values in the commit message body.

- [ ] **Step 6: Gates and commit**

Run: `npm test` and `npm run typecheck` → exit 0.

```bash
git add web/src/game/world/arena.ts web/src/game/GameRenderer.ts web/src/game/render/environment.ts
git commit -m "feat(web): relight the arena as a broadcast stage

<final tuned values>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Verification and docs

**Files:**
- Modify: `architecture.md` (İstemci bölümü)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: everything above. Produces: nothing new.

- [ ] **Step 1: Before/after screenshots**

Same `simulate()` frames as Task 4 Step 1 with `rally.renderer.postfx.enabled = false` (before) and `true` (after), Graphics = High and Fast. Send to the user with `SendUserFile`.

- [ ] **Step 2: Frame-time measurement**

`javascript_tool` for each of: High + postfx on, High + postfx off, Fast + postfx on, Fast + postfx off:
```js
const r = rally.renderer; const t0 = performance.now(); r.simulate(5000); const ms = (performance.now() - t0) / 300; ({ ms, calls: r.renderer.info.render.calls })
```
Success: Fast on − Fast off ≲ 1 ms. Report all four numbers to the user.

- [ ] **Step 3: Portrait check**

`resize_window {preset: "mobile"}`, reload, start a local match, screenshot; then `resize_window {preset: "desktop"}`.

- [ ] **Step 4: Quality-toggle leak check**

Toggle Graphics High → Fast → High → Fast within ~2 s (HDRI still loading on some toggles). `read_console_messages` → no errors (one `Environment … unavailable` warning is not expected either). `javascript_tool`: `rally.renderer.renderer.info.memory` → `textures` count after the last toggle within ±2 of the count after the first mount.

- [ ] **Step 5: Update docs**

`architecture.md`, İstemci bölümünde "Görsel dünya" maddesini şununla değiştir:

```md
- **Görsel dünya (`game/world/`):** salon, bariyerler, tribünler, WTT yayın
  tarzı ışık düzeni (tepeden tek gölgeli key, kort yıkaması, rim), regülasyon
  masa ve file, prosedürel raketler, top izi ve temas gölgesi. Dokular çalışma
  anında canvas'a çizilir; tek ikili asset `public/env/` altındaki HDRI'dir.
- **Render (`game/render/`):** `profile.ts` kalite katmanını (piksel oranı,
  gölge, MSAA/FXAA, AO, bloom, grading) tanımlar. `environment.ts` HDRI'yi
  PMREM'e çevirir; yüklenene kadar ve hata durumunda `RoomEnvironment` kullanır.
  `postfx.ts` pmndrs `postprocessing` zinciridir: N8AO (yalnız High) → bloom +
  AgX + grading tek geçişte → FXAA (yalnız Fast). Geliştirmede
  `rally.renderer.postfx.enabled = false` zinciri kapatır.
```

`CHANGELOG.md`, add at the top below the title:

```md
## Unreleased

- Broadcast-style lighting: HDRI image-based lighting, overhead key light,
  court wash and rim lights.
- Post-processing with pmndrs `postprocessing`: N8AO ambient occlusion
  (High), bloom on the ceiling lamps, AgX tone mapping and light grading.
```

- [ ] **Step 6: Final gates**

Run from repo root: `npm test`, `npm run typecheck`, `npm run build` → all exit 0.
Check: `ls web/dist/env/arena_1k.hdr` exists; `ls web/dist/assets | grep postfx` shows the chunk.

- [ ] **Step 7: Commit**

```bash
git add architecture.md CHANGELOG.md
git commit -m "docs: describe the render pipeline and new lighting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
