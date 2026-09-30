import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'

/** A prefiltered map and the way to free it; disposing a render target's texture alone frees nothing. */
export interface BakedEnvironment { texture: THREE.Texture; dispose(): void }

/** Turns sources into prefiltered environment maps; a seam so loading is testable without WebGL. */
export interface EnvironmentBaker {
  fallback(): BakedEnvironment
  fromEquirect(texture: THREE.Texture): BakedEnvironment
  dispose(): void
}

export interface EnvironmentLook { intensity: number; rotationY: number }
export interface EnvironmentHandle { ready: Promise<void>; dispose(): void }

/** The procedural room shown until (or instead of) the HDRI. */
export const FALLBACK_LOOK: EnvironmentLook = { intensity: 0.15, rotationY: 0 }
/**
 * Poly Haven `dancing_hall`: dark ceiling with neutral LED grids overhead.
 * Kept low: its bright floor and walls would otherwise fill in the stands.
 */
export const ARENA_LOOK: EnvironmentLook = { intensity: 0.15, rotationY: 0 }

export function pmremBaker(renderer: THREE.WebGLRenderer): EnvironmentBaker {
  const pmrem = new THREE.PMREMGenerator(renderer)
  const baked = (target: THREE.WebGLRenderTarget): BakedEnvironment => ({ texture: target.texture, dispose: () => target.dispose() })
  return {
    fallback() {
      const room = new RoomEnvironment()
      const target = pmrem.fromScene(room, 0.04)
      room.dispose()
      return baked(target)
    },
    fromEquirect: (texture) => baked(pmrem.fromEquirectangular(texture)),
    dispose: () => pmrem.dispose(),
  }
}

const RADIANCE_MAGIC = '#?'

/**
 * Fetches and decodes a Radiance `.hdr`. Done by hand rather than with
 * `RGBELoader.load` because a static host answers a missing file with
 * index.html and 200, which the stock loader turns into an uncaught error.
 */
export async function loadHdr(url: string, fetcher: typeof fetch = fetch): Promise<THREE.Texture> {
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const buffer = await response.arrayBuffer()
  const magic = new TextDecoder().decode(buffer.slice(0, RADIANCE_MAGIC.length))
  if (magic !== RADIANCE_MAGIC) throw new Error('Not a Radiance HDR file')
  const hdr = new RGBELoader().parse(buffer)
  const texture = new THREE.DataTexture(hdr.data, hdr.width, hdr.height, THREE.RGBAFormat, hdr.type)
  texture.colorSpace = THREE.LinearSRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.flipY = true
  texture.needsUpdate = true
  return texture
}

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
  let bakerReleased = false
  // The baker holds working buffers as large as the map itself; free it once nothing is left to bake.
  const releaseBaker = () => {
    if (bakerReleased) return
    bakerReleased = true
    baker.dispose()
  }
  let current = baker.fallback()
  apply(scene, current.texture, FALLBACK_LOOK)

  const ready = load(url).then((hdr) => {
    // A quality switch may have torn the scene down while we were loading.
    if (disposed) { hdr.dispose(); return }
    let baked: BakedEnvironment
    try { baked = baker.fromEquirect(hdr) } finally { hdr.dispose() }
    current.dispose()
    current = baked
    apply(scene, current.texture, look)
  }).catch((error: unknown) => {
    if (!disposed) console.warn(`Environment ${url} unavailable; keeping the fallback.`, error)
  }).finally(releaseBaker)

  return {
    ready,
    dispose() {
      if (disposed) return
      disposed = true
      if (scene.environment === current.texture) scene.environment = null
      current.dispose()
      releaseBaker()
    },
  }
}
