import {
  HALF_LENGTH, HIT_MAX_Y, HIT_MIN_Y, PADDLE_MAX_DEPTH, PADDLE_MIN_DEPTH, PADDLE_REST_Y, SURFACE_Y, TICK_RATE,
  other, secondsToTicks, sideSign, type Side,
} from './constants'
import type { Match } from './match'
import { clampPose, restPose, type PaddlePose } from './paddle'
import { cloneBall, stepBall, type Contact, type Vec3 } from './physics'
import { Rng } from './random'
import type { ShotIntent, ShotSkill } from './shot'

export type Difficulty = 'easy' | 'medium' | 'hard' | 'pro'

export interface AIProfile {
  /** Seconds before the AI reacts to a new shot. */
  reaction: number
  /** Paddle speed in metres per real second. */
  speed: number
  /** Standard deviation of the positioning error in metres. */
  error: number
  reach: number
  power: [number, number]
  /** Probability of going for a winner on a high ball. */
  aggression: number
  skill: ShotSkill
}

export const AI_PROFILES: Record<Difficulty, AIProfile> = {
  easy: { reaction: 0.36, speed: 1.8, error: 0.13, reach: 0.2, power: [0.12, 0.42], aggression: 0.15, skill: { accuracy: 0.3, netAssist: 0.75 } },
  medium: { reaction: 0.25, speed: 2.6, error: 0.09, reach: 0.22, power: [0.25, 0.62], aggression: 0.4, skill: { accuracy: 0.55, netAssist: 0.6 } },
  hard: { reaction: 0.17, speed: 3.5, error: 0.05, reach: 0.23, power: [0.4, 0.8], aggression: 0.7, skill: { accuracy: 0.75, netAssist: 0.5 } },
  pro: { reaction: 0.12, speed: 4.6, error: 0.03, reach: 0.24, power: [0.45, 0.9], aggression: 0.85, skill: { accuracy: 0.93, netAssist: 0.5 } },
}

interface Plan { contact: Vec3; ticks: number }

const PREDICT_SECONDS = 3

/**
 * A computer opponent that plays with the same physics and the same contact
 * rules as a human: it predicts the ball by simulating it forward, walks its
 * paddle there at limited speed and then chooses a stroke intent.
 */
export class AIController {
  readonly side: Side
  readonly profile: AIProfile
  pose: PaddlePose
  prevPose: PaddlePose
  private rng: Rng
  private plannedFor = -1
  private reactAt = 0
  private target: PaddlePose
  private serveAt = -1

  constructor(side: Side, profile: AIProfile, seed: number) {
    this.side = side
    this.profile = profile
    this.rng = new Rng(seed)
    this.pose = restPose(side)
    this.prevPose = { ...this.pose }
    this.target = { ...this.pose }
  }

  get reach() { return this.profile.reach }

  /**
   * Called once per tick before the match steps. Moves the paddle and returns
   * a serve request when it is the AI's turn to serve.
   */
  update(match: Match): { x: number; intent: ShotIntent } | null {
    const s = match.state
    this.prevPose = { ...this.pose }
    let serve: { x: number; intent: ShotIntent } | null = null

    if (s.phase === 'pre_serve' && s.server === this.side) {
      if (this.serveAt < 0) {
        this.serveAt = s.tick + secondsToTicks(this.rng.range(0.9, 1.7))
        this.target = { x: this.rng.range(-0.4, 0.4), y: PADDLE_REST_Y, z: sideSign(this.side) * (HALF_LENGTH + 0.3) }
      }
      if (s.tick >= this.serveAt) { serve = { x: this.pose.x, intent: this.serveIntent() }; this.serveAt = -1 }
    } else {
      this.serveAt = -1
      const incoming = (s.phase === 'rally' && s.lastHitter !== this.side) || (s.phase === 'toss' && s.server !== this.side)
      if (incoming) {
        const shotId = s.hits * 2 + (s.phase === 'toss' ? 1 : 0)
        if (this.plannedFor !== shotId) { this.plannedFor = shotId; this.reactAt = s.tick + secondsToTicks(this.profile.reaction) }
        if (s.tick === this.reactAt && s.phase === 'rally') {
          const plan = this.predict(match)
          if (plan) {
            this.target = {
              x: plan.contact.x + this.rng.gaussian() * this.profile.error,
              y: plan.contact.y,
              z: plan.contact.z + sideSign(this.side) * 0.015,
            }
          }
        }
        if (s.phase === 'toss') this.target = { x: 0, y: PADDLE_REST_Y, z: sideSign(this.side) * (HALF_LENGTH + 0.45) }
      } else if (s.phase !== 'rally' || s.lastHitter === this.side) {
        // Recover towards a ready position after our own stroke.
        const recoverAt = s.phase === 'rally' ? s.lastContactTick + secondsToTicks(0.1) : 0
        if (s.tick >= recoverAt) this.target = { x: this.target.x * 0.5, y: PADDLE_REST_Y, z: sideSign(this.side) * (HALF_LENGTH + 0.5) }
      }
    }

    const maxStep = this.profile.speed / TICK_RATE
    const dx = this.target.x - this.pose.x
    const dz = this.target.z - this.pose.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    const move = dist > maxStep ? maxStep / dist : 1
    this.pose = clampPose(this.side, {
      x: this.pose.x + dx * move,
      y: this.pose.y + (this.target.y - this.pose.y) * 0.08,
      z: this.pose.z + dz * move,
    })
    return serve
  }

  /** Stroke choice for a contact at `contact`, aiming away from the opponent. */
  intent(contact: Vec3, opponent: PaddlePose): ShotIntent {
    const p = this.profile
    const rng = this.rng
    const high = contact.y > SURFACE_Y + 0.3
    const low = contact.y < SURFACE_Y + 0.06
    let power = rng.range(p.power[0], p.power[1])
    let spin = 0.2 + 0.6 * power
    if (high && rng.next() < p.aggression) { power = Math.max(power, rng.range(0.8, 1)); spin = 0.6 }
    else if (low && rng.next() < 0.5) { power = rng.range(0.15, 0.35); spin = -rng.range(0.4, 0.9) }
    const away = opponent.x > 0 ? -1 : 1
    const aimX = rng.next() < 0.3 + 0.5 * p.aggression ? away * rng.range(0.35, 0.95) : rng.range(-0.8, 0.8)
    return { aimX, depth: rng.range(0.45, 0.95), power, spin, curve: rng.range(-0.35, 0.35) }
  }

  private serveIntent(): ShotIntent {
    const rng = this.rng
    const short = rng.next() < 0.4
    return {
      aimX: rng.range(-0.85, 0.85),
      depth: short ? rng.range(0.1, 0.35) : rng.range(0.6, 0.95),
      power: short ? rng.range(0.1, 0.3) : rng.range(0.4, 0.8),
      spin: rng.range(-0.8, 0.8),
      curve: rng.range(-0.5, 0.5),
    }
  }

  /** Simulates the incoming ball and picks a comfortable contact point after it bounces on our side. */
  private predict(match: Match): Plan | null {
    const s = match.state
    const ball = cloneBall(s.ball)
    const sign = sideSign(this.side)
    const contacts: Contact[] = []
    let bounced = s.expect === 'hit'
    let best: Plan | null = null
    let fallback: Plan | null = null
    const steps = Math.ceil(PREDICT_SECONDS * TICK_RATE)
    for (let i = 1; i <= steps; i += 1) {
      contacts.length = 0
      stepBall(ball, match.dt, contacts)
      for (const c of contacts) {
        if (c.kind === 'table' && c.side === this.side) {
          if (bounced) return best ?? fallback
          bounced = true
        } else if (c.kind !== 'table') {
          return best ?? fallback
        } else if (c.side === other(this.side) && bounced) {
          return best ?? fallback
        }
      }
      if (!bounced) continue
      const depth = ball.p.z * sign
      if (depth < PADDLE_MIN_DEPTH || depth > PADDLE_MAX_DEPTH) continue
      if (ball.p.y < HIT_MIN_Y || ball.p.y > HIT_MAX_Y) continue
      const point = { contact: { ...ball.p }, ticks: i }
      fallback ??= point
      // Prefer the top of the bounce, like a player taking the ball at its peak.
      if (ball.v.y <= 0 && !best) best = point
    }
    return best ?? fallback
  }
}
