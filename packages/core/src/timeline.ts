import { TICK_RATE, type Side } from './constants'
import type { Match, MatchEvent, MatchState } from './match'
import type { Vec3 } from './physics'
import type { ShotIntent } from './shot'

export type Action =
  | { kind: 'serve'; side: Side; x: number; intent: ShotIntent }
  | { kind: 'hit'; side: Side; contact: Vec3; intent: ShotIntent; offCenter: number }

export interface SubmitResult { accepted: boolean; events: MatchEvent[] }

const close = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps

export function statesMatch(a: MatchState, b: MatchState) {
  return a.tick === b.tick && a.phase === b.phase && a.server === b.server && a.expect === b.expect
    && a.lastHitter === b.lastHitter && a.hits === b.hits
    && a.points.home === b.points.home && a.points.away === b.points.away
    && a.games.home === b.games.home && a.games.away === b.games.away
    && close(a.ball.p.x, b.ball.p.x, 1e-4) && close(a.ball.p.y, b.ball.p.y, 1e-4) && close(a.ball.p.z, b.ball.p.z, 1e-4)
    && close(a.ball.v.x, b.ball.v.x, 1e-3) && close(a.ball.v.y, b.ball.v.y, 1e-3) && close(a.ball.v.z, b.ball.v.z, 1e-3)
}

/**
 * Wraps a Match with a short history so that actions arriving late over the
 * network can be inserted at the tick they really happened: the match is
 * rewound, the action applied, and the following ticks replayed.
 */
export class Timeline {
  readonly match: Match
  private readonly size: number
  private history: (MatchState | undefined)[]
  private actions = new Map<number, Action[]>()

  constructor(match: Match, historySeconds = 1.5) {
    this.match = match
    this.size = Math.ceil(historySeconds * TICK_RATE)
    this.history = new Array(this.size)
    this.store()
  }

  get tick() { return this.match.state.tick }
  get state() { return this.match.state }

  /** Oldest tick an action can still be inserted at. */
  get horizon() { return this.tick - this.size + 2 }

  advanceTo(tick: number): MatchEvent[] {
    while (this.match.state.tick < tick) this.stepOnce()
    return this.match.takeEvents()
  }

  /** Records an action at `tick`, rewinding and replaying if that tick is in the past. */
  submit(tick: number, action: Action): SubmitResult {
    const now = this.tick
    if (!Number.isInteger(tick)) return { accepted: false, events: [] }
    if (tick > now) {
      this.schedule(tick, action)
      return { accepted: true, events: [] }
    }
    const base = this.stateAt(tick - 1)
    if (!base) return { accepted: false, events: [] }
    const pending = this.match.takeEvents()
    this.match.restore(base)
    this.schedule(tick, action)
    let accepted = false
    while (this.match.state.tick < now) {
      const results = this.stepOnce()
      if (results.has(action)) accepted = results.get(action) === true
    }
    if (!accepted) this.unschedule(tick, action)
    return { accepted, events: [...pending, ...this.match.takeEvents()] }
  }

  /** Applies an authoritative snapshot, replaying any later local actions on top of it. */
  resync(state: MatchState): MatchEvent[] {
    const now = this.tick
    const pending = this.match.takeEvents()
    if (state.tick >= now) {
      this.match.restore(state)
      this.history = new Array(this.size)
      this.store()
      return pending
    }
    const mine = this.stateAt(state.tick)
    if (mine && statesMatch(mine, state)) return pending
    this.match.restore(state)
    this.store()
    while (this.match.state.tick < now) this.stepOnce()
    return [...pending, ...this.match.takeEvents()]
  }

  /** Advances one tick without collecting events (they stay queued on the match). */
  step() { this.stepOnce() }

  /**
   * Logs an action that was already applied to the live match at the current
   * tick, so later rewinds replay it. Refreshes the stored snapshot to include it.
   */
  record(action: Action) {
    this.schedule(this.tick, action)
    this.store()
  }

  private stepOnce() {
    this.match.step()
    const tick = this.match.state.tick
    const results = new Map<Action, boolean>()
    for (const action of this.actions.get(tick) ?? []) results.set(action, this.apply(action))
    this.store()
    this.actions.delete(tick - this.size)
    return results
  }

  private apply(action: Action) {
    return action.kind === 'serve'
      ? this.match.serve(action.side, action.x, action.intent)
      : this.match.hit(action.side, action.contact, action.intent, action.offCenter)
  }

  private schedule(tick: number, action: Action) {
    const list = this.actions.get(tick)
    if (list) list.push(action)
    else this.actions.set(tick, [action])
  }

  private unschedule(tick: number, action: Action) {
    const list = this.actions.get(tick)
    if (!list) return
    const index = list.indexOf(action)
    if (index >= 0) list.splice(index, 1)
  }

  private store() {
    const state = this.match.snapshot()
    this.history[((state.tick % this.size) + this.size) % this.size] = state
  }

  private stateAt(tick: number) {
    const state = this.history[((tick % this.size) + this.size) % this.size]
    return state && state.tick === tick ? state : null
  }
}
