import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { PaddleView } from './paddle'

// The real painters need a 2D canvas, which jsdom does not provide.
vi.mock('./textures', async () => {
  const three = await import('three')
  const named = (name: string) => () => { const texture = new three.Texture(); texture.name = name; return texture }
  return { radialTexture: named('radial'), rubberTexture: named('rubber'), woodTexture: named('wood') }
})

const COLORS = { forehand: '#d8262f', backhand: '#15171c', handle: '#3c4a63', accent: '#39c2ff' }

function paddleModel() {
  const model = new THREE.Group()
  const parts: Record<string, THREE.Mesh> = {}
  for (const name of ['wood', 'rubber_forehand', 'rubber_backhand', 'handle', 'accent']) {
    const material = new THREE.MeshStandardMaterial({ color: '#808080' })
    material.name = name
    parts[name] = new THREE.Mesh(new THREE.BufferGeometry(), material)
    parts[name].name = `part_${name}`
    model.add(parts[name])
  }
  return model
}

function adopted() {
  const view = new PaddleView('away', COLORS)
  view.adopt(paddleModel())
  const material = (name: string) => (view.root.getObjectByName(`part_${name}`) as THREE.Mesh).material as THREE.MeshStandardMaterial
  return { view, material }
}

describe('PaddleView.adopt', () => {
  it('tints the rubbers, handle and accent in the player\'s colours', () => {
    const { material } = adopted()
    expect(material('rubber_forehand').color.getHexString()).toBe('d8262f')
    expect(material('rubber_backhand').color.getHexString()).toBe('15171c')
    expect(material('handle').color.getHexString()).toBe('3c4a63')
    expect(material('accent').color.getHexString()).toBe('39c2ff')
  })

  it('gives both rubbers their pimpled surface', () => {
    const { material } = adopted()
    expect(material('rubber_forehand').roughnessMap?.name).toBe('rubber')
    expect(material('rubber_backhand').roughnessMap?.name).toBe('rubber')
    expect(material('wood').roughnessMap).toBeNull()
  })

  it('shows wood grain on the blade and through the handle\'s colour', () => {
    const { material } = adopted()
    expect(material('wood').map?.name).toBe('wood')
    expect(material('handle').map?.name).toBe('wood')
    expect(material('rubber_forehand').map).toBeNull()
    expect(material('accent').map).toBeNull()
  })

  it('leaves the shared model untouched so the other player can use it', () => {
    const model = paddleModel()
    const original = (model.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial
    new PaddleView('home', COLORS).adopt(model)
    expect(original.color.getHexString()).toBe('808080')
    expect(original.roughnessMap).toBeNull()
  })

  it('frees the procedural blade but keeps its painted rubber for the model', () => {
    const view = new PaddleView('away', COLORS)
    const freed: string[] = []
    let pimples: THREE.Texture | null = null
    view.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const material = object.material as THREE.MeshStandardMaterial
      if (!material.roughnessMap) return
      pimples = material.roughnessMap
      pimples.addEventListener('dispose', () => freed.push('rubber'))
      object.geometry.addEventListener('dispose', () => freed.push('geometry'))
      material.addEventListener('dispose', () => freed.push('material'))
    })
    view.adopt(paddleModel())
    expect(freed.sort()).toEqual(['geometry', 'geometry', 'material', 'material'])
    const rubber = (view.root.getObjectByName('part_rubber_forehand') as THREE.Mesh).material as THREE.MeshStandardMaterial
    expect(pimples).not.toBeNull()
    expect(rubber.roughnessMap).toBe(pimples)
  })

  it('casts shadows', () => {
    const { view } = adopted()
    expect((view.root.getObjectByName('part_wood') as THREE.Mesh).castShadow).toBe(true)
  })
})
