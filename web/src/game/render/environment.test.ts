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
