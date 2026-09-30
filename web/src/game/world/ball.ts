import * as THREE from 'three'
import { BALL_RADIUS, HALF_LENGTH, HALF_WIDTH, TABLE_HEIGHT, type Vec3 } from '@rally/core'
import { radialTexture } from './textures'

/** The ball is drawn larger than the real 40 mm so it stays readable at 1080p. */
export const BALL_DISPLAY_SCALE = 1.5
const TRAIL_POINTS = 18

/** Ball mesh with a speed trail and a contact shadow projected onto the table or floor. */
export class BallView {
  readonly group = new THREE.Group()
  private readonly mesh: THREE.Mesh
  private readonly halo: THREE.Mesh
  private readonly shadow: THREE.Mesh
  private readonly trail: THREE.Mesh
  private readonly trailPositions: Float32Array
  private readonly trailColors: Float32Array
  private readonly history: THREE.Vector3[] = []
  private readonly spinAxis = new THREE.Vector3()
  private hidden = false

  constructor() {
    const radius = BALL_RADIUS * BALL_DISPLAY_SCALE
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 28, 18),
      new THREE.MeshStandardMaterial({ color: '#fffaf0', emissive: '#fff4e0', emissiveIntensity: 0.35, roughness: 0.35 }),
    )
    this.mesh.castShadow = true

    // A faint seam line makes the spin visible.
    const seam = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 1.001, radius * 0.06, 6, 32),
      new THREE.MeshBasicMaterial({ color: '#f2b36b' }),
    )
    this.mesh.add(seam)

    this.halo = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 4.5, radius * 4.5),
      new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,245,225,0.3)', 'rgba(255,245,225,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    )

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: radialTexture('rgba(0,0,0,0.9)'), transparent: true, depthWrite: false }),
    )
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.renderOrder = 1

    this.trailPositions = new Float32Array(TRAIL_POINTS * 2 * 3)
    this.trailColors = new Float32Array(TRAIL_POINTS * 2 * 4)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(this.trailColors, 4))
    const index: number[] = []
    for (let i = 0; i < TRAIL_POINTS - 1; i += 1) {
      const a = i * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    geometry.setIndex(index)
    this.trail = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }))
    this.trail.frustumCulled = false

    this.group.add(this.mesh, this.halo, this.shadow, this.trail)
  }

  setVisible(visible: boolean) {
    if (this.hidden === !visible) return
    this.hidden = !visible
    this.group.visible = visible
    if (!visible) this.history.length = 0
  }

  /** Clears the trail, e.g. when the ball is teleported back to the server's hand. */
  resetTrail() { this.history.length = 0 }

  update(position: Vec3, velocity: Vec3, spin: Vec3, dt: number, camera: THREE.Camera, heat: number) {
    this.mesh.position.set(position.x, position.y, position.z)
    this.halo.position.copy(this.mesh.position)
    this.halo.quaternion.copy(camera.quaternion)

    const spinRate = Math.sqrt(spin.x * spin.x + spin.y * spin.y + spin.z * spin.z)
    if (spinRate > 1e-3) {
      this.spinAxis.set(spin.x / spinRate, spin.y / spinRate, spin.z / spinRate)
      // Real spin rates would strobe; show a readable fraction of it.
      this.mesh.rotateOnWorldAxis(this.spinAxis, Math.min(spinRate, 120) * dt * 0.25)
    }

    // Shadow drops straight down onto whatever surface is below.
    const overTable = Math.abs(position.x) <= HALF_WIDTH && Math.abs(position.z) <= HALF_LENGTH && position.y >= TABLE_HEIGHT
    const surface = overTable ? TABLE_HEIGHT + 0.0015 : 0.002
    const height = Math.max(0, position.y - surface)
    this.shadow.position.set(position.x, surface, position.z)
    this.shadow.scale.setScalar(0.07 + height * 0.09)
    ;(this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.12, 0.75 - height * 0.9)

    this.updateTrail(position, velocity, camera, heat)
  }

  private updateTrail(position: Vec3, velocity: Vec3, camera: THREE.Camera, heat: number) {
    this.history.unshift(new THREE.Vector3(position.x, position.y, position.z))
    if (this.history.length > TRAIL_POINTS) this.history.pop()
    const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2)
    const strength = Math.min(1, Math.max(0, (speed - 2) / 8))
    const width = BALL_RADIUS * BALL_DISPLAY_SCALE * 0.55
    const toCamera = new THREE.Vector3()
    const direction = new THREE.Vector3()
    const side = new THREE.Vector3()
    const hot = new THREE.Color('#ff7a3d')
    const cool = new THREE.Color('#fff3df')
    const tint = cool.clone().lerp(hot, heat)
    for (let i = 0; i < TRAIL_POINTS; i += 1) {
      const point = this.history[Math.min(i, this.history.length - 1)] ?? this.mesh.position
      const next = this.history[Math.min(i + 1, this.history.length - 1)] ?? point
      direction.subVectors(point, next)
      if (direction.lengthSq() < 1e-10) direction.set(0, 0, 1)
      toCamera.subVectors(camera.position, point)
      side.crossVectors(direction, toCamera).normalize().multiplyScalar(width * (1 - i / TRAIL_POINTS))
      const fade = i < this.history.length ? (1 - i / TRAIL_POINTS) ** 2 * strength * (0.22 + heat * 0.3) : 0
      for (let k = 0; k < 2; k += 1) {
        const v = i * 2 + k
        const s = k === 0 ? 1 : -1
        this.trailPositions[v * 3] = point.x + side.x * s
        this.trailPositions[v * 3 + 1] = point.y + side.y * s
        this.trailPositions[v * 3 + 2] = point.z + side.z * s
        this.trailColors[v * 4] = tint.r
        this.trailColors[v * 4 + 1] = tint.g
        this.trailColors[v * 4 + 2] = tint.b
        this.trailColors[v * 4 + 3] = fade
      }
    }
    const geometry = this.trail.geometry
    geometry.attributes.position.needsUpdate = true
    geometry.attributes.color.needsUpdate = true
  }
}
