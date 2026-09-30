import * as THREE from 'three'
import { sideSign, type PaddlePose, type Side, type Vec3 } from '@rally/core'
import { radialTexture, rubberTexture } from './textures'

const BLADE_RX = 0.078
const BLADE_RY = 0.082
const CORE = 0.0065
const RUBBER = 0.0022
/** Paddles are drawn a little larger than life so they read well on a monitor. */
const DISPLAY_SCALE = 1.35

function bladeShape() {
  const shape = new THREE.Shape()
  shape.absellipse(0, 0, BLADE_RX, BLADE_RY, 0, Math.PI * 2, false, 0)
  return shape
}

function slab(depth: number, material: THREE.Material, z: number) {
  const geometry = new THREE.ExtrudeGeometry(bladeShape(), { depth, bevelEnabled: false, curveSegments: 40 })
  geometry.translate(0, 0, -depth / 2)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.z = z
  mesh.castShadow = true
  return mesh
}

export interface PaddleColors { forehand: string; backhand: string; handle: string; accent: string }

/**
 * A shakehand paddle: wooden core, red and black rubbers and a flared handle.
 * The root follows the paddle pose; an inner pivot handles forehand/backhand
 * grip changes and the swing animation.
 */
export class PaddleView {
  readonly root = new THREE.Group()
  private readonly grip = new THREE.Group()
  private readonly swingPivot = new THREE.Group()
  private readonly glow: THREE.Mesh
  private readonly blade = new THREE.Group()
  private readonly colors: PaddleColors
  private readonly side: Side
  private hand = 1
  private swingTime = 1
  private swingPower = 0
  private glowLevel = 0

  constructor(side: Side, colors: PaddleColors) {
    this.side = side
    this.colors = colors
    const bump = rubberTexture()
    const forehand = new THREE.MeshStandardMaterial({ color: colors.forehand, roughness: 0.55, roughnessMap: bump })
    const backhand = new THREE.MeshStandardMaterial({ color: colors.backhand, roughness: 0.6, roughnessMap: bump })
    const wood = new THREE.MeshStandardMaterial({ color: '#d7b27a', roughness: 0.65 })
    const handle = new THREE.MeshStandardMaterial({ color: colors.handle, roughness: 0.5 })
    const accent = new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.4, metalness: 0.2 })

    const blade = this.blade
    blade.add(slab(CORE, wood, 0))
    blade.add(slab(RUBBER, forehand, CORE / 2 + RUBBER / 2))
    blade.add(slab(RUBBER, backhand, -CORE / 2 - RUBBER / 2))

    // Flared handle below the blade, with a coloured end cap.
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0145, 0.0115, 0.1, 20), handle)
    shaft.scale.z = 0.8
    shaft.position.y = -BLADE_RY - 0.042
    shaft.castShadow = true
    const flare = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.0145, 0.02, 20), handle)
    flare.scale.z = 0.8
    flare.position.y = -BLADE_RY - 0.1
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0205, 0.0205, 0.006, 20), accent)
    cap.scale.z = 0.8
    cap.position.y = -BLADE_RY - 0.112
    const throat = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, CORE + 0.002), wood)
    throat.position.y = -BLADE_RY + 0.004
    blade.add(shaft, flare, cap, throat)

    // Soft ring that lights up when the ball is within reach.
    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.36, 0.36),
      new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,190,120,0.9)', 'rgba(255,120,60,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, side: THREE.DoubleSide }),
    )
    this.glow.renderOrder = 2

    this.swingPivot.add(blade)
    this.grip.add(this.swingPivot)
    this.root.add(this.grip, this.glow)
    this.root.scale.setScalar(DISPLAY_SCALE)
    // Forehand rubber faces the net for both players.
    this.grip.rotation.y = side === 'home' ? Math.PI : 0
  }

  /** Swaps the procedural blade for the Blender model, in this player's colours. */
  adopt(model: THREE.Object3D) {
    for (const child of [...this.blade.children]) {
      this.blade.remove(child)
      if (child instanceof THREE.Mesh) { child.geometry.dispose(); (child.material as THREE.Material).dispose() }
    }
    const tint: Record<string, string> = {
      rubber_forehand: this.colors.forehand, rubber_backhand: this.colors.backhand, handle: this.colors.handle, accent: this.colors.accent,
    }
    const copy = model.clone(true)
    const materials = new Map<THREE.Material, THREE.MeshStandardMaterial>()
    copy.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = true
      const source = object.material as THREE.MeshStandardMaterial
      let material = materials.get(source)
      if (!material) {
        material = source.clone()
        if (tint[source.name]) material.color.set(tint[source.name])
        materials.set(source, material)
      }
      object.material = material
    })
    this.blade.add(copy)
  }

  swing(power: number) {
    this.swingTime = 0
    this.swingPower = power
  }

  /**
   * Places the paddle and animates the grip. `ball` decides forehand vs
   * backhand; `ready` makes the reach glow visible.
   */
  update(pose: PaddlePose, ball: Vec3, dt: number, ready: boolean) {
    this.root.position.set(pose.x, pose.y, pose.z)
    const sign = sideSign(this.side)
    // Player's right is -x for home (they face -z) mirrored for away.
    const ballOnRight = (ball.x - pose.x) * -sign > -0.02
    const targetHand = ballOnRight ? 1 : -1
    this.hand += (targetHand - this.hand) * Math.min(1, dt * 14)

    const baseYaw = this.side === 'home' ? Math.PI : 0
    // Backhand shows the black rubber: rotate the blade half a turn around its handle axis.
    const flip = (1 - this.hand) / 2
    this.grip.rotation.set(0, baseYaw + flip * Math.PI, 0)
    // Handle leans towards the player's hitting side, face slightly closed.
    this.swingPivot.rotation.z = -0.55 * this.hand * sign * (this.side === 'home' ? -1 : 1) * (flip > 0.5 ? -1 : 1)
    this.swingPivot.rotation.x = -0.28

    this.swingTime = Math.min(1, this.swingTime + dt / 0.22)
    const t = this.swingTime
    const arc = Math.sin(t * Math.PI) * (0.4 + this.swingPower * 0.8)
    this.swingPivot.rotation.y = arc * this.hand * 0.9
    this.swingPivot.position.set(0, arc * 0.03, -arc * 0.04)

    this.glowLevel += ((ready ? 1 : 0) - this.glowLevel) * Math.min(1, dt * 10)
    const material = this.glow.material as THREE.MeshBasicMaterial
    material.opacity = this.glowLevel * 0.55
    this.glow.visible = material.opacity > 0.01
  }
}
