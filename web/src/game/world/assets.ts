import * as THREE from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/** Reads model files; a seam so loading is testable without WebGL or a network. */
export interface ModelSource {
  model(url: string): Promise<THREE.Object3D>
  texture(url: string): Promise<THREE.Texture>
}

export interface ModelUrls { table: string; paddle: string; arena: string; lightmap: string }

/** Where each model goes once it has arrived and passed its checks. */
export interface ModelSlots {
  table(model: THREE.Object3D): void
  paddle(model: THREE.Object3D): void
  arena(model: THREE.Object3D, lightmap: THREE.Texture): void
}

export interface ModelsHandle { ready: Promise<void>; dispose(): void }

/** Nodes the game looks up by name; a model without them is not used. */
export const REQUIRED_NODES = {
  table: ['table_top', 'table_frame', 'net_post_L', 'net_post_R'],
  paddle: ['blade', 'handle'],
  arena: ['floor', 'barriers', 'stands', 'lamps'],
} as const

export function gltfSource(): ModelSource {
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const textures = new THREE.TextureLoader()
  return {
    model: async (url) => (await gltf.loadAsync(url)).scene,
    texture: (url) => textures.loadAsync(url),
  }
}

/** Frees the GPU resources of a model that will not be shown. */
export function disposeModel(model: THREE.Object3D) {
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry.dispose()
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose()
  })
}

function checked(model: THREE.Object3D, part: keyof typeof REQUIRED_NODES) {
  const missing = REQUIRED_NODES[part].filter((name) => !model.getObjectByName(name))
  if (missing.length) {
    disposeModel(model)
    throw new Error(`${part} model lacks ${missing.join(', ')}`)
  }
  return model
}

/**
 * Loads the Blender models and hands each to its slot as it arrives. The game
 * never waits: until then, and for any part that fails, the procedural world
 * stays on screen.
 */
export function loadModels(urls: ModelUrls, source: ModelSource, slots: ModelSlots): ModelsHandle {
  let disposed = false

  const part = async (name: string, load: () => Promise<() => void>) => {
    try {
      (await load())()
    } catch (error) {
      if (!disposed) console.warn(`Model "${name}" unavailable; keeping the procedural one. ${String(error)}`)
    }
  }

  const single = (name: 'table' | 'paddle') => part(name, async () => {
    const model = checked(await source.model(urls[name]), name)
    if (disposed) { disposeModel(model); return () => {} }
    return () => slots[name](model)
  })

  // The arena is unlit and relies on its lightmap: without it, it would be black.
  const arena = part('arena', async () => {
    const [model, lightmap] = await Promise.allSettled([source.model(urls.arena), source.texture(urls.lightmap)])
    const release = () => {
      if (model.status === 'fulfilled') disposeModel(model.value)
      if (lightmap.status === 'fulfilled') lightmap.value.dispose()
    }
    if (model.status === 'rejected' || lightmap.status === 'rejected') {
      release()
      throw model.status === 'rejected' ? model.reason : (lightmap as PromiseRejectedResult).reason
    }
    if (disposed) { release(); return () => {} }
    try { checked(model.value, 'arena') } catch (error) { lightmap.value.dispose(); throw error }
    return () => slots.arena(model.value, lightmap.value)
  })

  return {
    ready: Promise.all([single('table'), single('paddle'), arena]).then(() => {}),
    dispose() { disposed = true },
  }
}
