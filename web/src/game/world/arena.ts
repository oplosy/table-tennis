import * as THREE from 'three'
import { SIDES, TABLE_HEIGHT, sideSign } from '@rally/core'
import type { RenderProfile } from '../render/profile'
import type { Scoreboard } from './scoreboard'
import { barrierTexture, floorTexture, hallTexture } from './textures'

/** Half extents of the playing court, inside the surround barriers. */
export const COURT_HALF_X = 3.6
export const COURT_HALF_Z = 6.8

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
  // Above 1.0 in linear HDR so the bloom threshold catches the lamps and little else.
  const lightBar = new THREE.MeshBasicMaterial({ color: new THREE.Color('#f3f6ff').multiplyScalar(6) })
  for (const sx of [-1.6, 0, 1.6]) {
    for (const sz of [-4, 0, 4]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.05, 2.2), lightBar)
      bar.position.set(sx, 7.5, sz)
      arena.add(bar)
    }
  }
  return arena
}

/** Scales the baked light against the real-time lights on the table; tuned by eye. */
const BAKED_LIGHT = 1.9
const LAMP_GLOW = 6
/** Where the umpire's flip board stands in the arena model (metres). */
const UMPIRE_BOARD = { x: 2.592, y: 0.915, z: 0.22 }
const BARRIER_LABELS: Record<string, [string, string]> = {
  barrier_face_A: ['RALLY', 'TABLE TENNIS'], barrier_face_B: ['RALLY', 'OPEN 2026'], barrier_face_C: ['RALLY', 'PLAY ONLINE'], backdrop_logo: ['RALLY', 'OPEN 2026'],
}

/** Canvas textures follow three's convention; glTF UVs run the other way up. */
function forGltf(texture: THREE.Texture) {
  texture.flipY = false
  return texture
}

/**
 * Replaces the procedural hall with the Blender model. Its lighting is baked,
 * so every surface is unlit: big ones read a shared lightmap through their
 * second UV set, cluttered ones carry the light in vertex colours. Real-time
 * lights then cost nothing here; a transparent catcher on the court shows the
 * shadows of the things that move.
 */
export function adoptArenaModel(arena: THREE.Group, model: THREE.Object3D, lightmap: THREE.Texture, scoreboard: Scoreboard) {
  lightmap.flipY = false
  lightmap.colorSpace = THREE.SRGBColorSpace
  lightmap.channel = 1

  const unlit = new Map<string, THREE.MeshBasicMaterial>()
  const convert = (source: THREE.MeshStandardMaterial, geometry: THREE.BufferGeometry) => {
    const mode = geometry.hasAttribute('uv1') ? 'lightmap' : geometry.hasAttribute('color') ? 'vertex' : 'flat'
    const key = `${source.name}:${mode}`
    let material = unlit.get(key)
    if (material) return material
    if (source.name === 'lamp' || source.name === 'spot_lens') {
      // Above 1.0 in linear HDR so the bloom threshold catches the lamps and little else.
      material = new THREE.MeshBasicMaterial({ color: source.color.clone().multiplyScalar(LAMP_GLOW) })
    } else if (source.name === 'screen') {
      material = new THREE.MeshBasicMaterial({ map: scoreboard.screen, color: new THREE.Color(1.5, 1.5, 1.5) })
    } else {
      material = new THREE.MeshBasicMaterial({ color: source.color.clone() })
      if (source.name === 'court') { material.map = forGltf(floorTexture()); material.color.set('#ffffff') }
      const label = BARRIER_LABELS[source.name]
      if (label) { material.map = forGltf(barrierTexture(...label)); material.color.set('#ffffff') }
      if (mode === 'lightmap') {
        material.lightMap = lightmap
        material.lightMapIntensity = BAKED_LIGHT * Math.PI // MeshBasicMaterial divides lightmaps by pi
      } else if (mode === 'vertex') {
        material.vertexColors = true
        material.color.multiplyScalar(BAKED_LIGHT)
      }
    }
    material.name = source.name
    unlit.set(key, material)
    return material
  }

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const source = object.material as THREE.MeshStandardMaterial
    object.material = convert(source, object.geometry)
    source.dispose()
  })

  for (const child of [...arena.children]) {
    arena.remove(child)
    child.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.dispose()
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose()
        material.dispose()
      }
    })
  }

  // The table's shadow is in the lightmap; this only catches the ball and the paddles.
  // It lies millimetres above the mat, so it is pulled forward in depth instead of fighting it.
  const catcher = new THREE.Mesh(
    new THREE.PlaneGeometry(COURT_HALF_X * 2, COURT_HALF_Z * 2),
    new THREE.ShadowMaterial({ opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  )
  catcher.name = 'shadow_catcher'
  catcher.rotation.x = -Math.PI / 2
  catcher.position.y = 0.002
  catcher.receiveShadow = true
  // Flip board on the umpire's desk: one plate per player, facing the table.
  const plate = new THREE.PlaneGeometry(0.24, 0.18)
  for (const side of SIDES) {
    const digit = new THREE.Mesh(plate, new THREE.MeshBasicMaterial({ map: scoreboard.digits[side], color: new THREE.Color(0.8, 0.8, 0.8) }))
    digit.name = `umpire_score_${side}`
    digit.position.set(UMPIRE_BOARD.x, UMPIRE_BOARD.y, sideSign(side) * UMPIRE_BOARD.z)
    digit.rotation.y = -Math.PI / 2
    arena.add(digit)
  }
  arena.add(model, catcher)
}

/**
 * Broadcast rig: the court is lit like a stage and the stands fall into
 * darkness. Ambient light comes from the HDRI; only the key casts shadows.
 */
export function createLights(profile: RenderProfile) {
  const group = new THREE.Group()
  group.name = 'lights'
  group.add(new THREE.HemisphereLight('#b9c8ff', '#1a1210', 0.12))

  // Nearly overhead so ball and paddle shadows fall short and straight down.
  const key = new THREE.DirectionalLight('#f3f6ff', 1.7)
  key.position.set(0.6, 8, 0.9)
  key.target.position.set(0, TABLE_HEIGHT, 0)
  key.castShadow = true
  key.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize)
  const cam = key.shadow.camera
  cam.left = -3.4; cam.right = 3.4; cam.top = 4.2; cam.bottom = -4.2; cam.near = 1; cam.far = 12
  key.shadow.bias = -0.0004
  key.shadow.normalBias = 0.015
  key.shadow.radius = 3
  group.add(key, key.target)

  // Court wash: four pools that fade out before the barriers.
  for (const sx of [-1.5, 1.5]) {
    for (const sz of [-3, 3]) {
      const wash = new THREE.SpotLight('#eef2ff', 9, 14, 0.55, 0.9, 1.6)
      wash.position.set(sx, 6.5, sz)
      wash.target.position.set(sx * 0.4, 0, sz * 0.6)
      group.add(wash, wash.target)
    }
  }

  // Rim: weak cool back light from each end separates paddles and ball from the dark stands.
  for (const sz of [-1, 1]) {
    const rim = new THREE.DirectionalLight('#9fc0ff', 0.35)
    rim.position.set(0, 2.2, sz * 9)
    rim.target.position.set(0, TABLE_HEIGHT + 0.15, 0)
    group.add(rim, rim.target)
  }
  return group
}
