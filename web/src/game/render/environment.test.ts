import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FALLBACK_LOOK, loadEnvironment, loadHdr, type EnvironmentBaker } from './environment'

const LOOK = { intensity: 0.5, rotationY: 1.2 }

function fakeBaker() {
  const fallback = { texture: new THREE.Texture(), dispose: vi.fn() }
  const baked = { texture: new THREE.Texture(), dispose: vi.fn() }
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
    const hdrDisposed = watchDispose(hdr)

    const env = loadEnvironment(scene, '/env/arena.hdr', baker, LOOK, () => pending.promise)
    expect(scene.environment).toBe(fallback.texture)
    expect(scene.environmentIntensity).toBe(FALLBACK_LOOK.intensity)
    expect(baker.dispose).not.toHaveBeenCalled()

    pending.resolve(hdr)
    await env.ready
    expect(baker.fromEquirect).toHaveBeenCalledWith(hdr)
    expect(scene.environment).toBe(baked.texture)
    expect(scene.environmentIntensity).toBe(LOOK.intensity)
    expect(scene.environmentRotation.y).toBe(LOOK.rotationY)
    expect(fallback.dispose).toHaveBeenCalledOnce()
    expect(baked.dispose).not.toHaveBeenCalled()
    expect(hdrDisposed).toHaveBeenCalledOnce()
  })

  it('releases the baker as soon as the load settles', async () => {
    const { baker } = fakeBaker()
    const env = loadEnvironment(new THREE.Scene(), '/env/arena.hdr', baker, LOOK, () => Promise.resolve(new THREE.DataTexture()))
    await env.ready
    expect(baker.dispose).toHaveBeenCalledOnce()
    env.dispose()
    expect(baker.dispose).toHaveBeenCalledOnce()
  })

  it('keeps the fallback and warns when the HDRI cannot load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scene = new THREE.Scene()
    const { baker, fallback } = fakeBaker()

    const env = loadEnvironment(scene, '/env/missing.hdr', baker, LOOK, () => Promise.reject(new Error('404')))
    await env.ready
    expect(scene.environment).toBe(fallback.texture)
    expect(scene.environmentIntensity).toBe(FALLBACK_LOOK.intensity)
    expect(baker.fromEquirect).not.toHaveBeenCalled()
    expect(fallback.dispose).not.toHaveBeenCalled()
    expect(baker.dispose).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('releases the HDRI even when baking it fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scene = new THREE.Scene()
    const { baker, fallback } = fakeBaker()
    baker.fromEquirect.mockImplementation(() => { throw new Error('bake failed') })
    const hdr = new THREE.DataTexture()
    const hdrDisposed = watchDispose(hdr)

    const env = loadEnvironment(scene, '/env/arena.hdr', baker, LOOK, () => Promise.resolve(hdr))
    await env.ready
    expect(hdrDisposed).toHaveBeenCalledOnce()
    expect(scene.environment).toBe(fallback.texture)
  })

  it('drops an HDRI that arrives after dispose', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scene = new THREE.Scene()
    const { baker, fallback } = fakeBaker()
    const hdr = new THREE.DataTexture()
    const pending = deferred<THREE.Texture>()
    const hdrDisposed = watchDispose(hdr)

    const env = loadEnvironment(scene, '/env/arena.hdr', baker, LOOK, () => pending.promise)
    env.dispose()
    pending.resolve(hdr)
    await env.ready
    expect(baker.fromEquirect).not.toHaveBeenCalled()
    expect(hdrDisposed).toHaveBeenCalledOnce()
    expect(fallback.dispose).toHaveBeenCalledOnce()
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
    const env = loadEnvironment(scene, '/env/arena.hdr', baker, LOOK, () => Promise.resolve(new THREE.DataTexture()))
    await env.ready
    env.dispose()
    env.dispose()
    expect(baked.dispose).toHaveBeenCalledOnce()
    expect(scene.environment).toBeNull()
  })
})

/** The smallest valid Radiance file: a header and one flat RGBE pixel. */
function tinyHdr() {
  const header = new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n')
  const bytes = new Uint8Array(header.length + 4)
  bytes.set(header)
  bytes.set([128, 128, 128, 129], header.length)
  return bytes.buffer
}

const respond = (body: ArrayBuffer, status = 200) => () => Promise.resolve(new Response(body, { status }))

describe('loadHdr', () => {
  it('turns a Radiance file into a linear texture', async () => {
    const texture = await loadHdr('/env/arena.hdr', respond(tinyHdr()))
    expect(texture.image.width).toBe(1)
    expect(texture.image.height).toBe(1)
    expect(texture.colorSpace).toBe(THREE.LinearSRGBColorSpace)
    expect(texture.flipY).toBe(true)
  })

  it('rejects a missing file', async () => {
    await expect(loadHdr('/env/missing.hdr', respond(new ArrayBuffer(0), 404))).rejects.toThrow('404')
  })

  it('rejects the index.html a static host serves for unknown paths', async () => {
    const html = new TextEncoder().encode('<!doctype html><html></html>').buffer
    await expect(loadHdr('/env/missing.hdr', respond(html))).rejects.toThrow('Radiance')
  })
})
