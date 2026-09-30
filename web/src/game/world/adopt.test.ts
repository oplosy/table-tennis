import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { adoptArenaModel } from './arena'
import { adoptTableModel, type NetView } from './table'

// The real painters need a 2D canvas, which jsdom does not provide.
vi.mock('./textures', async () => {
  const three = await import('three')
  const texture = () => new three.Texture()
  return { barrierTexture: texture, floorTexture: texture, hallTexture: texture, screenTexture: texture, netTexture: texture, radialTexture: texture, rubberTexture: texture }
})

function mesh(name: string, material: string, attributes: string[] = []) {
  const geometry = new THREE.BufferGeometry()
  for (const attribute of attributes) geometry.setAttribute(attribute, new THREE.BufferAttribute(new Float32Array(6), 2))
  const standard = new THREE.MeshStandardMaterial({ color: '#336699' })
  standard.name = material
  const object = new THREE.Mesh(geometry, standard)
  object.name = name
  return object
}

function arenaModel() {
  const model = new THREE.Group()
  const parts = {
    court: mesh('floor', 'court', ['uv', 'uv1']),
    barrier: mesh('barriers', 'barrier_back', ['uv', 'uv1']),
    barrierCorner: mesh('barrier_corner', 'barrier_back', ['uv', 'uv1']),
    face: mesh('barrier_face', 'barrier_face_A', ['uv', 'uv1']),
    stands: mesh('stands', 'seat', ['color']),
    lamp: mesh('lamps', 'lamp', ['color']),
    screen: mesh('screen_away', 'screen', ['uv']),
  }
  model.add(...Object.values(parts))
  return { model, parts }
}

const basic = (object: THREE.Mesh) => object.material as THREE.MeshBasicMaterial

describe('adoptArenaModel', () => {
  it('lights big surfaces from the lightmap through the second UV set', () => {
    const { model, parts } = arenaModel()
    const lightmap = new THREE.Texture()
    adoptArenaModel(new THREE.Group(), model, lightmap)
    const material = basic(parts.barrier)
    expect(material).toBeInstanceOf(THREE.MeshBasicMaterial)
    expect(material.lightMap).toBe(lightmap)
    expect(material.vertexColors).toBe(false)
    expect(lightmap.channel).toBe(1)
    expect(lightmap.flipY).toBe(false)
    expect(lightmap.colorSpace).toBe(THREE.SRGBColorSpace)
  })

  it('lights cluttered objects from their vertex colours instead', () => {
    const { model, parts } = arenaModel()
    adoptArenaModel(new THREE.Group(), model, new THREE.Texture())
    expect(basic(parts.stands).vertexColors).toBe(true)
    expect(basic(parts.stands).lightMap).toBeNull()
  })

  it('makes lamps glow above 1.0 and ignores the light baked onto them', () => {
    const { model, parts } = arenaModel()
    adoptArenaModel(new THREE.Group(), model, new THREE.Texture())
    const lamp = basic(parts.lamp)
    expect(Math.max(lamp.color.r, lamp.color.g, lamp.color.b)).toBeGreaterThan(1)
    expect(lamp.vertexColors).toBe(false)
    expect(lamp.lightMap).toBeNull()
  })

  it('paints the court, the barrier faces and the screens with game textures', () => {
    const { model, parts } = arenaModel()
    adoptArenaModel(new THREE.Group(), model, new THREE.Texture())
    for (const part of [parts.court, parts.face, parts.screen]) {
      expect(basic(part).map, part.name).toBeInstanceOf(THREE.Texture)
      expect(basic(part).map!.flipY, part.name).toBe(false)
    }
    expect(basic(parts.barrier).map).toBeNull()
    expect(basic(parts.screen).lightMap).toBeNull()
  })

  it('shares one material between meshes that look the same', () => {
    const { model, parts } = arenaModel()
    adoptArenaModel(new THREE.Group(), model, new THREE.Texture())
    expect(parts.barrier.material).toBe(parts.barrierCorner.material)
    expect(parts.barrier.material).not.toBe(parts.face.material)
  })

  it('replaces the procedural hall and frees it', () => {
    const arena = new THREE.Group()
    const old = mesh('old_floor', 'old')
    const freed = vi.fn()
    old.geometry.addEventListener('dispose', freed)
    arena.add(old)
    const { model } = arenaModel()
    adoptArenaModel(arena, model, new THREE.Texture())
    expect(old.parent).toBeNull()
    expect(freed).toHaveBeenCalledOnce()
    expect(arena.children).toContain(model)
  })

  it('adds a shadow catcher that does not fight the floor for depth', () => {
    const arena = new THREE.Group()
    adoptArenaModel(arena, arenaModel().model, new THREE.Texture())
    const catcher = arena.getObjectByName('shadow_catcher') as THREE.Mesh
    const material = catcher.material as THREE.ShadowMaterial
    expect(catcher.receiveShadow).toBe(true)
    expect(material).toBeInstanceOf(THREE.ShadowMaterial)
    expect(material.depthWrite).toBe(false)
    expect(material.polygonOffset).toBe(true)
  })
})

describe('adoptTableModel', () => {
  it('swaps in the model, which receives shadows but leaves its own to the lightmap', () => {
    const table = new THREE.Group()
    const old = mesh('procedural_top', 'old')
    table.add(old)
    const model = new THREE.Group()
    const top = mesh('table_top', 'table_surface')
    model.add(top)
    const net = { hidePosts: vi.fn() } as unknown as NetView
    adoptTableModel(table, net, model)
    expect(old.parent).toBeNull()
    expect(table.children).toEqual([model])
    expect(top.receiveShadow).toBe(true)
    expect(top.castShadow).toBe(false)
    expect(net.hidePosts).toHaveBeenCalledOnce()
  })
})
