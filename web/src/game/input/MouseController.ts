import {
  HALF_WIDTH, PADDLE_REST_Y, TICK_RATE, clampPose, restPose, sideSign,
  type Controller, type Match, type PaddlePose, type ShotIntent, type Side, type Vec3,
} from '@rally/core'

/** Fastest the paddle follows the pointer, in metres per real second. */
const MAX_SPEED = 14
const VELOCITY_WINDOW = 20
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * The local player's paddle. The pointer sets a target on a horizontal plane;
 * the paddle chases it, and the recent paddle velocity becomes the stroke:
 * pushing towards the net adds pace and topspin, pulling back chops, and a
 * sideways swipe steers the ball.
 */
export class MouseController implements Controller {
  readonly side: Side
  readonly reach: number
  pose: PaddlePose
  prevPose: PaddlePose
  private target: { x: number; z: number }
  private history: Array<{ x: number; z: number }> = []
  private charging = false
  private chargeTicks = 0
  private serveQueued: { power: number } | null = null

  constructor(side: Side, reach = 0.24) {
    this.side = side
    this.reach = reach
    this.pose = restPose(side)
    this.prevPose = { ...this.pose }
    this.target = { x: this.pose.x, z: this.pose.z }
  }

  setTarget(x: number, z: number) {
    const clamped = clampPose(this.side, { x, y: PADDLE_REST_Y, z })
    this.target = { x: clamped.x, z: clamped.z }
  }

  /** Pointer pressed: starts charging a serve when it is our serve. */
  press() { this.charging = true; this.chargeTicks = 0 }
  /** Pointer released: queues the serve with the charged power. */
  release() {
    if (!this.charging) return
    this.charging = false
    this.serveQueued = { power: Math.min(1, this.chargeTicks / (TICK_RATE * 0.9)) }
  }
  cancelCharge() { this.charging = false; this.chargeTicks = 0 }

  /** 0 … 1 serve charge, for the HUD. */
  get charge() { return this.charging ? Math.min(1, this.chargeTicks / (TICK_RATE * 0.9)) : 0 }

  update(match: Match) {
    this.prevPose = { ...this.pose }
    const maxStep = MAX_SPEED / TICK_RATE
    const dx = this.target.x - this.pose.x
    const dz = this.target.z - this.pose.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    const move = dist > maxStep ? maxStep / dist : 1
    const ball = match.state.ball.p
    // The paddle rises to meet an incoming ball; otherwise it rests at waist height.
    const incoming = match.state.phase === 'rally' && match.state.lastHitter !== this.side && Math.abs(ball.z - this.pose.z) < 1.2
    const targetY = incoming ? Math.min(Math.max(ball.y, PADDLE_REST_Y - 0.1), PADDLE_REST_Y + 0.55) : PADDLE_REST_Y
    this.pose = clampPose(this.side, {
      x: this.pose.x + dx * move,
      y: this.pose.y + (targetY - this.pose.y) * 0.12,
      z: this.pose.z + dz * move,
    })
    this.history.push({ x: this.pose.x, z: this.pose.z })
    if (this.history.length > VELOCITY_WINDOW + 1) this.history.shift()

    const s = match.state
    const ourServe = s.phase === 'pre_serve' && s.server === this.side
    if (this.charging && ourServe) this.chargeTicks += 1
    if (!ourServe) { this.serveQueued = null; if (s.phase !== 'toss') this.charging = false }
    if (this.serveQueued && ourServe) {
      const { power } = this.serveQueued
      this.serveQueued = null
      const lateral = this.velocity().x
      const intent: ShotIntent = {
        aimX: clamp((-this.pose.x / (HALF_WIDTH + 0.2)) * 0.7 + lateral / 3, -1, 1),
        depth: clamp(0.12 + power * 0.85, 0, 1),
        power,
        spin: power < 0.35 ? -0.6 : 0.2 + power * 0.4,
        curve: clamp(lateral / 4, -0.6, 0.6),
      }
      return { x: this.pose.x, intent }
    }
    return null
  }

  /** Paddle velocity in metres per real second over the last few ticks. */
  velocity() {
    const first = this.history[0]
    const last = this.history[this.history.length - 1]
    if (!first || !last || this.history.length < 2) return { x: 0, z: 0 }
    const seconds = (this.history.length - 1) / TICK_RATE
    return { x: (last.x - first.x) / seconds, z: (last.z - first.z) / seconds }
  }

  intent(contact: Vec3): ShotIntent {
    const v = this.velocity()
    const forward = -v.z * sideSign(this.side)
    const lateral = v.x
    const offset = (contact.x - this.pose.x) / this.reach
    const power = clamp((forward - 0.3) / 3.4, 0, 1)
    const aimX = clamp((contact.x / HALF_WIDTH) * 0.35 + offset * 0.45 + lateral / 2.6, -1, 1)
    if (forward < -0.45) {
      // Pulling the paddle back under the ball: a short backspin push.
      return { aimX, depth: 0.35, power: 0.12, spin: -clamp(0.4 - forward / 3, 0.4, 1), curve: clamp(lateral / 5, -0.5, 0.5) }
    }
    return { aimX, depth: clamp(0.38 + power * 0.58, 0, 1), power, spin: 0.25 + power * 0.6, curve: clamp(lateral / 5, -0.6, 0.6) }
  }
}
