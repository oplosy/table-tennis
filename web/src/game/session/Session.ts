import {
  PADDLE_REST_Y, TICK_RATE, cloneBall, restPose, sideSign, stepBall, tossOrigin,
  type Contact, type Match, type MatchEvent, type PaddlePose, type Side, type Vec3,
} from '@rally/core'
import type { MouseController } from '../input/MouseController'

export interface RenderFrame {
  ball: Vec3
  velocity: Vec3
  spin: Vec3
  paddles: Record<Side, PaddlePose>
  /** Side whose paddle should glow because the ball is about to be in reach. */
  ready: Record<Side, boolean>
  landing: Vec3 | null
}

export type SessionListener = (events: MatchEvent[]) => void

/**
 * Common rendering glue for local and online play: interpolation between
 * ticks, the ball in the server's hand, and the landing prediction.
 */
export abstract class GameSession {
  abstract readonly localSide: Side | null
  abstract readonly match: Match
  readonly controller: MouseController | null
  paused = false
  assist = true
  protected fraction = 0
  protected previousBall: Vec3 = { x: 0, y: 0, z: 0 }
  private landingFor = -1
  private landing: Vec3 | null = null
  private listeners = new Set<SessionListener>()

  constructor(controller: MouseController | null) {
    this.controller = controller
  }

  /** Advances to wall-clock time `now` (ms) and returns events to present. */
  abstract update(now: number): MatchEvent[]
  abstract paddle(side: Side): PaddlePose
  dispose() { this.listeners.clear() }

  subscribe(listener: SessionListener) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  protected emit(events: MatchEvent[]) {
    if (events.length) for (const listener of this.listeners) listener(events)
  }

  /** Runs `count` ticks with `tick`, remembering the ball before the last one for interpolation. */
  protected runTicks(count: number, tick: () => MatchEvent[]) {
    const events: MatchEvent[] = []
    for (let i = 0; i < count; i += 1) {
      this.previousBall = { ...this.match.state.ball.p }
      events.push(...tick())
    }
    return events
  }

  frame(): RenderFrame {
    const s = this.match.state
    const home = this.paddle('home')
    const away = this.paddle('away')
    let ball: Vec3
    if (s.phase === 'pre_serve') {
      const server = s.server === 'home' ? home : away
      const hand = tossOrigin(s.server, server.x)
      ball = { x: hand.x, y: hand.y + Math.sin(performance.now() / 260) * 0.012, z: hand.z }
    } else {
      const f = this.fraction
      const p = s.ball.p
      const q = this.previousBall
      const jump = Math.abs(p.x - q.x) + Math.abs(p.y - q.y) + Math.abs(p.z - q.z)
      ball = jump > 0.5 ? { ...p } : { x: q.x + (p.x - q.x) * f, y: q.y + (p.y - q.y) * f, z: q.z + (p.z - q.z) * f }
    }
    const ready = { home: this.inReach('home', home), away: this.inReach('away', away) }
    return { ball, velocity: s.ball.v, spin: s.ball.w, paddles: { home, away }, ready, landing: this.predictLanding() }
  }

  private inReach(side: Side, pose: PaddlePose) {
    if (side !== this.localSide || !this.match.canHit(side)) return false
    const ball = this.match.state.ball.p
    return Math.abs(ball.z - pose.z) < 0.45 && Math.abs(ball.x - pose.x) < 0.3
  }

  /** Where the opponent's shot will bounce on our half, computed once per shot. */
  private predictLanding(): Vec3 | null {
    const s = this.match.state
    const side = this.localSide
    if (!this.assist || !side || s.phase !== 'rally' || s.lastHitter === side || s.expect !== 'receiver_side') {
      this.landingFor = -1
      this.landing = null
      return null
    }
    if (this.landingFor === s.hits) return this.landing
    this.landingFor = s.hits
    const ball = cloneBall(s.ball)
    const contacts: Contact[] = []
    this.landing = null
    for (let i = 0; i < TICK_RATE * 3 && !this.landing; i += 1) {
      contacts.length = 0
      stepBall(ball, this.match.dt, contacts)
      for (const c of contacts) {
        if (c.kind === 'table' && c.side === side) this.landing = { x: c.x, y: 0, z: c.z }
        if (c.kind !== 'table' || c.side !== side) i = Infinity
        break
      }
    }
    return this.landing
  }
}

export const idlePose = (side: Side): PaddlePose => ({ ...restPose(side), y: PADDLE_REST_Y, z: sideSign(side) * 1.95 })
