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
