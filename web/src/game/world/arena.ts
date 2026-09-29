import * as THREE from 'three'
import { barrierTexture, floorTexture, hallTexture } from './textures'

const COURT_HALF_X = 3.6
const COURT_HALF_Z = 6.8

/**
 * Competition hall around the table: sports floor, surround barriers, tiered
 * stands fading into darkness and a lighting rig.
 */
export function createArena(quality: 'low' | 'high') {
  const arena = new THREE.Group()
  arena.name = 'arena'

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(COURT_HALF_X * 2, COURT_HALF_Z * 2),
    new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.62, metalness: 0 }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  arena.add(floor)

  const outer = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: '#0d1320', roughness: 0.85 }),
  )
  outer.rotation.x = -Math.PI / 2
  outer.position.y = -0.002
  outer.receiveShadow = true
  arena.add(outer)

  // Surround barriers, split into panels like the real thing.
  const barrierHeight = 0.72
  const labels: Array<[string, string]> = [['RALLY', 'TABLE TENNIS'], ['RALLY', 'OPEN 2026'], ['RALLY', 'PLAY ONLINE']]
  const materials = labels.map(([label, sub]) => new THREE.MeshStandardMaterial({ map: barrierTexture(label, sub), roughness: 0.55 }))
  const back = new THREE.MeshStandardMaterial({ color: '#0b1733', roughness: 0.8 })
  const panelWidth = 2.1
  let panelIndex = 0
  const addRow = (count: number, fixed: number, alongX: boolean) => {
    for (let i = 0; i < count; i += 1) {
      const offset = (i - (count - 1) / 2) * (panelWidth + 0.03)
      const face = materials[panelIndex++ % materials.length]
      const geometry = new THREE.BoxGeometry(panelWidth, barrierHeight, 0.04)
      const mesh = new THREE.Mesh(geometry, [back, back, back, back, face, face])
      mesh.position.set(alongX ? offset : fixed, barrierHeight / 2, alongX ? fixed : offset)
      if (!alongX) mesh.rotation.y = Math.PI / 2
      if (alongX ? fixed > 0 : fixed > 0) mesh.rotation.y += Math.PI
      mesh.castShadow = quality === 'high'
      mesh.receiveShadow = true
      arena.add(mesh)
    }
  }
  addRow(3, COURT_HALF_Z, true)
  addRow(3, -COURT_HALF_Z, true)
  addRow(6, COURT_HALF_X, false)
  addRow(6, -COURT_HALF_X, false)

  // Tiered stands on the long sides.
  const standMaterial = new THREE.MeshStandardMaterial({ color: '#121a2b', roughness: 0.9 })
  const seatMaterial = new THREE.MeshStandardMaterial({ color: '#1c2d52', roughness: 0.7 })
  for (const sx of [1, -1]) {
    for (let row = 0; row < 7; row += 1) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.45 * (row + 1), 22), standMaterial)
      step.position.set(sx * (COURT_HALF_X + 2.2 + row * 1.1), (0.45 * (row + 1)) / 2, 0)
      arena.add(step)
      const seats = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 21.6), seatMaterial)
      seats.position.set(step.position.x - sx * 0.2, 0.45 * (row + 1) + 0.04, 0)
      arena.add(seats)
    }
  }

  // The hall itself: a tall dark cylinder with a vertical gradient.
  const hall = new THREE.Mesh(
    new THREE.CylinderGeometry(26, 26, 18, 48, 1, true),
    new THREE.MeshBasicMaterial({ map: hallTexture(), side: THREE.BackSide, fog: false }),
  )
  hall.position.y = 8
  arena.add(hall)

  // Ceiling light bars: emissive strips that also show up in reflections.
  const lightBar = new THREE.MeshBasicMaterial({ color: '#fff6e6' })
  for (const sx of [-1.6, 0, 1.6]) {
    for (const sz of [-4, 0, 4]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.05, 2.2), lightBar)
      bar.position.set(sx, 7.5, sz)
      arena.add(bar)
    }
  }
  return arena
}

/** Lighting rig tuned around the table. */
export function createLights(quality: 'low' | 'high') {
  const group = new THREE.Group()
  group.add(new THREE.HemisphereLight('#c6d6ff', '#2a1712', 0.55))

  const key = new THREE.DirectionalLight('#fff3e2', 2.1)
  key.position.set(1.8, 7.5, 2.4)
  key.target.position.set(0, 0.7, 0)
  key.castShadow = true
  key.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024)
  const cam = key.shadow.camera
  cam.left = -3.4; cam.right = 3.4; cam.top = 4.2; cam.bottom = -4.2; cam.near = 1; cam.far = 16
  key.shadow.bias = -0.0004
  key.shadow.normalBias = 0.015
  key.shadow.radius = 3
  group.add(key, key.target)

  const fill = new THREE.DirectionalLight('#9fb8ff', 0.45)
  fill.position.set(-4, 3, -2)
  group.add(fill)

  for (const sz of [-3.2, 3.2]) {
    const spot = new THREE.SpotLight('#fff1dc', 32, 14, 0.62, 0.7, 1.6)
    spot.position.set(0, 7, sz)
    spot.target.position.set(0, 0.76, sz * 0.25)
    group.add(spot, spot.target)
  }
  return group
}
