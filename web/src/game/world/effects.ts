import * as THREE from 'three'
import { TABLE_HEIGHT, type Vec3 } from '@rally/core'
import { radialTexture } from './textures'

interface Burst { mesh: THREE.Mesh; age: number; life: number; grow: number; fade: number }

/** Short-lived impact visuals: bounce ripples, paddle flashes and the landing hint. */
export class Effects {
  readonly group = new THREE.Group()
  private bursts: Burst[] = []
  private readonly ringGeometry = new THREE.RingGeometry(0.035, 0.05, 40)
  private readonly flashTexture = radialTexture('rgba(255,236,200,1)', 'rgba(255,160,90,0)')
  private readonly marker: THREE.Mesh
  private markerLevel = 0
  private markerTarget = 0

  constructor() {
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.05, 0.065, 48),
      new THREE.MeshBasicMaterial({ color: '#ffb35c', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    )
    this.marker.rotation.x = -Math.PI / 2
    this.marker.visible = false
    this.group.add(this.marker)
  }

  bounce(x: number, z: number, strength: number, onTable = true) {
    const material = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide })
    const ring = new THREE.Mesh(this.ringGeometry, material)
    ring.rotation.x = -Math.PI / 2
    ring.position.set(x, onTable ? TABLE_HEIGHT + 0.002 : 0.003, z)
    this.add({ mesh: ring, age: 0, life: 0.45, grow: 2.5 + strength * 3, fade: 0.8 })
  }

  flash(at: Vec3, power: number) {
    const material = new THREE.SpriteMaterial({ map: this.flashTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 })
    const sprite = new THREE.Sprite(material) as unknown as THREE.Mesh
    sprite.position.set(at.x, at.y, at.z)
    sprite.scale.setScalar(0.12 + power * 0.25)
    this.add({ mesh: sprite, age: 0, life: 0.18 + power * 0.12, grow: 1.8, fade: 0.9 })
  }

  /** Predicted bounce spot of the incoming ball (assist mode). */
  showLanding(point: Vec3 | null) {
    if (point) {
      this.marker.position.set(point.x, TABLE_HEIGHT + 0.0025, point.z)
      this.markerTarget = 1
    } else {
      this.markerTarget = 0
    }
  }

  update(dt: number) {
    this.markerLevel += (this.markerTarget - this.markerLevel) * Math.min(1, dt * 12)
    const markerMaterial = this.marker.material as THREE.MeshBasicMaterial
    markerMaterial.opacity = this.markerLevel * 0.85
    this.marker.visible = this.markerLevel > 0.02
    this.marker.scale.setScalar(1 + Math.sin(performance.now() / 120) * 0.08)

    this.bursts = this.bursts.filter((burst) => {
      burst.age += dt
      const t = burst.age / burst.life
      if (t >= 1) {
        this.group.remove(burst.mesh)
        ;(burst.mesh.material as THREE.Material).dispose()
        return false
      }
      const scale = 1 + t * burst.grow
      if (burst.mesh instanceof THREE.Sprite) burst.mesh.scale.setScalar(burst.mesh.scale.x * (1 + dt * burst.grow))
      else burst.mesh.scale.setScalar(scale)
      ;(burst.mesh.material as THREE.MeshBasicMaterial).opacity = burst.fade * (1 - t)
      return true
    })
  }

  private add(burst: Burst) {
    this.group.add(burst.mesh)
    this.bursts.push(burst)
  }
}
