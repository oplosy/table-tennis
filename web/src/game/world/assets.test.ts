import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { REQUIRED_NODES, loadModels, type ModelSlots, type ModelSource } from './assets'

const URLS = { table: 'table.glb', paddle: 'paddle.glb', arena: 'arena.glb', lightmap: 'lightmap.webp' }

/** A stand-in model: one mesh per required node, so disposal can be observed. */
function model(names: readonly string[]) {
  const group = new THREE.Group()
  const disposed = vi.fn()
  for (const name of names) {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
    mesh.name = name
    mesh.geometry.addEventListener('dispose', disposed)
    group.add(mesh)
  }
  return { group, disposed }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}

function slots() {
  return { table: vi.fn(), paddle: vi.fn(), arena: vi.fn() } satisfies ModelSlots
}

function source(models: Record<string, Promise<THREE.Object3D>>, lightmap: Promise<THREE.Texture>): ModelSource {
  return { model: (url) => models[url], texture: () => lightmap }
}

const complete = () => ({
  table: model(REQUIRED_NODES.table), paddle: model(REQUIRED_NODES.paddle), arena: model(REQUIRED_NODES.arena), lightmap: new THREE.Texture(),
})

afterEach(() => { vi.restoreAllMocks() })

describe('loadModels', () => {
  it('hands each model to its slot', async () => {
    const parts = complete()
    const into = slots()
    const handle = loadModels(URLS, source({
      'table.glb': Promise.resolve(parts.table.group), 'paddle.glb': Promise.resolve(parts.paddle.group), 'arena.glb': Promise.resolve(parts.arena.group),
    }, Promise.resolve(parts.lightmap)), into)
    await handle.ready
    expect(into.table).toHaveBeenCalledWith(parts.table.group)
    expect(into.paddle).toHaveBeenCalledWith(parts.paddle.group)
    expect(into.arena).toHaveBeenCalledWith(parts.arena.group, parts.lightmap)
  })

  it('does not hold one model back for another', async () => {
    const parts = complete()
    const into = slots()
    const slow = deferred<THREE.Object3D>()
    const handle = loadModels(URLS, source({
      'table.glb': Promise.resolve(parts.table.group), 'paddle.glb': slow.promise, 'arena.glb': Promise.resolve(parts.arena.group),
    }, Promise.resolve(parts.lightmap)), into)
    await Promise.resolve(); await Promise.resolve()
    expect(into.table).toHaveBeenCalledOnce()
    expect(into.paddle).not.toHaveBeenCalled()
    slow.resolve(parts.paddle.group)
    await handle.ready
  })

  it('keeps the other models when one fails, and warns once for it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const parts = complete()
    const into = slots()
    const handle = loadModels(URLS, source({
      'table.glb': Promise.reject(new Error('404')), 'paddle.glb': Promise.resolve(parts.paddle.group), 'arena.glb': Promise.resolve(parts.arena.group),
    }, Promise.resolve(parts.lightmap)), into)
    await handle.ready
    expect(into.table).not.toHaveBeenCalled()
    expect(into.paddle).toHaveBeenCalledOnce()
    expect(into.arena).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('rejects a model that lacks a node the game relies on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = model(['table_top', 'table_frame'])
    const parts = complete()
    const into = slots()
    const handle = loadModels(URLS, source({
      'table.glb': Promise.resolve(broken.group), 'paddle.glb': Promise.resolve(parts.paddle.group), 'arena.glb': Promise.resolve(parts.arena.group),
    }, Promise.resolve(parts.lightmap)), into)
    await handle.ready
    expect(into.table).not.toHaveBeenCalled()
    expect(broken.disposed).toHaveBeenCalled()
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0][0])).toContain('net_post_L')
  })

  it('leaves the arena procedural when its lightmap is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const parts = complete()
    const into = slots()
    const handle = loadModels(URLS, source({
      'table.glb': Promise.resolve(parts.table.group), 'paddle.glb': Promise.resolve(parts.paddle.group), 'arena.glb': Promise.resolve(parts.arena.group),
    }, Promise.reject(new Error('404'))), into)
    await handle.ready
    expect(into.arena).not.toHaveBeenCalled()
    expect(parts.arena.disposed).toHaveBeenCalled()
    expect(into.table).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('drops and frees models that arrive after dispose', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const parts = complete()
    const into = slots()
    const pending = deferred<THREE.Object3D>()
    const lightmapDisposed = vi.fn()
    parts.lightmap.addEventListener('dispose', lightmapDisposed)
    const handle = loadModels(URLS, source({
      'table.glb': pending.promise, 'paddle.glb': Promise.resolve(parts.paddle.group), 'arena.glb': Promise.resolve(parts.arena.group),
    }, Promise.resolve(parts.lightmap)), into)
    handle.dispose()
    pending.resolve(parts.table.group)
    await handle.ready
    expect(into.table).not.toHaveBeenCalled()
    expect(into.paddle).not.toHaveBeenCalled()
    expect(into.arena).not.toHaveBeenCalled()
    expect(parts.table.disposed).toHaveBeenCalled()
    expect(parts.arena.disposed).toHaveBeenCalled()
    expect(lightmapDisposed).toHaveBeenCalledOnce()
    expect(warn).not.toHaveBeenCalled()
  })

  it('survives a slot that throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const parts = complete()
    const into = slots()
    into.table.mockImplementation(() => { throw new Error('adopt failed') })
    const handle = loadModels(URLS, source({
      'table.glb': Promise.resolve(parts.table.group), 'paddle.glb': Promise.resolve(parts.paddle.group), 'arena.glb': Promise.resolve(parts.arena.group),
    }, Promise.resolve(parts.lightmap)), into)
    await handle.ready
    expect(into.paddle).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledOnce()
  })
})
