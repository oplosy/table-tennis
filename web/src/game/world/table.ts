import * as THREE from 'three'
import {
  HALF_LENGTH, HALF_WIDTH, NET_HALF_WIDTH, NET_HEIGHT, NET_TOP, TABLE_HEIGHT, TABLE_LENGTH, TABLE_THICKNESS, TABLE_WIDTH,
} from '@rally/core'
import { netTexture } from './textures'

const metal = new THREE.MeshStandardMaterial({ color: '#23282f', metalness: 0.7, roughness: 0.38 })
const rubberFoot = new THREE.MeshStandardMaterial({ color: '#0d0f12', roughness: 0.9 })

function box(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** Regulation table: blue top with white lines, steel undercarriage and legs. */
export function createTable() {
  const table = new THREE.Group()
  table.name = 'table'

  const top = new THREE.MeshPhysicalMaterial({ color: '#17467f', roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.45 })
  table.add(box(TABLE_WIDTH, TABLE_THICKNESS, TABLE_LENGTH, top, 0, TABLE_HEIGHT - TABLE_THICKNESS / 2, 0))

  const white = new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.45 })
  const lineY = TABLE_HEIGHT + 0.0006
  const line = (w: number, d: number, x: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.0012, d), white)
    mesh.position.set(x, lineY, z)
    mesh.receiveShadow = true
    table.add(mesh)
  }
  line(TABLE_WIDTH, 0.02, 0, HALF_LENGTH - 0.01)
  line(TABLE_WIDTH, 0.02, 0, -HALF_LENGTH + 0.01)
  line(0.02, TABLE_LENGTH, HALF_WIDTH - 0.01, 0)
  line(0.02, TABLE_LENGTH, -HALF_WIDTH + 0.01, 0)
  line(0.003, TABLE_LENGTH - 0.04, 0, 0)

  // Undercarriage: perimeter apron, centre beams and legs on each half.
  const apronY = TABLE_HEIGHT - TABLE_THICKNESS - 0.03
  table.add(box(TABLE_WIDTH - 0.12, 0.05, 0.03, metal, 0, apronY, HALF_LENGTH - 0.08))
  table.add(box(TABLE_WIDTH - 0.12, 0.05, 0.03, metal, 0, apronY, -HALF_LENGTH + 0.08))
  table.add(box(0.03, 0.05, TABLE_LENGTH - 0.16, metal, HALF_WIDTH - 0.08, apronY, 0))
  table.add(box(0.03, 0.05, TABLE_LENGTH - 0.16, metal, -HALF_WIDTH + 0.08, apronY, 0))
  table.add(box(TABLE_WIDTH - 0.2, 0.04, 0.05, metal, 0, apronY, 0.04))
  table.add(box(TABLE_WIDTH - 0.2, 0.04, 0.05, metal, 0, apronY, -0.04))

  const legHeight = apronY - 0.05
  const legGeometry = new THREE.CylinderGeometry(0.022, 0.022, legHeight, 14)
  const footGeometry = new THREE.CylinderGeometry(0.035, 0.04, 0.05, 16)
  for (const sz of [1, -1]) {
    for (const sx of [1, -1]) {
      const leg = new THREE.Mesh(legGeometry, metal)
      leg.position.set(sx * (HALF_WIDTH - 0.16), 0.05 + legHeight / 2, sz * (HALF_LENGTH - 0.42))
      leg.castShadow = true
      const foot = new THREE.Mesh(footGeometry, rubberFoot)
      foot.position.set(leg.position.x, 0.025, leg.position.z)
      table.add(leg, foot)
    }
    table.add(box(TABLE_WIDTH - 0.32, 0.03, 0.03, metal, 0, 0.26, sz * (HALF_LENGTH - 0.42)))
    const brace = box(0.03, 0.03, 0.58, metal, 0, 0.42, sz * (HALF_LENGTH - 0.7))
    brace.rotation.x = sz * 0.55
    table.add(brace)
  }
  return table
}

export interface NetView { group: THREE.Group; shake(strength: number): void; update(dt: number): void }

/** Posts, clamps, mesh and white top band. The mesh wobbles when the ball hits it. */
export function createNet(): NetView {
  const group = new THREE.Group()
  group.name = 'net'
  const post = new THREE.MeshStandardMaterial({ color: '#15181d', metalness: 0.5, roughness: 0.35 })
  for (const sx of [1, -1]) {
    const upright = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, NET_HEIGHT + 0.012, 12), post)
    upright.position.set(sx * NET_HALF_WIDTH, TABLE_HEIGHT + NET_HEIGHT / 2, 0)
    upright.castShadow = true
    const arm = box(NET_HALF_WIDTH - HALF_WIDTH + 0.02, 0.02, 0.04, post, sx * (HALF_WIDTH + (NET_HALF_WIDTH - HALF_WIDTH) / 2), TABLE_HEIGHT + 0.01, 0)
    const clamp = box(0.05, 0.05, 0.06, post, sx * (HALF_WIDTH + 0.01), TABLE_HEIGHT - 0.02, 0)
    group.add(upright, arm, clamp)
  }
  const meshHeight = NET_HEIGHT - 0.014
  const netMaterial = new THREE.MeshStandardMaterial({
    map: netTexture(), color: '#1a2436', transparent: true, alphaTest: 0.25, side: THREE.DoubleSide, roughness: 0.9,
  })
  const netMesh = new THREE.Mesh(new THREE.PlaneGeometry(NET_HALF_WIDTH * 2, meshHeight, 24, 3), netMaterial)
  netMesh.position.y = TABLE_HEIGHT + meshHeight / 2
  netMesh.castShadow = true
  const band = box(NET_HALF_WIDTH * 2, 0.014, 0.005, new THREE.MeshStandardMaterial({ color: '#f5f5f2', roughness: 0.6 }), 0, NET_TOP - 0.007, 0)
  group.add(netMesh, band)

  const base = (netMesh.geometry.attributes.position.array as Float32Array).slice()
  let energy = 0
  let time = 0
  return {
    group,
    shake(strength) { energy = Math.min(1, energy + strength) },
    update(dt) {
      if (energy <= 0.001) return
      time += dt
      energy *= Math.exp(-dt * 6)
      const positions = netMesh.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < positions.count; i += 1) {
        const x = base[i * 3], y = base[i * 3 + 1]
        const sag = (1 - Math.abs(x) / NET_HALF_WIDTH) * (0.5 - y / meshHeight + 0.5)
        positions.setZ(i, Math.sin(time * 38 + x * 5) * 0.012 * energy * sag)
      }
      positions.needsUpdate = true
    },
  }
}
